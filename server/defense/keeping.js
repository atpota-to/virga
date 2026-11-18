// The two handlers for the people kept by hand (keep.js, unkeep.js):
// POST /api/defense/keep { did, reason? } keeps an account off every list;
// POST /api/defense/unkeep { did } stops keeping it.

import { methodGuard, readJson, sendJson } from '../http.js';
import { storeFor } from './store.js';
import { authorize, didOrNull, requireStore, sendFailure, textOrNull } from './respond.js';

export function keeper(unkeep) {
  return async function handler(req, res) {
    if (!methodGuard(req, res, ['POST'])) return;
    if (!requireStore(res)) return;
    try {
      const owner = await authorize(req, res);
      if (!owner) return;
      const body = await readJson(req);
      const did = didOrNull(body.did);
      if (!did) return sendJson(res, 400, { success: false, code: 'INVALID', error: 'That isn’t an account’s DID.' });
      const store = storeFor(owner);
      if (unkeep) {
        await store.unkeep(did);
        return sendJson(res, 200, { success: true, data: { did } });
      }
      const row = await store.keep(did, textOrNull(body.reason, 200) || 'kept by hand');
      return sendJson(res, 200, { success: true, data: { did: row.did, reason: row.reason, addedAt: row.added_at } });
    } catch (error) {
      return sendFailure(res, unkeep ? 'defense/unkeep' : 'defense/keep', error, 'Couldn’t change who you keep. Try again in a moment.');
    }
  };
}

