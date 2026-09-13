// Projectile physics shared by the simulation and the AI aiming search.
// Everything here is pure: stepProjectile mutates only the projectile it is
// given, never the environment, so the AI can run thousands of what-if shots.
import { DEG, dsin, dcos, dlen, clamp } from './mathd.js';

export const GRAVITY = 0.06; // px / tick^2 at 100% gravity
export const WIND_ACCEL = 0.00012; // px / tick^2 per wind unit
export const VEL_PER_POWER = 0.0095; // px / tick per power unit
export const TANK_HALF_W = 7;
export const TANK_H = 6;
export const SHIELD_R = 16;
export const BARREL_LEN = 11;
export const MAX_POWER = 1000;

export function tankCenter(t) {
  return { x: t.x, y: t.y - 3 };
}

export function barrelTip(t) {
  const a = t.angle * DEG;
  return { x: t.x + dcos(a) * BARREL_LEN, y: t.y - 3 - dsin(a) * BARREL_LEN };
}

export function launchVelocity(angleDeg, power) {
  const a = angleDeg * DEG;
  const v = power * VEL_PER_POWER;
  return { vx: dcos(a) * v, vy: -dsin(a) * v };
}

/** Does point (x,y) lie inside tank t's body box? */
export function pointInTank(t, x, y) {
  return x >= t.x - TANK_HALF_W && x <= t.x + TANK_HALF_W && y >= t.y - TANK_H && y <= t.y;
}

/**
 * Advance projectile p by one tick inside env = { terrain, tanks, wind,
 * gravity, walls, w, h }. Returns a hit descriptor or null when still flying.
 *   { type: 'terrain' | 'tank' | 'shield' | 'floor' | 'wall' | 'lost', x, y, tank }
 */
export function stepProjectile(p, env) {
  p.vx += env.wind * WIND_ACCEL;
  p.vy += env.gravity;
  // magnetic deflectors push shells away from the tank they protect
  for (const t of env.tanks) {
    if (!t.alive || !t.shield || !t.shield.magnetic) continue;
    if (p.immune && t.idx === p.owner) continue;
    const dx = p.x - t.x, dy = p.y - (t.y - 3);
    const d = dlen(dx, dy);
    if (d > 0 && d < 80) {
      const f = 0.32 * (1 - d / 80);
      p.vx += (dx / d) * f;
      p.vy += (dy / d) * f;
    }
  }
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(p.vx), Math.abs(p.vy))));
  let sx = p.vx / steps, sy = p.vy / steps;
  for (let i = 0; i < steps; i++) {
    let nx = p.x + sx, ny = p.y + sy;
    if (nx < 0 || nx >= env.w) {
      switch (env.walls) {
        case 'rubber':
        case 'spring': {
          const k = env.walls === 'rubber' ? 0.75 : 1.2;
          nx = nx < 0 ? -nx : 2 * (env.w - 0.001) - nx;
          p.vx = -p.vx * k;
          sx = -sx * k;
          p.bounces = (p.bounces || 0) + 1;
          if (p.bounces > 40) return { type: 'lost', x: clamp(nx, 0, env.w - 1), y: ny };
          break;
        }
        case 'wrap':
          nx = nx < 0 ? nx + env.w : nx - env.w;
          break;
        case 'none':
          return { type: 'lost', x: clamp(nx, 0, env.w - 1), y: ny };
        default: // concrete
          p.x = clamp(nx, 0, env.w - 1);
          p.y = ny;
          return { type: 'wall', x: p.x, y: p.y };
      }
    }
    p.x = nx;
    p.y = ny;
    if (p.y >= env.h) return { type: 'floor', x: p.x, y: env.h - 1 };
    if (p.y < -4000) return { type: 'lost', x: p.x, y: p.y };
    if (p.immune) {
      const o = env.tanks[p.owner];
      if (!o || dlen(p.x - o.x, p.y - (o.y - 3)) > SHIELD_R + 3) p.immune = false;
    }
    for (const t of env.tanks) {
      if (!t.alive) continue;
      if (p.immune && t.idx === p.owner) continue;
      if (t.shield) {
        const dx = p.x - t.x, dy = p.y - (t.y - 3);
        if (dx * dx + dy * dy <= SHIELD_R * SHIELD_R) return { type: 'shield', x: p.x, y: p.y, tank: t.idx };
      }
      if (pointInTank(t, p.x, p.y)) return { type: 'tank', x: p.x, y: p.y, tank: t.idx };
    }
    if (env.terrain.get(Math.round(p.x), Math.round(p.y))) return { type: 'terrain', x: p.x, y: p.y };
  }
  return null;
}

/**
 * Fire a plain shell from tank t at (angle, power) and follow it until it hits
 * something. Used by the AI. Returns the hit descriptor ({type:'lost'} when
 * it never comes down) plus the apex height reached.
 */
export function simulateShot(env, t, angle, power, maxTicks = 1500) {
  const tip = barrelTip(t);
  const v = launchVelocity(angle, power);
  const p = { x: tip.x, y: tip.y, vx: v.vx, vy: v.vy, owner: t.idx, immune: true, bounces: 0 };
  let apex = tip.y;
  for (let i = 0; i < maxTicks; i++) {
    const hit = stepProjectile(p, env);
    if (p.y < apex) apex = p.y;
    if (hit) return { ...hit, ticks: i + 1, apex };
  }
  return { type: 'lost', x: p.x, y: p.y, ticks: maxTicks, apex };
}
