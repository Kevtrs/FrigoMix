// Lecture des projets 3MF (Bambu Studio / OrcaSlicer / PrusaSlicer / 3MF standard).
//
// Récupère, en coordonnées « plateau » et en millimètres :
//   - les objets (pièces posables) et leurs sous-pièces (parts) avec la géométrie transformée ;
//   - le filament (extrudeur AMS) de chaque part ;
//   - la palette des filaments (couleur, type) ;
//   - les triangles peints multi-couleurs (paint_color / mmu_segmentation), ramenés au
//     filament majoritaire de chaque triangle.
import { unzipSync, strFromU8 } from 'fflate';
import * as THREE from 'three';

const UNIT_TO_MM = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };

function attrs(tag) {
  const out = {};
  const re = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(tag))) out[m[1]] = m[2];
  return out;
}

/** 3MF : "m00 m01 m02 m10 m11 m12 m20 m21 m22 m30 m31 m32" (convention vecteur-ligne). */
export function parseTransform(str) {
  const mat = new THREE.Matrix4();
  if (!str) return mat;
  const v = str.trim().split(/\s+/).map(Number);
  if (v.length !== 12 || v.some(Number.isNaN)) return mat;
  mat.set(v[0], v[3], v[6], v[9], v[1], v[4], v[7], v[10], v[2], v[5], v[8], v[11], 0, 0, 0, 1);
  return mat;
}

/**
 * Décode un état de peinture PrusaSlicer/Bambu (arbre de subdivision encodé en hexadécimal,
 * lu depuis la fin). Retourne { state: surface relative } pour chaque état feuille.
 */
export function decodePaint(hex) {
  const nibbles = [];
  for (let i = hex.length - 1; i >= 0; i--) nibbles.push(parseInt(hex[i], 16));
  let pos = 0;
  const areas = {};
  const next = () => (pos < nibbles.length ? nibbles[pos++] : 0);
  const walk = (area) => {
    const code = next();
    const split = code & 0b11;
    if (split === 0) {
      let state = code >> 2;
      if (state === 3) state = next() + 3;
      areas[state] = (areas[state] ?? 0) + area;
      return;
    }
    const children = split + 1;
    for (let c = 0; c < children; c++) walk(area / children);
  };
  if (nibbles.length) walk(1);
  return areas;
}

export function dominantPaintState(hex) {
  if (!hex) return 0;
  const areas = decodePaint(hex);
  let best = 0, bestA = -1;
  for (const [s, a] of Object.entries(areas)) if (a > bestA) { best = Number(s); bestA = a; }
  return best;
}

function parseModelXml(xml) {
  const unit = attrs(xml.match(/<model\b[^>]*>/)?.[0] ?? '').unit ?? 'millimeter';
  const objects = new Map();
  const materials = new Map(); // id -> [hex colors]
  // basematerials & colorgroup
  for (const m of xml.matchAll(/<(?:\w+:)?basematerials\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?basematerials>/g)) {
    const id = attrs(m[1]).id;
    materials.set(id, [...m[2].matchAll(/<(?:\w+:)?base\b([^>]*)\/?>/g)].map((b) => attrs(b[1]).displaycolor));
  }
  for (const m of xml.matchAll(/<(?:\w+:)?colorgroup\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?colorgroup>/g)) {
    const id = attrs(m[1]).id;
    materials.set(id, [...m[2].matchAll(/<(?:\w+:)?color\b([^>]*)\/?>/g)].map((b) => attrs(b[1]).color));
  }
  for (const m of xml.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)) {
    const a = attrs(m[1]);
    const body = m[2];
    const obj = { id: a.id, name: a.name, type: a.type ?? 'model', pid: a.pid, pindex: a.pindex, mesh: null, components: [] };
    const meshM = body.match(/<mesh>([\s\S]*?)<\/mesh>/);
    if (meshM) {
      const vSrc = meshM[1].match(/<vertices>([\s\S]*?)<\/vertices>/)?.[1] ?? '';
      const verts = [];
      for (const v of vSrc.matchAll(/<vertex\b([^>]*)\/>/g)) {
        const va = attrs(v[1]);
        verts.push(+va.x, +va.y, +va.z);
      }
      const tSrc = meshM[1].match(/<triangles>([\s\S]*?)<\/triangles>/)?.[1] ?? '';
      const idx = [];
      const paint = [];
      const triColor = [];
      let anyPaint = false, anyColor = false;
      for (const t of tSrc.matchAll(/<triangle\b([^>]*)\/>/g)) {
        const ta = attrs(t[1]);
        idx.push(+ta.v1, +ta.v2, +ta.v3);
        const pc = ta.paint_color ?? ta['slic3rpe:mmu_segmentation'];
        if (pc) anyPaint = true;
        paint.push(pc ?? null);
        const pid = ta.pid ?? a.pid;
        const p1 = ta.p1 ?? a.pindex;
        if (pid != null && p1 != null && materials.has(pid)) { anyColor = true; triColor.push(materials.get(pid)[+p1] ?? null); }
        else triColor.push(null);
      }
      obj.mesh = { vertices: new Float32Array(verts), indices: new Uint32Array(idx), paint: anyPaint ? paint : null, triColor: anyColor ? triColor : null };
    }
    for (const c of body.matchAll(/<component\b([^>]*)\/>/g)) {
      const ca = attrs(c[1]);
      obj.components.push({ objectid: ca.objectid, path: ca['p:path'] ?? ca.path ?? null, transform: parseTransform(ca.transform) });
    }
    objects.set(a.id, obj);
  }
  const items = [...xml.matchAll(/<item\b([^>]*)\/>/g)].map((it) => {
    const ia = attrs(it[1]);
    return { objectid: ia.objectid, path: ia['p:path'] ?? null, transform: parseTransform(ia.transform), printable: ia.printable !== '0' };
  });
  return { unit, scale: UNIT_TO_MM[unit] ?? 1, objects, items };
}

function parseBambuSettings(files) {
  const settings = { objects: new Map(), filaments: [] };
  const ms = files['Metadata/model_settings.config'] ?? files['Metadata/Slic3r_PE_model.config'];
  if (ms) {
    const xml = strFromU8(ms);
    for (const o of xml.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)) {
      const oa = attrs(o[1]);
      const meta = (src) => Object.fromEntries([...src.matchAll(/<metadata\b([^>]*)\/>/g)].map((x) => { const a = attrs(x[1]); return [a.key, a.value]; }));
      const body = o[2];
      const parts = new Map();
      for (const p of body.matchAll(/<(part|volume)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
        const pa = attrs(p[2]);
        const md = meta(p[3]);
        parts.set(pa.id ?? String(parts.size), { subtype: pa.subtype ?? md.volume_type ?? 'normal_part', name: md.name, extruder: md.extruder ? +md.extruder : null, firstid: pa.firstid, lastid: pa.lastid });
      }
      const objMeta = meta(body.replace(/<(part|volume)\b[\s\S]*?<\/\1>/g, ''));
      settings.objects.set(oa.id, { name: objMeta.name, extruder: objMeta.extruder ? +objMeta.extruder : 1, parts });
    }
  }
  const ps = files['Metadata/project_settings.config'];
  if (ps) {
    try {
      const j = JSON.parse(strFromU8(ps));
      const colours = j.filament_colour ?? [];
      settings.filaments = colours.map((c, i) => ({ index: i + 1, color: c, type: j.filament_type?.[i] ?? null, profile: j.filament_settings_id?.[i] ?? null }));
    } catch { /* fichier non JSON (anciennes versions) : ignoré */ }
  }
  return settings;
}

/**
 * @param {Uint8Array} data contenu du fichier .3mf
 * @returns {{ pieces: Array, filaments: Array, warnings: string[], application: string|null }}
 */
export function read3MF(data) {
  const files = unzipSync(data);
  const warnings = [];
  const relsRaw = files['_rels/.rels'] ? strFromU8(files['_rels/.rels']) : '';
  let rootPath = relsRaw.match(/Target="\/?([^"]+\.model)"/)?.[1] ?? '3D/3dmodel.model';
  if (!files[rootPath]) rootPath = Object.keys(files).find((f) => f.endsWith('.model'));
  if (!rootPath) throw new Error('Aucun fichier .model dans le 3MF');

  const models = new Map();
  const getModel = (p) => {
    const key = p.replace(/^\//, '');
    if (!models.has(key)) {
      if (!files[key]) throw new Error(`Fichier référencé introuvable dans le 3MF : ${key}`);
      models.set(key, parseModelXml(strFromU8(files[key])));
    }
    return models.get(key);
  };
  const root = getModel(rootPath);
  const application = strFromU8(files[rootPath]).match(/<metadata name="Application">([^<]*)</)?.[1] ?? null;
  const settings = parseBambuSettings(files);

  const pieces = [];
  for (const item of root.items) {
    if (!item.printable) warnings.push(`objet ${item.objectid} marqué non imprimable : importé quand même`);
    const obj = root.objects.get(item.objectid);
    if (!obj) { warnings.push(`objet ${item.objectid} introuvable`); continue; }
    const objSettings = settings.objects.get(obj.id) ?? { name: obj.name, extruder: 1, parts: new Map() };
    const piece = { sourceId: obj.id, name: objSettings.name ?? obj.name ?? `objet_${obj.id}`, parts: [] };
    const scaleM = new THREE.Matrix4().makeScale(root.scale, root.scale, root.scale);

    const collect = (o, model, modelPath, matrix, partSettings) => {
      if (o.mesh) {
        const ps = partSettings ?? objSettings.parts.get(o.id) ?? null;
        if (ps && ps.subtype && ps.subtype !== 'normal_part' && ps.subtype !== 'ModelPart') {
          warnings.push(`part « ${ps.name ?? o.id} » ignorée (type ${ps.subtype})`);
          return;
        }
        piece.parts.push({
          name: ps?.name ?? o.name ?? `part_${o.id}`,
          filament: ps?.extruder ?? objSettings.extruder ?? 1,
          mesh: o.mesh,
          matrix: matrix.clone(),
          unitScale: model.scale,
        });
      }
      for (const c of o.components) {
        const subModel = c.path ? getModel(c.path) : model;
        const sub = subModel.objects.get(c.objectid);
        if (!sub) { warnings.push(`composant ${c.objectid} introuvable`); continue; }
        // Bambu : l'id de part dans model_settings = objectid du composant
        const ps = objSettings.parts.get(c.objectid) ?? null;
        collect(sub, subModel, c.path ?? modelPath, matrix.clone().multiply(c.transform), ps);
      }
    };
    collect(obj, root, rootPath, scaleM.clone().multiply(item.transform), null);
    if (piece.parts.length) pieces.push(piece);
  }
  return { pieces, filaments: settings.filaments, warnings, application };
}

/** Applique matrices + peinture et retourne des géométries Three par filament. */
export function partToGeometries(part) {
  const { vertices, indices, paint, triColor } = part.mesh;
  const pos = new THREE.BufferAttribute(vertices.slice(), 3);
  const tmp = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    tmp.fromBufferAttribute(pos, i).applyMatrix4(part.matrix);
    pos.setXYZ(i, tmp.x, tmp.y, tmp.z);
  }
  // Inverse l'ordre si la matrice inverse l'orientation (miroir).
  const flip = part.matrix.determinant() < 0;
  const groups = new Map(); // filament -> indices
  const colors = new Map(); // filament key -> couleur explicite (3MF matériaux)
  for (let t = 0; t < indices.length / 3; t++) {
    let fil = part.filament;
    if (paint && paint[t]) { const s = dominantPaintState(paint[t]); if (s > 0) fil = s; }
    let key = String(fil);
    if (triColor && triColor[t]) { key = `c${triColor[t]}`; colors.set(key, triColor[t]); }
    if (!groups.has(key)) groups.set(key, []);
    const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2];
    groups.get(key).push(a, flip ? c : b, flip ? b : c);
  }
  const out = [];
  for (const [key, idx] of groups) {
    // compacte les sommets utilisés par ce filament
    const remap = new Map();
    const p = [];
    const ni = new Uint32Array(idx.length);
    for (let i = 0; i < idx.length; i++) {
      let r = remap.get(idx[i]);
      if (r === undefined) {
        r = remap.size;
        remap.set(idx[i], r);
        p.push(pos.getX(idx[i]), pos.getY(idx[i]), pos.getZ(idx[i]));
      }
      ni[i] = r;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setIndex(new THREE.BufferAttribute(ni, 1));
    out.push({ key, filament: key.startsWith('c') ? null : Number(key), color: colors.get(key) ?? null, geometry: g });
  }
  return out;
}
