// GET /api/oauth/client-metadata.json: the confidential client's metadata, at
// the URL that is its client_id. Authorization servers fetch it again for the
// life of every session, so it is never cached.

import { methodGuard, sendJson } from '../../http.js';
import {
  clientMetadata,
  sendUnavailable,
  unavailableReason,
} from '../config.js';
import { sendJsonCached } from '../respond.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET'])) return undefined;

  const unavailable = unavailableReason();
  if (unavailable) return sendUnavailable(res, unavailable);

  try {
    return sendJsonCached(
      res,
      200,
      clientMetadata(),
      'no-store, no-cache, must-revalidate',
    );
  } catch (error) {
    console.error(`[oauth/client-metadata] ${error?.message || error}`);
    return sendJson(res, 500, {
      error: 'server_error',
      error_description: error?.message || 'Internal error',
    });
  }
}
