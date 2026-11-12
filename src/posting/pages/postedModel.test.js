import { describe, expect, it, vi } from 'vitest';
import {
  deletePost,
  filterPostRows,
  isReplyRow,
  postRowActions,
  readPostGates,
  readPostNow,
  templateSeedFrom,
  textForComposer,
} from './postedModel.js';

const DID = 'did:plc:mira';
const URI = `at://${DID}/app.bsky.feed.post/3abc`;

const rows = [
  { uri: `at://${DID}/app.bsky.feed.post/1`, text: 'A walk by the river', replyTo: null, hasMedia: true },
  { uri: `at://${DID}/app.bsky.feed.post/2`, text: 'Agreed, the river', replyTo: 'did:plc:other', hasMedia: false },
  { uri: `at://${DID}/app.bsky.feed.post/3`, text: 'continuing my thread', replyTo: DID, hasMedia: false },
];

describe('filterPostRows', () => {
  it('tells replies from posts by who they answer', () => {
    expect(isReplyRow(rows[1], DID)).toBe(true);
    expect(isReplyRow(rows[2], DID)).toBe(false);
    expect(filterPostRows(rows, { did: DID, filter: 'posts' }).map((r) => r.text)).toEqual([
      'A walk by the river',
      'continuing my thread',
    ]);
    expect(filterPostRows(rows, { did: DID, filter: 'replies' })).toHaveLength(1);
    expect(filterPostRows(rows, { did: DID, filter: 'media' })).toHaveLength(1);
  });
  it('searches the words, ignoring case', () => {
    expect(filterPostRows(rows, { did: DID, query: ' RIVER ' })).toHaveLength(2);
    expect(filterPostRows(rows, { did: DID, filter: 'replies', query: 'river' })).toHaveLength(1);
  });
});

function fetchAnswering(posts) {
  return vi.fn(async () => ({ ok: true, json: async () => ({ posts }) }));
}

describe('readPostNow', () => {
  it('reads the public view first', async () => {
    const fetch = fetchAnswering([{ uri: URI, cid: 'bafy1', record: { text: 'hi' } }]);
    const agent = { com: { atproto: { repo: { getRecord: vi.fn() } } } };
    const post = await readPostNow(URI, { agent, fetch });
    expect(post).toMatchObject({ uri: URI, cid: 'bafy1', record: { text: 'hi' } });
    expect(agent.com.atproto.repo.getRecord).not.toHaveBeenCalled();
  });

  it('falls back to the repo when the AppView hasn’t got it', async () => {
    const fetch = fetchAnswering([]);
    const getRecord = vi.fn(async () => ({ data: { cid: 'bafy2', value: { text: 'repo' } } }));
    const post = await readPostNow(URI, { agent: { com: { atproto: { repo: { getRecord } } } }, fetch });
    expect(getRecord).toHaveBeenCalledWith({ repo: DID, collection: 'app.bsky.feed.post', rkey: '3abc' });
    expect(post).toEqual({ uri: URI, cid: 'bafy2', record: { text: 'repo' }, view: null });
  });

  it('says a post is gone when neither has it', async () => {
    const fetch = fetchAnswering([]);
    const getRecord = vi.fn(async () => Promise.reject(Object.assign(new Error('Could not locate record'), { status: 400 })));
    await expect(readPostNow(URI, { agent: { com: { atproto: { repo: { getRecord } } } }, fetch })).rejects.toMatchObject({
      code: 'GONE',
    });
  });

  it('passes a failed read on, rather than calling it gone', async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) }));
    const getRecord = vi.fn(async () => Promise.reject(Object.assign(new Error('offline'), { status: 0 })));
    await expect(readPostNow(URI, { agent: { com: { atproto: { repo: { getRecord } } } }, fetch })).rejects.not.toMatchObject({
      code: 'GONE',
    });
  });
});

describe('readPostGates', () => {
  const agentWith = (records) => ({
    com: {
      atproto: {
        repo: {
          getRecord: vi.fn(async ({ collection }) => {
            if (!records[collection]) throw Object.assign(new Error('RecordNotFound'), { error: 'RecordNotFound' });
            return { data: { value: records[collection] } };
          }),
        },
      },
    },
  });

  it('reads everyone when there are no gates', async () => {
    expect(await readPostGates(URI, { agent: agentWith({}) })).toEqual({ reply: null, quotes: true });
  });

  it('reads the rules', async () => {
    const gates = await readPostGates(URI, {
      agent: agentWith({
        'app.bsky.feed.threadgate': { allow: [{ $type: 'app.bsky.feed.threadgate#followingRule' }] },
        'app.bsky.feed.postgate': { embeddingRules: [{ $type: 'app.bsky.feed.postgate#disableRule' }] },
      }),
    });
    expect(gates).toEqual({ reply: [{ type: 'following' }], quotes: false });
  });

  it('reads a threadgate with an empty allow as nobody, and one without as everyone', async () => {
    expect(
      (await readPostGates(URI, { agent: agentWith({ 'app.bsky.feed.threadgate': { allow: [] } }) })).reply,
    ).toEqual([]);
    expect(
      (await readPostGates(URI, { agent: agentWith({ 'app.bsky.feed.threadgate': { hiddenReplies: ['x'] } }) })).reply,
    ).toBeNull();
  });
});

describe('deletePost', () => {
  it('deletes the post and then its gates', async () => {
    const deleteRecord = vi.fn(async () => ({}));
    await deletePost(URI, { agent: { com: { atproto: { repo: { deleteRecord } } } } });
    expect(deleteRecord.mock.calls.map((c) => c[0].collection)).toEqual([
      'app.bsky.feed.post',
      'app.bsky.feed.threadgate',
      'app.bsky.feed.postgate',
    ]);
  });

  it('fails when the post can’t be deleted', async () => {
    const deleteRecord = vi.fn(async () => Promise.reject(Object.assign(new Error('Missing required scope'), { status: 403 })));
    await expect(deletePost(URI, { agent: { com: { atproto: { repo: { deleteRecord } } } } })).rejects.toThrow(/scope/);
    expect(deleteRecord).toHaveBeenCalledTimes(1);
  });

  it('counts a post already gone as deleted', async () => {
    const deleteRecord = vi.fn(async ({ collection }) => {
      if (collection === 'app.bsky.feed.post') throw Object.assign(new Error('RecordNotFound'), { error: 'RecordNotFound' });
      throw new Error('no gate');
    });
    await expect(deletePost(URI, { agent: { com: { atproto: { repo: { deleteRecord } } } } })).resolves.toBeUndefined();
  });
});

describe('textForComposer and templateSeedFrom', () => {
  const record = {
    text: 'read this',
    facets: [
      {
        index: { byteStart: 5, byteEnd: 9 },
        features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://example.com/x' }],
      },
    ],
    embed: { $type: 'app.bsky.embed.record', record: { uri: 'at://did:plc:x/app.bsky.feed.post/1', cid: 'c' } },
  };

  it('puts links back as the composer writes them', () => {
    expect(textForComposer(record)).toBe('read [this](https://example.com/x)');
    expect(textForComposer({})).toBe('');
  });

  it('keeps a quote, a link card or a quote with media’s record, and never pictures', () => {
    expect(templateSeedFrom(record).embed).toEqual(record.embed);
    expect(
      templateSeedFrom({
        text: '',
        embed: { $type: 'app.bsky.embed.external', external: { uri: 'https://a.example', title: 'A' } },
      }).embed,
    ).toEqual({ $type: 'app.bsky.embed.external', external: { uri: 'https://a.example', title: 'A', description: '' } });
    expect(
      templateSeedFrom({
        text: '',
        embed: {
          $type: 'app.bsky.embed.recordWithMedia',
          record: { record: { uri: 'at://x/app.bsky.feed.post/1', cid: 'c' } },
          media: { $type: 'app.bsky.embed.images', images: [] },
        },
      }).embed,
    ).toEqual({ $type: 'app.bsky.embed.record', record: { uri: 'at://x/app.bsky.feed.post/1', cid: 'c' } });
    expect(templateSeedFrom({ text: 'x', embed: { $type: 'app.bsky.embed.images', images: [] } }).embed).toBeNull();
  });
});

describe('postRowActions', () => {
  it('offers by capability', () => {
    expect(postRowActions(rows[0], { did: DID, canPost: true, canSchedule: false })).toMatchObject({
      reply: true,
      gates: true,
      gatesQuotesOnly: false,
      timer: false,
      delete: true,
    });
    expect(postRowActions(rows[1], { did: DID, canPost: false, canSchedule: true })).toMatchObject({
      reply: false,
      gatesQuotesOnly: true,
      timer: true,
      delete: false,
      template: true,
    });
  });
});
