// Toutes les données utilisateur restent dans le navigateur (localStorage).
// Aucun réseau, aucun compte. Chaque accès est protégé par un try/catch pour
// rester robuste en navigation privée (où localStorage peut lever une
// exception plutôt que d'être simplement absent).
import { CONFIG } from './config.js';

const PREFIX = 'frigomix:';
const KEYS = {
  staples: PREFIX + 'staples',
  favorites: PREFIX + 'favorites',
  history: PREFIX + 'history',
  cooked: PREFIX + 'cooked',
};

const MAX_HISTORY = 10;

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Stockage indisponible (navigation privée, quota) : on dégrade
    // silencieusement, l'app reste utilisable sans persistance.
  }
}

// --- Ingrédients "j'ai généralement chez moi" ---

export function getEnabledStaples() {
  return readJSON(KEYS.staples, CONFIG.DEFAULT_PANTRY_STAPLES);
}

export function setEnabledStaples(list) {
  writeJSON(KEYS.staples, [...new Set(list)]);
}

// --- Favoris ---

export function getFavorites() {
  return readJSON(KEYS.favorites, []);
}

export function isFavorite(recipeId) {
  return getFavorites().includes(recipeId);
}

export function toggleFavorite(recipeId) {
  const favs = getFavorites();
  const idx = favs.indexOf(recipeId);
  if (idx === -1) favs.push(recipeId);
  else favs.splice(idx, 1);
  writeJSON(KEYS.favorites, favs);
  return favs.includes(recipeId);
}

// --- "Je la fais" (historique de recettes réalisées) ---

export function getCookedRecipeIds() {
  return readJSON(KEYS.cooked, []);
}

export function markRecipeCooked(recipeId) {
  const cooked = getCookedRecipeIds();
  if (!cooked.includes(recipeId)) {
    cooked.unshift(recipeId);
    writeJSON(KEYS.cooked, cooked.slice(0, 50));
  }
}

// --- Historique de recherches ---

export function getSearchHistory() {
  return readJSON(KEYS.history, []);
}

export function addSearchHistoryEntry(ingredientNames) {
  if (!ingredientNames.length) return;
  const history = getSearchHistory();
  const entry = { ingredients: ingredientNames, at: new Date().toISOString() };
  history.unshift(entry);
  writeJSON(KEYS.history, history.slice(0, MAX_HISTORY));
}

export function clearSearchHistory() {
  writeJSON(KEYS.history, []);
}
