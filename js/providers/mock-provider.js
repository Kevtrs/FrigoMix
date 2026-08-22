// Provider de développement : sert data/mock-recipes.json. Permet de
// construire et tester toute l'interface indépendamment de Cookidoo
// (section "Mode développement" du cahier des charges).
let cache = null;

export function createMockProvider({ baseUrl = '.' } = {}) {
  return {
    name: 'mock',
    async getAllRecipes() {
      if (cache) return cache;
      const res = await fetch(`${baseUrl}/data/mock-recipes.json`);
      if (!res.ok) throw new Error('Impossible de charger les recettes de démonstration.');
      cache = await res.json();
      return cache;
    },
  };
}
