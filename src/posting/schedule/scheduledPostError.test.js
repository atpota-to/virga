/*
 * Translating what went wrong with a scheduled post: nothing machine-shaped
 * reaches the writer, the fallback is never an empty line, and the server's own
 * voice is replaced by Virga's.
 *
 * Two paths for a failed row: the server's classified `lastErrorCode`, and prose
 * matching for rows with no code (written by an older server). The pinned
 * strings come from the server, the only writer of `last_error`
 * (lib/scheduled-posts.js, api/schedule/run.js and the reclaim migration), so
 * a reworded message there fails here.
 */

import { describe, expect, it } from 'vitest';
import {
  friendlyScheduleError,
  quotaMessage,
  reorderRefusal,
  scheduleErrorMessage,
} from './scheduledPostError.js';

const LOST =
  'The images for this post are missing. Edit it and add them again.';
const SESSION =
  'Virga’s server couldn’t act as this account: its session had ended. Sign in again, then retry.';
const RAN_OUT = 'Virga’s server ran out of time before it could post this.';
const RATE = 'Bluesky was rate limiting this account.';
const REFUSED = 'Bluesky refused the post.';
const NOPE = 'This one didn’t go out.';

describe('friendlyScheduleError', () => {
  describe('reading the code the server stored', () => {
    const bySentence = {
      MEDIA_MISSING: LOST,
      SESSION_UNAVAILABLE: SESSION,
      TIMED_OUT: RAN_OUT,
      RATE_LIMITED: RATE,
      REFUSED,
    };

    for (const [code, sentence] of Object.entries(bySentence)) {
      it(`says what ${code} means`, () => {
        expect(friendlyScheduleError('', code)).toBe(sentence);
      });
    }

    it('trusts the code over the prose beside it', () => {
      expect(
        friendlyScheduleError(
          'InvalidRequest: upstream said no',
          'RATE_LIMITED',
        ),
      ).toBe(RATE);
    });

    it('still reads the prose when the worker could not classify it', () => {
      expect(
        friendlyScheduleError(
          'RateLimitExceeded: too many requests',
          'UNKNOWN',
        ),
      ).toBe(RATE);
      expect(friendlyScheduleError('ECONNRESET', 'UNKNOWN')).toBe(NOPE);
    });

    it('ignores a code it does not recognise', () => {
      expect(
        friendlyScheduleError(
          'media download failed: Object not found',
          'BLOB_TOO_BIG',
        ),
      ).toBe(LOST);
      expect(friendlyScheduleError('', 'BLOB_TOO_BIG')).toBe(NOPE);
    });
  });

  it('names an expired session as something to act on', () => {
    expect(
      friendlyScheduleError(
        'Your account session was unavailable at publish time — retrying.',
      ),
    ).toBe(SESSION);
  });

  it('recognises every shape a lost image arrives in', () => {
    expect(
      friendlyScheduleError(
        'the images for this scheduled post are missing. edit it and re-attach them.',
      ),
    ).toBe(LOST);
    expect(
      friendlyScheduleError('media download failed: Object not found'),
    ).toBe(LOST);
    expect(
      friendlyScheduleError('media upload failed: The resource was not found'),
    ).toBe(LOST);
    expect(friendlyScheduleError('missing bytes for media "p0-img1"')).toBe(
      LOST,
    );
    expect(friendlyScheduleError('MEDIA_MISSING')).toBe(LOST);
  });

  it('explains a post the publisher never got to', () => {
    expect(
      friendlyScheduleError(
        'the publisher ran out of time before this post could be written.',
      ),
    ).toBe(RAN_OUT);
  });

  it('reads the session failure the server actually writes', () => {
    expect(
      friendlyScheduleError(
        "couldn't reach your account session. reconnect your account if this keeps happening.",
      ),
    ).toBe(SESSION);
  });

  it('separates being rate limited from being refused', () => {
    expect(friendlyScheduleError('RateLimitExceeded: too many requests')).toBe(
      RATE,
    );
    expect(
      friendlyScheduleError('InvalidRequest: Record/rkey must be a valid TID'),
    ).toBe(REFUSED);
  });

  it('calls an oversized image a refusal, not a missing attachment', () => {
    expect(
      friendlyScheduleError('InvalidRequest: image file size too large'),
    ).toBe(REFUSED);
  });

  it('matches whatever case the worker happened to store', () => {
    expect(friendlyScheduleError('SESSION_UNAVAILABLE')).toBe(SESSION);
    expect(friendlyScheduleError('rate limit reached')).toBe(RATE);
  });

  it('still says something when there is nothing to go on', () => {
    for (const nothing of [null, undefined, '', 'ECONNRESET']) {
      expect(friendlyScheduleError(nothing)).toBe(NOPE);
    }
  });

  it('never hands back the raw string it was given', () => {
    const raw =
      'PostgrestError: duplicate key value violates unique constraint "scheduled_posts_pkey"';
    expect(friendlyScheduleError(raw)).not.toContain('PostgrestError');
    expect(friendlyScheduleError(raw)).not.toContain('scheduled_posts_pkey');
  });

  it('reads TIMER_NOT_ARMED as a post that went out without its timer', () => {
    const s = friendlyScheduleError(null, 'TIMER_NOT_ARMED');
    expect(s).toMatch(/posted/);
    expect(s).toMatch(/timer/);
    expect(s).not.toMatch(/didn’t go out/);
  });
});

const thrown = (fields) =>
  Object.assign(new Error(fields.message || 'x'), fields);

describe('scheduleErrorMessage', () => {
  it('reads a quota refusal by its feature, whatever the status', () => {
    for (const status of [402, 409]) {
      const err = thrown({
        status,
        code: 'QUOTA_EXCEEDED',
        payload: {
          code: 'QUOTA_EXCEEDED',
          feature: 'scheduledPosts',
          limit: 3,
        },
      });
      expect(scheduleErrorMessage(err)).toBe(
        'This account can keep 3 scheduled posts at a time, and they’re all in use.',
      );
    }
    expect(
      scheduleErrorMessage(
        thrown({
          status: 409,
          code: 'QUOTA_EXCEEDED',
          payload: { feature: 'conditionalTimers', limit: 1 },
        }),
      ),
    ).toMatch(/one conditional timer/);
    expect(
      scheduleErrorMessage(
        thrown({ status: 409, code: 'QUOTA_EXCEEDED', payload: {} }),
      ),
    ).toMatch(/as many posts scheduled/);
  });

  it('never offers anything for a limit', () => {
    expect(quotaMessage({ feature: 'scheduledPosts', limit: 1 })).not.toMatch(
      /member|upgrade|free/i,
    );
    expect(quotaMessage({ feature: 'scheduledPosts', limit: 1 })).toMatch(
      /1 scheduled post at a time, and it’s in use/,
    );
  });

  it('has its own words for each refusal code', () => {
    expect(
      scheduleErrorMessage(thrown({ status: 409, code: 'NOT_RESCHEDULABLE' })),
    ).toMatch(/already on its way out/);
    expect(
      scheduleErrorMessage(
        thrown({ status: 409, code: 'PARTIALLY_PUBLISHED' }),
      ),
    ).toMatch(/Part of this thread is already out/);
    expect(
      scheduleErrorMessage(thrown({ status: 403, code: 'NOT_YOUR_CLIENT' })),
    ).toMatch(/another app/);
    expect(scheduleErrorMessage(thrown({ code: 'SCHEDULE_REPLY' }))).toMatch(
      /Replies can’t be scheduled/,
    );
    expect(
      scheduleErrorMessage(thrown({ status: 0, code: 'TIMEOUT' })),
    ).toMatch(/didn’t answer in time/);
  });

  it('turns a coded-less 400 sentence from the server into one of Virga’s', () => {
    expect(
      scheduleErrorMessage(
        thrown({
          status: 400,
          detail: 'a thread can have at most 25 posts',
        }),
      ),
    ).toBe('A thread can have at most 25 posts.');
  });

  it('never shows a bare status line', () => {
    const msg = scheduleErrorMessage(
      thrown({ status: 502, message: 'Virga’s server answered 502' }),
    );
    expect(msg).not.toMatch(/502/);
    expect(scheduleErrorMessage(thrown({ status: 413 }))).toMatch(/too large/);
    expect(scheduleErrorMessage(thrown({ status: 401 }))).toMatch(
      /sign in again/,
    );
    expect(scheduleErrorMessage(null)).toBe('');
  });

  it('passes the timer model’s own sentence through', () => {
    expect(
      scheduleErrorMessage(
        thrown({ code: 'LIFESPAN', message: 'Pick a later delete time.' }),
      ),
    ).toBe('Pick a later delete time.');
  });
});

describe('reorderRefusal', () => {
  it('words a move past a pinned delete time itself', () => {
    expect(
      reorderRefusal(
        thrown({
          status: 409,
          code: 'DELETE_TIME_TOO_EARLY',
          detail: 'the delete time on "x" would come before…',
        }),
      ),
    ).toMatch(/^One of these posts would go out after its delete time/);
  });

  it('keeps the "already on its way out" refusal', () => {
    expect(
      reorderRefusal(thrown({ status: 409, code: 'NOT_REORDERABLE' })),
    ).toBe(
      'One of these posts is already on its way out, so the new order wasn’t saved.',
    );
  });

  it('leaves the missing endpoint to the row-by-row fallback', () => {
    expect(
      reorderRefusal(thrown({ status: 404, code: 'UNAVAILABLE' })),
    ).toBeNull();
    expect(reorderRefusal(thrown({ status: 405 }))).toBeNull();
    expect(reorderRefusal(thrown({ reorderUnsupported: true }))).toBeNull();
    expect(reorderRefusal(null)).toBeNull();
  });
});
