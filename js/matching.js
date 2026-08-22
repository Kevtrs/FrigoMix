// Cœur du produit : transforme (recette, frigo de l'utilisateur) en un score
// de compatibilité exploitable par l'UI. Indépendant du DOM pour rester
// testable (voir tests/matching.test.js).
import { ingredientTier } from './ingredients.js';

// Les ingrédients de base (sel, huile...) sont volontairement exclus du
// calcul du ratio : leur présence/absence ne doit quasiment jamais influer
// sur le score (section "Ingrédients ignorés"). Seuls les ingrédients
// principaux et secondaires comptent pour le ratio de compatibilité — d'où
// l'écart de poids important entre les deux : l'absence du poulet doit
// peser bien plus que l'absence de parmesan (section "Pondération").
const WEIGHTS = { main: 6, secondary: 1 };

// En dessous de ce score une recette n'est pas montrée par défaut
// (section "Catégories de compatibilité" du cahier des charges).
export const MIN_VISIBLE_SCORE = 0.5;

export function compatibilityLabel(score) {
  if (score >= 0.9) return 'Tu as presque tout';
  if (score >= 0.75) return 'Il manque 1 ou 2 trucs';
  if (score >= 0.5) return 'Possible avec quelques courses';
  return null;
}

function has(pantrySet, name) {
  return pantrySet.has(name);
}

/**
 * @param {{id:string,name:string,ingredients:string[],rating?:number,numberOfRatings?:number,totalTime?:number,servings?:number,difficulty?:string,category?:string,url:string,thermomixModels?:string[]}} recipe
 * @param {{have:Set<string>, forbidden:Set<string>, priority:Set<string>, enabledStaples:Set<string>}} pantry
 * @param {{maxMissingMain?:number}} [options]
 */
export function calculateRecipeMatch(recipe, pantry, options = {}) {
  const ingredients = recipe.ingredients || [];

  const forbiddenHit = ingredients.find((ing) => pantry.forbidden.has(ing));
  if (forbiddenHit) {
    return {
      score: 0,
      matchedIngredients: [],
      missingIngredients: ingredients,
      ignoredMissingIngredients: [],
      priorityMatches: [],
      excluded: true,
      excludedBecause: forbiddenHit,
    };
  }

  const matched = [];
  const missing = [];
  const ignoredMissing = [];
  const priorityMatches = [];

  let totalWeight = 0;
  let matchedWeight = 0;
  let missingMainCount = 0;

  for (const ing of ingredients) {
    const tier = ingredientTier(ing);
    const available = has(pantry.have, ing) || (tier === 'basic' && has(pantry.enabledStaples, ing));

    if (available) {
      matched.push(ing);
      if (tier !== 'basic') {
        totalWeight += WEIGHTS[tier];
        matchedWeight += WEIGHTS[tier];
      }
      if (pantry.priority.has(ing)) priorityMatches.push(ing);
    } else if (tier === 'basic') {
      // Ingrédient de base manquant : affiché pour information, mais ne
      // rentre jamais dans le calcul du ratio (section "Ingrédients ignorés").
      ignoredMissing.push(ing);
    } else {
      missing.push(ing);
      totalWeight += WEIGHTS[tier];
      if (tier === 'main') missingMainCount += 1;
    }
  }

  const baseRatio = totalWeight > 0 ? matchedWeight / totalWeight : 0;

  // Bonus dominant : la part des ingrédients "significatifs" du frigo de
  // l'utilisateur (hors basiques) que cette recette utilise vraiment. C'est
  // ce qui fait qu'un vrai plat utilisant 5 des 6 ingrédients saisis doit
  // battre un plat minimaliste n'en utilisant qu'un seul, même si ce
  // dernier a un ratio de complétion de 100% (section "Bonus de
  // correspondance") : à qualité de préparation égale, la pertinence par
  // rapport à ce que l'utilisateur a réellement tapé prime sur la seule
  // faisabilité immédiate.
  const userSignificantIngredients = [...pantry.have].filter((i) => ingredientTier(i) !== 'basic');
  const usedUserIngredients = userSignificantIngredients.filter((i) => ingredients.includes(i));
  const coverageFraction = userSignificantIngredients.length
    ? usedUserIngredients.length / userSignificantIngredients.length
    : 0;

  // Bonus anti-gaspillage : la part des ingrédients "à finir en priorité"
  // effectivement utilisée par la recette pousse son score vers le haut.
  const priorityFraction = pantry.priority.size
    ? priorityMatches.length / pantry.priority.size
    : 0;

  const RATIO_WEIGHT = 0.55;
  const COVERAGE_WEIGHT = 0.35;
  const PRIORITY_WEIGHT = 0.1;

  // Légère pénalité pour les recettes qui demanderaient beaucoup d'achats,
  // même si le ratio pondéré reste correct — mais on ne pénalise qu'à
  // partir du deuxième ingrédient manquant, pour rester proche de l'esprit
  // des exemples du cahier des charges (manquer un seul ingrédient
  // secondaire ne doit presque rien coûter).
  const missingPenalty = Math.max(0.5, 1 - 0.03 * Math.max(0, missing.length - 1));

  let score = (baseRatio * RATIO_WEIGHT + coverageFraction * COVERAGE_WEIGHT + priorityFraction * PRIORITY_WEIGHT) * missingPenalty;
  score = Math.max(0, Math.min(1, Math.round(score * 1000) / 1000));

  return {
    score,
    matchedIngredients: matched,
    missingIngredients: missing,
    ignoredMissingIngredients: ignoredMissing,
    priorityMatches,
    excluded: false,
    missingMainCount,
  };
}

/**
 * Trie une liste de {recipe, match} déjà calculée selon l'ordre défini au
 * cahier des charges (section "Tri des résultats").
 */
export function sortScoredRecipes(scored) {
  return [...scored].sort((a, b) => {
    // 1. ingrédients principaux tous présents d'abord
    if (a.match.missingMainCount !== b.match.missingMainCount) {
      return a.match.missingMainCount - b.match.missingMainCount;
    }
    // 2. aucun ingrédient exclu (déjà filtré en amont, sécurité ici)
    if (a.match.excluded !== b.match.excluded) return a.match.excluded ? 1 : -1;
    // 3. score de compatibilité
    if (b.match.score !== a.match.score) return b.match.score - a.match.score;
    // 4. nombre d'ingrédients saisis réellement utilisés
    if (b.match.matchedIngredients.length !== a.match.matchedIngredients.length) {
      return b.match.matchedIngredients.length - a.match.matchedIngredients.length;
    }
    // 5. ingrédients prioritaires (anti-gaspillage) utilisés
    if (b.match.priorityMatches.length !== a.match.priorityMatches.length) {
      return b.match.priorityMatches.length - a.match.priorityMatches.length;
    }
    // 6. note Cookidoo
    const ratingA = a.recipe.rating || 0;
    const ratingB = b.recipe.rating || 0;
    if (ratingB !== ratingA) return ratingB - ratingA;
    // 7. temps de préparation, le plus court d'abord
    return (a.recipe.totalTime || Infinity) - (b.recipe.totalTime || Infinity);
  });
}

/**
 * Point d'entrée utilisé par l'UI : score toutes les recettes, exclut celles
 * avec un ingrédient interdit, trie, et applique une "recherche progressive"
 * (section 56) : si rien n'atteint le seuil normal, on redescend le seuil
 * plutôt que de renvoyer une page vide.
 */
export function findMatchingRecipes(recipes, pantry, { minScore = MIN_VISIBLE_SCORE } = {}) {
  const scored = recipes
    .map((recipe) => ({ recipe, match: calculateRecipeMatch(recipe, pantry) }))
    .filter((s) => !s.match.excluded);

  const sorted = sortScoredRecipes(scored);

  let threshold = minScore;
  let visible = sorted.filter((s) => s.match.score >= threshold);
  while (visible.length === 0 && threshold > 0.2) {
    threshold -= 0.1;
    visible = sorted.filter((s) => s.match.score >= threshold);
  }

  return { results: visible, relaxedThreshold: threshold < minScore ? threshold : null };
}
