// Computer opponents. Every decision is made with the game's seeded RNG and
// the shared deterministic physics, so AI turns replay identically on every
// peer of an online game without any network traffic.
import { WEAPONS, ITEMS, TANK_HP } from './weapons.js';
import { simulateShot } from './physics.js';
import { dlen, clamp } from './mathd.js';

const SKILL = {
  moron: { angleErr: 0, powerErr: 0, random: true },
  shooter: { angleErr: 5, powerErr: 60, ignoreWind: true, coarse: true },
  poolshark: { angleErr: 2, powerErr: 25 },
  tosser: { angleErr: 2.5, powerErr: 30, minAngle: 55, maxAngle: 125 },
  chooser: { angleErr: 1.5, powerErr: 18, smartWeapon: true },
  spoiler: { angleErr: 2, powerErr: 22, smartWeapon: true, targetLeader: true },
  cyborg: { angleErr: 0, powerErr: 0, smartWeapon: true, targetWeakest: true },
};

// Attack weapons in rough order of destructiveness.
const ATTACK_PRIORITY = [
  'deaths_head', 'nuke', 'baby_nuke', 'mirv', 'heavy_roller', 'funky_bomb', 'leapfrog', 'roller', 'hot_napalm',
  'napalm', 'missile', 'baby_roller', 'laser', 'baby_missile',
];

const SHOP_LISTS = {
  moron: ['missile', 'baby_roller', 'dirt_clod', 'tracer', 'parachute'],
  shooter: ['missile', 'parachute', 'missile', 'battery'],
  poolshark: ['baby_nuke', 'missile', 'parachute', 'shield', 'roller', 'battery'],
  tosser: ['missile', 'funky_bomb', 'roller', 'parachute', 'baby_nuke', 'shield'],
  chooser: ['nuke', 'mirv', 'baby_nuke', 'heavy_shield', 'parachute', 'missile', 'battery', 'roller'],
  spoiler: ['deaths_head', 'nuke', 'mirv', 'funky_bomb', 'force_shield', 'parachute', 'baby_nuke', 'missile'],
  cyborg: ['deaths_head', 'nuke', 'mirv', 'baby_nuke', 'heavy_shield', 'mag_deflector', 'parachute', 'missile', 'battery', 'leapfrog'],
};

function pickTarget(game, me, skill) {
  const rng = game.rng;
  const enemies = game.tanks.filter((t) => t.alive && t.idx !== me.idx);
  if (enemies.length === 0) return null;
  if (skill.random) return rng.pick(enemies);
  if (skill.targetLeader) {
    let best = enemies[0], score = -Infinity;
    for (const t of enemies) {
      const p = game.players[t.idx];
      const s = p.kills * 5000 + p.wins * 20000 + p.cash * 0.2 + t.hp * 50;
      if (s > score) { score = s; best = t; }
    }
    return best;
  }
  if (skill.targetWeakest) {
    let best = enemies[0];
    for (const t of enemies) if (t.hp < best.hp || (t.hp === best.hp && Math.abs(t.x - me.x) < Math.abs(best.x - me.x))) best = t;
    return best;
  }
  // nearest, with a little randomness so it doesn't always pick on one player
  const sorted = enemies.slice().sort((a, b) => Math.abs(a.x - me.x) - Math.abs(b.x - me.x));
  return sorted[rng.chance(0.75) || sorted.length === 1 ? 0 : 1];
}

function pickWeapon(game, player, me, target, skill) {
  const owned = game.ownedWeapons(player);
  if (skill.random) return game.rng.pick(owned);
  const dist = Math.abs(target.x - me.x);
  if (!skill.smartWeapon) {
    return owned.includes('missile') ? 'missile' : 'baby_missile';
  }
  // don't waste a nuke on a tank that a missile will finish
  const hp = target.hp + (target.shield ? target.shield.pts : 0);
  for (const id of ATTACK_PRIORITY) {
    if (!owned.includes(id)) continue;
    const w = WEAPONS[id];
    if (w.kind === 'roller' && dist < 60) continue; // rollers need a slope to run down
    if (w.kind === 'napalm' && dist < 50) continue;
    if (w.flash && dist < w.radius + 30) continue; // don't nuke yourself
    if (hp <= 30 && (w.price >= 10000)) continue;
    if (hp <= 55 && id === 'deaths_head') continue;
    return id;
  }
  return 'baby_missile';
}

function planItems(game, player, me, skill) {
  const items = [];
  if (skill.random) return items;
  if (me.hp < 75 && !me.shield) {
    for (const id of ['heavy_shield', 'force_shield', 'deflector', 'mag_deflector', 'shield']) {
      if ((player.items[id] || 0) > 0) { items.push(id); break; }
    }
  }
  if (me.hp < 65) {
    let n = Math.min(player.items.battery || 0, 3);
    while (n-- > 0) items.push('battery');
  }
  return items;
}

/** Search angle/power space for the shot landing closest to the target. */
function solve(game, me, target, skill, weaponId) {
  const env = game.physicsEnv(game.settings.walls === 'random' ? 'concrete' : game.settings.walls);
  if (skill.ignoreWind) env.wind = 0;
  const w = WEAPONS[weaponId] || WEAPONS.baby_missile;
  const selfRadius = (w.radius || 10) + 12;
  const tx = target.x, ty = target.y - 3;
  const minA = skill.minAngle || 8, maxA = skill.maxAngle || 172;
  const score = (hit) => {
    if (hit.type === 'lost') return 1e9;
    let e = dlen(hit.x - tx, hit.y - ty);
    if (hit.type === 'tank' && hit.tank === target.idx) e = 0;
    const dm = dlen(hit.x - me.x, hit.y - (me.y - 3));
    if (dm < selfRadius) e += 400 + (selfRadius - dm) * 10;
    return e;
  };
  let best = { angle: 45, power: 400, err: Infinity };
  const consider = (a, p) => {
    a = clamp(Math.round(a), 0, 180);
    p = clamp(Math.round(p), 50, 1000);
    const hit = simulateShot(env, me, a, p);
    const e = score(hit);
    if (e < best.err) best = { angle: a, power: p, err: e };
  };
  // coarse grid
  const aStep = skill.coarse ? 8 : 5, pStep = skill.coarse ? 100 : 60;
  for (let a = minA; a <= maxA; a += aStep) {
    for (let p = 120; p <= 1000; p += pStep) consider(a, p);
  }
  // refine around the best solution a couple of times
  for (let pass = 0; pass < 2; pass++) {
    const b = { ...best };
    const ra = pass === 0 ? 4 : 1, rp = pass === 0 ? 40 : 8;
    const sa = pass === 0 ? 1 : 1, sp = pass === 0 ? 10 : 3;
    for (let a = b.angle - ra; a <= b.angle + ra; a += sa) {
      if (a < minA || a > maxA) continue;
      for (let p = b.power - rp; p <= b.power + rp; p += sp) consider(a, p);
    }
    if (best.err < 1) break;
  }
  return best;
}

export function aiPlanTurn(game, idx) {
  const player = game.players[idx];
  const me = game.tanks[idx];
  const rng = game.rng;
  const skill = SKILL[player.ai] || SKILL.shooter;
  const target = pickTarget(game, me, skill);
  if (!target) return { angle: me.angle, power: me.power, weapon: 'baby_missile', items: [] };
  const items = planItems(game, player, me, skill);
  let weapon = pickWeapon(game, player, me, target, skill);
  if (skill.random) {
    const w = WEAPONS[weapon];
    return { angle: rng.irange(10, 170), power: rng.irange(150, 1000), weapon, items };
  }
  // buried? try to dig out first (uses a digger if owned, else a riot charge)
  const buriedDepth = me.y - 6 - game.terrain.surfaceY(me.x);
  if (buriedDepth > 4) {
    const dig = ['riot_bomb', 'heavy_riot_bomb', 'riot_charge', 'riot_blast', 'baby_digger', 'digger', 'heavy_digger'].find((id) => game.ownsWeapon(player, id));
    if (dig) return { angle: 90, power: 200, weapon: dig, items };
  }
  const sol = solve(game, me, target, skill, weapon);
  let angle = sol.angle, power = sol.power;
  if (skill.angleErr) angle += rng.range(-skill.angleErr, skill.angleErr);
  if (skill.powerErr) power += rng.range(-skill.powerErr, skill.powerErr);
  angle = clamp(Math.round(angle), 0, 180);
  power = clamp(Math.round(power), 0, 1000);
  return { angle, power, weapon, items, target: target.idx, err: sol.err };
}

/** Spend the round's cash. Deterministic (no RNG needed except for morons). */
export function aiShop(game, player) {
  const list = SHOP_LISTS[player.ai] || SHOP_LISTS.shooter;
  let guard = 0;
  let boughtSomething = true;
  while (boughtSomething && guard++ < 20) {
    boughtSomething = false;
    for (const id of list) {
      const isItem = !!ITEMS[id];
      const cat = isItem ? ITEMS[id] : WEAPONS[id];
      if (!cat) continue;
      const owned = isItem ? player.items[id] || 0 : player.weapons[id] || 0;
      const cap = cat.permanent ? 1 : cat.qty * 2;
      if (owned >= cap) continue;
      if (cat.price > player.cash) continue;
      // keep a reserve so morons don't blow everything on tracers
      if (player.ai === 'moron' && game.rng.chance(0.4)) continue;
      if (game.buy(player.idx, isItem ? 'item' : 'weapon', id, 1)) boughtSomething = true;
    }
  }
}

export { SKILL as AI_SKILL };
