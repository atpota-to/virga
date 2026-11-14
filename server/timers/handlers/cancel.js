// POST /api/self-destruct/cancel  { id }
//
// Call off a timer, leaving the post where it is. Accepts an armed timer or one
// that gave up (dismissing a failed timer is this same call); a timer already
// mid-check is left alone, because its delete may be in flight.
//
// There is no "the post is already gone" form, and none is needed: the worker
// finds that out for itself. A conditional timer sees the post missing from
// the AppView's answer and retires, and an unconditional one runs a
// deleteRecord that is a no-op on a record that isn't there.

import { methodGuard, readJson, sendJson } from '../../http.js';
import { resolveUserDid } from '../../oauth/auth.js';
import { cancelSelfDestruct } from '../selfDestruct.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NOT_CANCELLABLE = {
  success: false,
  error: 'that timer is no longer waiting. it is running now, or it has already settled.',
  code: 'NOT_CANCELLABLE',
};

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;

  try {
    const auth = await resolveUserDid(req);
    if (!auth.userDid) {
      return sendJson(res, auth.status, { success: false, error: auth.error, ...(auth.code ? { code: auth.code } : {}) });
    }

    const body = await readJson(req);
    const raw = body.id ?? req.query?.id;
    const id = typeof raw === 'string' ? raw.trim() : raw;
    if (!id) return sendJson(res, 400, { success: false, error: 'Missing id' });
    // An id that isn't a UUID names no timer; asking Postgres would only turn
    // it into a type error and a 500.
    if (typeof id !== 'string' || !UUID.test(id)) return sendJson(res, 409, NOT_CANCELLABLE);

    const row = await cancelSelfDestruct(id, auth.userDid);
    // Not owned, not found, or in a status that isn't touched: checking (the
    // delete may be in flight), or already settled.
    if (!row) return sendJson(res, 409, NOT_CANCELLABLE);
    return sendJson(res, 200, { success: true, data: { id: row.id, status: row.status } });
  } catch (error) {
    if (error.code === 'UNAVAILABLE') {
      return sendJson(res, 503, { success: false, error: error.message, code: 'UNAVAILABLE' });
    }
    console.error('[self-destruct/cancel] failed:', error?.message || error);
    return sendJson(res, 500, {
      success: false,
      error: "couldn't call off that timer. please try again.",
      code: 'INTERNAL',
    });
  }
}
