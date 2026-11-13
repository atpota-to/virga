// GET|POST /api/self-destruct/run: the post-timer worker.
//
// Invoked by Vercel Cron every minute (vercel.json `crons`). Each run:
//   1. Reclaims timers stuck in 'checking' (a previous worker died mid-check).
//   2. Atomically claims a batch of due 'armed' timers (FOR UPDATE SKIP LOCKED,
//      so overlapping runs never evaluate the same row twice).
//   3. Reads engagement for the conditional ones in ONE AppView call.
//   4. Acts on each post on its author's PDS, keeps it, or hands it its window
//      again, whichever the author's conditions say. A few rows at a time,
//      inside a wall-clock budget: a row the budget cuts short (not started in
//      time, or stopped between batches of a long thread) goes back in the
//      queue without spending an attempt, its progress pinned.
//
// A separate function from the scheduled-posts worker on purpose: together, a
// PDS that is slow to publish could eat the budget a deletion needed, which is
// the wrong way round. A post that goes out late is a nuisance; a post that
// stays up past the hour its author gave it is what this feature exists to
// prevent.
//
// Guarded by CRON_SECRET (server/cron.js), the same as the scheduled-posts worker.

import { randomUUID } from 'node:crypto';
import { requireCron } from '../../cron.js';
import { methodGuard, sendJson } from '../../http.js';
import {
  claimDueSelfDestructs,
  classifyFailure,
  fetchEngagement,
  hasClauses,
  markFailedOrRetry,
  pinnedVerdict,
  reclaimStuck,
  requeueUnspent,
  resolveSelfDestruct,
} from '../selfDestruct.js';

// Matches the AppView's per-call URI cap, so one getPosts covers the batch.
const CLAIM_LIMIT = 25;
// How many claimed rows are worked at once. Each one can have fifteen requests
// in flight while it deletes a thread (THREAD_DELETE_CONCURRENCY), so the whole
// claim at once would be hundreds of sockets from one function, and with every
// row started in the first second, "stop starting new rows" would have nothing
// to stop.
const ROW_CONCURRENCY = 8;
// The function has 60 seconds (vercel.json maxDuration) and is killed at the
// end of them mid-request, which leaves rows in 'checking' for the reclaim to
// find three minutes later, with an attempt spent on each. So the run budgets
// itself. Past START_BUDGET_MS no new row is started: the rest go back in the
// queue untouched and unspent, first in line next minute. Past WORK_BUDGET_MS a
// deletion in progress starts no new batch: the row is put back with what it
// deleted pinned, also without spending an attempt, and finishes on the next
// run. The last ten seconds are for the batch already in flight and the
// bookkeeping after it.
const START_BUDGET_MS = 40 * 1000;
const WORK_BUDGET_MS = 50 * 1000;
// A live worker can't hold a lock past its maxDuration, so three minutes is
// clear of a check in flight while keeping a timed-out row's delay short.
const STUCK_AFTER_SECONDS = 180;
// What the reader sees when a timer is retired for running past its attempts
// without ever reporting a failure of its own. Must equal the sentence the
// reclaim RPC writes for the same case (reclaim_stuck_self_destructs).
export const TIMED_OUT_ERROR = 'the timer ran out of time before this post could be checked.';

/**
 * Read the counts for every claimed row whose conditions need them, in one
 * call. Returns a Map, or null when the read failed, and the difference
 * matters: an empty Map says "the AppView answered and none of these posts
 * exist", while null says "we do not know", and only the first is grounds for
 * concluding anything about a post.
 */
export async function readEngagement(rows) {
  const uris = rows.filter((row) => hasClauses(row.conditions)).map((row) => row.post_uri);
  if (uris.length === 0) return new Map();
  try {
    return await fetchEngagement(uris);
  } catch (err) {
    console.warn(`[self-destruct/run] engagement read failed: ${err.message}`);
    return null;
  }
}

/**
 * allSettled, but at most `limit` at a time. A slot frees up as each item
 * finishes, so one long thread holds one lane rather than the whole batch.
 * Never rejects; every item gets a settled result in its own position.
 */
export async function settleWithLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      try {
        results[i] = { status: 'fulfilled', value: await fn(items[i]) };
      } catch (reason) {
        results[i] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
  return results;
}

export default async function handler(req, res) {
  // Before anything else: the budgets below are measured from here, because
  // the platform's sixty seconds are.
  const startedAt = Date.now();
  if (!methodGuard(req, res, ['GET', 'POST'])) return;
  if (!requireCron(req, res)) return;

  const runId = randomUUID();
  const summary = {
    runId, reclaimed: 0, claimed: 0,
    // 'acted' is a rule that fired without deleting: a gate went on and the
    // post is still up. 'deferred' is a row put back unspent because this
    // run's time budget ran out, before it started or partway through
    // deleting its thread.
    deleted: 0, acted: 0, spared: 0, extended: 0, gone: 0, deferred: 0, retried: 0, failed: 0,
    errors: [],
  };
  const startBy = startedAt + START_BUDGET_MS;
  const deadline = startedAt + WORK_BUDGET_MS;

  try {
    // 1. Reclaim rows a crashed prior run left mid-check.
    summary.reclaimed = await reclaimStuck(STUCK_AFTER_SECONDS);

    // 2. Claim a batch of due rows.
    const rows = await claimDueSelfDestructs(runId, CLAIM_LIMIT);
    summary.claimed = rows.length;

    // A row claimed past its attempt budget was killed mid-check and
    // reclaimed, so it never reached markFailedOrRetry, the only place
    // attempts are checked. Retire it through that same path so it stops
    // cycling. Strictly greater than: markFailedOrRetry treats
    // attempts >= max_attempts as exhausted after consuming that attempt.
    const spent = rows.filter((row) => row.attempts > row.max_attempts);
    const live = rows.filter((row) => row.attempts <= row.max_attempts);
    for (const row of spent) {
      try {
        await markFailedOrRetry(row, TIMED_OUT_ERROR, { terminal: true, code: 'TIMED_OUT' });
        summary.failed += 1;
      } catch (bookErr) {
        console.error(`[self-destruct/run] could not retire ${row.id}: ${bookErr.message}`);
        summary.errors.push({ id: row.id, error: `bookkeeping: ${bookErr.message}`, terminal: true });
      }
    }

    // 3. One AppView call for the whole batch rather than one per row.
    const engagement = await readEngagement(live);

    // 4. Resolve each row independently; one slow PDS must not block the rest.
    const results = await settleWithLimit(live, ROW_CONCURRENCY, async (row) => {
      if (Date.now() >= startBy) {
        // Too late in the run to start something that may need a thread's
        // worth of deletes. Back in the queue exactly as it was claimed, with
        // the claim's attempt given back: nothing about this row failed.
        try {
          await requeueUnspent(row);
          summary.deferred += 1;
        } catch (bookErr) {
          // Left in 'checking'; the reclaim will bring it back.
          console.error(`[self-destruct/run] could not put back ${row.id}: ${bookErr.message}`);
          summary.errors.push({ id: row.id, error: `bookkeeping: ${bookErr.message}` });
        }
        return;
      }
      try {
        const conditional = hasClauses(row.conditions);
        // A row with a pinned verdict from an interrupted earlier attempt
        // resumes that decision and reads nothing, so a failed batch read must
        // not hold it back. Asked of the store, so a marker it refuses as a
        // verdict is not waved through here either.
        const pinned = !!pinnedVerdict(row);
        if (conditional && !pinned && !engagement) {
          // Nothing was learned about this post, so nothing is decided about
          // it. Back in the queue with backoff; the post stays up.
          throw Object.assign(
            new Error("couldn't read the counts for this post, so it was left up."),
            { code: 'ENGAGEMENT_UNAVAILABLE' },
          );
        }
        // Hand the batch read down only when it succeeded. A null map passed
        // as if it were an answer would read every post as "already gone".
        const given = conditional && engagement ? { engagement } : {};

        const result = await resolveSelfDestruct(row, { ...given, deadline });
        if (result.outcome === 'deleted') summary.deleted += 1;
        else if (result.outcome === 'acted') summary.acted += 1;
        else if (result.outcome === 'spared') summary.spared += 1;
        else if (result.outcome === 'extended') summary.extended += 1;
        else if (result.outcome === 'gone') summary.gone += 1;
        else if (result.outcome === 'deferred') summary.deferred += 1;
      } catch (err) {
        const terminal = !!err.nonRetryable;
        let outcome = 'retry';
        try {
          outcome = await markFailedOrRetry(row, err.message, {
            terminal,
            code: classifyFailure(err),
            // Some of the thread already came down, so "the post is still up"
            // would not be the whole truth if this is the last try.
            partial: !!err.partialDeletion,
          });
        } catch (bookErr) {
          console.error(`[self-destruct/run] could not record failure for ${row.id}: ${bookErr.message}`);
          summary.errors.push({ id: row.id, error: `bookkeeping: ${bookErr.message}`, terminal });
        }
        if (outcome === 'failed') summary.failed += 1;
        else summary.retried += 1;
        summary.errors.push({ id: row.id, error: err.message, terminal });
        console.error(`[self-destruct/run] check failed for ${row.id} (${outcome}): ${err.message}`);
      }
    });
    // Nothing above should reject; settling is the backstop that keeps an
    // unforeseen throw from costing the rest of the batch its run.
    for (const r of results) {
      if (r.status === 'rejected') {
        const message = r.reason?.message || String(r.reason);
        summary.errors.push({ error: `row handler crashed: ${message}` });
        console.error('[self-destruct/run] row handler crashed:', message);
      }
    }

    console.log(`[self-destruct/run] ${runId}:`, JSON.stringify({ ...summary, errors: summary.errors.length }));
    return sendJson(res, 200, { success: true, ...summary });
  } catch (error) {
    if (error.code === 'UNAVAILABLE') {
      // No table (or no database) here. Nothing to do and nothing wrong.
      console.log(`[self-destruct/run] ${runId}: timers are not set up here; nothing to do.`);
      return sendJson(res, 200, { success: true, ...summary, unavailable: true });
    }
    console.error('[self-destruct/run] fatal:', error.message);
    return sendJson(res, 500, { success: false, error: error.message, ...summary });
  }
}
