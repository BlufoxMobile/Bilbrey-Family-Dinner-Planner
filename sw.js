// The Bilbrey Family Dinner Planner — service worker.
// App shell: precached, served network-first (cache when offline). Data JSON: stale-while-revalidate.
// Photos, fonts, icons: cache-first.
// The family API (/api/*) is never cached. Bump CACHE_VERSION with app/config.js VERSION.
const CACHE_VERSION = 'v2.0.1';
const SHELL = `bfdp-shell-${CACHE_VERSION}`;
const DATA = `bfdp-data-${CACHE_VERSION}`;
const IMAGES = 'bfdp-images-v1';

const SHELL_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'styles/tokens.css',
  'styles/app.css',
  'styles/print.css',
  'app/main.js',
  'app/config.js',
  'app/util.js',
  'app/data.js',
  'app/state.js',
  'app/planner.js',
  'app/shopping.js',
  'app/actions.js',
  'app/ui.js',
  'app/icons.js',
  'app/views/common.js',
  'app/views/sheets.js',
  'app/views/tonight.js',
  'app/views/plan.js',
  'app/views/list.js',
  'app/views/pantry.js',
  'app/views/recipes.js',
  'app/views/recipe.js',
  'app/views/budget.js',
  'app/views/family.js',
  'app/views/cook.js',
  'app/views/onboarding.js',
  'fonts/young-serif-400.woff2',
  'fonts/atkinson-next-400.woff2',
  'fonts/atkinson-next-400-italic.woff2',
  'fonts/atkinson-next-600.woff2',
  'fonts/atkinson-next-700.woff2',
  'icons/icon.svg',
  'icons/mark.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];
const DATA_FILES = ['data/catalog.json', 'data/recipes.json', 'data/prices.json', 'data/stores.json', 'img/photos.json'];

const scopeURL = new URL('./', self.location);
const abs = (p) => new URL(p, scopeURL).href;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    await shell.addAll(SHELL_FILES.map((f) => new Request(abs(f), { cache: 'reload' })));
    const data = await caches.open(DATA);
    // Optional data files may not exist yet; cache what's there.
    await Promise.all(DATA_FILES.map(async (f) => {
      try { const r = await fetch(abs(f), { cache: 'reload' }); if (r.ok) await data.put(abs(f), r); } catch { /* offline install */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL, DATA, IMAGES]);
    for (const k of await caches.keys()) if (k.startsWith('bfdp-') && !keep.has(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function staleWhileRevalidate(req) {
  const cache = await caches.open(DATA);
  const cached = await cache.match(req, { ignoreSearch: true });
  const network = fetch(req).then((res) => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => null);
  return cached || (await network) || new Response('{}', { status: 504, headers: { 'Content-Type': 'application/json' } });
}

async function cacheFirst(req) {
  const cache = await caches.open(IMAGES);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return new Response('', { status: 504 });
  }
}

/** App code: fresh from the network when online (so an update never mixes old and new files), cache when offline. */
async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, reject) => setTimeout(() => reject(new Error('slow')), 4000)),
    ]);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const cached = await cache.match(req, { ignoreSearch: true });
    return cached || new Response('', { status: 504 });
  }
}

/** Fonts and icons rarely change: cache first. */
async function assetFirst(req) {
  const cache = await caches.open(SHELL);
  const cached = await cache.match(req, { ignoreSearch: true });
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return new Response('', { status: 504 });
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // the family API and store sites go straight to the network
  if (!url.href.startsWith(scopeURL.href)) return;
  const path = url.href.slice(scopeURL.href.length);
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(SHELL)).put(abs('index.html'), res.clone());
        return res;
      } catch {
        return (await caches.match(abs('index.html'))) || new Response('Offline', { status: 503 });
      }
    })());
    return;
  }
  if (path.startsWith('data/') || path === 'img/photos.json') { event.respondWith(staleWhileRevalidate(req)); return; }
  if (path.startsWith('img/')) { event.respondWith(cacheFirst(req)); return; }
  if (path.startsWith('fonts/') || path.startsWith('icons/')) { event.respondWith(assetFirst(req)); return; }
  event.respondWith(networkFirst(req));
});
