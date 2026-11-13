// The wire contract of the three AI endpoints, as the client reads it
// (src/posting/adviser/aiService.js): the order of the checks, which answers
// carry `usage`, the 429 bodies it branches on, and that a request is counted
// only once it has a usable answer. The caller, the gateway's chat calls and
// the rate limit are stubbed; the monthly counters run for real over the
// Supabase fake, whose bump_ai_usage counts in its own tables.

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  afterAll,
} from 'vitest';
import { createFakeSupabase } from '../../test/fakeSupabase.js';
import { createReq, createRes } from '../../test/http.js';
import {
  resetSupabaseClientForTests,
  setSupabaseClientForTests,
} from '../../supabase.js';
import { AIGatewayError } from '../gateway.js';
import { MAX_BASE64_BYTES } from '../altTextPrompt.js';
import { currentMonthKey } from '../usage.js';

const mocks = vi.hoisted(() => ({
  resolveAiCaller: vi.fn(),
  enforce: vi.fn(),
  chatJSON: vi.fn(),
  chatDetailed: vi.fn(),
}));

vi.mock('../caller.js', () => ({ resolveAiCaller: mocks.resolveAiCaller }));
vi.mock('../rateLimit.js', async (importOriginal) => ({
  ...(await importOriginal()),
  enforce: mocks.enforce,
}));
vi.mock('../gateway.js', async (importOriginal) => ({
  ...(await importOriginal()),
  chatJSON: mocks.chatJSON,
  chatDetailed: mocks.chatDetailed,
}));

const { default: analyzePost } = await import('./analyzePost.js');
const { default: synthesizeStyle } = await import('./synthesizeStyle.js');
const { default: altText } = await import('./altText.js');

const DID = 'did:plc:endpointfixture';
const MONTH = currentMonthKey();

const ENV_KEYS = [
  'AI_GATEWAY_API_KEY',
  'AI_GATEWAY_REPORTING',
  'VERCEL_ENV',
  'AI_ADVISER_MONTHLY_LIMIT',
  'AI_STYLE_MONTHLY_LIMIT',
  'AI_ALT_TEXT_MONTHLY_LIMIT',
  'AI_MODEL_POSTING_ADVISER',
  'AI_MODEL_POSTING_ADVISER_FALLBACKS',
  'AI_MODEL_ALT_TEXT',
  'AI_MODEL_ALT_TEXT_FALLBACKS',
  'AI_MODEL_DEFAULT',
  'AI_MODEL_DEFAULT_FALLBACKS',
  'AI_MODEL_VISION_DEFAULT',
  'AI_MODEL_VISION_DEFAULT_FALLBACKS',
];
const SAVED_ENV = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

// bump_ai_usage as the fake plays it: one more in the allowance's column.
const PLACES = {
  adviser: ['posting_adviser_usage', 'count'],
  style: ['posting_adviser_usage', 'style_count'],
  altText: ['alt_text_usage', 'count'],
};
let fake;

function makeFake() {
  const f = createFakeSupabase({
    rpcAnswer: (name, args) => {
      if (name !== 'bump_ai_usage')
        return {
          data: null,
          error: { code: 'PGRST202', message: 'no such function' },
        };
      const [table, column] = PLACES[args.p_allowance];
      const rows = f.rowsOf(table);
      let row = rows.find(
        (r) => r.did === args.p_did && r.month === args.p_month,
      );
      if (!row) {
        row = {
          did: args.p_did,
          month: args.p_month,
          count: 0,
          style_count: 0,
        };
        rows.push(row);
      }
      row[column] += 1;
      return { data: row[column], error: null };
    },
  });
  return f;
}

const usedOf = (allowance) => {
  const [table, column] = PLACES[allowance];
  return (
    fake.rowsOf(table).find((r) => r.did === DID && r.month === MONTH)?.[
      column
    ] ?? 0
  );
};
const seed = (allowance, used) => {
  const [table, column] = PLACES[allowance];
  fake
    .rowsOf(table)
    .push({ did: DID, month: MONTH, count: 0, style_count: 0, [column]: used });
};

async function call(
  handler,
  body,
  { method = 'POST', headers = { authorization: 'Bearer vg_test' } } = {},
) {
  const res = createRes();
  await handler(createReq({ method, headers, body }), res);
  return res;
}

const ADVISER_BODY = {
  text: 'a draft about the porch light',
  goals: { customText: 'stay kind' },
};
const STYLE_BODY = { posts: ['one', 'two', 'three', 'four', 'five'] };
const ALT_BODY = { imageBase64: 'aGVsbG8=', mimeType: 'image/jpeg' };
const ADVISER_ANSWER = {
  sentiment: { label: 'positive', score: 0.4 },
  checks: [
    {
      id: 'custom',
      label: 'Stay kind',
      status: 'ok',
      note: 'Gentle.',
      excerpt: null,
    },
  ],
  suggestion: null,
  overallStatus: 'ok',
};

const ENDPOINTS = [
  ['analyze-post', () => analyzePost, ADVISER_BODY, 'adviser'],
  ['synthesize-style', () => synthesizeStyle, STYLE_BODY, 'style'],
  ['alt-text', () => altText, ALT_BODY, 'altText'],
];

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.AI_GATEWAY_API_KEY = 'test-key';
  for (const fn of Object.values(mocks)) fn.mockReset();
  fake = makeFake();
  setSupabaseClientForTests(fake);
  mocks.resolveAiCaller.mockResolvedValue({ ok: true, did: DID });
  mocks.enforce.mockResolvedValue({ allowed: true });
  mocks.chatJSON.mockImplementation(async (opts) =>
    opts.maxTokens === 3000
      ? { summary: 'short, warm, lowercase' }
      : ADVISER_ANSWER,
  );
  mocks.chatDetailed.mockResolvedValue({
    content: 'A porch light at night.',
    finishReason: 'stop',
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  resetSupabaseClientForTests();
  vi.restoreAllMocks();
});

afterAll(() => {
  for (const k of ENV_KEYS) {
    if (SAVED_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = SAVED_ENV[k];
  }
});

const gatewayCalls = () =>
  mocks.chatJSON.mock.calls.length + mocks.chatDetailed.mock.calls.length;

describe.each(ENDPOINTS)(
  '/api/ai/%s: the shared checks',
  (name, handlerOf, body, allowance) => {
    it('answers a preflight with 204 and any method but POST with 405', async () => {
      expect(
        (await call(handlerOf(), undefined, { method: 'OPTIONS' })).statusCode,
      ).toBe(204);
      const res = await call(handlerOf(), undefined, { method: 'GET' });
      expect(res.statusCode).toBe(405);
      expect(res.body.error).toBe('Method not allowed');
      expect(mocks.resolveAiCaller).not.toHaveBeenCalled();
    });

    it('passes a refused session on with its code, before anything else', async () => {
      mocks.resolveAiCaller.mockResolvedValue({
        ok: false,
        status: 401,
        error: 'Invalid or expired session',
        code: 'FRONTEND_SESSION_INVALID',
      });
      const res = await call(handlerOf(), body);
      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({
        error: 'Invalid or expired session',
        code: 'FRONTEND_SESSION_INVALID',
      });
      expect(fake.ops).toHaveLength(0);
      expect(mocks.enforce).not.toHaveBeenCalled();
      expect(gatewayCalls()).toBe(0);
    });

    it('answers 503 with no gateway key, reading and counting nothing', async () => {
      delete process.env.AI_GATEWAY_API_KEY;
      const res = await call(handlerOf(), body);
      expect(res.statusCode).toBe(503);
      expect(res.body).toEqual({
        error: 'AI help isn’t available right now.',
        code: 'AI_UNAVAILABLE',
      });
      expect(fake.ops).toHaveLength(0);
      expect(mocks.enforce).not.toHaveBeenCalled();
    });

    it('counts a success and says so in `usage`, never cached', async () => {
      const res = await call(handlerOf(), body);
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const limit = { adviser: 30, style: 3, altText: 15 }[allowance];
      expect(res.body.usage).toEqual({ used: 1, limit });
      expect(usedOf(allowance)).toBe(1);
      expect(fake.rpcs).toEqual([
        {
          name: 'bump_ai_usage',
          args: { p_allowance: allowance, p_did: DID, p_month: MONTH },
        },
      ]);
      expect(mocks.enforce).toHaveBeenCalledWith(DID);
    });

    it('carries no `usage` and counts nothing when the allowance is unlimited', async () => {
      process.env[
        {
          adviser: 'AI_ADVISER_MONTHLY_LIMIT',
          style: 'AI_STYLE_MONTHLY_LIMIT',
          altText: 'AI_ALT_TEXT_MONTHLY_LIMIT',
        }[allowance]
      ] = 'unlimited';
      const res = await call(handlerOf(), body);
      expect(res.statusCode).toBe(200);
      expect(res.body).not.toHaveProperty('usage');
      expect(fake.ops).toHaveLength(0);
      expect(fake.rpcs).toHaveLength(0);
      // The daily ceiling still applies.
      expect(mocks.enforce).toHaveBeenCalledTimes(1);
    });

    it('refuses over the month with { error, limit, used }, before the rate limit or the model', async () => {
      const limit = { adviser: 30, style: 3, altText: 15 }[allowance];
      seed(allowance, limit);
      const res = await call(handlerOf(), body);
      expect(res.statusCode).toBe(429);
      expect(res.body).toEqual({ error: 'monthly_limit', limit, used: limit });
      expect(mocks.enforce).not.toHaveBeenCalled();
      expect(gatewayCalls()).toBe(0);
    });

    it('refuses everything with a limit of 0', async () => {
      process.env[
        {
          adviser: 'AI_ADVISER_MONTHLY_LIMIT',
          style: 'AI_STYLE_MONTHLY_LIMIT',
          altText: 'AI_ALT_TEXT_MONTHLY_LIMIT',
        }[allowance]
      ] = '0';
      const res = await call(handlerOf(), body);
      expect(res.statusCode).toBe(429);
      expect(res.body).toEqual({ error: 'monthly_limit', limit: 0, used: 0 });
    });

    it('lets the request through when the count cannot be read', async () => {
      fake.failNext(PLACES[allowance][0], 'select');
      seed(allowance, 1000);
      expect((await call(handlerOf(), body)).statusCode).toBe(200);
    });

    it('passes a rate-limit refusal on as it came, without calling the model or counting', async () => {
      mocks.enforce.mockResolvedValue({
        allowed: false,
        status: 429,
        body: { error: 'rate_limited', scope: 'burst', retryAfterSec: 12 },
      });
      let res = await call(handlerOf(), body);
      expect(res.statusCode).toBe(429);
      expect(res.body).toEqual({
        error: 'rate_limited',
        scope: 'burst',
        retryAfterSec: 12,
      });
      mocks.enforce.mockResolvedValue({
        allowed: false,
        status: 429,
        body: { error: 'rate_limited', scope: 'daily', limit: 200 },
      });
      res = await call(handlerOf(), body);
      expect(res.body).toEqual({
        error: 'rate_limited',
        scope: 'daily',
        limit: 200,
      });
      expect(gatewayCalls()).toBe(0);
      expect(usedOf(allowance)).toBe(0);
    });

    it('does not count a failed model call, and keeps the gateway’s detail out of the answer', async () => {
      const failure = new AIGatewayError(
        'AI Gateway returned 400: {"error":{"message":"draft text echoed here","type":"invalid_request"}}',
        { status: 502 },
      );
      mocks.chatJSON.mockRejectedValue(failure);
      mocks.chatDetailed.mockRejectedValue(failure);
      const res = await call(handlerOf(), body);
      expect(res.statusCode).toBe(502);
      expect(res.body).toEqual({
        error: 'The AI service didn’t give a usable answer. Try again.',
      });
      expect(usedOf(allowance)).toBe(0);
      const logged = console.error.mock.calls.flat().join(' ');
      expect(logged).toContain(
        `[ai/${name}] 502: AI Gateway returned 400 (invalid_request)`,
      );
      expect(logged).not.toContain('draft text echoed here');
    });

    it('keeps a gateway timeout a 504 and a gateway 429 a 429', async () => {
      mocks.chatJSON.mockRejectedValue(
        new AIGatewayError('AI Gateway request timed out', { status: 504 }),
      );
      mocks.chatDetailed.mockRejectedValue(
        new AIGatewayError('AI Gateway request timed out', { status: 504 }),
      );
      let res = await call(handlerOf(), body);
      expect(res.statusCode).toBe(504);
      expect(res.body.error).toBe(
        'The AI service took too long to answer. Try again.',
      );
      mocks.chatJSON.mockRejectedValue(
        new AIGatewayError('AI Gateway returned 429: slow', { status: 429 }),
      );
      mocks.chatDetailed.mockRejectedValue(
        new AIGatewayError('AI Gateway returned 429: slow', { status: 429 }),
      );
      res = await call(handlerOf(), body);
      expect(res.statusCode).toBe(429);
      expect(res.body).not.toHaveProperty('code');
    });

    it('answers an unexpected error with a 500 and its own words', async () => {
      mocks.chatJSON.mockRejectedValue(new TypeError('x is not a function'));
      mocks.chatDetailed.mockRejectedValue(
        new TypeError('x is not a function'),
      );
      const res = await call(handlerOf(), body);
      expect(res.statusCode).toBe(500);
      expect(res.body.error).not.toContain('x is not a function');
    });

    it('tags the gateway call app:virga with its feature and the caller’s DID', async () => {
      await call(handlerOf(), body);
      const opts = (mocks.chatJSON.mock.calls[0] ||
        mocks.chatDetailed.mock.calls[0])[0];
      const feature = name === 'alt-text' ? 'alt-text' : 'posting-adviser';
      expect(opts.tags).toEqual(['app:virga', `feature:${feature}`]);
      expect(opts.user).toBe(DID);
      expect(opts.temperature).toBe(0.2);
    });

    it('takes a body Vercel left as a string', async () => {
      expect((await call(handlerOf(), JSON.stringify(body))).statusCode).toBe(
        200,
      );
    });
  },
);

describe('/api/ai/analyze-post', () => {
  it('needs some text, and no more than 8000 characters of it', async () => {
    for (const text of [undefined, '', '   ', 42]) {
      const res = await call(analyzePost, {
        text,
        goals: { customText: 'kind' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'Missing or empty "text"' });
    }
    const res = await call(analyzePost, {
      text: 'x'.repeat(8001),
      goals: { customText: 'kind' },
    });
    expect(res.statusCode).toBe(413);
    expect(res.body).toEqual({ error: 'Post text is too long to analyze' });
    expect(
      (
        await call(analyzePost, {
          text: 'x'.repeat(8000),
          goals: { customText: 'kind' },
        })
      ).statusCode,
    ).toBe(200);
    expect(mocks.enforce).toHaveBeenCalledTimes(1);
  });

  it('answers "ok" with nothing to check against, uncounted and unlimited', async () => {
    const res = await call(analyzePost, { text: 'a draft' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      sentiment: { label: 'neutral', score: 0 },
      checks: [],
      suggestion: null,
      overallStatus: 'ok',
    });
    expect(mocks.enforce).not.toHaveBeenCalled();
    expect(fake.ops).toHaveLength(0);
    expect(fake.rpcs).toHaveLength(0);
  });

  it('asks for the read on the adviser’s budget, keeping the answer out of the logs', async () => {
    await call(analyzePost, ADVISER_BODY);
    const opts = mocks.chatJSON.mock.calls[0][0];
    expect(opts).toMatchObject({
      model: 'google/gemini-3-flash',
      fallbackModels: ['anthropic/claude-sonnet-5'],
      maxTokens: 7600,
      logResponse: false,
    });
    expect(opts.messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(opts.messages[1].content).toContain('a draft about the porch light');
  });

  it('adds a proofread on the larger budget, and returns only fixes it can apply', async () => {
    mocks.chatJSON.mockResolvedValue({
      ...ADVISER_ANSWER,
      writing: {
        issues: [
          {
            type: 'typo',
            found: 'porch lihgt',
            replacement: 'porch light',
            note: 'Spelling.',
          },
          {
            type: 'typo',
            found: 'not in the draft',
            replacement: 'x',
            note: '',
          },
          {
            type: 'grammar',
            found: 'a draft',
            replacement: 'A draft',
            note: 'Not asked for.',
          },
        ],
      },
    });
    const res = await call(analyzePost, {
      text: 'a draft about the porch lihgt',
      writingChecks: { typos: true },
    });
    expect(mocks.chatJSON.mock.calls[0][0].maxTokens).toBe(8400);
    expect(res.body.writing).toEqual({
      issues: [
        {
          type: 'typo',
          found: 'porch lihgt',
          replacement: 'porch light',
          note: 'Spelling.',
        },
      ],
    });
    expect(res.body.usage).toEqual({ used: 1, limit: 30 });
  });

  it('cleans the model’s read into the shape the client draws', async () => {
    mocks.chatJSON.mockResolvedValue({
      sentiment: { label: 'negative', score: '-0.5' },
      checks: [
        {
          id: 'custom',
          label: 'Stay kind',
          status: 'conflict',
          note: 'Harsh.',
          excerpt: 'porch light',
        },
        {
          id: 'other',
          label: 'Other',
          status: 'weird',
          note: 'n',
          excerpt: 'porch light',
        },
      ],
      suggestion: 42,
      overallStatus: 'unknown',
    });
    const res = await call(analyzePost, ADVISER_BODY);
    expect(res.body).toEqual({
      sentiment: { label: 'negative', score: -0.5 },
      checks: [
        {
          id: 'custom',
          label: 'Stay kind',
          status: 'conflict',
          note: 'Harsh.',
          excerpt: 'porch light',
        },
        { id: 'other', label: 'Other', status: 'ok', note: 'n', excerpt: null },
      ],
      suggestion: null,
      overallStatus: 'conflict',
      usage: { used: 1, limit: 30 },
    });
  });

  it('reads with the conversation it joins, and counts the second read as the second', async () => {
    const body = {
      text: 'I disagree',
      context: {
        kind: 'reply',
        target: { author: 'sam', text: 'Moths are great' },
      },
    };
    await call(analyzePost, body);
    const res = await call(analyzePost, body);
    expect(mocks.chatJSON.mock.calls[0][0].messages[1].content).toContain(
      'sam: Moths are great',
    );
    expect(res.body.usage).toEqual({ used: 2, limit: 30 });
  });

  it('counts against the limit set in the environment', async () => {
    process.env.AI_ADVISER_MONTHLY_LIMIT = '2';
    seed('adviser', 1);
    expect((await call(analyzePost, ADVISER_BODY)).body.usage).toEqual({
      used: 2,
      limit: 2,
    });
    expect((await call(analyzePost, ADVISER_BODY)).body).toEqual({
      error: 'monthly_limit',
      limit: 2,
      used: 2,
    });
  });
});

describe('/api/ai/synthesize-style', () => {
  it('needs five usable posts, uncounted when it has fewer', async () => {
    const res = await call(synthesizeStyle, {
      posts: ['one', ' ', { text: 'two' }, 'three', 'four'],
    });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'not_enough_posts', minimum: 5 });
    expect(mocks.enforce).not.toHaveBeenCalled();
    expect(fake.ops).toHaveLength(0);
  });

  it('answers the profile and how many posts it read', async () => {
    const res = await call(synthesizeStyle, {
      posts: ['one', 'two', { text: 'three' }, 'four', 'five', 'six'],
    });
    expect(res.body).toEqual({
      summary: 'short, warm, lowercase',
      analyzedCount: 6,
      usage: { used: 1, limit: 3 },
    });
    const opts = mocks.chatJSON.mock.calls[0][0];
    expect(opts).toMatchObject({
      maxTokens: 3000,
      logResponse: false,
      model: 'google/gemini-3-flash',
    });
  });

  it('folds the writer’s guidance and the earlier profile into the prompt', async () => {
    await call(synthesizeStyle, {
      ...STYLE_BODY,
      guidance: 'i capitalize names on purpose',
      previousSummary: 'Writes in lowercase.',
    });
    const prompt = mocks.chatJSON.mock.calls[0][0].messages[1].content;
    expect(prompt).toContain('i capitalize names on purpose');
    expect(prompt).toContain('Writes in lowercase.');
  });

  it('answers 502 for an empty profile, uncounted', async () => {
    mocks.chatJSON.mockResolvedValue({ summary: '   ' });
    const res = await call(synthesizeStyle, STYLE_BODY);
    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({
      error: 'Could not synthesize a style profile — try again.',
    });
    expect(usedOf('style')).toBe(0);
  });

  it('keeps its own allowance apart from the adviser’s', async () => {
    seed('adviser', 30);
    const res = await call(synthesizeStyle, STYLE_BODY);
    expect(res.statusCode).toBe(200);
    expect(usedOf('style')).toBe(1);
    expect(usedOf('adviser')).toBe(30);
  });
});

describe('/api/ai/alt-text', () => {
  it('needs an image of a type it takes, under the size cap', async () => {
    let res = await call(altText, { mimeType: 'image/png' });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Missing "imageBase64"' });
    for (const mimeType of [
      undefined,
      'image/svg+xml',
      'image/heic',
      'text/plain',
    ]) {
      res = await call(altText, { imageBase64: 'aGVsbG8=', mimeType });
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'Missing or unsupported "mimeType"' });
    }
    for (const mimeType of [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
    ]) {
      expect(
        (await call(altText, { imageBase64: 'aGVsbG8=', mimeType })).statusCode,
      ).toBe(200);
    }
    res = await call(altText, {
      imageBase64: 'a'.repeat(MAX_BASE64_BYTES + 1),
      mimeType: 'image/png',
    });
    expect(res.statusCode).toBe(413);
    expect(res.body).toEqual({ error: 'Image is too large to analyze' });
  });

  it('keeps the cap under Vercel’s 4.5 MB body limit', () => {
    expect(MAX_BASE64_BYTES).toBeLessThan(4.5 * 1000 * 1000);
  });

  it('describes the image on the vision model and counts it', async () => {
    const res = await call(altText, {
      ...ALT_BODY,
      context: 'my porch tonight',
    });
    expect(res.body).toEqual({
      altText: 'A porch light at night.',
      usage: { used: 1, limit: 15 },
    });
    const opts = mocks.chatDetailed.mock.calls[0][0];
    expect(opts).toMatchObject({
      model: 'anthropic/claude-haiku-4.5',
      fallbackModels: ['anthropic/claude-sonnet-5'],
      maxTokens: 6400,
    });
    expect(opts.messages[0].content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,aGVsbG8=' },
    });
    expect(opts.messages[0].content[0].text).toContain('my porch tonight');
  });

  it('does not count a description it could not get', async () => {
    mocks.chatDetailed.mockResolvedValue({ content: '', finishReason: 'stop' });
    const res = await call(altText, ALT_BODY);
    expect(res.statusCode).toBe(502);
    expect(usedOf('altText')).toBe(0);
  });
});
