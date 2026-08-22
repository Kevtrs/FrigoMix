import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeIngredient, ingredientTier, suggestIngredients } from '../js/ingredients.js';

test('normalise les pluriels et variétés courantes', () => {
  assert.equal(normalizeIngredient('Champignons'), 'champignon');
  assert.equal(normalizeIngredient('champignons de Paris'), 'champignon');
  assert.equal(normalizeIngredient('Tomates'), 'tomate');
  assert.equal(normalizeIngredient('Oignons'), 'oignon');
  assert.equal(normalizeIngredient('  Poulet  '), 'poulet');
});

test("ne fusionne pas des ingrédients gastronomiquement distincts", () => {
  // La crème fraîche et la crème liquide sont volontairement regroupées
  // (alias explicite), mais un ingrédient totalement différent ne doit
  // jamais être transformé en autre chose.
  assert.equal(normalizeIngredient('saumon'), 'saumon');
  assert.notEqual(normalizeIngredient('saumon'), 'thon');
});

test('conserve un ingrédient inconnu du dictionnaire tel quel (nettoyé)', () => {
  assert.equal(normalizeIngredient('Kimchi'), 'kimchi');
});

test('classe les ingrédients par tier pour la pondération du matching', () => {
  assert.equal(ingredientTier('poulet'), 'main');
  assert.equal(ingredientTier('parmesan'), 'secondary');
  assert.equal(ingredientTier('sel'), 'basic');
});

test('suggère des ingrédients à partir d’un préfixe', () => {
  const suggestions = suggestIngredients('cham');
  assert.ok(suggestions.includes('champignon'));
});
