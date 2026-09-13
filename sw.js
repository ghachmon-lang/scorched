// Service worker: caches the app shell so the game works offline and installs
// as a PWA. Bump CACHE when shipping a new version.
const CACHE = 'scorched-earth-v1';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './vendor/peerjs.min.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './src/main.js', './src/game.js', './src/ai.js', './src/physics.js', './src/terrain.js', './src/weapons.js',
  './src/rng.js', './src/mathd.js', './src/palette.js', './src/font.js', './src/render.js', './src/sound.js',
  './src/storage.js', './src/net.js', './src/ui.js', './src/input.js', './src/taunts.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Network first (so updates arrive), falling back to the cache when offline.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html'))),
  );
});
