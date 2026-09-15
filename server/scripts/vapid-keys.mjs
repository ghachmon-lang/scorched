// Generates a VAPID key pair for Web Push notifications.
// Usage: npm run keys   (inside server/)
const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
const priv = await crypto.subtle.exportKey('jwk', kp.privateKey);
const b64u = (bytes) => Buffer.from(bytes).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const pub = b64u(raw);
const privJson = JSON.stringify({ kty: priv.kty, crv: priv.crv, x: priv.x, y: priv.y, d: priv.d });
console.log('VAPID key pair generated.\n');
console.log('1. Put the PUBLIC key in wrangler.toml under [vars]:\n');
console.log(`   VAPID_PUBLIC_KEY = "${pub}"\n`);
console.log('2. Store the PRIVATE key as a Worker secret (paste the JSON below when prompted):\n');
console.log('   npx wrangler secret put VAPID_PRIVATE_JWK\n');
console.log(`   ${privJson}\n`);
console.log('3. Set VAPID_SUBJECT in wrangler.toml to a mailto: address you own, then `npx wrangler deploy`.');
