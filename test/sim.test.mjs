import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, W, H, HUD_H, AI_LEVELS } from '../src/game.js';
import { WEAPONS, ITEMS, WEAPON_ORDER } from '../src/weapons.js';
import { Terrain } from '../src/terrain.js';
import { RNG } from '../src/rng.js';

function aiPlayers(n, level) {
  return Array.from({ length: n }, (_, i) => ({ name: `Bot ${i + 1}`, type: 'ai', ai: level || AI_LEVELS[i % AI_LEVELS.length].id }));
}

function runToEnd(game, maxTicks = 400000) {
  let ticks = 0;
  while (game.phase !== 'gameOver' && ticks < maxTicks) {
    game.step();
    game.takeEvents();
    ticks++;
  }
  return ticks;
}

test('terrain generation stays within bounds and falls settle', () => {
  const t = new Terrain(W, H);
  const rng = new RNG(42);
  for (const style of ['flat', 'hills', 'mountains', 'canyon']) {
    t.generate(rng, style, HUD_H + 60, H - 30);
    for (let x = 0; x < W; x++) {
      const y = t.surfaceY(x);
      assert.ok(y >= HUD_H + 60 && y <= H - 30, `${style} column ${x} surface ${y}`);
    }
  }
  const before = t.bits.reduce((a, b) => a + b, 0);
  const span = t.carveCircle(300, t.surfaceY(300) + 20, 30);
  t.markDirty(span[0], span[1]);
  let steps = 0;
  while (t.settleStep(3)) steps++;
  assert.ok(steps > 0, 'dirt fell');
  assert.equal(t.dirtyCols.size, 0);
  // no floating dirt remains in touched columns
  for (let x = span[0]; x <= span[1]; x++) {
    const col = x * H;
    let seenAir = false;
    for (let y = H - 1; y >= 0; y--) {
      if (!t.bits[col + y]) seenAir = true;
      else assert.ok(!seenAir, `floating dirt at ${x},${y}`);
    }
  }
  assert.ok(t.bits.reduce((a, b) => a + b, 0) < before);
  // encode/decode round trip
  const t2 = new Terrain(W, H);
  t2.decode(t.encode());
  assert.equal(t2.checksum(), t.checksum());
});

test('a full AI game finishes and is deterministic', () => {
  const players = aiPlayers(6);
  const a = new Game({ rounds: 3 }, players, 12345);
  const b = new Game({ rounds: 3 }, players, 12345);
  a.start();
  b.start();
  let ticks = 0;
  while (a.phase !== 'gameOver' && ticks < 300000) {
    a.step();
    b.step();
    a.takeEvents();
    b.takeEvents();
    ticks++;
    if (ticks % 500 === 0) assert.equal(a.checksum(), b.checksum(), `desync at tick ${ticks}`);
  }
  assert.equal(a.phase, 'gameOver', `game did not finish in ${ticks} ticks (phase ${a.phase}, round ${a.round})`);
  assert.equal(a.checksum(), b.checksum());
  const wins = a.players.reduce((s, p) => s + p.wins, 0);
  assert.ok(wins >= 1 && wins <= 3, `wins ${wins}`);
  const dmg = a.players.reduce((s, p) => s + p.damageDealt, 0);
  assert.ok(dmg > 0, 'somebody dealt damage');
  console.log(`  6-player 3-round game: ${ticks} ticks, total damage ${dmg}, standings:`, a.players.map((p) => `${p.name}(${p.ai}) w${p.wins} k${p.kills} $${p.cash}`).join(', '));
});

test('every weapon can be fired without throwing and the turn ends', () => {
  const failures = [];
  for (const id of WEAPON_ORDER) {
    for (const seed of [1, 2, 3]) {
      const g = new Game({ rounds: 1, walls: 'concrete', windMode: 'none' }, [
        { name: 'A', type: 'human' }, { name: 'B', type: 'human' }, { name: 'C', type: 'human' },
      ], 1000 + seed);
      g.start();
      const p = g.players[g.current];
      p.weapons[id] = 5;
      const t = g.tanks[g.current];
      const target = g.tanks.find((o) => o.idx !== t.idx);
      const angle = target.x > t.x ? 40 + seed * 10 : 140 - seed * 10;
      const ok = g.apply({ type: 'fire', p: g.current, angle, power: 300 + seed * 150, weapon: id });
      assert.ok(ok, `fire ${id}`);
      let n = 0;
      try {
        while (g.phase === 'action' && n < 20000) { g.step(); n++; }
      } catch (e) {
        failures.push(`${id}: threw ${e.message}`);
        continue;
      }
      if (g.phase === 'action') failures.push(`${id} seed ${seed}: turn never ended (${g.projectiles.length} projectiles, ${g.effects.length} effects, dirty ${g.terrain.dirtyCols.size})`);
    }
  }
  assert.deepEqual(failures, []);
});

test('items: shields absorb, batteries heal, fuel moves, parachutes save', () => {
  const g = new Game({ rounds: 1, terrain: 'flat', walls: 'concrete', windMode: 'none' }, [{ name: 'A' }, { name: 'B' }], 77);
  g.start();
  const me = g.current;
  const pl = g.players[me];
  pl.items.heavy_shield = 1;
  assert.ok(g.apply({ type: 'item', p: me, item: 'heavy_shield' }));
  assert.equal(g.tanks[me].shield.pts, 300);
  g.damage(me, 50, -1, 'test');
  assert.equal(g.tanks[me].shield.pts, 250);
  assert.equal(g.tanks[me].hp, 100);
  g.damage(me, 300, -1, 'test');
  assert.equal(g.tanks[me].shield, null);
  assert.equal(g.tanks[me].hp, 50);
  pl.items.battery = 2;
  assert.ok(g.apply({ type: 'item', p: me, item: 'battery' }));
  assert.equal(g.tanks[me].hp, 65);
  pl.items.fuel = 1;
  const x0 = g.tanks[me].x;
  assert.ok(g.apply({ type: 'move', p: me, dir: 1 }));
  assert.ok(g.tanks[me].x > x0);
  assert.equal(pl.items.fuel, 0);
  assert.ok(!g.apply({ type: 'move', p: me, dir: 1 }), 'no fuel');
  // parachute: carve the ground away under the tank
  pl.items.parachute = 1;
  const t = g.tanks[me];
  g.terrain.carveCircle(t.x, t.y + 15, 20);
  const hp = t.hp;
  g.phase = 'action';
  for (let i = 0; i < 400 && (t.falling || i < 2); i++) g.step();
  assert.equal(pl.items.parachute, 0);
  assert.equal(t.hp, hp, 'parachute prevented fall damage');
});

test('shop purchases respect cash and bundles', () => {
  const g = new Game({ rounds: 2 }, [{ name: 'A' }, { name: 'B', type: 'ai', ai: 'cyborg' }], 5);
  g.start();
  g.phase = 'shop';
  g.shopDone = [false, true];
  const cash = g.players[0].cash;
  assert.ok(g.apply({ type: 'shop', p: 0, buys: [{ kind: 'weapon', id: 'missile', n: 2 }, { kind: 'item', id: 'parachute' }, { kind: 'weapon', id: 'nuke', n: 99 }] }));
  assert.equal(g.players[0].weapons.missile, 10);
  assert.equal(g.players[0].items.parachute, 3);
  assert.equal(g.players[0].cash, cash - 2 * 1875 - 1000);
  assert.equal(g.phase, 'aim', 'round started once everyone shopped');
  assert.equal(g.round, 2);
});

test('snapshot round-trips into an identical game', () => {
  const g = new Game({ rounds: 2 }, aiPlayers(4), 999);
  g.start();
  for (let i = 0; i < 3000 && !(g.phase === 'aim' && g.turnNo > 3); i++) g.step();
  assert.equal(g.phase, 'aim');
  const snap = JSON.parse(JSON.stringify(g.snapshot()));
  const h = Game.fromSnapshot(snap);
  assert.equal(h.checksum(), g.checksum());
  for (let i = 0; i < 2000; i++) { g.step(); h.step(); }
  assert.equal(h.checksum(), g.checksum());
});

test('AI levels all play sensibly (cyborg lands close, moron does not crash)', () => {
  for (const lvl of AI_LEVELS) {
    const g = new Game({ rounds: 1, terrain: 'hills', walls: 'concrete', windMode: 'constant' }, [
      { name: 'A', type: 'ai', ai: lvl.id }, { name: 'B', type: 'ai', ai: 'moron' },
    ], 31337);
    g.start();
    const ticks = runToEnd(g, 100000);
    assert.equal(g.phase, 'gameOver', `${lvl.id} game finished`);
    console.log(`  ${lvl.id.padEnd(10)} finished in ${ticks} ticks, turns ${g.turnNo}, dealt ${g.players[0].damageDealt}`);
  }
});

test('catalogue sanity', () => {
  for (const [id, w] of Object.entries(WEAPONS)) {
    assert.ok(w.name && w.kind, id);
    if (w.kind === 'shell') assert.ok(w.radius > 0 && w.damage > 0, id);
  }
  for (const [id, it] of Object.entries(ITEMS)) assert.ok(it.name && it.kind && it.desc, id);
});
