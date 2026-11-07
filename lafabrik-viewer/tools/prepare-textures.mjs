// Prépare les textures web du fond à partir du PNG original sources/<id>/background.png (jamais modifié ni publié) :
//   background.webp      : pleine résolution (plafonnée à 4096 px), qualité 92 → ordinateurs
//   background-2048.webp : 2048 px de haut → smartphones / appareils modestes
// Vérifie aussi que les proportions du PNG correspondent au format déclaré (210×300 mm).
// Usage : npm run textures [-- produit]
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { prettyJson } from './lib/json.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const productsDir = path.join(root, 'public/products');
const only = process.argv[2];
const products = only ? [only] : (await readdir(productsDir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);

for (const id of products) {
  const dir = path.join(productsDir, id);
  const cfgPath = path.join(dir, 'config.json');
  if (!existsSync(cfgPath)) continue;
  const cfg = JSON.parse(await readFile(cfgPath, 'utf8'));
  // Le PNG original (fichier d'impression) reste dans sources/<id>/ : il n'est jamais publié.
  const original = cfg.background.original ?? 'background.png';
  const src = path.join(root, 'sources', id, original);
  const meta = await sharp(src).metadata();
  const ratioImg = meta.width / meta.height;
  const ratioMm = cfg.background.widthMm / cfg.background.heightMm;
  const diff = Math.abs(ratioImg / ratioMm - 1) * 100;
  const dpi = (meta.width / cfg.background.widthMm) * 25.4;
  console.log(`${id} : sources/${id}/${original} ${meta.width}×${meta.height} px, ${meta.space}, ~${dpi.toFixed(0)} dpi`);
  if (diff > 0.5) console.warn(`  ⚠ proportions du PNG (${ratioImg.toFixed(4)}) ≠ format déclaré ${cfg.background.widthMm}×${cfg.background.heightMm} mm (${ratioMm.toFixed(4)}) : écart ${diff.toFixed(2)} %. Le fond serait déformé : corriger widthMm/heightMm dans config.json.`);

  const outputs = { high: ['background.webp', Math.min(meta.height, 4096)], low: ['background-2048.webp', Math.min(meta.height, 2048)] };
  cfg.background.variants = {};
  for (const [tier, [name, h]] of Object.entries(outputs)) {
    await sharp(src).resize({ height: h, kernel: 'lanczos3' }).toColorspace('srgb')
      .webp({ quality: 92, smartSubsample: true, effort: 6 }).toFile(path.join(dir, name));
    const s = (await stat(path.join(dir, name))).size;
    cfg.background.variants[tier] = name;
    console.log(`  ✔ ${name} (${h} px de haut, ${(s / 1024).toFixed(0)} Ko)`);
  }
  cfg.background.original = original;
  cfg.background.src = 'background.webp';
  cfg.background.pixels = [meta.width, meta.height];
  await writeFile(cfgPath, prettyJson(cfg));
}
