// The AI Gateway client: what it sends, what it hands back, and how every
// failure reaches the handlers as an AIGatewayError with a status they can
// answer with. fetch is stubbed; nothing leaves the process.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AIGatewayError,
  DEFAULT_TIMEOUT_MS,
  buildVisionMessage,
  chatDetailed,
  chatJSON,
  isConfigured,
  jsonFromAnswer,
} from './gateway.js';

const ENV = { AI_GATEWAY_API_KEY: 'test-key' };
const messages = [{ role: 'user', content: 'my draft about the hospital' }];

const answer = (data = {}) => ({
  ok: true,
  json: async () => ({
    choices: [
      { message: { content: 'A porch light.' }, finish_reason: 'stop' },
    ],
    ...data,
  }),
});
const refusal = (status, text) => ({
  ok: false,
  status,
  text: async () => text,
});

describe('ai gateway: chatDetailed', () => {
  let fetchMock;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const sent = () => {
    const [url, init] = fetchMock.mock.calls[0];
    return { url, init, body: JSON.parse(init.body) };
  };

  it('refuses without a key, before any request', async () => {
    expect(isConfigured({})).toBe(false);
    expect(isConfigured({ AI_GATEWAY_API_KEY: '   ' })).toBe(false);
    expect(isConfigured(ENV)).toBe(true);
    const error = await chatDetailed({ model: 'a/b', messages, env: {} }).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(AIGatewayError);
    expect(error.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses without a model: a coding mistake, not configuration', async () => {
    await expect(chatDetailed({ messages, env: ENV })).rejects.toMatchObject({
      status: 500,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('posts the chat body with the key, to the configured base URL', async () => {
    fetchMock.mockResolvedValueOnce(answer());
    await chatDetailed({
      model: 'google/gemini-3-flash',
      messages,
      maxTokens: 7600,
      temperature: 0.2,
      env: { ...ENV, AI_GATEWAY_BASE_URL: 'https://gateway.example.test/v1/' },
    });
    const { url, init, body } = sent();
    expect(url).toBe('https://gateway.example.test/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-key',
    });
    expect(body).toEqual({
      model: 'google/gemini-3-flash',
      messages,
      max_tokens: 7600,
      temperature: 0.2,
    });
  });

  it('defaults to Vercel’s gateway', async () => {
    fetchMock.mockResolvedValueOnce(answer());
    await chatDetailed({ model: 'a/b', messages, env: ENV });
    expect(sent().url).toBe('https://ai-gateway.vercel.sh/v1/chat/completions');
  });

  it('sends providerOptions.gateway only with something in it, normalized', async () => {
    fetchMock.mockResolvedValueOnce(answer());
    await chatDetailed({
      model: 'a/b',
      fallbackModels: ['c/d'],
      messages,
      user: '  did:plc:abc  ',
      tags: [
        'app:virga',
        'app:virga',
        ' feature:alt-text ',
        'x'.repeat(80),
        ...Array.from({ length: 12 }, (_, i) => `t${i}`),
      ],
      env: ENV,
    });
    const { gateway } = sent().body.providerOptions;
    expect(gateway.models).toEqual(['c/d']);
    expect(gateway.user).toBe('did:plc:abc');
    expect(gateway.tags).toHaveLength(10);
    expect(gateway.tags.slice(0, 3)).toEqual([
      'app:virga',
      'feature:alt-text',
      'x'.repeat(64),
    ]);
    expect(Object.keys(gateway).sort()).toEqual(['models', 'tags', 'user']);
  });

  it('leaves providerOptions out when there is nothing to send', async () => {
    fetchMock.mockResolvedValueOnce(answer());
    await chatDetailed({
      model: 'a/b',
      fallbackModels: [],
      messages,
      tags: [],
      env: ENV,
    });
    expect(sent().body).not.toHaveProperty('providerOptions');
  });

  it('returns the content, why it stopped, the counts and the model that answered', async () => {
    fetchMock.mockResolvedValueOnce(
      answer({
        model: 'anthropic/claude-sonnet-5',
        usage: { completion_tokens: 12 },
      }),
    );
    expect(await chatDetailed({ model: 'a/b', messages, env: ENV })).toEqual({
      content: 'A porch light.',
      finishReason: 'stop',
      usage: { completion_tokens: 12 },
      servedModel: 'anthropic/claude-sonnet-5',
    });
  });

  it('warns about a cut-off answer with counts only, never the content', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: { content: 'my draft about the hosp' },
            finish_reason: 'length',
          },
        ],
        usage: {
          completion_tokens: 400,
          completion_tokens_details: { reasoning_tokens: 300 },
        },
      }),
    });
    const result = await chatDetailed({
      model: 'a/b',
      messages,
      maxTokens: 400,
      env: ENV,
    });
    expect(result.finishReason).toBe('length');
    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).toContain(
      'hit max_tokens (400); 400 completion tokens, 300 of them reasoning',
    );
    expect(logged).not.toContain('hosp');
  });

  it('passes a gateway 429 through as 429 and anything else as 502, with at most 500 chars of detail', async () => {
    fetchMock.mockResolvedValueOnce(refusal(429, 'slow down'));
    await expect(
      chatDetailed({ model: 'a/b', messages, env: ENV }),
    ).rejects.toMatchObject({
      status: 429,
      message: 'AI Gateway returned 429: slow down',
    });
    fetchMock.mockResolvedValueOnce(refusal(400, 'y'.repeat(900)));
    const error = await chatDetailed({
      model: 'a/b',
      messages,
      env: ENV,
    }).catch((e) => e);
    expect(error.status).toBe(502);
    expect(error.message).toBe(`AI Gateway returned 400: ${'y'.repeat(500)}`);
  });

  it('turns a failed fetch into a 502', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(
      chatDetailed({ model: 'a/b', messages, env: ENV }),
    ).rejects.toMatchObject({
      status: 502,
      message: 'AI Gateway request failed',
    });
  });

  it('gives up after the timeout with a 504', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce(
      (url, init) =>
        new Promise((resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        }),
    );
    const pending = chatDetailed({ model: 'a/b', messages, env: ENV }).catch(
      (e) => e,
    );
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS);
    expect(await pending).toMatchObject({
      status: 504,
      message: 'AI Gateway request timed out',
    });
    expect(DEFAULT_TIMEOUT_MS).toBeLessThanOrEqual(25000);
  });

  it('calls an answer with no string content an unexpected shape', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [] }),
    });
    await expect(
      chatDetailed({ model: 'a/b', messages, env: ENV }),
    ).rejects.toMatchObject({ status: 502 });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    });
    await expect(
      chatDetailed({ model: 'a/b', messages, env: ENV }),
    ).rejects.toMatchObject({
      status: 502,
      message: 'AI Gateway returned an unexpected response shape',
    });
  });

  it('chatJSON parses the answer', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: { content: '```json\n{"summary":"lowercase"}\n```' },
            finish_reason: 'stop',
          },
        ],
      }),
    });
    expect(await chatJSON({ model: 'a/b', messages, env: ENV })).toEqual({
      summary: 'lowercase',
    });
  });
});

describe('ai gateway: jsonFromAnswer', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reads the JSON, calls a cut-off answer cut off, and can keep the answer out of the log', () => {
    expect(
      jsonFromAnswer({
        content: '```json\n{"a":1}\n```',
        finishReason: 'stop',
      }),
    ).toEqual({ a: 1 });
    expect(() =>
      jsonFromAnswer({ content: '{"a":', finishReason: 'length' }),
    ).toThrow(/max_tokens/);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() =>
      jsonFromAnswer(
        { content: 'my post about the divorce', finishReason: 'stop' },
        { logResponse: false },
      ),
    ).toThrow();
    expect(warn.mock.calls.flat().join(' ')).not.toContain('divorce');
  });
});

describe('ai gateway: buildVisionMessage', () => {
  it('puts the instruction and the image, as a data URL, in one user message', () => {
    expect(buildVisionMessage('Describe it.', 'aGVsbG8=', 'image/png')).toEqual(
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe it.' },
          {
            type: 'image_url',
            image_url: { url: 'data:image/png;base64,aGVsbG8=' },
          },
        ],
      },
    );
  });
});
