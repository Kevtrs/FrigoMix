#!/usr/bin/env node
// Construit data/recipes-fr.json à partir de sources 100% publiques et non
// authentifiées de cookidoo.fr — voir docs/COOKIDOO_RESEARCH.md pour le
// détail de l'analyse technique qui justifie cette approche.
//
// Étapes :
//  1. Récupère une clé Algolia sécurisée fraîche depuis le HTML public de
//     cookidoo.fr/search/fr-FR (cette clé expire au bout de 7 jours, d'où
//     l'exécution hebdomadaire de ce script par GitHub Actions).
//  2. Interroge Algolia (recherche officielle du site, CORS ouvert, mais ici
//     appelée côté serveur donc CORS n'entre pas en jeu) pour une liste
//     raisonnable de mots-clés d'ingrédients courants, afin de découvrir des
//     identifiants de recettes.
//  3. Pour chaque recette nouvellement découverte (pas déjà en cache), va
//     chercher sa fiche publique (sans compte) pour en extraire les vrais
//     ingrédients, le temps, les portions et la difficulté.
//  4. Fusionne avec l'index existant (cache par id) pour ne jamais
//     re-télécharger une recette déjà connue, et écrit data/recipes-fr.json.
//
// Aucun identifiant, aucun secret, aucun proxy tiers. Uniquement des
// requêtes HTTP vers des pages/endpoints publics de cookidoo.fr et
// d'algolia.net, avec une temporisation entre chaque appel.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ALL_INGREDIENTS, extractKnownIngredientFromPhrase } from '../js/ingredients.js';
import { extractQuantity, stripLeadingFillers } from '../js/parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, '..', 'data', 'recipes-fr.json');

const SEARCH_PAGE_URL = 'https://cookidoo.fr/search/fr-FR';
const RECIPE_INDEX = 'recipes-production-fr';
const HITS_PER_TERM = 8;
const MAX_TOTAL_RECIPES = 500;
// Une exécution ne va chercher les vraies fiches (ingrédients) que pour un
// nombre borné de recettes nouvellement découvertes : le reste sera repris
// automatiquement à la prochaine exécution hebdomadaire, via le cache déjà
// écrit dans data/recipes-fr.json. Ça garde chaque run court et respectueux
// du serveur de Cookidoo, quitte à ce que l'index se complète sur plusieurs
// semaines plutôt que tout d'un coup.
const MAX_NEW_DETAIL_FETCHES_PER_RUN = 150;
const DETAIL_REQUEST_DELAY_MS = 500;
const DISCOVERY_REQUEST_DELAY_MS = 150;
const USER_AGENT =
  'FrigoMixBot/1.0 (projet hobby non commercial ; rafraîchit un index public de découverte de recettes une fois par semaine ; contact via le dépôt GitHub du projet)';

// On réutilise directement le dictionnaire d'ingrédients de l'app comme
// mots-clés de découverte : c'est exactement ce que les utilisateurs de
// FrigoMix vont saisir, donc la couverture de l'index colle à l'usage réel.
const SEARCH_TERMS = ALL_INGREDIENTS;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, 'accept-language': 'fr-FR' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} sur ${url}`);
  return res.text();
}

function extractNextData(html) {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('__NEXT_DATA__ introuvable — la structure du site a peut-être changé.');
  return JSON.parse(match[1]);
}

async function getAlgoliaCredentials() {
  const html = await fetchText(SEARCH_PAGE_URL);
  const nextData = extractNextData(html);
  const data = nextData?.props?.pageProps?.algoliaApiKeyData;
  const appId = nextData?.props?.pageProps?.algoliaAppId;
  if (!data?.apiKey || !appId) {
    throw new Error('Clé Algolia introuvable dans __NEXT_DATA__ — la structure du site a peut-être changé.');
  }
  return { apiKey: data.apiKey, appId, validUntil: data.validUntil };
}

async function algoliaSearch({ appId, apiKey }, query, hitsPerPage) {
  const url = `https://${appId.toLowerCase()}-dsn.algolia.net/1/indexes/*/queries?x-algolia-agent=${encodeURIComponent(
    'FrigoMix-update-script'
  )}&x-algolia-api-key=${apiKey}&x-algolia-application-id=${appId}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: JSON.stringify({ requests: [{ indexName: RECIPE_INDEX, params: `query=${encodeURIComponent(query)}&hitsPerPage=${hitsPerPage}` }] }),
  });
  if (!res.ok) throw new Error(`Algolia ${res.status} pour "${query}"`);
  const json = await res.json();
  return json.results?.[0]?.hits ?? [];
}

function resolveImage(templated) {
  if (!templated) return null;
  return templated.replace('{assethost}', 'assets.tmecosys.com').replace('{transformation}', 't_web_shared_recipe_221x240');
}

// La fiche recette publique embarque un bloc JSON-LD standard schema.org/Recipe
// dans le <head> (destiné aux moteurs de recherche, donc explicitement conçu
// pour être lu par des programmes tiers). C'est une source bien plus fiable
// que du scraping de texte : ingrédients propres un par ligne, temps au
// format ISO 8601, portions, catégorie... Seule la difficulté n'y figure
// pas, elle est récupérée séparément via un petit motif ciblé dans le HTML.
function extractJsonLd(html) {
  const match = html.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function parseIso8601DurationToSeconds(duration) {
  if (!duration) return null;
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!match) return null;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  return hours * 3600 + minutes * 60 || null;
}

function extractDifficulty(html) {
  const match = html.match(/id="difficulty-section"[\s\S]{0,400}?<p>\s*([^<]+?)\s*<\/p>/i);
  if (!match) return null;
  const label = match[1].trim().toLowerCase();
  return label ? label[0].toUpperCase() + label.slice(1) : null;
}

const CATEGORY_KEYWORDS = [
  { match: /dessert|gâteau|pâtisserie|tarte sucrée|biscuit/i, category: 'Dessert' },
  { match: /soupe|velouté|potage/i, category: 'Soupe' },
  { match: /apéritif|amuse-bouche/i, category: 'Apéritif' },
  { match: /sauce|condiment/i, category: 'Sauce' },
  { match: /entrée|amuse-bouche|salade/i, category: 'Entrée' },
];

function mapCategory(recipeCategory) {
  const joined = (recipeCategory || []).join(' ');
  const found = CATEGORY_KEYWORDS.find((k) => k.match.test(joined));
  return found ? found.category : 'Plat';
}

/** Retrouve un ingrédient connu dans un libellé brut type "300 g de filet de poulet, sans peau". */
function extractIngredientName(rawLine) {
  const beforeComma = rawLine.split(',')[0]; // la clause après la virgule est une note ("sans peau"), pas l'ingrédient
  const { rest } = extractQuantity(beforeComma.trim());
  const core = stripLeadingFillers(rest);
  if (!core) return null;
  const known = extractKnownIngredientFromPhrase(core);
  return { name: known || core.toLowerCase(), recognized: Boolean(known) };
}

/** Extrait ingrédients / portions / temps / difficulté / catégorie de la fiche recette publique. */
function parseRecipePage(html) {
  const jsonLd = extractJsonLd(html);
  const rawIngredients = jsonLd?.recipeIngredient || [];
  const parsedIngredients = rawIngredients.map(extractIngredientName).filter(Boolean);
  const ingredients = [...new Set(parsedIngredients.map((i) => i.name))];
  const recognizedCount = parsedIngredients.filter((i) => i.recognized).length;
  // Certaines fiches indexées côté fr-FR n'ont en réalité pas encore été
  // traduites (fallback dans une autre langue). On les détecte en mesurant
  // la part d'ingrédients reconnus dans notre dictionnaire français plutôt
  // que d'essayer de deviner une langue explicitement.
  const recognitionRate = parsedIngredients.length ? recognizedCount / parsedIngredients.length : 0;

  const servingsMatch = jsonLd?.recipeYield?.match?.(/\d+/);
  const servings = servingsMatch ? Number(servingsMatch[0]) : null;

  return {
    ingredients,
    recognitionRate,
    servings,
    totalTimeFromPage: parseIso8601DurationToSeconds(jsonLd?.totalTime),
    difficulty: extractDifficulty(html),
    category: mapCategory(jsonLd?.recipeCategory),
    image: jsonLd?.image || null,
    name: jsonLd?.name || null,
  };
}

async function fetchRecipeDetail(id) {
  const url = `https://cookidoo.fr/recipes/recipe/fr-FR/${id}`;
  const html = await fetchText(url);
  return { ...parseRecipePage(html), url };
}

async function main() {
  console.log('Récupération d’une clé Algolia fraîche depuis cookidoo.fr...');
  const credentials = await getAlgoliaCredentials();
  console.log(`Clé obtenue, valide jusqu’au ${new Date(credentials.validUntil * 1000).toISOString()}.`);

  const discovered = new Map(); // id -> {title, rating, numberOfRatings, totalTime, image}
  console.log(`Découverte de recettes sur ${SEARCH_TERMS.length} mots-clés...`);
  for (const term of SEARCH_TERMS) {
    try {
      const hits = await algoliaSearch(credentials, term, HITS_PER_TERM);
      for (const hit of hits) {
        if (!hit.id) continue;
        discovered.set(hit.id, {
          title: hit.title,
          rating: hit.rating ?? null,
          numberOfRatings: hit.numberOfRatings ?? null,
          totalTime: hit.totalTime ?? null,
          image: resolveImage(hit.image),
        });
      }
    } catch (err) {
      console.warn(`  ⚠ recherche "${term}" ignorée : ${err.message}`);
    }
    await sleep(DISCOVERY_REQUEST_DELAY_MS);
  }
  console.log(`${discovered.size} recettes distinctes découvertes via Algolia.`);

  let existing = [];
  try {
    existing = JSON.parse(await readFile(OUTPUT_PATH, 'utf8'));
    if (!Array.isArray(existing)) existing = [];
  } catch {
    existing = [];
  }
  const cache = new Map(existing.filter((r) => r.ingredients?.length).map((r) => [r.id, r]));
  console.log(`${cache.size} recettes déjà en cache avec ingrédients (pas re-téléchargées).`);

  const final = new Map();
  const needsFetch = [];
  for (const [id, meta] of discovered) {
    const cached = cache.get(id);
    if (cached) {
      // On rafraîchit note/temps/image depuis Algolia (pas de coût réseau
      // supplémentaire) mais on garde les ingrédients déjà scrapés.
      final.set(id, {
        ...cached,
        rating: meta.rating ?? cached.rating,
        numberOfRatings: meta.numberOfRatings ?? cached.numberOfRatings,
      });
    } else {
      needsFetch.push([id, meta]);
    }
  }

  // On priorise les recettes les plus notées : ce sont celles qui ont le
  // plus de chances d'être vraiment utiles aux utilisateurs de FrigoMix.
  needsFetch.sort((a, b) => (b[1].numberOfRatings || 0) - (a[1].numberOfRatings || 0));
  const toFetch = needsFetch.slice(0, MAX_NEW_DETAIL_FETCHES_PER_RUN);
  if (needsFetch.length > toFetch.length) {
    console.log(
      `${needsFetch.length - toFetch.length} nouvelles recettes découvertes reportées à une prochaine exécution (limite de ${MAX_NEW_DETAIL_FETCHES_PER_RUN} nouvelles fiches par run).`
    );
  }

  let fetchedCount = 0;
  for (const [id, meta] of toFetch) {
    try {
      const detail = await fetchRecipeDetail(id);
      if (detail.ingredients.length < 2) {
        console.warn(`  ⚠ ${id} (${meta.title}) : extraction d’ingrédients trop pauvre, ignorée.`);
      } else if (detail.ingredients.length >= 4 && detail.recognitionRate < 0.3) {
        console.warn(`  ⚠ ${id} (${meta.title}) : fiche probablement non traduite en français, ignorée.`);
      } else {
        final.set(id, {
          id,
          name: meta.title || detail.name,
          ingredients: detail.ingredients,
          rating: meta.rating,
          numberOfRatings: meta.numberOfRatings,
          totalTime: meta.totalTime ?? detail.totalTimeFromPage,
          servings: detail.servings,
          difficulty: detail.difficulty,
          category: detail.category,
          image: detail.image || meta.image,
          url: detail.url,
        });
        fetchedCount += 1;
      }
    } catch (err) {
      console.warn(`  ⚠ fiche ${id} ignorée : ${err.message}`);
    }
    await sleep(DETAIL_REQUEST_DELAY_MS);
  }
  console.log(`${fetchedCount} nouvelles fiches recette téléchargées et analysées.`);

  let recipes = [...final.values()];
  if (recipes.length > MAX_TOTAL_RECIPES) {
    recipes.sort((a, b) => (b.numberOfRatings || 0) - (a.numberOfRatings || 0));
    console.log(`Index limité à ${MAX_TOTAL_RECIPES} recettes (${recipes.length - MAX_TOTAL_RECIPES} les moins notées écartées).`);
    recipes = recipes.slice(0, MAX_TOTAL_RECIPES);
  }
  recipes.sort((a, b) => a.id.localeCompare(b.id));

  await writeFile(OUTPUT_PATH, JSON.stringify(recipes, null, 2) + '\n', 'utf8');
  console.log(`data/recipes-fr.json écrit avec ${recipes.length} recettes.`);
}

main().catch((err) => {
  console.error('Échec de la mise à jour de l’index :', err);
  process.exitCode = 1;
});
