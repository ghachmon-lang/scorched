// Destructible pixel terrain. One byte per pixel (1 = dirt), column-major so
// that falling-dirt compaction (which works per column) is cache friendly.
import { clamp, dsin } from './mathd.js';

export class Terrain {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.bits = new Uint8Array(w * h);
    this.dirtyCols = new Set(); // columns whose dirt may still be falling
    this.version = 0; // bumped whenever pixels change (renderer cache key)
  }

  get(x, y) {
    if (y >= this.h) return 1; // solid floor
    if (x < 0 || x >= this.w || y < 0) return 0;
    return this.bits[x * this.h + y];
  }
  set(x, y, v) {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return;
    this.bits[x * this.h + y] = v;
  }

  /** y of the top-most dirt pixel in column x (h if the column is empty). */
  surfaceY(x) {
    if (x < 0 || x >= this.w) return this.h;
    const col = x * this.h;
    const b = this.bits;
    for (let y = 0; y < this.h; y++) if (b[col + y]) return y;
    return this.h;
  }

  /** First dirt pixel at or below y in column x. */
  groundBelow(x, y) {
    if (x < 0 || x >= this.w) return this.h;
    const col = x * this.h;
    const b = this.bits;
    for (let yy = Math.max(0, y); yy < this.h; yy++) if (b[col + yy]) return yy;
    return this.h;
  }

  clear() {
    this.bits.fill(0);
    this.dirtyCols.clear();
    this.version++;
  }

  /**
   * Generate rolling terrain with 1-D midpoint displacement plus a few broad
   * sine waves, the way the original's hills rolled. minY..maxY bound the
   * surface (screen y, smaller is higher).
   */
  generate(rng, style, minY, maxY) {
    const w = this.w;
    const presets = {
      flat: { amp: 0.12, rough: 0.45, waves: 2, waveAmp: 0.15 },
      hills: { amp: 0.45, rough: 0.55, waves: 3, waveAmp: 0.5 },
      mountains: { amp: 0.8, rough: 0.7, waves: 3, waveAmp: 0.7 },
      canyon: { amp: 0.6, rough: 0.75, waves: 1, waveAmp: 1.0 },
    };
    const p = presets[style] || presets.hills;
    const span = maxY - minY;

    // midpoint displacement over a power-of-two grid wider than the screen
    let size = 1;
    while (size < w) size *= 2;
    const hm = new Float64Array(size + 1);
    hm[0] = rng.range(-0.5, 0.5);
    hm[size] = rng.range(-0.5, 0.5);
    let step = size;
    let disp = p.amp;
    while (step > 1) {
      const half = step / 2;
      for (let i = half; i < size; i += step) {
        hm[i] = (hm[i - half] + hm[i + half]) / 2 + rng.range(-disp, disp);
      }
      disp *= p.rough;
      step = half;
    }
    // broad rolling waves
    const waves = [];
    for (let i = 0; i < p.waves; i++) {
      waves.push({ f: rng.range(0.6, 2.2) * (Math.PI * 2) / w, ph: rng.range(0, Math.PI * 2), a: rng.range(0.3, 1) * p.waveAmp });
    }
    const surf = new Float64Array(w);
    let lo = Infinity, hi = -Infinity;
    for (let x = 0; x < w; x++) {
      let v = hm[x];
      for (const wv of waves) v += wv.a * dsin(x * wv.f + wv.ph);
      surf[x] = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    // canyon: carve a deep trench through the middle third
    if (style === 'canyon') {
      const cx = rng.range(w * 0.3, w * 0.7);
      const cw = rng.range(w * 0.12, w * 0.22);
      for (let x = 0; x < w; x++) {
        const d = Math.abs(x - cx) / cw;
        if (d < 1) surf[x] -= (1 - d * d) * (hi - lo) * 0.9;
      }
      lo = Infinity; hi = -Infinity;
      for (let x = 0; x < w; x++) { if (surf[x] < lo) lo = surf[x]; if (surf[x] > hi) hi = surf[x]; }
    }
    // normalise into [minY, maxY]; taller styles use more of the range
    const use = style === 'flat' ? 0.35 : style === 'mountains' || style === 'canyon' ? 1 : 0.75;
    const base = maxY - span * (style === 'flat' ? 0.3 : 0.15);
    const range = hi - lo || 1;
    const ys = new Int32Array(w);
    for (let x = 0; x < w; x++) {
      const t = (surf[x] - lo) / range; // 0 (low) .. 1 (high)
      // sharpen mountain peaks a little
      const tt = style === 'mountains' ? t * t * (3 - 2 * t) : t;
      ys[x] = Math.round(clamp(base - tt * span * use, minY, maxY));
    }
    // light smoothing to kill single-pixel spikes
    for (let x = 1; x < w - 1; x++) ys[x] = Math.round((ys[x - 1] + ys[x] * 2 + ys[x + 1]) / 4);

    this.bits.fill(0);
    for (let x = 0; x < w; x++) {
      const col = x * this.h;
      for (let y = ys[x]; y < this.h; y++) this.bits[col + y] = 1;
    }
    this.dirtyCols.clear();
    this.version++;
  }

  /** Flatten a small ledge under a tank so it sits level. */
  flatten(x0, x1, y) {
    for (let x = x0; x <= x1; x++) {
      if (x < 0 || x >= this.w) continue;
      const col = x * this.h;
      for (let yy = 0; yy < this.h; yy++) this.bits[col + yy] = yy > y ? 1 : 0;
    }
    this.version++;
  }

  /** Remove dirt inside a circle. Returns the [x0, x1] column span touched. */
  carveCircle(cx, cy, r) {
    cx = Math.round(cx); cy = Math.round(cy);
    const r2 = r * r;
    const x0 = Math.max(0, cx - r), x1 = Math.min(this.w - 1, cx + r);
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = Math.floor(Math.sqrt(r2 - dx * dx));
      const y0 = Math.max(0, cy - dy), y1 = Math.min(this.h - 1, cy + dy);
      const col = x * this.h;
      for (let y = y0; y <= y1; y++) this.bits[col + y] = 0;
    }
    this.version++;
    return [x0, x1];
  }

  /** Add dirt inside a circle (dirt clods). */
  fillCircle(cx, cy, r, minY = 0) {
    cx = Math.round(cx); cy = Math.round(cy);
    const r2 = r * r;
    const x0 = Math.max(0, cx - r), x1 = Math.min(this.w - 1, cx + r);
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = Math.floor(Math.sqrt(r2 - dx * dx));
      const y0 = Math.max(minY, cy - dy), y1 = Math.min(this.h - 1, cy + dy);
      const col = x * this.h;
      for (let y = y0; y <= y1; y++) this.bits[col + y] = 1;
    }
    this.version++;
    return [x0, x1];
  }

  /** Remove dirt in a wedge (riot charge): apex at (cx,cy), pointing along (dx,dy). */
  carveCone(cx, cy, dx, dy, length, halfAngleCos) {
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    dx /= len; dy /= len;
    const x0 = Math.max(0, Math.floor(cx - length)), x1 = Math.min(this.w - 1, Math.ceil(cx + length));
    const y0 = Math.max(0, Math.floor(cy - length)), y1 = Math.min(this.h - 1, Math.ceil(cy + length));
    const l2 = length * length;
    for (let x = x0; x <= x1; x++) {
      const col = x * this.h;
      for (let y = y0; y <= y1; y++) {
        const px = x - cx, py = y - cy;
        const d2 = px * px + py * py;
        if (d2 > l2) continue;
        const d = Math.sqrt(d2) || 1;
        if (d < 3 || (px * dx + py * dy) / d >= halfAngleCos) this.bits[col + y] = 0;
      }
    }
    this.version++;
    return [x0, x1];
  }

  /** Mark columns as candidates for falling dirt. */
  markDirty(x0, x1) {
    for (let x = Math.max(0, x0); x <= Math.min(this.w - 1, x1); x++) this.dirtyCols.add(x);
  }

  /**
   * Advance falling dirt by one tick. Every floating run of dirt in a dirty
   * column drops by up to `speed` pixels. Returns true if anything moved.
   */
  settleStep(speed = 3) {
    if (this.dirtyCols.size === 0) return false;
    let moved = false;
    const b = this.bits, h = this.h;
    for (const x of this.dirtyCols) {
      const col = x * h;
      let air = 0; // contiguous air pixels directly below the current pixel
      let colMoved = false;
      for (let y = h - 1; y >= 0; y--) {
        if (b[col + y] === 0) {
          air++;
        } else if (air > 0) {
          const d = air < speed ? air : speed;
          b[col + y] = 0;
          b[col + y + d] = 1;
          air = d;
          colMoved = true;
        } else {
          air = 0;
        }
      }
      if (colMoved) moved = true;
      else this.dirtyCols.delete(x);
    }
    if (moved) this.version++;
    return moved;
  }

  /** Instantly compact all dirty columns (used by AI look-ahead and tests). */
  settleAll() {
    while (this.settleStep(this.h)) { /* loop */ }
  }

  /** FNV-1a checksum of the bitmap (desync detection). */
  checksum() {
    let h = 0x811c9dc5;
    const b = this.bits;
    for (let i = 0; i < b.length; i++) {
      h ^= b[i];
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  /** Run-length encode the bitmap (for snapshots sent to late joiners). */
  encode() {
    const out = [];
    const b = this.bits;
    let cur = b[0], run = 0;
    for (let i = 0; i < b.length; i++) {
      if (b[i] === cur) run++;
      else { out.push(run); cur = b[i]; run = 1; }
    }
    out.push(run);
    return { w: this.w, h: this.h, first: b[0], runs: out };
  }
  decode(data) {
    this.bits.fill(0);
    let i = 0, v = data.first;
    for (const run of data.runs) {
      if (v) this.bits.fill(1, i, i + run);
      i += run;
      v = v ? 0 : 1;
    }
    this.dirtyCols.clear();
    this.version++;
  }
}
