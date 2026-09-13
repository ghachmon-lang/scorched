// DOM helpers and the non-game screens (menu, setup, lobby, shop, results…).
import { AI_LEVELS, PLAYER_COLORS, DEFAULT_SETTINGS } from './game.js';
import { WEAPONS, ITEMS, WEAPON_ORDER, ITEM_ORDER, weaponDesc } from './weapons.js';

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
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

// ------------------------------------------------------------ screens

export function menuScreen(app) {
  const online = app.netAvailable();
  return h('section', { class: 'screen' }, page(
    h('div', { class: 'title' }, h('h1', {}, 'SCORCHED EARTH'), h('div', { class: 'sub' }, 'The Mother of All Games. Now in your pocket.')),
    h('button', { class: 'btn primary', onclick: () => app.gotoSetup(false) }, 'Pass & Play'),
    h('button', { class: 'btn accent', onclick: () => app.gotoHost(), disabled: !online }, 'Host online game'),
    h('button', { class: 'btn accent', onclick: () => app.gotoJoin(), disabled: !online }, 'Join online game'),
    !online && h('div', { class: 'muted', style: { textAlign: 'center' } }, 'Online play needs the PeerJS library (vendor/peerjs.min.js) and a network connection.'),
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

function defaultPlayers(app) {
  const saved = app.prefs.players;
  if (saved && saved.length >= 2) return saved.map((p) => ({ ...p }));
  return [
    { name: app.prefs.name || 'Player 1', type: 'human', color: PLAYER_COLORS[0] },
    { name: 'Player 2', type: 'human', color: PLAYER_COLORS[1] },
    { name: 'Poolshark', type: 'ai', ai: 'poolshark', color: PLAYER_COLORS[2] },
  ];
}

const AI_NAMES = ['Genghis', 'Napoleon', 'Attila', 'Cleo', 'Boudica', 'Hannibal', 'Patton', 'Sun Tzu', 'Rommel', 'Zhukov', 'Joan', 'Caesar'];

export function setupScreen(app) {
  const players = defaultPlayers(app);
  const list = h('div', { class: 'stack' });
  const render = () => {
    list.innerHTML = '';
    players.forEach((p, i) => {
      const sel = h('select', {
        onchange: (e) => {
          const v = e.target.value;
          if (v === 'human') { p.type = 'human'; delete p.ai; }
          else { p.type = 'ai'; p.ai = v; if (/^Player \d+$/.test(p.name)) p.name = AI_NAMES[i % AI_NAMES.length]; }
          render();
        },
      },
        h('option', { value: 'human', selected: p.type === 'human' }, 'Human'),
        ...AI_LEVELS.map((l) => h('option', { value: l.id, selected: p.type === 'ai' && p.ai === l.id }, `AI: ${l.name}`)),
      );
      list.appendChild(h('div', { class: 'player-row' },
        h('button', { class: 'swatch', style: { background: p.color }, 'aria-label': 'Change colour', onclick: () => { p.color = PLAYER_COLORS[(PLAYER_COLORS.indexOf(p.color) + 1) % PLAYER_COLORS.length]; render(); } }),
        h('input', { value: p.name, maxlength: 12, placeholder: `Player ${i + 1}`, oninput: (e) => (p.name = e.target.value) }),
        sel,
        h('button', { class: 'btn small ghost', 'aria-label': 'Remove', disabled: players.length <= 2, onclick: () => { players.splice(i, 1); render(); } }, '✕'),
      ));
    });
  };
  render();
  return h('section', { class: 'screen' }, page(
    h('div', { class: 'row' }, h('button', { class: 'btn small ghost', onclick: () => app.gotoMenu() }, '◀ Menu'), h('h2', { class: 'grow' }, 'Players')),
    h('div', { class: 'muted' }, 'Everyone plays on this device, passing it around. Add AI tanks to fill the field.'),
    list,
    h('button', { class: 'btn', disabled: players.length >= 10, onclick: () => {
      const used = new Set(players.map((p) => p.color));
      const color = PLAYER_COLORS.find((c) => !used.has(c)) || PLAYER_COLORS[players.length % PLAYER_COLORS.length];
      players.push({ name: AI_NAMES[players.length % AI_NAMES.length], type: 'ai', ai: AI_LEVELS[Math.min(players.length, 6) % 7].id, color });
      render();
    } }, '+ Add player'),
    h('div', { class: 'row' },
      h('button', { class: 'btn grow', onclick: () => app.gotoSettings(() => app.gotoSetup(false)) }, 'Game settings'),
    ),
    h('button', { class: 'btn primary', onclick: () => {
      const cleaned = players.map((p, i) => ({ ...p, name: (p.name || '').trim() || `Player ${i + 1}` }));
      app.prefs.players = cleaned;
      app.savePrefs();
      app.startLocalGame(cleaned);
    } }, 'Start game'),
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
  const peer = { ...prefs.peer };
  return h('section', { class: 'screen' }, page(
    h('div', { class: 'row' }, h('button', { class: 'btn small ghost', onclick: () => back ? back() : app.gotoMenu() }, '◀ Back'), h('h2', { class: 'grow' }, 'Settings')),
    h('div', { class: 'card stack' }, h('h3', {}, 'Game'),
      num('Rounds', 'rounds', 1, 99, 1),
      num('Starting cash', 'initialCash', 0, 1000000, 1000),
      opt('Interest per round', 'interest', [[0, '0%'], [0.05, '5%'], [0.1, '10%'], [0.2, '20%']], Number),
      opt('Turn order', 'turnOrder', [['roundRobin', 'Round robin'], ['random', 'Random'], ['loserFirst', 'Loser first'], ['winnerFirst', 'Winner first']]),
      num('Max turns per player / round', 'maxTurns', 0, 500, 10),
    ),
    h('div', { class: 'card stack' }, h('h3', {}, 'Physics'),
      opt('Gravity', 'gravity', [[0.5, 'Moon (50%)'], [0.75, 'Light (75%)'], [1, 'Earth (100%)'], [1.5, 'Heavy (150%)'], [2, 'Jupiter (200%)']], Number),
      opt('Wind', 'windMode', [['none', 'None'], ['constant', 'Constant per round'], ['changing', 'Changes every turn']]),
      opt('Wind strength', 'windStrength', [[0.5, 'Breeze'], [1, 'Normal'], [1.5, 'Gale'], [2.5, 'Hurricane']], Number),
      opt('Walls', 'walls', [['random', 'Random each shot'], ['concrete', 'Concrete'], ['rubber', 'Rubber (bounce)'], ['spring', 'Spring (bouncier)'], ['wrap', 'Wrap-around'], ['none', 'None (shots fly off)']]),
      opt('Terrain', 'terrain', [['random', 'Random'], ['flat', 'Flat'], ['hills', 'Hills'], ['mountains', 'Mountains'], ['canyon', 'Canyon']]),
      tog('Dirt falls', 'dirtFalls'),
      tog('Exploding tanks', 'tankExplosions'),
      tog('Talking tanks', 'talkingTanks'),
    ),
    h('div', { class: 'card stack' }, h('h3', {}, 'This device'),
      h('div', { class: 'field inline' }, h('span', { class: 'label' }, 'Your name'), h('input', { value: prefs.name, maxlength: 12, oninput: (e) => (prefs.name = e.target.value) })),
      tog('Sound', 'sound', prefs),
      tog('Shot trails', 'trails', prefs),
      tog('Name labels', 'labels', prefs),
      tog('Fast AI turns', 'fastAI', prefs),
      tog('Drag on field to aim', 'dragAim', prefs),
    ),
    h('details', { class: 'card' }, h('summary', { class: 'label' }, 'Advanced: online relay server'),
      h('div', { class: 'stack', style: { marginTop: '8px' } },
        h('div', { class: 'muted' }, 'Leave blank to use the free public PeerJS cloud. Fill in to use your own PeerServer (see README).'),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Host'), h('input', { value: peer.host, placeholder: 'peer.example.com', oninput: (e) => (peer.host = e.target.value.trim()) })),
        h('div', { class: 'row' },
          h('div', { class: 'field grow' }, h('span', { class: 'label' }, 'Port'), h('input', { value: peer.port, placeholder: '443', inputmode: 'numeric', oninput: (e) => (peer.port = e.target.value.trim()) })),
          h('div', { class: 'field grow' }, h('span', { class: 'label' }, 'Path'), h('input', { value: peer.path, placeholder: '/', oninput: (e) => (peer.path = e.target.value.trim()) })),
        ),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'Key'), h('input', { value: peer.key, placeholder: 'peerjs', oninput: (e) => (peer.key = e.target.value.trim()) })),
        tog('Secure (wss)', 'secure', peer),
      ),
    ),
    h('button', { class: 'btn primary', onclick: () => {
      prefs.settings = s;
      prefs.peer = peer;
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
      h('h3', {}, 'Controls'),
      h('p', {}, h('b', {}, 'Touch:'), ' drag anywhere on the battlefield to aim: the direction sets the angle, the distance sets the power. Fine-tune with the ◀ ▶ − + buttons (hold to repeat). Tap WEAPON to pick a shell, ITEMS to raise shields, use batteries or drive with fuel. Then hit FIRE.'),
      h('p', {}, h('b', {}, 'Keyboard:'), ' ', h('kbd', {}, '←'), ' ', h('kbd', {}, '→'), ' angle, ', h('kbd', {}, '↑'), ' ', h('kbd', {}, '↓'), ' power (hold ', h('kbd', {}, 'Shift'), ' for big steps), ', h('kbd', {}, 'PgUp'), '/', h('kbd', {}, 'PgDn'), ' power ±100, ', h('kbd', {}, 'Tab'), ' cycle weapons, ', h('kbd', {}, 'I'), ' items, ', h('kbd', {}, 'Space'), ' fire, ', h('kbd', {}, 'F'), ' fast-forward, ', h('kbd', {}, 'Esc'), ' menu.'),
      h('h3', {}, 'Reading the field'),
      h('p', {}, 'The bar at the top shows the current player, angle (0 = right, 90 = straight up, 180 = left), power, wind and the selected weapon. Wind pushes shells in the direction of the arrow. A ▼ marker at the top of the screen tracks shells that have flown off the top.'),
      h('h3', {}, 'Weapons'),
      h('p', {}, h('b', {}, 'Missiles and nukes'), ' explode on impact; bigger is better. ', h('b', {}, 'MIRV'), ' splits into five warheads at the top of its arc. ', h('b', {}, 'Leap Frog'), ' bounces on three times. ', h('b', {}, 'Funky Bomb'), ' scatters bomblets. ', h('b', {}, 'Napalm'), ' burns and flows downhill. ', h('b', {}, 'Rollers'), ' roll down slopes until they hit something. ', h('b', {}, 'Diggers'), ' and ', h('b', {}, 'Sandhogs'), ' tunnel through dirt. ', h('b', {}, 'Riot'), ' charges clear dirt without hurting anyone. ', h('b', {}, 'Dirt'), ' weapons bury tanks. ', h('b', {}, 'Tracers'), ' cost nothing and show you where a shot lands. ', h('b', {}, 'Laser'), ' fires a straight beam.'),
      h('h3', {}, 'Items'),
      h('p', {}, h('b', {}, 'Shields'), ' soak up damage until they run out. ', h('b', {}, 'Deflector'), ' bounces shells, ', h('b', {}, 'Mag Deflector'), ' pushes them away. ', h('b', {}, 'Parachutes'), ' open automatically when the ground is blown away under you. ', h('b', {}, 'Batteries'), ' repair damage. ', h('b', {}, 'Fuel'), ' lets you drive.'),
      h('h3', {}, 'Playing with friends'),
      h('p', {}, h('b', {}, 'Pass & Play:'), ' everyone shares one phone. ', h('b', {}, 'Online:'), ' one player hosts and shares a 4-letter room code (or a link); the others join from their own phones. The game runs in lockstep on every device, so it needs only a tiny trickle of data.'),
    ),
  ));
}

export function joinScreen(app, prefill) {
  let code = prefill || '';
  let name = app.prefs.name || '';
  const status = h('div', { class: 'muted' });
  const btn = h('button', { class: 'btn primary', onclick: async () => {
    if (!name.trim()) { status.textContent = 'Enter your name first.'; return; }
    if (code.length < 4) { status.textContent = 'Enter the 4-letter room code.'; return; }
    btn.disabled = true;
    status.textContent = 'Connecting…';
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
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Your name'), h('input', { value: name, maxlength: 12, oninput: (e) => (name = e.target.value) })),
    h('div', { class: 'field' }, h('span', { class: 'label' }, 'Room code'), h('input', { value: code, maxlength: 8, autocapitalize: 'characters', autocomplete: 'off', style: { textTransform: 'uppercase', letterSpacing: '0.3em', fontSize: '24px', textAlign: 'center' }, oninput: (e) => { code = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); e.target.value = code; } })),
    btn,
    status,
  ));
}

export function lobbyScreen(app) {
  const L = app.lobby;
  const isHost = app.net && app.net.isHost;
  const list = h('div', { class: 'stack' });
  const s = L.settings;
  const renderList = () => {
    list.innerHTML = '';
    L.players.forEach((p, i) => {
      list.appendChild(h('div', { class: 'player-row' },
        h('div', { class: 'swatch', style: { background: p.color, cursor: isHost || p.owner === app.myId ? 'pointer' : 'default' }, onclick: () => {
          if (!(isHost || p.owner === app.myId)) return;
          const next = PLAYER_COLORS[(PLAYER_COLORS.indexOf(p.color) + 1) % PLAYER_COLORS.length];
          app.lobbyUpdate({ idx: i, color: next });
        } }),
        h('div', {}, h('b', {}, p.name), ' ', h('span', { class: 'pill' }, p.type === 'ai' ? 'AI: ' + (AI_LEVELS.find((l) => l.id === p.ai) || {}).name : p.owner === app.myId ? 'you' : 'online')),
        p.type === 'ai' && isHost
          ? h('select', { onchange: (e) => app.lobbyUpdate({ idx: i, ai: e.target.value }) }, ...AI_LEVELS.map((l) => h('option', { value: l.id, selected: p.ai === l.id }, l.name)))
          : h('span'),
        isHost && i !== 0 ? h('button', { class: 'btn small ghost', onclick: () => app.lobbyRemove(i) }, '✕') : h('span'),
      ));
    });
  };
  renderList();
  L.renderList = renderList;
  const link = app.joinLink();
  return h('section', { class: 'screen' }, page(
    h('div', { class: 'row' }, h('button', { class: 'btn small ghost', onclick: () => app.leaveLobby() }, '◀ Leave'), h('h2', { class: 'grow' }, isHost ? 'Your room' : 'Lobby')),
    h('div', { class: 'card' },
      h('div', { class: 'label', style: { textAlign: 'center' } }, 'Room code'),
      h('div', { class: 'code' }, L.code),
      h('div', { class: 'muted', style: { textAlign: 'center' } }, 'Friends pick "Join online game" and type this code.'),
      h('div', { class: 'row', style: { marginTop: '10px', justifyContent: 'center' } },
        navigator.share ? h('button', { class: 'btn small', onclick: () => navigator.share({ title: 'Scorched Earth', text: `Join my Scorched Earth game! Room code ${L.code}`, url: link }).catch(() => {}) }, 'Share link') : null,
        h('button', { class: 'btn small', onclick: () => { navigator.clipboard && navigator.clipboard.writeText(link).then(() => toast('Link copied')); } }, 'Copy link'),
      ),
    ),
    h('div', { class: 'card' }, h('h3', {}, 'Players'), list,
      isHost ? h('button', { class: 'btn small', style: { marginTop: '8px' }, disabled: L.players.length >= 10, onclick: () => app.lobbyAddAI() }, '+ Add AI tank') : null),
    isHost
      ? h('div', { class: 'card stack' }, h('h3', {}, 'Game'),
          h('div', { class: 'field inline' }, h('span', { class: 'label' }, 'Rounds'), h('input', { type: 'number', min: 1, max: 99, value: s.rounds, inputmode: 'numeric', onchange: (e) => { s.rounds = Math.max(1, Math.min(99, Number(e.target.value) || 1)); app.lobbySettingsChanged(); } })),
          h('div', { class: 'muted' }, 'Physics and economy come from your Settings screen.'))
      : h('div', { class: 'muted' }, `${s.rounds} round${s.rounds === 1 ? '' : 's'}. Waiting for the host to start…`),
    isHost ? h('button', { class: 'btn primary', disabled: L.players.length < 2, onclick: () => app.startOnlineGame() }, 'Start game') : null,
  ));
}

export function shopScreen(app, idx, onDone) {
  const g = app.game;
  const p = g.players[idx];
  let cash = p.cash;
  const buys = []; // {kind,id,n}
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
    h('div', {}, h('b', { style: { color: p.color } }, p.name), ' ', h('span', { class: 'muted' }, p.type === 'ai' ? `(${(AI_LEVELS.find((l) => l.id === p.ai) || {}).name || 'AI'})` : '')),
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
    h('button', { class: 'btn ghost', onclick: () => app.confirmQuit() }, 'Quit game'),
  ));
}
