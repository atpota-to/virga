import { describe, it, expect } from 'vitest';
import { applyCors, bearerToken, CORS_HEADERS, methodGuard, readJson, readRaw, sendJson } from './http.js';
import { createReq, createRes } from './test/http.js';

describe('sendJson', () => {
  it('sends the body as JSON, never cached', () => {
    const res = createRes();
    sendJson(res, 201, { success: true, id: 'x' });
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ success: true, id: 'x' });
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('works on a bare Node response too', () => {
    const written = {};
    const res = {
      setHeader: (k, v) => { written[k.toLowerCase()] = v; },
      end: (text) => { written.body = text; },
    };
    sendJson(res, 404, { success: false, error: 'Not found' });
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(written.body)).toEqual({ success: false, error: 'Not found' });
  });
});

describe('methodGuard', () => {
  it('lets a listed method through', () => {
    const res = createRes();
    expect(methodGuard(createReq({ method: 'POST' }), res, ['POST'])).toBe(true);
    expect(res.ended).toBe(false);
    expect(methodGuard(createReq({ method: 'get' }), createRes(), 'GET')).toBe(true);
  });

  it('answers OPTIONS with an empty 204', () => {
    const res = createRes();
    expect(methodGuard(createReq({ method: 'OPTIONS' }), res, ['GET'])).toBe(false);
    expect(res.statusCode).toBe(204);
    expect(res.ended).toBe(true);
    expect(res.body).toBeUndefined();
    expect(res.headers.allow).toBe('GET, OPTIONS');
  });

  it('answers any other method 405', () => {
    const res = createRes();
    expect(methodGuard(createReq({ method: 'DELETE' }), res, ['GET', 'POST'])).toBe(false);
    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ success: false, error: 'Method not allowed' });
    expect(res.headers.allow).toBe('GET, POST');
  });
});

describe('applyCors', () => {
  const env = {
    OAUTH_PUBLIC_URL: 'https://virga.example.com',
    OAUTH_EXTRA_RETURN_ORIGINS: 'http://127.0.0.1:5173',
  };
  const accessHeaders = (res) => Object.keys(res.headers).filter((k) => k.startsWith('access-control-'));

  it('allows an extra frontend origin calling this server', () => {
    const res = createRes();
    const req = createReq({ headers: { origin: 'http://127.0.0.1:5173', host: 'virga.example.com' } });
    expect(applyCors(req, res, env)).toBe(true);
    expect(res.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5173');
    expect(res.headers['access-control-allow-methods']).toBe('GET, POST, OPTIONS');
    expect(res.headers['access-control-allow-headers']).toBe(CORS_HEADERS);
    expect(CORS_HEADERS.split(', ')).toEqual([
      'Authorization', 'Content-Type', 'X-XRPC-Method', 'X-Atproto-Proxy', 'Atproto-Accept-Labelers',
    ]);
    expect(res.headers.vary).toBe('Origin');
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('allows the public origin when it calls a server on another host', () => {
    const res = createRes();
    const req = createReq({ headers: { origin: 'https://virga.example.com', host: 'virga-git-x.vercel.app' } });
    expect(applyCors(req, res, env)).toBe(true);
  });

  it('adds nothing to a same-origin request', () => {
    const res = createRes();
    const req = createReq({ headers: { origin: 'https://virga.example.com', host: 'virga.example.com' } });
    expect(applyCors(req, res, env)).toBe(false);
    expect(accessHeaders(res)).toEqual([]);
    const forwarded = createRes();
    applyCors(createReq({ headers: { origin: 'https://virga.example.com', 'x-forwarded-host': 'virga.example.com', 'x-forwarded-proto': 'https' } }), forwarded, env);
    expect(accessHeaders(forwarded)).toEqual([]);
  });

  it('adds nothing for an origin off the list, a null origin or no origin', () => {
    for (const origin of ['https://evil.example', 'null', undefined, 'https://virga.example.com.evil.test']) {
      const res = createRes();
      expect(applyCors(createReq({ headers: { origin, host: 'virga.example.com' } }), res, env)).toBe(false);
      expect(accessHeaders(res)).toEqual([]);
    }
  });
});

describe('bearerToken', () => {
  it('reads the token from the Authorization header', () => {
    expect(bearerToken(createReq({ headers: { Authorization: 'Bearer vg_abc' } }))).toBe('vg_abc');
    expect(bearerToken(createReq({ headers: { authorization: 'bearer vg_abc' } }))).toBe('vg_abc');
  });

  it('is null without one', () => {
    expect(bearerToken(createReq())).toBeNull();
    expect(bearerToken(createReq({ headers: { authorization: 'Basic abc' } }))).toBeNull();
    expect(bearerToken(createReq({ headers: { authorization: 'Bearer ' } }))).toBeNull();
    expect(bearerToken(createReq({ headers: { authorization: 'Bearer a b' } }))).toBeNull();
    expect(bearerToken({})).toBeNull();
  });
});

describe('readJson', () => {
  it('takes a body Vercel already parsed', async () => {
    expect(await readJson(createReq({ body: { a: 1 } }))).toEqual({ a: 1 });
  });

  it('parses a string or a Buffer', async () => {
    expect(await readJson(createReq({ body: '{"a":2}' }))).toEqual({ a: 2 });
    expect(await readJson(createReq({ body: Buffer.from('{"a":3}') }))).toEqual({ a: 3 });
    expect(await readJson(createReq({ body: new Uint8Array(Buffer.from('{"a":4}')) }))).toEqual({ a: 4 });
  });

  it('reads an unread request stream', async () => {
    expect(await readJson(createReq({ method: 'POST', body: '{"a":5}', stream: true }))).toEqual({ a: 5 });
    expect(await readJson(createReq({ method: 'POST', stream: true }))).toEqual({});
  });

  it('is {} for no body, malformed JSON, or JSON that is not an object', async () => {
    expect(await readJson(createReq())).toEqual({});
    expect(await readJson(createReq({ body: null }))).toEqual({});
    expect(await readJson(createReq({ body: '' }))).toEqual({});
    expect(await readJson(createReq({ body: '{nope' }))).toEqual({});
    expect(await readJson(createReq({ body: '[1,2]' }))).toEqual({});
    expect(await readJson(createReq({ body: [1, 2] }))).toEqual({});
    expect(await readJson(createReq({ body: '"text"' }))).toEqual({});
  });

  it('is {} when Vercel’s body getter throws on malformed JSON', async () => {
    const req = createReq();
    Object.defineProperty(req, 'body', { get() { throw new Error('Invalid JSON'); } });
    expect(await readJson(req)).toEqual({});
  });
});

describe('readRaw', () => {
  it('returns a Buffer body as is', async () => {
    const bytes = Buffer.from([1, 2, 3]);
    expect(await readRaw(createReq({ body: bytes }))).toBe(bytes);
  });

  it('turns other bodies into a Buffer', async () => {
    expect((await readRaw(createReq({ body: 'héllo' }))).toString('utf8')).toBe('héllo');
    expect([...(await readRaw(createReq({ body: new Uint8Array([4, 5]) })))]).toEqual([4, 5]);
    expect((await readRaw(createReq({ body: { a: 1 } }))).toString('utf8')).toBe('{"a":1}');
    expect((await readRaw(createReq())).byteLength).toBe(0);
  });

  it('reads an unread request stream', async () => {
    const buf = await readRaw(createReq({ method: 'POST', body: Buffer.from([9, 8, 7]), stream: true }));
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect([...buf]).toEqual([9, 8, 7]);
  });

  it('refuses a body over maxBytes', async () => {
    await expect(readRaw(createReq({ body: Buffer.alloc(11) }), { maxBytes: 10 })).rejects.toMatchObject({
      code: 'BODY_TOO_LARGE',
      status: 413,
    });
    await expect(
      readRaw(createReq({ method: 'POST', body: Buffer.alloc(11), stream: true }), { maxBytes: 10 }),
    ).rejects.toMatchObject({ code: 'BODY_TOO_LARGE' });
    expect((await readRaw(createReq({ body: Buffer.alloc(10) }), { maxBytes: 10 })).byteLength).toBe(10);
  });
});
