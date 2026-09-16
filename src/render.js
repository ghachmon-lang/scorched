// Canvas renderer. Draws the 640x360 world at native resolution; CSS scales
// the canvas with image-rendering: pixelated so every pixel stays crisp.
// The look follows the 1991 original: flat land, solid or starry sky, thin
// coloured shot trails that stay all round, ringed explosions, a grey status
// bar and the wind readout floating in the sky.
import { W, H, HUD_H } from './game.js';
import { PALETTES, skyRows, packColor, shade } from './palette.js';
import { drawText, textWidth } from './font.js';
import { WEAPONS } from './weapons.js';
import * as PH from './physics.js';
import { DEG, dsin, dcos } from './mathd.js';

const TANK_SPRITE = [
  '.....###.....',
  '...#######...',
  '..#########..',
  '#############',
  '#############',
  '.###########.',
];
const HUD_BG = '#c0c0c0';
const HUD_FG = '#000000';

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.ctx.imageSmoothingEnabled = false;
    this.bg = this.ctx.createImageData(W, H);
    this.bg32 = new Uint32Array(this.bg.data.buffer);
    this.bgKey = '';
    this.palKey = -1;
    this.frame = 0;
    this.options = { trails: true, labels: true };
  }

  preparePalette(idx) {
    if (this.palKey === idx) return;
    const pal = PALETTES[idx % PALETTES.length];
    this.pal = pal;
    this.skyRows = skyRows(pal.sky, H);
    this.landColor = packColor(pal.land.color);
    this.texColor = pal.land.texture ? packColor(pal.land.texture) : 0;
    this.stars = [];
    if (pal.sky.type === 'stars') {
      let s = 1234 + idx * 77;
      for (let i = 0; i < 140; i++) {
        s = (Math.imul(s, 1103515245) + 12345) >>> 0;
        const x = s % W;
        s = (Math.imul(s, 1103515245) + 12345) >>> 0;
        const y = HUD_H + (s % (H - HUD_H));
        this.stars.push(x, y, i % 4 === 0 ? 0xffffffff : 0xffa8a8a8);
      }
    }
    this.palKey = idx;
  }

  buildBackground(game) {
    this.preparePalette(game.palette);
    const bits = game.terrain.bits;
    const d = this.bg32;
    const sky = this.skyRows, land = this.landColor, tex = this.texColor;
    for (let y = 0; y < H; y++) {
      const row = y * W;
      const sc = sky[y];
      for (let x = 0; x < W; x++) {
        if (bits[x * H + y]) {
          // rock texture: a sparse deterministic speckle
          d[row + x] = tex && ((Math.imul(x, 73856093) ^ Math.imul(y, 19349663)) >>> 0) % 5 === 0 ? tex : land;
        } else d[row + x] = sc;
      }
    }
    for (let i = 0; i < this.stars.length; i += 3) {
      const x = this.stars[i], y = this.stars[i + 1];
      if (!bits[x * H + y]) d[y * W + x] = this.stars[i + 2];
    }
  }

  /** Draw one frame. view = { aim: {angle,power}|null, speed } */
  draw(game, view = {}) {
    const ctx = this.ctx;
    this.frame++;
    const key = `${game.terrain.version}|${game.palette}`;
    if (key !== this.bgKey) {
      this.buildBackground(game);
      this.bgKey = key;
    }
    ctx.putImageData(this.bg, 0, 0);

    if (this.options.trails) this.drawTrails(game);
    this.drawSmoke(game);
    for (const t of game.tanks) if (t.alive) this.drawTank(game, t, view);
    this.drawProjectiles(game);
    this.drawEffects(game);
    this.drawMarkers(game);
    this.drawWind(game);
    this.drawTaunts(game);
    if (view.aim && game.phase === 'aim') this.drawAimPreview(game, view.aim);
    this.drawHud(game);
  }

  drawTrails(game) {
    const ctx = this.ctx;
    ctx.lineWidth = 1;
    for (const tr of game.trails) {
      const pts = tr.points;
      if (pts.length < 4) continue;
      ctx.strokeStyle = tr.color;
      ctx.beginPath();
      let px = pts[0], py = pts[1];
      ctx.moveTo(px + 0.5, py + 0.5);
      for (let i = 2; i < pts.length; i += 2) {
        const x = pts[i], y = pts[i + 1];
        // wrap-around walls teleport the shell: don't draw a line across the screen
        if (Math.abs(x - px) > W / 2) ctx.moveTo(x + 0.5, y + 0.5);
        else ctx.lineTo(x + 0.5, y + 0.5);
        px = x;
        py = y;
      }
      ctx.stroke();
    }
  }

  drawSmoke(game) {
    const ctx = this.ctx;
    for (const e of game.effects) {
      if (e.type !== 'smoke') continue;
      const f = e.age / e.dur;
      const r = 1 + Math.min(4, e.age / 25);
      ctx.fillStyle = `rgba(200,200,200,${0.8 * (1 - f)})`;
      this.disc(e.x, e.y - e.age * 0.08, r);
    }
  }

  disc(cx, cy, r) {
    const ctx = this.ctx;
    cx = Math.round(cx);
    cy = Math.round(cy);
    const ri = Math.round(r);
    for (let dy = -ri; dy <= ri; dy++) {
      const w = Math.floor(Math.sqrt(r * r - dy * dy));
      ctx.fillRect(cx - w, cy + dy, 2 * w + 1, 1);
    }
  }

  ring(cx, cy, r, dotted = false) {
    const ctx = this.ctx;
    const n = Math.max(12, Math.round(r * 1.2));
    for (let i = 0; i < n; i++) {
      if (dotted && i % 2) continue;
      const a = (i / n) * Math.PI * 2;
      ctx.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), 1, 1);
    }
  }

  drawTank(game, t, view) {
    const ctx = this.ctx;
    const pl = game.players[t.idx];
    const color = pl.color;
    const x0 = t.x - 6, y0 = t.y - 5;
    const a = t.angle * DEG;
    const px = t.x, py = t.y - 3;
    const tx = px + dcos(a) * PH.BARREL_LEN, ty = py - dsin(a) * PH.BARREL_LEN;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px + 0.5, py + 0.5);
    ctx.lineTo(tx + 0.5, ty + 0.5);
    ctx.stroke();
    ctx.fillStyle = color;
    for (let r = 0; r < TANK_SPRITE.length; r++) {
      const row = TANK_SPRITE[r];
      for (let c = 0; c < row.length; c++) if (row[c] === '#') ctx.fillRect(x0 + c, y0 + r, 1, 1);
    }
    if (t.chute && t.falling) {
      ctx.fillStyle = '#ffffff';
      this.ring(t.x, t.y - 14, 8);
      ctx.fillRect(t.x - 8, t.y - 14, 17, 1);
    }
    if (t.shield) {
      ctx.fillStyle = t.shield.color || '#55ffff';
      this.ring(t.x, t.y - 3, PH.SHIELD_R, (this.frame >> 2) % 2 === 0);
      if ((this.frame >> 2) % 2) this.ring(t.x, t.y - 3, PH.SHIELD_R - 1, true);
    }
    if (this.options.labels) {
      const name = pl.name.length > 10 ? pl.name.slice(0, 10) : pl.name;
      const w = textWidth(name, 1);
      let lx = Math.round(t.x - w / 2);
      lx = Math.max(1, Math.min(W - w - 1, lx));
      const ly = t.y - 17;
      drawText(ctx, name, lx + 1, ly + 1, '#000000', 1);
      drawText(ctx, name, lx, ly, color, 1);
      const bw = 14;
      const bx = t.x - 7, by = t.y - 9;
      ctx.fillStyle = '#000000';
      ctx.fillRect(bx - 1, by - 1, bw + 2, 3);
      ctx.fillStyle = t.hp > 50 ? '#55ff55' : t.hp > 25 ? '#ffff55' : '#ff5555';
      ctx.fillRect(bx, by, Math.round((bw * t.hp) / 100), 1);
    }
    if (game.phase === 'aim' && game.current === t.idx) {
      const bob = Math.round(Math.sin(this.frame / 6) * 2);
      const my = t.y - (this.options.labels ? 26 : 18) + bob;
      ctx.fillStyle = color;
      ctx.fillRect(t.x - 3, my - 2, 7, 1);
      ctx.fillRect(t.x - 2, my - 1, 5, 1);
      ctx.fillRect(t.x - 1, my, 3, 1);
      ctx.fillRect(t.x, my + 1, 1, 1);
    }
  }

  drawProjectiles(game) {
    const ctx = this.ctx;
    for (const p of game.projectiles) {
      const w = WEAPONS[p.weapon] || WEAPONS.baby_missile;
      if (p.mode === 'fly') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 2, 2);
      } else if (p.mode === 'roll') {
        ctx.fillStyle = w.color;
        this.disc(p.x, p.y - 2, 3);
        ctx.fillStyle = '#000';
        const a = (this.frame * 0.4 * p.dir) % (Math.PI * 2);
        ctx.fillRect(Math.round(p.x + Math.cos(a) * 2), Math.round(p.y - 2 + Math.sin(a) * 2), 1, 1);
      } else if (p.mode === 'dig') {
        ctx.fillStyle = (this.frame >> 1) % 2 ? '#ffffff' : w.color;
        this.disc(p.x, p.y, 2);
      }
    }
  }

  drawEffects(game) {
    const ctx = this.ctx;
    for (const e of game.effects) {
      switch (e.type) {
        case 'explosion':
          this.drawExplosion(e);
          break;
        case 'napalm': {
          const cols = e.dirt ? ['#a06428', '#8a5320', '#c08040'] : ['#ffff55', '#ffaa00', '#ff5500', '#ff5555'];
          for (let i = 0; i < e.parts.length; i++) {
            const q = e.parts[i];
            ctx.fillStyle = cols[(i + this.frame) % cols.length];
            ctx.fillRect(Math.round(q.x), Math.round(q.y) - 1, 2, 2);
          }
          break;
        }
        case 'laser': {
          const f = 1 - e.age / e.dur;
          ctx.globalAlpha = Math.max(0, f);
          ctx.strokeStyle = e.color;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(e.x0, e.y0);
          ctx.lineTo(e.x1, e.y1);
          ctx.stroke();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(e.x0, e.y0);
          ctx.lineTo(e.x1, e.y1);
          ctx.stroke();
          ctx.globalAlpha = 1;
          break;
        }
        case 'flash':
          ctx.fillStyle = `rgba(255,255,255,${Math.max(0, 0.9 * (1 - e.age / e.dur))})`;
          ctx.fillRect(0, 0, W, H);
          break;
      }
    }
  }

  drawExplosion(e) {
    const ctx = this.ctx;
    const t = e.age, dur = e.dur, peak = e.peak;
    let r = t <= peak ? (e.r * t) / peak : e.r * (1 - (t - peak) / Math.max(1, dur - peak));
    if (e.style === 'riot') {
      ctx.fillStyle = (this.frame & 1) ? '#ffff55' : '#ffffff';
      this.ring(e.x, e.y, Math.max(1, r));
      this.ring(e.x, e.y, Math.max(1, r * 0.6), true);
      return;
    }
    if (e.style === 'dirt') {
      ctx.fillStyle = `rgba(160,100,40,${0.8 * (1 - t / dur)})`;
      this.disc(e.x, e.y, Math.max(1, r));
      return;
    }
    if (r < 1) r = 1;
    // concentric EGA bands, funky bomblets in the magenta family
    const funky = e.weapon === 'funky_sub' || e.weapon === 'funky_bomb';
    const bands = funky
      ? ['#ff55ff', '#aa00aa', '#ff55ff', '#ffffff']
      : ['#ff5555', '#ff55ff', '#ffaa00', '#ffff55', '#ffffff'];
    // alternate the two outer bands every other frame so the fireball flickers
    if (this.frame & 1) [bands[0], bands[1]] = [bands[1], bands[0]];
    const n = bands.length;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = bands[i];
      this.disc(e.x, e.y, r * (1 - i / n));
    }
    if (e.r >= 30) {
      ctx.fillStyle = '#aa0000';
      this.ring(e.x, e.y, r + 1);
    }
  }

  drawMarkers(game) {
    const ctx = this.ctx;
    for (const p of game.projectiles) {
      if (p.mode !== 'fly' || p.y >= HUD_H) continue;
      const x = Math.round(p.x);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - 3, HUD_H + 1, 7, 1);
      ctx.fillRect(x - 2, HUD_H + 2, 5, 1);
      ctx.fillRect(x - 1, HUD_H + 3, 3, 1);
      ctx.fillRect(x, HUD_H + 4, 1, 1);
      const alt = Math.round((HUD_H - p.y) / 10);
      if (alt > 0) drawText(ctx, `${alt}`, x + 5, HUD_H + 1, '#ffffff', 1);
    }
  }

  drawWind(game) {
    const ctx = this.ctx;
    const wv = Math.abs(game.wind);
    const arrow = game.wind < 0 ? '← ' : game.wind > 0 ? '→ ' : '';
    const lines = [`${arrow}Wind: ${wv}`, `Round ${game.round}/${game.rounds}`];
    let y = HUD_H + 4;
    for (const text of lines) {
      const w = textWidth(text, 2);
      const x = W - 6 - w;
      drawText(ctx, text, x + 1, y + 1, '#000000', 2);
      drawText(ctx, text, x, y, '#ffffff', 2);
      y += 17;
    }
  }

  drawTaunts(game) {
    const ctx = this.ctx;
    for (const e of game.effects) {
      if (e.type !== 'taunt') continue;
      const t = game.tanks[e.tank];
      const w = textWidth(e.text, 2);
      let x = Math.round(t.x - w / 2);
      x = Math.max(2, Math.min(W - w - 2, x));
      let y = t.y - 46;
      if (y < HUD_H + 22) y = HUD_H + 22;
      const fade = e.age > e.dur - 15 ? (e.dur - e.age) / 15 : 1;
      ctx.globalAlpha = Math.max(0, fade);
      ctx.fillStyle = '#000';
      ctx.fillRect(x - 3, y - 3, w + 6, 20);
      ctx.fillStyle = game.players[e.tank].color;
      ctx.fillRect(x - 3, y - 3, w + 6, 1);
      ctx.fillRect(x - 3, y + 16, w + 6, 1);
      ctx.fillRect(x - 3, y - 3, 1, 20);
      ctx.fillRect(x + w + 2, y - 3, 1, 20);
      drawText(ctx, e.text, x, y, '#ffffff', 2, true);
      ctx.globalAlpha = 1;
    }
  }

  drawAimPreview(game, aim) {
    const t = game.tanks[game.current];
    if (!t.alive) return;
    const ctx = this.ctx;
    const a = aim.angle * DEG;
    const tip = { x: t.x + dcos(a) * PH.BARREL_LEN, y: t.y - 3 - dsin(a) * PH.BARREL_LEN };
    const len = 8 + aim.power * 0.07;
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.85;
    for (let i = 2; i < len; i += 3) ctx.fillRect(Math.round(tip.x + dcos(a) * i), Math.round(tip.y - dsin(a) * i), 1, 1);
    ctx.globalAlpha = 1;
  }

  drawHud(game) {
    const ctx = this.ctx;
    ctx.fillStyle = HUD_BG;
    ctx.fillRect(0, 0, W, HUD_H);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, 1);
    ctx.fillStyle = '#606060';
    ctx.fillRect(0, HUD_H - 1, W, 1);
    const pl = game.players[game.current];
    const t = game.tanks[game.current];
    const y = 3;
    let x = 6;
    if (game.phase === 'shop') {
      drawText(ctx, 'Shopping...', x, y, HUD_FG, 2);
    } else if (game.phase === 'gameOver') {
      drawText(ctx, 'Game over', x, y, HUD_FG, 2);
    } else if (pl) {
      x += drawText(ctx, `Power: ${t.power}`, x, y, HUD_FG, 2) + 16;
      x += drawText(ctx, `Angle: ${t.angle}`, x, y, HUD_FG, 2) + 16;
      const name = pl.name.length > 12 ? pl.name.slice(0, 12) : pl.name;
      const nw = textWidth(name, 2);
      ctx.fillStyle = '#404040';
      ctx.fillRect(x - 3, y - 2, nw + 6, 18);
      x += drawText(ctx, name, x, y, pl.color, 2) + 18;
      const w = WEAPONS[t.weapon];
      const cnt = game.weaponCount(pl, t.weapon);
      const wname = `${cnt === Infinity ? '' : cnt + ': '}${w.name}`;
      const maxW = W - 8 - 12 - x;
      const label = textWidth(wname, 2) > maxW ? wname.slice(0, Math.max(3, Math.floor(maxW / 12))) : wname;
      // small tank glyph before the weapon name
      ctx.fillStyle = HUD_FG;
      ctx.fillRect(x, y + 6, 8, 3);
      ctx.fillRect(x + 2, y + 4, 4, 2);
      ctx.fillRect(x + 5, y + 2, 4, 1);
      x += 12;
      drawText(ctx, label, x, y, HUD_FG, 2);
    }
  }
}
