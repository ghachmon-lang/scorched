import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vapidAuthorization, b64u } from '../src/push.js';

test('VAPID authorization header carries a valid ES256 JWT', async () => {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const pub = b64u(await crypto.subtle.exportKey('raw', kp.publicKey));
  const priv = await crypto.subtle.exportKey('jwk', kp.privateKey);
  const auth = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', pub, { kty: priv.kty, crv: priv.crv, x: priv.x, y: priv.y, d: priv.d }, 'mailto:test@example.com');
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(auth);
  assert.ok(m, auth);
  assert.equal(m[2], pub);
  const [h, c, s] = m[1].split('.');
  const dec = (x) => Buffer.from(x.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  assert.deepEqual(JSON.parse(dec(h)), { typ: 'JWT', alg: 'ES256' });
  const claims = JSON.parse(dec(c));
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.sub, 'mailto:test@example.com');
  assert.ok(claims.exp > Date.now() / 1000);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, kp.publicKey, dec(s), new TextEncoder().encode(`${h}.${c}`));
  assert.ok(ok, 'signature verifies with the public key');
});
