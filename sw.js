const CACHE_NAME = 'pneuservis-v4';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './config.json',
  './lib/jspdf.umd.min.js',
  './lib/qrcode.min.js',
  './lib/Roboto-Regular.ttf',
  './lib/Roboto-Bold.ttf',
  './manifest.json'
];

// Soubory ktere se maji vzdy nacitat ze serveru (network-first)
const NETWORK_FIRST = ['config.json', 'app.js', 'style.css', 'index.html'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const isNetworkFirst = NETWORK_FIRST.some(f => url.pathname.endsWith(f));

  if (isNetworkFirst) {
    // Network-first: zkus server, pri chybe pouzij cache (offline)
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  } else {
    // Cache-first: pro velke soubory (fonty, knihovny)
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request))
    );
  }
});
