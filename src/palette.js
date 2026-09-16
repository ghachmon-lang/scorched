// Colour schemes modelled on the original's screens: a flat, single-colour
// land (green, brown, grey rock, cream, snow) under a solid EGA-blue sky, a
// black sky full of stars, or a banded VGA sunset. One is picked per round.
export const PALETTES = [
  { name: 'Classic', sky: { type: 'solid', color: '#0000aa' }, land: { color: '#3cb43c' } },
  { name: 'Night rock', sky: { type: 'stars', color: '#000000' }, land: { color: '#b4b4b4', texture: '#8c8c8c' } },
  { name: 'Desert night', sky: { type: 'stars', color: '#000000' }, land: { color: '#e0dcc0' } },
  { name: 'Canyon', sky: { type: 'solid', color: '#0000aa' }, land: { color: '#b0602c' } },
  { name: 'Snow', sky: { type: 'solid', color: '#0000aa' }, land: { color: '#f0f0f0' } },
  { name: 'Sunset', sky: { type: 'bands', colors: ['#2a0a4e', '#5a1470', '#8c2a74', '#c04468', '#e8684a', '#ff9a3c', '#ffc850'] }, land: { color: '#b4b4b4', texture: '#8c8c8c' } },
  { name: 'Jungle night', sky: { type: 'stars', color: '#000000' }, land: { color: '#2ca02c' } },
  { name: 'Dusk', sky: { type: 'bands', colors: ['#14043a', '#3c1064', '#78207a', '#b83868', '#ea6448', '#ff9a3c'] }, land: { color: '#b0602c' } },
];

export function hex(c) {
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

/** Packed little-endian RGBA for ImageData writes. */
export function packColor(c) {
  const [r, g, b] = hex(c);
  return (255 << 24) | (b << 16) | (g << 8) | r;
}

/** One packed colour per sky row: solid, or hard-edged VGA bands. */
export function skyRows(sky, n) {
  const out = new Uint32Array(n);
  if (sky.type === 'bands') {
    const cols = sky.colors.map(packColor);
    for (let i = 0; i < n; i++) out[i] = cols[Math.min(cols.length - 1, Math.floor((i / n) * cols.length))];
  } else {
    out.fill(packColor(sky.color));
  }
  return out;
}

/** Darken/lighten a hex colour by a factor. */
export function shade(c, f) {
  const [r, g, b] = hex(c);
  const cl = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${cl(r)},${cl(g)},${cl(b)})`;
}
