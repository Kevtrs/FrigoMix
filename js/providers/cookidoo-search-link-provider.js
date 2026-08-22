// Dernier recours (section "Recherche publique minimale") : pas de données
// structurées, juste un lien de recherche Cookidoo préconfiguré avec les
// ingrédients saisis. Toujours disponible, même si le provider principal
// échoue (réseau coupé pour charger l'index, index vide, etc.).
export function buildCookidooSearchUrl(ingredientNames) {
  const query = ingredientNames.join(' ');
  return `https://cookidoo.fr/search/fr-FR?q=${encodeURIComponent(query)}`;
}

export function createCookidooSearchLinkProvider() {
  return {
    name: 'cookidoo-search-link',
    async getAllRecipes() {
      return [];
    },
    buildSearchUrl: buildCookidooSearchUrl,
  };
}
