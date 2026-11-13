// POST /api/schedule/update { id, … }: change one of the account's rows, in
// one of four ways, checked in this order:
//
//   { acknowledgeTimer: true }   clear a published row's TIMER_NOT_ARMED note
//   { retry: true }              put a failed row back in the queue as it is
//   { payload, scheduledFor, … } rewrite it from the composer (the create
//                                body); a failed row comes back pending
//   { scheduledFor }             move a pending row to a new time
//
// A row already publishing or published can't be changed, nor can a thread
// whose first posts are out (409 PARTIALLY_PUBLISHED). A move that would put a
// post after its own pinned delete time, or within five minutes of it, is
// refused (409 DELETE_TIME_TOO_EARLY with the `deleteAt` it would strand); a
// rewrite checks the same through validateCreate.

import { methodGuard, readJson, sendJson } from '../../http.js';
import { enforceScheduledTimerLimit } from '../../limits/limits.js';
import * as scheduled from '../scheduledPosts.js';
import {
  authorize,
  publicRow,
  refuseOversizedMedia,
  requireScheduling,
  sendFailure,
} from '../respond.js';

const NOT_RESCHEDULABLE = {
  success: false,
  error:
    'This post can no longer be rescheduled — it may already be publishing.',
  code: 'NOT_RESCHEDULABLE',
};

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;
  if (!requireScheduling(res)) return;
  try {
    const userDid = await authorize(req, res);
    if (!userDid) return;

    const body = await readJson(req);
    const {
      scheduledFor,
      target = 'bluesky',
      payload,
      queued,
      retry,
      acknowledgeTimer,
    } = body;
    const id = typeof body.id === 'string' ? body.id.trim() : '';
    if (!id) return sendJson(res, 400, { success: false, error: 'Missing id' });

    let row;
    if (acknowledgeTimer) {
      row = await scheduled.acknowledgeTimerFailure(id, userDid);
      if (!row) {
        return sendJson(res, 409, {
          success: false,
          error: 'there is no timer note on that post to clear.',
          code: 'NOT_ACKNOWLEDGEABLE',
        });
      }
    } else if (retry) {
      // A failed row holds no timer slot; back in the queue, its timer takes one.
      const failed = await scheduled.getScheduledPost(id, userDid);
      const spec =
        failed?.status === 'failed' ? failed.payload?.selfDestruct : null;
      if (spec)
        await enforceScheduledTimerLimit({
          userDid,
          spec,
          exceptScheduledId: id,
        });
      row = await scheduled.retryFailedScheduledPost({ id, userDid });
      if (!row) {
        return sendJson(res, 409, {
          success: false,
          error:
            'this post can no longer be retried — it may have been dismissed, or already be back in the queue.',
          code: 'NOT_RETRIABLE',
        });
      }
    } else if (payload) {
      const validation = scheduled.validateCreate({
        scheduledFor,
        target,
        payload,
        queued,
      });
      if (!validation.ok)
        return sendJson(res, 400, { success: false, error: validation.error });

      const mediaBytes = payload.mediaBytes || {};
      if (refuseOversizedMedia(res, mediaBytes)) return;
      // Every referenced image must come with its bytes, as on create;
      // otherwise the lib would throw halfway through stashing.
      const referencedIds = [];
      for (const p of validation.value.posts)
        scheduled.collectMediaIds(p.embed, referencedIds);
      for (const mediaId of referencedIds) {
        if (!mediaBytes[mediaId] || !mediaBytes[mediaId].base64) {
          return sendJson(res, 400, {
            success: false,
            error: `missing bytes for media "${mediaId}"`,
          });
        }
      }

      // A timer the edit adds or changes needs a slot; the row's own isn't counted.
      if (validation.value.selfDestruct) {
        await enforceScheduledTimerLimit({
          userDid,
          spec: validation.value.selfDestruct,
          exceptScheduledId: id,
        });
      }

      row = await scheduled.updateScheduledPostContent({
        id,
        userDid,
        scheduledFor: validation.value.scheduledFor,
        posts: validation.value.posts,
        gates: validation.value.gates,
        mediaBytes,
        queued: validation.value.queued,
        tz: typeof payload.tz === 'string' ? payload.tz : undefined,
        selfDestruct: validation.value.selfDestruct,
      });
    } else {
      const validation = scheduled.validateReschedule({ scheduledFor });
      if (!validation.ok)
        return sendJson(res, 400, { success: false, error: validation.error });
      row = await scheduled.rescheduleScheduledPost({
        id,
        userDid,
        scheduledFor: validation.value.scheduledFor,
      });
    }

    if (row?.blocked === 'DELETE_TIME_TOO_EARLY') {
      return sendJson(res, 409, {
        success: false,
        error: scheduled.DELETE_TIME_TOO_EARLY_ERROR,
        code: 'DELETE_TIME_TOO_EARLY',
        deleteAt: row.deleteAt,
      });
    }
    if (row?.blocked === 'PARTIALLY_PUBLISHED') {
      // What happens next depends on the row: a pending one finishes on its
      // own; a failed one only if the reader retries it.
      return sendJson(res, 409, {
        success: false,
        error:
          row.status === 'failed'
            ? 'part of this thread posted before it failed. retry it to publish the rest, or cancel it here and finish by hand.'
            : 'part of this thread is already posted. the rest will follow on its own — cancel it here if you would rather finish by hand.',
        code: 'PARTIALLY_PUBLISHED',
      });
    }
    if (!row) return sendJson(res, 409, NOT_RESCHEDULABLE);

    return sendJson(res, 200, { success: true, data: publicRow(row) });
  } catch (error) {
    return sendFailure(
      res,
      'schedule/update',
      error,
      "couldn't update that scheduled post. please try again.",
    );
  }
}
