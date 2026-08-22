// Fabrique de provider. Un seul endroit choisit l'implémentation active —
// évite d'éparpiller des `if (CONFIG.PROVIDER === ...)` dans toute l'app
// (section "Mode développement" du cahier des charges).
import { CONFIG } from '../config.js';
import { createMockProvider } from './mock-provider.js';
import { createLocalIndexProvider } from './local-index-provider.js';
import { createCookidooSearchLinkProvider } from './cookidoo-search-link-provider.js';

export { buildCookidooSearchUrl } from './cookidoo-search-link-provider.js';

export function getRecipeProvider(baseUrl = '.') {
  switch (CONFIG.PROVIDER) {
    case 'mock':
      return createMockProvider({ baseUrl });
    case 'local-index':
      return createLocalIndexProvider({ baseUrl });
    default:
      return createLocalIndexProvider({ baseUrl });
  }
}

/**
 * Charge les recettes avec repli automatique : index local -> mock -> [].
 * Garantit que l'UI a toujours quelque chose à afficher même si
 * data/recipes-fr.json n'a pas encore été généré (ex: tout premier
 * déploiement avant la première exécution de l'Action GitHub).
 */
export async function loadRecipesWithFallback(baseUrl = '.') {
  const primary = getRecipeProvider(baseUrl);
  try {
    const recipes = await primary.getAllRecipes();
    if (recipes && recipes.length > 0) return { recipes, provider: primary.name };
  } catch {
    // on retente avec le mock ci-dessous
  }
  try {
    const mock = createMockProvider({ baseUrl });
    const recipes = await mock.getAllRecipes();
    return { recipes, provider: 'mock (repli)' };
  } catch {
    return { recipes: [], provider: 'aucun' };
  }
}

export function createFallbackSearchProvider() {
  return createCookidooSearchLinkProvider();
}
