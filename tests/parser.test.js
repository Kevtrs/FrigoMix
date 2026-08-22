import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseIngredientInput } from '../js/parser.js';

function names(input) {
  return parseIngredientInput(input).map((e) => e.normalized);
}

test('sépare une liste simple par virgules', () => {
  assert.deepEqual(names('poulet, champignons, riz'), ['poulet', 'champignon', 'riz']);
});

test('comprend une phrase naturelle complète', () => {
  const result = names("J'ai du poulet, de la crème et 2 courgettes");
  assert.deepEqual(result, ['poulet', 'crème fraîche', 'courgette']);
});

test('extrait la quantité sans bloquer la reconnaissance de l’ingrédient', () => {
  const parsed = parseIngredientInput("J'ai 300 g de poulet et 2 courgettes");
  assert.equal(parsed[0].normalized, 'poulet');
  assert.equal(parsed[0].quantity, '300 g');
  assert.equal(parsed[1].normalized, 'courgette');
  assert.equal(parsed[1].quantity, '2');
});

test('ignore les entrées vides', () => {
  assert.deepEqual(names(''), []);
  assert.deepEqual(names('   '), []);
});

test('gère un reste de recette au vocabulaire varié', () => {
  const result = names("un reste de parmesan et un peu de crème fraîche");
  assert.deepEqual(result, ['parmesan', 'crème fraîche']);
});
