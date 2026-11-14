// GET /api/oauth/jwks.json: the public half of the client's signing keys (the
// metadata's jwks_uri).

import { methodGuard } from '../../http.js';
import { getOAuthClient } from '../client.js';
import { sendUnavailable, unavailableReason } from '../config.js';
import { sendJsonCached } from '../respond.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET'])) return undefined;

  const unavailable = unavailableReason();
  if (unavailable) return sendUnavailable(res, unavailable);

  try {
    const jwks = await getOAuthClient().getJWKS();
    return sendJsonCached(res, 200, jwks, 'public, max-age=3600');
  } catch (error) {
    // A key that doesn't load stops the client from starting: the same "not
    // available" the other routes give.
    return sendUnavailable(
      res,
      error?.message || 'the OAuth client could not start',
    );
  }
}
