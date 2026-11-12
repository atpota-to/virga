import { describe, expect, it, vi } from 'vitest';
import {
  aiErrorMessage,
  analyzePost,
  generateAltText,
  generateAltTextForFile,
  synthesizeStyle,
} from './aiService.js';
import {
  isAdviserAtLimit,
  markAdviserLimitReached,
  readAdviserUsage,
  recordAdviserUsage,
} from './usage.js';

const DID = 'did:plc:writer';

function memoryStore() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
}

/**
 * A Requester as the session layer builds it: resolves to the whole body,
 * throws `{ status, code, detail, payload }` for a non-2xx answer.
 */
function requester(answer) {
  const calls = [];
  const req = {
    did: DID,
    calls,
    request: vi.fn(async (path, options) => {
      calls.push({ path, ...options });
      const value = typeof answer === 'function' ? answer(options) : answer;
      if (value instanceof Error) throw value;
      return value;
    }),
  };
  return req;
}

const req0 = () => requester({ overallStatus: 'ok', checks: [] });

function cocoonError(status, body) {
  const code =
    body?.code ??
    (typeof body?.error === 'string' && /^[a-z_]+$/.test(body.error)
      ? body.error
      : null);
  return Object.assign(new Error(body?.error || `HTTP ${status}`), {
    status,
    code,
    detail: typeof body?.error === 'string' ? body.error : null,
    payload: body,
  });
}

describe('analyzePost', () => {
  it('posts the read to cocoon as the posting account, naming no account or membership', async () => {
    const req = requester({ overallStatus: 'ok', checks: [] });
    const store = memoryStore();
    const result = await analyzePost(
      req,
      {
        text: 'a draft',
        goals: { presets: { reduceNegativity: true }, customText: '' },
        scenario: 'reply',
        context: { kind: 'reply', thread: [], target: null },
        writingChecks: { typos: true },
      },
      { store },
    );
    expect(result).toEqual({ overallStatus: 'ok', checks: [] });
    expect(req.calls[0]).toMatchObject({
      path: '/api/ai/analyze-post',
      method: 'POST',
      timeoutMs: 30_000,
      body: {
        text: 'a draft',
        goals: { presets: { reduceNegativity: true }, customText: '' },
        scenario: 'reply',
        context: { kind: 'reply', thread: [], target: null },
        writingChecks: { typos: true },
      },
    });
    expect(req.calls[0].body).not.toHaveProperty('did');
    expect(req.calls[0].body).not.toHaveProperty('member');
  });

  it('leaves out what the read doesn’t have', async () => {
    const req = requester({});
    await analyzePost(req, { text: 'hi' }, { store: memoryStore() });
    expect(req.calls[0].body).toEqual({ text: 'hi' });
  });

  it('keeps the month’s count cocoon answers with', async () => {
    const store = memoryStore();
    const req = requester({
      overallStatus: 'ok',
      usage: { used: 7, limit: 30 },
    });
    await analyzePost(req, { text: 'hi' }, { store });
    expect(readAdviserUsage(DID, { store })).toMatchObject({
      used: 7,
      limit: 30,
    });
  });

  it('remembers the month is used up when cocoon refuses with monthly_limit', async () => {
    const store = memoryStore();
    const req = requester(
      cocoonError(429, { error: 'monthly_limit', limit: 30, used: 30 }),
    );
    const err = await analyzePost(req, { text: 'hi' }, { store }).catch(
      (e) => e,
    );
    expect(err.code).toBe('monthly_limit');
    expect(err.status).toBe(429);
    expect(err.payload).toMatchObject({ limit: 30 });
    expect(err.message).toMatch(/used up/);
    expect(isAdviserAtLimit(DID, { store })).toBe(true);
  });

  it('forgets a used-up count once cocoon answers without usage (now unlimited)', async () => {
    const store = memoryStore();
    markAdviserLimitReached(DID, 30, { store });
    recordAdviserUsage(DID, { used: 2, limit: 3 }, { feature: 'style', store });
    expect(isAdviserAtLimit(DID, { store })).toBe(true);
    await analyzePost(req0(), { text: 'hi' }, { store });
    expect(readAdviserUsage(DID, { store })).toBeNull();
    expect(isAdviserAtLimit(DID, { store })).toBe(false);
    // Only the feature that answered.
    expect(readAdviserUsage(DID, { feature: 'style', store })).toMatchObject({
      used: 2,
      limit: 3,
    });
  });

  it('keeps the count when the request fails for another reason', async () => {
    const store = memoryStore();
    markAdviserLimitReached(DID, 30, { store });
    const req = requester(cocoonError(503, { error: 'AI unavailable' }));
    await analyzePost(req, { text: 'hi' }, { store }).catch(() => {});
    expect(isAdviserAtLimit(DID, { store })).toBe(true);
  });

  it('sends nothing for a read that already ended', async () => {
    const req = requester({});
    const controller = new AbortController();
    controller.abort();
    await expect(
      analyzePost(req, { text: 'hi' }, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(req.request).not.toHaveBeenCalled();
  });

  it('doesn’t hand the signal to a request already sent', async () => {
    const req = requester({});
    const controller = new AbortController();
    await analyzePost(
      req,
      { text: 'hi' },
      { signal: controller.signal, store: memoryStore() },
    );
    expect(req.calls[0].signal).toBeUndefined();
  });

  it('needs a draft', async () => {
    const req = requester({});
    await expect(analyzePost(req, { text: '  ' })).rejects.toMatchObject({
      code: 'EMPTY',
    });
  });

  it('needs an account signed in through Virga’s server', async () => {
    await expect(analyzePost(null, { text: 'hi' })).rejects.toMatchObject({
      code: 'NEEDS_BACKEND',
    });
  });
});

describe('synthesizeStyle', () => {
  it('answers with the reading and how many posts it used', async () => {
    const store = memoryStore();
    const req = requester({
      summary: ' Lowercase. ',
      analyzedCount: 40,
      usage: { used: 1, limit: 3 },
    });
    const result = await synthesizeStyle(
      req,
      { posts: ['a'], guidance: '' },
      { store },
    );
    expect(req.calls[0].path).toBe('/api/ai/synthesize-style');
    expect(req.calls[0].body).toEqual({ posts: ['a'] });
    expect(result).toEqual({
      summary: 'Lowercase.',
      analyzedCount: 40,
      usage: { used: 1, limit: 3 },
    });
    expect(readAdviserUsage(DID, { feature: 'style', store }).used).toBe(1);
  });

  it('passes cocoon’s not_enough_posts through with its code', async () => {
    const req = requester(
      cocoonError(400, { error: 'not_enough_posts', minimum: 5 }),
    );
    const err = await synthesizeStyle(req, { posts: [] }).catch((e) => e);
    expect(err.code).toBe('not_enough_posts');
    expect(err.message).toMatch(/at least 5/);
  });
});

describe('generateAltText', () => {
  const base = { imageBase64: 'AAAA', mimeType: 'image/png' };

  it('sends quick-note ids and the kind alongside the note', async () => {
    const req = requester({ altText: 'x' });
    await generateAltText(
      req,
      {
        ...base,
        followUp: 'Make it shorter.',
        previousAltText: 'Settings.',
        presets: ['shorter'],
        kind: 'interface',
      },
      { store: memoryStore() },
    );
    expect(req.calls[0].path).toBe('/api/ai/alt-text');
    expect(req.calls[0].body).toEqual({
      ...base,
      followUp: 'Make it shorter.',
      previousAltText: 'Settings.',
      presets: ['shorter'],
      kind: 'interface',
    });
  });

  it('leaves both out when there are none', async () => {
    const req = requester({ altText: 'x' });
    await generateAltText(
      req,
      { ...base, presets: [], kind: null },
      { store: memoryStore() },
    );
    expect(req.calls[0].body).not.toHaveProperty('presets');
    expect(req.calls[0].body).not.toHaveProperty('kind');
  });

  it('reports the month’s count when cocoon sends one, and keeps it', async () => {
    const store = memoryStore();
    const req = requester({
      altText: ' A settings screen. ',
      usage: { used: 4, limit: 15 },
    });
    const onUsage = vi.fn();
    expect(await generateAltText(req, { ...base, onUsage }, { store })).toBe(
      'A settings screen.',
    );
    expect(onUsage).toHaveBeenCalledWith({ used: 4, limit: 15 });
    expect(readAdviserUsage(DID, { feature: 'altText', store }).used).toBe(4);
  });

  it('says nothing about usage for an account whose answer has none', async () => {
    const req = requester({ altText: 'A heron.' });
    const onUsage = vi.fn();
    await generateAltText(req, { ...base, onUsage }, { store: memoryStore() });
    expect(onUsage).not.toHaveBeenCalled();
  });

  it('refuses an image cocoon can’t take, before sending it', async () => {
    const req = requester({ altText: 'x' });
    await expect(
      generateAltText(req, { imageBase64: 'AAAA', mimeType: 'image/heic' }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_IMAGE' });
    await expect(
      generateAltText(req, { mimeType: 'image/png' }),
    ).rejects.toMatchObject({
      code: 'NO_IMAGE',
    });
    expect(req.request).not.toHaveBeenCalled();
  });
});

describe('generateAltTextForFile', () => {
  it('sends the file’s bytes and type', async () => {
    const req = requester({ altText: 'A photo.' });
    const file = new File(['abc'], 'p.jpg', { type: 'image/jpeg' });
    expect(
      await generateAltTextForFile(req, file, {
        context: 'my post',
        store: memoryStore(),
      }),
    ).toBe('A photo.');
    expect(req.calls[0].body).toEqual({
      imageBase64: btoa('abc'),
      mimeType: 'image/jpeg',
      context: 'my post',
    });
  });

  it('needs a file', async () => {
    await expect(
      generateAltTextForFile(requester({}), null),
    ).rejects.toMatchObject({
      code: 'NO_IMAGE',
    });
  });
});

describe('aiErrorMessage', () => {
  it('turns cocoon’s answers into sentences', () => {
    expect(aiErrorMessage({ code: 'rate_limited', status: 429 })).toMatch(
      /limit on AI requests/,
    );
    expect(aiErrorMessage({ status: 429 })).toMatch(/busy/);
    expect(aiErrorMessage({ status: 401 })).toMatch(/sign in again/);
    expect(aiErrorMessage({ status: 503 })).toMatch(/isn’t available/);
    expect(aiErrorMessage({ code: 'TIMEOUT' })).toMatch(/too long/);
    expect(aiErrorMessage({ code: 'NETWORK_ERROR' })).toMatch(/Couldn’t reach/);
    expect(
      aiErrorMessage({ status: 400, detail: 'Missing "imageBase64"' }),
    ).toBe('Missing "imageBase64"');
    expect(aiErrorMessage({ status: 502 })).toMatch(/\(502\)/);
  });
});
