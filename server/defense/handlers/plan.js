// POST /api/defense/plan { listId, postUri?, rows: [{ did, band, trust }], totals? }:
// store what a scan proposed for one of the caller's lists. Nothing is queued
// until it is approved (approve.js). A plan holds DIDs, bands and trust keys
// only; a row in a band no plan may hold (PROTECTED) refuses the whole plan.

import { methodGuard, readJson, sendJson } from '../../http.js';
import { APPROVABLE_BANDS, PLAN_MAX } from '../../../src/defense/plan.js';
import { storeFor } from '../store.js';
import { authorize, didOrNull, requireStore, sendFailure, uuidOrNull } from '../respond.js';

/** The rows of a plan as the store takes them, or a reason they can't be. */
export function readRows(raw) {
  if (!Array.isArray(raw) || !raw.length) return { error: 'A plan needs at least one account.' };
  if (raw.length > PLAN_MAX) return { error: `A plan holds at most ${PLAN_MAX.toLocaleString('en')} accounts.` };
  const seen = new Set();
  const rows = [];
  for (const r of raw) {
    const did = didOrNull(r?.did);
    if (!did) return { error: 'A plan’s rows must each name an account by its DID.' };
    if (!APPROVABLE_BANDS.includes(r.band)) return { error: 'A plan can’t hold anyone protected, or a band it doesn’t know.' };
    const trust = Number.isInteger(r.trust) && r.trust >= 0 && r.trust <= 100 ? r.trust : null;
    if (seen.has(did)) continue;
    seen.add(did);
    rows.push({ did, band: r.band, trust });
  }
  return { rows };
}

const COUNT_KEYS = ['participants', 'PROTECTED', 'CONNECTED', 'PERIPHERAL', 'NOTABLE', 'UNKNOWN'];

/** The plan's totals, numbers only. */
function readTotals(raw) {
  const out = {};
  for (const k of COUNT_KEYS) if (Number.isInteger(raw?.[k]) && raw[k] >= 0) out[k] = raw[k];
  return out;
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;
  if (!requireStore(res)) return;
  try {
    const owner = await authorize(req, res);
    if (!owner) return;
    const body = await readJson(req);
    const listId = uuidOrNull(body.listId);
    if (!listId) return sendJson(res, 400, { success: false, code: 'INVALID', error: 'Which list is this plan for?' });
    const postUri = typeof body.postUri === 'string' && /^at:\/\/did:[a-z]+:[a-zA-Z0-9._:%-]+\/app\.bsky\.feed\.post\/[a-zA-Z0-9._:~-]+$/.test(body.postUri) ? body.postUri : null;
    const { rows, error } = readRows(body.rows);
    if (error) return sendJson(res, 400, { success: false, code: 'INVALID', error });
    const planId = await storeFor(owner).createPlan({ listId, postUri, rows, totals: readTotals(body.totals) });
    if (!planId) return sendJson(res, 404, { success: false, code: 'NO_LIST', error: 'That list isn’t one of yours, or isn’t kept any more.' });
    return sendJson(res, 200, { success: true, data: { planId, rows: rows.length } });
  } catch (error) {
    return sendFailure(res, 'defense/plan', error, 'Couldn’t keep that plan. Try again in a moment.');
  }
}
