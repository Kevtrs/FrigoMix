// Inspecte un GLB : hiérarchie, dimensions (mm), matériaux, textures, triangles.
// Usage : node tools/inspect-glb.mjs fichier.glb
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(process.argv[2]);
const root = doc.getRoot();
console.log('Asset :', JSON.stringify(root.getAsset()));
console.log('Extensions :', root.listExtensionsUsed().map((e) => e.extensionName).join(', ') || '—');
const mats = root.listMaterials();
console.log(`\nMatériaux (${mats.length}) :`);
for (const m of mats) console.log(`  ${m.getName()} — base ${m.getBaseColorFactor().map((v) => +v.toFixed(3))} rough ${m.getRoughnessFactor()} metal ${m.getMetallicFactor()} alpha ${m.getAlphaMode()} tex:${m.getBaseColorTexture() ? 'oui' : 'non'}`);
console.log(`\nTextures (${root.listTextures().length}) :`);
for (const t of root.listTextures()) console.log(`  ${t.getName()} ${t.getMimeType()} ${t.getSize()?.join('×')} ${(t.getImage().byteLength / 1024).toFixed(0)} Ko`);
let totalTris = 0;
const bbAll = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
function walk(node, depth, parentM) {
  const local = node.getMatrix();
  const M = mul(parentM, local);
  const mesh = node.getMesh();
  let line = `${'  '.repeat(depth)}${node.getName() || '(node)'}`;
  if (mesh) {
    for (const p of mesh.listPrimitives()) {
      const pos = p.getAttribute('POSITION');
      const idx = p.getIndices();
      const tris = (idx ? idx.getCount() : pos.getCount()) / 3;
      totalTris += tris;
      const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < pos.getCount(); i++) {
        const v = pos.getElement(i, []);
        const w = apply(M, v);
        for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], w[k]); mx[k] = Math.max(mx[k], w[k]); bbAll.min[k] = Math.min(bbAll.min[k], w[k]); bbAll.max[k] = Math.max(bbAll.max[k], w[k]); }
      }
      line += `  [${p.getMaterial()?.getName() ?? 'sans matériau'} · ${tris} tri · ${(mx[0]-mn[0]).toFixed(3)}×${(mx[1]-mn[1]).toFixed(3)}×${(mx[2]-mn[2]).toFixed(3)} · min(${mn.map(v=>v.toFixed(3))}) max(${mx.map(v=>v.toFixed(3))}) uv:${p.getAttribute('TEXCOORD_0') ? 'oui' : 'non'}]`;
    }
  }
  console.log(line);
  for (const c of node.listChildren()) walk(c, depth + 1, M);
}
const I = [1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
function mul(a, b) { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c*4+r] += a[k*4+r] * b[c*4+k]; return o; }
function apply(m, v) { return [m[0]*v[0]+m[4]*v[1]+m[8]*v[2]+m[12], m[1]*v[0]+m[5]*v[1]+m[9]*v[2]+m[13], m[2]*v[0]+m[6]*v[1]+m[10]*v[2]+m[14]]; }
console.log('\nHiérarchie :');
for (const s of root.listScenes()) for (const n of s.listChildren()) walk(n, 1, I);
const size = bbAll.max.map((v, i) => v - bbAll.min[i]);
console.log(`\nTotal : ${totalTris} triangles`);
console.log(`Boîte englobante (unités du fichier) : ${size.map((v) => v.toFixed(4)).join(' × ')}`);
console.log(`  min ${bbAll.min.map((v) => v.toFixed(4))}  max ${bbAll.max.map((v) => v.toFixed(4))}`);
