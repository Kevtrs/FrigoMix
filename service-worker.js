// Service worker minimal : app shell en cache pour un fonctionnement
// hors-ligne complet, données recettes en stale-while-revalidate pour
// profiter des mises à jour hebdomadaires sans bloquer l'affichage.
const CACHE_VERSION = 'frigomix-v3';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/config.js',
  './js/ingredients.js',
  './js/parser.js',
  './js/matching.js',
  './js/storage.js',
  './js/providers/index.js',
  './js/providers/mock-provider.js',
  './js/providers/local-index-provider.js',
  './js/providers/cookidoo-search-link-provider.js',
  './assets/icons/icon.svg',
  './assets/fonts/dynapuff-500.woff2',
  './assets/fonts/dynapuff-600.woff2',
  './assets/fonts/dynapuff-700.woff2',
  './assets/fonts/manrope-400.woff2',
  './assets/fonts/manrope-500.woff2',
  './assets/fonts/manrope-600.woff2',
  './assets/fonts/manrope-700.woff2',
  './assets/fonts/manrope-800.woff2',
  './data/mock-recipes.json',
  './data/recipes-fr.compact.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      Promise.all(
        APP_SHELL.map((url) => cache.add(url).catch(() => {
          // certains fichiers (ex: recipes-fr.json avant la première
          // exécution de l'Action GitHub) peuvent ne pas exister encore.
        }))
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Stale-while-revalidate partout : réponse instantanée depuis le cache
  // (hors-ligne compris) tout en rafraîchissant en tâche de fond pour le
  // prochain chargement. Un cache-first pur sur le code de l'app aurait pu
  // laisser un visiteur récurrent bloqué indéfiniment sur une ancienne
  // version tant que CACHE_VERSION n'est pas changé à la main.
  event.respondWith(staleWhileRevalidate(request));
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  return cached || (await networkPromise) || Response.error();
}
