#!/usr/bin/env node
// Construit data/recipes-fr.json (cache complet) et data/recipes-fr.compact.json
// (ce que le navigateur télécharge réellement) à partir de sources 100%
// publiques et non authentifiées de cookidoo.fr — voir
// docs/COOKIDOO_RESEARCH.md pour le détail de l'analyse technique.
//
// Conçu pour tourner à répétition (une fois par semaine via GitHub Actions,
// ou plusieurs fois manuellement pour peupler l'index initial) sans jamais
// repartir de zéro :
//  1. Récupère une clé Algolia sécurisée fraîche depuis le HTML public de
//     cookidoo.fr/search/fr-FR (expire au bout de 7 jours, jamais codée en
//     dur — voir getAlgoliaCredentials).
//  2. Découvre la quasi-totalité des identifiants de recettes françaises en
//     partitionnant l'index Algolia par facettes (catégorie, puis
//     difficulté, puis tranche de note pour les rares cellules encore trop
//     grosses) — voir discoverAllRecipeIds. Indépendant du dictionnaire
//     d'ingrédients de l'app : ça couvre tout le catalogue, pas seulement
//     ce qui matche un mot-clé connu.
//  3. Charge l'état persistant (data/index-state.json) : recettes déjà en
//     cache, échecs récents à ne pas retenter tout de suite.
//  4. Récupère en priorité les recettes découvertes mais jamais encore
//     scrapées (par popularité décroissante), puis — s'il reste du budget —
//     rafraîchit un petit lot des fiches les plus anciennes. Ne retélécharge
//     jamais une fiche déjà en cache et à jour.
//  5. Les erreurs par recette (404/403/timeout/qualité) sont journalisées et
//     n'interrompent jamais le run : seule une panne au niveau de la clé
//     Algolia elle-même est fatale.
//  6. Écrit un résumé de statistiques clair, le cache complet, l'état
//     persistant, et un index compact (uniquement les champs utiles au
//     matching et à l'affichage) destiné au navigateur.

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { extractKnownIngredientFromPhrase } from '../js/ingredients.js';
import { extractQuantity, stripLeadingFillers } from '../js/parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const CACHE_PATH = path.join(DATA_DIR, 'recipes-fr.json');
const COMPACT_PATH = path.join(DATA_DIR, 'recipes-fr.compact.json');
const STATE_PATH = path.join(DATA_DIR, 'index-state.json');

const SEARCH_PAGE_URL = 'https://cookidoo.fr/search/fr-FR';
const RECIPE_INDEX = 'recipes-production-fr';
// Filtre exact qui scope l'index multi-marché aux recettes du marché
// français (vérifié manuellement : correspond au total affiché sur
// cookidoo.fr/search/fr-FR).
const FR_FILTER = 'countries:fr';
// Limite dure d'Algolia : une requête de recherche ne peut jamais renvoyer
// plus de 1000 résultats, quel que soit nbHits. Au-delà, il faut
// partitionner la requête en sous-ensembles plus petits.
const MAX_HITS_PER_QUERY = 1000;
const RATING_BUCKETS = ['rating<4.3', 'rating>=4.3 AND rating<4.6', 'rating>=4.6'];

// Cette limite protège cookidoo.fr d'un run unique trop lourd — elle ne
// plafonne pas le catalogue dans le temps : on la remplit à nouveau à
// chaque exécution (planifiée ou manuelle) jusqu'à couvrir tout ce qui est
// raisonnablement récupérable.
const MAX_NEW_DETAIL_FETCHES_PER_RUN = 1200;
const MAX_TOTAL_RECIPES = 15000;
// Au-delà de ce nombre de jours sans avoir été revérifiée, une fiche déjà
// connue est candidate à un nouveau téléchargement (ingrédients modifiés,
// recette dépubliée...), seulement si le budget du run le permet une fois
// les nouvelles découvertes traitées en priorité.
const STALE_REFRESH_DAYS = 120;
// Une recette qui échoue (404, non traduite, etc.) n'est pas retentée avant
// ce délai : ça évite de re-frapper indéfiniment des fiches qui ont de
// bonnes chances d'échouer à nouveau pour la même raison.
const FAILURE_COOLDOWN_DAYS = 21;
const REQUEST_TIMEOUT_MS = 15000;
const DETAIL_REQUEST_DELAY_MS = 500;
const DISCOVERY_REQUEST_DELAY_MS = 150;
const USER_AGENT =
  'FrigoMixBot/1.0 (projet hobby non commercial ; rafraîchit un index public de découverte de recettes ; contact via le dépôt GitHub du projet)';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function categorizeError(err) {
  const msg = String(err?.message || err);
  if (/^404/.test(msg)) return '404';
  if (/^403/.test(msg)) return '403';
  if (/timeout|abort/i.test(msg)) return 'timeout';
  return 'autre';
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, 'accept-language': 'fr-FR' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
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

function buildParams(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(typeof v === 'string' || typeof v === 'number' ? v : JSON.stringify(v))}`)
    .join('&');
}

async function algoliaQuery({ appId, apiKey }, params) {
  const url = `https://${appId.toLowerCase()}-dsn.algolia.net/1/indexes/*/queries?x-algolia-agent=${encodeURIComponent(
    'FrigoMix-update-script'
  )}&x-algolia-api-key=${apiKey}&x-algolia-application-id=${appId}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: JSON.stringify({ requests: [{ indexName: RECIPE_INDEX, params }] }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Algolia ${res.status} pour "${params}"`);
  const json = await res.json();
  return json.results?.[0];
}

function resolveImage(templated) {
  if (!templated) return null;
  return templated.replace('{assethost}', 'assets.tmecosys.com').replace('{transformation}', 't_web_shared_recipe_221x240');
}

async function countHits(credentials, filters) {
  const result = await algoliaQuery(credentials, buildParams({ query: '', hitsPerPage: 0, filters }));
  return result?.nbHits ?? 0;
}

async function discoverFacetValues(credentials, facetName, filters) {
  const result = await algoliaQuery(credentials, buildParams({ query: '', hitsPerPage: 0, filters, facets: [facetName] }));
  return Object.keys(result?.facets?.[facetName] || {});
}

async function collectHits(credentials, filters, discovered) {
  const result = await algoliaQuery(credentials, buildParams({ query: '', hitsPerPage: MAX_HITS_PER_QUERY, filters }));
  for (const hit of result?.hits || []) {
    if (!hit.id) continue;
    discovered.set(hit.id, {
      title: hit.title,
      rating: hit.rating ?? null,
      numberOfRatings: hit.numberOfRatings ?? null,
      totalTime: hit.totalTime ?? null,
      image: resolveImage(hit.image),
    });
  }
}

/**
 * Découpe récursivement une partition de l'index tant qu'elle dépasse la
 * limite Algolia de 1000 résultats par requête : catégorie d'abord (~20
 * valeurs, la dimension avec le meilleur pouvoir de découpage), puis
 * difficulté, puis tranche de note pour les rares cellules encore trop
 * grosses. Une erreur réseau sur une branche ne fait perdre que cette
 * branche (journalisée), jamais tout le run.
 */
async function discoverPartition(credentials, filters, discovered, fallbackLevel = 0) {
  let nbHits;
  try {
    nbHits = await countHits(credentials, filters);
  } catch (err) {
    console.warn(`  ⚠ comptage échoué pour "${filters}" (${err.message}), branche ignorée.`);
    return;
  }
  await sleep(DISCOVERY_REQUEST_DELAY_MS);
  if (nbHits === 0) return;

  try {
    if (nbHits <= MAX_HITS_PER_QUERY) {
      await collectHits(credentials, filters, discovered);
      await sleep(DISCOVERY_REQUEST_DELAY_MS);
      return;
    }

    if (fallbackLevel === 0) {
      const categories = await discoverFacetValues(credentials, 'categories.id', filters);
      await sleep(DISCOVERY_REQUEST_DELAY_MS);
      for (const category of categories) {
        await discoverPartition(credentials, `${filters} AND categories.id:"${category}"`, discovered, 1);
      }
      return;
    }

    if (fallbackLevel === 1) {
      const difficulties = await discoverFacetValues(credentials, 'difficulty', filters);
      await sleep(DISCOVERY_REQUEST_DELAY_MS);
      for (const value of difficulties) {
        await discoverPartition(credentials, `${filters} AND difficulty:"${value}"`, discovered, 2);
      }
      return;
    }

    if (fallbackLevel === 2) {
      for (const bucket of RATING_BUCKETS) {
        await discoverPartition(credentials, `${filters} AND ${bucket}`, discovered, 3);
      }
      return;
    }

    console.warn(`  ⚠ partition encore trop large (${nbHits} résultats) après tous les axes de découpe, capture partielle : ${filters}`);
    await collectHits(credentials, filters, discovered);
  } catch (err) {
    console.warn(`  ⚠ découverte échouée pour "${filters}" (${err.message}), branche ignorée.`);
  }
}

async function discoverAllRecipeIds(credentials) {
  const discovered = new Map();
  await discoverPartition(credentials, FR_FILTER, discovered);
  // Note : au-delà d'un certain volume, nbHits devient une estimation
  // d'Algolia plutôt qu'un compte exact, donc on n'affiche pas de
  // pourcentage de couverture qui donnerait une fausse précision.
  console.log(`${discovered.size} recettes distinctes découvertes.`);
  return discovered;
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

async function readJsonSafe(filePath, fallback) {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function isInCooldown(failureEntry) {
  if (!failureEntry) return false;
  const elapsedDays = (Date.now() - new Date(failureEntry.lastAttempt).getTime()) / (24 * 3600 * 1000);
  return elapsedDays < FAILURE_COOLDOWN_DAYS;
}

/** Ne garde que les champs utiles au matching et à l'affichage côté navigateur. */
function toCompactRecipe(recipe) {
  return {
    id: recipe.id,
    name: recipe.name,
    ingredients: recipe.ingredients,
    totalTime: recipe.totalTime,
    servings: recipe.servings,
    difficulty: recipe.difficulty,
    category: recipe.category,
    rating: recipe.rating,
    image: recipe.image,
    url: recipe.url,
  };
}

async function main() {
  console.log('Récupération d’une clé Algolia fraîche depuis cookidoo.fr...');
  const credentials = await getAlgoliaCredentials();
  console.log(`Clé obtenue, valide jusqu’au ${new Date(credentials.validUntil * 1000).toISOString()}.`);

  console.log('Découverte des recettes par partitionnement de facettes (catégorie / difficulté / note)...');
  const discovered = await discoverAllRecipeIds(credentials);

  const existingCache = await readJsonSafe(CACHE_PATH, []);
  const cache = new Map((Array.isArray(existingCache) ? existingCache : []).filter((r) => r.ingredients?.length).map((r) => [r.id, r]));
  console.log(`${cache.size} recettes déjà en cache avec ingrédients.`);

  const state = await readJsonSafe(STATE_PATH, { failedIds: {} });
  const failedIds = state.failedIds || {};

  // On part de TOUT le cache existant (pas seulement ce qui a été
  // redécouvert cette exécution) : une recette déjà connue et valide ne
  // doit jamais disparaître de l'index simplement parce que le passage de
  // découverte de cette exécution ne l'a pas re-croisée (Algolia peut faire
  // varier légèrement ses résultats d'une requête à l'autre).
  const final = new Map(cache);

  const stats = { discovered: discovered.size, alreadyCached: 0, newlyFetched: 0, refreshed: 0, removed404: 0, skippedCooldown: 0, errors: { '404': 0, '403': 0, timeout: 0, autre: 0, qualite: 0 } };

  const needsFetch = [];
  for (const [id, meta] of discovered) {
    const cached = cache.get(id);
    if (cached) {
      stats.alreadyCached += 1;
      // On rafraîchit note/temps/image depuis Algolia (pas de coût réseau
      // supplémentaire) mais on garde les ingrédients déjà scrapés.
      final.set(id, {
        ...cached,
        rating: meta.rating ?? cached.rating,
        numberOfRatings: meta.numberOfRatings ?? cached.numberOfRatings,
      });
      continue;
    }
    if (isInCooldown(failedIds[id])) {
      stats.skippedCooldown += 1;
      continue;
    }
    needsFetch.push([id, meta]);
  }

  // On priorise les recettes les plus notées : ce sont celles qui ont le
  // plus de chances d'être vraiment utiles aux utilisateurs de FrigoMix.
  needsFetch.sort((a, b) => (b[1].numberOfRatings || 0) - (a[1].numberOfRatings || 0));
  let toFetch = needsFetch.slice(0, MAX_NEW_DETAIL_FETCHES_PER_RUN).map(([id, meta]) => [id, meta, 'new']);
  const remainingAfterNew = needsFetch.length - toFetch.length;
  if (remainingAfterNew > 0) {
    console.log(`${remainingAfterNew} nouvelles recettes découvertes reportées à une prochaine exécution (budget de ${MAX_NEW_DETAIL_FETCHES_PER_RUN} fiches par run atteint).`);
  }

  // S'il reste du budget après les nouvelles découvertes, on rafraîchit en
  // priorité les fiches les plus anciennes (Cookidoo peut modifier une
  // recette après son premier scrape).
  const remainingBudget = MAX_NEW_DETAIL_FETCHES_PER_RUN - toFetch.length;
  if (remainingBudget > 0) {
    const staleCutoffMs = Date.now() - STALE_REFRESH_DAYS * 24 * 3600 * 1000;
    const alreadyQueued = new Set(toFetch.map(([id]) => id));
    const staleCandidates = [...cache.values()]
      .filter((r) => !alreadyQueued.has(r.id) && (!r.updatedAt || new Date(r.updatedAt).getTime() < staleCutoffMs))
      .sort((a, b) => new Date(a.updatedAt || 0) - new Date(b.updatedAt || 0))
      .slice(0, remainingBudget);
    for (const r of staleCandidates) {
      toFetch.push([r.id, { title: r.name, numberOfRatings: r.numberOfRatings, rating: r.rating, totalTime: r.totalTime, image: r.image }, 'stale']);
    }
    if (staleCandidates.length) {
      console.log(`${staleCandidates.length} fiches de plus de ${STALE_REFRESH_DAYS}j ajoutées au rafraîchissement.`);
    }
  }

  for (const [id, meta, reason] of toFetch) {
    try {
      const detail = await fetchRecipeDetail(id);
      if (detail.ingredients.length < 2) {
        stats.errors.qualite += 1;
        console.warn(`  ⚠ ${id} (${meta.title}) : extraction d’ingrédients trop pauvre, ignorée.`);
      } else if (detail.ingredients.length >= 4 && detail.recognitionRate < 0.3) {
        stats.errors.qualite += 1;
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
          updatedAt: new Date().toISOString(),
        });
        if (reason === 'new') stats.newlyFetched += 1;
        else stats.refreshed += 1;
        delete failedIds[id];
      }
    } catch (err) {
      const kind = categorizeError(err);
      stats.errors[kind] = (stats.errors[kind] || 0) + 1;
      failedIds[id] = { reason: kind, message: String(err.message || err), lastAttempt: new Date().toISOString(), attempts: (failedIds[id]?.attempts || 0) + 1 };
      if (kind === '404' && reason === 'stale') {
        // La recette a disparu de Cookidoo : on ne la garde pas, un lien
        // mort ne rendrait pas service à l'utilisateur.
        final.delete(id);
        stats.removed404 += 1;
        console.warn(`  ⚠ ${id} : 404, retirée de l'index (recette probablement dépubliée).`);
      } else {
        console.warn(`  ⚠ fiche ${id} ignorée (${kind}) : ${err.message}`);
      }
    }
    await sleep(DETAIL_REQUEST_DELAY_MS);
  }

  let recipes = [...final.values()];
  if (recipes.length > MAX_TOTAL_RECIPES) {
    recipes.sort((a, b) => (b.numberOfRatings || 0) - (a.numberOfRatings || 0));
    console.log(`Index limité à ${MAX_TOTAL_RECIPES} recettes (${recipes.length - MAX_TOTAL_RECIPES} les moins notées écartées).`);
    recipes = recipes.slice(0, MAX_TOTAL_RECIPES);
  }
  recipes.sort((a, b) => a.id.localeCompare(b.id));

  await writeFile(CACHE_PATH, JSON.stringify(recipes, null, 2) + '\n', 'utf8');

  const compact = recipes.map(toCompactRecipe);
  await writeFile(COMPACT_PATH, JSON.stringify(compact) + '\n', 'utf8');

  const nextState = {
    lastRun: new Date().toISOString(),
    failedIds,
    lastStats: { ...stats, totalFinal: recipes.length },
  };
  await writeFile(STATE_PATH, JSON.stringify(nextState, null, 2) + '\n', 'utf8');

  const errorTotal = Object.values(stats.errors).reduce((a, b) => a + b, 0);
  console.log('');
  console.log('=== Résumé ===');
  console.log(`Recettes découvertes cette exécution : ${stats.discovered}`);
  console.log(`Déjà en cache (non retéléchargées)   : ${stats.alreadyCached}`);
  console.log(`Ignorées (échec récent, cooldown)     : ${stats.skippedCooldown}`);
  console.log(`Nouvelles fiches téléchargées          : ${stats.newlyFetched}`);
  console.log(`Fiches anciennes rafraîchies            : ${stats.refreshed}`);
  console.log(`Retirées (404, dépubliées)             : ${stats.removed404}`);
  console.log(`Erreurs — 404:${stats.errors['404']} 403:${stats.errors['403']} timeout:${stats.errors.timeout} qualité:${stats.errors.qualite} autre:${stats.errors.autre} (total ${errorTotal})`);
  console.log(`Total final indexé                      : ${recipes.length}`);
  console.log(`Index compact écrit (${compact.length} recettes) : ${COMPACT_PATH}`);
}

main().catch((err) => {
  console.error('Échec de la mise à jour de l’index :', err);
  process.exitCode = 1;
});
