import { describe, expect, it, vi } from 'vitest';
import { CURATION_LIMITS, VetoUnreadable, curationMembers, followedNow, vetoed } from './veto.js';

const OWNER = 'did:plc:owner';
const HOLDER = 'did:plc:holder';

/** A fake public AppView: `follows` is the set the owner follows; `lists` their lists, with members. */
function appview({ follows = new Set(), lists = [], fail = null } = {}) {
  return vi.fn(async (url) => {
    const u = new URL(url);
    const method = u.pathname.split('/xrpc/')[1];
    if (fail === method) return new Response('down', { status: 502 });
    const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (method === 'app.bsky.graph.getRelationships') {
      return json({ relationships: u.searchParams.getAll('others').map((did) => ({ did, ...(follows.has(did) ? { following: `at://${OWNER}/app.bsky.graph.follow/x` } : {}) })) });
    }
    if (method === 'app.bsky.graph.getLists') {
      return json({ lists: lists.map((l) => ({ uri: l.uri, name: l.name, purpose: l.purpose })) });
    }
    if (method === 'app.bsky.graph.getList') {
      const list = lists.find((l) => l.uri === u.searchParams.get('list'));
      const from = Number(u.searchParams.get('cursor') || 0);
      const page = list.members.slice(from, from + 100);
      return json({ list: { uri: list.uri }, items: page.map((did) => ({ subject: { did } })), cursor: from + 100 < list.members.length ? String(from + 100) : undefined });
    }
    return new Response('?', { status: 404 });
  });
}

const CURATE = 'app.bsky.graph.defs#curatelist';
const MOD = 'app.bsky.graph.defs#modlist';

describe('the veto', () => {
  const fetchImpl = appview({
    follows: new Set(['did:plc:friend']),
    lists: [
      { uri: 'at://owner/l/1', name: 'Neighbours', purpose: CURATE, members: ['did:plc:neighbour'] },
      { uri: 'at://owner/l/2', name: 'Blocked', purpose: MOD, members: ['did:plc:stranger'] },
    ],
  });

  it('never lets through the owner, the holder, the kept, the followed or the curated', async () => {
    const out = await vetoed({
      ownerDid: OWNER,
      holderDid: HOLDER,
      dids: [OWNER, HOLDER, 'did:plc:kept', 'did:plc:friend', 'did:plc:neighbour', 'did:plc:stranger'],
      kept: new Map([['did:plc:kept', 'my sister']]),
      fetchImpl,
    });
    expect(Object.fromEntries(out)).toEqual({
      [OWNER]: 'your own account',
      [HOLDER]: 'the account that holds the list',
      'did:plc:kept': 'my sister',
      'did:plc:friend': 'you follow them',
      'did:plc:neighbour': 'on your list “Neighbours”',
    });
    // A moderation list's members are not protected by being on it.
    expect(out.has('did:plc:stranger')).toBe(false);
  });

  it('writes nothing when who you follow can’t be read', async () => {
    await expect(vetoed({ ownerDid: OWNER, dids: ['did:plc:x'], fetchImpl: appview({ fail: 'app.bsky.graph.getRelationships' }) })).rejects.toBeInstanceOf(VetoUnreadable);
  });

  it('writes nothing when the curation lists can’t be read, or are too many to read', async () => {
    await expect(vetoed({ ownerDid: OWNER, dids: ['did:plc:x'], fetchImpl: appview({ fail: 'app.bsky.graph.getList', lists: [{ uri: 'a', name: 'A', purpose: CURATE, members: [] }] }) })).rejects.toBeInstanceOf(VetoUnreadable);
    const many = Array.from({ length: CURATION_LIMITS.lists + 1 }, (_, i) => ({ uri: `l${i}`, name: `L${i}`, purpose: CURATE, members: [] }));
    await expect(curationMembers(OWNER, { fetchImpl: appview({ lists: many }) })).rejects.toBeInstanceOf(VetoUnreadable);
    const big = [{ uri: 'big', name: 'Big', purpose: CURATE, members: Array.from({ length: 250 }, (_, i) => `did:plc:m${i}`) }];
    await expect(curationMembers(OWNER, { fetchImpl: appview({ lists: big }), limits: { lists: 20, membersPerList: 200 } })).rejects.toBeInstanceOf(VetoUnreadable);
    expect((await curationMembers(OWNER, { fetchImpl: appview({ lists: big }) })).size).toBe(250);
  });

  it('reads nothing when everyone is decided without the network', async () => {
    const f = appview();
    expect((await vetoed({ ownerDid: OWNER, dids: [OWNER], fetchImpl: f })).get(OWNER)).toBe('your own account');
    expect(f).not.toHaveBeenCalled();
  });

  it('takes the curation lists from a caller that already read them', async () => {
    const f = appview();
    const out = await vetoed({ ownerDid: OWNER, dids: ['did:plc:n'], curation: async () => new Map([['did:plc:n', 'Mine']]), fetchImpl: f });
    expect(out.get('did:plc:n')).toBe('on your list “Mine”');
    expect(f.mock.calls.every(([u]) => !String(u).includes('getList'))).toBe(true);
  });

  it('asks about the follows thirty at a time', async () => {
    const f = appview({ follows: new Set(['did:plc:f45']) });
    const dids = Array.from({ length: 70 }, (_, i) => `did:plc:f${i}`);
    const out = await followedNow(OWNER, dids, { fetchImpl: f });
    expect([...out]).toEqual(['did:plc:f45']);
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('needs an owner', async () => {
    await expect(vetoed({ dids: ['did:plc:x'] })).rejects.toBeInstanceOf(VetoUnreadable);
  });
});
