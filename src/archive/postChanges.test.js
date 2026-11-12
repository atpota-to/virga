import { describe, expect, it } from 'vitest';
import { applyPostChanges, isOwnPostUri, postRowsFor } from './postChanges.js';

const DID = 'did:plc:owner';
const uri = (rkey, did = DID, collection = 'app.bsky.feed.post') => `at://${did}/${collection}/${rkey}`;
const record = (text, extra = {}) => ({ $type: 'app.bsky.feed.post', text, createdAt: '2026-11-12T10:00:00.000Z', ...extra });

describe('own posts', () => {
  it('are posts in the account’s own repo', () => {
    expect(isOwnPostUri(DID, uri('3k'))).toBe(true);
    expect(isOwnPostUri(DID, uri('3k', 'did:plc:other'))).toBe(false);
    expect(isOwnPostUri(DID, uri('3k', DID, 'app.bsky.feed.like'))).toBe(false);
    expect(isOwnPostUri(DID, 'https://bsky.app/profile/x/post/3k')).toBe(false);
    expect(isOwnPostUri(null, uri('3k'))).toBe(false);
  });
});

describe('rows for posts just made', () => {
  it('are compact archive rows with zero counts', () => {
    const rows = postRowsFor(DID, [
      { uri: uri('3a'), cid: 'bafy1', record: record('hello') },
      {
        uri: uri('3b'),
        cid: 'bafy2',
        record: record('a reply', { reply: { root: { uri: uri('3a') }, parent: { uri: `at://did:plc:friend/app.bsky.feed.post/9` } } }),
      },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ uri: uri('3a'), rkey: '3a', text: 'hello', at: '2026-11-12T10:00:00.000Z', likes: 0, reposts: 0, replies: 0, quotes: 0 });
    expect(rows[1].replyTo).toBe('did:plc:friend');
  });

  it('leave out another account’s posts and records that can’t be read', () => {
    expect(
      postRowsFor(DID, [
        { uri: uri('3a', 'did:plc:other'), record: record('theirs') },
        { uri: uri('3b'), record: null },
        { uri: uri('3c'), record: { text: 'no date' } },
        null,
      ]),
    ).toEqual([]);
    expect(postRowsFor(DID, undefined)).toEqual([]);
  });
});

describe('applying changes', () => {
  const held = [
    { uri: uri('1'), rkey: '1', at: '2026-01-01T00:00:00.000Z', text: 'old', likes: 4, reposts: 1, replies: 2, quotes: 0 },
    { uri: uri('2'), rkey: '2', at: '2026-02-01T00:00:00.000Z', text: 'older', likes: 0, reposts: 0, replies: 0, quotes: 0 },
  ];

  it('adds new posts at the end and removes deleted ones', () => {
    const [row] = postRowsFor(DID, [{ uri: uri('3'), record: record('new') }]);
    const next = applyPostChanges(held, { rows: [row], removed: [uri('2')] });
    expect(next.map((p) => p.uri)).toEqual([uri('1'), uri('3')]);
    expect(held).toHaveLength(2);
  });

  it('keeps the counts it has when a post it holds is noted again', () => {
    const [row] = postRowsFor(DID, [{ uri: uri('1'), record: record('old, edited') }]);
    const next = applyPostChanges(held, { rows: [row] });
    expect(next[0]).toMatchObject({ uri: uri('1'), text: 'old, edited', likes: 4, reposts: 1, replies: 2 });
  });

  it('returns the same list when nothing changes', () => {
    expect(applyPostChanges(held, {})).toBe(held);
    expect(applyPostChanges(held, { removed: [uri('9')] })).toBe(held);
    const [same] = postRowsFor(DID, [{ uri: uri('2'), record: { ...record('older'), createdAt: '2026-02-01T00:00:00.000Z' } }]);
    const holding = [held[0], same];
    expect(applyPostChanges(holding, { rows: [same] })).toBe(holding);
  });

  it('doesn’t add a post that is removed in the same change', () => {
    const [row] = postRowsFor(DID, [{ uri: uri('5'), record: record('brief') }]);
    expect(applyPostChanges(held, { rows: [row], removed: [uri('5')] })).toBe(held);
  });
});
