// Conversion d'une scène Three.js (construite côté Node) en GLB optimisé via glTF-Transform.
import { Document, NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { weld, dedup, prune, meshopt, quantize } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

export async function createIO() {
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  return new NodeIO()
    .registerExtensions([EXTMeshoptCompression, KHRMeshQuantization])
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
}

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * @param {import('three').Object3D} root
 * @param {{ extras?: object }} [opts]
 */
export function threeToDocument(root, opts = {}) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene(root.name || 'scene');
  if (opts.extras) scene.setExtras(opts.extras);
  const matCache = new Map();

  const toMaterial = (m) => {
    if (matCache.has(m)) return matCache.get(m);
    // Les couleurs Three sont en linéaire en mémoire (ColorManagement) : on les écrit telles quelles.
    const c = m.color ?? { r: 1, g: 1, b: 1 };
    const mat = doc
      .createMaterial(m.name || 'material')
      .setBaseColorFactor([c.r, c.g, c.b, m.transparent ? m.opacity : 1])
      .setRoughnessFactor(m.roughness ?? 0.5)
      .setMetallicFactor(m.metalness ?? 0)
      .setDoubleSided(false);
    if (m.transparent) mat.setAlphaMode('BLEND');
    if (m.userData && Object.keys(m.userData).length) mat.setExtras(m.userData);
    matCache.set(m, mat);
    return mat;
  };

  const convert = (obj) => {
    const node = doc.createNode(obj.name || obj.type);
    node.setTranslation(obj.position.toArray());
    node.setRotation(obj.quaternion.toArray());
    node.setScale(obj.scale.toArray());
    if (obj.userData && Object.keys(obj.userData).length) node.setExtras(JSON.parse(JSON.stringify(obj.userData)));
    if (obj.isMesh) {
      const g = obj.geometry;
      const mesh = doc.createMesh(obj.name);
      const prim = doc.createPrimitive();
      const pos = g.getAttribute('position');
      prim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(pos.array)).setBuffer(buffer));
      const nrm = g.getAttribute('normal');
      if (nrm) prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nrm.array)).setBuffer(buffer));
      const uv = g.getAttribute('uv');
      if (uv) prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(uv.array)).setBuffer(buffer));
      if (g.index) {
        const Arr = pos.count > 65535 ? Uint32Array : Uint16Array;
        prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Arr(g.index.array)).setBuffer(buffer));
      }
      prim.setMaterial(toMaterial(obj.material));
      mesh.addPrimitive(prim);
      node.setMesh(mesh);
    }
    for (const child of obj.children) node.addChild(convert(child));
    return node;
  };

  scene.addChild(convert(root));
  return doc;
}

export async function optimizeAndWrite(doc, outPath, { compress = true } = {}) {
  const io = await createIO();
  await doc.transform(dedup(), weld(), prune());
  if (compress) {
    await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  }
  await io.write(outPath, doc);
}

export { srgbToLinear };
