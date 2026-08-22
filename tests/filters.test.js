import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRecipeFilters, hasRequiredSearchCriteria } from '../js/filters.js';

const recipes = [
  { id: 'a', servings: 4, totalTime: 1800, difficulty: 'Facile', category: 'Plat', thermomixModels: ['TM6', 'TM7'] },
  { id: 'b', servings: 2, totalTime: 3600, difficulty: 'Moyen', category: 'Dessert', thermomixModels: ['TM5'] },
  { id: 'unknown' },
];

test('le filtre personnes est réellement appliqué', () => {
  assert.deepEqual(applyRecipeFilters(recipes, { servings: '4' }).map((r) => r.id), ['a']);
});

test('les filtres temps, difficulté, catégorie et Thermomix sont appliqués', () => {
  assert.deepEqual(applyRecipeFilters(recipes, { maxTime: 1800 }).map((r) => r.id), ['a']);
  assert.deepEqual(applyRecipeFilters(recipes, { difficulty: 'Moyen' }).map((r) => r.id), ['b']);
  assert.deepEqual(applyRecipeFilters(recipes, { category: 'Dessert' }).map((r) => r.id), ['b']);
  assert.deepEqual(applyRecipeFilters(recipes, { thermomixModel: 'TM7' }).map((r) => r.id), ['a']);
});

test('une métadonnée inconnue ne contourne pas un filtre actif', () => {
  assert.deepEqual(applyRecipeFilters(recipes, { category: 'Plat' }).map((r) => r.id), ['a']);
});

test('le filtre salé/sucré corrige les desserts mal classés comme plats', () => {
  const mislabeled = [
    { id: 'omelette', name: 'Omelette aux herbes', category: 'Plat' },
    { id: 'sorbet', name: 'Sorbet de fruits rouges', category: 'Plat' },
    { id: 'cake', name: 'Gâteau aux pommes', category: 'Dessert' },
  ];
  assert.deepEqual(applyRecipeFilters(mislabeled, { mealKind: 'savory' }).map((r) => r.id), ['omelette']);
  assert.deepEqual(applyRecipeFilters(mislabeled, { mealKind: 'sweet' }).map((r) => r.id), ['sorbet', 'cake']);
});

test('une recherche exige des ingrédients et un type de recette', () => {
  assert.equal(hasRequiredSearchCriteria(0, { category: 'Plat' }), false);
  assert.equal(hasRequiredSearchCriteria(1, { category: null }), false);
  assert.equal(hasRequiredSearchCriteria(1, { category: 'Plat' }), true);
});
