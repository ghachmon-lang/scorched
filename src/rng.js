// Seeded, deterministic PRNG (mulberry32). Every random decision in the
// simulation goes through an instance of this so that all peers in an online
// game, given the same seed and the same commands, compute identical worlds.
export class RNG {
  constructor(seed = 1) {
    this.s = (seed >>> 0) || 1;
  }
  next() {
    let t = (this.s = (this.s + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** integer in [0, n) */
  int(n) {
    return Math.floor(this.next() * n);
  }
  /** integer in [a, b] inclusive */
  irange(a, b) {
    return a + this.int(b - a + 1);
  }
  /** float in [a, b) */
  range(a, b) {
    return a + this.next() * (b - a);
  }
  pick(arr) {
    return arr[this.int(arr.length)];
  }
  chance(p) {
    return this.next() < p;
  }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }
}

/** Hash a string to a 32-bit seed (FNV-1a). */
export function hashSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Fresh random seed for a new game (not used inside the simulation). */
export function randomSeed() {
  if (globalThis.crypto && crypto.getRandomValues) {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] || 1;
  }
  return (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;
}
