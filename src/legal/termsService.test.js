import { describe, expect, it, vi } from 'vitest';
import { TERMS_API, fetchTermsStatus, recordAcceptance, reportAcceptance } from './termsService.js';
import { TERMS_VERSION } from './version.js';

const DID = 'did:plc:abcdefghijklmnopqrstuvwx';
const SERVER = 'https://virga.example';
const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe('the terms endpoints', () => {
  it('are the two the server answers', () => {
    expect(TERMS_API).toEqual({ status: '/api/terms/status', accept: '/api/terms/accept' });
  });
});

describe('asking whether an account agreed', () => {
  it('asks as that account, and reads the answer', async () => {
    const requester = { request: vi.fn(async () => ({ success: true, version: TERMS_VERSION, accepted: true, acceptedAt: '2026-11-14T10:00:00Z' })) };
    expect(await fetchTermsStatus(requester)).toEqual({ accepted: true, acceptedAt: '2026-11-14T10:00:00Z', version: TERMS_VERSION });
    expect(requester.request.mock.calls[0][0]).toBe('/api/terms/status');
  });

  it('reads anything but a plain yes as not agreed', async () => {
    const requester = { request: async () => ({ success: true, accepted: 'yes' }) };
    expect(await fetchTermsStatus(requester)).toEqual({ accepted: false, acceptedAt: null, version: null });
  });

  it('passes on the requester’s error when the server can’t say', async () => {
    const error = Object.assign(new Error('down'), { status: 503, code: 'UNAVAILABLE' });
    await expect(
      fetchTermsStatus({
        request: async () => {
          throw error;
        },
      }),
    ).rejects.toBe(error);
  });
});

describe('recording an agreement on a long session', () => {
  it('posts the version this page shows, and nothing naming the account', async () => {
    const requester = { request: vi.fn(async () => ({ success: true, acceptedAt: '2026-11-14T10:00:00Z', identity: 'session', created: true })) };
    expect(await recordAcceptance(requester)).toEqual({ acceptedAt: '2026-11-14T10:00:00Z', identity: 'session' });
    const [path, options] = requester.request.mock.calls[0];
    expect(path).toBe('/api/terms/accept');
    expect(options).toMatchObject({ method: 'POST', body: { version: TERMS_VERSION } });
    expect(Object.keys(options.body)).toEqual(['version']);
  });
});

describe('reporting an agreement made on a browser session', () => {
  it('posts the DID and the version, with no token', async () => {
    const fetch = vi.fn(async () => json({ success: true, acceptedAt: '2026-11-14T10:00:00Z', identity: 'claimed', created: true }));
    expect(await reportAcceptance({ did: DID, backendUrl: SERVER, fetch })).toEqual({ acceptedAt: '2026-11-14T10:00:00Z', identity: 'claimed' });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(`${SERVER}/api/terms/accept`);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({ version: TERMS_VERSION, did: DID });
  });

  it('throws the server’s code when it is refused', async () => {
    const fetch = async () => json({ success: false, code: 'TERMS_VERSION_MISMATCH', error: 'changed' }, 409);
    await expect(reportAcceptance({ did: DID, backendUrl: SERVER, fetch })).rejects.toMatchObject({ code: 'TERMS_VERSION_MISMATCH', status: 409 });
    const off = async () => json({ success: false, code: 'SESSION_REQUIRED', error: 'no' }, 401);
    await expect(reportAcceptance({ did: DID, backendUrl: SERVER, fetch: off })).rejects.toMatchObject({ code: 'SESSION_REQUIRED', status: 401 });
  });

  it('doesn’t take a page for an answer: a site with no server serves its own shell', async () => {
    const fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    });
    await expect(reportAcceptance({ did: DID, backendUrl: SERVER, fetch })).rejects.toMatchObject({ status: 200 });
    await expect(reportAcceptance({ did: DID, backendUrl: SERVER, fetch: async () => json({ hello: 'world' }) })).rejects.toBeInstanceOf(Error);
  });

  it('says it couldn’t reach the server when the request fails', async () => {
    const fetch = async () => {
      throw new TypeError('Failed to fetch');
    };
    await expect(reportAcceptance({ did: DID, backendUrl: SERVER, fetch })).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
  });
});
