// Provider principal de production : sert data/recipes-fr.compact.json, la
// version allégée (id, nom, ingrédients, temps, portions, difficulté,
// catégorie, note, image, url — rien de plus) d'un index de vraies recettes
// Cookidoo construit par .github/workflows/update-recipes.yml (voir
// scripts/update-recipes.mjs et docs/COOKIDOO_RESEARCH.md pour le détail de
// la collecte). Le cache complet (data/recipes-fr.json, avec des champs
// supplémentaires utiles au scraper comme numberOfRatings/updatedAt) n'est
// jamais téléchargé par le navigateur — seul le compact l'est, pour garder
// le poids transféré raisonnable sur mobile. 100% statique : aucun appel
// réseau à Cookidoo n'est fait depuis le navigateur de l'utilisateur, ce qui
// permet un fonctionnement hors-ligne complet une fois l'app chargée.
let cache = null;

export function createLocalIndexProvider({ baseUrl = '.' } = {}) {
  return {
    name: 'local-index',
    async getAllRecipes() {
      if (cache) return cache;
      const res = await fetch(`${baseUrl}/data/recipes-fr.compact.json`);
      if (!res.ok) throw new Error("L'index local des recettes est introuvable.");
      cache = await res.json();
      return cache;
    },
  };
}
