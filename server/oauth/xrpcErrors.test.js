// How the proxy reads a failed upstream call: the status it answers with,
// which failures are safe to retry, and which headers cross in each direction.

import { describe, expect, it } from 'vitest';
import {
  XRPCError,
  XRPCInvalidResponseError,
  ResponseType,
} from '@atproto/xrpc';
import {
  RATE_LIMIT_HEADERS,
  RELAYED_HEADERS,
  RETRIABLE_CONNECT_CODES,
  describeXrpcError,
  httpStatusForXrpcError,
  isRetriableConnectError,
  isRoutineNotFound,
  pickRateLimitHeaders,
  pickRelayedHeaders,
} from './xrpcErrors.js';

// A stand-in for @atproto/lexicon's ValidationError: only its message is read.
const validationError = (message) =>
  Object.assign(new Error(message), { name: 'ValidationError' });

describe('httpStatusForXrpcError', () => {
  it('answers 502 for a response that failed the SDK validation', () => {
    const err = new XRPCInvalidResponseError(
      'app.bsky.feed.getPostThread',
      validationError('Output/thread/post/uri must be a valid at-uri'),
      { thread: {} },
    );
    expect(err.status).toBe(ResponseType.InvalidResponse);
    expect(httpStatusForXrpcError(err)).toBe(502);
  });

  it('answers 502 for an error that carried no HTTP status', () => {
    const err = XRPCError.from(new Error('token refresh failed'));
    expect(err.status).toBe(ResponseType.Unknown);
    expect(httpStatusForXrpcError(err)).toBe(502);
  });

  it('passes the upstream 4xx and 5xx through unchanged', () => {
    for (const status of [
      400, 401, 403, 404, 413, 429, 500, 501, 502, 503, 504,
    ]) {
      expect(
        httpStatusForXrpcError(new XRPCError(status)),
        String(status),
      ).toBe(status);
    }
  });

  it('reads statusCode when there is no status', () => {
    expect(httpStatusForXrpcError({ statusCode: 503 })).toBe(503);
  });

  it('answers 500 for anything that is not an error status', () => {
    for (const err of [
      new Error('Unknown XRPC method: x.y.z'),
      {},
      null,
      undefined,
      { status: 200 },
      { status: 302 },
      { status: 99 },
      { status: 1000 },
      { status: '502' },
      { status: 502.5 },
    ]) {
      expect(httpStatusForXrpcError(err), JSON.stringify(err)).toBe(500);
    }
  });
});

describe('describeXrpcError', () => {
  it('names the field the validation refused', () => {
    const err = new XRPCInvalidResponseError(
      'app.bsky.feed.getPostThread',
      validationError('Output/thread/post/uri must be a valid at-uri'),
      {},
    );
    expect(describeXrpcError(err)).toBe(
      'The server gave an invalid response and may be out of date. (Output/thread/post/uri must be a valid at-uri)',
    );
  });

  it('is the bare message for every other error', () => {
    expect(
      describeXrpcError(
        new XRPCError(400, 'RecordNotFound', 'Could not locate record'),
      ),
    ).toBe('Could not locate record');
    expect(describeXrpcError(new Error('boom'))).toBe('boom');
    expect(describeXrpcError('plain string')).toBe('plain string');
  });
});

describe('isRoutineNotFound', () => {
  it('recognises a missing record or post', () => {
    expect(
      isRoutineNotFound(
        new XRPCError(
          400,
          'RecordNotFound',
          'Could not locate record: at://did:plc:x/app.bsky.feed.post/3k',
        ),
      ),
    ).toBe(true);
    expect(
      isRoutineNotFound(new XRPCError(400, 'NotFound', 'Post not found')),
    ).toBe(true);
    expect(
      isRoutineNotFound(
        new XRPCError(404, 'RecordNotFound', 'Record not found'),
      ),
    ).toBe(true);
    expect(
      isRoutineNotFound(
        new XRPCError(
          400,
          'InvalidRequest',
          'Could not locate record: at://did:plc:x/a.b.c/self',
        ),
      ),
    ).toBe(true);
  });

  it('leaves every other failure at error level', () => {
    expect(
      isRoutineNotFound(new XRPCError(400, 'InvalidRequest', 'Invalid rkey')),
    ).toBe(false);
    expect(
      isRoutineNotFound(
        new XRPCError(401, 'AuthenticationRequired', 'Bad token'),
      ),
    ).toBe(false);
    expect(isRoutineNotFound(new XRPCError(502, 'NotFound', 'upstream'))).toBe(
      false,
    );
    expect(
      isRoutineNotFound(
        new XRPCError(500, 'InternalServerError', 'Could not locate record'),
      ),
    ).toBe(false);
    expect(isRoutineNotFound(new Error('Could not locate record'))).toBe(false);
    expect(isRoutineNotFound(null)).toBe(false);
  });
});

// The proxy retries these transparently, writes included; the safety property
// is "the connection never opened, so the request was never sent".
describe('isRetriableConnectError', () => {
  it('returns false for falsy or non-error input', () => {
    for (const value of [null, undefined, 0, {}])
      expect(isRetriableConnectError(value)).toBe(false);
  });

  it('recognises an undici connect timeout by code, and under a "fetch failed" TypeError', () => {
    const err = Object.assign(new Error('Connect Timeout Error'), {
      code: 'UND_ERR_CONNECT_TIMEOUT',
    });
    expect(isRetriableConnectError(err)).toBe(true);
    const wrapped = Object.assign(new TypeError('fetch failed'), {
      cause: err,
    });
    expect(isRetriableConnectError(wrapped)).toBe(true);
  });

  it('recognises one the SDK wrapped again in an XRPCError', () => {
    const socket = Object.assign(new Error('Connect Timeout Error'), {
      code: 'UND_ERR_CONNECT_TIMEOUT',
    });
    const wrapped = XRPCError.from(
      Object.assign(new TypeError('fetch failed'), { cause: socket }),
    );
    expect(isRetriableConnectError(wrapped)).toBe(true);
    expect(
      isRetriableConnectError(XRPCError.from(new TypeError('fetch failed'))),
    ).toBe(false);
  });

  it('recognises DNS and refused connections', () => {
    for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']) {
      expect(
        isRetriableConnectError(Object.assign(new Error(code), { code })),
      ).toBe(true);
    }
  });

  it('matches on the message when only a stringified error is passed on', () => {
    expect(
      isRetriableConnectError({ message: 'UND_ERR_CONNECT_TIMEOUT error' }),
    ).toBe(true);
    expect(isRetriableConnectError({ message: 'Connect Timeout Error' })).toBe(
      true,
    );
  });

  it('never retries a failure that can happen after the request was sent', () => {
    for (const code of [
      'UND_ERR_HEADERS_TIMEOUT',
      'UND_ERR_BODY_TIMEOUT',
      'ECONNRESET',
      'UND_ERR_SOCKET',
    ]) {
      expect(
        isRetriableConnectError(Object.assign(new Error(code), { code })),
      ).toBe(false);
    }
    expect(RETRIABLE_CONNECT_CODES.has('ECONNRESET')).toBe(false);
  });

  it('never retries an ordinary XRPC error', () => {
    expect(
      isRetriableConnectError({
        error: 'RecordNotFound',
        message: 'Could not locate record',
      }),
    ).toBe(false);
    expect(
      isRetriableConnectError({
        error: 'InvalidRequest',
        message: 'Invalid token',
      }),
    ).toBe(false);
  });
});

describe('pickRelayedHeaders', () => {
  it('forwards the headers the AppView reads, and nothing else', () => {
    expect(
      pickRelayedHeaders({
        authorization: 'Bearer session-token',
        'x-xrpc-method': 'app.bsky.unspecced.getTrends',
        'x-atproto-proxy': 'did:web:api.bsky.app#bsky_appview',
        cookie: 'session=secret',
        'accept-language': 'en-GB,en',
        'x-bsky-topics': 'nature,art',
      }),
    ).toEqual({ 'accept-language': 'en-GB,en', 'x-bsky-topics': 'nature,art' });
  });

  it('forwards nothing when there is nothing, and joins a repeated header', () => {
    expect(pickRelayedHeaders({})).toEqual({});
    expect(pickRelayedHeaders()).toEqual({});
    expect(
      pickRelayedHeaders({ 'accept-language': '', 'x-bsky-topics': undefined }),
    ).toEqual({});
    expect(pickRelayedHeaders({ 'x-bsky-topics': ['nature', 'art'] })).toEqual({
      'x-bsky-topics': 'nature,art',
    });
  });

  it('keeps the allowlist small and lowercase', () => {
    expect(RELAYED_HEADERS).toEqual(['accept-language', 'x-bsky-topics']);
  });
});

describe('pickRateLimitHeaders', () => {
  it('picks the rate-limit headers off an XRPCError-shaped object', () => {
    expect(
      pickRateLimitHeaders({
        'content-type': 'application/json',
        'ratelimit-limit': '5000',
        'ratelimit-remaining': '0',
        'ratelimit-reset': '1767225600',
        'ratelimit-policy': '5000;w=3600',
        'set-cookie': 'nope',
      }),
    ).toEqual({
      'ratelimit-limit': '5000',
      'ratelimit-remaining': '0',
      'ratelimit-reset': '1767225600',
      'ratelimit-policy': '5000;w=3600',
    });
  });

  it('reads a Headers instance and mixed-case names', () => {
    expect(
      pickRateLimitHeaders(
        new Headers({ 'RateLimit-Reset': '1767225600', 'x-other': '1' }),
      ),
    ).toEqual({ 'ratelimit-reset': '1767225600' });
    expect(pickRateLimitHeaders({ 'RateLimit-Reset': 1767225600 })).toEqual({
      'ratelimit-reset': '1767225600',
    });
  });

  it('returns null when there is nothing to pass on', () => {
    expect(pickRateLimitHeaders(undefined)).toBeNull();
    expect(pickRateLimitHeaders({})).toBeNull();
    expect(pickRateLimitHeaders({ 'ratelimit-reset': '' })).toBeNull();
    expect(RATE_LIMIT_HEADERS).toEqual(
      RATE_LIMIT_HEADERS.map((h) => h.toLowerCase()),
    );
  });
});
