import { describe, expect, it, vi } from 'vitest';
import { isWorkerAuthorized } from '../server/defense/workerAuth.js';
import { RUN_PATH, driveOnce, nextDelay, readConfig } from './drive.js';

const SECRET = 'a'.repeat(64);

describe('the worker’s settings', () => {
  it('want an https origin and a long secret', () => {
    expect(readConfig({ VIRGA_URL: 'https://virga.example/', DEFENSE_WORKER_SECRET: SECRET })).toEqual({ base: 'https://virga.example', secret: SECRET, intervalMs: 60_000 });
    expect(readConfig({ VIRGA_URL: 'http://127.0.0.1:3000', DEFENSE_WORKER_SECRET: SECRET, WORKER_INTERVAL_SECONDS: '30' }).intervalMs).toBe(30_000);
    expect(readConfig({ VIRGA_URL: 'https://virga.example', DEFENSE_WORKER_SECRET: SECRET, WORKER_INTERVAL_SECONDS: '1' }).intervalMs).toBe(60_000);
    expect(() => readConfig({ VIRGA_URL: 'http://virga.example', DEFENSE_WORKER_SECRET: SECRET })).toThrow(/https/);
    expect(() => readConfig({ VIRGA_URL: 'https://virga.example/api', DEFENSE_WORKER_SECRET: SECRET })).toThrow(/origin/);
    expect(() => readConfig({ VIRGA_URL: 'nope', DEFENSE_WORKER_SECRET: SECRET })).toThrow(/VIRGA_URL/);
    expect(() => readConfig({ VIRGA_URL: 'https://virga.example', DEFENSE_WORKER_SECRET: 'short' })).toThrow(/DEFENSE_WORKER_SECRET/);
  });
});

describe('a call to the run route', () => {
  it('is signed so the server’s own check takes it', async () => {
    let seen;
    const fetchImpl = vi.fn(async (url, init) => {
      const u = new URL(url);
      seen = { method: init.method, url: u.pathname, headers: Object.fromEntries(Object.entries(init.headers).map(([k, v]) => [k.toLowerCase(), v])) };
      return new Response(JSON.stringify({ success: true, data: { ran: true, written: 3 } }), { status: 200 });
    });
    const out = await driveOnce({ base: 'https://virga.example', secret: SECRET, fetchImpl });
    expect(out).toEqual({ ok: true, status: 200, summary: { ran: true, written: 3 } });
    expect(seen.url).toBe(RUN_PATH);
    expect(isWorkerAuthorized(seen, { DEFENSE_WORKER_SECRET: SECRET })).toBe(true);
    expect(isWorkerAuthorized(seen, { DEFENSE_WORKER_SECRET: 'b'.repeat(64) })).toBe(false);
  });

  it('never throws: a refusal or no answer is an outcome', async () => {
    expect(await driveOnce({ base: 'https://v.example', secret: SECRET, fetchImpl: async () => new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), { status: 401 }) })).toEqual({ ok: false, status: 401, error: 'Unauthorized' });
    expect(await driveOnce({ base: 'https://v.example', secret: SECRET, fetchImpl: async () => { throw new TypeError('fetch failed'); } })).toEqual({ ok: false, status: 0, error: 'fetch failed' });
  });
});

describe('the wait between calls', () => {
  it('is the interval, give or take a tenth, and doubles after failures up to ten minutes', () => {
    const mid = () => 0.5;
    expect(nextDelay({ intervalMs: 60_000, random: mid })).toBe(60_000);
    expect(nextDelay({ intervalMs: 60_000, random: () => 0 })).toBe(54_000);
    expect(nextDelay({ intervalMs: 60_000, failures: 1, random: mid })).toBe(120_000);
    expect(nextDelay({ intervalMs: 60_000, failures: 3, random: mid })).toBe(480_000);
    expect(nextDelay({ intervalMs: 60_000, failures: 20, random: mid })).toBe(600_000);
    // A wrong secret won't fix itself.
    expect(nextDelay({ intervalMs: 60_000, failures: 1, status: 401, random: mid })).toBe(600_000);
  });
});
