// Sentences for what went wrong with a scheduled post, in Virga's words.
// The server's own messages are short notes rather than Virga's sentences, so
// the UI branches on codes and uses the server's prose only as a last resort.
//
// Two readers: friendlyScheduleError for what the publish worker stored on a
// failed row (`lastError`, `lastErrorCode`), and scheduleErrorMessage for an
// error a schedule or timer call threw.

import { timerSlotRefusal } from '../timers/selfDestruct.js';

// Each sentence is reached two ways: the worker's stored code, or a prose
// match for rows without one.
const LOST_MEDIA =
  'The images for this post are missing. Edit it and add them again.';
const EXPIRED_SESSION =
  'Virga’s server couldn’t act as this account: its session had ended. Sign in again, then retry.';
const RAN_OUT_OF_TIME =
  'Virga’s server ran out of time before it could post this.';
const RATE_LIMITED = 'Bluesky was rate limiting this account.';
const REFUSED = 'Bluesky refused the post.';
const TIMER_NOT_SET =
  'This posted, but its timer couldn’t be set. It stays up unless you delete it.';
const NO_IDEA = 'This one didn’t go out.';

// The publish worker's verdict, stored in `lastErrorCode`. 'UNKNOWN' is left
// out on purpose: an unclassified row may still have useful prose. A
// TIMER_NOT_ARMED note rides on a published row (only its timer failed), so
// its sentence must not read as a failed post.
const BY_CODE = {
  MEDIA_MISSING: LOST_MEDIA,
  SESSION_UNAVAILABLE: EXPIRED_SESSION,
  TIMED_OUT: RAN_OUT_OF_TIME,
  RATE_LIMITED,
  REFUSED,
  TIMER_NOT_ARMED: TIMER_NOT_SET,
};

/**
 * A failed scheduled post as a sentence.
 *
 * @param {string} raw   what the worker stored in `lastError`
 * @param {string} [code] the worker's own verdict, `lastErrorCode`
 *
 * The code wins: prose matching breaks quietly when the server rewords a message.
 * Rows from an older worker have no code and fall back to the prose.
 */
export function friendlyScheduleError(raw, code) {
  const known =
    BY_CODE[
      String(code || '')
        .trim()
        .toUpperCase()
    ];
  if (known) return known;

  // Some stored messages are the server's own sentences (its media guard and the
  // time-out retirement); match those first on fragments no PDS or Postgres
  // error could collide with. Not bare 'image': 'InvalidRequest: image file
  // size too large' is a refusal.
  const s = String(raw || '').toLowerCase();
  if (
    s.includes('images for this scheduled post') ||
    s.includes('re-attach') ||
    s.includes('media') ||
    s.includes('missing bytes') ||
    s.includes('object not found')
  ) {
    return LOST_MEDIA;
  }
  if (s.includes('ran out of time')) return RAN_OUT_OF_TIME;
  if (s.includes('session')) return EXPIRED_SESSION;
  // 'RateLimitExceeded' (one word) or prose ("rate limit").
  if (s.includes('rate limit') || s.includes('ratelimit')) return RATE_LIMITED;
  if (s.includes('invalidrequest') || s.includes('upstream')) return REFUSED;
  return NO_IDEA;
}

/** The server's own sentence, made to read as one of Virga's: a capital and a stop. */
function asSentence(text) {
  const t = String(text || '').trim();
  if (!t) return '';
  // The server writes its notes in lower case; each sentence starts upper case
  // here, not just the first.
  const capped = t.replace(/(^|[.!?]\s+)([a-z])/g, (m, lead, letter) => lead + letter.toUpperCase());
  return /[.!?…]$/.test(capped) ? capped : `${capped}.`;
}

/** What to say about a QUOTA_EXCEEDED refusal (whatever its status). */
export function quotaMessage(payload) {
  const timer = timerSlotRefusal(payload);
  if (timer) return timer;
  const limit = Number(payload?.limit);
  if (payload?.feature === 'scheduledPosts') {
    const n = Number.isFinite(limit) && limit > 0 ? limit : null;
    return n
      ? `This account can keep ${n} scheduled ${n === 1 ? 'post' : 'posts'} at a time, and ${n === 1 ? 'it’s' : 'they’re all'} in use.`
      : `This account’s scheduled posts are all in use.`;
  }
  // No feature: the flat cap everyone has.
  return 'This account has as many posts scheduled and on timers as Virga’s server holds. Let some go out, or cancel a few.';
}

const BY_THROWN_CODE = {
  NEEDS_BACKEND:
    'Scheduling needs this account signed in through Virga’s server. Reconnect it for a longer session.',
  SCHEDULE_REPLY: 'Replies can’t be scheduled. Post it now instead.',
  SCHEDULE_VIDEO: 'Posts with video can’t be scheduled. Post it now instead.',
  MEDIA_TOO_LARGE:
    'That’s more image than can be sent ahead. Use fewer or smaller images, or post it now.',
  IMAGE_TOO_LARGE:
    'One of the images is over Bluesky’s size limit. Add it again so it can be shrunk.',
  IMAGE_MISSING:
    'An image needs to be added again before this can be scheduled.',
  TOO_MANY_IMAGES: 'A post can have up to 4 images.',
  RECORD_UNRESOLVED:
    'The attached post or feed couldn’t be found. Remove it or try again.',
  SCHEDULE_INVALID: 'Choose a time to post it.',
  SCHEDULE_PAST: 'Choose a time at least a minute from now.',
  SCHEDULE_TOO_FAR: 'Posts can be scheduled up to 90 days ahead.',
  EMPTY: 'Write something first.',
  RATE_LIMITED: 'That’s a lot of posts at once. Wait a moment and try again.',
  NOT_RESCHEDULABLE:
    'This post is already on its way out, or has gone, so it can’t be changed.',
  PARTIALLY_PUBLISHED:
    'Part of this thread is already out, so it can’t be changed. Retry it to post the rest, or cancel it.',
  NOT_CANCELLABLE:
    'This post is already on its way out, so it can no longer be cancelled.',
  NOT_RETRIABLE: 'Only a post that didn’t go out can be retried.',
  NOT_ACKNOWLEDGEABLE: 'That note was already cleared.',
  NOT_REORDERABLE:
    'One of these posts is already on its way out, so the new order wasn’t saved.',
  DELETE_TIME_TOO_EARLY:
    'This post’s delete time would come before it goes out, or within five minutes of it. Pick an earlier slot, or change its lifespan first.',
  NOT_REARMABLE:
    'This post’s timer is being checked right now, so it wasn’t changed. Try again in a minute.',
  NOT_YOUR_CLIENT:
    'This post was scheduled in another app. Open it there to change it.',
  UNAVAILABLE: 'Scheduling isn’t available on Virga’s server right now.',
  VIRGA_CLIENT_UNAVAILABLE:
    'Virga’s server isn’t taking sign-ins right now. Try again later.',
  TIMEOUT: 'Virga’s server didn’t answer in time. Try again.',
  NETWORK_ERROR:
    'Couldn’t reach Virga’s server. Check the connection and try again.',
  INTERNAL: 'Virga’s server couldn’t do that just now. Try again.',
};

/**
 * What to tell the writer about an error a schedule or timer call threw
 * (`{ status, code, detail, payload }`, as the Requester and serializer
 * throw them). Never a raw "server answered 502" line.
 */
export function scheduleErrorMessage(err) {
  if (!err) return '';
  if (err.code === 'QUOTA_EXCEEDED') return quotaMessage(err.payload || err);
  if (err.code === 'TIMER_PROBLEM' || err.code === 'LIFESPAN')
    return String(err.message || '');
  // A retry refused because the images were cleared: the server's note says
  // whether part of the thread is already out, which decides what to do next.
  if (err.code === 'MEDIA_MISSING')
    return err.detail
      ? asSentence(err.detail)
      : 'The images for this post were cleared after 30 days. Edit it and add them again.';
  const known = BY_THROWN_CODE[err.code];
  if (known) return known;
  if (err.status === 401)
    return 'This account needs to sign in again before it can do that.';
  if (err.status === 413)
    return 'That was too large to send. Use fewer or smaller images.';
  if (err.status >= 500)
    return 'Virga’s server couldn’t do that just now. Try again.';
  // A 400 from the server carries a sentence and no code: the one place its prose
  // is the most precise thing there is to say.
  if (typeof err.detail === 'string' && err.detail)
    return asSentence(err.detail);
  if (typeof err.message === 'string' && err.message && !err.status)
    return asSentence(err.message);
  return 'That didn’t work. Try again.';
}

/**
 * What to tell the writer when the server refuses a reorder (it wrote nothing),
 * or null when the failure isn't a refusal: a missing endpoint, which falls
 * back to row-by-row writes.
 */
export function reorderRefusal(err) {
  if (!err) return null;
  if (
    err.reorderUnsupported === true ||
    err.status === 404 ||
    err.status === 405
  )
    return null;
  if (err.code === 'DELETE_TIME_TOO_EARLY') {
    return 'One of these posts would go out after its delete time in this order, or within five minutes of it. Move it earlier, or change its lifespan first. Your queue is unchanged.';
  }
  if (err.code === 'NOT_REORDERABLE' || err.status === 409) {
    return BY_THROWN_CODE.NOT_REORDERABLE;
  }
  return scheduleErrorMessage(err) || null;
}
