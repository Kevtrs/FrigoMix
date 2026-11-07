// Génère public/shared/rodalm.glb à partir du preset paramétrique public/shared/rodalm.json.
// Usage : npm run build:frame
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildRodalm } from '../src/core/rodalm.js';
import { threeToDocument, optimizeAndWrite } from './lib/gltf.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const presetPath = path.join(root, 'public/shared/rodalm.json');
const out = path.join(root, 'public/shared/rodalm.glb');

const preset = JSON.parse(await readFile(presetPath, 'utf8'));
const { group, metrics } = buildRodalm(preset);
let tris = 0;
group.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
const doc = threeToDocument(group, { extras: group.userData });
await optimizeAndWrite(doc, out);
const size = (await stat(out)).size;
console.log(`✔ ${path.relative(root, out)} — ${Math.round(tris)} triangles, ${(size / 1024).toFixed(1)} Ko`);
console.log(`  extérieur ${metrics.W}×${metrics.H}×${metrics.D} mm | ouverture visible ${metrics.opening.width}×${metrics.opening.height} mm`);
console.log(`  papier ${preset.paper.width}×${preset.paper.height} mm, enfoncé de ${metrics.z.front.toFixed(1)} mm sous la face avant`);
console.log(`  hauteur disponible pour les reliefs sous la protection : ${metrics.reliefClearance.toFixed(1)} mm`);
