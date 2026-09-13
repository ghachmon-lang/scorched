// Thin wrapper around PeerJS (WebRTC data channels). One peer hosts a room;
// everyone else connects to the host, which relays sequenced commands.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PREFIX = 'scorched-earth-';

export function makeRoomCode(len = 4) {
  let s = '';
  const a = new Uint32Array(len);
  if (globalThis.crypto && crypto.getRandomValues) crypto.getRandomValues(a);
  else for (let i = 0; i < len; i++) a[i] = Math.floor(Math.random() * 1e9);
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[a[i] % CODE_ALPHABET.length];
  return s;
}

export function normalizeCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/O/g, '0').replace(/I/g, '1').slice(0, 8);
}

export class Net {
  constructor(peerPrefs = {}) {
    this.peerPrefs = peerPrefs;
    this.peer = null;
    this.conns = new Map(); // peerId -> DataConnection (host side)
    this.hostConn = null; // client side
    this.isHost = false;
    this.id = null;
    this.handlers = new Map();
    this.closed = false;
  }

  on(type, fn) {
    this.handlers.set(type, fn);
    return this;
  }
  emit(type, ...args) {
    const fn = this.handlers.get(type);
    if (fn) fn(...args);
  }

  peerOptions() {
    const p = this.peerPrefs || {};
    const opts = {
      debug: 0,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      },
    };
    if (p.host) {
      opts.host = p.host;
      if (p.port) opts.port = Number(p.port);
      if (p.path) opts.path = p.path;
      opts.secure = p.secure !== false;
    }
    if (p.key) opts.key = p.key;
    if (p.iceServers && Array.isArray(p.iceServers) && p.iceServers.length) opts.config.iceServers = p.iceServers;
    return opts;
  }

  static available() {
    return typeof window !== 'undefined' && typeof window.Peer === 'function';
  }

  host(code) {
    this.isHost = true;
    return new Promise((resolve, reject) => {
      const peer = new window.Peer(PREFIX + code, this.peerOptions());
      this.peer = peer;
      let settled = false;
      peer.on('open', (id) => {
        this.id = id;
        settled = true;
        resolve(id);
      });
      peer.on('connection', (conn) => this.wire(conn));
      peer.on('error', (err) => {
        if (!settled) {
          settled = true;
          reject(err);
        } else this.emit('error', err);
      });
      peer.on('disconnected', () => {
        if (!this.closed) {
          try { peer.reconnect(); } catch { /* ignore */ }
        }
      });
    });
  }

  join(code) {
    this.isHost = false;
    return new Promise((resolve, reject) => {
      const peer = new window.Peer(this.peerOptions());
      this.peer = peer;
      let settled = false;
      const fail = (err) => {
        if (!settled) {
          settled = true;
          reject(err);
        } else this.emit('error', err);
      };
      peer.on('open', (id) => {
        this.id = id;
        const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' });
        this.hostConn = conn;
        const timer = setTimeout(() => fail(new Error('Could not reach the host. Check the room code and that the host is still on the lobby screen.')), 15000);
        conn.on('open', () => {
          clearTimeout(timer);
          settled = true;
          this.wire(conn);
          resolve(id);
        });
        conn.on('error', (e) => { clearTimeout(timer); fail(e); });
      });
      peer.on('error', fail);
      peer.on('disconnected', () => {
        if (!this.closed) {
          try { peer.reconnect(); } catch { /* ignore */ }
        }
      });
    });
  }

  wire(conn) {
    const id = conn.peer;
    const ready = () => {
      this.conns.set(id, conn);
      this.emit('open', conn);
    };
    if (conn.open) ready();
    else conn.on('open', ready);
    conn.on('data', (data) => this.emit('message', conn, data));
    conn.on('close', () => {
      this.conns.delete(id);
      this.emit('close', conn);
    });
    conn.on('error', (err) => this.emit('connError', conn, err));
  }

  send(conn, msg) {
    try {
      if (conn && conn.open) conn.send(msg);
    } catch (e) {
      this.emit('error', e);
    }
  }
  sendHost(msg) {
    this.send(this.hostConn, msg);
  }
  broadcast(msg, except = null) {
    for (const c of this.conns.values()) if (c !== except) this.send(c, msg);
  }

  close() {
    this.closed = true;
    try {
      for (const c of this.conns.values()) c.close();
      if (this.hostConn) this.hostConn.close();
      if (this.peer) this.peer.destroy();
    } catch { /* ignore */ }
    this.conns.clear();
    this.peer = null;
  }
}
