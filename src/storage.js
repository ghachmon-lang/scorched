// Persisted preferences (settings, last player setup, options).
const KEY = 'scorched-earth-prefs-v1';

export const DEFAULT_PREFS = {
  settings: {},
  players: null,
  name: '',
  sound: true,
  trails: true,
  labels: true,
  fastAI: true,
  dragAim: true,
  peer: { host: '', port: '', path: '', key: '', secure: true },
};

export function loadPrefs() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_PREFS);
    const p = JSON.parse(raw);
    return { ...structuredClone(DEFAULT_PREFS), ...p, peer: { ...DEFAULT_PREFS.peer, ...(p.peer || {}) } };
  } catch {
    return structuredClone(DEFAULT_PREFS);
  }
}

export function savePrefs(prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* private mode etc. */
  }
}
