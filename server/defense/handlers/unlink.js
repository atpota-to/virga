// POST /api/defense/unlink: the moderator stops answering the caller.

import { methodGuard, sendJson } from '../../http.js';
import { storeFor } from '../store.js';
import { authorize, requireStore, sendFailure, requireModerator } from '../respond.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;
  if (!requireModerator(res) || !requireStore(res)) return;
  try {
    const owner = await authorize(req, res);
    if (!owner) return;
    await storeFor(owner).unlink();
    return sendJson(res, 200, { success: true, data: { linked: false } });
  } catch (error) {
    return sendFailure(res, 'defense/unlink', error, 'Couldn’t unlink the moderator. Try again in a moment.');
  }
}
