// POST /api/defense/approve { planId, bands: [...], note? }: approve bands of
// one of the caller's plans. Everyone in them is queued to be added, except
// the people kept by hand and anyone the list already has; the run route
// writes them, with the veto read again at the write.

import { methodGuard, readJson, sendJson } from '../../http.js';
import { APPROVABLE_BANDS, NOTE_MAX } from '../../../src/defense/plan.js';
import { storeFor } from '../store.js';
import { authorize, requireStore, requireWrites, sendFailure, textOrNull, uuidOrNull } from '../respond.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;
  if (!requireStore(res) || !requireWrites(res)) return;
  try {
    const owner = await authorize(req, res);
    if (!owner) return;
    const body = await readJson(req);
    const planId = uuidOrNull(body.planId);
    const bands = Array.isArray(body.bands) ? [...new Set(body.bands.filter((b) => APPROVABLE_BANDS.includes(b)))] : [];
    if (!planId || !bands.length) return sendJson(res, 400, { success: false, code: 'INVALID', error: 'Approve a plan by naming at least one band.' });
    const out = await storeFor(owner).approvePlan(planId, { bands, note: textOrNull(body.note, NOTE_MAX), via: 'web' });
    if (!out) return sendJson(res, 404, { success: false, code: 'NO_PLAN', error: 'That plan isn’t yours, has expired, or its list is gone.' });
    return sendJson(res, 200, { success: true, data: { jobId: out.job_id, queued: out.queued, kept: out.kept, already: out.already } });
  } catch (error) {
    return sendFailure(res, 'defense/approve', error, 'Couldn’t approve that plan. Try again in a moment.');
  }
}
