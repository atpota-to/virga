#!/usr/bin/env node
// Prints a new ES256 private key (a P-256 JWK) for the confidential OAuth
// client, as the value of OAUTH_PRIVATE_KEY_1.
//
//   node scripts/generate-oauth-key.js
//
// The library signs its client assertions with ES256 (private_key_jwt). The
// JWK has no `use`: the library warns that it will refuse one. Set the value
// in Vercel for Production only: a preview without a key answers 503 and the
// app stays in browser mode, which keeps previews from becoming separate
// OAuth clients.
//
// Rotating: new sign-ins sign with the key in slot 1, and a session signs its
// refreshes with the key it signed in with for as long as it lives. So move
// the current key, unchanged, to OAUTH_PRIVATE_KEY_2 and put the new one in
// OAUTH_PRIVATE_KEY_1, then deploy. The old key can go only once every
// account that signed in with it has signed in again; removing it sooner signs
// those accounts out of the server and stops their scheduled posts and timers.
// The kid printed here is what sessions store, so never edit it.

import crypto from 'node:crypto';

const { privateKey } = crypto.generateKeyPairSync('ec', {
  namedCurve: 'P-256',
});
const jwk = privateKey.export({ format: 'jwk' });
jwk.kid = `key-${Date.now()}`;
jwk.alg = 'ES256';

const value = JSON.stringify(jwk);

if (process.argv.includes('--raw')) {
  process.stdout.write(`${value}\n`);
} else {
  console.log(
    "A new ES256 key for the OAuth client. Keep it secret: anyone holding it can act as Virga's server.\n",
  );
  console.log(`OAUTH_PRIVATE_KEY_1=${value}\n`);
  console.log(`kid: ${jwk.kid}`);
  console.log(
    'Add it in Vercel (Settings > Environment Variables, Production only), or:',
  );
  console.log('  vercel env add OAUTH_PRIVATE_KEY_1 production');
}
