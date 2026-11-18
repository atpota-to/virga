// POST /api/defense/link-list { listId | null }: the list the moderator's
// "block @someone" adds to. Only one of the caller's own lists.

import { methodGuard, readJson, sendJson } from '../../http.js';
import { storeFor } from '../store.js';
import { authorize, requireStore, sendFailure, uuidOrNull } from '../respond.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;
  if (!requireStore(res)) return;
  try {
    const owner = await authorize(req, res);
    if (!owner) return;
    const body = await readJson(req);
    const listId = body.listId == null ? null : uuidOrNull(body.listId);
    if (body.listId != null && !listId) return sendJson(res, 400, { success: false, code: 'INVALID', error: 'That isn’t a list.' });
    const ok = await storeFor(owner).setLinkList(listId);
    if (!ok) return sendJson(res, 404, { success: false, code: 'NOT_FOUND', error: 'That list isn’t one of yours.' });
    return sendJson(res, 200, { success: true, data: { listId } });
  } catch (error) {
    return sendFailure(res, 'defense/link-list', error, 'Couldn’t choose that list. Try again in a moment.');
  }
}
