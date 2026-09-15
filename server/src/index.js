// Worker entry point: routes /rooms/<CODE>/... to the room's Durable Object.
export { Room } from './room.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Max-Age': '86400',
};
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeCode(len = 4) {
  const a = new Uint32Array(len);
  crypto.getRandomValues(a);
  let s = '';
  for (let i = 0; i < len; i++) s += ALPHABET[a[i] % ALPHABET.length];
  return s;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...CORS } });
}

function withCors(res) {
  if (res.status === 101) return res;
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) h.set(k, v);
  return new Response(res.body, { status: res.status, headers: h });
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'rooms') {
      return json({ name: 'Scorched Earth room server', ok: true, push: !!(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_JWK) });
    }
    if (parts[1] === 'create') {
      if (req.method !== 'POST') return json({ error: 'POST required' }, 405);
      const body = await req.text();
      for (let i = 0; i < 8; i++) {
        const code = makeCode(i < 4 ? 4 : 5);
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        const res = await stub.fetch(new Request(`${url.origin}/rooms/${code}/create`, { method: 'POST', headers: { 'content-type': 'application/json' }, body }));
        if (res.status !== 409) return withCors(res);
      }
      return json({ error: 'Could not allocate a room code, try again.' }, 503);
    }
    const code = String(parts[1] || '').toUpperCase();
    if (!/^[A-Z0-9]{4,8}$/.test(code)) return json({ error: 'Bad room code.' }, 400);
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    const target = new URL(req.url);
    target.pathname = `/rooms/${code}/${parts.slice(2).join('/')}`;
    const res = await stub.fetch(new Request(target.toString(), req));
    return withCors(res);
  },
};
