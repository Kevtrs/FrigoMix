import { CONFIG } from './config.js';
import { suggestIngredients, normalizeIngredient, QUICK_SUGGESTIONS } from './ingredients.js';
import { parseIngredientInput } from './parser.js';
import { findMatchingRecipes } from './matching.js';
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
const recipeCountEl = $('recipe-count');
const resultsHeader = $('results-header');
const resultsHeaderTitle = $('results-header-title');
const resultsHeaderRecap = $('results-header-recap');
const staplesSummaryEl = $('staples-summary');
const forbiddenSummaryEl = $('forbidden-summary');
const filtersSummaryEl = $('filters-summary');
const filtersContent = $('filters-content');

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
    const priorityLabel = item.priority ? 'Ne plus prioriser' : 'À finir en priorité';
    li.innerHTML = `
      <button type="button" class="chip__priority" data-action="priority" data-name="${item.normalized}"
        aria-pressed="${item.priority}" aria-label="${priorityLabel} : ${item.normalized}" title="${priorityLabel}">
        <span class="chip__priority-label">À finir</span>
        <span aria-hidden="true">${item.priority ? '★' : '☆'}</span>
      </button>
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
  updateForbiddenSummary();
}

function updateForbiddenSummary() {
  forbiddenSummaryEl.textContent = forbidden.length
    ? `${forbidden.length} exclusion${forbidden.length > 1 ? 's' : ''}`
    : 'Aucune';
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
  updateStaplesSummary();
}
staplesListEl.addEventListener('change', (e) => {
  const input = e.target;
  if (input.type !== 'checkbox') return;
  if (input.checked) enabledStaples.add(input.value);
  else enabledStaples.delete(input.value);
  storage.setEnabledStaples([...enabledStaples]);
  renderStaples();
});

function updateStaplesSummary() {
  staplesSummaryEl.textContent = enabledStaples.size
    ? `${enabledStaples.size} produit${enabledStaples.size > 1 ? 's' : ''} de base`
    : 'Aucun';
}

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

const TIME_LABELS = { '1200': '20 min', '1800': '30 min', '2700': '45 min', '3600': '1 h' };
function updateFiltersSummary() {
  const f = getFilters();
  const parts = [];
  if (f.maxTime) parts.push(`Moins de ${TIME_LABELS[String(f.maxTime)] || f.maxTime + 's'}`);
  if (f.difficulty) parts.push(f.difficulty);
  if (f.category) parts.push(f.category);
  if (f.servings) parts.push(`${f.servings} pers.`);
  filtersSummaryEl.textContent = parts.length ? parts.join(' · ') : 'Peu importe';
}
filtersContent.addEventListener('change', updateFiltersSummary);

// --- Recherche ---

function updateSearchButtonState() {
  searchBtn.disabled = pantry.length === 0;
  if (pantry.length === 0) {
    searchBtn.textContent = 'Ajoute des ingrédients';
  } else {
    searchBtn.textContent = `Voir les recettes avec ${pantry.length === 1 ? 'mon ingrédient' : `mes ${pantry.length} ingrédients`}`;
  }
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
  resultsHeader.hidden = true;

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

// Message "humain" plutôt qu'un pourcentage brut en avant (le score reste
// disponible, affiché discrètement dans les métadonnées).
function verdictForMatch(match) {
  if (!match) return '';
  if (match.priorityMatches.length > 0) {
    return `Idéal pour finir : ${match.priorityMatches.join(', ')}`;
  }
  if (match.missingIngredients.length === 0) return "Tu as tout ce qu'il faut";
  if (match.missingIngredients.length === 1) return `Il te manque juste : ${match.missingIngredients[0]}`;
  if (match.missingIngredients.length <= 3) return `${match.missingIngredients.length} petites courses et c'est bon`;
  return 'Possible avec quelques courses';
}

const CATEGORY_PLACEHOLDER = {
  Dessert: 'placeholder--warm',
  Entrée: 'placeholder--accent',
  Soupe: 'placeholder--accent',
  Sauce: 'placeholder--accent',
  Apéritif: 'placeholder--accent',
};
function placeholderHtml(category) {
  const variant = CATEGORY_PLACEHOLDER[category] || 'placeholder--brand';
  return `
    <div class="recipe-card__placeholder ${variant}">
      <svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <path d="M27 5c8 3 14 11 12 20-9 3-18-1-21-9-2-6 2-13 9-11Z" fill="currentColor"/>
        <path d="M18 15c6 4 13 5 19 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.55"/>
      </svg>
    </div>`;
}

function recipeCardHtml({ recipe, match }, { compact = false } = {}) {
  const image = resolveImage(recipe);
  const isFav = storage.isFavorite(recipe.id);
  const time = formatTime(recipe.totalTime);
  const scorePct = match ? Math.round(match.score * 100) : null;

  const missingHtml = match && match.missingIngredients.length
    ? `<p class="recipe-card__missing">${match.missingIngredients.map((i) => `<span class="tag">${i}</span>`).join('')}</p>`
    : '';

  const haveHtml = match && match.matchedIngredients.length
    ? `<details class="recipe-card__have">
        <summary>Ce que tu utilises (${match.matchedIngredients.length})</summary>
        <ul class="tag-list">${match.matchedIngredients.map((i) => `<li>${i}</li>`).join('')}</ul>
      </details>`
    : '';

  const verdict = match ? verdictForMatch(match) : recipe.name;

  return `
    <li class="recipe-card" data-id="${recipe.id}">
      <div class="recipe-card__media">
        ${image ? `<img src="${image}" alt="" loading="lazy" />` : placeholderHtml(recipe.category)}
        <button type="button" class="favorite-btn" data-action="favorite" data-id="${recipe.id}"
          aria-pressed="${isFav}" aria-label="${isFav ? 'Retirer des favoris' : 'Ajouter aux favoris'}">${isFav ? '♥' : '♡'}</button>
      </div>
      <div class="recipe-card__body">
        <p class="recipe-card__verdict">${verdict}</p>
        <p class="recipe-card__name">${recipe.name}</p>
        ${missingHtml}
        <p class="recipe-card__meta">
          ${time ? `<span>⏱ ${time}</span>` : ''}
          ${recipe.rating ? `<span>⭐ ${recipe.rating.toFixed(1)}</span>` : ''}
          ${recipe.servings ? `<span>👥 ${recipe.servings}</span>` : ''}
          ${scorePct !== null ? `<span>${scorePct} % compatible</span>` : ''}
        </p>
        ${haveHtml}
        <div class="thermomix-search">
          <p class="thermomix-search__name">Thermomix : « ${recipe.name} »</p>
          <button type="button" class="thermomix-search__copy" data-action="copy" data-name="${recipe.name}">Copier</button>
        </div>
        <div class="recipe-card__actions">
          <a class="btn btn--primary" href="${recipe.url}" target="_blank" rel="noopener">Voir la recette</a>
          ${compact ? '' : `<button type="button" class="btn btn--secondary" data-action="cooked" data-id="${recipe.id}">Je la cuisine</button>`}
        </div>
      </div>
    </li>
  `;
}

function renderResults() {
  const slice = currentResults.slice(0, visibleCount);
  resultsList.innerHTML = slice.map((entry) => recipeCardHtml(entry)).join('');
  loadMoreRow.hidden = visibleCount >= currentResults.length;

  const count = currentResults.length;
  resultsHeaderTitle.textContent = `${count} idée${count > 1 ? 's' : ''} avec ce que tu as`;
  const names = pantry.map((i) => i.normalized);
  resultsHeaderRecap.textContent = names.length ? `Avec : ${names.join(', ')}` : '';
  resultsHeader.hidden = false;
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

// Accès rapides de l'en-tête : ouvrent le panneau correspondant (s'il est
// replié) avant de laisser le navigateur faire défiler jusqu'à l'ancre.
function wireHeaderShortcut(linkId, toggleId) {
  $(linkId).addEventListener('click', () => {
    const toggle = $(toggleId);
    if (toggle.getAttribute('aria-expanded') !== 'true') toggle.click();
  });
}

async function init() {
  document.title = `${CONFIG.APP_NAME} — ${CONFIG.APP_TAGLINE}`;
  wireCollapsibles();
  wireHeaderShortcut('header-favorites-link', 'favorites-toggle');
  wireHeaderShortcut('header-history-link', 'history-toggle');
  renderQuickChips();
  renderStaples();
  renderPantryChips();
  renderHistory();
  updateSearchButtonState();
  updateForbiddenSummary();
  updateFiltersSummary();

  const { recipes, provider } = await loadRecipesWithFallback('.');
  allRecipes = recipes;
  log(`Recettes chargées (${provider}) :`, recipes.length);
  if (recipes.length > 0) {
    const formatted = recipes.length.toLocaleString('fr-FR');
    recipeCountEl.textContent = `${formatted} recette${recipes.length > 1 ? 's' : ''} Cookidoo indexée${recipes.length > 1 ? 's' : ''}`;
    recipeCountEl.hidden = false;
  }
  renderFavorites();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
}

init();
