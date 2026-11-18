// POST /api/defense/undo { planId? , ids?: [decision ids], note? }: take back
// adds. Those not sent yet are cancelled; those written get a removal under
// the key the add used, which the run route writes. Not stopped by
// DEFENSE_WRITES being off: cancelling writes nothing, and what is cancelled
// then can't go out when writes come back.

import { methodGuard, readJson, sendJson } from '../../http.js';
import { NOTE_MAX } from '../../../src/defense/plan.js';
import { storeFor } from '../store.js';
import { authorize, requireStore, sendFailure, textOrNull, uuidOrNull } from '../respond.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;
  if (!requireStore(res)) return;
  try {
    const owner = await authorize(req, res);
    if (!owner) return;
    const body = await readJson(req);
    const planId = uuidOrNull(body.planId);
    const ids = Array.isArray(body.ids) ? body.ids.filter((n) => Number.isSafeInteger(n) && n > 0).slice(0, 1000) : [];
    if (!planId && !ids.length) return sendJson(res, 400, { success: false, code: 'INVALID', error: 'Undo needs a plan or the decisions to take back.' });
    const out = await storeFor(owner).undo({ planId, ids: ids.length ? ids : null, note: textOrNull(body.note, NOTE_MAX), via: 'web' });
    return sendJson(res, 200, { success: true, data: { jobId: out?.job_id ?? null, cancelled: out?.cancelled ?? 0, queued: out?.queued ?? 0 } });
  } catch (error) {
    return sendFailure(res, 'defense/undo', error, 'Couldn’t undo that. Try again in a moment.');
  }
}
