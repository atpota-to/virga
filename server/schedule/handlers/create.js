// POST /api/schedule/create: queue a post or thread for later.
//
//   { scheduledFor: ISO (future, within 90 days), target: 'bluesky', queued,
//     payload: { posts, gates, mediaBytes: { [mediaId]: { base64, encoding } },
//                tz?, selfDestruct? } }
//
// Image bytes are stashed in Storage; the blob upload to the PDS happens at
// publish time. A `selfDestruct` block rides along for the worker, which arms
// the timer on the records it wrote, so a post can be scheduled and given a
// lifespan in one action. The caller's DID comes from the session token.

import { methodGuard, readJson, sendJson } from '../../http.js';
import { envInt } from '../../env.js';
import { createRateLimiter } from '../../rateLimit.js';
import { enforceScheduledTimerLimit } from '../../limits/limits.js';
import * as scheduled from '../scheduledPosts.js';
import {
  authorize,
  publicRow,
  refuseOversizedMedia,
  requireScheduling,
  sendFailure,
  sendInvalid,
} from '../respond.js';

// A per-DID burst guard, not a quota (the ceilings are counted in the
// database): it stops one account hammering the most expensive write there is,
// which stashes image bytes on every call. Per instance, so a first line only.
const limiters = new Map();
function createLimiter() {
  const limit = envInt(process.env, 'SCHEDULE_CREATE_PER_MIN', 30);
  if (!limiters.has(limit))
    limiters.set(limit, createRateLimiter({ limit, windowMs: 60 * 1000 }));
  return limiters.get(limit);
}

/** Tests only: forget every burst window. */
export function resetCreateLimiterForTests() {
  limiters.clear();
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;
  if (!requireScheduling(res)) return;
  try {
    const userDid = await authorize(req, res);
    if (!userDid) return;

    // Before the body is even looked at: spend as little as possible on a
    // caller that is already over the line.
    const rl = createLimiter().check(userDid);
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfterSec));
      return sendJson(res, 429, {
        success: false,
        error: 'that is a lot of posts at once. wait a moment and try again.',
        code: 'RATE_LIMITED',
        retryAfter: rl.retryAfterSec,
      });
    }

    const body = await readJson(req);
    const { scheduledFor, target = 'bluesky', payload, queued } = body;

    const validation = scheduled.validateCreate({
      scheduledFor,
      target,
      payload,
      queued,
    });
    if (!validation.ok) return sendInvalid(res, validation);

    const { posts, gates, selfDestruct } = validation.value;
    const mediaBytes = (payload && payload.mediaBytes) || {};
    if (refuseOversizedMedia(res, mediaBytes)) return;
    // The scheduling device's zone, kept as it came so it round-trips.
    const tz =
      payload && typeof payload.tz === 'string' ? payload.tz : undefined;

    const referencedIds = [];
    for (const p of posts) scheduled.collectMediaIds(p.embed, referencedIds);
    for (const id of referencedIds) {
      if (!mediaBytes[id] || !mediaBytes[id].base64) {
        return sendJson(res, 400, {
          success: false,
          error: `missing bytes for media "${id}"`,
        });
      }
    }

    // A timer holds its slot from the moment it's scheduled, so the worker
    // arms it without asking again. Checked before anything is reserved.
    if (selfDestruct)
      await enforceScheduledTimerLimit({ userDid, spec: selfDestruct });

    // The record keys are reserved now, minted from the scheduled time, so
    // each post's at:// URI is fixed before it's published and the worker's
    // putRecord at that key can't duplicate it.
    const rkeys = await scheduled.assignRkeys({
      userDid,
      scheduledFor: validation.value.scheduledFor,
      postCount: posts.length,
    });

    // Inserted first so the media can be stored under the row's id.
    const row = await scheduled.createScheduledPost({
      userDid,
      scheduledFor: validation.value.scheduledFor,
      payload: { posts, gates, media: {}, rkeys, tz, selfDestruct },
      queued: validation.value.queued,
    });

    // Built from the row as stored, never from the local `rkeys`: the create
    // may have re-minted them to settle a clash with a concurrent create, and
    // writing the old ones back would put two posts at one address.
    const withMedia = (media) => ({ ...row.payload, media });

    let finalRow = row;
    if (referencedIds.length > 0) {
      const media = {};
      try {
        for (const id of referencedIds) {
          const { base64, encoding } = mediaBytes[id];
          const storagePath = await scheduled.storeMedia(
            row.id,
            id,
            base64,
            encoding,
          );
          media[id] = { storagePath, encoding };
        }
        finalRow = await scheduled.updatePayload(row.id, withMedia(media));
      } catch (stashErr) {
        // Never leave a pending row whose embeds name media that was never
        // stored: it could only fail at publish, holding a slot meanwhile
        // while the writer, having seen the error, schedules it again. Record
        // what did reach Storage first so cancelling removes those objects,
        // then retire the row. Both best-effort: the stash failure is what the
        // caller needs to hear about.
        await scheduled.updatePayload(row.id, withMedia(media)).catch(() => {});
        await scheduled.cancelScheduledPost(row.id, userDid).catch(() => {});
        throw stashErr;
      }
    }

    return sendJson(res, 201, { success: true, data: publicRow(finalRow) });
  } catch (error) {
    return sendFailure(
      res,
      'schedule/create',
      error,
      "couldn't save that scheduled post. please try again.",
    );
  }
}
