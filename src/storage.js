// Persisted preferences: settings, identity (a secret device token), the list
// of rooms this device plays in, and options. A small mirror goes into
// IndexedDB so the service worker can look rooms up when a push arrives.
const KEY = 'scorched-earth-prefs-v2';

export const DEFAULT_PREFS = {
  settings: {},
  practice: null,
  name: '',
  color: '',
  token: '',
  server: '',
  games: {},
  notify: false,
  sound: true,
  trails: true,
  labels: true,
  fastAI: true,
  dragAim: true,
  rotateHint: false,
};

function randomToken() {
  const a = new Uint8Array(20);
  if (globalThis.crypto && crypto.getRandomValues) crypto.getRandomValues(a);
  else for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
  let s = '';
  for (const b of a) s += b.toString(16).padStart(2, '0');
  return s;
}

export function loadPrefs() {
  let p;
  try {
    const raw = localStorage.getItem(KEY);
    p = raw ? { ...structuredClone(DEFAULT_PREFS), ...JSON.parse(raw) } : structuredClone(DEFAULT_PREFS);
  } catch {
    p = structuredClone(DEFAULT_PREFS);
  }
  if (!p.token || p.token.length < 16) {
    p.token = randomToken();
    savePrefs(p);
  }
  if (!p.games || typeof p.games !== 'object') p.games = {};
  return p;
}

export function savePrefs(prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* private mode etc. */
  }
  syncServiceWorkerData(prefs);
}

// ---- IndexedDB mirror for the service worker ----
function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('no idb'));
    const r = indexedDB.open('scorched-earth', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

let syncTimer = 0;
export function syncServiceWorkerData(prefs) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    try {
      const db = await openDb();
      const rooms = Object.values(prefs.games || {})
        .filter((g) => g.phase !== 'over')
        .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))
        .slice(0, 12)
        .map((g) => ({ code: g.code, server: g.server }));
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ token: prefs.token, rooms }, 'sync');
      tx.oncomplete = () => db.close();
    } catch {
      /* ignore */
    }
  }, 50);
}
