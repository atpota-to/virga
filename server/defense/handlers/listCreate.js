// POST /api/defense/list-create { name, purpose: 'block'|'mute', description? }:
// make a moderation list in the caller's own repo and keep it.

import { methodGuard, readJson, sendJson } from '../../http.js';
import { DESCRIPTION_MAX, ListError, NAME_MAX, createOwnList } from '../lists.js';
import { publicList } from './lists.js';
import { authorize, requireStore, requireWrites, sendFailure, textOrNull } from '../respond.js';

export default async function handler(req, res, deps = {}) {
  if (!methodGuard(req, res, ['POST'])) return;
  if (!requireStore(res) || !requireWrites(res)) return;
  try {
    const did = await authorize(req, res);
    if (!did) return;
    const body = await readJson(req);
    const name = textOrNull(body.name, NAME_MAX);
    const purpose = body.purpose === 'mute' ? 'mute' : body.purpose === 'block' ? 'block' : null;
    if (!name || !purpose) return sendJson(res, 400, { success: false, code: 'INVALID', error: 'A list needs a name and to be for blocking or muting.' });
    const row = await createOwnList({ ownerDid: did, name, purpose, description: textOrNull(body.description, DESCRIPTION_MAX), deps });
    return sendJson(res, 200, { success: true, data: { list: publicList(row) } });
  } catch (error) {
    if (error instanceof ListError) return sendJson(res, error.code === 'SIGNED_OUT' ? 401 : 403, { success: false, code: error.code, error: error.message });
    return sendFailure(res, 'defense/list-create', error, 'Couldn’t make the list. Try again in a moment.');
  }
}
