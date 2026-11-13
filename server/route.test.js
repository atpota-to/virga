import { describe, it, expect, vi, afterEach } from 'vitest';
import { createRouter } from './route.js';
import { createReq, createRes } from './test/http.js';

afterEach(() => vi.restoreAllMocks());

describe('createRouter', () => {
  it('dispatches on the action segment', async () => {
    const list = vi.fn((req, res) => res.status(200).json({ success: true, data: [] }));
    const route = createRouter({ list, create: vi.fn() });
    const req = createReq({ query: { action: 'list' } });
    const res = createRes();
    await route(req, res);
    expect(list).toHaveBeenCalledWith(req, res);
    expect(res.body).toEqual({ success: true, data: [] });
  });

  it('takes the action from the path when the query has none', async () => {
    const status = vi.fn((req, res) => res.json({ success: true }));
    await createRouter({ status })({ method: 'GET', headers: {}, url: '/api/limits/status?x=1' }, createRes());
    expect(status).toHaveBeenCalled();
  });

  it('answers an unknown action 404', async () => {
    const route = createRouter({ list: vi.fn() });
    for (const action of ['nope', 'constructor', '__proto__', 'toString', '']) {
      const res = createRes();
      await route(createReq({ query: { action } }), res);
      expect(res.statusCode).toBe(404);
      expect(res.body).toEqual({ success: false, error: 'Not found' });
    }
  });

  it('turns a thrown error into a logged 500 that says nothing more', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const route = createRouter({ boom: async () => { throw new Error('secret detail'); } }, { name: 'schedule' });
    const res = createRes();
    await route(createReq({ query: { action: 'boom' } }), res);
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ success: false, code: 'INTERNAL', error: 'Internal error' });
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).toContain('[schedule/boom]');
  });

  it('leaves an answer a handler already sent before it threw', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const route = createRouter({
      late: async (req, res) => {
        res.status(202).json({ success: true });
        throw new Error('after the answer');
      },
    });
    const res = createRes();
    await route(createReq({ query: { action: 'late' } }), res);
    expect(res.statusCode).toBe(202);
    expect(res.body).toEqual({ success: true });
  });

  it('applies CORS before the handler runs, and to a 404', async () => {
    const prev = { ...process.env };
    process.env.OAUTH_PUBLIC_URL = 'https://virga.example.com';
    process.env.OAUTH_EXTRA_RETURN_ORIGINS = 'http://127.0.0.1:5173';
    try {
      const seen = [];
      const route = createRouter({ list: (req, res) => { seen.push(res.headers['access-control-allow-origin']); res.json({ success: true }); } });
      const headers = { origin: 'http://127.0.0.1:5173', host: 'virga.example.com' };
      await route(createReq({ query: { action: 'list' }, headers }), createRes());
      expect(seen).toEqual(['http://127.0.0.1:5173']);
      const notFound = createRes();
      await route(createReq({ query: { action: 'missing' }, headers }), notFound);
      expect(notFound.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5173');
      const same = createRes();
      await route(createReq({ query: { action: 'list' }, headers: { origin: 'https://virga.example.com', host: 'virga.example.com' } }), same);
      expect(same.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      process.env = prev;
    }
  });
});
