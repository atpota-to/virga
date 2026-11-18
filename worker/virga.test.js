import { describe, expect, it, vi } from 'vitest';
import { isWorkerAuthorized } from '../server/defense/workerAuth.js';
import { MODERATOR_PATH, VirgaError, virgaClient } from './virga.js';

const SECRET = 'a'.repeat(64);

describe('the worker’s calls for the moderator', () => {
  it('are signed over their exact body, which the server’s own check takes', async () => {
    let seen;
    const fetchImpl = vi.fn(async (url, init) => {
      seen = { method: init.method, url: new URL(url).pathname, headers: Object.fromEntries(Object.entries(init.headers).map(([k, v]) => [k.toLowerCase(), v])), body: init.body };
      return new Response(JSON.stringify({ success: true, data: { reply: 'hi' } }), { status: 200 });
    });
    const v = virgaClient({ base: 'https://virga.example', secret: SECRET, fetchImpl });
    expect(await v.call('message', { owner: 'did:plc:a', message: { text: 'help' } })).toEqual({ reply: 'hi' });
    expect(seen.url).toBe(MODERATOR_PATH);
    expect(seen.headers['content-type']).toBe('application/octet-stream');
    expect(JSON.parse(seen.body)).toEqual({ owner: 'did:plc:a', message: { text: 'help' }, op: 'message' });
    expect(isWorkerAuthorized(seen, { DEFENSE_WORKER_SECRET: SECRET }, Date.now(), { body: seen.body })).toBe(true);
    // The same header with another body, as from someone who caught it, is refused.
    expect(isWorkerAuthorized(seen, { DEFENSE_WORKER_SECRET: SECRET }, Date.now(), { body: seen.body.replace('did:plc:a', 'did:plc:b') })).toBe(false);
  });

  it('throw what the route refused with', async () => {
    const v = virgaClient({ base: 'https://v.example', secret: SECRET, fetchImpl: async () => new Response(JSON.stringify({ success: false, code: 'NOT_LINKED', error: 'Not linked' }), { status: 403 }) });
    await expect(v.call('turn', { owner: 'did:plc:a' })).rejects.toMatchObject({ status: 403, code: 'NOT_LINKED' });
    const down = virgaClient({ base: 'https://v.example', secret: SECRET, fetchImpl: async () => Promise.reject(new TypeError('fetch failed')) });
    await expect(down.call('turn', {})).rejects.toBeInstanceOf(VirgaError);
  });
});
