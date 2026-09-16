// Weapon and accessory catalogue, modelled on the Scorched Earth 1.5 arsenal.
// price is per bundle; qty is how many one bundle buys (0 = unlimited).
// Behaviour kinds are interpreted by game.js.

export const WEAPONS = {
  baby_missile: { name: 'Baby Missile', price: 0, qty: 0, kind: 'shell', radius: 10, damage: 100, color: '#ffffff' },
  missile: { name: 'Missile', price: 1875, qty: 5, kind: 'shell', radius: 20, damage: 140, color: '#ffffff' },
  baby_nuke: { name: 'Baby Nuke', price: 10000, qty: 3, kind: 'shell', radius: 38, damage: 220, flash: true, color: '#ffff55' },
  nuke: { name: 'Nuke', price: 12000, qty: 1, kind: 'shell', radius: 55, damage: 300, flash: true, color: '#ffff55' },
  leapfrog: { name: 'Leap Frog', price: 10000, qty: 2, kind: 'leapfrog', radius: 18, damage: 110, hops: 3, color: '#55ff55' },
  funky_bomb: { name: 'Funky Bomb', price: 7000, qty: 2, kind: 'funky', radius: 18, damage: 100, subs: 7, subRadius: 11, subDamage: 22, color: '#ff55ff' },
  mirv: { name: 'MIRV', price: 10000, qty: 3, kind: 'mirv', warheads: 5, radius: 18, damage: 120, color: '#55ffff' },
  deaths_head: { name: "Death's Head", price: 20000, qty: 1, kind: 'mirv', warheads: 5, radius: 34, damage: 200, flash: true, color: '#ff5555' },
  napalm: { name: 'Napalm', price: 10000, qty: 10, kind: 'napalm', particles: 40, life: 140, color: '#ffaa00' },
  hot_napalm: { name: 'Hot Napalm', price: 20000, qty: 2, kind: 'napalm', particles: 90, life: 220, color: '#ff5500' },
  tracer: { name: 'Tracer', price: 10, qty: 20, kind: 'tracer', radius: 0, damage: 0, color: '#aaaaaa' },
  smoke_tracer: { name: 'Smoke Tracer', price: 500, qty: 10, kind: 'tracer', smoke: true, radius: 0, damage: 0, color: '#aaaaaa' },
  baby_roller: { name: 'Baby Roller', price: 5000, qty: 10, kind: 'roller', radius: 16, damage: 100, color: '#55ff55' },
  roller: { name: 'Roller', price: 6000, qty: 5, kind: 'roller', radius: 24, damage: 140, color: '#55ff55' },
  heavy_roller: { name: 'Heavy Roller', price: 6750, qty: 2, kind: 'roller', radius: 34, damage: 180, color: '#55ff55' },
  riot_charge: { name: 'Riot Charge', price: 2000, qty: 10, kind: 'riot_cone', length: 45, color: '#ffff55' },
  riot_blast: { name: 'Riot Blast', price: 5000, qty: 5, kind: 'riot_cone', length: 80, color: '#ffff55' },
  riot_bomb: { name: 'Riot Bomb', price: 5000, qty: 5, kind: 'riot', radius: 26, color: '#ffff55' },
  heavy_riot_bomb: { name: 'Heavy Riot Bomb', price: 4750, qty: 2, kind: 'riot', radius: 42, color: '#ffff55' },
  baby_digger: { name: 'Baby Digger', price: 3000, qty: 10, kind: 'digger', length: 45, bore: 3, radius: 8, damage: 40, color: '#aa5500' },
  digger: { name: 'Digger', price: 2500, qty: 5, kind: 'digger', length: 80, bore: 4, radius: 10, damage: 50, color: '#aa5500' },
  heavy_digger: { name: 'Heavy Digger', price: 6750, qty: 2, kind: 'digger', length: 130, bore: 5, radius: 12, damage: 60, color: '#aa5500' },
  baby_sandhog: { name: 'Baby Sandhog', price: 10000, qty: 10, kind: 'sandhog', length: 140, bore: 4, radius: 14, damage: 80, color: '#aa5500' },
  sandhog: { name: 'Sandhog', price: 16750, qty: 5, kind: 'sandhog', length: 220, bore: 5, radius: 20, damage: 110, color: '#aa5500' },
  heavy_sandhog: { name: 'Heavy Sandhog', price: 25000, qty: 2, kind: 'sandhog', length: 320, bore: 6, radius: 28, damage: 150, color: '#aa5500' },
  dirt_clod: { name: 'Dirt Clod', price: 5000, qty: 10, kind: 'dirt', radius: 13, color: '#aa5500' },
  dirt_ball: { name: 'Dirt Ball', price: 5000, qty: 5, kind: 'dirt', radius: 24, color: '#aa5500' },
  ton_of_dirt: { name: 'Ton of Dirt', price: 6750, qty: 1, kind: 'dirt', radius: 40, color: '#aa5500' },
  liquid_dirt: { name: 'Liquid Dirt', price: 5000, qty: 10, kind: 'liquid_dirt', particles: 60, life: 90, color: '#aa5500' },
  laser: { name: 'Laser', price: 8000, qty: 3, kind: 'laser', damage: 60, color: '#ff5555' },
};

export const WEAPON_ORDER = Object.keys(WEAPONS);

// Internal entries (never listed in the shop, never owned directly).
WEAPONS.funky_sub = { name: 'Funky Bomb', price: 0, qty: 0, kind: 'funky_sub', radius: 11, damage: 60, color: '#ff55ff', hidden: true };
WEAPONS.tank = { name: 'Tank Explosion', price: 0, qty: 0, kind: 'shell', radius: 20, damage: 100, color: '#ffffff', hidden: true };

export const ITEMS = {
  shield: { short: 'Shield', name: 'Shield', price: 2000, qty: 3, kind: 'shield', points: 100, color: '#55ffff', desc: 'Absorbs 100 points of damage.' },
  deflector: { short: 'Deflector', name: 'Deflector Shield', price: 5000, qty: 3, kind: 'shield', points: 150, deflect: true, color: '#5555ff', desc: 'Absorbs 150 points and bounces shells away.' },
  force_shield: { short: 'Force', name: 'Force Shield', price: 8000, qty: 3, kind: 'shield', points: 200, color: '#ffffff', desc: 'Absorbs 200 points of damage.' },
  heavy_shield: { short: 'Heavy', name: 'Heavy Shield', price: 10000, qty: 2, kind: 'shield', points: 300, color: '#ffff55', desc: 'Absorbs 300 points of damage.' },
  mag_deflector: { short: 'Mag', name: 'Mag Deflector', price: 10000, qty: 1, kind: 'shield', points: 100, magnetic: true, color: '#ff55ff', desc: 'Absorbs 100 points and repels incoming shells.' },
  parachute: { short: 'Chutes', name: 'Parachutes', price: 1000, qty: 3, kind: 'parachute', color: '#ffffff', desc: 'Opens automatically when you fall. No fall damage.' },
  battery: { short: 'Batteries', name: 'Batteries', price: 2500, qty: 5, kind: 'battery', heal: 15, color: '#ffff55', desc: 'Repairs 15 points of damage.' },
  fuel: { short: 'Fuel', name: 'Fuel Tanks', price: 2000, qty: 10, kind: 'fuel', color: '#ff5555', desc: 'Drive your tank 10 pixels per unit.' },
  auto_defense: { short: 'AutoDef', name: 'Auto Defense', price: 5000, qty: 1, kind: 'auto_defense', permanent: true, color: '#55ff55', desc: 'Raises your best shield at the start of every round.' },
};

export const ITEM_ORDER = Object.keys(ITEMS);

export const TANK_HP = 100;
export const MONEY_PER_DAMAGE = 50;
export const KILL_BONUS = 5000;
export const WIN_BONUS = 10000;
export const SURVIVE_BONUS = 2000;

/** One-line description of what a weapon does (for pickers and the shop). */
export function weaponDesc(w) {
  switch (w.kind) {
    case 'shell': return `Explodes on impact. Radius ${w.radius}, damage ${w.damage}.`;
    case 'mirv': return `Splits into ${w.warheads} warheads at the top of its arc.`;
    case 'leapfrog': return `Explodes and bounces on, ${w.hops} times.`;
    case 'funky': return `Explodes, then scatters ${w.subs} bomblets.`;
    case 'napalm': return 'Burning liquid that flows downhill.';
    case 'tracer': return w.smoke ? 'Harmless. Leaves a smoke trail.' : 'Harmless. Shows where a shot lands.';
    case 'roller': return `Rolls downhill until it hits something. Radius ${w.radius}.`;
    case 'riot_cone': return 'Blasts dirt away in a cone. No damage.';
    case 'riot': return `Clears a circle of dirt (radius ${w.radius}). No damage.`;
    case 'digger': return `Tunnels ${w.length} pixels through dirt.`;
    case 'sandhog': return `Burrows ${w.length} pixels in random directions, then explodes.`;
    case 'dirt': return `Dumps a ball of dirt (radius ${w.radius}).`;
    case 'liquid_dirt': return 'Flowing dirt that sets where it lands.';
    case 'laser': return 'Instant straight beam. Burns through some dirt.';
    default: return '';
  }
}

