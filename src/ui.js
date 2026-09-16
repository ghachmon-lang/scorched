// DOM helpers and the non-game screens (menu, lobby, practice setup, shop…).
import { AI_LEVELS, PLAYER_COLORS, DEFAULT_SETTINGS } from './game.js';
import { WEAPONS, ITEMS, WEAPON_ORDER, ITEM_ORDER, weaponDesc } from './weapons.js';

export function h(tag, attrs = {}, ...children) {
  const el = tag === 'svg' ? document.createElementNS('http://www.w3.org/2000/svg', 'svg') : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return el;
}

const $ = (id) => document.getElementById(id);

export function showScreen(el) {
  const root = $('screens');
  root.innerHTML = '';
  root.hidden = false;
  root.appendChild(el);
  $('screen-game').hidden = true;
  closeModal();
}

export function showGameScreen() {
  $('screens').innerHTML = '';
  $('screens').hidden = true;
  $('screen-game').hidden = false;
}

export function modal(content, { onClose } = {}) {
  const m = $('modal');
  const box = $('modal-box');
  box.innerHTML = '';
  box.appendChild(content);
  m.hidden = false;
  m.onclick = (e) => {
    if (e.target === m) {
      closeModal();
      if (onClose) onClose();
    }
  };
  return box;
}

export function closeModal() {
  const m = $('modal');
  m.hidden = true;
  $('modal-box').innerHTML = '';
}

let toastTimer = 0;
export function toast(text, ms = 2200) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}

export function modalTitle(text, onClose) {
  return h('div', { class: 'modal-title' }, h('h2', {}, text), h('button', { class: 'btn small ghost', onclick: onClose || closeModal }, '✕'));
}

export function page(...children) {
  return h('div', { class: 'page' }, h('div', { class: 'page-inner stack' }, ...children));
}

export function money(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}

function aiName(id) {
  return (AI_LEVELS.find((l) => l.id === id) || {}).name || 'AI';
}

export function relativeTime(ts) {
  if (!ts) return '';
  const d = Date.now() - ts;
  const m = Math.round(d / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const hrs = Math.round(m / 60);
  if (hrs < 48) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} days ago`;
}

// ------------------------------------------------------------ screens

export function menuScreen(app) {
  const online = app.onlineAvailable();
  const games = app.savedGames();
  const list = h('div', { class: 'stack', id: 'my-games' });
  for (const g of games) {
    list.appendChild(h('button', { class: 'game-row', 'data-code': g.code, onclick: () => app.openRoom(g.code) },
      h('div', { class: 'code-sm' }, g.code),
      h('div', { class: 'grow' }, h('div', { class: 'game-title' }, g.label || `Room ${g.code}`), h('div', { class: 'muted game-status' }, g.phase === 'over' ? 'Finished' : g.phase === 'lobby' ? 'In the lobby' : 'Checking…')),
      h('span', { class: 'pill turn-pill', hidden: true }, 'Your turn'),
      h('span', { class: 'btn small ghost forget', role: 'button', 'aria-label': 'Forget this game', onclick: (e) => { e.stopPropagation(); app.forgetGame(g.code); } }, '✕'),
    ));
  }
  return h('section', { class: 'screen' }, page(
    titleScene(),
    h('button', { class: 'btn primary', disabled: !online, onclick: () => app.newGame() }, 'New game with friends'),
    h('button', { class: 'btn accent', disabled: !online, onclick: () => app.gotoJoin() }, 'Join with a room code'),
    !online && h('div', { class: 'muted', style: { textAlign: 'center' } }, app.onlineDisabledReason()),
    games.length ? h('div', { class: 'card' }, h('h3', {}, 'My games'), list) : null,
    h('button', { class: 'btn', onclick: () => app.gotoPractice() }, 'Practice against the computer'),
    h('div', { class: 'row' },
      h('button', { class: 'btn grow', onclick: () => app.gotoSettings() }, 'Settings'),
      h('button', { class: 'btn grow', onclick: () => app.gotoHelp() }, 'How to play'),
    ),
    h('div', { class: 'muted', style: { textAlign: 'center', marginTop: '12px' } },
      'A fan remake of the 1991 DOS classic by Wendell Hicken. ',
      app.installPrompt ? h('a', { href: '#', onclick: (e) => { e.preventDefault(); app.install(); } }, 'Install to home screen') : '',
    ),
  ));
}

/** The original's title card: banded sunset, red sun, black mountains. */
export function titleScene() {
  return h('div', { class: 'title-scene' },
    h('div', { class: 'title-sun' }),
    h('svg', { class: 'title-mountains', viewBox: '0 0 640 120', preserveAspectRatio: 'none', html: '<polygon fill="#101010" points="0,120 0,78 40,60 80,72 130,38 170,58 210,50 260,22 300,48 340,40 380,64 430,30 470,52 520,44 560,70 600,58 640,80 640,120"/><polygon fill="#2a2a2a" points="0,120 0,96 60,88 120,100 200,84 280,98 360,90 440,104 520,92 600,102 640,96 640,120"/>' }),
    h('div', { class: 'title-text' }, h('h1', {}, 'Scorched Earth'), h('div', { class: 'sub' }, 'The Mother of All Games')),
  );
}

export function namePrompt(app, onDone) {
  let name = app.prefs.name || '';
  let color = app.prefs.color || PLAYER_COLORS[0];
  const swatches = h('div', { class: 'row' });
  const render = () => {
    swatches.innerHTML = '';
    for (const c of PLAYER_COLORS) swatches.appendChild(h('button', { class: 'swatch' + (c === color ? ' on' : ''), style: { background: c }, 'aria-label': c, onclick: () => { color = c; render(); } }));
  };
  render();
  const input = h('input', { id: 'name-input', maxlength: 12, placeholder: 'Commander', value: name, oninput: (e) => (name = e.target.value) });
  const box = h('div', { class: 'stack' },
    modalTitle('Who are you?'),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Your name'), input),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Tank colour'), swatches),
    h('button', { class: 'btn primary', onclick: () => {
      const n = name.trim();
      if (!n) { input.focus(); return; }
      app.prefs.name = n;
      app.prefs.color = color;
      app.savePrefs();
      closeModal();
      onDone(n, color);
    } }, 'Continue'),
  );
  modal(box);
  setTimeout(() => input.focus(), 50);
}

const AI_NAMES = ['Genghis', 'Napoleon', 'Attila', 'Cleo', 'Boudica', 'Hannibal', 'Patton', 'Sun Tzu', 'Rommel'];

export function practiceScreen(app) {
  const saved = app.prefs.practice;
  const bots = saved && saved.length ? saved.map((b) => ({ ...b })) : [{ ai: 'shooter' }, { ai: 'poolshark' }];
  const list = h('div', { class: 'stack' });
  const render = () => {
    list.innerHTML = '';
    bots.forEach((b, i) => {
      list.appendChild(h('div', { class: 'player-row' },
        h('div', { class: 'swatch', style: { background: PLAYER_COLORS[(i + 1) % PLAYER_COLORS.length] } }),
        h('div', {}, h('b', {}, AI_NAMES[i % AI_NAMES.length]), h('div', { class: 'muted' }, (AI_LEVELS.find((l) => l.id === b.ai) || {}).desc || '')),
        h('select', { onchange: (e) => (b.ai = e.target.value) }, ...AI_LEVELS.map((l) => h('option', { value: l.id, selected: b.ai === l.id }, l.name))),
        h('button', { class: 'btn small ghost', 'aria-label': 'Remove', disabled: bots.length <= 1, onclick: () => { bots.splice(i, 1); render(); } }, '✕'),
      ));
    });
  };
  render();
  return h('section', { class: 'screen' }, page(
    h('div', { class: 'row' }, h('button', { class: 'btn small ghost', onclick: () => app.gotoMenu() }, '◀ Menu'), h('h2', { class: 'grow' }, 'Practice')),
    h('div', { class: 'muted' }, 'You against the computer, on this phone only. Nothing is saved.'),
    list,
    h('button', { class: 'btn', disabled: bots.length >= 9, onclick: () => { bots.push({ ai: AI_LEVELS[bots.length % AI_LEVELS.length].id }); render(); } }, '+ Add opponent'),
    h('button', { class: 'btn', onclick: () => app.gotoSettings(() => app.gotoPractice()) }, 'Game settings'),
    h('button', { class: 'btn primary', onclick: () => {
      app.prefs.practice = bots;
      app.savePrefs();
      const go = (name, color) => app.startPractice(name, color, bots);
      if (app.prefs.name) go(app.prefs.name, app.prefs.color || PLAYER_COLORS[0]);
      else namePrompt(app, go);
    } }, 'Start'),
  ));
}

export function settingsScreen(app, back) {
  const s = { ...DEFAULT_SETTINGS, ...app.prefs.settings };
  const opt = (label, key, options, transform = (v) => v) => h('div', { class: 'field inline' },
    h('span', { class: 'label' }, label),
    h('select', { onchange: (e) => (s[key] = transform(e.target.value)) },
      ...options.map(([v, l]) => h('option', { value: String(v), selected: String(s[key]) === String(v) }, l))),
  );
  const num = (label, key, min, max, step) => h('div', { class: 'field inline' },
    h('span', { class: 'label' }, label),
    h('input', { type: 'number', min, max, step, value: s[key], inputmode: 'numeric', onchange: (e) => (s[key] = Math.max(min, Math.min(max, Number(e.target.value) || min))) }),
  );
  const tog = (label, key, obj = s) => h('div', { class: 'field inline' },
    h('span', { class: 'label' }, label),
    h('select', { onchange: (e) => (obj[key] = e.target.value === 'on') },
      h('option', { value: 'on', selected: obj[key] }, 'On'), h('option', { value: 'off', selected: !obj[key] }, 'Off')),
  );
  const prefs = app.prefs;
  let server = prefs.server || '';
  return h('section', { class: 'screen' }, page(
    h('div', { class: 'row' }, h('button', { class: 'btn small ghost', onclick: () => back ? back() : app.gotoMenu() }, '◀ Back'), h('h2', { class: 'grow' }, 'Settings')),
    h('div', { class: 'card stack' }, h('h3', {}, 'New games'),
      h('div', { class: 'muted' }, 'Used when you create a room or start a practice game.'),
      num('Rounds', 'rounds', 1, 99, 1),
      num('Starting cash', 'initialCash', 0, 1000000, 1000),
      opt('Interest per round', 'interest', [[0, '0%'], [0.05, '5%'], [0.1, '10%'], [0.2, '20%']], Number),
      opt('Turn order', 'turnOrder', [['roundRobin', 'Round robin'], ['random', 'Random'], ['loserFirst', 'Loser first'], ['winnerFirst', 'Winner first']]),
      num('Max turns per player / round', 'maxTurns', 0, 500, 10),
      opt('Gravity', 'gravity', [[0.5, 'Moon (50%)'], [0.75, 'Light (75%)'], [1, 'Earth (100%)'], [1.5, 'Heavy (150%)'], [2, 'Jupiter (200%)']], Number),
      opt('Wind', 'windMode', [['none', 'None'], ['constant', 'Constant per round'], ['changing', 'Changes every turn']]),
      opt('Wind strength', 'windStrength', [[0.5, 'Breeze'], [1, 'Normal'], [1.5, 'Gale'], [2.5, 'Hurricane']], Number),
      opt('Walls', 'walls', [['random', 'Random each shot'], ['concrete', 'Concrete'], ['rubber', 'Rubber (bounce)'], ['spring', 'Spring (bouncier)'], ['wrap', 'Wrap-around'], ['none', 'None (shots fly off)']]),
      opt('Terrain', 'terrain', [['random', 'Random'], ['flat', 'Flat'], ['hills', 'Hills'], ['mountains', 'Mountains'], ['canyon', 'Canyon']]),
      tog('Dirt falls', 'dirtFalls'),
      tog('Exploding tanks', 'tankExplosions'),
      tog('Talking tanks', 'talkingTanks'),
    ),
    h('div', { class: 'card stack' }, h('h3', {}, 'This phone'),
      h('div', { class: 'field inline' }, h('span', { class: 'label' }, 'Your name'), h('input', { value: prefs.name, maxlength: 12, oninput: (e) => (prefs.name = e.target.value.trim()) })),
      tog('Turn notifications', 'notify', prefs),
      tog('Sound', 'sound', prefs),
      tog('Shot trails', 'trails', prefs),
      tog('Name labels', 'labels', prefs),
      tog('Fast AI turns', 'fastAI', prefs),
      tog('Drag on field to aim', 'dragAim', prefs),
    ),
    h('details', { class: 'card', open: !app.onlineAvailable() || undefined }, h('summary', { class: 'label' }, 'Advanced: game server'),
      h('div', { class: 'stack', style: { marginTop: '8px' } },
        h('div', { class: 'muted' }, 'The Cloudflare Worker from the server/ folder of the project. Leave blank to use the address built into this version of the game.'),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Server URL'), h('input', { value: server, placeholder: 'https://scorched-earth.yourname.workers.dev', inputmode: 'url', autocapitalize: 'off', oninput: (e) => (server = e.target.value.trim()) })),
      ),
    ),
    h('button', { class: 'btn primary', onclick: () => {
      prefs.settings = s;
      prefs.server = server.replace(/\/+$/, '');
      app.savePrefs();
      app.applyPrefs();
      if (back) back(); else app.gotoMenu();
    } }, 'Save'),
  ));
}

export function helpScreen(app, back) {
  return h('section', { class: 'screen' }, page(
    h('div', { class: 'row' }, h('button', { class: 'btn small ghost', onclick: () => back ? back() : app.gotoMenu() }, '◀ Back'), h('h2', { class: 'grow' }, 'How to play')),
    h('div', { class: 'card help' },
      h('h3', {}, 'The idea'),
      h('p', {}, 'Each tank takes turns lobbing shells at the others. Set an angle and a power, mind the wind, and fire. Last tank standing wins the round and everybody earns cash for damage and kills to spend in the shop between rounds.'),
      h('h3', {}, 'Playing with friends'),
      h('p', {}, 'Tap "New game with friends" and share the four-letter room code or the link. Everyone joins from their own phone. The game lives on the server, so you can close the app any time: when it is your turn you get a notification (if you allowed them), and the game picks up exactly where it was. Only one player needs the app open for the computer tanks to take their turns.'),
      h('h3', {}, 'Controls'),
      h('p', {}, h('b', {}, 'Touch:'), ' drag anywhere on the battlefield to aim: left and right change the angle, up and down the power. Fine-tune with the ◀ ▶ − + buttons (hold to repeat). Tap WEAPON to pick a shell, ITEMS to raise shields, use batteries or drive with fuel. Then hit FIRE.'),
      h('p', {}, h('b', {}, 'Keyboard:'), ' ', h('kbd', {}, '←'), ' ', h('kbd', {}, '→'), ' angle, ', h('kbd', {}, '↑'), ' ', h('kbd', {}, '↓'), ' power (hold ', h('kbd', {}, 'Shift'), ' for big steps), ', h('kbd', {}, 'PgUp'), '/', h('kbd', {}, 'PgDn'), ' power ±100, ', h('kbd', {}, 'Tab'), ' cycle weapons, ', h('kbd', {}, 'I'), ' items, ', h('kbd', {}, 'Space'), ' fire, ', h('kbd', {}, 'F'), ' fast-forward, ', h('kbd', {}, 'Esc'), ' menu.'),
      h('h3', {}, 'Reading the field'),
      h('p', {}, 'The bar at the top shows the current player, angle (0 = right, 90 = straight up, 180 = left), power, wind and the selected weapon. Wind pushes shells in the direction of the arrow. A ▼ marker at the top of the screen tracks shells that have flown off the top.'),
      h('h3', {}, 'Weapons'),
      h('p', {}, h('b', {}, 'Missiles and nukes'), ' explode on impact; bigger is better. ', h('b', {}, 'MIRV'), ' splits into five warheads at the top of its arc. ', h('b', {}, 'Leap Frog'), ' bounces on three times. ', h('b', {}, 'Funky Bomb'), ' scatters bomblets. ', h('b', {}, 'Napalm'), ' burns and flows downhill. ', h('b', {}, 'Rollers'), ' roll down slopes until they hit something. ', h('b', {}, 'Diggers'), ' and ', h('b', {}, 'Sandhogs'), ' tunnel through dirt. ', h('b', {}, 'Riot'), ' charges clear dirt without hurting anyone. ', h('b', {}, 'Dirt'), ' weapons bury tanks. ', h('b', {}, 'Tracers'), ' cost nothing and show you where a shot lands. ', h('b', {}, 'Laser'), ' fires a straight beam.'),
      h('h3', {}, 'Items'),
      h('p', {}, h('b', {}, 'Shields'), ' soak up damage until they run out. ', h('b', {}, 'Deflector'), ' bounces shells, ', h('b', {}, 'Mag Deflector'), ' pushes them away. ', h('b', {}, 'Parachutes'), ' open automatically when the ground is blown away under you. ', h('b', {}, 'Batteries'), ' repair damage. ', h('b', {}, 'Fuel'), ' lets you drive.'),
      h('h3', {}, 'Someone stopped playing?'),
      h('p', {}, 'The host can hand any tank to the computer from the in-game menu, and you can hand over your own tank if you want out. If you come back later you can take it back.'),
    ),
  ));
}

export function joinScreen(app, prefill) {
  let code = prefill || '';
  let name = app.prefs.name || '';
  const status = h('div', { class: 'muted' });
  const btn = h('button', { class: 'btn primary', onclick: async () => {
    if (!name.trim()) { status.textContent = 'Enter your name first.'; return; }
    if (code.length < 4) { status.textContent = 'Enter the room code.'; return; }
    btn.disabled = true;
    status.textContent = 'Joining…';
    try {
      app.prefs.name = name.trim();
      app.savePrefs();
      await app.joinGame(code, name.trim());
    } catch (e) {
      status.textContent = 'Could not join: ' + (e && e.message ? e.message : e);
      btn.disabled = false;
    }
  } }, 'Join');
  return h('section', { class: 'screen' }, page(
    h('div', { class: 'row' }, h('button', { class: 'btn small ghost', onclick: () => app.gotoMenu() }, '◀ Menu'), h('h2', { class: 'grow' }, 'Join a game')),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Your name'), h('input', { id: 'join-name', value: name, maxlength: 12, oninput: (e) => (name = e.target.value) })),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Room code'), h('input', { id: 'join-code', value: code, maxlength: 8, autocapitalize: 'characters', autocomplete: 'off', style: { textTransform: 'uppercase', letterSpacing: '0.3em', fontSize: '24px', textAlign: 'center' }, oninput: (e) => { code = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); e.target.value = code; } })),
    btn,
    status,
  ));
}

export function lobbyScreen(app) {
  const L = app.lobby;
  const isHost = L.hostId === app.myId;
  const list = h('div', { class: 'stack' });
  L.players.forEach((p, i) => {
    const mine = p.owner === app.myId;
    list.appendChild(h('div', { class: 'player-row' },
      h('button', { class: 'swatch', style: { background: p.color }, disabled: !(isHost || mine), 'aria-label': 'Change colour', onclick: () => {
        app.lobbyUpdate({ idx: i, color: PLAYER_COLORS[(PLAYER_COLORS.indexOf(p.color) + 1) % PLAYER_COLORS.length] });
      } }),
      h('div', {}, h('b', {}, p.name), ' ', h('span', { class: 'pill' }, p.type === 'ai' ? 'AI: ' + aiName(p.ai) : mine ? 'you' : p.id === L.hostId ? 'host' : 'joined')),
      p.type === 'ai' && isHost
        ? h('select', { onchange: (e) => app.lobbyUpdate({ idx: i, ai: e.target.value }) }, ...AI_LEVELS.map((l) => h('option', { value: l.id, selected: p.ai === l.id }, l.name)))
        : h('span'),
      isHost && p.id !== L.hostId ? h('button', { class: 'btn small ghost', onclick: () => app.lobbyRemove(i) }, '✕') : h('span'),
    ));
  });
  const link = app.joinLink();
  return h('section', { class: 'screen' }, page(
    h('div', { class: 'row' }, h('button', { class: 'btn small ghost', onclick: () => app.leaveLobby() }, '◀ Leave'), h('h2', { class: 'grow' }, isHost ? 'Your room' : 'Lobby')),
    h('div', { class: 'card' },
      h('div', { class: 'label', style: { textAlign: 'center' } }, 'Room code'),
      h('div', { class: 'code' }, L.code),
      h('div', { class: 'muted', style: { textAlign: 'center' } }, 'Friends tap "Join with a room code" and type this, or open the link.'),
      h('div', { class: 'row', style: { marginTop: '10px', justifyContent: 'center' } },
        navigator.share ? h('button', { class: 'btn small', onclick: () => navigator.share({ title: 'Scorched Earth', text: `Join my Scorched Earth game! Room code ${L.code}`, url: link }).catch(() => {}) }, 'Share link') : null,
        h('button', { class: 'btn small', onclick: () => { navigator.clipboard && navigator.clipboard.writeText(link).then(() => toast('Link copied')); } }, 'Copy link'),
      ),
    ),
    h('div', { class: 'card' }, h('h3', {}, 'Tanks'), list,
      isHost ? h('button', { class: 'btn small', style: { marginTop: '8px' }, disabled: L.players.length >= 10, onclick: () => app.lobbyAddAI() }, '+ Add computer tank') : null),
    isHost
      ? h('div', { class: 'card stack' }, h('h3', {}, 'Game'),
          h('div', { class: 'field inline' }, h('span', { class: 'label' }, 'Rounds'), h('input', { type: 'number', min: 1, max: 99, value: L.settings.rounds || 5, inputmode: 'numeric', onchange: (e) => app.lobbySettings({ rounds: Math.max(1, Math.min(99, Number(e.target.value) || 1)) }) })),
          h('div', { class: 'muted' }, 'Physics and economy come from your Settings screen.'))
      : h('div', { class: 'muted' }, `${L.settings.rounds || 5} round${(L.settings.rounds || 5) === 1 ? '' : 's'}. Waiting for the host to start…`),
    notifyButton(app),
    isHost ? h('button', { class: 'btn primary', disabled: L.players.length < 2, onclick: () => app.startOnlineGame() }, 'Start game') : null,
  ));
}

export function notifyButton(app) {
  if (!app.canNotify()) return null;
  if (app.notificationsOn()) return h('div', { class: 'muted', style: { textAlign: 'center' } }, '🔔 You will be notified when it is your turn.');
  return h('button', { class: 'btn accent', onclick: () => app.enableNotifications() }, '🔔 Notify me when it is my turn');
}

export function loadingScreen(app, text) {
  const bar = h('div', { class: 'bar' });
  const el = h('section', { class: 'screen' }, page(
    h('div', { class: 'title' }, h('h1', {}, 'LOADING')),
    h('div', { class: 'card' }, h('p', { class: 'loading-text' }, text), h('div', { class: 'progress' }, bar)),
  ));
  el.setProgress = (f) => { bar.style.width = `${Math.round(Math.max(0, Math.min(1, f)) * 100)}%`; };
  el.setText = (t) => { el.querySelector('.loading-text').textContent = t; };
  return el;
}

export function shopScreen(app, idx, onDone) {
  const g = app.game;
  const p = g.players[idx];
  let cash = p.cash;
  const buys = [];
  const tentative = { weapons: { ...p.weapons }, items: { ...p.items } };
  let tab = 'weapons';
  const cashEl = h('span', { class: 'ctl-cash' }, money(cash));
  const body = h('div');
  const nextRoundNote = g.round < g.rounds ? `Round ${g.round + 1} of ${g.rounds} is next.` : '';
  const renderRows = () => {
    body.innerHTML = '';
    if (tab === 'weapons') {
      for (const id of WEAPON_ORDER) {
        const w = WEAPONS[id];
        if (w.qty === 0) continue;
        const have = tentative.weapons[id] || 0;
        body.appendChild(h('div', { class: 'shop-row' },
          h('div', {}, h('div', { class: 'name' }, w.name), h('div', { class: 'desc' }, `${weaponDesc(w)} ${w.qty} for ${money(w.price)}`)),
          h('div', { class: 'have' }, have ? `×${have}` : ''),
          h('button', { class: 'btn small buy', disabled: w.price > cash, onclick: () => {
            cash -= w.price;
            tentative.weapons[id] = have + w.qty;
            buys.push({ kind: 'weapon', id, n: 1 });
            cashEl.textContent = money(cash);
            app.sound.cash();
            renderRows();
          } }, 'Buy'),
        ));
      }
    } else {
      for (const id of ITEM_ORDER) {
        const it = ITEMS[id];
        const have = tentative.items[id] || 0;
        const owned = it.permanent && have > 0;
        body.appendChild(h('div', { class: 'shop-row' },
          h('div', {}, h('div', { class: 'name' }, it.name), h('div', { class: 'desc' }, `${it.desc} ${it.permanent ? money(it.price) : `${it.qty} for ${money(it.price)}`}`)),
          h('div', { class: 'have' }, owned ? 'owned' : have ? `×${have}` : ''),
          h('button', { class: 'btn small buy', disabled: it.price > cash || owned, onclick: () => {
            cash -= it.price;
            tentative.items[id] = it.permanent ? 1 : have + it.qty;
            buys.push({ kind: 'item', id, n: 1 });
            cashEl.textContent = money(cash);
            app.sound.cash();
            renderRows();
          } }, 'Buy'),
        ));
      }
    }
  };
  const tabs = h('div', { class: 'tabs' },
    h('button', { class: 'on', onclick: (e) => { tab = 'weapons'; [...tabs.children].forEach((b) => b.classList.remove('on')); e.target.classList.add('on'); renderRows(); } }, 'Weapons'),
    h('button', { onclick: (e) => { tab = 'items'; [...tabs.children].forEach((b) => b.classList.remove('on')); e.target.classList.add('on'); renderRows(); } }, 'Accessories'),
  );
  renderRows();
  return h('section', { class: 'screen' }, page(
    h('div', { class: 'row' },
      h('div', { class: 'swatch', style: { background: p.color, width: '28px', height: '28px' } }),
      h('h2', { class: 'grow', style: { color: p.color } }, `${p.name}'s shop`),
      cashEl,
    ),
    h('div', { class: 'muted' }, `Round ${g.round} is over. ${nextRoundNote} Kills: ${p.kills}, wins: ${p.wins}.`),
    tabs,
    body,
    h('div', { class: 'sticky-bottom' }, h('button', { class: 'btn primary', onclick: () => onDone(buys) }, 'Done shopping')),
  ));
}

export function standingsList(g) {
  const sorted = g.players.slice().sort((a, b) => b.wins - a.wins || b.kills - a.kills || b.cash - a.cash);
  return h('div', {}, ...sorted.map((p, i) => h('div', { class: 'standing' },
    h('b', {}, `${i + 1}.`),
    h('div', { class: 'dot', style: { background: p.color } }),
    h('div', {}, h('b', { style: { color: p.color } }, p.name), ' ', h('span', { class: 'muted' }, p.type === 'ai' ? `(${aiName(p.ai)})` : '')),
    h('div', { class: 'stats' }, `${p.wins} win${p.wins === 1 ? '' : 's'} · ${p.kills} kill${p.kills === 1 ? '' : 's'} · ${money(p.cash)}`),
  )));
}

export function resultsScreen(app, { final }) {
  const g = app.game;
  const sorted = g.players.slice().sort((a, b) => b.wins - a.wins || b.kills - a.kills || b.cash - a.cash);
  const champ = sorted[0];
  return h('section', { class: 'screen' }, page(
    h('div', { class: 'title' }, h('h1', {}, final ? 'GAME OVER' : `ROUND ${g.round}`),
      final ? h('div', { class: 'sub', style: { color: champ.color, fontSize: '18px' } }, `${champ.name} wins the war!`) : null),
    h('div', { class: 'card' }, h('h3', {}, 'Standings'), standingsList(g)),
    final
      ? h('div', { class: 'stack' },
          app.canPlayAgain() ? h('button', { class: 'btn primary', onclick: () => app.playAgain() }, 'Play again') : null,
          h('button', { class: 'btn', onclick: () => app.quitToMenu() }, 'Main menu'))
      : h('button', { class: 'btn primary', onclick: () => app.continueAfterResults() }, 'Continue'),
  ));
}

export function waitingScreen(app, text, detail) {
  return h('section', { class: 'screen' }, page(
    h('div', { class: 'title' }, h('h1', {}, 'PLEASE HOLD')),
    h('div', { class: 'card' }, h('p', {}, text), detail || null),
    notifyButton(app),
    h('button', { class: 'btn ghost', onclick: () => app.gotoMenu() }, 'Back to menu'),
  ));
}
