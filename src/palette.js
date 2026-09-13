// Sky and land colour schemes in the spirit of the VGA original: a vertical
// gradient sky and strata-shaded land. One is picked per round.
export const PALETTES = [
  { name: 'Daylight', sky: ['#000a3a', '#0d2aa8', '#2a6ae0', '#7ab8ff'], land: ['#3cc03c', '#26a026', '#1c7f1c', '#155f15', '#0e400e', '#092a09'] },
  { name: 'Sunset', sky: ['#14042e', '#5c1060', '#c8386a', '#ff9a4a', '#ffe08a'], land: ['#a06428', '#8a5320', '#6e4218', '#553310', '#3e240b', '#281706'] },
  { name: 'Night', sky: ['#000000', '#02041a', '#060c34', '#0c1a52'], land: ['#5a5a70', '#484860', '#383850', '#2a2a40', '#1e1e30', '#141422'], stars: true },
  { name: 'Desert', sky: ['#1a3a8a', '#4a80d0', '#a0c8f0', '#f0e0b0'], land: ['#e8c070', '#cc9f4c', '#b0843a', '#946a2c', '#785420', '#5c3e16'] },
  { name: 'Alien', sky: ['#0a0014', '#3a0850', '#8a1a9a', '#e050d0'], land: ['#30e0b0', '#20b890', '#189070', '#106a52', '#0a4a38', '#062e22'] },
  { name: 'Arctic', sky: ['#101e3c', '#26487e', '#5a8ac0', '#b8d8f4'], land: ['#f4f8ff', '#d4e0f0', '#b0c0d8', '#8c9cb8', '#687898', '#485874'] },
];

function hex(c) {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

/** Interpolate a list of colour stops into `n` packed ABGR (little-endian RGBA) values. */
export function gradientRows(stops, n, dither = false) {
  const cols = stops.map(hex);
  const out = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let t = (i / Math.max(1, n - 1)) * (cols.length - 1);
    // quantise into visible bands like a 256-colour VGA gradient would
    if (dither) t = Math.floor(t * 8) / 8;
    const k = Math.min(cols.length - 2, Math.floor(t));
    const f = t - k;
    const a = cols[k], b = cols[k + 1];
    const r = Math.round(a[0] + (b[0] - a[0]) * f);
    const g = Math.round(a[1] + (b[1] - a[1]) * f);
    const bl = Math.round(a[2] + (b[2] - a[2]) * f);
    out[i] = (255 << 24) | (bl << 16) | (g << 8) | r;
  }
  return out;
}

export function packColor(c) {
  const [r, g, b] = hex(c);
  return (255 << 24) | (b << 16) | (g << 8) | r;
}

/** Darken/lighten a hex colour by a factor. */
export function shade(c, f) {
  const [r, g, b] = hex(c);
  const cl = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${cl(r)},${cl(g)},${cl(b)})`;
}
