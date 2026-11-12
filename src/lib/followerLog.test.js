import { describe, expect, it } from 'vitest';
import { FOLLOWER_LOG_LIMIT, followerChanges, mergeFollowerLog } from './followerLog.js';

const f = (did, extra = {}) => ({ did, handle: `${did}.test`, displayName: '', avatar: '', followedAt: '2026-01-01T00:00:00.000Z', ...extra });

describe('follower changes between syncs', () => {
  it('finds who left and who arrived, keeping what was known about them', () => {
    const before = [f('a'), f('b'), f('c', { displayName: 'Cee' })];
    const after = [f('a'), f('d')];
    const changes = followerChanges(before, after, { at: 200, since: 100 });
    expect(changes.map((c) => [c.kind, c.did])).toEqual([
      ['lost', 'b'],
      ['lost', 'c'],
      ['gained', 'd'],
    ]);
    expect(changes[1]).toMatchObject({ displayName: 'Cee', handle: 'c.test', at: 200, since: 100 });
  });

  it('puts the newest changes first and caps the log', () => {
    const held = { entries: Array.from({ length: FOLLOWER_LOG_LIMIT }, (_, i) => ({ did: `old${i}` })), firstSyncAt: 1 };
    const out = mergeFollowerLog(held, [{ did: 'new' }], 300);
    expect(out.entries[0].did).toBe('new');
    expect(out.entries).toHaveLength(FOLLOWER_LOG_LIMIT);
    expect(out).toMatchObject({ lastSyncAt: 300, firstSyncAt: 1 });
  });

  it('starts a log from nothing, and a quiet sync still moves its stamp', () => {
    const out = mergeFollowerLog(null, [], 50);
    expect(out).toEqual({ entries: [], lastSyncAt: 50, firstSyncAt: 50 });
  });
});
