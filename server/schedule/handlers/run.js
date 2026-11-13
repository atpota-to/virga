// GET|POST /api/schedule/run: the scheduled-posts worker, called by Vercel
// Cron every minute with `Authorization: Bearer <CRON_SECRET>`. Each run:
//   1. reclaims rows stuck in 'publishing' (a run that died mid-write);
//   2. claims a batch of due rows (FOR UPDATE SKIP LOCKED, so overlapping
//      runs never take the same row and nothing is published twice);
//   3. publishes each with the account's restored OAuth session;
//   4. marks each published, or requeues it with backoff, or fails it;
//   5. arms the self-destruct timer of any row that asked for one;
//   6. once an hour, sweeps the stashed images of long-dead failed rows.

import crypto from 'node:crypto';
import { methodGuard, sendJson } from '../../http.js';
import { envInt } from '../../env.js';
import { requireCron } from '../../cron.js';
import { isSupabaseConfigured } from '../../supabase.js';
import { armForPublishedSchedule } from '../../timers/selfDestruct.js';
import * as scheduled from '../scheduledPosts.js';
import { sendUnavailable } from '../respond.js';

export const DEFAULT_CLAIM_LIMIT = 20;
// A run can't hold a lock past its 60 s maxDuration, so three minutes is clear
// of any publish in flight.
export const STUCK_AFTER_SECONDS = 180;
// What the reader sees for a row retired for running past its attempts
// without a failure of its own; the reclaim RPC writes the same sentence.
export const TIMED_OUT_ERROR =
  'the publisher ran out of time before this post could be written.';
// How long after a row is created a MEDIA_MISSING failure means "create is
// still stashing the bytes" (the row is inserted first so Storage can be keyed
// by its id) rather than "the bytes are gone".
export const MEDIA_STASH_GRACE_MS = 5 * 60 * 1000;
// The sweep is daily-scale work and this worker wakes every minute. A
// stateless function can't keep a schedule of its own, so the sweep rides one
// fixed minute of each hour, deliberately not :00.
export const SWEEP_MINUTE = 17;
// Publishing is the job and the sweep housekeeping: if the publish loop has
// spent half the 60 s budget, the bytes wait for the next hour.
export const SWEEP_TIME_BUDGET_MS = 30 * 1000;

/**
 * The post is out; only its timer failed to arm. That stays on the row
 * (function logs die with the instance), because the author needs to know the
 * post won't take itself down.
 */
async function noteArmFailure(rowId, armErr) {
  const cause = String(armErr?.message || armErr).slice(0, 300);
  console.error(
    `[schedule/run] could not arm the timer for ${rowId}: ${cause}`,
  );
  try {
    await scheduled.writeBookkeeping(rowId, {
      last_error: `this post published, but its self-destruct timer could not be set: ${cause}. set a timer by hand from the post if you still want it to come down.`,
      last_error_code: 'TIMER_NOT_ARMED',
      updated_at: new Date().toISOString(),
    });
  } catch (noteErr) {
    console.error(
      `[schedule/run] could not record the arm failure for ${rowId}: ${noteErr.message}`,
    );
  }
}

/** Arm a published row's timer, if it asked for one, counting the outcome. */
async function armTimer(row, refs, summary) {
  if (!row.payload?.selfDestruct) return;
  try {
    const armed = await armForPublishedSchedule(row, refs);
    if (armed) summary.armed += 1;
  } catch (armErr) {
    summary.armFailed += 1;
    summary.errors.push({
      id: row.id,
      error: `self-destruct: ${armErr.message}`,
    });
    await noteArmFailure(row.id, armErr);
  }
}

/**
 * A row claimed past its attempt budget was killed mid-publish and then
 * reclaimed, so it never reached markFailedOrRetry, the only place attempts
 * are checked. If its progress covers every post, the earlier run wrote the
 * whole thread and died before marking it: finish the bookkeeping rather than
 * tell the writer a live thread failed. Otherwise retire it as TIMED_OUT.
 */
async function settleSpent(row, summary) {
  try {
    const posts = Array.isArray(row.payload?.posts)
      ? row.payload.posts.length
      : 0;
    const progress = Array.isArray(row.progress) ? row.progress : [];
    if (posts > 0 && progress.length >= posts && progress[0]?.uri) {
      await scheduled.markPublished(row.id, progress[0], row.payload?.media);
      summary.published += 1;
      await armTimer(row, progress, summary);
      return;
    }
    await scheduled.markFailedOrRetry(row, TIMED_OUT_ERROR, {
      terminal: true,
      code: 'TIMED_OUT',
    });
    summary.failed += 1;
  } catch (bookErr) {
    console.error(
      `[schedule/run] could not retire ${row.id}: ${bookErr.message}`,
    );
    summary.errors.push({
      id: row.id,
      error: `bookkeeping: ${bookErr.message}`,
      terminal: true,
    });
  }
}

async function publishOne(row, summary) {
  // Everything this row wrote, so a timer covers the whole thread.
  let written = null;
  try {
    const result = await scheduled.publishScheduledPost(row, {
      onProgress: (progress) => {
        written = progress;
        return scheduled.markProgress(row.id, progress);
      },
    });
    await scheduled.markPublished(row.id, result, row.payload?.media);
    summary.published += 1;
    // After markPublished and never allowed to throw: the post is out, and a
    // hiccup here must not turn it into a row the queue reports as failed. A
    // row that resumed with nothing left to write never called onProgress, so
    // it falls back to the progress it was claimed with.
    const refs =
      written ||
      (Array.isArray(row.progress) && row.progress.length
        ? row.progress
        : [result]);
    await armTimer(row, refs, summary);
  } catch (err) {
    let terminal = !!err.nonRetryable;
    if (terminal && err.code === 'MEDIA_MISSING') {
      const ageMs = Date.now() - new Date(row.created_at).getTime();
      if (Number.isFinite(ageMs) && ageMs < MEDIA_STASH_GRACE_MS)
        terminal = false;
    }
    // A failed bookkeeping write leaves the row 'publishing' for the reclaim
    // sweep: one row's problem, never the batch's.
    let outcome = 'retry';
    try {
      // Classified from the error, which carries the PDS's status and name.
      outcome = await scheduled.markFailedOrRetry(row, err.message, {
        terminal,
        code: scheduled.classifyFailure(err),
      });
    } catch (bookErr) {
      console.error(
        `[schedule/run] could not record the failure for ${row.id}: ${bookErr.message}`,
      );
      summary.errors.push({
        id: row.id,
        error: `bookkeeping: ${bookErr.message}`,
        terminal,
      });
    }
    if (outcome === 'failed') summary.failed += 1;
    else summary.retried += 1;
    summary.errors.push({ id: row.id, error: err.message, terminal });
    console.error(
      `[schedule/run] publish failed for ${row.id} (${outcome}): ${err.message}`,
    );
  }
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET', 'POST'])) return;
  if (!requireCron(req, res)) return;
  if (!isSupabaseConfigured()) return sendUnavailable(res);

  const runId = crypto.randomUUID();
  const startedAt = Date.now();
  // mediaReclaimed stays null on minutes the sweep doesn't run, so the log
  // says "not this tick" rather than "swept nothing".
  const summary = {
    runId,
    reclaimed: 0,
    claimed: 0,
    published: 0,
    retried: 0,
    failed: 0,
    armed: 0,
    armFailed: 0,
    mediaReclaimed: null,
    errors: [],
  };

  try {
    summary.reclaimed = await scheduled.reclaimStuck(STUCK_AFTER_SECONDS);

    const limit = envInt(
      process.env,
      'SCHEDULE_CLAIM_LIMIT',
      DEFAULT_CLAIM_LIMIT,
    );
    const rows = await scheduled.claimDuePosts(runId, limit);
    summary.claimed = rows.length;

    // Strictly greater: markFailedOrRetry already treats attempts >=
    // max_attempts as exhausted after using that attempt.
    for (const row of rows.filter((r) => r.attempts > r.max_attempts)) {
      await settleSpent(row, summary);
    }

    // Each row on its own: one slow or failing PDS must not hold up the rest.
    const live = rows.filter((r) => r.attempts <= r.max_attempts);
    const results = await Promise.allSettled(
      live.map((row) => publishOne(row, summary)),
    );
    for (const r of results) {
      if (r.status === 'rejected') {
        const message = r.reason?.message || String(r.reason);
        summary.errors.push({ error: `row handler crashed: ${message}` });
        console.error('[schedule/run] row handler crashed:', message);
      }
    }

    // The minute is read from when the run started: a publish loop spilling
    // into the next minute would otherwise skip the sweep every hour.
    if (
      new Date(startedAt).getUTCMinutes() === SWEEP_MINUTE &&
      Date.now() - startedAt < SWEEP_TIME_BUDGET_MS
    ) {
      try {
        summary.mediaReclaimed = await scheduled.reclaimFailedMedia();
      } catch (sweepErr) {
        console.warn(
          `[schedule/run] media reclaim failed: ${sweepErr.message}`,
        );
      }
    }

    console.log(`[schedule/run] ${runId}:`, JSON.stringify(summary));
    return sendJson(res, 200, { success: true, ...summary });
  } catch (error) {
    console.error('[schedule/run] fatal:', error.message);
    if (error.code === 'UNAVAILABLE') return sendUnavailable(res);
    return sendJson(res, 500, {
      success: false,
      error: error.message,
      ...summary,
    });
  }
}
