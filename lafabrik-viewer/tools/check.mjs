// Test de bout en bout : démarre le serveur (dev ou build), ouvre la visionneuse dans Chromium
// (bureau + iPhone + Android émulés), vérifie l'absence d'erreurs, et produit des captures.
// Usage : npm run check [-- --dist] [-- --product marquez]
import { createServer, preview } from 'vite';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Playwright est préinstallé globalement (ou installable avec npm i -D playwright).
const { chromium, devices } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const useDist = process.argv.includes('--dist');
const pi = process.argv.indexOf('--product');
const product = pi > 0 ? process.argv[pi + 1] : 'marquez';
const outDir = path.join(root, 'test-output');
await mkdir(outDir, { recursive: true });

const server = useDist
  ? await preview({ root, build: { outDir: 'dist/site' }, preview: { port: 4174, host: '127.0.0.1' }, logLevel: 'error' })
  : await createServer({ root, server: { port: 5174, host: '127.0.0.1' }, logLevel: 'error' }).then((s) => s.listen());
const base = useDist ? 'http://127.0.0.1:4174/' : 'http://127.0.0.1:5174/';

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
let failures = 0;
const fail = (m) => { failures++; console.error('✘ ' + m); };

async function run(name, contextOpts, shots) {
  const ctx = await browser.newContext(contextOpts);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('requestfailed', (r) => errors.push(`requête échouée ${r.url()}`));
  await page.goto(`${base}index.html?product=${product}`);
  await page.waitForFunction(() => window.__lafabrik?.ready, null, { timeout: 90000 }).catch(() => fail(`${name} : la visionneuse n'est pas prête`));
  const info = await page.evaluate(() => {
    const v = window.__lafabrik?.viewer;
    if (!v) return null;
    let tris = 0;
    v.scene.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
    const pieces = [...v.pieces.keys()];
    return { tier: v.tierName, loadMs: v.loadTimeMs, tris: Math.round(tris), pieces, calls: v.renderer.info.render.calls, glass: v.glass?.visible };
  });
  console.log(`• ${name} : ${JSON.stringify(info)}`);
  for (const [label, view] of shots) {
    if (view) {
      await page.evaluate((vw) => window.__lafabrik.viewer.goTo(vw, { duration: 0 }), view);
    }
    await page.waitForTimeout(400);
    const file = path.join(outDir, `${name}-${label}.png`);
    await page.locator('lafabrik-viewer').screenshot({ path: file });
    // Vérifie que l'image n'est pas uniforme (rendu vide)
    const stats = await page.evaluate(() => {
      const v = window.__lafabrik.viewer;
      v.renderer.render(v.scene, v.camera);
      const c = v.renderer.domElement;
      const t = document.createElement('canvas');
      t.width = 64; t.height = 64;
      const ctx = t.getContext('2d');
      ctx.drawImage(c, 0, 0, 64, 64);
      const d = ctx.getImageData(0, 0, 64, 64).data;
      let min = 255, max = 0;
      for (let i = 0; i < d.length; i += 4) { const l = (d[i] + d[i + 1] + d[i + 2]) / 3; min = Math.min(min, l); max = Math.max(max, l); }
      return { min, max };
    });
    if (stats.max - stats.min < 40) fail(`${name}-${label} : rendu uniforme (${JSON.stringify(stats)})`);
  }
  if (errors.length) fail(`${name} : erreurs console\n  ${errors.join('\n  ')}`);
  await ctx.close();
}

await run('bureau', { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 }, [
  ['initial', null], ['face', 'front'], ['profil', 'side'], ['dos', 'back'],
  ['detail', { azimuthDeg: -35, elevationDeg: 18, distanceMm: 260 }],
]);
await run('iphone', { ...devices['iPhone 13'] }, [['initial', null], ['face', 'front']]);
await run('android', { ...devices['Pixel 7'] }, [['initial', null]]);

await browser.close();
await server.close?.();
await server.httpServer?.close?.();
if (failures) { console.error(`\n${failures} échec(s)`); process.exit(1); }
console.log(`\n✔ tous les contrôles sont passés — captures dans ${path.relative(root, outDir)}/`);
process.exit(0);
