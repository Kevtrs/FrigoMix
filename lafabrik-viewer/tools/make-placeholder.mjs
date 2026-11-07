// Génère des fichiers de SUBSTITUTION pour le prototype Márquez tant que les fichiers
// originaux (PNG, 3MF/STL) ne sont pas fournis :
//   - sources/marquez/background.png : mire neutre au format exact 210×300 mm @300 dpi
//   - sources/marquez/placeholder-93.3mf   : projet « façon Bambu Studio » (2 pièces, 2 filaments)
//   - sources/marquez/placeholder-93_*.stl : les mêmes pièces en STL
// Rien ici ne reproduit le visuel réel du cadre : ce sont des gabarits de test.
import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { zipSync, strToU8 } from 'fflate';
import * as THREE from 'three';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const productDir = path.join(root, 'public/products/marquez');
const srcDir = path.join(root, 'sources/marquez');
await mkdir(productDir, { recursive: true });
await mkdir(srcDir, { recursive: true });

// ---------------------------------------------------------------- fond PNG
const DPI = 300;
const mm = (v) => Math.round((v / 25.4) * DPI);
const W = mm(210), H = mm(300);
const ticks = [];
for (let x = 0; x <= 210; x += 10) ticks.push(`<line x1="${mm(x)}" y1="0" x2="${mm(x)}" y2="${x % 50 ? 40 : 90}" />`, `<line x1="${mm(x)}" y1="${H}" x2="${mm(x)}" y2="${H - (x % 50 ? 40 : 90)}" />`);
for (let y = 0; y <= 300; y += 10) ticks.push(`<line y1="${mm(y)}" x1="0" y2="${mm(y)}" x2="${y % 50 ? 40 : 90}" />`, `<line y1="${mm(y)}" x1="${W}" y2="${mm(y)}" x2="${W - (y % 50 ? 40 : 90)}" />`);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0" stop-color="#1d2733"/><stop offset="1" stop-color="#0d1218"/>
    </linearGradient>
    <pattern id="grid" width="${mm(10)}" height="${mm(10)}" patternUnits="userSpaceOnUse">
      <path d="M ${mm(10)} 0 L 0 0 0 ${mm(10)}" fill="none" stroke="#ffffff" stroke-opacity="0.06" stroke-width="3"/>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <rect width="100%" height="100%" fill="url(#grid)"/>
  <g stroke="#ffffff" stroke-opacity="0.55" stroke-width="5">${ticks.join('')}</g>
  <g stroke="#e8c547" stroke-width="4" fill="none">
    <line x1="${W / 2 - 60}" y1="${H / 2}" x2="${W / 2 + 60}" y2="${H / 2}"/>
    <line x1="${W / 2}" y1="${H / 2 - 60}" x2="${W / 2}" y2="${H / 2 + 60}"/>
    <circle cx="${W / 2}" cy="${H / 2}" r="30"/>
  </g>
  <g font-family="DejaVu Sans, Arial, sans-serif" fill="#ffffff" text-anchor="middle">
    <text x="${W / 2}" y="${mm(28)}" font-size="${mm(9)}" font-weight="700" letter-spacing="6">FICHIER DE SUBSTITUTION</text>
    <text x="${W / 2}" y="${mm(40)}" font-size="${mm(5)}" fill-opacity="0.75">Remplacer par le PNG original du cadre Márquez #93</text>
    <text x="${W / 2}" y="${mm(285)}" font-size="${mm(4.2)}" fill-opacity="0.6">210 × 300 mm · 300 dpi · ${W} × ${H} px · repères tous les 10 mm</text>
  </g>
</svg>`;
await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).withMetadata({ density: DPI }).toFile(path.join(srcDir, 'background.png'));
console.log(`✔ fond de substitution ${W}×${H} px`);

// ---------------------------------------------------------------- pièces « 93 »
const fontJson = JSON.parse(readFileSync(require.resolve('three/examples/fonts/helvetiker_bold.typeface.json'), 'utf8'));
const font = new FontLoader().parse(fontJson);
function text(depth, bevel) {
  const g = new TextGeometry('93', {
    font, size: 70, depth, curveSegments: 6,
    bevelEnabled: bevel > 0, bevelThickness: 0.01, bevelSize: bevel, bevelSegments: 1,
  });
  g.computeBoundingBox();
  const bb = g.boundingBox;
  g.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -bb.min.z);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  return mergeVertices(g, 1e-4);
}
const outline = text(2.0, 2.4); // socle blanc débordant = liseré
const face = text(3.0, 0); // chiffres rouges
face.translate(0, 0, 2.0);

function meshXml(g) {
  const p = g.attributes.position;
  const v = [];
  for (let i = 0; i < p.count; i++) v.push(`<vertex x="${p.getX(i).toFixed(4)}" y="${p.getY(i).toFixed(4)}" z="${p.getZ(i).toFixed(4)}"/>`);
  const t = [];
  const idx = g.index.array;
  for (let i = 0; i < idx.length; i += 3) t.push(`<triangle v1="${idx[i]}" v2="${idx[i + 1]}" v3="${idx[i + 2]}"/>`);
  return `<mesh><vertices>${v.join('')}</vertices><triangles>${t.join('')}</triangles></mesh>`;
}
const NS = 'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"';
const objectsModel = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" ${NS} requiredextensions="p">
 <resources>
  <object id="1" p:UUID="00010000-81cb-4c03-9d28-80fed5dfa1dc" type="model">${meshXml(face)}</object>
  <object id="2" p:UUID="00020000-81cb-4c03-9d28-80fed5dfa1dc" type="model">${meshXml(outline)}</object>
 </resources>
 <build/>
</model>`;
// Position sur le plateau (≠ position sur le cadre) : centre du plateau X1C 256×256.
const rootModel = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" ${NS} requiredextensions="p">
 <metadata name="Application">BambuStudio-01.10.00.00</metadata>
 <resources>
  <object id="3" p:UUID="00000001-61cb-4c03-9d28-80fed5dfa1dc" type="model">
   <components>
    <component p:path="/3D/Objects/object_1.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
    <component p:path="/3D/Objects/object_1.model" objectid="2" transform="1 0 0 0 1 0 0 0 1 0 0 0"/>
   </components>
  </object>
 </resources>
 <build p:UUID="2c7c17d8-22b5-4d84-8835-1976022ea369">
  <item objectid="3" p:UUID="00000003-b1ec-4553-aec9-835e5b724bb4" transform="1 0 0 0 1 0 0 0 1 128 128 0" printable="1"/>
 </build>
</model>`;
const modelSettings = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="3">
    <metadata key="name" value="Numero 93"/>
    <metadata key="extruder" value="1"/>
    <part id="1" subtype="normal_part">
      <metadata key="name" value="93_face"/>
      <metadata key="extruder" value="1"/>
    </part>
    <part id="2" subtype="normal_part">
      <metadata key="name" value="93_liseré"/>
      <metadata key="extruder" value="2"/>
    </part>
  </object>
  <plate>
    <metadata key="plater_id" value="1"/>
  </plate>
</config>`;
const projectSettings = JSON.stringify({
  filament_colour: ['#D2001F', '#F4F4F2'],
  filament_type: ['PLA', 'PLA'],
  filament_settings_id: ['Bambu PLA Matte @BBL X1C', 'Bambu PLA Matte @BBL X1C'],
  printer_model: 'Bambu Lab X1 Carbon',
}, null, 2);
const zip = zipSync({
  '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="config" ContentType="text/xml"/></Types>'),
  '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),
  '3D/3dmodel.model': strToU8(rootModel),
  '3D/Objects/object_1.model': strToU8(objectsModel),
  'Metadata/model_settings.config': strToU8(modelSettings),
  'Metadata/project_settings.config': strToU8(projectSettings),
});
await writeFile(path.join(srcDir, 'placeholder-93.3mf'), zip);
console.log('✔ sources/marquez/placeholder-93.3mf (2 pièces, 2 filaments AMS)');

// STL binaire, équivalent sans couleurs
function stl(g) {
  const ng = g.toNonIndexed();
  const p = ng.attributes.position;
  const n = p.count / 3;
  const buf = Buffer.alloc(84 + n * 50);
  buf.write('LaFabrik placeholder', 0);
  buf.writeUInt32LE(n, 80);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    a.fromBufferAttribute(p, i * 3); b.fromBufferAttribute(p, i * 3 + 1); c.fromBufferAttribute(p, i * 3 + 2);
    const nn = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    let o = 84 + i * 50;
    for (const v of [nn, a, b, c]) { buf.writeFloatLE(v.x, o); buf.writeFloatLE(v.y, o + 4); buf.writeFloatLE(v.z, o + 8); o += 12; }
  }
  return buf;
}
const shift = new THREE.Matrix4().makeTranslation(128, 128, 0); // coordonnées « plateau »
await writeFile(path.join(srcDir, 'placeholder-93_face.stl'), stl(face.clone().applyMatrix4(shift)));
await writeFile(path.join(srcDir, 'placeholder-93_lisere.stl'), stl(outline.clone().applyMatrix4(shift)));
console.log('✔ sources/marquez/placeholder-93_face.stl + _lisere.stl');
