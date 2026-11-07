// Mode édition : réglage précis (mm / degrés) des pièces, du fond, des filaments et de la caméra,
// avec enregistrement direct dans public/products/<id>/config.json (serveur de dev).
import * as THREE from 'three';
import GUI from 'lil-gui';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { LaFabrikViewer, FINISHES } from '../core/viewer.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const { products } = await (await fetch('products/index.json')).json();
const productId = params.get('product') ?? products[0].id;
const sel = $('#product');
for (const p of products) sel.add(new Option(p.name, p.id));
sel.value = productId;
sel.addEventListener('change', () => { if (!dirty || confirm('Modifications non enregistrées. Changer de produit ?')) location.search = `?product=${sel.value}`; });

const viewer = new LaFabrikViewer($('#stage'), { tier: 'high', editMode: true });
await viewer.load(`products/${productId}/config.json`);
window.__lafabrik = { viewer, ready: true, editor: true };
const cfg = viewer.config;
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
$('#st-load').textContent = `${cfg.name} — chargé en ${viewer.loadTimeMs} ms`;

// ------------------------------------------------------------------ historique
let dirty = false;
const history = [];
const snapshot = () => JSON.stringify(cfg);
let lastSnap = snapshot();
function commit() {
  const s = snapshot();
  if (s === lastSnap) return;
  history.push(lastSnap);
  if (history.length > 100) history.shift();
  lastSnap = s;
  dirty = true;
  $('#st-dirty').textContent = '● modifications non enregistrées';
  checkClearance();
}
function undo() {
  const prev = history.pop();
  if (!prev) return;
  const old = JSON.parse(prev);
  Object.assign(cfg.background, old.background);
  cfg.filaments = old.filaments;
  cfg.camera = old.camera;
  cfg.glass = old.glass;
  old.relief.pieces.forEach((p, i) => Object.assign(cfg.relief.pieces[i], p));
  lastSnap = prev;
  applyAll();
}
function applyAll() {
  viewer.applyBackground(cfg.background);
  cfg.relief.pieces.forEach((p) => viewer.applyPiece(p));
  viewer.setGlassVisible(cfg.glass?.enabled !== false);
  refreshGui();
  syncAttachment();
}

// --------------------------------------------------------------- contrôles 3D
const tc = new TransformControls(viewer.camera, viewer.renderer.domElement);
tc.setSpace('local');
tc.setSize(0.8);
const tcHelper = tc.getHelper ? tc.getHelper() : tc;
viewer.scene.add(tcHelper);
tc.addEventListener('dragging-changed', (e) => {
  viewer.controls.enabled = !e.value;
  if (!e.value) commit();
});
tc.addEventListener('change', () => viewer.requestRender());
tc.addEventListener('objectChange', () => {
  const pc = selected && cfg.relief.pieces.find((p) => p.id === selected);
  if (!pc) return;
  const o = tc.object;
  pc.positionMm = o.position.toArray().map((v) => round(v));
  pc.rotationDeg = [o.rotation.x, o.rotation.y, o.rotation.z].map((r) => round(THREE.MathUtils.radToDeg(r), 2));
  refreshGui();
  updateSelectionStatus();
});
function setMode(m) {
  tc.setMode(m);
  if (m === 'translate') { tc.showZ = true; tc.showX = tc.showY = true; }
  if (m === 'rotate') { tc.showX = tc.showY = false; tc.showZ = true; }
  $('#mode-t').classList.toggle('on', m === 'translate');
  $('#mode-r').classList.toggle('on', m === 'rotate');
  viewer.requestRender();
}
$('#mode-t').onclick = () => setMode('translate');
$('#mode-r').onclick = () => setMode('rotate');

let selected = null;
const boxHelper = new THREE.Box3Helper(new THREE.Box3(), 0x0058a3);
boxHelper.visible = false;
viewer.scene.add(boxHelper);
function select(id) {
  selected = id;
  const entry = id && viewer.pieces.get(id);
  if (entry) tc.attach(entry.object); else tc.detach();
  syncAttachment();
  for (const [pid, f] of pieceFolders) (pid === id ? f.open() : f.close());
  updateSelectionStatus();
  viewer.requestRender();
}
function syncAttachment() {
  const entry = selected && viewer.pieces.get(selected);
  boxHelper.visible = !!entry;
  if (entry) boxHelper.box.setFromObject(entry.object);
  viewer.requestRender();
}
function updateSelectionStatus() {
  const pc = selected && cfg.relief.pieces.find((p) => p.id === selected);
  $('#st-sel').textContent = pc ? `Sélection : ${pc.name} — X ${pc.positionMm[0]} · Y ${pc.positionMm[1]} · Z ${pc.positionMm[2]} mm · rot ${pc.rotationDeg[2]}°` : '';
  syncAttachment();
}

let down = null;
viewer.renderer.domElement.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
viewer.renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4 || tc.dragging) return;
  const id = viewer.pickPiece(e.clientX, e.clientY);
  if (id || !tc.axis) select(id);
});

// ------------------------------------------------------------------- clavier
window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, select, textarea')) return;
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); return; }
  if (e.key === 'Escape') return select(null);
  if (e.key === 'w') return setMode('translate');
  if (e.key === 'e') return setMode('rotate');
  const pc = selected && cfg.relief.pieces.find((p) => p.id === selected);
  if (!pc) return;
  const step = e.shiftKey ? 5 : e.altKey ? 0.1 : 0.5;
  const moves = { ArrowLeft: [0, -step], ArrowRight: [0, step], ArrowUp: [1, step], ArrowDown: [1, -step], PageUp: [2, step], PageDown: [2, -step] };
  if (moves[e.key]) {
    e.preventDefault();
    const [axis, d] = moves[e.key];
    pc.positionMm[axis] = round(pc.positionMm[axis] + d);
  } else if (e.key === 'q' || e.key === 'd') {
    pc.rotationDeg[2] = round(pc.rotationDeg[2] + (e.key === 'q' ? 1 : -1) * (e.shiftKey ? 15 : 1));
  } else return;
  viewer.applyPiece(pc);
  refreshGui();
  updateSelectionStatus();
  commit();
});

// ------------------------------------------------------------------ panneau
const gui = new GUI({ title: 'Réglages produit' });
const pieceFolders = new Map();
function refreshGui() { gui.controllersRecursive().forEach((c) => c.updateDisplay()); }

/** Expose un tableau [x,y,z] comme 3 propriétés éditables. */
function vecProxy(obj, key, labels) {
  const proxy = {};
  labels.forEach((l, i) => Object.defineProperty(proxy, l, { get: () => obj[key][i], set: (v) => { obj[key][i] = v; } }));
  return proxy;
}

// Pièces
const fPieces = gui.addFolder('Pièces imprimées 3D');
for (const pc of cfg.relief.pieces) {
  pc.positionMm ??= [0, 0, 0];
  pc.rotationDeg ??= [0, 0, 0];
  if (!Array.isArray(pc.scale)) pc.scale = [pc.scale ?? 1, pc.scale ?? 1, pc.scale ?? 1];
  const f = fPieces.addFolder(`${pc.name} (${pc.sizeMm?.map((v) => round(v, 1)).join('×') ?? '?'} mm)`);
  f.close();
  pieceFolders.set(pc.id, f);
  const apply = () => { viewer.applyPiece(pc); updateSelectionStatus(); };
  const pos = vecProxy(pc, 'positionMm', ['X (mm)', 'Y (mm)', 'Z profondeur (mm)']);
  f.add(pos, 'X (mm)', -120, 120, 0.1).onChange(apply).onFinishChange(commit);
  f.add(pos, 'Y (mm)', -160, 160, 0.1).onChange(apply).onFinishChange(commit);
  f.add(pos, 'Z profondeur (mm)', -2, 25, 0.1).onChange(apply).onFinishChange(commit);
  const rot = vecProxy(pc, 'rotationDeg', ['Rotation (°)', 'Inclinaison X (°)', 'Inclinaison Y (°)']);
  // rotationDeg = [x, y, z] ; on présente d'abord la rotation dans le plan (Z)
  const rotZ = { get 'Rotation (°)'() { return pc.rotationDeg[2]; }, set 'Rotation (°)'(v) { pc.rotationDeg[2] = v; } };
  f.add(rotZ, 'Rotation (°)', -180, 180, 0.1).onChange(apply).onFinishChange(commit);
  const rotXY = { get 'Inclinaison X (°)'() { return pc.rotationDeg[0]; }, set 'Inclinaison X (°)'(v) { pc.rotationDeg[0] = v; }, get 'Inclinaison Y (°)'() { return pc.rotationDeg[1]; }, set 'Inclinaison Y (°)'(v) { pc.rotationDeg[1] = v; } };
  f.add(rotXY, 'Inclinaison X (°)', -180, 180, 0.1).onChange(apply).onFinishChange(commit);
  f.add(rotXY, 'Inclinaison Y (°)', -180, 180, 0.1).onChange(apply).onFinishChange(commit);
  void rot;
  const sc = { get 'Échelle'() { return pc.scale[0]; }, set 'Échelle'(v) { pc.scale = [v, v, v]; } };
  f.add(sc, 'Échelle', 0.5, 1.5, 0.001).onChange(apply).onFinishChange(commit);
  const zs = { get 'Échelle Z seule'() { return pc.scale[2]; }, set 'Échelle Z seule'(v) { pc.scale[2] = v; } };
  f.add(zs, 'Échelle Z seule', 0.2, 3, 0.01).onChange(apply).onFinishChange(commit);
  f.add(pc, 'visible').name('Visible').onChange(apply).onFinishChange(commit);
  const mo = { get 'Couleur forcée'() { return pc.material?.color ?? cfg.filaments?.[String(pc.parts?.[0]?.filament ?? 1)]?.color ?? '#cccccc'; }, set 'Couleur forcée'(v) { pc.material = { ...(pc.material ?? {}), color: v }; } };
  f.addColor(mo, 'Couleur forcée').onChange(apply).onFinishChange(commit);
  f.add({ reset: () => { delete pc.material; apply(); commit(); } }, 'reset').name('↺ couleur des filaments');
  f.add({ sel: () => select(pc.id) }, 'sel').name('Sélectionner (gizmo)');
  f.add({ c: () => { pc.positionMm[0] = 0; apply(); refreshGui(); commit(); } }, 'c').name('Centrer horizontalement');
}

// Filaments
const fFil = gui.addFolder('Filaments (AMS)');
for (const [idx, fil] of Object.entries(cfg.filaments ?? {})) {
  const ff = fFil.addFolder(`Filament ${idx}${fil.type ? ` · ${fil.type}` : ''}`);
  const re = () => cfg.relief.pieces.forEach((p) => viewer.applyPiece(p));
  ff.addColor(fil, 'color').name('Couleur').onChange(re).onFinishChange(commit);
  ff.add(fil, 'finish', Object.fromEntries(Object.entries(FINISHES).map(([k, v]) => [v.label, k]))).name('Finition').onChange(re).onFinishChange(commit);
}
fFil.close();

// Fond
const bg = cfg.background;
bg.offsetMm ??= [0, 0];
const fBg = gui.addFolder('Fond imprimé (PNG)');
const bgo = vecProxy(bg, 'offsetMm', ['Décalage X (mm)', 'Décalage Y (mm)']);
const applyBg = () => viewer.applyBackground(bg);
fBg.add(bgo, 'Décalage X (mm)', -10, 10, 0.05).onChange(applyBg).onFinishChange(commit);
fBg.add(bgo, 'Décalage Y (mm)', -10, 10, 0.05).onChange(applyBg).onFinishChange(commit);
fBg.add(bg, 'rotationDeg', -3, 3, 0.01).name('Rotation (°)').onChange(applyBg).onFinishChange(commit);
fBg.add(bg, 'widthMm', 150, 260, 0.1).name('Largeur imprimée (mm)').onChange(() => {
  if (bg.pixels) bg.heightMm = round((bg.widthMm * bg.pixels[1]) / bg.pixels[0], 2); // proportions du PNG verrouillées
  applyBg(); refreshGui();
}).onFinishChange(commit);
fBg.add(bg, 'heightMm').name('Hauteur (mm, déduite)').disable();
fBg.close();

// Protection / caméra
const fMisc = gui.addFolder('Protection & caméra');
cfg.glass ??= { enabled: true };
fMisc.add(cfg.glass, 'enabled').name('Protection présente').onChange((v) => { viewer.setGlassVisible(v); checkClearance(); }).onFinishChange(commit);
cfg.camera ??= {};
cfg.camera.initial ??= { azimuthDeg: -22, elevationDeg: 8 };
fMisc.add(cfg.camera.initial, 'azimuthDeg', -60, 60, 1).name('Vue initiale : azimut (°)').onFinishChange(commit);
fMisc.add(cfg.camera.initial, 'elevationDeg', -30, 40, 1).name('Vue initiale : hauteur (°)').onFinishChange(commit);
fMisc.add(cfg.camera, 'fill', 0.5, 0.98, 0.01).name('Remplissage du cadre').onFinishChange(commit);
fMisc.add({ f: () => {
  const off = viewer.camera.position.clone().sub(viewer.controls.target);
  const s = new THREE.Spherical().setFromVector3(off);
  cfg.camera.initial = { azimuthDeg: round(THREE.MathUtils.radToDeg(s.theta), 1), elevationDeg: round(90 - THREE.MathUtils.radToDeg(s.phi), 1) };
  refreshGui(); commit();
} }, 'f').name('Utiliser la vue actuelle comme vue initiale');
fMisc.add(cfg.camera, 'autoRotate').name('Rotation auto au chargement').onFinishChange(commit);
fMisc.close();

// Photo de référence
const fPhoto = gui.addFolder('Photo de référence (comparaison)');
const ph = { opacity: 0.5, scale: 1, x: 0, y: 0 };
const overlay = $('#overlay');
const oimg = $('#overlay-img');
const applyPh = () => { oimg.style.opacity = ph.opacity; oimg.style.transform = `translate(${ph.x}%, ${ph.y}%) scale(${ph.scale})`; };
const fileInput = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*' });
fileInput.onchange = () => {
  const f = fileInput.files[0];
  if (!f) return;
  oimg.src = URL.createObjectURL(f);
  overlay.hidden = false;
  viewer.goTo('front');
  applyPh();
};
fPhoto.add({ o: () => fileInput.click() }, 'o').name('Ouvrir une photo…');
fPhoto.add(ph, 'opacity', 0, 1, 0.01).name('Opacité').onChange(applyPh);
fPhoto.add(ph, 'scale', 0.3, 3, 0.001).name('Échelle').onChange(applyPh);
fPhoto.add(ph, 'x', -50, 50, 0.05).name('Décalage X (%)').onChange(applyPh);
fPhoto.add(ph, 'y', -50, 50, 0.05).name('Décalage Y (%)').onChange(applyPh);
fPhoto.add({ h: () => { overlay.hidden = !overlay.hidden; } }, 'h').name('Afficher / masquer');
fPhoto.close();

gui.add({ dl: () => download() }, 'dl').name('⬇ Télécharger config.json');

// ------------------------------------------------------------- grille & vues
const grid = new THREE.Group();
{
  // grille 10 mm limitée au format du papier
  const { widthMm: w, heightMm: h } = cfg.background;
  const pts = [];
  for (let x = -Math.floor(w / 20) * 10; x <= w / 2; x += 10) pts.push(x, -h / 2, 0, x, h / 2, 0);
  for (let y = -Math.floor(h / 20) * 10; y <= h / 2; y += 10) pts.push(-w / 2, y, 0, w / 2, y, 0);
  const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const g = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x4da3ff, transparent: true, opacity: 0.45, depthWrite: false }));
  g.position.z = 0.15;
  grid.add(g);
  const axes = new THREE.AxesHelper(40);
  axes.position.z = 0.2;
  grid.add(axes);
  grid.visible = false;
  viewer.scene.add(grid);
}
$('#grid-btn').onclick = (e) => { grid.visible = !grid.visible; e.target.classList.toggle('on', grid.visible); viewer.requestRender(); };
$('#help-btn').onclick = () => { $('#help').hidden = !$('#help').hidden; };
document.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => viewer.goTo(b.dataset.view)));

// ------------------------------------------------------------------ contrôles
function checkClearance() {
  const msgs = [];
  const clearance = viewer.metrics.reliefClearance;
  for (const pc of cfg.relief.pieces) {
    if (pc.visible === false) continue;
    const e = viewer.pieces.get(pc.id);
    if (!e) continue;
    const box = new THREE.Box3().setFromObject(e.object);
    if (cfg.glass?.enabled !== false && box.max.z > clearance) msgs.push(`${pc.name} touche la protection (${round(box.max.z, 1)} > ${round(clearance, 1)} mm)`);
    if (box.min.z < -0.3) msgs.push(`${pc.name} s'enfonce dans le fond`);
    const o = viewer.metrics.opening;
    if (Math.abs(box.min.x) > o.width / 2 || Math.abs(box.max.x) > o.width / 2 || Math.abs(box.min.y) > o.height / 2 || Math.abs(box.max.y) > o.height / 2) msgs.push(`${pc.name} déborde de l'ouverture visible`);
  }
  $('#st-warn').textContent = msgs.length ? '⚠ ' + msgs.join(' · ') : '';
}
checkClearance();

// --------------------------------------------------------------- sauvegarde
function cleanConfig() {
  return JSON.parse(JSON.stringify(cfg));
}
function download() {
  const blob = new Blob([JSON.stringify(cleanConfig(), null, 2)], { type: 'application/json' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'config.json' });
  a.click();
}
async function save() {
  try {
    const r = await fetch(`__lafabrik/save/${productId}`, { method: 'POST', body: JSON.stringify(cleanConfig()) });
    if (!r.ok) throw new Error(await r.text());
    const j = await r.json();
    dirty = false;
    $('#st-dirty').textContent = `✔ enregistré dans ${j.file}`;
  } catch (e) {
    // Hors serveur de dev (site statique) : téléchargement du fichier.
    console.warn(e);
    download();
    $('#st-dirty').textContent = 'Enregistrement direct indisponible : config.json téléchargé';
  }
}
$('#save').onclick = save;
window.addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });
