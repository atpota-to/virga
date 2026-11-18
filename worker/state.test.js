import { mkdtemp, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LOCK_STALE_MS, PENDING_TTL_MS, fileState } from './state.js';

let dir;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'virga-worker-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('the worker’s state', () => {
  it('starts empty, and keeps the cursor and the session across reads', async () => {
    const s = fileState(dir);
    expect(await s.read()).toEqual({ cursor: null, seeded: false, session: null, pending: {} });
    await s.setCursor('rev-1');
    await s.setSession({ did: 'did:plc:m' });
    expect(await fileState(dir).read()).toMatchObject({ cursor: 'rev-1', seeded: true, session: { did: 'did:plc:m' } });
  });

  it('keeps a question for half an hour, per conversation', async () => {
    let t = 1_000_000;
    const s = fileState(dir, { now: () => t });
    await s.setPending('c1', { name: 'undo', args: {} });
    expect(await s.pending('c1')).toMatchObject({ name: 'undo', at: 1_000_000 });
    expect(await s.pending('c2')).toBeNull();
    t += PENDING_TTL_MS + 1;
    expect(await s.pending('c1')).toBeNull();
    await s.setPending('c1', null);
    expect((await s.read()).pending).toEqual({});
  });

  it('lets one copy hold the lock, and the next take it once it goes stale', async () => {
    const a = fileState(dir);
    const b = fileState(dir);
    expect(await a.lock()).toBe(true);
    expect(await b.lock()).toBe(false);
    const old = new Date(Date.now() - LOCK_STALE_MS - 1000);
    await utimes(join(dir, 'moderator.lock'), old, old);
    expect(await b.lock()).toBe(true);
    await b.unlock();
    expect(await a.lock()).toBe(true);
  });
});
