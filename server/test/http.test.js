import { describe, it, expect } from 'vitest';
import { createReq, createRes } from './http.js';

describe('createReq', () => {
  it('lower-cases header names and keeps query and body', () => {
    const req = createReq({ method: 'POST', query: { action: 'create', x: '1' }, headers: { Authorization: 'Bearer t' }, body: { a: 1 } });
    expect(req.method).toBe('POST');
    expect(req.headers).toEqual({ authorization: 'Bearer t' });
    expect(req.query).toEqual({ action: 'create', x: '1' });
    expect(req.body).toEqual({ a: 1 });
    expect(req.url).toBe('/create?x=1');
  });

  it('has no body property when none is given, as outside Vercel', () => {
    expect('body' in createReq()).toBe(false);
  });

  it('serves the body as a stream on request', async () => {
    const req = createReq({ method: 'POST', body: Buffer.from('abc'), stream: true });
    expect(req.body).toBeUndefined();
    const chunks = [];
    for await (const c of req) chunks.push(c);
    expect(Buffer.concat(chunks).toString()).toBe('abc');
    expect(req.headers).toEqual({});
  });
});

describe('createRes', () => {
  it('records status, headers and a JSON body', () => {
    const res = createRes();
    res.status(201).json({ success: true });
    expect(res.statusCode).toBe(201);
    expect(res.body).toEqual({ success: true });
    expect(res.getHeader('Content-Type')).toMatch(/^application\/json/);
    expect(res.ended && res.headersSent && res.writableEnded).toBe(true);
  });

  it('records a redirect, with or without a status', () => {
    const a = createRes();
    a.redirect('https://x.example/a');
    expect([a.statusCode, a.redirectedTo, a.headers.location]).toEqual([302, 'https://x.example/a', 'https://x.example/a']);
    const b = createRes();
    b.redirect(303, '/b');
    expect([b.statusCode, b.redirectedTo]).toEqual([303, '/b']);
  });

  it('records send() and end() bodies and parses them with jsonBody()', () => {
    const a = createRes();
    a.send('{"ok":true}');
    expect(a.jsonBody()).toEqual({ ok: true });
    const b = createRes();
    b.status(204).end();
    expect(b.body).toBeUndefined();
    expect(b.ended).toBe(true);
  });
});
