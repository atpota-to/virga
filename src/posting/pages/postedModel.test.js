import { describe, expect, it, vi } from 'vitest';
import {
  deletePost,
  fetchPostImages,
  filterPostRows,
  gatesQuotesOnlyFor,
  isReplyRow,
  postAgainIntent,
  postAgainSeed,
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
    expect(postRowActions(rows[0], { canPost: true, canSchedule: false })).toMatchObject({
      reply: true,
      again: true,
      gates: true,
      gatesQuotesOnly: false,
      timer: false,
      delete: true,
    });
    expect(postRowActions(rows[1], { canPost: false, canSchedule: true })).toMatchObject({
      reply: false,
      gatesQuotesOnly: true,
      timer: true,
      delete: false,
      template: true,
    });
  });
});

describe('posting a post again', () => {
  const blob = (cid, mimeType = 'image/jpeg') => ({ $type: 'blob', ref: { $link: cid }, mimeType, size: 10 });
  const QUOTED = 'at://did:plc:other/app.bsky.feed.post/3q';
  const linkFacet = {
    index: { byteStart: 5, byteEnd: 15 },
    features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://example.com/a-long-page' }],
  };

  it('takes the words with their links, the tags and the languages', () => {
    const seed = postAgainSeed({
      text: 'Read example.co… today',
      facets: [linkFacet],
      tags: ['Gardens', 'gardens', 'seeds'],
      langs: ['en', 'fr', ''],
    });
    expect(seed.text).toBe(textForComposer({ text: 'Read example.co… today', facets: [linkFacet] }));
    expect(seed.text).toContain('https://example.com/a-long-page');
    expect(seed.tags).toEqual(['Gardens', 'seeds']);
    expect(seed.langs).toEqual(['en', 'fr']);
    expect(seed).toMatchObject({ quote: null, link: null, images: [], video: false, labelled: false });
  });

  it('takes a quote, a link card, and pictures in order with their alt text', () => {
    expect(
      postAgainSeed({ text: 'q', embed: { $type: 'app.bsky.embed.record', record: { uri: QUOTED, cid: 'c' } } }).quote,
    ).toBe(QUOTED);
    expect(
      postAgainSeed({
        text: 'l',
        embed: {
          $type: 'app.bsky.embed.external',
          external: { uri: 'https://example.com/x', title: 'T', description: 'D', thumb: blob('bafthumb') },
        },
      }).link,
    ).toEqual({ url: 'https://example.com/x', title: 'T', description: 'D' });
    const withMedia = postAgainSeed({
      text: 'both',
      embed: {
        $type: 'app.bsky.embed.recordWithMedia',
        record: { $type: 'app.bsky.embed.record', record: { uri: QUOTED, cid: 'c' } },
        media: {
          $type: 'app.bsky.embed.images',
          images: [
            { image: blob('bafone'), alt: 'a lamp' },
            { image: blob('baftwo', 'image/png') },
            { image: null, alt: 'no blob' },
          ],
        },
      },
    });
    expect(withMedia.quote).toBe(QUOTED);
    expect(withMedia.images).toEqual([
      { cid: 'bafone', mime: 'image/jpeg', alt: 'a lamp' },
      { cid: 'baftwo', mime: 'image/png', alt: '' },
    ]);
    expect(
      postAgainSeed({
        embed: { $type: 'app.bsky.embed.gallery', items: [{ image: blob('bafg'), alt: 'g' }] },
      }).images,
    ).toEqual([{ cid: 'bafg', mime: 'image/jpeg', alt: 'g' }]);
  });

  it('notes a video and a content warning', () => {
    expect(postAgainSeed({ embed: { $type: 'app.bsky.embed.video', video: blob('bafv', 'video/mp4') } }).video).toBe(true);
    expect(
      postAgainSeed({ labels: { $type: 'com.atproto.label.defs#selfLabels', values: [{ val: 'nudity' }] } }).labelled,
    ).toBe(true);
  });

  it('reads the pictures back from the account’s PDS, counting any it can’t', async () => {
    const fetch = vi.fn(async (url) =>
      String(url).includes('cid=bafgone')
        ? new Response('{"error":"BlobNotFound"}', { status: 400 })
        : new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }),
    );
    const out = await fetchPostImages(
      [
        { cid: 'bafone', mime: 'image/jpeg', alt: 'a lamp' },
        { cid: 'bafgone', mime: 'image/jpeg', alt: '' },
      ],
      { did: DID, pdsUrl: 'https://pds.example/', fetch },
    );
    expect(fetch.mock.calls[0][0]).toBe(
      `https://pds.example/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(DID)}&cid=bafone`,
    );
    expect(out.missing).toBe(1);
    expect(out.files).toHaveLength(1);
    expect(out.files[0].alt).toBe('a lamp');
    expect(out.files[0].file).toBeInstanceOf(File);
    expect(out.files[0].file).toMatchObject({ type: 'image/png', size: 3, name: 'posted-image-1.png' });
    // No PDS to ask: every picture is missing, and nothing throws.
    expect(await fetchPostImages([{ cid: 'bafone', mime: 'image/jpeg', alt: '' }], { did: DID })).toEqual({
      files: [],
      missing: 1,
    });
  });

  it('opens the composer with what came along, and says what didn’t', () => {
    const seed = {
      text: 'Hello again',
      tags: ['seeds'],
      langs: ['en'],
      quote: QUOTED,
      link: null,
      images: [{ cid: 'a', mime: 'image/jpeg', alt: 'x' }, { cid: 'b', mime: 'image/jpeg', alt: '' }],
      video: false,
      labelled: false,
    };
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    const full = postAgainIntent(seed, { did: DID, files: [{ file, alt: 'x' }], missing: 1 });
    expect(full.intent).toEqual({
      asDid: DID,
      text: 'Hello again',
      tags: ['seeds'],
      langs: ['en'],
      quote: { uri: QUOTED },
      images: [{ file, alt: 'x' }],
    });
    expect(full.notes).toEqual(['One of its pictures couldn’t be fetched. Add it again.']);
    expect(postAgainIntent(seed, { did: DID, files: [], missing: 2 }).notes).toEqual([
      '2 of its pictures couldn’t be fetched. Add them again.',
    ]);
  });

  it('carries a link card when there are no pictures, and never both', () => {
    const base = { text: 'x', tags: [], langs: [], quote: null, images: [], video: false, labelled: false };
    const link = { url: 'https://example.com/x', title: 'T', description: 'D' };
    expect(postAgainIntent({ ...base, link }, { did: DID }).intent).toEqual({
      asDid: DID,
      text: 'x',
      attach: { attach: { kind: 'link', ...link } },
    });
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    const both = postAgainIntent({ ...base, link }, { did: DID, files: [{ file, alt: '' }] }).intent;
    expect(both.images).toHaveLength(1);
    expect(both).not.toHaveProperty('attach');
  });

  it('leaves the pictures of a post with a content warning for the writer to add, with the warning', () => {
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    const out = postAgainIntent(
      { text: 'x', tags: [], langs: [], quote: null, link: null, images: [{ cid: 'a' }], video: true, labelled: true },
      { did: DID, files: [{ file, alt: '' }] },
    );
    expect(out.intent).not.toHaveProperty('images');
    expect(out.notes).toEqual([
      'It had a content warning, so its pictures weren’t brought over. Add them again and set the warning.',
      'Its video isn’t carried over. Add it again.',
    ]);
  });

  it('has nothing to open for a post that was only pictures it couldn’t read', () => {
    const out = postAgainIntent(
      { text: ' ', tags: [], langs: [], quote: null, link: null, images: [{ cid: 'a' }], video: false, labelled: false },
      { did: DID, files: [], missing: 1 },
    );
    expect(out.intent).toBeNull();
    expect(out.notes).toHaveLength(1);
  });
});

describe('gatesQuotesOnlyFor', () => {
  const offer = (row) => postRowActions(row, { canPost: true, canSchedule: true });
  const reply = { parent: { uri: 'at://x/app.bsky.feed.post/p', cid: 'c' }, root: { uri: 'at://x/app.bsky.feed.post/r', cid: 'c' } };

  it('takes a post that continues the account’s own thread as a reply', () => {
    expect(isReplyRow(rows[2], DID)).toBe(false);
    expect(offer(rows[2]).gatesQuotesOnly).toBe(true);
    // A row that doesn't say (one built from a view without its parent): the
    // post as it reads now settles it.
    const bare = { uri: rows[2].uri, text: rows[2].text, replyTo: null };
    expect(offer(bare).gatesQuotesOnly).toBe(false);
    expect(gatesQuotesOnlyFor(offer(bare), { text: 'continuing my thread', reply })).toBe(true);
  });

  it('keeps a reply to somebody else a reply, and a post that starts a thread not one', () => {
    expect(gatesQuotesOnlyFor(offer(rows[1]), { text: 'Agreed' })).toBe(true);
    expect(gatesQuotesOnlyFor(offer(rows[0]), { text: 'A walk by the river' })).toBe(false);
  });
});
