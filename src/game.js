// The simulation. Fully deterministic: given the same settings, seed and the
// same sequence of commands, every peer computes the identical game. Nothing in
// here touches the DOM, timers or Math.random.
import { RNG } from './rng.js';
import { Terrain } from './terrain.js';
import { WEAPONS, ITEMS, TANK_HP, MONEY_PER_DAMAGE, KILL_BONUS, WIN_BONUS, SURVIVE_BONUS } from './weapons.js';
import { DEG, dsin, dcos, dlen, datan2, clamp, sign } from './mathd.js';
import * as PH from './physics.js';
import { aiPlanTurn, aiShop } from './ai.js';
import { pickTaunt } from './taunts.js';

export const W = 640;
export const H = 360;
export const HUD_H = 20;
export const FALL_DAMAGE = 0.6; // hit points per pixel fallen without a parachute
export const NUM_PALETTES = 6;

export const DEFAULT_SETTINGS = {
  rounds: 5,
  initialCash: 10000,
  interest: 0.05,
  gravity: 1.0,
  windMode: 'changing', // none | constant | changing
  windStrength: 1.0,
  walls: 'random', // concrete | rubber | spring | wrap | none | random
  dirtFalls: true,
  tankExplosions: true,
  talkingTanks: true,
  terrain: 'random', // flat | hills | mountains | canyon | random
  turnOrder: 'roundRobin', // roundRobin | random | loserFirst | winnerFirst
  maxTurns: 60, // per round, 0 = unlimited (sudden death safety valve)
};

export const AI_LEVELS = [
  { id: 'moron', name: 'Moron', desc: 'Fires at random. Mostly harmless.' },
  { id: 'shooter', name: 'Shooter', desc: 'Aims, but ignores the wind.' },
  { id: 'poolshark', name: 'Poolshark', desc: 'Good aim, plays the wind.' },
  { id: 'tosser', name: 'Tosser', desc: 'Lobs high shots over hills.' },
  { id: 'chooser', name: 'Chooser', desc: 'Picks the right weapon for the job.' },
  { id: 'spoiler', name: 'Spoiler', desc: 'Hunts whoever is winning.' },
  { id: 'cyborg', name: 'Cyborg', desc: 'Never misses. Buys the big stuff.' },
];

export const PLAYER_COLORS = [
  '#ff5555', '#5599ff', '#55ff55', '#ffff55', '#ff55ff', '#55ffff', '#ffffff', '#ffaa00', '#aaaaaa', '#aa55ff',
];

const SHIELD_ITEMS = ['heavy_shield', 'force_shield', 'deflector', 'mag_deflector', 'shield'];

export class Game {
  constructor(settings, players, seed) {
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.seed = seed >>> 0;
    this.rng = new RNG(this.seed);
    this.terrain = new Terrain(W, H);
    this.players = players.map((p, i) => ({
      idx: i,
      name: p.name || `Player ${i + 1}`,
      color: p.color || PLAYER_COLORS[i % PLAYER_COLORS.length],
      type: p.type === 'ai' ? 'ai' : 'human',
      ai: p.ai || 'shooter',
      owner: p.owner || null, // peer id in online games
      cash: this.settings.initialCash,
      weapons: { baby_missile: 0 },
      items: {},
      kills: 0,
      wins: 0,
      damageDealt: 0,
      roundKills: 0,
      totalDamageTaken: 0,
    }));
    this.tanks = this.players.map((p) => ({
      idx: p.idx, x: 0, y: 0, hp: TANK_HP, alive: true, angle: 45, power: 400,
      weapon: 'baby_missile', shield: null, falling: false, fallV: 0, fallAcc: 0, fallStart: 0,
      chute: false, lastHitBy: -1, napalmDmg: 0,
    }));
    this.round = 0;
    this.phase = 'init';
    this.current = 0;
    this.order = [];
    this.orderPos = 0;
    this.turnNo = 0;
    this.wind = 0;
    this.wallsThisShot = 'concrete';
    this.style = 'hills';
    this.palette = 0;
    this.projectiles = [];
    this.effects = [];
    this.trails = [];
    this.events = [];
    this.tick = 0;
    this.aimTick = 0;
    this.timer = 0;
    this.deathOrder = [];
    this.lastRoundOrder = [];
    this.shopDone = [];
    this.roundResult = null;
    this.aiPlan = null;
    this.turnShotBy = -1;
    this.turnDamaged = new Set();
    this.rounds = this.settings.rounds;
  }

  // ------------------------------------------------------------ helpers
  emit(type, data) {
    this.events.push({ type, ...data });
  }
  takeEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
  aliveTanks() {
    return this.tanks.filter((t) => t.alive);
  }
  currentPlayer() {
    return this.players[this.current];
  }
  currentTank() {
    return this.tanks[this.current];
  }
  isIdle() {
    return this.phase === 'aim' || this.phase === 'shop' || this.phase === 'gameOver';
  }
  physicsEnv(wallsOverride) {
    return {
      terrain: this.terrain,
      tanks: this.tanks,
      wind: this.wind,
      gravity: PH.GRAVITY * this.settings.gravity,
      walls: wallsOverride || this.wallsThisShot,
      w: W,
      h: H,
    };
  }
  ownsWeapon(p, id) {
    const w = WEAPONS[id];
    if (!w || w.hidden) return false;
    if (w.qty === 0) return true;
    return (p.weapons[id] || 0) > 0;
  }
  weaponCount(p, id) {
    return WEAPONS[id].qty === 0 ? Infinity : p.weapons[id] || 0;
  }
  ownedWeapons(p) {
    return Object.keys(WEAPONS).filter((id) => this.ownsWeapon(p, id));
  }
  itemCount(p, id) {
    return p.items[id] || 0;
  }

  // ------------------------------------------------------------ rounds
  start() {
    this.startRound();
  }

  startRound() {
    this.round++;
    const s = this.settings;
    const rng = this.rng;
    this.style = s.terrain === 'random' ? rng.pick(['flat', 'hills', 'hills', 'mountains', 'canyon']) : s.terrain;
    this.palette = rng.int(NUM_PALETTES);
    this.terrain.generate(rng, this.style, HUD_H + 60, H - 30);
    this.wind = s.windMode === 'none' ? 0 : Math.round(rng.irange(-100, 100) * s.windStrength);
    this.projectiles = [];
    this.effects = [];
    this.trails = [];
    this.deathOrder = [];
    this.turnNo = 0;
    this.aiPlan = null;

    // place tanks in shuffled slots across the map
    const n = this.players.length;
    const slots = rng.shuffle(this.players.map((p) => p.idx));
    const slotW = (W - 40) / n;
    slots.forEach((idx, k) => {
      const t = this.tanks[idx];
      const p = this.players[idx];
      const x = Math.round(20 + slotW * k + rng.range(slotW * 0.2, slotW * 0.8));
      const y = this.terrain.surfaceY(x) - 1;
      this.terrain.flatten(x - 7, x + 7, y);
      t.x = x;
      t.y = y;
      t.hp = TANK_HP;
      t.alive = true;
      t.shield = null;
      t.falling = false;
      t.fallV = 0;
      t.fallAcc = 0;
      t.chute = false;
      t.lastHitBy = -1;
      t.napalmDmg = 0;
      if (this.round === 1) t.angle = x < W / 2 ? 45 : 135;
      if (!this.ownsWeapon(p, t.weapon)) t.weapon = 'baby_missile';
      p.roundKills = 0;
      // auto defense raises the best shield before anyone fires
      if (this.itemCount(p, 'auto_defense') > 0) {
        const best = SHIELD_ITEMS.find((id) => this.itemCount(p, id) > 0);
        if (best) this.activateShield(idx, best);
      }
    });

    // turn order
    const ids = this.players.map((p) => p.idx);
    switch (s.turnOrder) {
      case 'random':
        this.order = rng.shuffle(ids.slice());
        break;
      case 'loserFirst':
        this.order = this.lastRoundOrder.length ? this.lastRoundOrder.slice() : ids;
        break;
      case 'winnerFirst':
        this.order = this.lastRoundOrder.length ? this.lastRoundOrder.slice().reverse() : ids;
        break;
      default: {
        const r = (this.round - 1) % n;
        this.order = ids.slice(r).concat(ids.slice(0, r));
      }
    }
    this.orderPos = 0;
    this.current = this.order[0];
    this.phase = 'aim';
    this.aimTick = 0;
    this.emit('roundStart', { round: this.round });
    this.emit('turn', { p: this.current });
  }

  // ------------------------------------------------------------ commands
  /** Apply a player command. Returns true if it was accepted. */
  apply(cmd) {
    const p = cmd.p;
    switch (cmd.type) {
      case 'fire': {
        if (this.phase !== 'aim' || p !== this.current) return false;
        const t = this.tanks[p];
        const pl = this.players[p];
        if (!this.ownsWeapon(pl, cmd.weapon)) return false;
        t.angle = clamp(Math.round(cmd.angle), 0, 180);
        t.power = clamp(Math.round(cmd.power), 0, PH.MAX_POWER);
        t.weapon = cmd.weapon;
        if (WEAPONS[cmd.weapon].qty !== 0) pl.weapons[cmd.weapon]--;
        this.fire();
        return true;
      }
      case 'aim': {
        // cosmetic: lets spectators watch the barrel move. Does not affect the checksum.
        if (this.phase !== 'aim' || p !== this.current) return false;
        const t = this.tanks[p];
        if (cmd.angle != null) t.angle = clamp(Math.round(cmd.angle), 0, 180);
        if (cmd.power != null) t.power = clamp(Math.round(cmd.power), 0, PH.MAX_POWER);
        if (cmd.weapon != null && this.ownsWeapon(this.players[p], cmd.weapon)) t.weapon = cmd.weapon;
        return true;
      }
      case 'item':
        if (this.phase !== 'aim' || p !== this.current) return false;
        return this.useItem(p, cmd.item);
      case 'move':
        if (this.phase !== 'aim' || p !== this.current) return false;
        return this.moveTank(p, cmd.dir < 0 ? -1 : 1);
      case 'shop': {
        if (this.phase !== 'shop' || this.shopDone[p]) return false;
        for (const b of cmd.buys || []) this.buy(p, b.kind, b.id, b.n || 1);
        this.shopDone[p] = true;
        this.emit('shopDone', { p });
        if (this.shopDone.every(Boolean)) this.startRound();
        return true;
      }
      case 'aiTakeover': {
        const pl = this.players[p];
        pl.type = 'ai';
        pl.ai = cmd.level || 'poolshark';
        pl.owner = null;
        if (this.phase === 'aim' && this.current === p) {
          this.aimTick = 0;
          this.aiPlan = null;
        }
        if (this.phase === 'shop' && !this.shopDone[p]) {
          aiShop(this, pl);
          this.shopDone[p] = true;
          if (this.shopDone.every(Boolean)) this.startRound();
        }
        this.emit('aiTakeover', { p });
        return true;
      }
      case 'skip':
        if (this.phase !== 'aim' || p !== this.current) return false;
        this.emit('skip', { p });
        this.endTurn();
        return true;
      default:
        return false;
    }
  }

  buy(p, kind, id, n = 1) {
    const pl = this.players[p];
    const cat = kind === 'item' ? ITEMS[id] : WEAPONS[id];
    if (!cat || n < 1) return false;
    if (kind !== 'item' && cat.qty === 0) return false;
    const cost = cat.price * n;
    if (cost > pl.cash) return false;
    if (cat.permanent) {
      if ((pl.items[id] || 0) > 0) return false;
      pl.items[id] = 1;
      pl.cash -= cat.price;
      return true;
    }
    pl.cash -= cost;
    const bag = kind === 'item' ? pl.items : pl.weapons;
    bag[id] = (bag[id] || 0) + cat.qty * n;
    return true;
  }

  useItem(p, id) {
    const pl = this.players[p];
    const t = this.tanks[p];
    const it = ITEMS[id];
    if (!it || !t.alive || this.itemCount(pl, id) <= 0) return false;
    if (it.kind === 'shield') {
      if (t.shield && t.shield.pts >= it.points) return false;
      this.activateShield(p, id);
      return true;
    }
    if (it.kind === 'battery') {
      if (t.hp >= TANK_HP) return false;
      pl.items[id]--;
      t.hp = Math.min(TANK_HP, t.hp + it.heal);
      this.emit('battery', { p });
      return true;
    }
    return false;
  }

  activateShield(p, id) {
    const it = ITEMS[id];
    const pl = this.players[p];
    pl.items[id]--;
    this.tanks[p].shield = { id, pts: it.points, max: it.points, deflect: !!it.deflect, magnetic: !!it.magnetic, color: it.color };
    this.emit('shieldUp', { p, id });
  }

  moveTank(p, dir) {
    const pl = this.players[p];
    const t = this.tanks[p];
    if (!t.alive || this.itemCount(pl, 'fuel') <= 0) return false;
    let moved = 0;
    for (let i = 0; i < 10; i++) {
      const nx = t.x + dir;
      if (nx < 8 || nx >= W - 8) break;
      // find standing height at nx: first dirt at/below (y-3), tank sits on it
      const g = this.terrain.groundBelow(nx, t.y - 3);
      const ny = g - 1;
      if (ny < t.y - 3) break; // too steep uphill
      if (ny > t.y + 3) break; // cliff
      if (this.tanks.some((o) => o.alive && o.idx !== p && Math.abs(o.x - nx) < PH.TANK_HALF_W * 2)) break;
      t.x = nx;
      t.y = ny;
      moved++;
    }
    if (moved === 0) return false;
    pl.items.fuel--;
    this.emit('move', { p });
    return true;
  }

  // ------------------------------------------------------------ firing
  fire() {
    const t = this.tanks[this.current];
    const w = WEAPONS[t.weapon];
    const s = this.settings;
    this.wallsThisShot = s.walls === 'random' ? this.rng.pick(['concrete', 'rubber', 'spring', 'wrap']) : s.walls;
    this.trails = [];
    this.turnShotBy = this.current;
    this.turnDamaged = new Set();
    this.turnNo++;
    this.emit('fire', { p: this.current, weapon: t.weapon, walls: this.wallsThisShot });
    this.phase = 'action';
    if (w.kind === 'laser') {
      this.fireLaser(t, w);
      return;
    }
    const tip = PH.barrelTip(t);
    const v = PH.launchVelocity(t.angle, t.power);
    this.spawnProjectile({ x: tip.x, y: tip.y, vx: v.vx, vy: v.vy, owner: t.idx, weapon: t.weapon, immune: true });
  }

  spawnProjectile(init) {
    const w = WEAPONS[init.weapon];
    const p = {
      mode: 'fly', age: 0, hops: w.hops || 0, split: false, bounces: 0, sub: false, immune: false, noHit: 0,
      ...init,
    };
    p.trail = { color: this.players[p.owner].color, points: [] };
    this.trails.push(p.trail);
    this.projectiles.push(p);
    return p;
  }

  fireLaser(t, w) {
    const tip = PH.barrelTip(t);
    const a = t.angle * DEG;
    const dx = dcos(a), dy = -dsin(a);
    const len = 120 + t.power * 0.4;
    let x = tip.x, y = tip.y, burned = 0;
    let ex = x, ey = y;
    for (let i = 0; i < len; i++) {
      x += dx;
      y += dy;
      if (x < 0 || x >= W || y >= H) break;
      const rx = Math.round(x), ry = Math.round(y);
      let stop = false;
      for (const o of this.tanks) {
        if (!o.alive || o.idx === t.idx) continue;
        if (o.shield && dlen(x - o.x, y - (o.y - 3)) <= PH.SHIELD_R) {
          this.damage(o.idx, w.damage, t.idx, 'laser');
          stop = true;
          break;
        }
        if (PH.pointInTank(o, x, y)) {
          this.damage(o.idx, w.damage, t.idx, 'laser');
          stop = true;
          break;
        }
      }
      if (stop) { ex = x; ey = y; break; }
      if (this.terrain.get(rx, ry)) {
        burned++;
        this.terrain.carveCircle(rx, ry, 1);
        if (burned > 40) { ex = x; ey = y; break; }
      }
      ex = x;
      ey = y;
    }
    this.effects.push({ type: 'laser', x0: tip.x, y0: tip.y, x1: ex, y1: ey, age: 0, dur: 24, color: this.players[t.idx].color });
    this.emit('laser', {});
  }

  // ------------------------------------------------------------ tick
  step() {
    this.tick++;
    switch (this.phase) {
      case 'aim':
        this.aimTick++;
        this.tickAim();
        break;
      case 'action':
        this.updateProjectiles();
        this.updateEffects();
        if (this.terrain.dirtyCols.size) this.terrain.settleStep(3);
        this.updateTanks();
        this.processDeaths();
        if (this.isQuiet()) this.endTurn();
        break;
      case 'roundOver':
        this.updateEffects();
        this.updateTanks();
        if (--this.timer <= 0) {
          if (this.round >= this.rounds) {
            this.phase = 'gameOver';
            this.emit('gameOver', {});
          } else this.beginShop();
        }
        break;
      default:
        this.updateEffects();
    }
  }

  tickAim() {
    const pl = this.players[this.current];
    const t = this.tanks[this.current];
    this.ageTaunts();
    if (pl.type !== 'ai') return;
    if (!this.aiPlan) {
      this.aiPlan = aiPlanTurn(this, this.current);
      for (const id of this.aiPlan.items || []) this.useItem(this.current, id);
    }
    const plan = this.aiPlan;
    // animate the turret swinging to the chosen solution, then fire
    if (this.aimTick < 20) return;
    const da = plan.angle - t.angle;
    if (da !== 0) t.angle += clamp(da, -3, 3);
    const dp = plan.power - t.power;
    if (dp !== 0) t.power += clamp(dp, -20, 20);
    if (this.aimTick > 25 && this.ownsWeapon(pl, plan.weapon)) t.weapon = plan.weapon;
    if (t.angle === plan.angle && t.power === plan.power && this.aimTick > 30) {
      this.apply({ type: 'fire', p: this.current, angle: plan.angle, power: plan.power, weapon: this.ownsWeapon(pl, plan.weapon) ? plan.weapon : 'baby_missile' });
      this.aiPlan = null;
    }
  }

  ageTaunts() {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      if (e.type === 'taunt' || e.type === 'smoke') {
        if (++e.age > e.dur) this.effects.splice(i, 1);
      }
    }
  }

  isQuiet() {
    if (this.projectiles.length) return false;
    if (this.terrain.dirtyCols.size) return false;
    for (const e of this.effects) {
      if (e.type === 'explosion' || e.type === 'napalm' || e.type === 'laser' || e.type === 'flash') return false;
    }
    for (const t of this.tanks) if (t.alive && (t.falling || t.hp <= 0)) return false;
    return true;
  }

  endTurn() {
    // "missed me" taunts for the shot's target neighbourhood
    if (this.settings.talkingTanks && this.turnShotBy >= 0 && this.turnDamaged.size === 0 && this.rng.chance(0.35)) {
      const others = this.aliveTanks().filter((t) => t.idx !== this.turnShotBy);
      if (others.length) this.say(this.rng.pick(others).idx, 'miss');
    }
    this.turnShotBy = -1;
    const alive = this.aliveTanks();
    if (alive.length <= 1 || (this.settings.maxTurns && this.turnNo >= this.settings.maxTurns * this.players.length)) {
      this.finishRound();
      return;
    }
    // next living player in order
    for (let i = 0; i < this.order.length; i++) {
      this.orderPos = (this.orderPos + 1) % this.order.length;
      if (this.tanks[this.order[this.orderPos]].alive) break;
    }
    this.current = this.order[this.orderPos];
    if (this.settings.windMode === 'changing') {
      const target = Math.round(this.rng.irange(-100, 100) * this.settings.windStrength);
      this.wind = Math.round((this.wind + target) / 2);
    }
    this.phase = 'aim';
    this.aimTick = 0;
    this.aiPlan = null;
    this.emit('turn', { p: this.current });
  }

  finishRound() {
    const alive = this.aliveTanks();
    const winner = alive.length === 1 ? alive[0].idx : -1;
    if (winner >= 0) {
      const pl = this.players[winner];
      pl.wins++;
      pl.cash += WIN_BONUS + SURVIVE_BONUS;
      if (this.settings.talkingTanks) this.say(winner, 'win');
    } else {
      for (const t of alive) this.players[t.idx].cash += SURVIVE_BONUS;
    }
    for (const pl of this.players) pl.cash += Math.floor(pl.cash * this.settings.interest);
    this.lastRoundOrder = this.deathOrder.concat(alive.map((t) => t.idx));
    this.roundResult = { round: this.round, winner, order: this.lastRoundOrder.slice() };
    this.phase = 'roundOver';
    this.timer = 200;
    this.emit('roundOver', { winner });
  }

  beginShop() {
    this.phase = 'shop';
    this.shopDone = this.players.map((p) => p.type === 'ai');
    for (const p of this.players) if (p.type === 'ai') aiShop(this, p);
    this.emit('shop', {});
    if (this.shopDone.every(Boolean)) this.startRound();
  }

  // ------------------------------------------------------------ projectiles
  updateProjectiles() {
    const env = this.physicsEnv();
    const list = this.projectiles.slice();
    for (const p of list) {
      if (p.mode === 'fly') this.flyStep(p, env);
      else if (p.mode === 'roll') this.rollStep(p);
      else if (p.mode === 'dig') this.digStep(p);
    }
  }

  removeProjectile(p) {
    const i = this.projectiles.indexOf(p);
    if (i >= 0) this.projectiles.splice(i, 1);
  }

  flyStep(p, env) {
    const w = WEAPONS[p.weapon];
    p.age++;
    if (p.noHit > 0) {
      p.noHit--;
      p.vx += env.wind * PH.WIND_ACCEL;
      p.vy += env.gravity;
      p.x += p.vx;
      p.y += p.vy;
      this.trailPoint(p);
      return;
    }
    const hit = PH.stepProjectile(p, env);
    this.trailPoint(p);
    if (w.smoke && p.age % 3 === 0) this.effects.push({ type: 'smoke', x: p.x, y: p.y, age: 0, dur: 240 + this.rng.int(120) });
    if (!hit && w.kind === 'mirv' && !p.split && p.vy >= 0 && p.age > 5) {
      this.splitMirv(p, w);
      return;
    }
    if (!hit) {
      if (p.age > 4000) this.removeProjectile(p);
      return;
    }
    this.resolveHit(p, hit, w);
  }

  trailPoint(p) {
    const pts = p.trail.points;
    if (pts.length < 3000 && p.y > -50) pts.push(Math.round(p.x), Math.round(p.y));
  }

  splitMirv(p, w) {
    this.removeProjectile(p);
    const n = w.warheads;
    for (let i = 0; i < n; i++) {
      const spread = (i - (n - 1) / 2) * 0.9;
      this.spawnProjectile({ x: p.x, y: p.y, vx: p.vx + spread, vy: p.vy, owner: p.owner, weapon: p.weapon, sub: true, split: true, immune: false });
    }
    this.emit('split', {});
  }

  resolveHit(p, hit, w) {
    if (hit.type === 'lost') {
      this.removeProjectile(p);
      this.emit('lost', {});
      return;
    }
    if (hit.type === 'shield') {
      const t = this.tanks[hit.tank];
      if (t.shield.deflect && !p.deflected) {
        // bounce off the shield sphere
        const nx = p.x - t.x, ny = p.y - (t.y - 3);
        const nl = dlen(nx, ny) || 1;
        const ux = nx / nl, uy = ny / nl;
        const dot = p.vx * ux + p.vy * uy;
        p.vx = (p.vx - 2 * dot * ux) * 0.8;
        p.vy = (p.vy - 2 * dot * uy) * 0.8;
        p.x = t.x + ux * (PH.SHIELD_R + 2);
        p.y = t.y - 3 + uy * (PH.SHIELD_R + 2);
        p.deflected = true;
        p.noHit = 2;
        t.shield.pts -= 10;
        if (t.shield.pts <= 0) { t.shield = null; this.emit('shieldDown', { p: t.idx }); }
        this.emit('deflect', {});
        return;
      }
    }
    const x = hit.x, y = hit.y;
    const dirx = p.vx, diry = p.vy;
    switch (w.kind) {
      case 'shell':
      case 'tracer':
        this.explode(x, y, w.radius, w.damage, p.owner, p.weapon);
        break;
      case 'mirv':
        this.explode(x, y, w.radius, w.damage, p.owner, p.weapon);
        break;
      case 'leapfrog':
        this.explode(x, y, w.radius, w.damage, p.owner, p.weapon);
        if (p.hops > 1) {
          const sp = dlen(p.vx, p.vy) * 0.75;
          const ang = datan2(-Math.abs(p.vy), p.vx || 0.001);
          const nv = { vx: dcos(ang) * sp, vy: -Math.abs(dsin(ang) * sp) - 1.5 };
          const q = this.spawnProjectile({ x, y: y - 2, vx: nv.vx, vy: nv.vy, owner: p.owner, weapon: p.weapon, hops: p.hops - 1, noHit: 4 });
          q.noHit = 6;
        }
        break;
      case 'funky': {
        this.explode(x, y, w.radius, w.damage, p.owner, p.weapon);
        for (let i = 0; i < w.subs; i++) {
          const q = this.spawnProjectile({
            x, y: y - 2, vx: this.rng.range(-4.5, 4.5), vy: -this.rng.range(3, 8), owner: p.owner,
            weapon: 'funky_sub', sub: true, noHit: 6,
          });
          q.trail.color = ['#ff55ff', '#55ffff', '#ffff55', '#55ff55', '#ff5555'][i % 5];
        }
        break;
      }
      case 'funky_sub':
        this.explode(x, y, w.radius, w.damage, p.owner, p.weapon);
        break;
      case 'napalm':
        this.spawnNapalm(x, y, w, p.owner, false);
        break;
      case 'liquid_dirt':
        this.spawnNapalm(x, y, w, p.owner, true);
        break;
      case 'roller':
        if (hit.type === 'tank' || hit.type === 'shield' || hit.type === 'wall') {
          this.explode(x, y, w.radius, w.damage, p.owner, p.weapon);
        } else {
          p.mode = 'roll';
          p.dir = sign(p.vx) || 1;
          p.x = Math.round(x);
          p.y = Math.round(y);
          while (p.y > 0 && this.terrain.get(p.x, p.y)) p.y--;
          p.lowY = p.y;
          p.rollAge = 0;
          this.emit('roll', {});
          return;
        }
        break;
      case 'riot_cone': {
        const span = this.terrain.carveCone(x, y, dirx, diry, w.length, 0.5);
        if (this.settings.dirtFalls) this.terrain.markDirty(span[0], span[1]);
        this.effects.push({ type: 'explosion', x, y, r: 8, age: 0, dur: 14, peak: 6, applied: true, style: 'riot' });
        this.emit('riot', {});
        break;
      }
      case 'riot': {
        const span = this.terrain.carveCircle(x, y, w.radius);
        if (this.settings.dirtFalls) this.terrain.markDirty(span[0], span[1]);
        this.effects.push({ type: 'explosion', x, y, r: w.radius, age: 0, dur: 20, peak: 8, applied: true, style: 'riot' });
        this.emit('riot', {});
        break;
      }
      case 'digger':
      case 'sandhog':
        if (hit.type === 'tank' || hit.type === 'shield' || hit.type === 'wall' || hit.type === 'floor') {
          this.explode(x, y, w.radius, w.damage, p.owner, p.weapon);
        } else {
          p.mode = 'dig';
          const l = dlen(p.vx, p.vy) || 1;
          p.dirx = p.vx / l;
          p.diry = p.vy / l;
          p.left = w.length;
          p.airRun = 0;
          p.x = x;
          p.y = y;
          this.emit('dig', {});
          return;
        }
        break;
      case 'dirt': {
        const span = this.terrain.fillCircle(x, y, w.radius, HUD_H);
        if (this.settings.dirtFalls) this.terrain.markDirty(span[0], span[1]);
        this.effects.push({ type: 'explosion', x, y, r: w.radius, age: 0, dur: 16, peak: 6, applied: true, style: 'dirt' });
        this.emit('dirt', {});
        for (const t of this.tanks) {
          if (t.alive && Math.abs(t.x - x) <= w.radius && t.y >= y - w.radius && t.y <= y + w.radius && this.settings.talkingTanks && this.rng.chance(0.7)) this.say(t.idx, 'buried');
        }
        break;
      }
      default:
        this.explode(x, y, w.radius || 10, w.damage || 0, p.owner, p.weapon);
    }
    this.removeProjectile(p);
  }

  rollStep(p) {
    const w = WEAPONS[p.weapon];
    const T = this.terrain;
    p.rollAge++;
    if (p.rollAge > 700) return this.explodeProjectile(p, w);
    for (let k = 0; k < 2; k++) {
      let nx = p.x + p.dir;
      if (nx < 0 || nx >= W) {
        if (this.wallsThisShot === 'wrap') nx = nx < 0 ? W - 1 : 0;
        else if (this.wallsThisShot === 'rubber' || this.wallsThisShot === 'spring') { p.dir = -p.dir; continue; }
        else if (this.wallsThisShot === 'none') { this.removeProjectile(p); this.emit('lost', {}); return; }
        else return this.explodeProjectile(p, w);
      }
      if (!T.get(nx, p.y)) {
        p.x = nx;
        let drop = 0;
        while (drop < 4 && p.y + 1 < H && !T.get(p.x, p.y + 1)) { p.y++; drop++; }
        if (p.y > p.lowY) p.lowY = p.y;
      } else {
        let climbed = false;
        for (let dy = 1; dy <= 2; dy++) {
          if (!T.get(nx, p.y - dy)) { p.x = nx; p.y -= dy; climbed = true; break; }
        }
        if (!climbed) return this.explodeProjectile(p, w);
        if (p.lowY - p.y > 14) return this.explodeProjectile(p, w); // rolled to rest in a dip
      }
      for (const t of this.tanks) {
        if (!t.alive) continue;
        if (t.shield && dlen(p.x - t.x, p.y - (t.y - 3)) <= PH.SHIELD_R + 1) return this.explodeProjectile(p, w);
        if (Math.abs(p.x - t.x) <= PH.TANK_HALF_W + 1 && p.y >= t.y - PH.TANK_H - 1 && p.y <= t.y + 1) return this.explodeProjectile(p, w);
      }
    }
    this.trailPoint(p);
  }

  digStep(p) {
    const w = WEAPONS[p.weapon];
    const T = this.terrain;
    for (let k = 0; k < 2; k++) {
      if (--p.left <= 0) return this.explodeProjectile(p, w);
      if (w.kind === 'sandhog' && p.left % 14 === 0) {
        const a = datan2(p.diry, p.dirx) + this.rng.range(-1.3, 1.3);
        p.dirx = dcos(a);
        p.diry = dsin(a);
      }
      p.x += p.dirx;
      p.y += p.diry;
      if (p.x < 0 || p.x >= W || p.y >= H || p.y < HUD_H) {
        p.x = clamp(p.x, 0, W - 1);
        p.y = clamp(p.y, HUD_H, H - 1);
        return this.explodeProjectile(p, w);
      }
      const rx = Math.round(p.x), ry = Math.round(p.y);
      if (T.get(rx, ry)) p.airRun = 0; else if (++p.airRun > 12) return this.explodeProjectile(p, w);
      T.carveCircle(rx, ry, w.bore);
      for (const t of this.tanks) {
        if (!t.alive || (t.idx === p.owner && p.left > w.length - 12)) continue;
        if (t.shield && dlen(p.x - t.x, p.y - (t.y - 3)) <= PH.SHIELD_R) return this.explodeProjectile(p, w);
        if (PH.pointInTank(t, p.x, p.y)) return this.explodeProjectile(p, w);
      }
    }
    this.trailPoint(p);
  }

  explodeProjectile(p, w) {
    this.removeProjectile(p);
    this.explode(p.x, p.y, w.radius, w.damage, p.owner, p.weapon);
  }

  spawnNapalm(x, y, w, owner, isDirt) {
    const parts = [];
    for (let i = 0; i < w.particles; i++) {
      parts.push({ x, y: y - 1, vx: this.rng.range(-2.2, 2.2), vy: -this.rng.range(0.5, 3), life: w.life + this.rng.int(40) });
    }
    this.effects.push({ type: 'napalm', parts, owner, dirt: isDirt, age: 0 });
    this.emit(isDirt ? 'dirt' : 'napalm', {});
  }

  explode(x, y, r, dmg, owner, weaponId) {
    const w = WEAPONS[weaponId] || {};
    const dur = r <= 0 ? 8 : Math.max(14, Math.round(r * 1.4 + 12));
    this.effects.push({ type: 'explosion', x, y, r, age: 0, dur, peak: Math.max(3, Math.round(dur * 0.4)), applied: false, dmg, owner, weapon: weaponId, style: 'normal' });
    if (w.flash) this.effects.push({ type: 'flash', age: 0, dur: 10 });
    this.emit('explosion', { r, flash: !!w.flash });
  }

  applyExplosion(e) {
    e.applied = true;
    if (e.r <= 0) return;
    const span = this.terrain.carveCircle(e.x, e.y, e.r);
    if (this.settings.dirtFalls) this.terrain.markDirty(span[0], span[1]);
    for (const t of this.tanks) {
      if (!t.alive) continue;
      const d = dlen(t.x - e.x, t.y - 3 - e.y);
      const reach = e.r + 6;
      if (d >= reach) continue;
      const amount = Math.round(e.dmg * (1 - d / reach));
      if (amount > 0) this.damage(t.idx, amount, e.owner, e.weapon);
    }
  }

  // ------------------------------------------------------------ effects
  updateEffects() {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.age++;
      switch (e.type) {
        case 'explosion':
          if (!e.applied && e.age >= e.peak) this.applyExplosion(e);
          if (e.age > e.dur) this.effects.splice(i, 1);
          break;
        case 'napalm':
          this.napalmStep(e);
          if (e.parts.length === 0) this.effects.splice(i, 1);
          break;
        case 'laser':
        case 'flash':
        case 'smoke':
        case 'taunt':
          if (e.age > e.dur) this.effects.splice(i, 1);
          break;
        default:
          if (e.dur && e.age > e.dur) this.effects.splice(i, 1);
      }
    }
  }

  napalmStep(e) {
    const T = this.terrain;
    for (let i = e.parts.length - 1; i >= 0; i--) {
      const q = e.parts[i];
      q.life--;
      if (q.life <= 0 || q.x < 0 || q.x >= W || q.y >= H - 1) {
        if (e.dirt && q.x >= 0 && q.x < W && q.y < H) {
          const rx = Math.round(q.x), ry = Math.round(clamp(q.y, HUD_H, H - 1));
          T.set(rx, ry, 1);
          T.set(rx, ry - 1, 1);
          T.version++;
        }
        e.parts.splice(i, 1);
        continue;
      }
      q.vy += 0.12;
      const nx = q.x + q.vx, ny = q.y + q.vy;
      if (!T.get(Math.round(nx), Math.round(ny))) {
        q.x = nx;
        q.y = ny;
      } else {
        // landed: flow along the surface, downhill
        const sy = T.groundBelow(Math.round(nx), Math.round(q.y) - 4) - 1;
        if (sy >= Math.round(q.y) - 3) {
          q.x = nx;
          q.y = sy;
        } else {
          q.vx = -q.vx * 0.4;
        }
        q.vy = 0;
        const l = T.groundBelow(Math.round(q.x) - 1, Math.round(q.y) - 3);
        const r = T.groundBelow(Math.round(q.x) + 1, Math.round(q.y) - 3);
        if (r > l) q.vx += 0.08; else if (l > r) q.vx -= 0.08;
        q.vx *= 0.96;
      }
      if (!e.dirt) {
        for (const t of this.tanks) {
          if (!t.alive) continue;
          if (Math.abs(t.x - q.x) <= PH.TANK_HALF_W + 2 && q.y >= t.y - PH.TANK_H - 3 && q.y <= t.y + 2) {
            t.napalmDmg += 0.45;
            if (t.napalmDmg >= 1) {
              const d = Math.floor(t.napalmDmg);
              t.napalmDmg -= d;
              this.damage(t.idx, d, e.owner, 'napalm', true);
            }
          }
        }
      }
    }
  }

  // ------------------------------------------------------------ damage
  damage(idx, amount, by, cause, quiet = false) {
    const t = this.tanks[idx];
    if (!t.alive || amount <= 0) return;
    let left = amount;
    if (t.shield) {
      const absorbed = Math.min(t.shield.pts, left);
      t.shield.pts -= absorbed;
      left -= absorbed;
      this.emit('shieldHit', { p: idx });
      if (t.shield.pts <= 0) {
        t.shield = null;
        this.emit('shieldDown', { p: idx });
      }
    }
    if (left <= 0) return;
    const wasAlive = t.hp > 0;
    t.hp = Math.max(0, t.hp - left);
    this.players[idx].totalDamageTaken += left;
    if (by != null && by >= 0) {
      t.lastHitBy = by;
      if (by !== idx) {
        this.players[by].cash += left * MONEY_PER_DAMAGE;
        this.players[by].damageDealt += left;
      }
    }
    this.turnDamaged.add(idx);
    if (!quiet) this.emit('hit', { p: idx, amount: left, by });
    if (this.settings.talkingTanks && wasAlive && t.hp > 0 && !quiet && this.rng.chance(0.55)) {
      this.say(idx, by === idx ? 'self' : 'hit');
    }
  }

  say(idx, kind) {
    const text = pickTaunt(this.rng, kind);
    for (let i = this.effects.length - 1; i >= 0; i--) {
      if (this.effects[i].type === 'taunt' && this.effects[i].tank === idx) this.effects.splice(i, 1);
    }
    this.effects.push({ type: 'taunt', tank: idx, text, age: 0, dur: 110 });
    this.emit('taunt', { p: idx, text });
  }

  processDeaths() {
    for (const t of this.tanks) {
      if (!t.alive || t.hp > 0) continue;
      t.alive = false;
      t.shield = null;
      t.falling = false;
      this.deathOrder.push(t.idx);
      const killer = t.lastHitBy;
      if (killer >= 0 && killer !== t.idx) {
        const kp = this.players[killer];
        kp.kills++;
        kp.roundKills++;
        kp.cash += KILL_BONUS;
        if (this.settings.talkingTanks && this.tanks[killer].alive && this.rng.chance(0.7)) this.say(killer, 'kill');
      }
      if (this.settings.talkingTanks) this.say(t.idx, 'death');
      this.emit('death', { p: t.idx, by: killer });
      const r = this.settings.tankExplosions ? 14 + this.rng.int(26) : 8;
      const dmg = this.settings.tankExplosions ? Math.round(r * 1.6) : 0;
      this.explode(t.x, t.y - 3, r, dmg, killer >= 0 ? killer : t.idx, 'tank');
    }
  }

  // ------------------------------------------------------------ tanks
  updateTanks() {
    const T = this.terrain;
    for (const t of this.tanks) {
      if (!t.alive) continue;
      const supported = t.y + 1 >= H || T.get(t.x, t.y + 1);
      if (!supported) {
        if (!t.falling) {
          t.falling = true;
          t.fallV = 0;
          t.fallAcc = 0;
          t.fallStart = t.y;
          const pl = this.players[t.idx];
          t.chute = false;
          if (this.itemCount(pl, 'parachute') > 0) {
            pl.items.parachute--;
            t.chute = true;
          }
          this.emit('fall', { p: t.idx, chute: t.chute });
          if (!t.chute && this.settings.talkingTanks && this.rng.chance(0.5)) this.say(t.idx, 'fall');
        }
        t.fallV = t.chute ? 1 : Math.min(t.fallV + 0.12, 4);
        t.fallAcc += t.fallV;
        let dy = Math.floor(t.fallAcc);
        t.fallAcc -= dy;
        while (dy-- > 0 && t.y + 1 < H && !T.get(t.x, t.y + 1)) t.y++;
      } else if (t.falling) {
        t.falling = false;
        const dist = t.y - t.fallStart;
        this.emit('land', { p: t.idx, dist, chute: t.chute });
        if (!t.chute && dist > 4) this.damage(t.idx, Math.round(dist * FALL_DAMAGE), -1, 'fall');
        t.chute = false;
      }
    }
  }

  // ------------------------------------------------------------ sync
  /** Cheap state fingerprint used to detect desyncs between peers. */
  checksum() {
    let h = this.terrain.checksum();
    const mix = (v) => {
      h ^= (v | 0) & 0xffffffff;
      h = Math.imul(h, 0x01000193) >>> 0;
    };
    mix(this.rng.s);
    mix(this.round);
    mix(this.turnNo);
    mix(this.wind);
    for (const t of this.tanks) {
      mix(t.x); mix(t.y); mix(t.hp); mix(t.alive ? 1 : 0); mix(t.shield ? t.shield.pts : -1);
    }
    for (const p of this.players) {
      mix(p.cash); mix(p.kills); mix(p.wins);
      for (const k in p.weapons) mix(p.weapons[k]);
      for (const k in p.items) mix(p.items[k]);
    }
    return h >>> 0;
  }

  /** Full state snapshot (only meaningful while idle: no shells in flight). */
  snapshot() {
    return {
      settings: this.settings,
      seed: this.seed,
      rng: this.rng.s,
      round: this.round,
      phase: this.phase,
      current: this.current,
      order: this.order,
      orderPos: this.orderPos,
      turnNo: this.turnNo,
      wind: this.wind,
      style: this.style,
      palette: this.palette,
      players: this.players,
      tanks: this.tanks,
      terrain: this.terrain.encode(),
      deathOrder: this.deathOrder,
      lastRoundOrder: this.lastRoundOrder,
      shopDone: this.shopDone,
      roundResult: this.roundResult,
      timer: this.timer,
      tick: this.tick,
      aimTick: this.aimTick,
    };
  }

  static fromSnapshot(s) {
    const g = new Game(s.settings, s.players, s.seed);
    g.rng.s = s.rng;
    g.round = s.round;
    g.phase = s.phase;
    g.current = s.current;
    g.order = s.order.slice();
    g.orderPos = s.orderPos;
    g.turnNo = s.turnNo;
    g.wind = s.wind;
    g.style = s.style;
    g.palette = s.palette;
    g.players = s.players.map((p) => ({ ...p, weapons: { ...p.weapons }, items: { ...p.items } }));
    g.tanks = s.tanks.map((t) => ({ ...t, shield: t.shield ? { ...t.shield } : null }));
    g.terrain.decode(s.terrain);
    g.deathOrder = s.deathOrder.slice();
    g.lastRoundOrder = s.lastRoundOrder.slice();
    g.shopDone = s.shopDone.slice();
    g.roundResult = s.roundResult;
    g.timer = s.timer;
    g.tick = s.tick;
    g.aimTick = s.aimTick;
    g.aiPlan = null;
    return g;
  }
}
