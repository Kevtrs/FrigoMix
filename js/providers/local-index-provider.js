// Provider principal de production : sert data/recipes-fr.json, un index de
// vraies recettes Cookidoo (id, titre, ingrédients, temps, note, url...)
// construit une fois par semaine par .github/workflows/update-recipes.yml
// (voir scripts/update-recipes.mjs et docs/COOKIDOO_RESEARCH.md pour le
// détail de la collecte). 100% statique : aucun appel réseau à Cookidoo n'est
// fait depuis le navigateur de l'utilisateur, ce qui permet un fonctionnement
// hors-ligne complet une fois l'app chargée.
let cache = null;

export function createLocalIndexProvider({ baseUrl = '.' } = {}) {
  return {
    name: 'local-index',
    async getAllRecipes() {
      if (cache) return cache;
      const res = await fetch(`${baseUrl}/data/recipes-fr.json`);
      if (!res.ok) throw new Error("L'index local des recettes est introuvable.");
      cache = await res.json();
      return cache;
    },
  };
}
