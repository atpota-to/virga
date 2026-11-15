// POST /api/schedule/update { id, … }: change one of the account's rows, in
// one of six ways, checked in this order:
//
//   { acknowledgeTimer: true }   clear a published row's TIMER_NOT_ARMED note
//   { retry: true }              put a failed row back in the queue: one that
//                                wrote nothing goes out now, a part-published
//                                thread resumes as it stands
//   { skip: true }               skip the waiting occurrence of a repeating
//                                post: it doesn't go out, and the next one
//                                takes its place (the answer's `data` is the
//                                next row, or null with `ended: true` when
//                                that was the last)
//   { stopRepeat: true }         stop a post repeating: the waiting occurrence
//                                still goes out, and nothing follows it
//   { payload, scheduledFor, … } rewrite it from the composer (the create
//                                body); a failed row comes back pending, and
//                                on a repeating post this and the later
//                                occurrences change
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
  sendInvalid,
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
      skip,
      stopRepeat,
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
    } else if (skip) {
      const out = await scheduled.skipOccurrence({ id, userDid });
      if (!out) {
        return sendJson(res, 409, {
          success: false,
          error:
            'there is nothing to skip here: this post is not repeating, or is already on its way out.',
          code: 'NOT_SKIPPABLE',
        });
      }
      // The row the caller named is gone from the list; what it reads back
      // is the occurrence that took its place, when there is one.
      return sendJson(res, 200, {
        success: true,
        data: out.next ? publicRow(out.next) : null,
        skipped: id,
        ended: !out.next,
      });
    } else if (stopRepeat) {
      row = await scheduled.stopRepeating({ id, userDid });
      if (!row) {
        return sendJson(res, 409, {
          success: false,
          error:
            'this post is not repeating, or is already on its way out, so there is nothing to stop.',
          code: 'NOT_REPEATING',
        });
      }
    } else if (payload) {
      // A rule is anchored at this row's number in its series, when it is
      // the row the series goes on from; anywhere else it starts at one.
      const editing = payload.repeat
        ? await scheduled.getScheduledPost(id, userDid)
        : null;
      const validation = scheduled.validateCreate({
        scheduledFor,
        target,
        payload,
        queued,
        occurrence: scheduled.seriesCarrier(editing) ? editing.occurrence : 1,
      });
      if (!validation.ok) return sendInvalid(res, validation);

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
        reply: validation.value.reply,
        replyTo: validation.value.replyTo,
        repeat: validation.value.repeat,
      });
    } else {
      const validation = scheduled.validateReschedule({ scheduledFor });
      if (!validation.ok) return sendInvalid(res, validation);
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
    if (row?.blocked === 'MEDIA_MISSING') {
      // Only a retry answers this: the 30-day sweep already removed images
      // the post still needs, so another run could only fail again.
      return sendJson(res, 409, {
        success: false,
        error: row.partial
          ? 'part of this thread posted, but the images for the rest were cleared after 30 days. cancel it here and finish the thread by hand.'
          : 'the images for this post were cleared after 30 days. edit it and add them again.',
        code: 'MEDIA_MISSING',
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
