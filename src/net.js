// Client for the room server (server/): plain HTTPS calls plus one WebSocket
// per open room for live updates. Reconnects with backoff; the app catches up
// on anything missed with state(code, since).
export class RoomClient {
  constructor(server, token) {
    this.server = String(server || '').replace(/\/+$/, '');
    this.token = token;
    this.ws = null;
    this.wsCode = null;
    this.handlers = {};
    this.closed = true;
    this.backoff = 1000;
    this.pingTimer = null;
    this.retryTimer = null;
  }

  async req(path, { method = 'GET', body } = {}) {
    const sep = path.includes('?') ? '&' : '?';
    const url = `${this.server}${path}${sep}token=${encodeURIComponent(this.token)}`;
    let res;
    try {
      res = await fetch(url, {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify({ ...body, token: this.token }) : undefined,
      });
    } catch {
      throw new Error('Could not reach the game server. Check your connection.');
    }
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) throw new Error((data && data.error) || `Server error ${res.status}`);
    return data;
  }

  create({ name, color, settings }) { return this.req('/rooms/create', { method: 'POST', body: { name, color, settings } }).then((d) => d.room); }
  join(code, { name, color }) { return this.req(`/rooms/${code}/join`, { method: 'POST', body: { name, color } }).then((d) => d.room); }
  state(code, since = 0) { return this.req(`/rooms/${code}/state?since=${since}`); }
  summary(code) { return this.req(`/rooms/${code}/summary`); }
  lobby(code, op) { return this.req(`/rooms/${code}/lobby`, { method: 'POST', body: op }).then((d) => d.room); }
  start(code, body) { return this.req(`/rooms/${code}/start`, { method: 'POST', body }).then((d) => d.room); }
  cmd(code, cmd, sum) { return this.req(`/rooms/${code}/cmd`, { method: 'POST', body: { cmd, sum } }); }
  turn(code, hint) { return this.req(`/rooms/${code}/turn`, { method: 'POST', body: { hint } }); }
  push(code, subscription, remove = false) { return this.req(`/rooms/${code}/push`, { method: 'POST', body: { subscription, remove } }); }
  leave(code) { return this.req(`/rooms/${code}/leave`, { method: 'POST', body: {} }); }

  connect(code, handlers) {
    this.disconnect();
    this.wsCode = code;
    this.handlers = handlers || {};
    this.closed = false;
    this.backoff = 1000;
    this.open();
  }

  open() {
    if (this.closed || !this.wsCode) return;
    clearTimeout(this.retryTimer);
    const url = `${this.server.replace(/^http/, 'ws')}/rooms/${this.wsCode}/ws?token=${encodeURIComponent(this.token)}`;
    let ws;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (ws !== this.ws) return;
      this.backoff = 1000;
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => this.send({ t: 'ping' }), 25000);
      if (this.handlers.open) this.handlers.open();
    };
    ws.onmessage = (e) => {
      if (ws !== this.ws) return;
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (this.handlers.message) this.handlers.message(m);
    };
    ws.onclose = () => {
      if (ws !== this.ws) return;
      clearInterval(this.pingTimer);
      this.ws = null;
      if (this.handlers.close) this.handlers.close();
      this.scheduleRetry();
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  scheduleRetry() {
    if (this.closed) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => this.open(), this.backoff);
    this.backoff = Math.min(20000, Math.round(this.backoff * 1.7));
  }

  /** Called when the app returns to the foreground: reconnect right away. */
  wake() {
    if (this.closed || !this.wsCode) return;
    if (!this.ws || this.ws.readyState > 1) {
      this.backoff = 1000;
      this.open();
    }
  }

  get connected() {
    return !!this.ws && this.ws.readyState === 1;
  }

  send(obj) {
    if (this.connected) {
      try { this.ws.send(JSON.stringify(obj)); } catch { /* ignore */ }
    }
  }

  disconnect() {
    this.closed = true;
    clearInterval(this.pingTimer);
    clearTimeout(this.retryTimer);
    if (this.ws) {
      const ws = this.ws;
      this.ws = null;
      ws.onclose = null;
      try { ws.close(); } catch { /* ignore */ }
    }
    this.wsCode = null;
  }
}
