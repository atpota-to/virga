// GET /api/defense/lists: the caller's lists, with what is on each by Virga's
// hand and what waits, the people they keep by hand, and whether Virga's
// server will write lists at all.

import { methodGuard, sendJson } from '../../http.js';
import { defenseWritesEnabled } from '../run.js';
import { storeFor } from '../store.js';
import { authorize, requireStore, sendFailure } from '../respond.js';

export function publicList(row) {
  return {
    id: row.id,
    holderDid: row.holder_did,
    mode: row.mode,
    uri: row.uri,
    name: row.name,
    purpose: row.purpose,
    createdAt: row.created_at,
    listed: row.listed ?? 0,
    waiting: row.waiting ?? 0,
    heldUntil: row.held_until ?? null,
    lastError: row.last_error ?? null,
  };
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET'])) return;
  if (!requireStore(res)) return;
  try {
    const did = await authorize(req, res);
    if (!did) return;
    const store = storeFor(did);
    const [lists, kept] = await Promise.all([store.lists(), store.kept()]);
    return sendJson(res, 200, {
      success: true,
      data: {
        lists: lists.map(publicList),
        kept: kept.map((k) => ({ did: k.did, reason: k.reason, addedAt: k.added_at })),
        writes: defenseWritesEnabled(),
      },
    });
  } catch (error) {
    return sendFailure(res, 'defense/lists', error, 'Couldn’t read your lists. Try again in a moment.');
  }
}
