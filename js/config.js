// Configuration centrale de l'application. Changer APP_NAME ici suffit à renommer
// l'app partout (titre, manifest PWA généré dynamiquement, footer...).
export const CONFIG = {
  APP_NAME: 'FrigoMix',
  APP_TAGLINE: "Dis-moi ce que tu as, je te dis quoi cuisiner.",

  // 'mock' (données de démo) | 'local-index' (data/recipes-fr.json, alimenté
  // chaque semaine par .github/workflows/update-recipes.yml) | 'cookidoo-public'
  // (recherche Algolia en direct, expérimental — voir docs/COOKIDOO_RESEARCH.md).
  PROVIDER: 'local-index',

  DEFAULT_SERVINGS: 4,
  DEFAULT_THERMOMIX_MODEL: 'TM7',

  // Ingrédients considérés disponibles par défaut ("j'ai généralement chez moi").
  DEFAULT_PANTRY_STAPLES: ['sel', 'poivre', 'eau', 'huile'],

  // Tous les ingrédients proposables dans la section "J'ai généralement chez moi".
  TOGGLABLE_STAPLES: [
    'sel', 'poivre', 'huile', "huile d'olive", 'beurre', 'eau',
    'sucre', 'farine', 'vinaigre', 'ail', 'oignon',
  ],

  RESULTS_PAGE_SIZE: 10,

  DEV_LOGS: false,
};
