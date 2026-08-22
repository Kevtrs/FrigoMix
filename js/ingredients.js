// Dictionnaire d'ingrédients français courants + moteur de normalisation.
// Tout est local (pas d'API externe) pour fonctionner hors-ligne.

// Ingrédients "canoniques" par catégorie. La catégorie sert surtout à
// l'autocomplétion et aux suggestions rapides de l'accueil.
export const INGREDIENT_CATALOG = {
  legumes: [
    'tomate', 'courgette', 'aubergine', 'carotte', 'oignon', 'ail',
    'pomme de terre', 'poireau', 'champignon', 'poivron', 'brocoli',
    'chou-fleur', 'épinard', 'salade', 'concombre', 'petits pois',
    'haricot vert', 'céleri', 'betterave', 'potiron', 'butternut',
  ],
  viandes: [
    'poulet', 'bœuf', 'steak haché', 'porc', 'jambon', 'lardons',
    'dinde', 'agneau', 'veau', 'chorizo', 'saucisse',
  ],
  poissons: [
    'saumon', 'cabillaud', 'thon', 'crevette', 'moule', 'colin',
    'sardine', 'maquereau',
  ],
  produitsFrais: [
    'crème fraîche', 'lait', 'beurre', 'œuf', 'parmesan', 'emmental',
    'mozzarella', 'chèvre', 'yaourt', 'mascarpone', 'feta', 'ricotta',
  ],
  feculents: [
    'riz', 'pâtes', 'semoule', 'quinoa', 'lentilles', 'pois chiche',
    'boulgour', 'pomme de terre', 'pain', 'farine',
  ],
  epicesEtBase: [
    'sel', 'poivre', 'huile', "huile d'olive", 'beurre', 'eau', 'sucre',
    'farine', 'vinaigre', 'ail', 'oignon', 'bouillon', 'moutarde',
    'persil', 'basilic', 'thym', 'laurier', 'cumin', 'paprika',
    'curry', 'coriandre', 'gingembre', 'citron', 'vin blanc',
  ],
};

// Liste plate, dédupliquée, de tous les ingrédients canoniques connus.
export const ALL_INGREDIENTS = [...new Set(Object.values(INGREDIENT_CATALOG).flat())].sort(
  (a, b) => a.localeCompare(b, 'fr')
);

// Alias -> forme canonique. Volontairement prudent : on ne fusionne que des
// variantes évidentes du même ingrédient (pluriels, variétés courantes),
// jamais des équivalences gastronomiquement discutables (ex: crème fraîche
// et crème liquide restent distinctes malgré leur proximité, car une recette
// peut vraiment exiger l'une plutôt que l'autre).
export const INGREDIENT_ALIASES = {
  'tomates': 'tomate',
  'tomates cerises': 'tomate',
  'tomate cerise': 'tomate',
  'courgettes': 'courgette',
  'aubergines': 'aubergine',
  'carottes': 'carotte',
  'oignons': 'oignon',
  'gousse d’ail': 'ail',
  "gousse d'ail": 'ail',
  'gousses d’ail': 'ail',
  "gousses d'ail": 'ail',
  'pommes de terre': 'pomme de terre',
  'patate': 'pomme de terre',
  'patates': 'pomme de terre',
  'poireaux': 'poireau',
  'champignons': 'champignon',
  'champignon de paris': 'champignon',
  'champignons de paris': 'champignon',
  'poivrons': 'poivron',
  'poivron rouge': 'poivron',
  'poivron vert': 'poivron',
  'brocolis': 'brocoli',
  'épinards': 'épinard',
  'epinard': 'épinard',
  'epinards': 'épinard',
  'salades': 'salade',
  'concombres': 'concombre',
  'petit pois': 'petits pois',
  'haricots verts': 'haricot vert',

  'poulets': 'poulet',
  'blanc de poulet': 'poulet',
  'blancs de poulet': 'poulet',
  'filet de poulet': 'poulet',
  'filets de poulet': 'poulet',
  'escalope de poulet': 'poulet',
  'escalopes de poulet': 'poulet',
  'cuisse de poulet': 'poulet',
  'cuisses de poulet': 'poulet',
  'boeuf': 'bœuf',
  'steak': 'steak haché',
  'steaks hachés': 'steak haché',
  'viande hachée': 'steak haché',
  'porcs': 'porc',
  'dindes': 'dinde',
  'escalope de dinde': 'dinde',

  'saumons': 'saumon',
  'pavé de saumon': 'saumon',
  'pavés de saumon': 'saumon',
  'crevettes': 'crevette',
  'moules': 'moule',

  'crème': 'crème fraîche',
  'crème liquide': 'crème fraîche',
  'crème épaisse': 'crème fraîche',
  'oeuf': 'œuf',
  'oeufs': 'œuf',
  'œufs': 'œuf',
  'yaourts': 'yaourt',

  'pâte': 'pâtes',
  'spaghetti': 'pâtes',
  'spaghettis': 'pâtes',
  'penne': 'pâtes',
  'tagliatelles': 'pâtes',
  'lentille': 'lentilles',
  'pois chiches': 'pois chiche',

  'huile d olive': "huile d'olive",
  "huile d'olives": "huile d'olive",
  'bouillon de légumes': 'bouillon',
  'bouillon de volaille': 'bouillon',
  'bouillon de poule': 'bouillon',
  'cube de bouillon': 'bouillon',
  'citrons': 'citron',
  'gingembres': 'gingembre',
};

// Pondération utilisée par le moteur de matching (js/matching.js).
// - basic : quasi toujours dispo, ne doit jamais pénaliser fortement.
// - secondary : valeur par défaut pour tout ce qui n'est pas classé ailleurs.
// - main : ingrédients qui définissent l'identité du plat.
const MAIN_INGREDIENTS = new Set([
  'œuf',
  'poulet', 'bœuf', 'steak haché', 'porc', 'jambon', 'dinde', 'agneau', 'veau',
  'saumon', 'cabillaud', 'thon', 'crevette', 'moule', 'colin',
  'riz', 'pâtes', 'semoule', 'quinoa', 'lentilles', 'pois chiche', 'boulgour',
  'courgette', 'aubergine', 'pomme de terre', 'brocoli', 'chou-fleur',
  'champignon', 'poivron', 'potiron', 'butternut',
]);

const BASIC_INGREDIENTS = new Set([
  // Seuls les ingrédients véritablement universels sont gratuits dans le
  // score. Farine, sucre, beurre, huile, ail ou oignon ne sont disponibles
  // que si l'utilisateur les a saisis ou activés dans ses produits de base.
  'sel', 'poivre', 'eau',
]);

export function ingredientTier(canonicalName) {
  if (BASIC_INGREDIENTS.has(canonicalName)) return 'basic';
  if (MAIN_INGREDIENTS.has(canonicalName)) return 'main';
  return 'secondary';
}

/**
 * Normalise un fragment de texte ("Champignons", "  Poulet ") vers sa forme
 * canonique connue du dictionnaire. Retourne le texte nettoyé (minuscule,
 * espaces normalisés) si aucune correspondance n'est trouvée, plutôt que de
 * rejeter l'ingrédient : l'utilisateur doit toujours pouvoir saisir un
 * aliment inconnu de notre dictionnaire.
 */
export function normalizeIngredient(raw) {
  if (!raw) return '';
  const cleaned = raw
    .toLowerCase()
    .normalize('NFC')
    .replace(/[.,;:!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  if (INGREDIENT_ALIASES[cleaned]) return INGREDIENT_ALIASES[cleaned];
  if (ALL_INGREDIENTS.includes(cleaned)) return cleaned;
  return cleaned;
}

/** Suggestions d'autocomplétion pour un préfixe saisi par l'utilisateur. */
export function suggestIngredients(query, limit = 6) {
  const q = (query || '').toLowerCase().trim();
  if (!q) return [];
  return ALL_INGREDIENTS.filter((name) => name.includes(q))
    .sort((a, b) => {
      const aStarts = a.startsWith(q) ? 0 : 1;
      const bStarts = b.startsWith(q) ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      return a.length - b.length;
    })
    .slice(0, limit);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Candidats triés du plus long/spécifique au plus court, pour qu'une
// expression composée ("filet de poulet") soit reconnue avant un mot
// générique isolé ("poulet"). Construit une seule fois au chargement.
const KNOWN_INGREDIENT_CANDIDATES = (() => {
  const map = new Map();
  for (const name of ALL_INGREDIENTS) map.set(name, name);
  for (const [alias, canonical] of Object.entries(INGREDIENT_ALIASES)) map.set(alias, canonical);
  return [...map.entries()].sort((a, b) => b[0].length - a[0].length);
})();

/**
 * Retrouve un ingrédient connu à l'intérieur d'une phrase libre (utile pour
 * les libellés d'ingrédients de recettes scrapées, ex: "300 g de filet de
 * poulet" -> "poulet"). Contrairement à `normalizeIngredient`, qui attend un
 * fragment déjà proche d'un nom d'ingrédient, cette fonction cherche une
 * correspondance n'importe où dans le texte. Retourne `null` si rien de
 * connu n'est trouvé plutôt que d'inventer une correspondance approximative.
 */
export function extractKnownIngredientFromPhrase(phrase) {
  const text = ` ${(phrase || '').toLowerCase().trim()} `;
  if (text.trim().length < 2) return null;
  for (const [candidate, canonical] of KNOWN_INGREDIENT_CANDIDATES) {
    const re = new RegExp(`(^|[^\\p{L}])${escapeRegExp(candidate)}([^\\p{L}]|$)`, 'iu');
    if (re.test(text)) return canonical;
  }
  return null;
}

export const QUICK_SUGGESTIONS = [
  { emoji: '🥕', name: 'carotte' },
  { emoji: '🍗', name: 'poulet' },
  { emoji: '🍅', name: 'tomate' },
  { emoji: '🥚', name: 'œuf' },
  { emoji: '🍚', name: 'riz' },
  { emoji: '🍝', name: 'pâtes' },
];
