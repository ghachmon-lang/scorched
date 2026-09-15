// Service worker: caches the app shell for offline use and installs as a PWA,
// and turns "your turn" pushes from the room server into notifications.
// Bump CACHE when shipping a new version.
const CACHE = 'scorched-earth-v2';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './src/main.js', './src/game.js', './src/ai.js', './src/physics.js', './src/terrain.js', './src/weapons.js',
  './src/rng.js', './src/mathd.js', './src/palette.js', './src/font.js', './src/render.js', './src/sound.js',
  './src/storage.js', './src/net.js', './src/ui.js', './src/input.js', './src/taunts.js', './src/config.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Network first (so updates arrive), falling back to the cache when offline.
// Only same-origin GETs are handled; calls to the room server pass straight through.
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

// ---- push notifications ----
function readSync() {
  return new Promise((resolve) => {
    try {
      const r = indexedDB.open('scorched-earth', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => {
        const db = r.result;
        const g = db.transaction('kv').objectStore('kv').get('sync');
        g.onsuccess = () => { resolve(g.result || null); db.close(); };
        g.onerror = () => { resolve(null); db.close(); };
      };
      r.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function describePush() {
  let body = 'It is your move.';
  let url = './';
  try {
    const sync = await readSync();
    if (sync && sync.token) {
      for (const room of (sync.rooms || []).slice(0, 12)) {
        if (!room.server) continue;
        const res = await fetch(`${room.server}/rooms/${room.code}/summary?token=${encodeURIComponent(sync.token)}`);
        if (!res.ok) continue;
        const s = await res.json();
        if (!s.yourTurn) continue;
        body = s.turnPhase === 'shop'
          ? `Round ${s.round} is over in room ${s.code}. Time to shop.`
          : `Your turn in room ${s.code}, round ${s.round} of ${s.rounds}.`;
        url = `./?room=${s.code}`;
        break;
      }
    }
  } catch {
    /* fall back to the generic text */
  }
  return { body, url };
}

self.addEventListener('push', (e) => {
  e.waitUntil(describePush().then(({ body, url }) => self.registration.showNotification('Scorched Earth', {
    body, icon: './icons/icon-192.png', badge: './icons/icon-192.png', tag: 'scorched-turn', renotify: true, data: { url },
  })));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if ('focus' in c) {
        if ('navigate' in c) c.navigate(new URL(url, self.registration.scope).href).catch(() => {});
        return c.focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});
