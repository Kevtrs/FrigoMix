// Importe les pièces imprimées (3MF Bambu Studio et/ou STL) d'un produit et produit :
//   public/products/<produit>/relief.glb   (une node par pièce, une primitive par filament, en mm)
//   public/products/<produit>/config.json  (fusion non destructive : les réglages déjà faits
//                                            dans le mode édition sont conservés)
//
// Usage :
//   npm run import -- <produit>                       → lit sources/<produit>/import.json
//   npm run import -- <produit> fichier.3mf [b.stl]   → chaque STL devient une pièce
// Options : --simplify 0.5 (garde 50 % des triangles)  --no-compress  --reset-positions
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { toCreasedNormals, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { simplify, weld } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { read3MF, partToGeometries } from './lib/threemf.mjs';
import { threeToDocument, optimizeAndWrite } from './lib/gltf.mjs';
import { rodalmMetrics } from '../src/core/rodalm.js';
import { prettyJson } from './lib/json.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const bool = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const simplifyRatio = flag('--simplify');
const noCompress = bool('--no-compress');
const resetPositions = bool('--reset-positions');
const product = args.shift();
if (!product) {
  console.error('Usage : npm run import -- <produit> [fichiers .3mf/.stl…] [--simplify 0.5] [--reset-positions]');
  process.exit(1);
}
const productDir = path.join(root, 'public/products', product);
const srcDir = path.join(root, 'sources', product);
await mkdir(productDir, { recursive: true });

// ------------------------------------------------------------------ sources
let sources = args.map((f) => ({ file: f }));
if (!sources.length) {
  const manifest = path.join(srcDir, 'import.json');
  if (!existsSync(manifest)) {
    console.error(`Aucun fichier indiqué et ${path.relative(root, manifest)} absent.`);
    process.exit(1);
  }
  sources = JSON.parse(await readFile(manifest, 'utf8')).sources;
}
const resolveSrc = (f) => (path.isAbsolute(f) ? f : existsSync(path.join(srcDir, f)) ? path.join(srcDir, f) : path.resolve(f));

const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'piece';
const pieces = new Map(); // id -> { id, name, meshes: [{ name, filament, color, geometry }] }
const palette = new Map(); // filament -> { color, type }
const warnings = [];
let application = null;

function pieceFor(name, wantedId) {
  let id = wantedId ?? slug(name);
  if (!wantedId) { let n = 2; const base = id; while (pieces.has(id)) id = `${base}-${n++}`; }
  if (!pieces.has(id)) pieces.set(id, { id, name, meshes: [] });
  return pieces.get(id);
}

for (const src of sources) {
  const file = resolveSrc(src.file);
  const ext = path.extname(file).toLowerCase();
  const data = new Uint8Array(await readFile(file));
  if (ext === '.3mf') {
    const r = read3MF(data);
    application = r.application ?? application;
    warnings.push(...r.warnings.map((w) => `${path.basename(file)} : ${w}`));
    for (const f of r.filaments) if (!palette.has(f.index)) palette.set(f.index, { color: f.color.slice(0, 7), type: f.type });
    for (const p of r.pieces) {
      const piece = pieceFor(p.name, src.pieces?.[p.name]);
      for (const part of p.parts) {
        for (const g of partToGeometries(part)) {
          piece.meshes.push({ name: part.name, filament: g.filament, color: g.color, geometry: g.geometry });
        }
      }
    }
    console.log(`• ${path.basename(file)} (${r.application ?? '3MF'}) : ${r.pieces.length} objet(s), ${r.filaments.length} filament(s)`);
  } else if (ext === '.stl') {
    const geometry = new STLLoader().parse(data.buffer);
    geometry.deleteAttribute('normal');
    const name = src.piece ?? path.basename(file, ext);
    const piece = pieceFor(name, src.piece ? slug(src.piece) : undefined);
    piece.meshes.push({ name: src.part ?? path.basename(file, ext), filament: src.filament ?? 1, color: src.color ?? null, geometry: mergeVertices(geometry, 1e-4) });
    console.log(`• ${path.basename(file)} : STL → pièce « ${piece.id} » (filament ${src.filament ?? 1})`);
  } else {
    throw new Error(`Format non pris en charge : ${file}`);
  }
}
if (!pieces.size) { console.error('Aucune pièce trouvée.'); process.exit(1); }

// ------------------------------------------------------------- normalisation
// Les coordonnées plateau ne sont pas celles du cadre : chaque pièce est recentrée
// (centre XY = 0, base Z = 0). La disposition relative sur le plateau sert de
// position initiale, centrée sur le cadre.
const allBox = new THREE.Box3();
for (const piece of pieces.values()) {
  piece.box = new THREE.Box3();
  for (const m of piece.meshes) { m.geometry.computeBoundingBox(); piece.box.union(m.geometry.boundingBox); }
  allBox.union(piece.box);
}
const allCenter = allBox.getCenter(new THREE.Vector3());

const group = new THREE.Group();
group.name = 'relief';
const fallbackColors = ['#d2001f', '#f4f4f2', '#111111', '#1f4fd1', '#f2c200'];
const materials = new Map();
const matFor = (m) => {
  const key = m.color ? `c${m.color}` : `f${m.filament}`;
  if (!materials.has(key)) {
    const col = m.color ?? palette.get(m.filament)?.color ?? fallbackColors[(m.filament - 1) % fallbackColors.length];
    const mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(col.slice(0, 7)), roughness: 0.6 });
    mat.name = m.color ? `color_${m.color.replace('#', '')}` : `filament_${m.filament}`;
    materials.set(key, mat);
  }
  return materials.get(key);
};

const summary = [];
for (const piece of pieces.values()) {
  const c = piece.box.getCenter(new THREE.Vector3());
  const node = new THREE.Group();
  node.name = piece.id;
  let tris = 0;
  for (const m of piece.meshes) {
    m.geometry.translate(-c.x, -c.y, -piece.box.min.z);
    const g = toCreasedNormals(m.geometry, THREE.MathUtils.degToRad(30));
    tris += g.attributes.position.count / 3;
    const mesh = new THREE.Mesh(g, matFor(m));
    mesh.name = `${piece.id}__${slug(m.name)}__${m.color ? 'c' : 'f'}${m.color ?? m.filament}`;
    node.add(mesh);
  }
  const size = piece.box.getSize(new THREE.Vector3());
  piece.summary = {
    id: piece.id,
    name: piece.name,
    sizeMm: size.toArray().map((v) => +v.toFixed(2)),
    plateOffsetMm: [+(c.x - allCenter.x).toFixed(2), +(c.y - allCenter.y).toFixed(2)],
    parts: piece.meshes.map((m) => ({ name: m.name, filament: m.filament, color: m.color ?? undefined })),
    triangles: Math.round(tris),
  };
  summary.push(piece.summary);
  group.add(node);
}

// --------------------------------------------------------------- écriture GLB
const doc = threeToDocument(group, { extras: { lafabrik: { product, generated: new Date().toISOString() } } });
if (simplifyRatio) {
  await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: Number(simplifyRatio), error: 0.0005 }));
}
const glbPath = path.join(productDir, 'relief.glb');
await optimizeAndWrite(doc, glbPath, { compress: !noCompress });
const glbSize = (await stat(glbPath)).size;

// ----------------------------------------------------------- fusion config.json
const cfgPath = path.join(productDir, 'config.json');
const cfg = existsSync(cfgPath) ? JSON.parse(await readFile(cfgPath, 'utf8')) : { id: product, name: product };
cfg.relief ??= {};
cfg.relief.src = 'relief.glb';
const previous = new Map((cfg.relief.pieces ?? []).map((p) => [p.id, p]));
cfg.filaments ??= {};
for (const [idx, f] of palette) {
  const k = String(idx);
  cfg.filaments[k] = { finish: 'matte', ...cfg.filaments[k], color: cfg.filaments[k]?.colorLocked ? cfg.filaments[k].color : f.color, type: f.type ?? cfg.filaments[k]?.type };
}
for (const p of summary) for (const part of p.parts) {
  if (part.filament && !cfg.filaments[String(part.filament)]) cfg.filaments[String(part.filament)] = { color: fallbackColors[(part.filament - 1) % fallbackColors.length], finish: 'matte' };
}
cfg.relief.pieces = summary.map((s) => {
  const prev = previous.get(s.id);
  const keep = prev && !resetPositions;
  return {
    id: s.id,
    name: prev?.name ?? s.name,
    positionMm: keep ? prev.positionMm : [s.plateOffsetMm[0], s.plateOffsetMm[1], 0],
    rotationDeg: keep ? prev.rotationDeg : [0, 0, 0],
    scale: keep ? prev.scale : [1, 1, 1],
    visible: prev?.visible ?? true,
    ...(prev?.material ? { material: prev.material } : {}),
    sizeMm: s.sizeMm,
    parts: s.parts,
  };
});
for (const id of previous.keys()) if (!pieces.has(id)) warnings.push(`la pièce « ${id} » n'existe plus dans les sources : retirée de config.json`);
cfg.source = { files: sources.map((s) => path.basename(s.file)), application, importedAt: new Date().toISOString() };
await writeFile(cfgPath, prettyJson(cfg));

// ----------------------------------------------------------------- contrôles
const preset = JSON.parse(await readFile(path.join(root, 'public/shared/rodalm.json'), 'utf8'));
const metrics = rodalmMetrics(preset);
console.log(`\n✔ ${path.relative(root, glbPath)} — ${(glbSize / 1024).toFixed(1)} Ko`);
for (const s of summary) {
  const piece = cfg.relief.pieces.find((p) => p.id === s.id);
  const top = s.sizeMm[2] * (piece.scale?.[2] ?? 1) + (piece.positionMm?.[2] ?? 0);
  const glassOn = cfg.glass?.enabled !== false;
  const flagTxt = glassOn && top > metrics.reliefClearance ? `  ⚠ dépasse la protection (${metrics.reliefClearance.toFixed(1)} mm dispo)` : '';
  console.log(`  ${s.id.padEnd(22)} ${s.sizeMm.join(' × ')} mm  ${String(s.triangles).padStart(7)} tri  filaments ${[...new Set(s.parts.map((p) => p.filament ?? p.color))].join(',')}${flagTxt}`);
}
if (warnings.length) console.log('\nAvertissements :\n' + warnings.map((w) => '  - ' + w).join('\n'));
console.log(`\n✔ ${path.relative(root, cfgPath)} mis à jour (positions conservées${resetPositions ? ' : NON, --reset-positions' : ''})`);
