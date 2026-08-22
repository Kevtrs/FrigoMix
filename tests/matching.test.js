import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateRecipeMatch, sortScoredRecipes, findMatchingRecipes } from '../js/matching.js';

function pantryOf({ have = [], forbidden = [], priority = [], staples = ['sel', 'poivre', 'eau', 'huile'] } = {}) {
  return {
    have: new Set(have),
    forbidden: new Set(forbidden),
    priority: new Set(priority),
    enabledStaples: new Set(staples),
  };
}

test('une recette utilisant 4/5 ingrédients du frigo bat une recette qui n’en utilise qu’1/5', () => {
  const pantry = pantryOf({ have: ['poulet', 'champignon', 'riz', 'courgette', 'saumon'] });

  const recipeUsesFour = {
    id: 'a', name: 'Poêlée', url: '#',
    ingredients: ['poulet', 'champignon', 'riz', 'courgette'],
  };
  const recipeUsesOne = {
    id: 'b', name: 'Autre plat', url: '#',
    ingredients: ['poulet', 'bœuf', 'agneau', 'thon'],
  };

  const matchFour = calculateRecipeMatch(recipeUsesFour, pantry);
  const matchOne = calculateRecipeMatch(recipeUsesOne, pantry);

  assert.ok(matchFour.score > matchOne.score, `${matchFour.score} devrait être > ${matchOne.score}`);
});

test('un vrai plat qui utilise presque tout le frigo bat une préparation minimaliste 100% réalisable', () => {
  // Cas concret observé avec l'index réel : "Cuisson du riz" (juste riz+eau+sel,
  // donc techniquement réalisable à 100%) ne doit pas battre un risotto qui
  // utilise 5 des 6 ingrédients saisis par l'utilisateur, même si le risotto
  // demande un ou deux achats en plus (section "Bonus de correspondance").
  const pantry = pantryOf({ have: ['poulet', 'champignon', 'riz', 'crème fraîche', 'parmesan'] });

  const trivialRecipe = { id: 'riz', name: 'Cuisson du riz', url: '#', ingredients: ['riz'] };
  const richRecipe = {
    id: 'risotto', name: 'Risotto de poulet aux champignons', url: '#',
    ingredients: ['poulet', 'champignon', 'riz', 'crème fraîche', 'parmesan', 'vin blanc', 'bouillon'],
  };

  const matchTrivial = calculateRecipeMatch(trivialRecipe, pantry);
  const matchRich = calculateRecipeMatch(richRecipe, pantry);

  assert.equal(matchTrivial.missingIngredients.length, 0); // techniquement réalisable à 100%...
  assert.ok(matchRich.score > matchTrivial.score, `${matchRich.score} devrait être > ${matchTrivial.score}`); // ...mais moins pertinent que le vrai plat
});

test('une recette contenant un ingrédient interdit est exclue du matching', () => {
  const pantry = pantryOf({ have: ['porc', 'oignon'], forbidden: ['porc'] });
  const recipe = { id: 'c', name: 'Rôti de porc', url: '#', ingredients: ['porc', 'oignon'] };

  const match = calculateRecipeMatch(recipe, pantry);
  assert.equal(match.excluded, true);
  assert.equal(match.score, 0);

  const { results } = findMatchingRecipes([recipe], pantry);
  assert.equal(results.length, 0);
});

test('un ingrédient marqué "à finir en priorité" favorise les recettes qui l’utilisent', () => {
  const pantry = pantryOf({
    have: ['champignon', 'poulet', 'crème fraîche', 'parmesan'],
    priority: ['champignon'],
  });

  const usesPriority = {
    id: 'd', name: 'Risotto champignons', url: '#',
    ingredients: ['champignon', 'poulet', 'crème fraîche', 'parmesan'],
  };
  const doesNotUsePriority = {
    id: 'e', name: 'Poulet crème', url: '#',
    ingredients: ['poulet', 'crème fraîche', 'parmesan'],
  };

  const scored = [
    { recipe: usesPriority, match: calculateRecipeMatch(usesPriority, pantry) },
    { recipe: doesNotUsePriority, match: calculateRecipeMatch(doesNotUsePriority, pantry) },
  ];

  assert.ok(scored[0].match.score > scored[1].match.score);
  assert.deepEqual(sortScoredRecipes(scored).map((s) => s.recipe.id), ['d', 'e']);
});

test('les ingrédients de base manquants (sel, poivre...) ne pénalisent presque pas', () => {
  const pantry = pantryOf({ have: ['poulet', 'riz'], staples: [] });
  const recipe = {
    id: 'f', name: 'Poulet riz', url: '#',
    ingredients: ['poulet', 'riz', 'sel', 'poivre'],
  };
  const match = calculateRecipeMatch(recipe, pantry);
  assert.ok(match.score >= 0.9, `score attendu proche de 1, obtenu ${match.score}`);
  assert.deepEqual(match.ignoredMissingIngredients.sort(), ['poivre', 'sel']);
});

test('un œuf seul ne rend pas gratuitement réalisable un gâteau', () => {
  const pantry = pantryOf({ have: ['œuf'], staples: ['sel', 'poivre', 'eau', 'huile'] });
  const eggDish = {
    id: 'eggs', name: 'Œufs sur le plat', url: '#',
    ingredients: ['œuf', 'huile', 'sel', 'poivre'],
  };
  const cake = {
    id: 'cake', name: 'Gâteau', url: '#',
    ingredients: ['œuf', 'farine', 'sucre', 'beurre'],
  };

  const eggMatch = calculateRecipeMatch(eggDish, pantry);
  const cakeMatch = calculateRecipeMatch(cake, pantry);
  assert.ok(eggMatch.score > cakeMatch.score, `${eggMatch.score} devrait être > ${cakeMatch.score}`);
  assert.deepEqual(cakeMatch.missingIngredients.sort(), ['beurre', 'farine', 'sucre']);
});

test('un ingrédient présent dans le titre renforce la pertinence', () => {
  const pantry = pantryOf({ have: ['œuf'] });
  const named = { id: 'named', name: 'Œufs vapeur', url: '#', ingredients: ['œuf', 'paprika'] };
  const incidental = { id: 'incidental', name: 'Préparation vapeur', url: '#', ingredients: ['œuf', 'paprika'] };
  assert.ok(calculateRecipeMatch(named, pantry).score > calculateRecipeMatch(incidental, pantry).score);
});
