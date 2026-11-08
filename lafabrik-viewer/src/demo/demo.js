import '../embed/lafabrik-viewer.js';

const $ = (s) => document.querySelector(s);
const el = $('#viewer');
const params = new URLSearchParams(location.search);

const { products } = await (await fetch('products/index.json')).json();
const sel = $('#product');
for (const p of products) sel.add(new Option(p.name, p.id));
const current = params.get('product') ?? products[0].id;
sel.value = current;
sel.addEventListener('change', () => { location.search = `?product=${sel.value}`; });

el.setAttribute('src', `products/${current}/config.json`);
el.setAttribute('poster', `products/${current}/poster.webp`);

el.addEventListener('ready', (e) => {
  const v = e.detail.viewer;
  window.__lafabrik = { viewer: v, ready: true };
  const cfg = v.config;
  $('#title').textContent = cfg.name;
  const warn = cfg.relief?.placeholder ? ' · ⚠ relief de substitution (3MF du « 93 » non fourni)' : '';
  $('#status').textContent = `Chargé en ${v.loadTimeMs} ms · qualité « ${v.tierName} »${warn}`;
  renderPhotos(v, cfg);
});

// ------------------------------------------------------------ comparaison photo
const overlay = $('#overlay');
const img = $('#overlay-img');
function applyOverlay() {
  img.style.opacity = $('#op').value;
  const s = $('#ps').value;
  img.style.transform = `translate(${$('#px').value}%, ${$('#py').value}%) scale(${s})`;
  overlay.style.clipPath = `inset(0 ${100 - $('#wipe').value}% 0 0)`;
}
for (const id of ['#op', '#wipe', '#ps', '#px', '#py']) $(id).addEventListener('input', applyOverlay);

function openCompare(src, view) {
  img.src = src;
  overlay.hidden = false;
  $('#compare-controls').hidden = false;
  if (view && el.viewer) el.viewer.goTo(view);
  applyOverlay();
}
$('#close-compare').addEventListener('click', () => { overlay.hidden = true; $('#compare-controls').hidden = true; });
$('#photo-file').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) openCompare(URL.createObjectURL(f), 'front');
});
$('#snap').addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = el.viewer.snapshot('image/png');
  a.download = `${sel.value}-vue3d.png`;
  a.click();
});

function renderPhotos(v, cfg) {
  const box = $('#photos');
  box.innerHTML = '';
  if (!cfg.photos?.length) {
    box.innerHTML = '<span class="empty">Aucune photo déclarée dans config.json (champ « photos »).</span>';
    return;
  }
  for (const ph of cfg.photos) {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = ph.label ?? ph.src;
    const url = new URL(ph.src, v.productBase).href;
    b.innerHTML = `<img src="${url}" alt="${ph.label ?? ''}" loading="lazy">`;
    b.addEventListener('click', () => openCompare(url, ph.view ?? 'front'));
    box.append(b);
  }
}
