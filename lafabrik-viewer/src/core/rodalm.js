/**
 * Générateur paramétrique du cadre IKEA RÖDALM.
 *
 * Modèle 100 % original, construit à partir de cotes (aucune géométrie IKEA
 * n'est réutilisée). Le même code sert :
 *   - côté Node (tools/build-frame.mjs) pour produire public/shared/rodalm.glb ;
 *   - côté navigateur en secours si le GLB ne peut pas être chargé.
 *
 * Repère (millimètres) :
 *   origine = centre de la surface du papier imprimé (fond PNG)
 *   X → droite, Y → haut, Z → vers le spectateur.
 */
import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Calcule toutes les cotes dérivées du preset. */
export function rodalmMetrics(p) {
  const W = p.outer.width;
  const H = p.outer.height;
  const D = p.outer.depth;
  const clear = p.rebate?.clearance ?? 1;
  // Largeur de feuillure (distance bord extérieur → bord de la feuillure).
  // Identique sur les 4 côtés pour garantir des onglets à 45°.
  const rebateD = Math.min((W - p.paper.width - 2 * clear) / 2, (H - p.paper.height - 2 * clear) / 2);
  const face = p.faceWidth;
  const backZ0 = p.back.insetFromRear; // face arrière du panneau
  const backZ1 = backZ0 + p.back.thickness; // face avant du panneau = papier
  const paperZ = backZ1 + 0.2; // épaisseur du papier
  const glassFront = D - p.glass.recessFromFront;
  const glassBack = glassFront - p.glass.thickness;
  return {
    W, H, D, clear, rebateD, face,
    opening: { width: W - 2 * face, height: H - 2 * face },
    // Toutes les cotes ci-dessous sont exprimées dans le repère final (papier = 0).
    z: {
      rear: -paperZ,
      backRear: backZ0 - paperZ,
      paper: 0,
      glassBack: glassBack - paperZ,
      glassFront: glassFront - paperZ,
      front: D - paperZ,
    },
    reliefClearance: glassBack - paperZ,
    _raw: { backZ0, backZ1, paperZ, glassFront, glassBack },
  };
}

function roundedCorner(cx, cz, r, a0, a1, steps) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
  }
  return pts;
}

/** Profil (d, z) : d = distance vers l'intérieur depuis le bord extérieur, z depuis l'arrière. */
function frameProfile(m, p) {
  const r = p.edgeRadius ?? 0.8;
  const { D, face, rebateD } = m;
  const zr = m._raw.paperZ; // la feuillure s'arrête au niveau du papier
  const pts = [];
  pts.push([0, 0]);
  // arête extérieure avant arrondie
  pts.push(...roundedCorner(r, D - r, r, Math.PI, Math.PI / 2, 4));
  // arête intérieure avant arrondie
  pts.push(...roundedCorner(face - r, D - r, r, Math.PI / 2, 0, 4));
  pts.push([face, zr]);
  pts.push([rebateD, zr]);
  pts.push([rebateD, 0]);
  return pts; // polygone orienté dans le sens horaire en (d,z) → on gère l'orientation à la volée
}

function polygonArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/**
 * Construit une traverse avec coupes d'onglet à 45°.
 * O : centre du bord extérieur, a : direction le long de la traverse,
 * n : direction vers l'intérieur, L : demi-longueur extérieure.
 */
function buildRail(profile, O, a, n, L, gap, zShift) {
  const pos = [];
  const Z = new THREE.Vector3(0, 0, 1);
  const P = (d, z, s) =>
    new THREE.Vector3()
      .copy(O)
      .addScaledVector(n, d)
      .addScaledVector(a, s * (L - d - gap / 2))
      .addScaledVector(Z, z + zShift);
  const tri = (A, B, C, expected) => {
    const nrm = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(C, A));
    if (nrm.dot(expected) < 0) [B, C] = [C, B];
    pos.push(A.x, A.y, A.z, B.x, B.y, B.z, C.x, C.y, C.z);
  };
  const ccw = polygonArea(profile) > 0;
  for (let i = 0; i < profile.length; i++) {
    const [d1, z1] = profile[i];
    const [d2, z2] = profile[(i + 1) % profile.length];
    if (Math.hypot(d2 - d1, z2 - z1) < 1e-6) continue;
    // normale sortante dans le plan (d,z)
    let nd = z2 - z1;
    let nz = -(d2 - d1);
    if (!ccw) { nd = -nd; nz = -nz; }
    const expected = new THREE.Vector3().addScaledVector(n, nd).addScaledVector(Z, nz);
    const A = P(d1, z1, -1), B = P(d1, z1, 1), C = P(d2, z2, 1), Dd = P(d2, z2, -1);
    tri(A, B, C, expected);
    tri(A, C, Dd, expected);
  }
  // faces d'onglet
  const contour = profile.map(([d, z]) => new THREE.Vector2(d, z));
  const tris = THREE.ShapeUtils.triangulateShape(contour, []);
  for (const s of [-1, 1]) {
    const expected = a.clone().multiplyScalar(s).add(n.clone().multiplyScalar(-s * 0)).normalize();
    // la normale d'une face d'onglet est inclinée (a ± n) ; on vérifie seulement le signe sur a.
    for (const [i, j, k] of tris) {
      tri(P(...profile[i], s), P(...profile[j], s), P(...profile[k], s), expected);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return toCreasedNormals(g, THREE.MathUtils.degToRad(35));
}

function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

export function createRodalmMaterials(p) {
  return {
    frame: new THREE.MeshStandardMaterial({
      name: 'rodalm_frame',
      color: new THREE.Color(p.material.color),
      roughness: p.material.roughness,
      metalness: p.material.metalness ?? 0,
    }),
    back: new THREE.MeshStandardMaterial({
      name: 'rodalm_back',
      color: new THREE.Color(p.back.color),
      roughness: p.back.roughness ?? 0.85,
    }),
    metal: new THREE.MeshStandardMaterial({
      name: 'rodalm_metal',
      color: new THREE.Color('#9a9da1'),
      roughness: 0.35,
      metalness: 1.0,
    }),
    glass: new THREE.MeshStandardMaterial({
      name: 'rodalm_glass',
      color: new THREE.Color('#ffffff'),
      roughness: 0.04,
      metalness: 0,
      transparent: true,
      opacity: p.glass.opacity ?? 0.06,
    }),
  };
}

/**
 * @param {object} p preset (public/shared/rodalm.json)
 * @param {object} [mats] matériaux (créés si absents)
 * @returns {{ group: THREE.Group, metrics: object }}
 */
export function buildRodalm(p, mats = createRodalmMaterials(p)) {
  const m = rodalmMetrics(p);
  const zShift = -m._raw.paperZ;
  const group = new THREE.Group();
  group.name = 'rodalm';

  const profile = frameProfile(m, p);
  const gap = p.miterGap ?? 0.12;
  const hw = m.W / 2, hh = m.H / 2;
  const rails = [
    ['frame_top', new THREE.Vector3(0, hh, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, -1, 0), hw],
    ['frame_bottom', new THREE.Vector3(0, -hh, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), hw],
    ['frame_left', new THREE.Vector3(-hw, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0), hh],
    ['frame_right', new THREE.Vector3(hw, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(-1, 0, 0), hh],
  ];
  for (const [name, O, a, n, L] of rails) {
    const mesh = new THREE.Mesh(buildRail(profile, O, a, n, L, gap, zShift), mats.frame);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // Panneau arrière (fond en fibres), logé dans la feuillure.
  const bw = p.paper.width + 2 * m.clear - 0.4;
  const bh = p.paper.height + 2 * m.clear - 0.4;
  // Boîte simple (sans arrondis) : aucune jonction en T, donc aucune micro-fissure après compression.
  const backGeo = new THREE.BoxGeometry(bw, bh, p.back.thickness);
  backGeo.translate(0, 0, m.z.backRear + p.back.thickness / 2);
  const back = new THREE.Mesh(backGeo, mats.back);
  back.name = 'back_panel';
  back.receiveShadow = true;
  back.castShadow = true;
  group.add(back);

  // Pattes de fixation pivotantes (maintiennent le panneau arrière).
  const tabGeo = new THREE.ExtrudeGeometry(roundedRectShape(14, 6, 2.2), { depth: 0.6, bevelEnabled: false, curveSegments: 4 });
  const tabZ = m.z.backRear - 0.6;
  const tabs = [
    [-bw / 4, bh / 2, 0], [bw / 4, bh / 2, 0],
    [-bw / 4, -bh / 2, 0], [bw / 4, -bh / 2, 0],
    [-bw / 2, 0, Math.PI / 2], [bw / 2, 0, Math.PI / 2],
  ].slice(0, p.hardware?.turnTabs ?? 6);
  tabs.forEach(([x, y, rot], i) => {
    const t = new THREE.Mesh(tabGeo, mats.metal);
    t.name = `tab_${i + 1}`;
    t.rotation.z = rot;
    // la patte chevauche le bord du panneau d'environ 3 mm
    const inward = new THREE.Vector2(x, y).normalize().multiplyScalar(-1.5);
    t.position.set(x + inward.x, y + inward.y, tabZ);
    t.castShadow = true;
    group.add(t);
  });

  // Attaches murales (crochets dentelés) — portrait et paysage.
  const hangerGeo = new THREE.ExtrudeGeometry(roundedRectShape(34, 7, 1.5), { depth: 0.8, bevelEnabled: false, curveSegments: 3 });
  (p.hardware?.hangers ?? []).forEach((h, i) => {
    const mesh = new THREE.Mesh(hangerGeo, mats.metal);
    mesh.name = `hanger_${h.orientation}`;
    if (h.orientation === 'landscape') {
      mesh.rotation.z = Math.PI / 2;
      mesh.position.set(h.x ?? bw / 2 - 20, 0, m.z.backRear - 0.8);
    } else {
      mesh.position.set(0, h.y ?? bh / 2 - 25, m.z.backRear - 0.8);
    }
    mesh.castShadow = true;
    group.add(mesh);
  });

  // Protection frontale (PET) — ses bords sont noyés dans la moulure.
  const gw = m.W - 2 * (m.face - 0.8);
  const gh = m.H - 2 * (m.face - 0.8);
  const glassGeo = new THREE.BoxGeometry(gw, gh, p.glass.thickness);
  glassGeo.translate(0, 0, (m.z.glassFront + m.z.glassBack) / 2);
  const glass = new THREE.Mesh(glassGeo, mats.glass);
  glass.name = 'glass';
  glass.renderOrder = 10;
  group.add(glass);

  group.userData.rodalm = {
    preset: p.id,
    metrics: {
      outer: { width: m.W, height: m.H, depth: m.D },
      opening: m.opening,
      paper: p.paper,
      z: m.z,
      reliefClearance: m.reliefClearance,
    },
  };
  return { group, metrics: m };
}
