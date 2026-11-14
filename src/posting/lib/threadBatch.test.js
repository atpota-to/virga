import { describe, it, expect } from 'vitest';
import { isTid } from './tid.js';
import { buildThreadWrites } from './threadBatch.js';
import { computeRecordCid } from './recordCid.js';

// buildThreadWrites turns N base records into one atomic applyWrites batch.
// The properties worth locking:
//   • each write carries a client rkey, and rkeys/createdAt strictly increase
//     (ordering among same-timestamp posts is undefined server-side);
//   • post 2+ replies chain: parent is always the previous post, root is the
//     first post — via CIDs computed locally, matching computeRecordCid;
//   • when the first post replies into an existing thread, every post shares
//     that thread's root and post 1's parent is the post being replied to;
//   • the returned `created` refs mirror what the PDS will store.

const DID = 'did:plc:testwriter';
const COLLECTION = 'app.bsky.feed.post';

const base = (text) => ({
  $type: 'app.bsky.feed.post',
  text,
  facets: [],
  langs: ['en'],
});

describe('buildThreadWrites', () => {
  it('builds one create per record with increasing rkeys and createdAt', async () => {
    const { writes, created } = await buildThreadWrites({
      did: DID,
      collection: COLLECTION,
      records: [base('one'), base('two'), base('three')],
    });

    expect(writes).toHaveLength(3);
    for (const w of writes) {
      expect(w.$type).toBe('com.atproto.repo.applyWrites#create');
      expect(w.collection).toBe(COLLECTION);
      expect(isTid(w.rkey)).toBe(true);
    }
    // Strictly increasing rkeys and timestamps.
    expect(writes[0].rkey < writes[1].rkey).toBe(true);
    expect(writes[1].rkey < writes[2].rkey).toBe(true);
    const times = created.map((c) => c.record.createdAt);
    expect(times[0] < times[1]).toBe(true);
    expect(times[1] < times[2]).toBe(true);
  });

  it('chains replies: root is post 1, parent is the previous post', async () => {
    const { writes, created } = await buildThreadWrites({
      did: DID,
      collection: COLLECTION,
      records: [base('root post'), base('second'), base('third')],
    });

    expect(created[0].record.reply).toBeUndefined();
    expect(created[0].uri).toBe(`at://${DID}/${COLLECTION}/${writes[0].rkey}`);

    expect(created[1].record.reply).toEqual({
      root: { uri: created[0].uri, cid: created[0].cid },
      parent: { uri: created[0].uri, cid: created[0].cid },
    });
    expect(created[2].record.reply).toEqual({
      root: { uri: created[0].uri, cid: created[0].cid },
      parent: { uri: created[1].uri, cid: created[1].cid },
    });
  });

  it('computes each created cid over the final stored record', async () => {
    const { created } = await buildThreadWrites({
      did: DID,
      collection: COLLECTION,
      records: [base('a'), base('b')],
    });
    for (const c of created) {
      await expect(computeRecordCid(c.record)).resolves.toBe(c.cid);
    }
  });

  it('threads replying into an existing thread share its root', async () => {
    const replyTo = {
      root: {
        uri: 'at://did:plc:other/app.bsky.feed.post/3aaa',
        cid: 'bafyroot',
      },
      parent: {
        uri: 'at://did:plc:other/app.bsky.feed.post/3bbb',
        cid: 'bafyparent',
      },
    };
    const { created } = await buildThreadWrites({
      did: DID,
      collection: COLLECTION,
      records: [base('reply one'), base('reply two')],
      replyTo,
    });

    expect(created[0].record.reply).toEqual({
      root: replyTo.root,
      parent: replyTo.parent,
    });
    expect(created[1].record.reply).toEqual({
      root: replyTo.root,
      parent: { uri: created[0].uri, cid: created[0].cid },
    });
  });

  it('does not mutate the caller’s base records', async () => {
    const a = base('immutable');
    await buildThreadWrites({
      did: DID,
      collection: COLLECTION,
      records: [a, base('x')],
    });
    expect(a.reply).toBeUndefined();
    expect(a.createdAt).toBeUndefined();
  });

  it('stamps createdAt from now, a millisecond apart, and mints keys in that order', async () => {
    const now = new Date('2026-11-12T15:00:00.000Z');
    const { created } = await buildThreadWrites({
      did: DID,
      records: [base('a'), base('b'), base('c')],
      now,
    });
    expect(created.map((c) => c.record.createdAt)).toEqual([
      '2026-11-12T15:00:00.000Z',
      '2026-11-12T15:00:00.001Z',
      '2026-11-12T15:00:00.002Z',
    ]);
  });

  it("keeps a record's own createdAt while it increases, and steps past one that does not", async () => {
    const { created } = await buildThreadWrites({
      did: DID,
      records: [
        { ...base('a'), createdAt: '2026-01-01T00:00:00.000Z' },
        { ...base('b'), createdAt: '2026-01-01T00:00:05.000Z' },
        { ...base('c'), createdAt: '2025-01-01T00:00:00.000Z' },
      ],
    });
    expect(created.map((c) => c.record.createdAt)).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:05.000Z',
      '2026-01-01T00:00:05.001Z',
    ]);
  });

  it('replaces any reply a base record carried with the chain', async () => {
    const { created } = await buildThreadWrites({
      did: DID,
      records: [{ ...base('a'), reply: { root: 'x', parent: 'y' } }],
    });
    expect(created[0].record.reply).toBeUndefined();
  });
});
