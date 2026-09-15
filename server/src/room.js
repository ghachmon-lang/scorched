// One Durable Object per room. It never runs the game itself: it keeps the
// lobby, the settings and seed, and an append-only log of sequenced player
// commands. Every phone replays that log through the same deterministic
// simulation and lands on the identical game, whenever it opens the app.
import { sendPush } from './push.js';

const MAX_PLAYERS = 10;
const IDLE_DELETE_MS = 60 * 24 * 3600 * 1000; // rooms vanish after two idle months
const MAX_PUSH_SUBS = 5;
const COLORS = ['#ff5555', '#5599ff', '#55ff55', '#ffff55', '#ff55ff', '#55ffff', '#ffffff', '#ffaa00', '#aaaaaa', '#aa55ff'];
const AI_LEVELS = ['moron', 'shooter', 'poolshark', 'tosser', 'chooser', 'spoiler', 'cyborg'];
const AI_NAMES = ['Genghis', 'Napoleon', 'Attila', 'Cleo', 'Boudica', 'Hannibal', 'Patton', 'Sun Tzu', 'Rommel', 'Zhukov'];
const COMMANDS = new Set(['fire', 'item', 'move', 'shop', 'skip', 'aiTakeover', 'takeover']);

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const fail = (message, status = 400) => json({ error: message }, status);
const pad = (n) => String(n).padStart(8, '0');
const cleanName = (s) => String(s || '').replace(/[^\p{L}\p{N} _.'-]/gu, '').trim().slice(0, 12);

function randomId(bytes = 12) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  let s = '';
  for (const b of a) s += b.toString(16).padStart(2, '0');
  return s;
}

function sanitizeSettings(s) {
  const out = {};
  if (!s || typeof s !== 'object') return out;
  const num = (k, lo, hi) => { if (typeof s[k] === 'number' && s[k] >= lo && s[k] <= hi) out[k] = s[k]; };
  const str = (k, allowed) => { if (allowed.includes(s[k])) out[k] = s[k]; };
  const bool = (k) => { if (typeof s[k] === 'boolean') out[k] = s[k]; };
  num('rounds', 1, 99); num('initialCash', 0, 10000000); num('interest', 0, 1); num('gravity', 0.1, 5); num('windStrength', 0, 5); num('maxTurns', 0, 1000);
  str('windMode', ['none', 'constant', 'changing']); str('walls', ['concrete', 'rubber', 'spring', 'wrap', 'none', 'random']);
  str('terrain', ['flat', 'hills', 'mountains', 'canyon', 'random']); str('turnOrder', ['roundRobin', 'random', 'loserFirst', 'winnerFirst']);
  bool('dirtFalls'); bool('tankExplosions'); bool('talkingTanks');
  return out;
}

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.meta = undefined;
  }

  async getMeta() {
    if (this.meta === undefined) this.meta = (await this.ctx.storage.get('meta')) || null;
    return this.meta;
  }
  async save() {
    this.meta.updatedAt = Date.now();
    await this.ctx.storage.put('meta', this.meta);
    await this.ctx.storage.setAlarm(Date.now() + IDLE_DELETE_MS);
  }
  async alarm() {
    await this.ctx.storage.deleteAll();
    this.meta = null;
  }

  // ------------------------------------------------------------ views
  publicPlayers(meta) {
    return meta.players.map((p) => ({ idx: p.idx, id: p.id, name: p.name, color: p.color, type: p.type, ai: p.ai || null, owner: p.type === 'human' ? p.id : null }));
  }
  view(meta, token) {
    const me = this.byToken(meta, token);
    const host = meta.players.find((p) => p.token === meta.hostToken);
    return {
      code: meta.code, phase: meta.phase, settings: meta.settings, seed: meta.seed, seq: meta.seq, turn: meta.turn,
      players: this.publicPlayers(meta), startPlayers: meta.startPlayers || null, hostId: host ? host.id : null, you: me ? me.id : null,
      createdAt: meta.createdAt, updatedAt: meta.updatedAt, vapid: this.env.VAPID_PUBLIC_KEY || null,
      pushConfigured: !!(this.env.VAPID_PUBLIC_KEY && this.env.VAPID_PRIVATE_JWK),
    };
  }
  byToken(meta, token) {
    return token ? meta.players.find((p) => p.token === token) : null;
  }
  isHost(meta, token) {
    return !!token && meta.hostToken === token;
  }
  reindex(meta) {
    meta.players.forEach((p, i) => (p.idx = i));
  }
  freeColor(meta) {
    const used = new Set(meta.players.map((p) => p.color));
    return COLORS.find((c) => !used.has(c)) || COLORS[meta.players.length % COLORS.length];
  }
  uniqueName(meta, name, exceptToken) {
    let n = name || 'Player', k = 2;
    while (meta.players.some((p) => p.name === n && p.token !== exceptToken)) n = `${name.slice(0, 10)} ${k++}`;
    return n;
  }

  // ------------------------------------------------------------ routing
  async fetch(req) {
    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean);
    const code = parts[1];
    const action = parts[2] || '';
    if (req.headers.get('Upgrade') === 'websocket') return this.openSocket(url);
    let body = {};
    if (req.method === 'POST') {
      try { body = await req.json(); } catch { body = {}; }
    }
    const token = String(body.token || url.searchParams.get('token') || '');
    const meta = await this.getMeta();
    if (action === 'create') {
      if (meta) return fail('taken', 409);
      return this.create(code, body);
    }
    if (!meta) return fail('No such room. Check the code.', 404);
    switch (action) {
      case 'join': return this.join(meta, body, token);
      case 'state': return this.state(meta, token, Number(url.searchParams.get('since') || 0));
      case 'summary': return json(this.summary(meta, token));
      case 'lobby': return this.lobby(meta, token, body);
      case 'start': return this.start(meta, token, body);
      case 'cmd': return this.command(meta, token, body);
      case 'turn': return this.turn(meta, token, body);
      case 'push': return this.pushSubscribe(meta, token, body);
      case 'leave': return this.leave(meta, token);
      default: return fail('Unknown action', 404);
    }
  }

  // ------------------------------------------------------------ lobby
  async create(code, body) {
    const token = String(body.token || '');
    const name = cleanName(body.name);
    if (token.length < 16 || !name) return fail('A name and a device token are required.');
    const now = Date.now();
    const player = { idx: 0, id: randomId(), token, name, color: COLORS.includes(body.color) ? body.color : COLORS[0], type: 'human', ai: null, pushSubs: [] };
    this.meta = {
      code, createdAt: now, updatedAt: now, phase: 'lobby', settings: sanitizeSettings(body.settings), seed: null,
      players: [player], hostToken: token, seq: 0, turn: null, notifiedKey: '',
    };
    await this.save();
    return json({ ok: true, room: this.view(this.meta, token) });
  }

  async join(meta, body, token) {
    if (token.length < 16) return fail('Missing device token.');
    const existing = this.byToken(meta, token);
    if (existing) {
      // back for more: refresh the name if they changed it in the lobby
      if (meta.phase === 'lobby' && cleanName(body.name) && cleanName(body.name) !== existing.name) {
        existing.name = this.uniqueName(meta, cleanName(body.name), token);
        await this.save();
        this.broadcast({ t: 'lobby', players: this.publicPlayers(meta), settings: meta.settings });
      }
      return json({ ok: true, room: this.view(meta, token) });
    }
    if (meta.phase !== 'lobby') return fail('This game has already started. Ask the host for a new room.', 403);
    if (meta.players.length >= MAX_PLAYERS) return fail('The room is full (10 tanks).', 403);
    const name = cleanName(body.name);
    if (!name) return fail('Enter your name first.');
    const player = { idx: meta.players.length, id: randomId(), token, name: this.uniqueName(meta, name), color: this.freeColor(meta), type: 'human', ai: null, pushSubs: [] };
    meta.players.push(player);
    await this.save();
    this.broadcast({ t: 'lobby', players: this.publicPlayers(meta), settings: meta.settings });
    return json({ ok: true, room: this.view(meta, token) });
  }

  async lobby(meta, token, body) {
    const me = this.byToken(meta, token);
    if (!me) return fail('You are not in this room.', 403);
    if (meta.phase !== 'lobby') return fail('The game has already started.', 403);
    const host = this.isHost(meta, token);
    switch (body.op) {
      case 'addAI': {
        if (!host) return fail('Only the host can add tanks.', 403);
        if (meta.players.length >= MAX_PLAYERS) return fail('The room is full (10 tanks).', 403);
        const ai = AI_LEVELS.includes(body.ai) ? body.ai : 'poolshark';
        const name = AI_NAMES.find((n) => !meta.players.some((p) => p.name === n)) || `Bot ${meta.players.length}`;
        meta.players.push({ idx: meta.players.length, id: randomId(), token: null, name, color: this.freeColor(meta), type: 'ai', ai, pushSubs: [] });
        break;
      }
      case 'remove': {
        const p = meta.players[body.idx];
        if (!p) return fail('No such player.');
        if (!host && p.token !== token) return fail('Only the host can remove players.', 403);
        if (p.token === meta.hostToken) return fail('The host cannot be removed. Leave the room instead.');
        meta.players.splice(body.idx, 1);
        this.reindex(meta);
        if (p.token) this.closeSockets(p.id, 'removed');
        break;
      }
      case 'update': {
        const p = meta.players[body.idx];
        if (!p) return fail('No such player.');
        if (!host && p.token !== token) return fail('You can only change your own tank.', 403);
        if (COLORS.includes(body.color)) p.color = body.color;
        if (p.type === 'ai' && AI_LEVELS.includes(body.ai)) p.ai = body.ai;
        if (p.token === token && cleanName(body.name)) p.name = this.uniqueName(meta, cleanName(body.name), token);
        break;
      }
      case 'settings':
        if (!host) return fail('Only the host can change settings.', 403);
        meta.settings = { ...meta.settings, ...sanitizeSettings(body.settings) };
        break;
      default:
        return fail('Unknown lobby operation.');
    }
    await this.save();
    this.broadcast({ t: 'lobby', players: this.publicPlayers(meta), settings: meta.settings });
    return json({ ok: true, room: this.view(meta, token) });
  }

  async leave(meta, token) {
    const me = this.byToken(meta, token);
    if (!me) return json({ ok: true });
    if (meta.phase !== 'lobby') return fail('Hand your tank to the computer instead (menu → leave game).', 403);
    meta.players = meta.players.filter((p) => p !== me);
    this.reindex(meta);
    if (meta.hostToken === token) {
      const next = meta.players.find((p) => p.type === 'human');
      if (!next) {
        await this.ctx.storage.deleteAll();
        this.meta = null;
        this.broadcast({ t: 'closed', reason: 'The host closed the room.' });
        return json({ ok: true, closed: true });
      }
      meta.hostToken = next.token;
    }
    await this.save();
    this.broadcast({ t: 'lobby', players: this.publicPlayers(meta), settings: meta.settings, hostId: meta.players.find((p) => p.token === meta.hostToken)?.id });
    return json({ ok: true });
  }

  async start(meta, token, body) {
    if (!this.isHost(meta, token)) return fail('Only the host can start the game.', 403);
    if (meta.phase !== 'lobby') return fail('The game has already started.', 403);
    if (meta.players.length < 2) return fail('You need at least two tanks.');
    meta.settings = { ...meta.settings, ...sanitizeSettings(body.settings) };
    meta.seed = (typeof body.seed === 'number' && body.seed > 0 ? body.seed : Math.floor(Math.random() * 0xfffffffe) + 1) >>> 0;
    meta.phase = 'playing';
    meta.startPlayers = this.publicPlayers(meta); // roster as the simulation starts; replays build from this
    meta.seq = 0;
    meta.turn = { phase: 'aim', round: 1, current: -1, seq: 0, done: [] };
    meta.notifiedKey = '';
    await this.save();
    const room = this.view(meta, null);
    this.broadcast({ t: 'start', room });
    return json({ ok: true, room: this.view(meta, token) });
  }

  // ------------------------------------------------------------ playing
  async state(meta, token, since) {
    const cmds = [];
    if (meta.phase !== 'lobby' && since < meta.seq) {
      const map = await this.ctx.storage.list({ prefix: 'c:', start: `c:${pad(since + 1)}` });
      for (const v of map.values()) cmds.push(v);
    }
    return json({ room: this.view(meta, token), cmds });
  }

  summary(meta, token) {
    const me = this.byToken(meta, token);
    const t = meta.turn || {};
    const humans = meta.players.filter((p) => p.type === 'human');
    let waitingOn = [];
    if (meta.phase === 'playing') {
      if (t.phase === 'shop') waitingOn = humans.filter((p) => !(t.done || []).includes(p.idx)).map((p) => p.name);
      else if (t.current >= 0 && meta.players[t.current]) waitingOn = [meta.players[t.current].name];
    }
    const yourTurn = !!me && meta.phase === 'playing' && (t.phase === 'shop' ? !(t.done || []).includes(me.idx) : t.current === me.idx);
    return {
      code: meta.code, phase: meta.phase, round: t.round || 0, rounds: meta.settings.rounds || 5, turnPhase: t.phase || null,
      waitingOn, yourTurn, you: me ? me.id : null, players: meta.players.map((p) => p.name), updatedAt: meta.updatedAt,
      host: meta.players.find((p) => p.token === meta.hostToken)?.name || null,
    };
  }

  async command(meta, token, body) {
    if (meta.phase !== 'playing') return fail('The game is not running.', 403);
    const me = this.byToken(meta, token);
    if (!me) return fail('You are not in this game.', 403);
    const cmd = body.cmd;
    if (!cmd || typeof cmd !== 'object' || !COMMANDS.has(cmd.type) || !Number.isInteger(cmd.p)) return fail('Bad command.');
    const target = meta.players[cmd.p];
    if (!target) return fail('Bad player.');
    const host = this.isHost(meta, token);
    if (cmd.type === 'aiTakeover') {
      if (target.idx !== me.idx && !host) return fail('Only the host can hand another tank to the computer.', 403);
      if (target.type !== 'human') return fail('Already a computer.');
      target.type = 'ai';
      target.ai = AI_LEVELS.includes(cmd.level) ? cmd.level : 'poolshark';
      target.wasHuman = true;
    } else if (cmd.type === 'takeover') {
      if (target.idx !== me.idx) return fail('You can only take back your own tank.', 403);
      if (target.type !== 'ai') return fail('Nothing to take back.');
      target.type = 'human';
      cmd.owner = me.id;
    } else if (target.idx !== me.idx) {
      return fail('Not your tank.', 403);
    }
    meta.seq++;
    const entry = { seq: meta.seq, cmd, sum: typeof body.sum === 'number' ? body.sum : null, from: me.id, at: Date.now() };
    await this.ctx.storage.put(`c:${pad(meta.seq)}`, entry);
    await this.save();
    this.broadcast({ t: 'cmd', ...entry });
    return json({ ok: true, seq: meta.seq, entry });
  }

  /** Clients report where the game stands after settling; used for summaries and "your turn" pushes. */
  async turn(meta, token, body) {
    const me = this.byToken(meta, token);
    if (!me || meta.phase !== 'playing') return fail('Not in this game.', 403);
    const h = body.hint || {};
    const hint = {
      phase: ['aim', 'shop', 'gameOver', 'action', 'roundOver'].includes(h.phase) ? h.phase : 'aim',
      round: Number.isInteger(h.round) ? h.round : 0,
      current: Number.isInteger(h.current) ? h.current : -1,
      seq: Number.isInteger(h.seq) ? h.seq : 0,
      done: Array.isArray(h.done) ? h.done.filter(Number.isInteger) : [],
    };
    if (hint.seq < (meta.turn ? meta.turn.seq : 0) || hint.seq > meta.seq) return json({ ok: true, stale: true });
    meta.turn = hint;
    if (hint.phase === 'gameOver') meta.phase = 'over';
    const key = `${hint.seq}:${hint.phase}:${hint.current}:${hint.done.join(',')}`;
    const shouldNotify = key !== meta.notifiedKey && (hint.phase === 'aim' || hint.phase === 'shop');
    if (shouldNotify) meta.notifiedKey = key;
    await this.save();
    if (shouldNotify) {
      let targets = [];
      if (hint.phase === 'aim' && meta.players[hint.current] && meta.players[hint.current].type === 'human') targets = [meta.players[hint.current]];
      else if (hint.phase === 'shop') targets = meta.players.filter((p) => p.type === 'human' && !hint.done.includes(p.idx));
      targets = targets.filter((p) => p !== me);
      if (targets.length) this.ctx.waitUntil(this.notify(meta, targets));
    }
    return json({ ok: true });
  }

  async notify(meta, players) {
    let changed = false;
    for (const p of players) {
      const keep = [];
      for (const sub of p.pushSubs || []) {
        const status = await sendPush(sub, this.env);
        if (status === 404 || status === 410) changed = true;
        else keep.push(sub);
      }
      p.pushSubs = keep;
    }
    if (changed) await this.save();
  }

  async pushSubscribe(meta, token, body) {
    const me = this.byToken(meta, token);
    if (!me) return fail('Not in this room.', 403);
    const sub = body.subscription;
    if (body.remove) {
      me.pushSubs = (me.pushSubs || []).filter((s) => s.endpoint !== (sub && sub.endpoint));
    } else {
      if (!sub || typeof sub.endpoint !== 'string' || !sub.endpoint.startsWith('https://')) return fail('Bad subscription.');
      me.pushSubs = (me.pushSubs || []).filter((s) => s.endpoint !== sub.endpoint);
      me.pushSubs.push({ endpoint: sub.endpoint, keys: sub.keys || {} });
      if (me.pushSubs.length > MAX_PUSH_SUBS) me.pushSubs.shift();
    }
    await this.save();
    return json({ ok: true, count: me.pushSubs.length });
  }

  // ------------------------------------------------------------ sockets
  async openSocket(url) {
    const meta = await this.getMeta();
    if (!meta) return fail('No such room.', 404);
    const token = String(url.searchParams.get('token') || '');
    const me = this.byToken(meta, token);
    if (!me) return fail('Not in this room.', 403);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: me.id });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const att = ws.deserializeAttachment() || {};
    const meta = await this.getMeta();
    if (!meta) return;
    const me = meta.players.find((p) => p.id === att.id);
    if (!me) return;
    switch (msg.t) {
      case 'ping':
        ws.send(JSON.stringify({ t: 'pong', seq: meta.seq, phase: meta.phase }));
        break;
      case 'aim': // cosmetic turret movement for spectators
        if (msg.p === me.idx) this.broadcast({ t: 'aim', p: me.idx, angle: msg.angle, power: msg.power, weapon: msg.weapon }, ws);
        break;
      case 'chat': {
        const text = String(msg.text || '').slice(0, 160);
        if (text) this.broadcast({ t: 'chat', from: me.name, color: me.color, text, at: Date.now() });
        break;
      }
    }
  }

  webSocketClose() { /* hibernation handles cleanup */ }
  webSocketError() { /* ignore */ }

  broadcast(obj, except = null) {
    const s = JSON.stringify(obj);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      try { ws.send(s); } catch { /* closing */ }
    }
  }
  closeSockets(playerId, reason) {
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() || {};
      if (att.id === playerId) {
        try { ws.send(JSON.stringify({ t: 'closed', reason })); ws.close(1000, reason); } catch { /* ignore */ }
      }
    }
  }
}
