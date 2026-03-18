const CACHE_NAME = 'pneuservis-v2';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './lib/jspdf.umd.min.js',
  './lib/qrcode.min.js',
  './lib/Roboto-Regular.ttf',
  './lib/Roboto-Bold.ttf',
  './manifest.json'
];

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
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
