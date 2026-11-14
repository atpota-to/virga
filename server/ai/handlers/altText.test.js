// /api/ai/alt-text: what reaches the person when the model's answer is not
// usable. Alt text is prose, not JSON, so a description cut off at max_tokens
// parses fine and would be read aloud as if it were whole. It has to count as
// no answer, the same as an empty one. The gateway, the caller and the rate
// limit are stubbed; the allowance is unlimited here, so nothing is counted.

import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  afterAll,
} from 'vitest';
import { createReq, createRes } from '../../test/http.js';
import {
  resetSupabaseClientForTests,
  setSupabaseClientForTests,
} from '../../supabase.js';
import { THINKING_ALLOWANCE } from '../models.js';
import { ALT_TEXT_TOKENS } from '../altTextPrompt.js';

const mocks = vi.hoisted(() => ({
  resolveAiCaller: vi.fn(),
  enforce: vi.fn(),
  chatDetailed: vi.fn(),
  modelsFor: vi.fn(),
}));

vi.mock('../caller.js', () => ({ resolveAiCaller: mocks.resolveAiCaller }));
vi.mock('../rateLimit.js', async (importOriginal) => ({
  ...(await importOriginal()),
  enforce: mocks.enforce,
}));
vi.mock('../gateway.js', async (importOriginal) => ({
  ...(await importOriginal()),
  chatDetailed: mocks.chatDetailed,
}));
vi.mock('../models.js', async (importOriginal) => ({
  ...(await importOriginal()),
  modelsFor: mocks.modelsFor,
}));

const { default: handler, ALT_TEXT_BUDGET_MS } = await import('./altText.js');

const PRIMARY = 'deepseek/deepseek-v4.1-flash';
const FALLBACK = 'anthropic/claude-sonnet-5';
const SAVED_ENV = {
  key: process.env.AI_GATEWAY_API_KEY,
  limit: process.env.AI_ALT_TEXT_MONTHLY_LIMIT,
};

async function call(
  body = { imageBase64: 'aGVsbG8=', mimeType: 'image/jpeg' },
) {
  const res = createRes();
  await handler(
    createReq({
      method: 'POST',
      headers: { authorization: 'Bearer vg_test' },
      body,
    }),
    res,
  );
  return { status: res.statusCode, body: res.body };
}

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  process.env.AI_GATEWAY_API_KEY = 'test-key';
  process.env.AI_ALT_TEXT_MONTHLY_LIMIT = 'unlimited';
  setSupabaseClientForTests(null);
  mocks.resolveAiCaller.mockResolvedValue({ ok: true, did: 'did:plc:tester' });
  mocks.enforce.mockResolvedValue({ allowed: true });
  mocks.modelsFor.mockReturnValue({
    model: PRIMARY,
    fallbackModels: [FALLBACK],
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  resetSupabaseClientForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

afterAll(() => {
  if (SAVED_ENV.key === undefined) delete process.env.AI_GATEWAY_API_KEY;
  else process.env.AI_GATEWAY_API_KEY = SAVED_ENV.key;
  if (SAVED_ENV.limit === undefined)
    delete process.env.AI_ALT_TEXT_MONTHLY_LIMIT;
  else process.env.AI_ALT_TEXT_MONTHLY_LIMIT = SAVED_ENV.limit;
});

describe('/api/ai/alt-text: an unusable answer', () => {
  it('returns a whole description as it came', async () => {
    mocks.chatDetailed.mockResolvedValue({
      content: 'A luna moth on a screen door at night.',
      finishReason: 'stop',
    });
    expect(await call()).toEqual({
      status: 200,
      body: { altText: 'A luna moth on a screen door at night.' },
    });
    expect(mocks.chatDetailed).toHaveBeenCalledTimes(1);
  });

  it('never hands back a description cut off at max_tokens; the fallback answers instead', async () => {
    mocks.chatDetailed
      .mockResolvedValueOnce({
        content: 'A luna moth rests on the',
        finishReason: 'length',
      })
      .mockResolvedValueOnce({
        content: 'A luna moth on a screen door at night.',
        finishReason: 'stop',
      });
    expect(await call()).toEqual({
      status: 200,
      body: { altText: 'A luna moth on a screen door at night.' },
    });
    expect(mocks.chatDetailed.mock.calls[1][0].model).toBe(FALLBACK);
    // A direct call, so no gateway fallbacks ride along.
    expect(mocks.chatDetailed.mock.calls[1][0]).not.toHaveProperty(
      'fallbackModels',
    );
  });

  it('says it could not describe the image when every model is cut off', async () => {
    mocks.chatDetailed.mockResolvedValue({
      content: 'A luna moth rests on the',
      finishReason: 'length',
    });
    const { status, body } = await call();
    expect(status).toBe(502);
    expect(body.error).toMatch(/Could not describe this image/);
  });

  it('treats an empty answer the same, and a fallback that throws as no answer', async () => {
    mocks.chatDetailed
      .mockResolvedValueOnce({ content: '   ', finishReason: 'stop' })
      .mockRejectedValueOnce(
        Object.assign(new Error('AI Gateway request failed'), { status: 502 }),
      );
    const { status, body } = await call();
    expect(status).toBe(502);
    expect(body.error).toMatch(/Could not describe this image/);
  });

  it("passes the composer's quick notes and the image's kind to the instruction", async () => {
    mocks.chatDetailed.mockResolvedValue({
      content: 'A settings screen.',
      finishReason: 'stop',
    });
    await call({
      imageBase64: 'aGVsbG8=',
      mimeType: 'image/png',
      followUp: 'Describe what is shown instead of transcribing the text.',
      previousAltText: 'Settings. Account.',
      presets: ['describe'],
      kind: 'interface',
    });
    const text = JSON.stringify(mocks.chatDetailed.mock.calls[0][0].messages);
    expect(text).toContain('rather than transcribing its text');
    expect(text).toContain('screenshot of an app or website');
    expect(text).not.toContain('if the image is primarily text');
  });

  it('leaves a thinking model room to think before it describes anything', async () => {
    mocks.chatDetailed.mockResolvedValue({
      content: 'A porch light.',
      finishReason: 'stop',
    });
    await call();
    expect(mocks.chatDetailed.mock.calls[0][0].maxTokens).toBe(
      ALT_TEXT_TOKENS + THINKING_ALLOWANCE,
    );
  });
});

describe('/api/ai/alt-text: the retries keep to the client’s wait', () => {
  it('hands a fallback only what is left of the budget', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-13T12:00:00Z'));
    mocks.chatDetailed
      .mockImplementationOnce(async () => {
        vi.setSystemTime(new Date('2026-11-13T12:00:10Z'));
        return { content: '', finishReason: 'stop' };
      })
      .mockResolvedValueOnce({
        content: 'A porch light.',
        finishReason: 'stop',
      });
    expect((await call()).status).toBe(200);
    expect(mocks.chatDetailed.mock.calls[0][0].timeoutMs).toBe(25000);
    expect(mocks.chatDetailed.mock.calls[1][0].timeoutMs).toBe(
      ALT_TEXT_BUDGET_MS - 10000,
    );
  });

  it('skips the fallbacks once too little time is left for one to answer', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-13T12:00:00Z'));
    mocks.chatDetailed.mockImplementationOnce(async () => {
      vi.setSystemTime(new Date('2026-11-13T12:00:24Z'));
      return { content: 'A luna moth rests on the', finishReason: 'length' };
    });
    const { status } = await call();
    expect(status).toBe(502);
    expect(mocks.chatDetailed).toHaveBeenCalledTimes(1);
  });
});
