// Crée un nouveau produit à partir du cadre RÖDALM commun.
// Usage :
//   npm run new-product -- <id> "<Nom affiché>" <fond.png> [pièces.3mf | pièces.stl …]
// Exemple :
//   npm run new-product -- senna "Ayrton Senna — McLaren MP4/4" ~/LaFabrik/senna/fond.png ~/LaFabrik/senna/senna.3mf
// Étapes enchaînées : dossier + config.json → textures WebP → import du relief → aperçu poster.webp
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prettyJson } from './lib/json.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [id, name, png, ...sources] = process.argv.slice(2);
if (!id || !name || !png || !/^[a-z0-9-]+$/.test(id)) {
  console.error('Usage : npm run new-product -- <id-en-minuscules> "<Nom>" <fond.png> [sources 3MF/STL…]');
  process.exit(1);
}
const dir = path.join(root, 'public/products', id);
const srcDir = path.join(root, 'sources', id);
if (existsSync(path.join(dir, 'config.json'))) { console.error(`Le produit « ${id} » existe déjà.`); process.exit(1); }
await mkdir(dir, { recursive: true });
await mkdir(srcDir, { recursive: true });
await copyFile(png, path.join(srcDir, 'background.png')); // original conservé hors du dossier publié

const cfg = {
  id, name,
  frame: 'shared/rodalm.json',
  background: { src: 'background.webp', original: 'background.png', widthMm: 210, heightMm: 300, offsetMm: [0, 0], rotationDeg: 0 },
  filaments: {},
  relief: { src: 'relief.glb', pieces: [] },
  glass: { enabled: true, visibleByDefault: true },
  camera: { initial: { azimuthDeg: -22, elevationDeg: 8 }, fill: 0.84, minDistanceMm: 140, maxDistanceMm: 1500, autoRotate: false },
  photos: [],
  poster: 'poster.webp',
};
await writeFile(path.join(dir, 'config.json'), prettyJson(cfg));

const copied = [];
for (const s of sources) { const dst = path.join(srcDir, path.basename(s)); await copyFile(s, dst); copied.push({ file: path.basename(s) }); }
if (copied.length) await writeFile(path.join(srcDir, 'import.json'), JSON.stringify({ sources: copied }, null, 2) + '\n');

const indexPath = path.join(root, 'public/products/index.json');
const index = JSON.parse(await readFile(indexPath, 'utf8'));
index.products.push({ id, name });
await writeFile(indexPath, JSON.stringify(index, null, 2) + '\n');

const run = (script, ...a) => execFileSync(process.execPath, [path.join(root, 'tools', script), ...a], { stdio: 'inherit', cwd: root });
run('prepare-textures.mjs', id);
if (copied.length) run('import-relief.mjs', id);
else console.log('ℹ Aucune pièce fournie : ajoutez-les plus tard avec  npm run import -- ' + id + ' fichier.3mf');
run('posters.mjs', id);
console.log(`\n✔ Produit « ${id} » créé. Ouvrez  http://localhost:5173/editor.html?product=${id}  pour placer les pièces.`);
