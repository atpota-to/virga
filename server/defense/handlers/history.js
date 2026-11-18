// GET /api/defense/history[?before=<id>&limit=<n>&list=<id>]: the caller's
// decisions, newest first, and the plans they came from.

import { methodGuard, sendJson } from '../../http.js';
import { storeFor } from '../store.js';
import { authorize, requireStore, sendFailure, uuidOrNull } from '../respond.js';
import { queryParam } from '../../oauth/respond.js';

export function publicDecision(d) {
  return {
    id: Number(d.id),
    listId: d.list_id,
    planId: d.plan_id,
    did: d.subject_did,
    action: d.action,
    band: d.band,
    trust: d.trust,
    via: d.via,
    note: d.note,
    state: d.state,
    reason: d.reason,
    createdAt: d.created_at,
    actedAt: d.acted_at,
    undoneAt: d.undone_at,
    undoes: d.undoes == null ? null : Number(d.undoes),
  };
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET'])) return;
  if (!requireStore(res)) return;
  try {
    const owner = await authorize(req, res);
    if (!owner) return;
    const before = Number(queryParam(req, 'before'));
    const limit = Number(queryParam(req, 'limit'));
    const store = storeFor(owner);
    const [decisions, plans] = await Promise.all([
      store.history({
        before: Number.isSafeInteger(before) && before > 0 ? before : null,
        limit: Number.isInteger(limit) && limit > 0 ? limit : 200,
        listId: uuidOrNull(queryParam(req, 'list')),
      }),
      store.plans(),
    ]);
    return sendJson(res, 200, {
      success: true,
      data: {
        decisions: decisions.map(publicDecision),
        plans: plans.map((p) => ({ id: p.id, listId: p.list_id, postUri: p.post_uri, createdAt: p.created_at, approvedAt: p.approved_at, bands: p.approved_bands, note: p.note, totals: p.totals })),
      },
    });
  } catch (error) {
    return sendFailure(res, 'defense/history', error, 'Couldn’t read the history. Try again in a moment.');
  }
}
