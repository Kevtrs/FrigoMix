import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { parseTransform, decodePaint, dominantPaintState, read3MF, partToGeometries } from '../tools/lib/threemf.mjs';
import { rodalmMetrics, buildRodalm } from '../src/core/rodalm.js';

test('transformation 3MF (convention vecteur-ligne)', () => {
  const m = parseTransform('1 0 0 0 1 0 0 0 1 128 64 2');
  const v = new THREE.Vector3(1, 2, 3).applyMatrix4(m);
  assert.deepEqual(v.toArray(), [129, 66, 5]);
  const r = parseTransform('0 1 0 -1 0 0 0 0 1 0 0 0'); // rotation 90° autour de Z
  const w = new THREE.Vector3(1, 0, 0).applyMatrix4(r);
  assert.ok(Math.abs(w.x) < 1e-9 && Math.abs(w.y - 1) < 1e-9);
});

test('décodage peinture multi-couleur Bambu/Prusa', () => {
  assert.equal(dominantPaintState('4'), 1);
  assert.equal(dominantPaintState('8'), 2);
  assert.equal(dominantPaintState('0C'), 3);
  assert.equal(dominantPaintState('1C'), 4);
  // triangle subdivisé en 2 (code 1) : enfants état 2 et état 2 → 2
  assert.equal(dominantPaintState('881'), 2);
  const a = decodePaint('481'); // enfants : état 2 puis état 1, surfaces 1/2 chacun
  assert.equal(a[1] + a[2], 1);
});

test('lecture du 3MF de test façon Bambu Studio', () => {
  const r = read3MF(new Uint8Array(readFileSync(new URL('../sources/marquez/placeholder-93.3mf', import.meta.url))));
  assert.equal(r.pieces.length, 1);
  assert.equal(r.pieces[0].name, 'Numero 93');
  assert.deepEqual(r.pieces[0].parts.map((p) => p.filament), [1, 2]);
  assert.equal(r.filaments[0].color, '#D2001F');
  const g = partToGeometries(r.pieces[0].parts[0])[0].geometry;
  g.computeBoundingBox();
  // coordonnées plateau (centre 128,128) et face rouge de 2 à 5 mm
  assert.ok(Math.abs((g.boundingBox.min.x + g.boundingBox.max.x) / 2 - 128) < 0.5);
  assert.ok(Math.abs(g.boundingBox.min.z - 2) < 1e-3 && Math.abs(g.boundingBox.max.z - 5) < 1e-3);
});

test('cotes du RÖDALM et place disponible pour les reliefs', () => {
  const preset = JSON.parse(readFileSync(new URL('../public/shared/rodalm.json', import.meta.url), 'utf8'));
  const m = rodalmMetrics(preset);
  assert.equal(m.opening.width, preset.outer.width - 2 * preset.faceWidth);
  assert.ok(m.rebateD < preset.faceWidth, 'le papier doit passer sous la moulure');
  assert.ok(m.reliefClearance > 5);
  const { group } = buildRodalm(preset);
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.x - preset.outer.width) < 0.01);
  assert.ok(Math.abs(size.y - preset.outer.height) < 0.01);
  assert.ok(Math.abs(size.z - preset.outer.depth) < 0.01);
});
