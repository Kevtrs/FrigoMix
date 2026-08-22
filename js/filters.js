/**
 * Filtres purs et testables. Lorsqu'un filtre est demandé, une recette dont
 * la métadonnée correspondante est inconnue ne doit pas passer silencieusement.
 */
export function applyRecipeFilters(recipes, filters) {
  return recipes.filter((recipe) => {
    if (filters.mealKind) {
      const sweet = isSweetRecipe(recipe);
      if (filters.mealKind === 'sweet' && !sweet) return false;
      if (filters.mealKind === 'savory' && sweet) return false;
    }
    if (filters.servings) {
      if (!Number.isFinite(Number(recipe.servings))) return false;
      if (Number(recipe.servings) !== Number(filters.servings)) return false;
    }
    if (filters.maxTime) {
      if (!Number.isFinite(Number(recipe.totalTime))) return false;
      if (Number(recipe.totalTime) > Number(filters.maxTime)) return false;
    }
    if (filters.difficulty) {
      if (!recipe.difficulty || recipe.difficulty !== filters.difficulty) return false;
    }
    if (filters.category) {
      if (!recipe.category || recipe.category !== filters.category) return false;
    }
    if (filters.thermomixModel) {
      if (!Array.isArray(recipe.thermomixModels)) return false;
      if (!recipe.thermomixModels.includes(filters.thermomixModel)) return false;
    }
    return true;
  });
}

export function hasRequiredSearchCriteria(pantryCount, filters) {
  return pantryCount > 0 && Boolean(filters.category);
}

// Cookidoo classe parfois sorbets, mousses ou crèmes dans « Plat ». On
// combine donc la catégorie et des mots de titre très caractéristiques.
const SWEET_TITLE_RE = /(gâteau|cake|biscuit|cookie|brownie|chouquette|génoise|meringue|sorbet|glace|crèmes? (?:dessert|anglaise|aux œufs|.*(?:caramel|vanille|chocolat))|œufs au lait|mousses? (?:au|de)|pancake|gaufre|brioche|beignet|tiramisu|cheesecake|clafoutis|madeleine|macaron|financier|fondant au|moelleux au)/i;

export function isSweetRecipe(recipe) {
  return recipe.category === 'Dessert' || SWEET_TITLE_RE.test(recipe.name || '');
}
