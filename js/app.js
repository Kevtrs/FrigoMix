import { CONFIG } from './config.js';
import { suggestIngredients, normalizeIngredient, QUICK_SUGGESTIONS } from './ingredients.js';
import { parseIngredientInput } from './parser.js';
import { findMatchingRecipes, compatibilityLabel } from './matching.js';
import * as storage from './storage.js';
import { loadRecipesWithFallback, buildCookidooSearchUrl } from './providers/index.js';

const log = (...args) => { if (CONFIG.DEV_LOGS) console.debug('[FrigoMix]', ...args); };

// --- État ---
let allRecipes = [];
let pantry = []; // {normalized, raw, priority}
let forbidden = []; // {normalized, raw}
let enabledStaples = new Set(storage.getEnabledStaples());
let currentResults = [];
let visibleCount = CONFIG.RESULTS_PAGE_SIZE;
let hasSearchedOnce = false;

// --- Références DOM ---
const $ = (id) => document.getElementById(id);
const ingredientInput = $('ingredient-input');
const suggestionsList = $('suggestions-list');
const quickChipsEl = $('quick-chips');
const pantryChipsEl = $('pantry-chips');
const staplesListEl = $('staples-list');
const forbiddenInput = $('forbidden-input');
const forbiddenChipsEl = $('forbidden-chips');
const searchBtn = $('search-btn');
const cookidooFallbackBtn = $('cookidoo-fallback-btn');
const loadingState = $('loading-state');
const emptyState = $('empty-state');
const noResultsState = $('no-results-state');
const resultsList = $('results-list');
const loadMoreRow = $('load-more-row');
const loadMoreBtn = $('load-more-btn');
const favoritesListEl = $('favorites-list');
const favoritesEmptyEl = $('favorites-empty');
const historyListEl = $('history-list');
const historyEmptyEl = $('history-empty');
const toastEl = $('toast');

// --- Utilitaires UI ---

let toastTimer = null;
function showToast(message) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2200);
}

function setupCollapsible(toggleId, contentId) {
  const toggle = $(toggleId);
  const content = $(contentId);
  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!expanded));
    content.hidden = expanded;
  });
}

function formatTime(seconds) {
  if (!seconds) return null;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m}` : `${h} h`;
}

function resolveImage(recipe) {
  if (!recipe.image) return null;
  if (recipe.image.includes('{assethost}')) return null; // gabarit non résolu, on ignore
  return recipe.image;
}

// --- Ingrédients du frigo ---

function isAlreadyIn(list, normalized) {
  return list.some((item) => item.normalized === normalized);
}

function addPantryIngredients(entries) {
  let added = 0;
  for (const entry of entries) {
    if (isAlreadyIn(pantry, entry.normalized)) continue;
    if (isAlreadyIn(forbidden, entry.normalized)) continue;
    pantry.push({ normalized: entry.normalized, raw: entry.raw || entry.normalized, priority: false });
    added += 1;
  }
  if (added) renderPantryChips();
  updateSearchButtonState();
  return added;
}

function addPantryFromText(text) {
  const entries = parseIngredientInput(text);
  if (!entries.length) return;
  addPantryIngredients(entries);
}

function removePantryIngredient(normalized) {
  pantry = pantry.filter((item) => item.normalized !== normalized);
  renderPantryChips();
  updateSearchButtonState();
}

function togglePantryPriority(normalized) {
  const item = pantry.find((i) => i.normalized === normalized);
  if (item) item.priority = !item.priority;
  renderPantryChips();
}

function renderPantryChips() {
  pantryChipsEl.innerHTML = '';
  for (const item of pantry) {
    const li = document.createElement('li');
    li.className = 'chip' + (item.priority ? ' is-priority' : '');
    li.innerHTML = `
      <button type="button" class="chip__priority" data-action="priority" data-name="${item.normalized}"
        aria-pressed="${item.priority}" aria-label="Marquer ${item.normalized} à finir en priorité">⚠️</button>
      <span>${item.normalized}</span>
      <button type="button" class="chip__remove" data-action="remove-pantry" data-name="${item.normalized}"
        aria-label="Retirer ${item.normalized}">×</button>
    `;
    pantryChipsEl.appendChild(li);
  }
}

pantryChipsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const name = btn.dataset.name;
  if (btn.dataset.action === 'remove-pantry') removePantryIngredient(name);
  if (btn.dataset.action === 'priority') togglePantryPriority(name);
});

// --- Ingrédients interdits ---

function addForbiddenFromText(text) {
  const entries = parseIngredientInput(text);
  let added = 0;
  for (const entry of entries) {
    if (isAlreadyIn(forbidden, entry.normalized)) continue;
    forbidden.push({ normalized: entry.normalized, raw: entry.raw || entry.normalized });
    removePantryIngredient(entry.normalized);
    added += 1;
  }
  if (added) renderForbiddenChips();
}

function renderForbiddenChips() {
  forbiddenChipsEl.innerHTML = '';
  for (const item of forbidden) {
    const li = document.createElement('li');
    li.className = 'chip';
    li.innerHTML = `
      <span>${item.normalized}</span>
      <button type="button" class="chip__remove" data-name="${item.normalized}" aria-label="Retirer ${item.normalized} des exclusions">×</button>
    `;
    forbiddenChipsEl.appendChild(li);
  }
}

forbiddenChipsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-name]');
  if (!btn) return;
  forbidden = forbidden.filter((f) => f.normalized !== btn.dataset.name);
  renderForbiddenChips();
});

// --- Suggestions / autocomplétion ---

function renderSuggestions(query) {
  const known = [...pantry, ...forbidden].map((i) => i.normalized);
  const matches = suggestIngredients(query).filter((s) => !known.includes(s));
  if (!matches.length) {
    suggestionsList.hidden = true;
    suggestionsList.innerHTML = '';
    return;
  }
  suggestionsList.innerHTML = matches
    .map((name) => `<li role="option"><button type="button" data-name="${name}">${name}</button></li>`)
    .join('');
  suggestionsList.hidden = false;
}

ingredientInput.addEventListener('input', () => renderSuggestions(ingredientInput.value));
ingredientInput.addEventListener('blur', () => {
  setTimeout(() => { suggestionsList.hidden = true; }, 150);
});
suggestionsList.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-name]');
  if (!btn) return;
  addPantryIngredients([{ normalized: btn.dataset.name, raw: btn.dataset.name }]);
  ingredientInput.value = '';
  suggestionsList.hidden = true;
  ingredientInput.focus();
});

ingredientInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addPantryFromText(ingredientInput.value);
    ingredientInput.value = '';
    suggestionsList.hidden = true;
  }
});
$('add-ingredient-btn').addEventListener('click', () => {
  addPantryFromText(ingredientInput.value);
  ingredientInput.value = '';
  suggestionsList.hidden = true;
  ingredientInput.focus();
});

forbiddenInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    addForbiddenFromText(forbiddenInput.value);
    forbiddenInput.value = '';
  }
});
$('add-forbidden-btn').addEventListener('click', () => {
  addForbiddenFromText(forbiddenInput.value);
  forbiddenInput.value = '';
});

function renderQuickChips() {
  quickChipsEl.innerHTML = QUICK_SUGGESTIONS.map(
    (q) => `<button type="button" class="quick-chip" data-name="${q.name}">${q.emoji} ${q.name}</button>`
  ).join('');
}
quickChipsEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-name]');
  if (!btn) return;
  addPantryIngredients([{ normalized: btn.dataset.name, raw: btn.dataset.name }]);
});

// --- Ingrédients "j'ai généralement chez moi" ---

function renderStaples() {
  staplesListEl.innerHTML = CONFIG.TOGGLABLE_STAPLES.map((name) => {
    const checked = enabledStaples.has(name);
    return `
      <label class="staple-toggle${checked ? ' is-on' : ''}">
        <input type="checkbox" value="${name}" ${checked ? 'checked' : ''} />
        ${name}
      </label>
    `;
  }).join('');
}
staplesListEl.addEventListener('change', (e) => {
  const input = e.target;
  if (input.type !== 'checkbox') return;
  if (input.checked) enabledStaples.add(input.value);
  else enabledStaples.delete(input.value);
  storage.setEnabledStaples([...enabledStaples]);
  renderStaples();
});

// --- Filtres ---

function getFilters() {
  return {
    servings: $('filter-servings').value || null,
    maxTime: $('filter-time').value ? Number($('filter-time').value) : null,
    difficulty: $('filter-difficulty').value || null,
    category: $('filter-category').value || null,
    thermomixModel: $('filter-thermomix').value || null,
  };
}

function applyFilters(recipes, filters) {
  return recipes.filter((r) => {
    if (filters.maxTime && r.totalTime && r.totalTime > filters.maxTime) return false;
    if (filters.difficulty && r.difficulty && r.difficulty !== filters.difficulty) return false;
    if (filters.category && r.category && r.category !== filters.category) return false;
    if (filters.thermomixModel && r.thermomixModels && !r.thermomixModels.includes(filters.thermomixModel)) return false;
    return true;
  });
}

// --- Recherche ---

function updateSearchButtonState() {
  searchBtn.disabled = pantry.length === 0;
}

function buildPantrySets() {
  return {
    have: new Set(pantry.map((i) => i.normalized)),
    forbidden: new Set(forbidden.map((i) => i.normalized)),
    priority: new Set(pantry.filter((i) => i.priority).map((i) => i.normalized)),
    enabledStaples,
  };
}

async function runSearch() {
  hasSearchedOnce = true;
  visibleCount = CONFIG.RESULTS_PAGE_SIZE;
  emptyState.hidden = true;
  noResultsState.hidden = true;
  loadingState.hidden = false;
  resultsList.innerHTML = '';
  loadMoreRow.hidden = true;
  cookidooFallbackBtn.hidden = true;

  await new Promise((resolve) => setTimeout(resolve, 150)); // laisse le skeleton s'afficher

  const filters = getFilters();
  const pool = applyFilters(allRecipes, filters);
  const pantrySets = buildPantrySets();
  const { results } = findMatchingRecipes(pool, pantrySets);

  currentResults = results;
  storage.addSearchHistoryEntry(pantry.map((i) => i.normalized));
  renderHistory();

  loadingState.hidden = true;

  if (results.length === 0) {
    noResultsState.hidden = false;
    cookidooFallbackBtn.hidden = false;
    return;
  }

  renderResults();
}

function recipeCardHtml({ recipe, match }, { compact = false } = {}) {
  const image = resolveImage(recipe);
  const label = match ? compatibilityLabel(match.score) : null;
  const isFav = storage.isFavorite(recipe.id);
  const time = formatTime(recipe.totalTime);

  const haveList = match
    ? `<div class="recipe-card__section"><strong>Vous avez</strong><ul class="tag-list tag-list--have">${match.matchedIngredients
        .slice(0, 6)
        .map((i) => `<li>${i}</li>`)
        .join('')}</ul></div>`
    : '';
  const missingList = match && match.missingIngredients.length
    ? `<div class="recipe-card__section"><strong>Il vous manque</strong><ul class="tag-list tag-list--missing">${match.missingIngredients
        .map((i) => `<li>${i}</li>`)
        .join('')}</ul></div>`
    : '';

  return `
    <li class="recipe-card" data-id="${recipe.id}">
      <div class="recipe-card__top">
        ${image ? `<img class="recipe-card__image" src="${image}" alt="" loading="lazy" />` : ''}
        <div style="flex:1; min-width:0;">
          <div class="recipe-card__title-row">
            <h3 class="recipe-card__name">${recipe.name}</h3>
            <button type="button" class="favorite-btn" data-action="favorite" data-id="${recipe.id}"
              aria-pressed="${isFav}" aria-label="${isFav ? 'Retirer des favoris' : 'Ajouter aux favoris'}">${isFav ? '♥' : '♡'}</button>
          </div>
          ${label ? `<span class="score-badge">${Math.round(match.score * 100)} % · ${label}</span>` : ''}
          <div class="recipe-card__meta">
            ${time ? `<span>⏱ ${time}</span>` : ''}
            ${recipe.rating ? `<span>⭐ ${recipe.rating.toFixed(1)}</span>` : ''}
            ${recipe.servings ? `<span>👥 ${recipe.servings} personnes</span>` : ''}
          </div>
        </div>
      </div>
      ${haveList}
      ${missingList}
      <div class="thermomix-search">
        <p class="thermomix-search__label">À rechercher sur ton Thermomix</p>
        <p class="thermomix-search__name">${recipe.name}</p>
        <button type="button" class="btn btn--secondary btn--small" data-action="copy" data-name="${recipe.name}">Copier le nom</button>
      </div>
      <div class="recipe-card__actions">
        <a class="btn btn--primary" href="${recipe.url}" target="_blank" rel="noopener">Voir sur Cookidoo</a>
        ${compact ? '' : `<button type="button" class="btn btn--secondary" data-action="cooked" data-id="${recipe.id}">Je la fais</button>`}
      </div>
    </li>
  `;
}

function renderResults() {
  const slice = currentResults.slice(0, visibleCount);
  resultsList.innerHTML = slice.map((entry) => recipeCardHtml(entry)).join('');
  loadMoreRow.hidden = visibleCount >= currentResults.length;
}

loadMoreBtn.addEventListener('click', () => {
  visibleCount += CONFIG.RESULTS_PAGE_SIZE;
  renderResults();
});

resultsList.addEventListener('click', handleCardAction);
favoritesListEl.addEventListener('click', handleCardAction);

function handleCardAction(e) {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const { action, id, name } = btn.dataset;
  if (action === 'favorite') {
    const nowFav = storage.toggleFavorite(id);
    btn.textContent = nowFav ? '♥' : '♡';
    btn.setAttribute('aria-pressed', String(nowFav));
    btn.setAttribute('aria-label', nowFav ? 'Retirer des favoris' : 'Ajouter aux favoris');
    renderFavorites();
  } else if (action === 'cooked') {
    storage.markRecipeCooked(id);
    showToast('Ajoutée à ce que tu as déjà fait !');
  } else if (action === 'copy') {
    copyToClipboard(name);
  }
}

async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast('Nom copié !');
  } catch {
    showToast("Impossible de copier automatiquement, sélectionne le texte à la main.");
  }
}

searchBtn.addEventListener('click', runSearch);
cookidooFallbackBtn.addEventListener('click', async () => {
  const names = pantry.map((i) => i.normalized);
  // La recherche Cookidoo est une SPA qui ne lit pas sa propre query string
  // au chargement (vérifié manuellement : ouvrir /search/fr-FR?q=... affiche
  // le catalogue complet, pas les résultats filtrés). On ne peut donc pas
  // vraiment "préconfigurer" la recherche par URL : on ouvre la page et on
  // copie les ingrédients pour que l'utilisateur n'ait qu'à coller.
  try {
    await navigator.clipboard.writeText(names.join(' '));
    showToast('Ingrédients copiés — colle-les (Ctrl+V) dans la recherche Cookidoo');
  } catch {
    showToast('Recherche Cookidoo ouverte dans un nouvel onglet');
  }
  window.open(buildCookidooSearchUrl(names), '_blank', 'noopener');
});

// --- Favoris ---

function renderFavorites() {
  const ids = storage.getFavorites();
  const recipes = ids.map((id) => allRecipes.find((r) => r.id === id)).filter(Boolean);
  favoritesEmptyEl.hidden = recipes.length > 0;
  favoritesListEl.innerHTML = recipes.map((recipe) => recipeCardHtml({ recipe, match: null }, { compact: true })).join('');
}

// --- Historique ---

function renderHistory() {
  const history = storage.getSearchHistory();
  historyEmptyEl.hidden = history.length > 0;
  historyListEl.innerHTML = history
    .map((entry, idx) => {
      const date = new Date(entry.at);
      const when = Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('fr-FR');
      return `
        <li class="history-item">
          <button type="button" data-index="${idx}">${entry.ingredients.join(' + ')}</button>
          <time>${when}</time>
        </li>
      `;
    })
    .join('');
}
historyListEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-index]');
  if (!btn) return;
  const entry = storage.getSearchHistory()[Number(btn.dataset.index)];
  if (!entry) return;
  pantry = entry.ingredients.map((normalized) => ({ normalized, raw: normalized, priority: false }));
  renderPantryChips();
  updateSearchButtonState();
  runSearch();
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
$('clear-history-btn').addEventListener('click', () => {
  storage.clearSearchHistory();
  renderHistory();
});

// --- Initialisation ---

function wireCollapsibles() {
  setupCollapsible('staples-toggle', 'staples-content');
  setupCollapsible('forbidden-toggle', 'forbidden-content');
  setupCollapsible('filters-toggle', 'filters-content');
  setupCollapsible('favorites-toggle', 'favorites-content');
  setupCollapsible('history-toggle', 'history-content');
}

async function init() {
  document.title = `${CONFIG.APP_NAME} — ${CONFIG.APP_TAGLINE}`;
  wireCollapsibles();
  renderQuickChips();
  renderStaples();
  renderPantryChips();
  renderHistory();
  updateSearchButtonState();

  const { recipes, provider } = await loadRecipesWithFallback('.');
  allRecipes = recipes;
  log(`Recettes chargées (${provider}) :`, recipes.length);
  renderFavorites();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
}

init();
