// Web Push with VAPID authentication, using only WebCrypto (no Node deps).
// We send pushes without a payload, so no message encryption is needed: the
// service worker wakes up, asks the server what changed, and shows the
// notification itself.
const enc = new TextEncoder();

export function b64u(bytes) {
  let s = '';
  const a = new Uint8Array(bytes);
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function vapidAuthorization(endpoint, publicKey, privateJwk, subject) {
  const aud = new URL(endpoint).origin;
  const header = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', { ...privateJwk, key_ops: ['sign'], ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${publicKey}`;
}

/**
 * Send an empty push to one subscription. Resolves to the HTTP status
 * (201 = accepted, 404/410 = subscription is dead and should be dropped),
 * or 0 when push is not configured.
 */
export async function sendPush(subscription, env) {
  if (!env.VAPID_PRIVATE_JWK || !env.VAPID_PUBLIC_KEY || !subscription || !subscription.endpoint) return 0;
  let privJwk;
  try {
    privJwk = JSON.parse(env.VAPID_PRIVATE_JWK);
  } catch {
    return 0;
  }
  const auth = await vapidAuthorization(subscription.endpoint, env.VAPID_PUBLIC_KEY, privJwk, env.VAPID_SUBJECT || 'mailto:admin@example.com');
  try {
    const res = await fetch(subscription.endpoint, {
      method: 'POST',
      headers: { Authorization: auth, TTL: '86400', Urgency: 'normal', 'Content-Length': '0' },
    });
    return res.status;
  } catch {
    return 0;
  }
}
