// App controller: screens, game loop, pass-and-play flow, shop flow and the
// online lockstep (host relays sequenced commands; every peer simulates).
import { Game, DEFAULT_SETTINGS, AI_LEVELS, PLAYER_COLORS, W, H } from './game.js';
import { Renderer } from './render.js';
import { Sound } from './sound.js';
import { Net, makeRoomCode, normalizeCode } from './net.js';
import { loadPrefs, savePrefs } from './storage.js';
import { WEAPONS, ITEMS, WEAPON_ORDER, ITEM_ORDER, weaponDesc } from './weapons.js';
import { randomSeed } from './rng.js';
import { installInput } from './input.js';
import { clamp } from './mathd.js';
import * as UI from './ui.js';
import { h } from './ui.js';

const TICK_MS = 1000 / 60;
const $ = (id) => document.getElementById(id);

class App {
  constructor() {
    this.prefs = loadPrefs();
    this.sound = new Sound();
    this.canvas = $('game');
    this.renderer = new Renderer(this.canvas);
    this.overlay = $('stage-overlay');
    this.game = null;
    this.mode = 'local';
    this.net = null;
    this.myId = null;
    this.lobby = null;
    this.speed = 1;
    this.aimUntil = 0;
    this.pending = []; // client: sequenced commands waiting to be applied
    this.inbox = []; // host: commands waiting to be sequenced
    this.seq = 0;
    this.nextSeq = 1;
    this.resyncing = false;
    this.pendingJoins = [];
    this.dropped = new Map(); // name -> player idx (for rejoin)
    this.lastPhase = '';
    this.lastCurrent = -1;
    this.lastHumanTurn = -1;
    this.passPending = false;
    this.shopQueue = [];
    this.chatLog = [];
    this.installPrompt = null;
    this.acc = 0;
    this.last = performance.now();
    this.lastAimSent = 0;
    this.awaitingTurn = -1;
    this.applyPrefs();
    installInput(this);
    window.addEventListener('resize', () => this.layout());
    window.addEventListener('orientationchange', () => setTimeout(() => this.layout(), 200));
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); this.installPrompt = e; });
    document.addEventListener('visibilitychange', () => { this.last = performance.now(); });
    window.addEventListener('beforeunload', (e) => {
      if (this.game && this.game.phase !== 'gameOver') { e.preventDefault(); e.returnValue = ''; }
    });
    requestAnimationFrame((t) => this.loop(t));
    this.route();
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  }

  // ------------------------------------------------------------ prefs
  applyPrefs() {
    this.sound.enabled = this.prefs.sound;
    this.renderer.options.trails = this.prefs.trails;
    this.renderer.options.labels = this.prefs.labels;
  }
  savePrefs() {
    savePrefs(this.prefs);
  }
  settings() {
    return { ...DEFAULT_SETTINGS, ...this.prefs.settings };
  }
  netAvailable() {
    return Net.available();
  }
  install() {
    if (this.installPrompt) this.installPrompt.prompt();
  }

  // ------------------------------------------------------------ navigation
  route() {
    const q = new URLSearchParams(location.search);
    const code = normalizeCode(q.get('join'));
    if (code) {
      history.replaceState(null, '', location.pathname);
      this.gotoJoin(code);
    } else this.gotoMenu();
  }
  gotoMenu() {
    this.teardownNet();
    this.game = null;
    UI.showScreen(UI.menuScreen(this));
  }
  gotoSetup() {
    UI.showScreen(UI.setupScreen(this));
  }
  gotoSettings(back) {
    UI.showScreen(UI.settingsScreen(this, back));
  }
  gotoHelp(back) {
    UI.showScreen(UI.helpScreen(this, back));
  }
  gotoJoin(code) {
    if (!this.prefs.name) this.prefs.name = '';
    UI.showScreen(UI.joinScreen(this, code));
  }
  async gotoHost() {
    if (!this.prefs.name) {
      // need a name first
      let name = '';
      const box = h('div', { class: 'stack' },
        UI.modalTitle('Your name'),
        h('input', { maxlength: 12, placeholder: 'Commander', oninput: (e) => (name = e.target.value) }),
        h('button', { class: 'btn primary', onclick: () => { if (name.trim()) { this.prefs.name = name.trim(); this.savePrefs(); UI.closeModal(); this.gotoHost(); } } }, 'Continue'),
      );
      UI.modal(box);
      return;
    }
    UI.showScreen(UI.waitingScreen(this, 'Creating your room…'));
    try {
      await this.hostGame();
    } catch (e) {
      UI.toast('Could not create room: ' + (e && (e.message || e.type) ? e.message || e.type : e), 5000);
      this.gotoMenu();
    }
  }
  joinLink() {
    const u = new URL(location.href);
    u.search = '?join=' + (this.lobby ? this.lobby.code : '');
    u.hash = '';
    return u.toString();
  }
  confirmQuit() {
    const box = h('div', { class: 'stack' },
      UI.modalTitle('Quit game?'),
      h('p', {}, this.mode === 'online' ? 'You will leave the online game. Your tank is handed to the computer.' : 'The current game will be lost.'),
      h('button', { class: 'btn primary', onclick: () => { UI.closeModal(); this.quitToMenu(); } }, 'Quit'),
      h('button', { class: 'btn', onclick: () => UI.closeModal() }, 'Keep playing'),
    );
    UI.modal(box);
  }
  quitToMenu() {
    this.clearOverlay();
    this.gotoMenu();
  }
  canPlayAgain() {
    return this.mode === 'local' || (this.net && this.net.isHost);
  }
  playAgain() {
    if (this.mode === 'local') {
      const players = this.game.players.map((p) => ({ name: p.name, type: p.type, ai: p.ai, color: p.color }));
      this.startLocalGame(players);
    } else if (this.net && this.net.isHost) {
      this.lobby.players = this.game.players.map((p) => ({ name: p.name, type: p.type, ai: p.ai, color: p.color, owner: p.owner }));
      this.game = null;
      this.startOnlineGame();
    }
  }

  // ------------------------------------------------------------ local game
  startLocalGame(players) {
    this.teardownNet();
    this.mode = 'local';
    this.beginGame(new Game(this.settings(), players.map((p) => ({ ...p, owner: null })), randomSeed()));
  }

  beginGame(game, { fromSnapshot = false } = {}) {
    this.game = game;
    if (!fromSnapshot) game.start();
    this.speed = 1;
    this.lastPhase = '';
    this.lastCurrent = -1;
    this.lastHumanTurn = -1;
    this.passPending = false;
    this.shopQueue = [];
    this.renderer.bgKey = '';
    this.enterGame();
    this.handleEvents(game.takeEvents());
    this.checkTransitions(true);
  }

  enterGame() {
    UI.showGameScreen();
    this.clearOverlay();
    $('controls').querySelector('[data-act="chat"]').hidden = this.mode !== 'online';
    this.layout();
    this.refreshControls();
    if (window.innerHeight > window.innerWidth && window.innerWidth < 700 && !this.prefs.rotateHint) {
      this.prefs.rotateHint = true;
      this.savePrefs();
      UI.toast('Tip: turn your phone sideways for a bigger battlefield.', 4000);
    }
  }

  layout() {
    const stage = $('stage');
    if (!stage || $('screen-game').hidden) return;
    const r = stage.getBoundingClientRect();
    const scale = Math.max(0.1, Math.min(r.width / W, r.height / H));
    this.canvas.style.width = `${Math.floor(W * scale)}px`;
    this.canvas.style.height = `${Math.floor(H * scale)}px`;
  }

  // ------------------------------------------------------------ helpers
  isLocalHuman(idx) {
    const p = this.game && this.game.players[idx];
    if (!p || p.type !== 'human') return false;
    return this.mode === 'local' ? true : p.owner === this.myId;
  }
  localHumans() {
    return this.game ? this.game.players.filter((p) => this.isLocalHuman(p.idx)).map((p) => p.idx) : [];
  }
  canAct() {
    const g = this.game;
    if (!g || g.phase !== 'aim' || !this.isLocalHuman(g.current) || this.passPending) return false;
    if (this.mode === 'online' && this.awaitingTurn === g.turnNo) return false; // fire sent, waiting for the host's echo
    return $('screen-game').hidden === false && $('modal').hidden;
  }
  currentIsAI() {
    const g = this.game;
    return !!g && g.players[g.current] && g.players[g.current].type === 'ai';
  }
  effectiveSpeed() {
    const g = this.game;
    if (!g) return 1;
    if (g.phase === 'aim' && this.isLocalHuman(g.current)) return 1;
    let s = this.speed;
    if (this.prefs.fastAI && s === 1 && this.currentIsAI()) s = 2;
    return s;
  }

  // ------------------------------------------------------------ commands
  /** Route a command from a local human: apply directly, or through the host. */
  issue(cmd) {
    if (this.mode === 'local') return this.game.apply(cmd);
    if (cmd.type === 'fire' || cmd.type === 'item' || cmd.type === 'move' || cmd.type === 'skip') cmd.turn = this.game.turnNo;
    if (cmd.type === 'fire') this.awaitingTurn = this.game.turnNo;
    if (this.net.isHost) {
      this.inbox.push({ cmd, from: this.myId });
      return true;
    }
    this.net.sendHost({ t: 'cmd', cmd });
    return true;
  }

  hostProcessInbox() {
    if (!this.inbox.length) return;
    const g = this.game;
    const keep = [];
    for (const item of this.inbox) {
      const cmd = item.cmd;
      const pl = g.players[cmd.p];
      const allowed = pl && (item.from === this.myId || pl.owner === item.from);
      if (!allowed) continue;
      if (cmd.turn !== undefined && cmd.turn !== g.turnNo) continue; // stale duplicate from an earlier turn
      const sum = cmd.type === 'fire' ? g.checksum() : undefined;
      const dbg = sum !== undefined && window.__debugSync ? g.debugState() : undefined;
      if (g.apply(cmd)) {
        this.seq++;
        this.net.broadcast({ t: 'cmd', seq: this.seq, cmd, sum, dbg });
      } else if (!g.isIdle()) {
        keep.push(item); // not applicable yet; retry when the sim settles
      }
    }
    this.inbox = keep;
  }

  clientApplyPending() {
    const g = this.game;
    if (this.resyncing) return;
    while (this.pending.length && this.pending[0].seq === this.nextSeq) {
      const item = this.pending[0];
      // commands only apply once our own simulation has settled at the same point
      if (!g.isIdle()) break;
      if (item.sum !== undefined && g.checksum() !== item.sum) {
        if (item.dbg) console.warn('desync detail', JSON.stringify({ mine: g.debugState(), host: item.dbg, phase: g.phase, current: g.current, seq: item.seq }));
        this.requestResync('checksum mismatch');
        return;
      }
      if (g.apply(item.cmd)) {
        this.pending.shift();
        this.nextSeq++;
      } else {
        this.requestResync('command rejected');
        return;
      }
    }
  }

  requestResync(reason) {
    if (this.resyncing) return;
    this.resyncing = true;
    console.warn('desync:', reason);
    UI.toast('Re-syncing with host…', 3000);
    this.net.sendHost({ t: 'snap?' });
  }

  // ------------------------------------------------------------ loop
  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    const dt = Math.min(120, now - this.last);
    this.last = now;
    if (!this.game) return;
    const g = this.game;
    if (this.mode === 'online' && this.net && this.net.isHost) this.hostProcessJoins();
    this.acc += dt * this.effectiveSpeed();
    let steps = 0;
    while (this.acc >= TICK_MS && steps < 12) {
      if (this.mode === 'online') {
        if (this.net.isHost) this.hostProcessInbox();
        else this.clientApplyPending();
      }
      g.step();
      this.handleEvents(g.takeEvents());
      this.checkTransitions();
      this.acc -= TICK_MS;
      steps++;
    }
    if (steps >= 12) this.acc = 0;
    if (!$('screen-game').hidden) {
      const aim = performance.now() < this.aimUntil && this.canAct() ? { angle: g.tanks[g.current].angle, power: g.tanks[g.current].power } : null;
      this.renderer.draw(g, { aim, speed: this.effectiveSpeed() });
      this.refreshControls();
    }
  }

  handleEvents(events) {
    const g = this.game;
    const snd = this.sound;
    for (const e of events) {
      switch (e.type) {
        case 'fire': snd.fire(); break;
        case 'explosion': snd.explosion(e.r); if (e.r >= 30) this.buzz(80); break;
        case 'hit':
          if (e.by !== e.p) snd.hit();
          if (this.isLocalHuman(e.p)) this.buzz(40);
          break;
        case 'death': snd.death(); if (this.isLocalHuman(e.p)) this.buzz([60, 40, 120]); break;
        case 'shieldUp': case 'shieldHit': snd.shield(); break;
        case 'dirt': case 'riot': case 'dig': snd.dirt(); break;
        case 'laser': snd.laser(); break;
        case 'fall': snd.fall(); break;
        case 'deflect': snd.bounce(); break;
        case 'battery': snd.cash(); break;
        case 'roundOver': if (e.winner >= 0 && this.isLocalHuman(e.winner)) snd.win(); else if (e.winner >= 0) snd.lose(); break;
        case 'aiTakeover': UI.toast(`${g.players[e.p].name} is now played by the computer`); break;
        case 'takeover': UI.toast(`${g.players[e.p].name} is back`); break;
        case 'shopDone': this.updateWaitingShop(); break;
      }
    }
  }

  buzz(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch { /* ignore */ }
  }

  checkTransitions(force = false) {
    const g = this.game;
    const phase = g.phase;
    if (!force && phase === this.lastPhase && g.current === this.lastCurrent) return;
    const prevPhase = this.lastPhase;
    this.lastPhase = phase;
    this.lastCurrent = g.current;
    if (phase === 'aim') this.onNewTurn(prevPhase);
    else if (phase === 'roundOver') this.onRoundOver();
    else if (phase === 'shop') this.onShop();
    else if (phase === 'gameOver') this.onGameOver();
  }

  onNewTurn(prevPhase) {
    const g = this.game;
    if ($('screen-game').hidden) this.enterGame();
    this.clearOverlay();
    const pl = g.players[g.current];
    if (prevPhase !== 'aim' || true) {
      if (this.isLocalHuman(g.current)) {
        this.sound.turn();
        const humans = this.localHumans();
        if (this.mode === 'local' && humans.length >= 2 && this.lastHumanTurn !== g.current) this.showPassOverlay(pl);
        this.lastHumanTurn = g.current;
        this.showAim(1200);
      }
    }
    this.refreshControls(true);
  }

  showPassOverlay(pl) {
    this.passPending = true;
    const box = h('div', { class: 'banner' },
      h('h2', { style: { color: pl.color } }, `PASS TO ${pl.name.toUpperCase()}`),
      h('p', {}, `It's your turn, ${pl.name}.`),
      h('button', { class: 'btn primary', onclick: () => { this.passPending = false; this.clearOverlay(); this.refreshControls(true); this.sound.unlock(); } }, "I'm ready"),
    );
    this.overlay.innerHTML = '';
    this.overlay.appendChild(box);
  }

  clearOverlay() {
    this.overlay.innerHTML = '';
  }

  onRoundOver() {
    const g = this.game;
    const r = g.roundResult;
    const winner = r && r.winner >= 0 ? g.players[r.winner] : null;
    const box = h('div', { class: 'banner' },
      h('h2', {}, `ROUND ${g.round} OVER`),
      winner ? h('p', { style: { color: winner.color, fontWeight: 700 } }, `${winner.name} wins the round!`) : h('p', {}, 'Nobody survived. It is a draw.'),
    );
    this.overlay.innerHTML = '';
    this.overlay.appendChild(box);
    this.refreshControls(true);
  }

  onShop() {
    this.clearOverlay();
    UI.showScreen(UI.resultsScreen(this, { final: false }));
  }

  continueAfterResults() {
    const g = this.game;
    if (g.phase !== 'shop') { this.enterGame(); return; }
    this.shopQueue = this.localHumans().filter((i) => !g.shopDone[i]);
    this.nextShop();
  }

  nextShop() {
    const g = this.game;
    if (g.phase !== 'shop') { this.enterGame(); return; }
    const idx = this.shopQueue.shift();
    if (idx == null) {
      this.showWaitingShop();
      return;
    }
    UI.showScreen(UI.shopScreen(this, idx, (buys) => {
      this.issue({ type: 'shop', p: idx, buys });
      // local games apply immediately and may already have started the next round
      if (this.game.phase !== 'shop') this.enterGame();
      else this.nextShop();
    }));
  }

  showWaitingShop() {
    const g = this.game;
    if (g.phase !== 'shop') { this.enterGame(); return; }
    this.waitList = h('div', { class: 'stack' });
    UI.showScreen(UI.waitingScreen(this, 'Waiting for the other players to finish shopping…', this.waitList));
    this.updateWaitingShop();
  }

  updateWaitingShop() {
    const g = this.game;
    if (!this.waitList || !this.waitList.isConnected) return;
    this.waitList.innerHTML = '';
    g.players.forEach((p, i) => {
      this.waitList.appendChild(h('div', { class: 'kv' }, h('span', { style: { color: p.color } }, p.name), h('span', {}, g.shopDone[i] ? '✓ ready' : '… shopping')));
    });
  }

  onGameOver() {
    this.clearOverlay();
    UI.showScreen(UI.resultsScreen(this, { final: true }));
  }

  // ------------------------------------------------------------ controls
  refreshControls(force = false) {
    const g = this.game;
    if (!g || $('screen-game').hidden) return;
    const cur = g.current;
    const pl = g.players[cur];
    const t = g.tanks[cur];
    if (!pl) return;
    const mine = this.canAct();
    const controls = $('controls');
    controls.classList.toggle('disabled', !mine);
    const wait = $('ctl-wait');
    let waitText = '';
    if (!mine) {
      if (this.passPending) waitText = '';
      else if (g.phase === 'aim') waitText = pl.type === 'ai' ? `${pl.name} is thinking…` : `Waiting for ${pl.name}…`;
      else if (g.phase === 'action') waitText = '';
      else if (g.phase === 'roundOver') waitText = 'Round over';
    }
    const showWait = !mine && waitText !== '';
    if (wait.hidden !== !showWait) wait.hidden = !showWait;
    const wt = $('ctl-wait-text');
    if (wt.textContent !== waitText) wt.textContent = waitText;
    const set = (id, v) => { const el = $(id); if (el.textContent !== String(v)) el.textContent = v; };
    // status line shows the local player's tank when it's not their turn? keep it on the current player
    const nameEl = $('ctl-name');
    set('ctl-name', pl.name);
    if (nameEl.style.color !== pl.color) nameEl.style.color = pl.color;
    set('ctl-hp', `HP ${t.hp}${t.shield ? ` +${t.shield.pts}` : ''}`);
    set('ctl-cash', UI.money(pl.cash));
    set('ctl-wind', `WIND ${Math.abs(g.wind)} ${g.wind < 0 ? '←' : g.wind > 0 ? '→' : ''}`);
    set('ctl-angle', t.angle);
    set('ctl-power', t.power);
    const w = WEAPONS[t.weapon];
    const cnt = g.weaponCount(pl, t.weapon);
    set('ctl-weapon', `${w.name} ${cnt === Infinity ? '∞' : '×' + cnt}`);
    const items = [];
    for (const id of ITEM_ORDER) {
      const n = pl.items[id] || 0;
      if (n > 0) items.push(`${ITEMS[id].short} ${ITEMS[id].permanent ? '' : '×' + n}`);
    }
    set('ctl-items', items.length ? items.join(' · ') : 'none');
    $('btn-fire').disabled = !mine;
    const sp = controls.querySelector('[data-act="speed"]');
    sp.classList.toggle('on', this.speed > 1);
    sp.textContent = this.speed > 1 ? `${this.speed}×` : '⏩';
  }

  adjust(what, d) {
    if (!this.canAct()) return;
    const t = this.game.tanks[this.game.current];
    if (what === 'angle') this.setAim(t.angle + d, t.power);
    else this.setAim(t.angle, t.power + d);
    this.showAim(900);
  }

  setAim(angle, power, weapon) {
    if (!this.canAct()) return;
    const g = this.game;
    const t = g.tanks[g.current];
    angle = clamp(Math.round(angle), 0, 180);
    power = clamp(Math.round(power), 0, 1000);
    if (t.angle === angle && t.power === power && (!weapon || weapon === t.weapon)) return;
    t.angle = angle;
    t.power = power;
    if (weapon) t.weapon = weapon;
    this.sound.click();
    this.refreshControls();
    if (this.mode === 'online') {
      const now = performance.now();
      if (now - this.lastAimSent > 120 || weapon) {
        this.lastAimSent = now;
        const msg = { t: 'aim', p: g.current, angle, power, weapon: t.weapon };
        if (this.net.isHost) this.net.broadcast(msg);
        else this.net.sendHost(msg);
      }
    }
  }

  showAim(ms = 600) {
    this.aimUntil = performance.now() + ms;
  }

  fire() {
    if (!this.canAct()) return;
    const g = this.game;
    const t = g.tanks[g.current];
    this.sound.unlock();
    if (!g.ownsWeapon(g.players[g.current], t.weapon)) t.weapon = 'baby_missile';
    this.issue({ type: 'fire', p: g.current, angle: t.angle, power: t.power, weapon: t.weapon });
    this.refreshControls(true);
  }

  cycleWeapon(dir) {
    if (!this.canAct()) return;
    const g = this.game;
    const pl = g.players[g.current];
    const t = g.tanks[g.current];
    const owned = g.ownedWeapons(pl);
    const i = owned.indexOf(t.weapon);
    const next = owned[(i + dir + owned.length) % owned.length];
    this.setAim(t.angle, t.power, next);
    this.sound.select();
  }

  openWeapons() {
    if (!this.canAct()) return;
    const g = this.game;
    const pl = g.players[g.current];
    const t = g.tanks[g.current];
    const list = h('div');
    for (const id of WEAPON_ORDER) {
      if (!g.ownsWeapon(pl, id)) continue;
      const w = WEAPONS[id];
      const cnt = g.weaponCount(pl, id);
      list.appendChild(h('button', { class: 'list-item' + (id === t.weapon ? ' on' : ''), onclick: () => { this.setAim(t.angle, t.power, id); this.sound.select(); UI.closeModal(); this.refreshControls(true); } },
        h('div', {}, h('div', { class: 'name', style: { color: w.color === '#ffffff' ? '#fff' : w.color } }, w.name), h('div', { class: 'desc' }, weaponDesc(w))),
        h('div', { class: 'cnt' }, cnt === Infinity ? '∞' : `×${cnt}`),
      ));
    }
    UI.modal(h('div', {}, UI.modalTitle('Weapon'), list));
  }

  openItems() {
    if (!this.canAct()) return;
    const g = this.game;
    const pl = g.players[g.current];
    const t = g.tanks[g.current];
    const list = h('div');
    let any = false;
    for (const id of ITEM_ORDER) {
      const n = pl.items[id] || 0;
      if (n <= 0) continue;
      any = true;
      const it = ITEMS[id];
      const row = (label, action, disabled) => h('button', { class: 'list-item', disabled, onclick: action },
        h('div', {}, h('div', { class: 'name', style: { color: it.color } }, it.name), h('div', { class: 'desc' }, it.desc)),
        h('div', { class: 'cnt' }, label));
      if (it.kind === 'shield') {
        const active = t.shield && t.shield.id === id;
        list.appendChild(row(active ? 'active' : `×${n} · raise`, () => { this.issue({ type: 'item', p: g.current, item: id }); UI.closeModal(); this.refreshControls(true); }, active || (t.shield && t.shield.pts >= it.points)));
      } else if (it.kind === 'battery') {
        list.appendChild(row(`×${n} · use`, () => { this.issue({ type: 'item', p: g.current, item: id }); UI.closeModal(); this.refreshControls(true); }, t.hp >= 100));
      } else if (it.kind === 'fuel') {
        list.appendChild(h('div', { class: 'list-item' },
          h('div', {}, h('div', { class: 'name', style: { color: it.color } }, `${it.name} ×${n}`), h('div', { class: 'desc' }, it.desc)),
          h('div', { class: 'row' },
            h('button', { class: 'btn small', onclick: () => { this.issue({ type: 'move', p: g.current, dir: -1 }); UI.closeModal(); } }, '◀ Drive'),
            h('button', { class: 'btn small', onclick: () => { this.issue({ type: 'move', p: g.current, dir: 1 }); UI.closeModal(); } }, 'Drive ▶'),
          ),
        ));
      } else {
        list.appendChild(h('div', { class: 'list-item' },
          h('div', {}, h('div', { class: 'name', style: { color: it.color } }, it.name), h('div', { class: 'desc' }, it.desc)),
          h('div', { class: 'cnt' }, it.permanent ? 'owned' : `×${n} · automatic`)));
      }
    }
    if (!any) list.appendChild(h('p', { class: 'muted' }, 'No accessories. Buy shields, parachutes, batteries and fuel in the shop between rounds.'));
    UI.modal(h('div', {}, UI.modalTitle('Items'), list));
  }

  toggleSpeed() {
    this.speed = this.speed >= 4 ? 1 : this.speed * 2;
    this.refreshControls(true);
  }

  openMenu() {
    if (!this.game) return;
    const p = this.prefs;
    const tog = (label, key, after) => h('button', { class: 'list-item', onclick: (e) => { p[key] = !p[key]; this.savePrefs(); this.applyPrefs(); e.currentTarget.querySelector('.cnt').textContent = p[key] ? 'on' : 'off'; if (after) after(); } },
      h('div', { class: 'name' }, label), h('div', { class: 'cnt' }, p[key] ? 'on' : 'off'));
    const box = h('div', {},
      UI.modalTitle('Menu'),
      h('button', { class: 'btn primary', style: { marginBottom: '10px' }, onclick: () => UI.closeModal() }, 'Resume'),
      tog('Sound', 'sound', () => this.sound.unlock()),
      tog('Shot trails', 'trails'),
      tog('Name labels', 'labels'),
      tog('Fast AI turns', 'fastAI'),
      tog('Drag on field to aim', 'dragAim'),
      h('button', { class: 'list-item', onclick: () => { UI.closeModal(); UI.showScreen(UI.helpScreen(this, () => this.enterGame())); } }, h('div', { class: 'name' }, 'How to play'), h('div', { class: 'cnt' }, '›')),
      this.mode === 'online' ? h('button', { class: 'list-item', onclick: () => { UI.closeModal(); this.openChat(); } }, h('div', { class: 'name' }, 'Chat'), h('div', { class: 'cnt' }, '›')) : null,
      this.mode === 'online' && this.net.isHost && this.canAct() === false ? h('button', { class: 'list-item', onclick: () => { UI.closeModal(); this.hostSkipTurn(); } }, h('div', { class: 'name' }, 'Skip the current player (host)'), h('div', { class: 'cnt' }, '›')) : null,
      h('button', { class: 'list-item', onclick: () => { UI.closeModal(); this.confirmQuit(); } }, h('div', { class: 'name', style: { color: 'var(--red)' } }, 'Quit to menu'), h('div', { class: 'cnt' }, '›')),
    );
    UI.modal(box);
  }

  hostSkipTurn() {
    const g = this.game;
    if (g.phase === 'aim' && g.players[g.current].type === 'human') this.inbox.push({ cmd: { type: 'skip', p: g.current }, from: this.myId });
  }

  openChat() {
    if (this.mode !== 'online') return;
    let text = '';
    const log = h('div', { class: 'chat-log' }, ...this.chatLog.map((m) => h('div', {}, h('b', { style: { color: m.color } }, m.from + ': '), m.text)));
    const input = h('input', { placeholder: 'Say something…', maxlength: 120, oninput: (e) => (text = e.target.value) });
    const send = () => {
      if (!text.trim()) return;
      this.sendChat(text.trim());
      text = '';
      input.value = '';
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    UI.modal(h('div', {}, UI.modalTitle('Chat'), log, h('div', { class: 'row' }, h('div', { class: 'grow' }, input), h('button', { class: 'btn small', onclick: send }, 'Send'))));
    log.scrollTop = log.scrollHeight;
    setTimeout(() => input.focus(), 50);
  }

  sendChat(text) {
    const me = this.game ? this.game.players.find((p) => p.owner === this.myId) : null;
    const msg = { t: 'chat', from: this.prefs.name || (me && me.name) || 'Someone', color: me ? me.color : '#fff', text };
    this.onChat(msg);
    if (this.net.isHost) this.net.broadcast(msg);
    else this.net.sendHost(msg);
  }
  onChat(msg) {
    this.chatLog.push({ from: String(msg.from).slice(0, 12), color: msg.color, text: String(msg.text).slice(0, 120) });
    if (this.chatLog.length > 100) this.chatLog.shift();
    UI.toast(`${msg.from}: ${msg.text}`, 3500);
    const log = document.querySelector('.chat-log');
    if (log) {
      log.appendChild(h('div', {}, h('b', { style: { color: msg.color } }, msg.from + ': '), msg.text));
      log.scrollTop = log.scrollHeight;
    }
  }

  // ------------------------------------------------------------ online
  teardownNet() {
    if (this.net) {
      if (this.net.isHost && this.lobby) this.net.broadcast({ t: 'end' });
      this.net.close();
    }
    this.net = null;
    this.lobby = null;
    this.myId = null;
    this.pending = [];
    this.inbox = [];
    this.pendingJoins = [];
    this.dropped.clear();
    this.seq = 0;
    this.nextSeq = 1;
    this.resyncing = false;
    this.awaitingTurn = -1;
    this.chatLog = [];
  }

  async hostGame() {
    this.teardownNet();
    this.mode = 'online';
    this.net = new Net(this.prefs.peer);
    let code = makeRoomCode();
    let tries = 0;
    for (;;) {
      try {
        await this.net.host(code);
        break;
      } catch (e) {
        if (e && e.type === 'unavailable-id' && tries++ < 3) { code = makeRoomCode(); continue; }
        throw e;
      }
    }
    this.myId = this.net.id;
    this.lobby = {
      code,
      players: [{ name: this.prefs.name, color: PLAYER_COLORS[0], type: 'human', owner: this.myId }],
      settings: { rounds: this.settings().rounds },
    };
    this.wireNet();
    UI.showScreen(UI.lobbyScreen(this));
  }

  async joinGame(code, name) {
    this.teardownNet();
    this.mode = 'online';
    this.net = new Net(this.prefs.peer);
    await this.net.join(code);
    this.myId = this.net.id;
    this.lobby = { code, players: [], settings: { rounds: 1 } };
    this.wireNet();
    this.net.sendHost({ t: 'join', name });
    UI.showScreen(UI.waitingScreen(this, 'Joining the room…'));
  }

  wireNet() {
    const net = this.net;
    net.on('message', (conn, msg) => {
      try {
        if (net.isHost) this.hostMessage(conn, msg);
        else this.clientMessage(msg);
      } catch (e) {
        console.error('net message error', e);
      }
    });
    net.on('close', (conn) => {
      if (net.isHost) this.hostPeerLeft(conn.peer);
      else this.hostGone();
    });
    net.on('error', (e) => console.warn('net error', e));
  }

  broadcastLobby() {
    this.net.broadcast({ t: 'lobby', players: this.lobby.players, settings: this.lobby.settings });
    if (!this.game && document.querySelector('.code')) UI.showScreen(UI.lobbyScreen(this));
  }

  hostMessage(conn, msg) {
    const L = this.lobby;
    switch (msg.t) {
      case 'join': {
        const name = String(msg.name || 'Player').slice(0, 12);
        if (this.game) {
          // rejoin?
          const idx = this.dropped.get(name);
          if (idx != null) {
            this.dropped.delete(name);
            this.pendingJoins.push({ conn, idx, name });
            this.net.send(conn, { t: 'welcome', you: conn.peer, lobby: { code: L.code, players: L.players, settings: L.settings } });
          } else {
            this.net.send(conn, { t: 'full', reason: 'This game has already started.' });
          }
          return;
        }
        if (L.players.length >= 10) { this.net.send(conn, { t: 'full', reason: 'The room is full (10 tanks).' }); return; }
        const used = new Set(L.players.map((p) => p.color));
        const color = PLAYER_COLORS.find((c) => !used.has(c)) || PLAYER_COLORS[L.players.length % PLAYER_COLORS.length];
        // unique name
        let n = name, k = 2;
        while (L.players.some((p) => p.name === n)) n = `${name.slice(0, 10)} ${k++}`;
        L.players.push({ name: n, color, type: 'human', owner: conn.peer });
        this.net.send(conn, { t: 'welcome', you: conn.peer, lobby: { code: L.code, players: L.players, settings: L.settings } });
        this.broadcastLobby();
        UI.toast(`${n} joined`);
        break;
      }
      case 'lobbyUpdate': {
        const p = L.players[msg.idx];
        if (p && p.owner === conn.peer && !this.game) {
          if (msg.color && PLAYER_COLORS.includes(msg.color)) p.color = msg.color;
          this.broadcastLobby();
        }
        break;
      }
      case 'cmd':
        if (this.game && msg.cmd) this.inbox.push({ cmd: msg.cmd, from: conn.peer });
        break;
      case 'aim':
        if (this.game) {
          const pl = this.game.players[msg.p];
          if (pl && pl.owner === conn.peer) {
            this.game.apply({ type: 'aim', p: msg.p, angle: msg.angle, power: msg.power, weapon: msg.weapon });
            this.net.broadcast(msg, conn);
          }
        }
        break;
      case 'snap?':
        this.pendingJoins.push({ conn, snapshotOnly: true });
        break;
      case 'chat':
        this.onChat(msg);
        this.net.broadcast(msg, conn);
        break;
    }
  }

  hostProcessJoins() {
    if (!this.pendingJoins.length || !this.game || !this.game.isIdle()) return;
    const g = this.game;
    const joins = this.pendingJoins;
    this.pendingJoins = [];
    for (const j of joins) {
      if (!j.snapshotOnly) {
        const cmd = { type: 'takeover', p: j.idx, owner: j.conn.peer };
        if (g.apply(cmd)) {
          this.seq++;
          this.net.broadcast({ t: 'cmd', seq: this.seq, cmd }, j.conn);
        }
      }
      const snap = g.snapshot();
      this.net.send(j.conn, { t: 'start', seed: g.seed, settings: g.settings, players: g.players, snapshot: snap, seq: this.seq });
    }
  }

  hostPeerLeft(peerId) {
    if (!this.game) {
      const L = this.lobby;
      const i = L.players.findIndex((p) => p.owner === peerId);
      if (i >= 0) {
        UI.toast(`${L.players[i].name} left`);
        L.players.splice(i, 1);
        this.broadcastLobby();
      }
      return;
    }
    for (const p of this.game.players) {
      if (p.owner === peerId && p.type === 'human') {
        this.dropped.set(p.name, p.idx);
        this.inbox.push({ cmd: { type: 'aiTakeover', p: p.idx, level: 'poolshark' }, from: this.myId });
      }
    }
  }

  lobbyUpdate({ idx, color, ai }) {
    const L = this.lobby;
    const p = L.players[idx];
    if (!p) return;
    if (this.net.isHost) {
      if (color) p.color = color;
      if (ai) p.ai = ai;
      this.broadcastLobby();
    } else if (p.owner === this.myId && color) {
      this.net.sendHost({ t: 'lobbyUpdate', idx, color });
    }
  }
  lobbyRemove(idx) {
    const L = this.lobby;
    const p = L.players[idx];
    if (!p || !this.net.isHost) return;
    if (p.owner && p.owner !== this.myId) {
      const c = this.net.conns.get(p.owner);
      this.net.send(c, { t: 'full', reason: 'The host removed you from the room.' });
      setTimeout(() => c && c.close(), 200);
    }
    L.players.splice(idx, 1);
    this.broadcastLobby();
  }
  lobbyAddAI() {
    const L = this.lobby;
    const used = new Set(L.players.map((p) => p.color));
    const names = ['Genghis', 'Napoleon', 'Attila', 'Cleo', 'Boudica', 'Hannibal', 'Patton', 'Sun Tzu', 'Rommel', 'Zhukov'];
    const name = names.find((n) => !L.players.some((p) => p.name === n)) || `Bot ${L.players.length}`;
    L.players.push({ name, color: PLAYER_COLORS.find((c) => !used.has(c)) || PLAYER_COLORS[L.players.length % 10], type: 'ai', ai: 'poolshark' });
    this.broadcastLobby();
  }
  lobbySettingsChanged() {
    this.broadcastLobby();
  }
  leaveLobby() {
    this.gotoMenu();
  }

  startOnlineGame() {
    const L = this.lobby;
    const seed = randomSeed();
    const settings = { ...this.settings(), rounds: L.settings.rounds };
    const players = L.players.map((p) => ({ name: p.name, color: p.color, type: p.type, ai: p.ai, owner: p.type === 'human' ? p.owner : null }));
    this.seq = 0;
    this.inbox = [];
    this.pendingJoins = [];
    this.net.broadcast({ t: 'start', seed, settings, players, seq: 0 });
    this.beginGame(new Game(settings, players, seed));
  }

  clientMessage(msg) {
    switch (msg.t) {
      case 'welcome':
        this.lobby.code = msg.lobby.code;
        this.lobby.players = msg.lobby.players;
        this.lobby.settings = msg.lobby.settings;
        if (!this.game) UI.showScreen(UI.lobbyScreen(this));
        break;
      case 'lobby':
        if (!this.lobby) return;
        this.lobby.players = msg.players;
        this.lobby.settings = msg.settings;
        if (!this.game) UI.showScreen(UI.lobbyScreen(this));
        break;
      case 'full':
        UI.toast(msg.reason || 'Could not join.', 5000);
        this.gotoMenu();
        break;
      case 'start': {
        this.pending = this.pending.filter((c) => c.seq > (msg.seq || 0));
        this.nextSeq = (msg.seq || 0) + 1;
        this.resyncing = false;
        if (msg.snapshot) {
          const g = Game.fromSnapshot(msg.snapshot);
          this.beginGame(g, { fromSnapshot: true });
        } else {
          this.beginGame(new Game(msg.settings, msg.players, msg.seed));
        }
        break;
      }
      case 'cmd':
        if (msg.seq < this.nextSeq) return;
        this.pending.push(msg);
        this.pending.sort((a, b) => a.seq - b.seq);
        break;
      case 'aim':
        if (this.game) this.game.apply({ type: 'aim', p: msg.p, angle: msg.angle, power: msg.power, weapon: msg.weapon });
        break;
      case 'chat':
        this.onChat(msg);
        break;
      case 'end':
        this.hostGone();
        break;
    }
  }

  hostGone() {
    if (this.mode !== 'online') return;
    if (!this.game || this.game.phase === 'gameOver') {
      UI.toast('The host left the room.', 4000);
      this.gotoMenu();
      return;
    }
    // carry on offline: the computer takes over everyone who isn't on this device
    UI.toast('Lost the host. Continuing offline with AI opponents.', 5000);
    const g = this.game;
    for (const p of g.players) {
      if (p.type === 'human' && p.owner !== this.myId) g.apply({ type: 'aiTakeover', p: p.idx, level: 'poolshark' });
      if (p.owner === this.myId) p.owner = null;
    }
    this.net.close();
    this.net = null;
    this.mode = 'local';
    this.pending = [];
    $('controls').querySelector('[data-act="chat"]').hidden = true;
    if (g.phase === 'shop') {
      this.shopQueue = this.localHumans().filter((i) => !g.shopDone[i]);
      this.nextShop();
    }
  }
}

window.app = new App();
