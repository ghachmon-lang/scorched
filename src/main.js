// App controller: screens, the game loop, practice games, and online rooms.
// Online games live on the room server as a log of sequenced commands; every
// phone replays that log through the same deterministic simulation.
import { Game, DEFAULT_SETTINGS, PLAYER_COLORS, W, H, SIM_VERSION } from './game.js';
import { Renderer } from './render.js';
import { Sound } from './sound.js';
import { RoomClient } from './net.js';
import { loadPrefs, savePrefs } from './storage.js';
import { WEAPONS, ITEMS, WEAPON_ORDER, ITEM_ORDER, weaponDesc } from './weapons.js';
import { randomSeed } from './rng.js';
import { installInput } from './input.js';
import { clamp } from './mathd.js';
import { SERVER_URL } from './config.js';
import * as UI from './ui.js';
import { h } from './ui.js';

const TICK_MS = 1000 / 60;
const $ = (id) => document.getElementById(id);

function normalizeCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/I/g, '1').slice(0, 8);
}

class App {
  constructor() {
    this.prefs = loadPrefs();
    this.sound = new Sound();
    this.canvas = $('game');
    this.renderer = new Renderer(this.canvas);
    this.overlay = $('stage-overlay');
    this.game = null;
    this.mode = 'local'; // local (practice) | online
    this.client = null;
    this.room = null; // { code, view, lastSeq }
    this.lobby = null;
    this.myId = null;
    this.speed = 1;
    this.aimUntil = 0;
    this.pending = [];
    this.nextSeq = 1;
    this.reloadedAtSeq = -1;
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
    this.lastReport = '';
    this.loading = false;
    this.swReg = null;
    this.view = { zoom: 1, panX: 0, panY: 0, fit: 1, baseX: 0, baseY: 0, stageW: 0, stageH: 0 };
    this.applyPrefs();
    installInput(this);
    window.addEventListener('resize', () => this.layout());
    window.addEventListener('orientationchange', () => setTimeout(() => this.layout(), 200));
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); this.installPrompt = e; });
    document.addEventListener('visibilitychange', () => {
      this.last = performance.now();
      if (document.visibilityState === 'visible' && this.client && this.room) {
        this.client.wake();
        this.catchUp();
      }
    });
    window.addEventListener('beforeunload', (e) => {
      if (this.game && this.mode === 'local' && this.game.phase !== 'gameOver') { e.preventDefault(); e.returnValue = ''; }
    });
    requestAnimationFrame((t) => this.loop(t));
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').then((r) => (this.swReg = r)).catch(() => {});
    }
    this.route();
  }

  // ------------------------------------------------------------ prefs / identity
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
  serverUrl() {
    return (this.prefs.server || SERVER_URL || '').replace(/\/+$/, '');
  }
  onlineAvailable() {
    const cfg = window.SCORCHED_CONFIG || {};
    return !cfg.onlineDisabled && !!this.serverUrl();
  }
  onlineDisabledReason() {
    const cfg = window.SCORCHED_CONFIG || {};
    return cfg.onlineDisabled || 'Online play is not set up: no game server address. Deploy the server/ folder to Cloudflare and paste its URL into src/config.js, or into Settings → Advanced on this phone.';
  }
  install() {
    if (this.installPrompt) this.installPrompt.prompt();
  }
  getClient() {
    const url = this.serverUrl();
    if (!this.client || this.client.server !== url) {
      if (this.client) this.client.disconnect();
      this.client = new RoomClient(url, this.prefs.token);
    }
    return this.client;
  }
  savedGames() {
    return Object.values(this.prefs.games || {}).filter((g) => g && g.code).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  }
  rememberGame(view, extra = {}) {
    const fresh = !this.prefs.games[view.code];
    const g = this.prefs.games[view.code] || { code: view.code, joinedAt: Date.now() };
    // which rules the game runs on: the server's word, else what we recorded, else (new membership) this build
    g.simVersion = view.simVersion || g.simVersion || (fresh ? SIM_VERSION : 1);
    const me = view.players.find((p) => p.id === view.you);
    const others = view.players.filter((p) => p.id !== view.you).map((p) => p.name);
    Object.assign(g, {
      server: this.serverUrl(),
      id: view.you || g.id,
      phase: view.phase,
      lastSeen: Date.now(),
      label: others.length ? `vs ${others.slice(0, 3).join(', ')}${others.length > 3 ? '…' : ''}` : (me ? `${me.name}'s room` : `Room ${view.code}`),
    }, extra);
    this.prefs.games[view.code] = g;
    this.savePrefs();
  }
  forgetGame(code) {
    delete this.prefs.games[code];
    this.savePrefs();
    this.gotoMenu();
  }

  // ------------------------------------------------------------ navigation
  route() {
    const q = new URLSearchParams(location.search);
    const code = normalizeCode(q.get('room') || q.get('join'));
    if (code) {
      history.replaceState(null, '', location.pathname);
      if (this.onlineAvailable()) this.joinFlow(code);
      else this.gotoMenu();
    } else this.gotoMenu();
  }
  gotoMenu() {
    this.leaveRoomSession();
    this.game = null;
    this.clearOverlay();
    UI.showScreen(UI.menuScreen(this));
    this.refreshGameSummaries();
  }
  gotoPractice() {
    this.leaveRoomSession();
    UI.showScreen(UI.practiceScreen(this));
  }
  gotoSettings(back) {
    UI.showScreen(UI.settingsScreen(this, back));
  }
  gotoHelp(back) {
    UI.showScreen(UI.helpScreen(this, back));
  }
  gotoJoin(code) {
    UI.showScreen(UI.joinScreen(this, code));
  }
  joinLink() {
    const u = new URL(location.href);
    u.search = '?room=' + (this.room ? this.room.code : '');
    u.hash = '';
    return u.toString();
  }
  withName(fn) {
    if (this.prefs.name) fn(this.prefs.name, this.prefs.color || PLAYER_COLORS[0]);
    else UI.namePrompt(this, fn);
  }

  async refreshGameSummaries() {
    const rows = document.querySelectorAll('#my-games .game-row');
    if (!rows.length || !this.onlineAvailable()) return;
    const client = this.getClient();
    await Promise.all([...rows].map(async (row) => {
      const code = row.dataset.code;
      try {
        const s = await client.summary(code);
        if (!row.isConnected) return;
        const status = row.querySelector('.game-status');
        const pill = row.querySelector('.turn-pill');
        const g = this.prefs.games[code];
        if (g) { g.phase = s.phase; g.lastSeen = Math.max(g.lastSeen || 0, s.updatedAt || 0); }
        if (s.phase === 'lobby') status.textContent = `In the lobby with ${s.players.length} tank${s.players.length === 1 ? '' : 's'}`;
        else if (s.phase === 'over') status.textContent = `Finished · ${UI.relativeTime(s.updatedAt)}`;
        else if (s.yourTurn) status.textContent = s.turnPhase === 'shop' ? `Round ${s.round} over, time to shop` : `Round ${s.round}/${s.rounds} · your move`;
        else status.textContent = `Round ${s.round}/${s.rounds} · waiting for ${s.waitingOn.join(', ') || 'the computer'} · ${UI.relativeTime(s.updatedAt)}`;
        pill.hidden = !s.yourTurn;
        row.classList.toggle('your-turn', !!s.yourTurn);
      } catch (e) {
        if (!row.isConnected) return;
        const status = row.querySelector('.game-status');
        status.textContent = /No such room/.test(e.message) ? 'This room no longer exists' : 'Offline';
      }
    }));
    this.savePrefs();
  }

  // ------------------------------------------------------------ practice (local)
  startPractice(name, color, bots) {
    this.leaveRoomSession();
    this.mode = 'local';
    const names = ['Genghis', 'Napoleon', 'Attila', 'Cleo', 'Boudica', 'Hannibal', 'Patton', 'Sun Tzu', 'Rommel'];
    const players = [{ name, color, type: 'human', owner: null }];
    bots.forEach((b, i) => {
      const c = PLAYER_COLORS.filter((x) => x !== color)[i % 9];
      players.push({ name: names[i % names.length], color: c, type: 'ai', ai: b.ai, owner: null });
    });
    this.beginGame(new Game(this.settings(), players, randomSeed()));
  }
  canPlayAgain() {
    return this.mode === 'local';
  }
  playAgain() {
    if (this.mode !== 'local') return;
    const players = this.game.players.map((p) => ({ name: p.name, type: p.type, ai: p.ai, color: p.color, owner: null }));
    this.beginGame(new Game(this.settings(), players, randomSeed()));
  }
  quitToMenu() {
    this.clearOverlay();
    this.gotoMenu();
  }
  confirmQuit() {
    const online = this.mode === 'online';
    const box = h('div', { class: 'stack' },
      UI.modalTitle(online ? 'Leave this game?' : 'Quit game?'),
      h('p', {}, online ? 'Your tank is handed to the computer so the others can keep playing. You can take it back later from "My games".' : 'The current practice game will be lost.'),
      h('button', { class: 'btn primary', onclick: () => { UI.closeModal(); if (online) this.handOver(this.myIdx()); this.quitToMenu(); } }, online ? 'Leave and hand over' : 'Quit'),
      online ? h('button', { class: 'btn', onclick: () => { UI.closeModal(); this.quitToMenu(); } }, 'Just close (I will be back)') : null,
      h('button', { class: 'btn ghost', onclick: () => UI.closeModal() }, 'Keep playing'),
    );
    UI.modal(box);
  }

  // ------------------------------------------------------------ game lifecycle
  beginGame(game, { started = false } = {}) {
    this.game = game;
    if (!started) game.start();
    this.speed = 1;
    this.lastPhase = '';
    this.lastCurrent = -1;
    this.lastHumanTurn = -1;
    this.passPending = false;
    this.shopQueue = [];
    this.awaitingTurn = -1;
    this.lastReport = '';
    this.renderer.bgKey = '';
    this.view.zoom = 1;
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
    const v = this.view;
    v.fit = Math.max(0.1, Math.min(r.width / W, r.height / H));
    v.stageW = r.width;
    v.stageH = r.height;
    const cw = Math.floor(W * v.fit), ch = Math.floor(H * v.fit);
    v.baseX = Math.floor((r.width - cw) / 2);
    v.baseY = Math.floor((r.height - ch) / 2);
    this.canvas.style.width = `${cw}px`;
    this.canvas.style.height = `${ch}px`;
    this.applyView();
  }

  /** Position the canvas: fit-to-stage at zoom 1, otherwise zoomed and panned (CSS transform keeps pixels crisp). */
  applyView() {
    const v = this.view;
    const cw = W * v.fit * v.zoom, ch = H * v.fit * v.zoom;
    // keep the zoomed battlefield covering the stage; centre it on the axis where it is smaller
    const clampAxis = (pan, size, stage) => (size <= stage ? (stage - size) / 2 : clamp(pan, stage - size, 0));
    v.panX = clampAxis(v.panX, cw, v.stageW);
    v.panY = clampAxis(v.panY, ch, v.stageH);
    this.canvas.style.transform = `translate(${v.panX}px, ${v.panY}px) scale(${v.zoom})`;
    const btn = $('controls').querySelector('[data-act="zoomreset"]');
    if (btn) btn.hidden = v.zoom <= 1.001;
  }

  /** Zoom to `zoom`, keeping the stage point (sx, sy) fixed under the fingers. */
  setZoom(zoom, sx, sy) {
    const v = this.view;
    const z = clamp(zoom, 1, 6);
    if (sx == null) { sx = v.stageW / 2; sy = v.stageH / 2; }
    const k = z / v.zoom;
    v.panX = sx - (sx - v.panX) * k;
    v.panY = sy - (sy - v.panY) * k;
    v.zoom = z;
    this.applyView();
  }
  panBy(dx, dy) {
    this.view.panX += dx;
    this.view.panY += dy;
    this.applyView();
  }
  resetView() {
    this.view.zoom = 1;
    this.applyView();
  }
  /** Pan so the world point (wx, wy) sits in the middle of the stage (only while zoomed). */
  centerOn(wx, wy) {
    const v = this.view;
    if (v.zoom <= 1.001) return;
    const s = v.fit * v.zoom;
    v.panX = v.stageW / 2 - wx * s;
    v.panY = v.stageH / 2 - wy * s;
    this.applyView();
  }

  isLocalHuman(idx) {
    const p = this.game && this.game.players[idx];
    if (!p || p.type !== 'human') return false;
    return this.mode === 'local' ? true : p.owner === this.myId;
  }
  myIdx() {
    if (!this.game) return -1;
    const p = this.game.players.find((x) => x.owner === this.myId);
    return p ? p.idx : -1;
  }
  localHumans() {
    return this.game ? this.game.players.filter((p) => this.isLocalHuman(p.idx)).map((p) => p.idx) : [];
  }
  canAct() {
    const g = this.game;
    if (!g || g.phase !== 'aim' || !this.isLocalHuman(g.current) || this.passPending || this.loading) return false;
    if (this.mode === 'online' && this.awaitingTurn === g.turnNo) return false;
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
  issue(cmd) {
    if (this.mode === 'local') return this.game.apply(cmd);
    const g = this.game;
    if (cmd.type === 'fire' || cmd.type === 'item' || cmd.type === 'move' || cmd.type === 'skip') cmd.turn = g.turnNo;
    if (cmd.type === 'fire') this.awaitingTurn = g.turnNo;
    const sum = cmd.type === 'fire' ? g.checksum() : undefined;
    const code = this.room.code;
    this.getClient().cmd(code, cmd, sum).then((res) => {
      if (res && res.entry) this.enqueue(res.entry);
      else if (res && res.seq) this.enqueue({ seq: res.seq, cmd, sum: sum === undefined ? null : sum });
    }).catch((e) => {
      this.awaitingTurn = -1;
      UI.toast('Could not send your move: ' + e.message, 4000);
      this.refreshControls(true);
    });
    return true;
  }

  enqueue(entry) {
    if (!entry || typeof entry.seq !== 'number' || entry.seq < this.nextSeq) return;
    if (this.pending.some((p) => p.seq === entry.seq)) return;
    this.pending.push(entry);
    this.pending.sort((a, b) => a.seq - b.seq);
  }

  applyPending() {
    const g = this.game;
    while (this.pending.length && this.pending[0].seq === this.nextSeq) {
      if (!g.awaitingInput()) break;
      const item = this.pending[0];
      const cmd = item.cmd;
      if (cmd.turn !== undefined && cmd.turn !== g.turnNo) {
        // stale duplicate of an earlier turn: every phone skips it identically
        this.pending.shift();
        this.nextSeq++;
        continue;
      }
      if (typeof item.sum === 'number' && g.checksum() !== item.sum) {
        if (this.reloadedAtSeq !== item.seq) {
          this.reloadedAtSeq = item.seq;
          console.warn('checksum mismatch at seq', item.seq, 'reloading from the server log');
          UI.toast('Re-syncing with the server…', 2500);
          this.openRoom(this.room.code);
          return;
        }
        console.warn('checksum still differs after reload at seq', item.seq, '(sender diverged); continuing');
      }
      if (!g.apply(cmd)) console.warn('command rejected by the simulation, skipped', cmd);
      this.pending.shift();
      this.nextSeq++;
      this.room.lastSeq = item.seq;
      if (cmd.type === 'fire') this.awaitingTurn = -1;
    }
  }

  // ------------------------------------------------------------ loop
  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    const dt = Math.min(120, now - this.last);
    this.last = now;
    if (!this.game || this.loading) return;
    const g = this.game;
    this.acc += dt * this.effectiveSpeed();
    let steps = 0;
    while (this.acc >= TICK_MS && steps < 12) {
      if (this.mode === 'online') this.applyPending();
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
        case 'fire': snd.fire(); this.resetView(); break;
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
        case 'aiTakeover': UI.toast(`${g.players[e.p].name}'s tank is now driven by the computer`); break;
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
    if (this.mode === 'online' && g.awaitingInput()) this.reportTurn();
  }

  onNewTurn() {
    const g = this.game;
    if ($('screen-game').hidden) this.enterGame();
    this.clearOverlay();
    if (this.isLocalHuman(g.current)) {
      this.sound.turn();
      this.lastHumanTurn = g.current;
      this.showAim(1200);
      const t = g.tanks[g.current];
      this.centerOn(t.x, t.y - 20);
    }
    this.refreshControls(true);
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
      if (this.game.phase !== 'shop') this.enterGame();
      else this.showWaitingShop();
    }));
  }

  showWaitingShop() {
    const g = this.game;
    if (g.phase !== 'shop') { this.enterGame(); return; }
    this.waitList = h('div', { class: 'stack' });
    UI.showScreen(UI.waitingScreen(this, 'Waiting for the other players to finish shopping. You can close the app; the game will be here when they are done.', this.waitList));
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
    if (this.mode === 'online' && this.room) this.rememberGame({ ...this.room.view, phase: 'over' });
    UI.showScreen(UI.resultsScreen(this, { final: true }));
  }

  // ------------------------------------------------------------ controls
  refreshControls() {
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
      if (g.phase === 'aim') waitText = pl.type === 'ai' ? `${pl.name} is thinking…` : this.awaitingTurn === g.turnNo && this.isLocalHuman(cur) ? 'Sending…' : `Waiting for ${pl.name}…`;
      else if (g.phase === 'roundOver') waitText = 'Round over';
    }
    const showWait = !mine && waitText !== '';
    if (wait.hidden !== !showWait) wait.hidden = !showWait;
    const wt = $('ctl-wait-text');
    if (wt.textContent !== waitText) wt.textContent = waitText;
    const set = (id, v) => { const el = $(id); if (el.textContent !== String(v)) el.textContent = v; };
    const nameEl = $('ctl-name');
    set('ctl-name', pl.name);
    const sw = $('ctl-swatch');
    if (sw.style.background !== pl.color) sw.style.background = pl.color;
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
    if (this.mode === 'online' && this.client) {
      const now = performance.now();
      if (now - this.lastAimSent > 150 || weapon) {
        this.lastAimSent = now;
        this.client.send({ t: 'aim', p: g.current, angle, power, weapon: t.weapon });
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
    const g = this.game;
    const tog = (label, key, after) => h('button', { class: 'list-item', onclick: (e) => { p[key] = !p[key]; this.savePrefs(); this.applyPrefs(); e.currentTarget.querySelector('.cnt').textContent = p[key] ? 'on' : 'off'; if (after) after(); } },
      h('div', { class: 'name' }, label), h('div', { class: 'cnt' }, p[key] ? 'on' : 'off'));
    const online = this.mode === 'online';
    const isHost = online && this.room && this.room.view.hostId === this.myId;
    const handOverRows = [];
    if (isHost) {
      for (const pl of g.players) {
        if (pl.type === 'human' && pl.owner !== this.myId) {
          handOverRows.push(h('button', { class: 'list-item', onclick: () => { UI.closeModal(); this.handOver(pl.idx); } },
            h('div', {}, h('div', { class: 'name' }, `Hand ${pl.name}'s tank to the computer`), h('div', { class: 'desc' }, 'For players who stopped responding. They can take it back later.')), h('div', { class: 'cnt' }, '›')));
        }
      }
    }
    const box = h('div', {},
      UI.modalTitle('Menu'),
      h('button', { class: 'btn primary', style: { marginBottom: '10px' }, onclick: () => UI.closeModal() }, 'Resume'),
      online && this.canNotify() && !this.notificationsOn() ? h('button', { class: 'list-item', onclick: () => { UI.closeModal(); this.enableNotifications(); } }, h('div', { class: 'name' }, '🔔 Notify me when it is my turn'), h('div', { class: 'cnt' }, '›')) : null,
      tog('Sound', 'sound', () => this.sound.unlock()),
      tog('Shot trails', 'trails'),
      tog('Name labels', 'labels'),
      tog('Fast AI turns', 'fastAI'),
      tog('Drag on field to aim', 'dragAim'),
      h('button', { class: 'list-item', onclick: () => { UI.closeModal(); UI.showScreen(UI.helpScreen(this, () => this.enterGame())); } }, h('div', { class: 'name' }, 'How to play'), h('div', { class: 'cnt' }, '›')),
      online ? h('button', { class: 'list-item', onclick: () => { UI.closeModal(); this.openChat(); } }, h('div', { class: 'name' }, 'Chat'), h('div', { class: 'cnt' }, '›')) : null,
      online ? h('button', { class: 'list-item', onclick: () => { UI.closeModal(); this.shareInvite(); } }, h('div', { class: 'name' }, `Room ${this.room.code}`), h('div', { class: 'cnt' }, 'share')) : null,
      ...handOverRows,
      h('button', { class: 'list-item', onclick: () => { UI.closeModal(); if (online) this.quitToMenu(); else this.confirmQuit(); } }, h('div', { class: 'name' }, online ? 'Back to menu (game stays saved)' : 'Quit to menu'), h('div', { class: 'cnt' }, '›')),
      online ? h('button', { class: 'list-item', onclick: () => { UI.closeModal(); this.confirmQuit(); } }, h('div', { class: 'name', style: { color: 'var(--red)' } }, 'Leave this game for good'), h('div', { class: 'cnt' }, '›')) : null,
    );
    UI.modal(box);
  }

  shareInvite() {
    const link = this.joinLink();
    if (navigator.share) navigator.share({ title: 'Scorched Earth', text: `Join my Scorched Earth game! Room code ${this.room.code}`, url: link }).catch(() => {});
    else if (navigator.clipboard) navigator.clipboard.writeText(link).then(() => UI.toast('Link copied'));
  }

  handOver(idx) {
    if (idx < 0 || this.mode !== 'online') return;
    this.issue({ type: 'aiTakeover', p: idx, level: 'poolshark' });
  }

  openChat() {
    if (this.mode !== 'online') return;
    let text = '';
    const log = h('div', { class: 'chat-log' }, ...this.chatLog.map((m) => h('div', {}, h('b', { style: { color: m.color } }, m.from + ': '), m.text)));
    const input = h('input', { id: 'chat-input', placeholder: 'Say something…', maxlength: 160, oninput: (e) => (text = e.target.value) });
    const send = () => {
      if (!text.trim()) return;
      this.client.send({ t: 'chat', text: text.trim() });
      text = '';
      input.value = '';
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
    UI.modal(h('div', {}, UI.modalTitle('Chat'), log, h('div', { class: 'row' }, h('div', { class: 'grow' }, input), h('button', { class: 'btn small', onclick: send }, 'Send'))));
    log.scrollTop = log.scrollHeight;
    setTimeout(() => input.focus(), 50);
  }
  onChat(msg) {
    this.chatLog.push({ from: String(msg.from).slice(0, 12), color: msg.color, text: String(msg.text).slice(0, 160) });
    if (this.chatLog.length > 100) this.chatLog.shift();
    UI.toast(`${msg.from}: ${msg.text}`, 3500);
    const log = document.querySelector('.chat-log');
    if (log) {
      log.appendChild(h('div', {}, h('b', { style: { color: msg.color } }, msg.from + ': '), msg.text));
      log.scrollTop = log.scrollHeight;
    }
  }

  // ------------------------------------------------------------ online rooms
  leaveRoomSession() {
    if (this.client) this.client.disconnect();
    this.room = null;
    this.lobby = null;
    this.myId = null;
    this.pending = [];
    this.nextSeq = 1;
    this.reloadedAtSeq = -1;
    this.chatLog = [];
    this.loading = false;
    this.mode = 'local';
  }

  newGame() {
    this.withName(async (name, color) => {
      UI.showScreen(UI.waitingScreen(this, 'Creating your room…'));
      try {
        const view = await this.getClient().create({ name, color, settings: this.settings(), simVersion: SIM_VERSION });
        this.rememberGame(view);
        this.openLobby(view);
      } catch (e) {
        UI.toast('Could not create a room: ' + e.message, 5000);
        this.gotoMenu();
      }
    });
  }

  /** Arrive via link or code: join if new, otherwise just open. */
  joinFlow(code) {
    code = normalizeCode(code);
    if (this.prefs.games[code]) return this.openRoom(code);
    this.withName(async (name, color) => {
      UI.showScreen(UI.waitingScreen(this, `Joining room ${code}…`));
      try {
        await this.joinGame(code, name, color);
      } catch (e) {
        UI.toast('Could not join: ' + e.message, 5000);
        this.gotoJoin(code);
      }
    });
  }

  async joinGame(code, name, color) {
    code = normalizeCode(code);
    const view = await this.getClient().join(code, { name, color: color || this.prefs.color });
    this.rememberGame(view);
    if (view.phase === 'lobby') this.openLobby(view);
    else await this.openRoom(code);
  }

  async openRoom(code) {
    code = normalizeCode(code);
    const client = this.getClient();
    const screen = UI.loadingScreen(this, 'Fetching the game…');
    UI.showScreen(screen);
    let data;
    try {
      data = await client.state(code, 0);
    } catch (e) {
      UI.toast(e.message, 5000);
      if (/No such room/.test(e.message)) { delete this.prefs.games[code]; this.savePrefs(); }
      this.gotoMenu();
      return;
    }
    const view = data.room;
    if (!view.you) {
      // this phone is not a member yet (someone shared a code for an open lobby)
      this.leaveRoomSession();
      this.withName((name, color) => this.joinGame(code, name, color).catch((e) => { UI.toast('Could not join: ' + e.message, 5000); this.gotoMenu(); }));
      return;
    }
    this.rememberGame(view);
    if (view.phase === 'lobby') {
      this.openLobby(view);
      return;
    }
    await this.loadGame(view, data.cmds, screen);
  }

  openLobby(view) {
    this.leaveRoomSession();
    this.mode = 'online';
    this.myId = view.you;
    this.room = { code: view.code, view, lastSeq: 0 };
    this.lobby = { code: view.code, players: view.players, settings: view.settings, hostId: view.hostId };
    this.connectRoom();
    UI.showScreen(UI.lobbyScreen(this));
    this.maybeSubscribePush();
  }

  connectRoom() {
    const code = this.room.code;
    this.getClient().connect(code, {
      open: () => this.catchUp(),
      message: (m) => this.onRoomMessage(m),
    });
  }

  async catchUp() {
    if (!this.room || !this.client) return;
    const code = this.room.code;
    try {
      const data = await this.client.state(code, this.game ? this.room.lastSeq : 0);
      if (!this.room || this.room.code !== code) return;
      const view = data.room;
      if (this.lobby && view.phase !== 'lobby' && !this.game && !this.loading) {
        await this.loadGame(view, data.cmds);
        return;
      }
      if (this.lobby && view.phase === 'lobby') {
        this.lobby.players = view.players;
        this.lobby.settings = view.settings;
        this.lobby.hostId = view.hostId;
        this.room.view = view;
        if (document.querySelector('.code')) UI.showScreen(UI.lobbyScreen(this));
      }
      if (this.game) for (const c of data.cmds) this.enqueue(c);
    } catch (e) {
      console.warn('catch-up failed', e);
    }
  }

  onRoomMessage(m) {
    switch (m.t) {
      case 'lobby':
        if (!this.lobby) return;
        this.lobby.players = m.players;
        this.lobby.settings = m.settings;
        if (m.hostId) this.lobby.hostId = m.hostId;
        this.room.view = { ...this.room.view, players: m.players, settings: m.settings, hostId: this.lobby.hostId };
        if (document.querySelector('.code')) UI.showScreen(UI.lobbyScreen(this));
        break;
      case 'start':
        if (this.game && this.game.seed === m.room.seed) return;
        if (!this.loading) this.loadGame({ ...m.room, you: this.myId }, []);
        break;
      case 'cmd':
        if (this.game) this.enqueue(m);
        else if (this.loading) this.enqueue(m);
        break;
      case 'aim':
        if (this.game && !this.isLocalHuman(m.p)) this.game.apply({ type: 'aim', p: m.p, angle: m.angle, power: m.power, weapon: m.weapon });
        break;
      case 'chat':
        this.onChat(m);
        break;
      case 'closed':
        UI.toast(m.reason || 'The room was closed.', 4000);
        if (this.room) { delete this.prefs.games[this.room.code]; this.savePrefs(); }
        this.gotoMenu();
        break;
    }
  }

  /** Build the game from the room's seed and replay its command log. */
  async loadGame(view, cmds, screen) {
    const saved = this.prefs.games[view.code];
    const simVersion = view.simVersion || (saved && saved.simVersion) || 1;
    if (simVersion !== SIM_VERSION) {
      this.leaveRoomSession();
      UI.showScreen(UI.waitingScreen(this, simVersion < SIM_VERSION
        ? 'This game was started on an older version of Scorched Earth and its shots would replay differently now, so it cannot be continued. Start a new room instead.'
        : 'This game was started on a newer version of Scorched Earth. Reload the app to update, then open it again.',
        h('button', { class: 'btn', onclick: () => this.forgetGame(view.code) }, 'Forget this game')));
      return;
    }
    if (!screen || !screen.isConnected) {
      screen = UI.loadingScreen(this, 'Replaying the game so far…');
      UI.showScreen(screen);
    } else screen.setText('Replaying the game so far…');
    const wasConnected = this.client && this.client.wsCode === view.code;
    if (!wasConnected) this.leaveRoomSession();
    this.mode = 'online';
    this.loading = true;
    this.myId = view.you || this.myId;
    this.room = { code: view.code, view, lastSeq: 0 };
    this.lobby = null;
    this.pending = [];
    this.nextSeq = 1;
    // build from the roster as it was when the game started; hand-overs are replayed as commands
    const roster = view.startPlayers || view.players;
    const players = roster.map((p) => ({ name: p.name, color: p.color, type: p.type, ai: p.ai || 'poolshark', owner: p.owner }));
    const game = new Game(view.settings, players, view.seed);
    game.start();
    game.takeEvents();
    let lastSeq = 0;
    const total = Math.max(1, cmds.length);
    let sinceYield = 0;
    const yieldNow = async (i) => { screen.setProgress(i / total); await new Promise((r) => setTimeout(r, 0)); };
    const settle = async (i) => {
      while (!game.awaitingInput()) {
        game.step();
        game.events.length = 0;
        if (++sinceYield >= 3000) { sinceYield = 0; await yieldNow(i); }
      }
    };
    for (let i = 0; i < cmds.length; i++) {
      const entry = cmds[i];
      await settle(i);
      const cmd = entry.cmd;
      if (cmd.turn !== undefined && cmd.turn !== game.turnNo) { lastSeq = entry.seq; continue; }
      if (!game.apply(cmd)) console.warn('replay: command rejected', entry);
      lastSeq = entry.seq;
    }
    await settle(cmds.length);
    game.takeEvents();
    if (!this.room || this.room.code !== view.code) return; // user navigated away meanwhile
    this.room.lastSeq = lastSeq;
    this.nextSeq = lastSeq + 1;
    this.pending = this.pending.filter((p) => p.seq > lastSeq);
    this.loading = false;
    if (!wasConnected) this.connectRoom();
    this.rememberGame(view);
    this.beginGame(game, { started: true });
    this.maybeSubscribePush();
    this.offerTakeBack();
  }

  offerTakeBack() {
    const g = this.game;
    const mine = g.players.find((p) => p.owner === this.myId);
    if (mine || !this.room) return;
    const orig = this.room.view.players.find((p) => p.id === this.myId);
    if (!orig || orig.type !== 'ai' || !g.tanks[orig.idx]) return;
    const box = h('div', { class: 'stack' },
      UI.modalTitle('Welcome back'),
      h('p', {}, `Your tank ${g.tanks[orig.idx].alive ? 'is being driven by the computer' : 'was driven by the computer and is out for this round'}. Take it back?`),
      h('button', { class: 'btn primary', onclick: () => { UI.closeModal(); this.issue({ type: 'takeover', p: orig.idx }); } }, 'Take my tank back'),
      h('button', { class: 'btn', onclick: () => UI.closeModal() }, 'Just watch'),
    );
    UI.modal(box);
  }

  /** Tell the server where the game stands so it can notify whoever is up. */
  reportTurn() {
    const g = this.game;
    if (!this.room || !this.client || this.loading) return;
    const hint = { phase: g.phase, current: g.phase === 'aim' ? g.current : -1, round: g.round, seq: this.room.lastSeq, done: g.phase === 'shop' ? g.shopDoneList() : [] };
    const key = JSON.stringify(hint);
    if (key === this.lastReport) return;
    this.lastReport = key;
    this.client.turn(this.room.code, hint).catch(() => {});
    const gm = this.prefs.games[this.room.code];
    if (gm) { gm.phase = g.phase === 'gameOver' ? 'over' : 'playing'; gm.lastSeen = Date.now(); this.savePrefs(); }
  }

  lobbyUpdate({ idx, color, ai, name }) {
    this.getClient().lobby(this.room.code, { op: 'update', idx, color, ai, name }).catch((e) => UI.toast(e.message, 3000));
  }
  lobbyRemove(idx) {
    this.getClient().lobby(this.room.code, { op: 'remove', idx }).catch((e) => UI.toast(e.message, 3000));
  }
  lobbyAddAI() {
    this.getClient().lobby(this.room.code, { op: 'addAI', ai: 'poolshark' }).catch((e) => UI.toast(e.message, 3000));
  }
  lobbySettings(settings) {
    this.getClient().lobby(this.room.code, { op: 'settings', settings }).catch((e) => UI.toast(e.message, 3000));
  }
  leaveLobby() {
    const code = this.room && this.room.code;
    if (code) {
      this.getClient().leave(code).catch(() => {});
      delete this.prefs.games[code];
      this.savePrefs();
    }
    this.gotoMenu();
  }
  async startOnlineGame() {
    try {
      const view = await this.getClient().start(this.room.code, { seed: randomSeed(), settings: this.settings(), simVersion: SIM_VERSION });
      if (!this.game) this.loadGame(view, []);
    } catch (e) {
      UI.toast(e.message, 4000);
    }
  }

  // ------------------------------------------------------------ notifications
  canNotify() {
    return this.mode === 'online' && !!this.room && !!this.room.view.pushConfigured && 'Notification' in window && 'PushManager' in window && Notification.permission !== 'denied';
  }
  notificationsOn() {
    return this.prefs.notify && 'Notification' in window && Notification.permission === 'granted';
  }
  async enableNotifications() {
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { UI.toast('Notifications are blocked for this site.', 3000); return; }
      this.prefs.notify = true;
      this.savePrefs();
      await this.maybeSubscribePush();
      UI.toast('You will be notified when it is your turn.', 3000);
      if (document.querySelector('.code')) UI.showScreen(UI.lobbyScreen(this));
    } catch (e) {
      UI.toast('Could not enable notifications: ' + e.message, 4000);
    }
  }
  async maybeSubscribePush() {
    if (!this.notificationsOn() || !this.room || !this.room.view.vapid) return;
    try {
      const reg = this.swReg || (await navigator.serviceWorker.ready);
      const key = Uint8Array.from(atob(this.room.view.vapid.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
      const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
      await this.getClient().push(this.room.code, sub.toJSON());
    } catch (e) {
      console.warn('push subscription failed', e);
    }
  }
}

window.app = new App();
