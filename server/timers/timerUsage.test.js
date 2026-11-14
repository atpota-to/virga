import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFakeSupabase } from '../test/fakeSupabase.js';
import { deps } from './selfDestruct.js';
import {
  BUCKET_FEATURE,
  TimerLimitError,
  countTimerUsage,
  countTimersByBucket,
  enforceTimerLimit,
  settleArmedTimer,
  timerBucket,
  timerLimitFor,
} from './timerUsage.js';

// What a slot is (the bucket), how slots are counted, and what an unreadable
// count means: never a zero, and never a refusal. The same reads over real
// Postgres are in selfDestruct.pglite.test.js.

const DID = 'did:plc:writer';
const PLAIN = { conditions: {}, effects: null };
const CONDITIONAL = { conditions: { sense: 'unless', clauses: [{ metric: 'replies', op: 'gte', value: 1 }] }, effects: null };
const GATE_ONLY = { conditions: {}, effects: [{ action: 'disableQuotes' }] };

const realGet = deps.getSupabaseClient;
let fake;
const live = (id, spec, extra = {}) => ({
  id, user_did: DID, post_uri: `at://${DID}/app.bsky.feed.post/${id}`, status: 'armed',
  created_at: `2026-10-08T10:00:0${id.length}Z`, ...spec, ...extra,
});
const waiting = (id, spec, status = 'pending') => ({
  id, user_did: DID, status, payload: { posts: [], selfDestruct: spec ? { lifespanSeconds: 3600, ...spec } : null },
});

beforeEach(() => {
  fake = createFakeSupabase();
  deps.getSupabaseClient = () => fake;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  deps.getSupabaseClient = realGet;
  vi.restoreAllMocks();
});

describe('timerBucket', () => {
  it('calls a lifespan that only deletes plain', () => {
    expect(timerBucket(PLAIN)).toBe('plain');
    expect(timerBucket({ conditions: null, effects: [{ action: 'delete' }] })).toBe('plain');
    expect(timerBucket()).toBe('plain');
  });

  it('calls a rule that reads counts, or does anything but delete, conditional', () => {
    expect(timerBucket(CONDITIONAL)).toBe('conditional');
    expect(timerBucket(GATE_ONLY)).toBe('conditional');
    expect(timerBucket({ conditions: {}, effects: [{ action: 'disableQuotes' }, { action: 'delete' }] })).toBe('conditional');
  });

  it('names the limits feature behind each bucket, as /api/limits/status does', () => {
    expect(BUCKET_FEATURE).toEqual({ plain: 'postTimers', conditional: 'conditionalTimers' });
  });
});

describe('timerLimitFor', () => {
  it('reads a positive integer from the environment, and anything else as unlimited', () => {
    expect(timerLimitFor('plain', {})).toBeNull();
    expect(timerLimitFor('plain', { POST_TIMERS_LIMIT: '3' })).toBe(3);
    expect(timerLimitFor('conditional', { CONDITIONAL_TIMERS_LIMIT: '1' })).toBe(1);
    expect(timerLimitFor('conditional', { POST_TIMERS_LIMIT: '1' })).toBeNull();
    expect(timerLimitFor('plain', { POST_TIMERS_LIMIT: '0' })).toBeNull();
    expect(timerLimitFor('plain', { POST_TIMERS_LIMIT: 'many' })).toBeNull();
    expect(timerLimitFor('nonsense', { POST_TIMERS_LIMIT: '3' })).toBeNull();
  });
});

describe('TimerLimitError', () => {
  it('carries what the client words the refusal from', () => {
    const one = new TimerLimitError('conditional', 1);
    expect(one).toMatchObject({ code: 'QUOTA_EXCEEDED', feature: 'conditionalTimers', limit: 1, statusCode: 409 });
    expect(one.message).toBe('this account can keep one conditional timer at a time, counting scheduled posts.');
    expect(new TimerLimitError('plain', 3).message).toBe('this account can keep 3 plain timers at a time, counting scheduled posts.');
  });
});

describe('countTimerUsage', () => {
  it('counts live timers by kind, ignoring settled ones, other accounts and scheduled posts', async () => {
    fake.rowsOf('self_destruct_posts').push(
      live('a', PLAIN),
      live('bb', CONDITIONAL, { status: 'checking' }),
      live('ccc', GATE_ONLY),
      live('dddd', PLAIN, { status: 'deleted' }),
      live('eeeee', PLAIN, { user_did: 'did:plc:someone' }),
    );
    fake.rowsOf('scheduled_posts').push(waiting('s1', PLAIN));
    await expect(countTimerUsage(DID)).resolves.toEqual({ postTimers: 1, conditionalTimers: 2 });
  });

  it('reports an unreadable count as unknown, not zero', async () => {
    fake.failNext('self_destruct_posts', 'select');
    await expect(countTimerUsage(DID)).resolves.toEqual({ postTimers: null, conditionalTimers: null });
    deps.getSupabaseClient = () => null;
    await expect(countTimerUsage(DID)).resolves.toEqual({ postTimers: null, conditionalTimers: null });
  });
});

describe('countTimersByBucket', () => {
  it('adds waiting scheduled posts that carry a timer, leaving out the replaced ones', async () => {
    fake.rowsOf('self_destruct_posts').push(live('a', PLAIN), live('bb', CONDITIONAL));
    fake.rowsOf('scheduled_posts').push(
      waiting('s1', PLAIN),
      waiting('s2', CONDITIONAL, 'publishing'),
      waiting('s3', PLAIN, 'published'),
      waiting('s4', null),
    );
    await expect(countTimersByBucket(DID)).resolves.toEqual({ plain: 2, conditional: 2 });
    await expect(countTimersByBucket(DID, { exceptPostUri: `at://${DID}/app.bsky.feed.post/a`, exceptScheduledId: 's2' }))
      .resolves.toEqual({ plain: 1, conditional: 1 });
  });

  it('is unknown when either read fails', async () => {
    fake.failNext('scheduled_posts', 'select');
    await expect(countTimersByBucket(DID)).resolves.toBeNull();
    fake.clearFailures();
    fake.failNext('self_destruct_posts', 'select');
    await expect(countTimersByBucket(DID)).resolves.toBeNull();
  });
});

describe('enforceTimerLimit', () => {
  it('counts nothing for an unlimited bucket', async () => {
    await expect(enforceTimerLimit({ userDid: DID, ...CONDITIONAL }, {})).resolves.toEqual({ bucket: 'conditional', limit: null });
    expect(fake.ops).toEqual([]);
  });

  it('refuses a full bucket, and lets the other through', async () => {
    const env = { POST_TIMERS_LIMIT: '1', CONDITIONAL_TIMERS_LIMIT: '1' };
    fake.rowsOf('self_destruct_posts').push(live('a', PLAIN));
    await expect(enforceTimerLimit({ userDid: DID, ...PLAIN }, env)).rejects.toBeInstanceOf(TimerLimitError);
    await expect(enforceTimerLimit({ userDid: DID, ...CONDITIONAL }, env)).resolves.toEqual({ bucket: 'conditional', limit: 1 });
  });

  it('lets a timer through when the count cannot be read, rather than refuse a writer over a blip', async () => {
    fake.failNext('self_destruct_posts', 'select');
    await expect(enforceTimerLimit({ userDid: DID, ...PLAIN }, { POST_TIMERS_LIMIT: '1' })).resolves.toEqual({ bucket: 'plain', limit: 1 });
  });
});

describe('settleArmedTimer', () => {
  it('does nothing for an unlimited bucket', async () => {
    await settleArmedTimer({ userDid: DID, row: live('a', PLAIN), verdict: { bucket: 'plain', limit: null } });
    expect(fake.ops).toEqual([]);
  });

  it('keeps the earliest timers and calls off the one past the limit', async () => {
    const first = live('a', PLAIN, { created_at: '2026-10-08T10:00:00Z' });
    const second = live('b', PLAIN, { created_at: '2026-10-08T10:00:05Z' });
    fake.rowsOf('self_destruct_posts').push(second, first);
    const verdict = { bucket: 'plain', limit: 1 };
    await expect(settleArmedTimer({ userDid: DID, row: first, verdict })).resolves.toBeUndefined();
    await expect(settleArmedTimer({ userDid: DID, row: second, verdict })).rejects.toMatchObject({ feature: 'postTimers', limit: 1 });
    expect(fake.rowsOf('self_destruct_posts').find((r) => r.id === 'b').status).toBe('cancelled');
    expect(fake.rowsOf('self_destruct_posts').find((r) => r.id === 'a').status).toBe('armed');
  });

  it('lets the timer stand when it cannot be called off, rather than refuse a timer that is still live', async () => {
    fake.rowsOf('self_destruct_posts').push(live('a', PLAIN), live('b', PLAIN));
    fake.failNext('self_destruct_posts', 'update');
    await expect(settleArmedTimer({ userDid: DID, row: live('b', PLAIN), verdict: { bucket: 'plain', limit: 1 } }))
      .resolves.toBeUndefined();
  });

  it('decides nothing when the counts cannot be read', async () => {
    fake.rowsOf('self_destruct_posts').push(live('a', PLAIN), live('b', PLAIN));
    fake.failNext('scheduled_posts', 'select');
    await expect(settleArmedTimer({ userDid: DID, row: live('b', PLAIN), verdict: { bucket: 'plain', limit: 1 } }))
      .resolves.toBeUndefined();
    expect(fake.rowsOf('self_destruct_posts').every((r) => r.status === 'armed')).toBe(true);
  });
});
