// Re-packing the weekly queue after a drag. The order is drawn from the rows
// this app may move; every other queued row keeps its minute and the re-pack
// steps around it (recomputeQueueAssignment's `occupied`). Pure.

import { MIN_LEAD_MS, recomputeQueueAssignment } from './postingQueue.js';
import {
  scheduledRowDeadlineStatus,
  scheduledRowTimerProblem,
} from '../timers/selfDestruct.js';

/** The client Virga's rows carry in cocoon's `clientKey`. */
export const VIRGA_CLIENT_KEY = 'virga';

const instant = (value) => (value ? new Date(value).getTime() : NaN);

/**
 * The account's queued rows, split into what this app may move (its own,
 * pending, none of a thread out yet, its time still ahead; soonest first) and
 * what it may not (every other queued row, whatever its client or state,
 * which still holds its minute). Rows without a `clientKey` are never moved:
 * a row this app can't show it owns is someone else's.
 *
 * A pending row whose time is no later than the first slot a re-pack can
 * hand out (`now` + MIN_LEAD_MS) is due, or waiting out a retry after a
 * failed attempt. It stays where it is: re-packing would give it the next
 * future slot, delaying it by a slot and pushing every row behind it back
 * one, and cocoon's reorder would also clear its retry time.
 */
export function splitQueueRows(
  rows = [],
  { clientKey = VIRGA_CLIENT_KEY, now = Date.now() } = {},
) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const movable = [];
  const occupied = [];
  for (const row of rows || []) {
    if (!row?.queued) continue;
    const at = instant(row.scheduledFor);
    const due = Number.isFinite(nowMs) && at <= nowMs + MIN_LEAD_MS;
    const mine =
      row.clientKey === clientKey &&
      row.status === 'pending' &&
      !row.partial &&
      !due;
    (mine ? movable : occupied).push(row);
  }
  movable.sort((a, b) => instant(a.scheduledFor) - instant(b.scheduledFor));
  return { movable, occupied };
}

/**
 * The moves an assignment makes: only rows whose instant changed, compared
 * as instants (cocoon writes `+00:00`, toISOString writes `Z`). A row pushed
 * past the horizon (null) isn't moved.
 */
export function pendingMoves(assignment) {
  return (assignment || [])
    .filter(
      (a) =>
        a?.newScheduledFor &&
        instant(a.oldScheduledFor) !== instant(a.newScheduledFor),
    )
    .map((a) => ({ id: a.id, scheduledFor: a.newScheduledFor }));
}

function nameOf(row) {
  const text = String(row?.payload?.posts?.[0]?.record?.text || '')
    .replace(/\s+/g, ' ')
    .trim();
  return text
    ? `“${text.length > 40 ? `${text.slice(0, 40).trimEnd()}…` : text}”`
    : 'One of these posts';
}

/**
 * The first row an assignment would move past its pinned delete time (or
 * more than 30 days before it, which cocoon can't hold), with what to say;
 * else null. Checked before the new order is drawn, so an order that can't be
 * saved is never shown.
 *
 * @returns {{ id: string, message: string, problem: string } | null}
 */
export function queueTimerConflict(rows, assignment) {
  const byId = Object.fromEntries((rows || []).map((r) => [r.id, r]));
  for (const move of pendingMoves(assignment)) {
    const row = byId[move.id];
    const problem = scheduledRowTimerProblem(row, move.scheduledFor);
    if (!problem) continue;
    const name = nameOf(row);
    const message =
      scheduledRowDeadlineStatus(row, move.scheduledFor) === 'tooLate'
        ? `${name} has a delete time more than 30 days after the slot this order would give it, so the order wasn’t changed. Edit the post to pick an earlier delete time or a length, then try again.`
        : `${name} has a delete time this order would move it past, so the order wasn’t changed. Edit the post to pick a later delete time or a length, then try again.`;
    return { id: move.id, message, problem };
  }
  return null;
}

/**
 * Everything a drag needs, from the list and the new order of this app's
 * rows: `{ assignment, moves, conflict }`. One `now` for the whole operation,
 * since slots computed twice against different clocks can shift every row by
 * one.
 *
 * @param {object} schedule - the weekly template
 * @param {object[]} rows - listScheduled's `rows`
 * @param {string[]} orderedIds - the movable rows' ids in their new order
 */
export function planQueueReorder(schedule, rows, orderedIds, now = new Date()) {
  const { movable, occupied } = splitQueueRows(rows, { now });
  const byId = new Map(movable.map((r) => [r.id, r]));
  const ordered = (orderedIds || []).map((id) => byId.get(id)).filter(Boolean);
  // A movable row the new order forgot keeps its place at the end, rather
  // than being left on a minute another row may now be given.
  for (const row of movable) if (!ordered.includes(row)) ordered.push(row);
  const assignment = recomputeQueueAssignment(schedule, ordered, now, {
    occupied,
  });
  return {
    assignment,
    moves: pendingMoves(assignment),
    conflict: queueTimerConflict(rows, assignment),
  };
}
