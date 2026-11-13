// Flat limits from env, what an account has in use, and GET /api/limits/status
// (client-contract §2.9), on the real tables in PGlite.

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import { createTestDatabase } from '../test/pglite.js';
import { createReq, createRes } from '../test/http.js';
import {
  setSupabaseClientForTests,
  resetSupabaseClientForTests,
} from '../supabase.js';
import {
  maxPending,
  maxLiveTimers,
  featureLimit,
  featureStatus,
  scheduledPostsCeiling,
  featureUsage,
  quotaBody,
  QuotaExceededError,
  LIMIT_FEATURES,
} from './limits.js';

const auth = vi.hoisted(() => ({ resolveUserDid: vi.fn() }));
vi.mock('../oauth/auth.js', () => auth);

const { default: status } = await import('./handlers/status.js');

const DID = 'did:plc:limitsreader0000000000000';
const OTHER = 'did:plc:limitsother00000000000000';

let t;
beforeAll(async () => {
  t = await createTestDatabase({ upTo: '20261113000300' });
});
afterAll(async () => {
  await t?.close();
});
beforeEach(async () => {
  await t.exec('TRUNCATE scheduled_posts; TRUNCATE self_destruct_posts');
  setSupabaseClientForTests(t.supabase);
  auth.resolveUserDid.mockReset();
  auth.resolveUserDid.mockResolvedValue({
    userDid: DID,
    status: 200,
    error: null,
    code: null,
  });
});
afterEach(() => {
  resetSupabaseClientForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const CONDITIONAL = {
  sense: 'unless',
  clauses: [{ metric: 'likes', op: 'gte', value: 5 }],
};

async function scheduledRow(did, statusName, selfDestruct) {
  await t.query(
    `INSERT INTO scheduled_posts (user_did, scheduled_for, status, payload) VALUES ($1, NOW() + INTERVAL '1 hour', $2, $3::jsonb)`,
    [
      did,
      statusName,
      JSON.stringify({
        posts: [{ record: { text: 'x' } }],
        ...(selfDestruct ? { selfDestruct } : {}),
      }),
    ],
  );
}

let rkey = 0;
async function timerRow(
  did,
  statusName,
  { conditions = {}, effects = null } = {},
) {
  rkey += 1;
  await t.query(
    `INSERT INTO self_destruct_posts (user_did, post_uri, rkey, check_at, status, conditions, effects, lifespan_seconds)
     VALUES ($1, $2, $3, NOW() + INTERVAL '1 hour', $4, $5::jsonb, $6::jsonb, 3600)`,
    [
      did,
      `at://${did}/app.bsky.feed.post/3k${rkey}`,
      `3k${rkey}`,
      statusName,
      JSON.stringify(conditions),
      effects ? JSON.stringify(effects) : null,
    ],
  );
}

async function getStatus() {
  const res = createRes();
  await status(
    createReq({ method: 'GET', headers: { authorization: 'Bearer vg_test' } }),
    res,
  );
  return res;
}

describe('flat limits from env', () => {
  it('defaults the caps to 50 scheduled posts and 200 timers', () => {
    expect(maxPending({})).toBe(50);
    expect(maxLiveTimers({})).toBe(200);
    expect(maxPending({ SCHEDULE_MAX_PENDING: '12' })).toBe(12);
    expect(maxPending({ SCHEDULE_MAX_PENDING: '0' })).toBe(50);
    expect(maxPending({ SCHEDULE_MAX_PENDING: 'lots' })).toBe(50);
    expect(maxLiveTimers({ TIMER_MAX_ACTIVE_PER_USER: '20' })).toBe(20);
  });

  it('reads at call time', () => {
    vi.stubEnv('SCHEDULE_MAX_PENDING', '7');
    expect(maxPending()).toBe(7);
    vi.stubEnv('SCHEDULE_MAX_PENDING', '8');
    expect(maxPending()).toBe(8);
  });

  it('leaves every feature unlimited unless its limit is set', () => {
    expect(LIMIT_FEATURES).toEqual([
      'scheduledPosts',
      'postTimers',
      'conditionalTimers',
    ]);
    expect(featureStatus({})).toEqual({
      scheduledPosts: { isUnlimited: true, limit: null },
      postTimers: { isUnlimited: true, limit: null },
      conditionalTimers: { isUnlimited: true, limit: null },
    });
    expect(
      featureStatus({
        SCHEDULED_POSTS_LIMIT: '10',
        POST_TIMERS_LIMIT: '3',
        CONDITIONAL_TIMERS_LIMIT: '1',
      }),
    ).toEqual({
      scheduledPosts: { isUnlimited: false, limit: 10 },
      postTimers: { isUnlimited: false, limit: 3 },
      conditionalTimers: { isUnlimited: false, limit: 1 },
    });
    expect(
      featureLimit('scheduledPosts', { SCHEDULED_POSTS_LIMIT: '' }),
    ).toBeNull();
    expect(
      featureLimit('somethingElse', { SCHEDULED_POSTS_LIMIT: '3' }),
    ).toBeNull();
  });

  it('takes the lower of the cap and the scheduled-posts limit as the ceiling', () => {
    expect(scheduledPostsCeiling({})).toBe(50);
    expect(scheduledPostsCeiling({ SCHEDULED_POSTS_LIMIT: '5' })).toBe(5);
    expect(scheduledPostsCeiling({ SCHEDULED_POSTS_LIMIT: '500' })).toBe(50);
  });

  it('shapes a refusal as the client reads it', () => {
    const err = new QuotaExceededError('scheduledPosts', 5);
    expect(err).toMatchObject({
      code: 'QUOTA_EXCEEDED',
      status: 409,
      nonRetryable: true,
    });
    expect(quotaBody(err)).toEqual({
      success: false,
      error: 'you can have at most 5 scheduled posts',
      code: 'QUOTA_EXCEEDED',
      feature: 'scheduledPosts',
      limit: 5,
    });
    expect(quotaBody({ message: 'flat', code: 'QUOTA_EXCEEDED' })).toEqual({
      success: false,
      error: 'flat',
      code: 'QUOTA_EXCEEDED',
    });
  });
});

describe('featureUsage', () => {
  it('counts waiting scheduled posts, and live timers plus scheduled ones per kind', async () => {
    await scheduledRow(DID, 'pending');
    await scheduledRow(DID, 'publishing', { lifespanSeconds: 3600 });
    await scheduledRow(DID, 'pending', {
      lifespanSeconds: 3600,
      conditions: CONDITIONAL,
    });
    await scheduledRow(DID, 'failed', { lifespanSeconds: 3600 });
    await scheduledRow(DID, 'published');
    await scheduledRow(OTHER, 'pending', { lifespanSeconds: 3600 });
    await timerRow(DID, 'armed');
    await timerRow(DID, 'checking', {
      effects: [{ action: 'limitReplies', allow: ['follower'] }],
    });
    await timerRow(DID, 'deleted');
    await timerRow(OTHER, 'armed');
    expect(await featureUsage(DID)).toEqual({
      scheduledPosts: 3,
      postTimers: 2,
      conditionalTimers: 2,
    });
  });

  it('answers null for a count it can’t read, never 0', async () => {
    const bare = await createTestDatabase({ upTo: '20261113000200' });
    setSupabaseClientForTests(bare.supabase);
    try {
      expect(await featureUsage(DID)).toEqual({
        scheduledPosts: 0,
        postTimers: null,
        conditionalTimers: null,
      });
    } finally {
      await bare.close();
    }
    setSupabaseClientForTests(null);
    expect(await featureUsage(DID)).toEqual({
      scheduledPosts: null,
      postTimers: null,
      conditionalTimers: null,
    });
  });
});

describe('GET /api/limits/status', () => {
  it('reports the flat policy, unlimited features, usage and caps', async () => {
    await scheduledRow(DID, 'pending');
    await scheduledRow(DID, 'pending');
    await timerRow(DID, 'armed', { conditions: CONDITIONAL });
    const res = await getStatus();
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      success: true,
      policy: 'flat',
      tier: null,
      isMember: false,
      features: {
        scheduledPosts: { isUnlimited: true, limit: null },
        postTimers: { isUnlimited: true, limit: null },
        conditionalTimers: { isUnlimited: true, limit: null },
      },
      usage: { scheduledPosts: 2, postTimers: 0, conditionalTimers: 1 },
      caps: { scheduledPosts: 50, timers: 200 },
    });
  });

  it('reports configured limits and caps from env', async () => {
    vi.stubEnv('SCHEDULED_POSTS_LIMIT', '10');
    vi.stubEnv('CONDITIONAL_TIMERS_LIMIT', '1');
    vi.stubEnv('SCHEDULE_MAX_PENDING', '40');
    vi.stubEnv('TIMER_MAX_ACTIVE_PER_USER', '100');
    const { body } = await getStatus();
    expect(body.features).toEqual({
      scheduledPosts: { isUnlimited: false, limit: 10 },
      postTimers: { isUnlimited: true, limit: null },
      conditionalTimers: { isUnlimited: false, limit: 1 },
    });
    expect(body.caps).toEqual({ scheduledPosts: 40, timers: 100 });
  });

  it('answers with null usage rather than failing when counts can’t be read', async () => {
    setSupabaseClientForTests(null);
    const res = await getStatus();
    expect(res.statusCode).toBe(200);
    expect(res.body.usage).toEqual({
      scheduledPosts: null,
      postTimers: null,
      conditionalTimers: null,
    });
  });

  it('passes the session check’s answer through', async () => {
    auth.resolveUserDid.mockResolvedValue({
      userDid: null,
      status: 401,
      error: 'Invalid or expired session',
      code: 'FRONTEND_SESSION_INVALID',
    });
    const res = await getStatus();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      success: false,
      error: 'Invalid or expired session',
      code: 'FRONTEND_SESSION_INVALID',
    });
  });

  it('answers OPTIONS 204 and POST 405', async () => {
    const options = createRes();
    await status(createReq({ method: 'OPTIONS' }), options);
    expect(options.statusCode).toBe(204);
    const wrong = createRes();
    await status(createReq({ method: 'POST' }), wrong);
    expect(wrong.statusCode).toBe(405);
  });

  it('answers an unexpected failure as 500 INTERNAL without its words', async () => {
    auth.resolveUserDid.mockRejectedValue(new Error('session table secret'));
    const res = await getStatus();
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({
      success: false,
      error: "couldn't read this account's limits. please try again.",
      code: 'INTERNAL',
    });
  });
});
