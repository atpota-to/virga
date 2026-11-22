// src/posting/schedule/scheduledPostError.js: what went wrong with a
// scheduled post, in Virga's words. A failed row's stored error and code
// (friendlyScheduleError), an error a schedule or timer call threw
// (scheduleErrorMessage, quotaMessage) and a refused reorder
// (reorderRefusal), word for word. Swift:
// VirgaPosting/Schedule/ScheduledPostError.swift.
//
// Inputs from scheduledPostError.test.js, every code the tables know, the
// server's own prose (lower case, several sentences, odd stops), loose
// values (numbers, arrays, null) and codes that only upper-case into a known
// one ('ſession_unavailable'). An error is the plain object the function
// reads its members from.

import {
  friendlyScheduleError,
  quotaMessage,
  reorderRefusal,
  scheduleErrorMessage,
} from '../../../src/posting/schedule/scheduledPostError.js';
import { each } from './_helpers.js';

export const sources = ['src/posting/schedule/scheduledPostError.js'];

const STORED_CODES = [
  'MEDIA_MISSING',
  'SESSION_UNAVAILABLE',
  'TIMED_OUT',
  'RATE_LIMITED',
  'REFUSED',
  'REPLY_TARGET_GONE',
  'REPLY_TARGET_UNCHECKED',
  'TIMER_NOT_ARMED',
  'UNKNOWN',
  'BLOB_TOO_BIG',
];

const PROSE = [
  null,
  undefined,
  '',
  'ECONNRESET',
  'InvalidRequest: upstream said no',
  'RateLimitExceeded: too many requests',
  'media download failed: Object not found',
  'Your account session was unavailable at publish time — retrying.',
  'the images for this scheduled post are missing. edit it and re-attach them.',
  'media upload failed: The resource was not found',
  'missing bytes for media "p0-img1"',
  'MEDIA_MISSING',
  'the publisher ran out of time before this post could be written.',
  "couldn't reach your account session. reconnect your account if this keeps happening.",
  'InvalidRequest: Record/rkey must be a valid TID',
  'InvalidRequest: image file size too large',
  'SESSION_UNAVAILABLE',
  'rate limit reached',
  'PostgrestError: duplicate key value violates unique constraint "scheduled_posts_pkey"',
  'Upstream PDS failed',
  'OBJECT NOT FOUND',
  'Ran Out Of Time',
  'RE-ATTACH',
  'İmages for this scheduled post',
  'The Kelvin session',
  404,
  true,
  ['media', 'gone'],
  { message: 'session' },
];

const friendlyInputs = [
  ...PROSE.map((raw) => ({ raw })),
  ...STORED_CODES.map((code) => ({ raw: '', code })),
  ...STORED_CODES.map((code) => ({
    raw: 'InvalidRequest: upstream said no',
    code,
  })),
  { raw: 'RateLimitExceeded: too many requests', code: 'UNKNOWN' },
  { raw: 'ECONNRESET', code: 'UNKNOWN' },
  { raw: 'media download failed: Object not found', code: 'BLOB_TOO_BIG' },
  { raw: '', code: 'media_missing' },
  { raw: '', code: '  timed_out  ' },
  { raw: '', code: 'Rate_Limited' },
  { raw: '', code: 'ſession_unavailable' },
  { raw: '', code: 'refuſed' },
  { raw: '', code: 'tımed_out' },
  { raw: '', code: 'ﬁ' },
  { raw: 'whatever the server wrote', code: 'REPLY_TARGET_GONE' },
  { raw: 'session', code: null },
  { raw: 'session', code: 0 },
  { raw: 'rate limit', code: ['REFUSED'] },
  { raw: 'rate limit', code: 7 },
  { raw: 'x', code: 'constructor' },
  { raw: 'x', code: '__proto__' },
  { raw: 'x', code: 'toString' },
];

const quotaInputs = [
  { payload: { feature: 'scheduledPosts', limit: 3 } },
  { payload: { feature: 'scheduledPosts', limit: 1 } },
  { payload: { feature: 'scheduledPosts', limit: '2' } },
  { payload: { feature: 'scheduledPosts', limit: 0 } },
  { payload: { feature: 'scheduledPosts', limit: -1 } },
  { payload: { feature: 'scheduledPosts', limit: 2.5 } },
  { payload: { feature: 'scheduledPosts', limit: 'many' } },
  { payload: { feature: 'scheduledPosts', limit: null } },
  { payload: { feature: 'scheduledPosts', limit: [4] } },
  { payload: { feature: 'scheduledPosts' } },
  { payload: { feature: 'scheduledPosts', limit: 1e21 } },
  { payload: { feature: 'postTimers', limit: 1 } },
  { payload: { feature: 'postTimers', limit: 3 } },
  { payload: { feature: 'conditionalTimers', limit: 1 } },
  { payload: { feature: 'conditionalTimers', limit: '5' } },
  { payload: { feature: 'conditionalTimers' } },
  { payload: { feature: 'other', limit: 3 } },
  { payload: {} },
  { payload: null },
  {},
  { payload: 'scheduledPosts' },
];

const errors = [
  null,
  undefined,
  0,
  '',
  {
    status: 402,
    code: 'QUOTA_EXCEEDED',
    payload: { feature: 'scheduledPosts', limit: 3 },
  },
  {
    status: 409,
    code: 'QUOTA_EXCEEDED',
    payload: { feature: 'conditionalTimers', limit: 1 },
  },
  { status: 409, code: 'QUOTA_EXCEEDED', payload: {} },
  { status: 409, code: 'QUOTA_EXCEEDED', feature: 'scheduledPosts', limit: 2 },
  {
    status: 409,
    code: 'QUOTA_EXCEEDED',
    payload: null,
    feature: 'postTimers',
    limit: 4,
  },
  { code: 'TIMER_PROBLEM', message: 'Pick a later delete time.' },
  { code: 'LIFESPAN', message: 'Pick a later delete time.' },
  { code: 'LIFESPAN' },
  { code: 'LIFESPAN', message: 42 },
  {
    code: 'REPEAT_INVALID',
    message: 'The date it ends on is before it first goes out.',
  },
  {
    status: 409,
    code: 'MEDIA_MISSING',
    detail:
      'part of this thread posted, but the images for the rest were cleared after 30 days. cancel it here and finish the thread by hand.',
  },
  { status: 409, code: 'MEDIA_MISSING' },
  { status: 409, code: 'MEDIA_MISSING', detail: '' },
  { status: 409, code: 'MEDIA_MISSING', detail: 'gone!   and so? yes… done' },
  { status: 409, code: 'MEDIA_MISSING', detail: 12 },
  { status: 401 },
  { status: 401, code: 'NOT_YOUR_CLIENT' },
  { status: 413 },
  { status: 500 },
  { status: 502, message: 'Virga’s server answered 502' },
  { status: '503' },
  { status: 499, detail: 'nope' },
  { status: 400, detail: 'a thread can have at most 25 posts' },
  { status: 400, detail: 'first.second sentence! third? fourth' },
  { status: 400, detail: '  leading and trailing space  ' },
  { status: 400, detail: 'ends with an ellipsis…' },
  { status: 400, detail: 'a.b c. d!\te? f.\ng' },
  { status: 400, detail: '.. x' },
  { status: 400, detail: 'éclair first. ünder. b' },
  { status: 400, detail: 'Already Capital. lower after' },
  { status: 400, message: 'only a message' },
  { message: 'only a message' },
  { message: 'two sentences. here' },
  { message: 'had a status', status: 0 },
  { message: '' },
  {},
  { status: 409 },
  { status: 404 },
  { code: 'UNKNOWN_CODE', status: 409 },
  { code: 'UNKNOWN_CODE', status: 409, detail: 'the server said so' },
  { code: ['TIMEOUT'] },
  { code: 5, message: 'numbered' },
  { code: null, message: 'nulled' },
  ...[
    'NEEDS_BACKEND',
    'QUEUE_REPLY',
    'REPLY_UNRESOLVED',
    'REPEAT_REPLY',
    'QUEUE_REPEAT',
    'NOT_SKIPPABLE',
    'NOT_REPEATING',
    'SCHEDULE_VIDEO',
    'MEDIA_TOO_LARGE',
    'IMAGE_TOO_LARGE',
    'IMAGE_MISSING',
    'TOO_MANY_IMAGES',
    'RECORD_UNRESOLVED',
    'SCHEDULE_INVALID',
    'SCHEDULE_PAST',
    'SCHEDULE_TOO_FAR',
    'EMPTY',
    'RATE_LIMITED',
    'NOT_RESCHEDULABLE',
    'PARTIALLY_PUBLISHED',
    'NOT_CANCELLABLE',
    'NOT_RETRIABLE',
    'NOT_ACKNOWLEDGEABLE',
    'NOT_REORDERABLE',
    'DELETE_TIME_TOO_EARLY',
    'NOT_REARMABLE',
    'NOT_YOUR_CLIENT',
    'UNAVAILABLE',
    'VIRGA_CLIENT_UNAVAILABLE',
    'TIMEOUT',
    'NETWORK_ERROR',
    'INTERNAL',
  ].map((code) => ({ status: 409, code, detail: 'x', message: 'y' })),
  { code: 'timeout' },
];

const reorderErrors = [
  null,
  undefined,
  {
    status: 409,
    code: 'DELETE_TIME_TOO_EARLY',
    detail: 'the delete time on "x" would come before…',
  },
  { status: 409, code: 'NOT_REORDERABLE' },
  { status: 400, code: 'NOT_REORDERABLE' },
  { status: 409 },
  { status: '409' },
  { status: 404, code: 'UNAVAILABLE' },
  { status: 405 },
  { reorderUnsupported: true },
  { reorderUnsupported: 'yes', status: 409 },
  { status: 500 },
  { status: 0, code: 'NETWORK_ERROR' },
  { status: 400, detail: 'too many moves' },
  { message: '' },
  {},
  { code: 'QUOTA_EXCEEDED', payload: { feature: 'scheduledPosts', limit: 1 } },
];

export default async function cases() {
  return [
    ...(await each('friendlyScheduleError', friendlyInputs, ({ raw, code }) =>
      friendlyScheduleError(raw, code),
    )),
    ...(await each('quotaMessage', quotaInputs, ({ payload }) =>
      quotaMessage(payload),
    )),
    ...(await each(
      'scheduleErrorMessage',
      errors.map((err) => ({ err })),
      ({ err }) => scheduleErrorMessage(err),
    )),
    ...(await each(
      'reorderRefusal',
      reorderErrors.map((err) => ({ err })),
      ({ err }) => reorderRefusal(err),
    )),
  ];
}
