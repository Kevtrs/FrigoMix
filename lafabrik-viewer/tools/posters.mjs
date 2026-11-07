// Génère l'image d'aperçu (poster.webp, 1000×1250) de chaque produit en rendant la vraie scène 3D.
// Elle s'affiche instantanément avant le chargement de la 3D et sert de repli sans WebGL.
// Usage : npm run posters [-- produit]
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const only = process.argv[2];
const { products } = JSON.parse(await readFile(path.join(root, 'public/products/index.json'), 'utf8'));
const server = await (await createServer({ root, server: { port: 5177, host: '127.0.0.1' }, logLevel: 'error' })).listen();
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const p of products.filter((x) => !only || x.id === only)) {
  const page = await browser.newPage({ viewport: { width: 500, height: 625 }, deviceScaleFactor: 2 });
  await page.goto(`http://127.0.0.1:5177/index.html?product=${p.id}&quality=high`);
  await page.waitForFunction(() => window.__lafabrik?.ready, null, { timeout: 90000 });
  // Rendu hors interface : canvas dédié au format exact du poster
  const dataUrl = await page.evaluate(() => {
    const v = window.__lafabrik.viewer;
    const el = v.container;
    el.style.position = 'fixed'; el.style.left = '0'; el.style.top = '0'; el.style.width = '500px'; el.style.height = '625px';
    v.resize();
    v.goTo('initial', { duration: 0 });
    return v.snapshot('image/png');
  });
  const out = path.join(root, 'public/products', p.id, 'poster.webp');
  await sharp(Buffer.from(dataUrl.split(',')[1], 'base64')).resize(1000, 1250).webp({ quality: 86 }).toFile(out);
  console.log(`✔ ${path.relative(root, out)}`);
  await page.close();
}
await browser.close();
await server.close();
process.exit(0);
