import { describe, expect, it, vi } from 'vitest';
import {
  DRAFT_LIMIT_MESSAGE,
  composerStateToDraft,
  createDraft,
  deleteDraft,
  draftLocalRefs,
  draftToComposerState,
  isDraftLimitError,
  listAllDrafts,
  listDrafts,
  openDraft,
  postingDeviceId,
  pruneOrphanedDraftMedia,
  summarizeDraft,
  updateDraft,
} from './drafts.js';
import { emptyComposerState, emptyPost } from '../lib/composerModel.js';
import { POSTING_EVENTS, onPostingEvent } from '../events.js';
import { autosaveKey, clearSessionDraft, saveSessionDraft } from '../autosave.js';

const ALICE = 'did:plc:alice';
const BOB = 'did:plc:bob';
const DEVICE = '0b6c3c2e-9f0a-4d6e-8a1b-2c3d4e5f6a7b';
const POST_URI = 'at://did:plc:carol/app.bsky.feed.post/3kq';
const ROOT_URI = 'at://did:plc:carol/app.bsky.feed.post/3kp';
const LIST_URI = 'at://did:plc:carol/app.bsky.graph.list/3kl';
const BLOB = {
  $type: 'blob',
  ref: { $link: 'bafkreiimage' },
  mimeType: 'image/jpeg',
  size: 2048,
};
const THUMB = {
  $type: 'blob',
  ref: { $link: 'bafkreithumb' },
  mimeType: 'image/jpeg',
  size: 512,
};

/** An agent whose drafts live in memory, answering as the AppView does. */
function fakeAgent({ did = ALICE, pageSize, failCreate, failGet } = {}) {
  const stash = new Map();
  let minted = 0;
  const calls = { proxies: [] };
  const draft = {
    getDrafts: vi.fn(async ({ limit = 50, cursor } = {}) => {
      if (failGet) throw new Error('offline');
      const all = [...stash.values()].sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      );
      const size = pageSize || limit;
      const start = cursor ? Number(cursor) : 0;
      const page = all.slice(start, start + size);
      const next = start + size < all.length ? String(start + size) : undefined;
      return { data: { drafts: page, cursor: next } };
    }),
    createDraft: vi.fn(async ({ draft: d }) => {
      if (failCreate) throw failCreate;
      minted += 1;
      const id = `3draft${minted}`;
      const at = new Date(Date.UTC(2026, 10, 12, 0, minted)).toISOString();
      stash.set(id, { id, draft: d, createdAt: at, updatedAt: at });
      return { data: { id } };
    }),
    updateDraft: vi.fn(async ({ draft: { id, draft: d } }) => {
      const prev = stash.get(id);
      // Bluesky ignores an update to a draft that isn't there.
      if (prev)
        stash.set(id, {
          ...prev,
          draft: d,
          updatedAt: new Date(Date.UTC(2026, 10, 13)).toISOString(),
        });
      return { data: {} };
    }),
    deleteDraft: vi.fn(async ({ id }) => {
      stash.delete(id);
      return { data: {} };
    }),
  };
  const agent = {
    did,
    app: { bsky: { draft } },
    withProxy: vi.fn((service, aud) => {
      calls.proxies.push([service, aud]);
      return agent;
    }),
  };
  return { agent, stash, draft, calls };
}

/** A draftMedia store in memory. */
function memoryMedia() {
  const rows = new Map();
  return {
    rows,
    persistent: false,
    put: async (entries) => entries.forEach((e) => rows.set(e.ref, e)),
    get: async (ref) => rows.get(ref) || null,
    remove: async (refs) => refs.forEach((r) => rows.delete(r)),
    refs: async () => [...rows.keys()],
  };
}

function state(fields = {}) {
  return {
    ...emptyComposerState({ asDid: ALICE, defaults: { langs: ['en'] } }),
    ...fields,
  };
}

function post(fields = {}) {
  return { ...emptyPost(), ...fields };
}

const quietly = { target: null, deviceId: DEVICE };

describe('composerStateToDraft', () => {
  it('writes the lexicon’s fields and Anisota’s beside them', () => {
    const facets = [
      {
        index: { byteStart: 0, byteEnd: 4 },
        features: [
          {
            $type: 'app.bsky.richtext.facet#link',
            uri: 'https://moth.example',
          },
        ],
      },
    ];
    const s = state({
      posts: [
        post({
          text: '[moth](https://moth.example) night',
          images: [
            {
              id: 'i1',
              localRef: 'virga-media:1',
              alt: 'a moth',
              blob: BLOB,
              blobDid: ALICE,
              aspectRatio: { width: 4, height: 3 },
            },
          ],
          record: { kind: 'post', uri: POST_URI, cid: 'cidq' },
        }),
      ],
      tags: ['#Moths', 'moths', 'night'],
      labels: ['nudity'],
      langs: ['en', 'fr'],
    });
    const draft = composerStateToDraft(s, {
      texts: [{ text: 'moth night', facets }],
      deviceId: DEVICE,
    });
    expect(draft).toMatchObject({
      $type: 'app.bsky.draft.defs#draft',
      deviceName: 'Virga',
      deviceId: DEVICE,
      langs: ['en', 'fr'],
    });
    const [p] = draft.posts;
    expect(p.text).toBe('moth night');
    expect(p.labels).toEqual({
      $type: 'com.atproto.label.defs#selfLabels',
      values: [{ val: 'nudity' }],
    });
    expect(p.embedImages).toEqual([
      {
        $type: 'app.bsky.draft.defs#draftEmbedImage',
        localRef: { path: 'virga-media:1' },
        alt: 'a moth',
      },
    ]);
    expect(p.embedRecords).toEqual([
      {
        $type: 'app.bsky.draft.defs#draftEmbedRecord',
        record: { uri: POST_URI, cid: 'cidq' },
      },
    ]);
    expect(p.facets).toEqual(facets);
    expect(p.tags).toEqual(['Moths', 'night']);
    expect(p.embed).toEqual({
      $type: 'app.bsky.embed.recordWithMedia',
      record: {
        $type: 'app.bsky.embed.record',
        record: { uri: POST_URI, cid: 'cidq' },
      },
      media: {
        $type: 'app.bsky.embed.images',
        images: [
          { image: BLOB, alt: 'a moth', aspectRatio: { width: 4, height: 3 } },
        ],
      },
    });
    expect(draft).not.toHaveProperty('threadgateAllow');
  });

  it('keeps a whole thread, with tags and labels on every post and the reply on the first', () => {
    const s = state({
      posts: [
        post({ text: 'one' }),
        post({
          text: 'two',
          card: {
            url: 'https://example.com',
            title: 'Ex',
            description: 'd',
            thumb: null,
            thumbBlob: THUMB,
            thumbBlobDid: ALICE,
          },
        }),
      ],
      reply: {
        uri: POST_URI,
        cid: 'cidq',
        root: { uri: ROOT_URI, cid: 'cidr' },
      },
      tags: ['t'],
      labels: ['porn'],
    });
    const draft = composerStateToDraft(s, {
      texts: [
        { text: 'one', facets: [] },
        { text: 'two', facets: [] },
      ],
    });
    expect(draft.posts).toHaveLength(2);
    expect(draft.posts.map((p) => p.tags)).toEqual([['t'], ['t']]);
    expect(
      draft.posts.every((p) => p.labels?.values?.[0]?.val === 'porn'),
    ).toBe(true);
    expect(draft.posts[0].reply).toEqual({
      root: { uri: ROOT_URI, cid: 'cidr' },
      parent: { uri: POST_URI, cid: 'cidq' },
    });
    expect(draft.posts[1]).not.toHaveProperty('reply');
    expect(draft.posts[1].embedExternals).toEqual([
      {
        $type: 'app.bsky.draft.defs#draftEmbedExternal',
        uri: 'https://example.com',
      },
    ]);
    expect(draft.posts[1].embed).toEqual({
      $type: 'app.bsky.embed.external',
      external: {
        uri: 'https://example.com',
        title: 'Ex',
        description: 'd',
        thumb: THUMB,
      },
    });
  });

  it('leaves out blobs another account uploaded, and media with no path', () => {
    const s = state({
      posts: [
        post({
          text: 'x',
          images: [
            { id: 'a', blob: BLOB, blobDid: BOB },
            { id: 'b', file: { name: 'b' } },
          ],
        }),
      ],
    });
    const [p] = composerStateToDraft(s, {
      texts: [{ text: 'x', facets: [] }],
    }).posts;
    expect(p).not.toHaveProperty('embed');
    expect(p).not.toHaveProperty('embedImages');
  });

  it('keeps reply and quote settings only when chosen for this post, and never on a reply', () => {
    const custom = state({
      posts: [post({ text: 'x' })],
      gates: {
        custom: true,
        reply: [{ type: 'following' }, { type: 'list', list: LIST_URI }],
        quotes: false,
      },
    });
    const draft = composerStateToDraft(custom, {
      texts: [{ text: 'x', facets: [] }],
    });
    expect(draft.threadgateAllow).toEqual([
      { $type: 'app.bsky.feed.threadgate#followingRule' },
      { $type: 'app.bsky.feed.threadgate#listRule', list: LIST_URI },
    ]);
    expect(draft.postgateEmbeddingRules).toEqual([
      { $type: 'app.bsky.feed.postgate#disableRule' },
    ]);

    const nobody = composerStateToDraft(
      state({
        posts: [post({ text: 'x' })],
        gates: { custom: true, reply: [], quotes: true },
      }),
      { texts: [] },
    );
    expect(nobody.threadgateAllow).toEqual([]);
    expect(nobody.postgateEmbeddingRules).toEqual([]);

    // Anyone may reply and quote, chosen for this post over the defaults.
    const everyone = composerStateToDraft(
      state({
        posts: [post({ text: 'x' })],
        gates: { custom: true, reply: null, quotes: true },
      }),
      { texts: [] },
    );
    expect(everyone).not.toHaveProperty('threadgateAllow');
    expect(everyone.postgateEmbeddingRules).toEqual([]);

    const defaults = composerStateToDraft(
      state({
        posts: [post({ text: 'x' })],
        gates: { custom: false, reply: [], quotes: false },
      }),
      { texts: [] },
    );
    expect(defaults).not.toHaveProperty('threadgateAllow');

    const reply = composerStateToDraft(
      state({
        posts: [post({ text: 'x' })],
        reply: { uri: POST_URI, cid: 'c', root: { uri: POST_URI, cid: 'c' } },
        gates: { custom: true, reply: [], quotes: false },
      }),
      { texts: [] },
    );
    expect(reply).not.toHaveProperty('threadgateAllow');
    expect(reply).not.toHaveProperty('postgateEmbeddingRules');
  });

  it('refuses a post longer than a draft can hold, saying which', () => {
    const long = 'a'.repeat(1001);
    const error = (() => {
      try {
        composerStateToDraft(
          state({ posts: [post({ text: 'ok' }), post({ text: long })] }),
          { texts: [{ text: 'ok' }, { text: long }] },
        );
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(error).toMatchObject({ code: 'DRAFT_TOO_LONG', postIndex: 1 });
    expect(() =>
      composerStateToDraft(
        state({ posts: [post({ text: 'a'.repeat(1000) })] }),
        { texts: [{ text: 'a'.repeat(1000) }] },
      ),
    ).not.toThrow();
  });
});

describe('draftToComposerState', () => {
  it('reads what Virga wrote back into the same state', () => {
    const facets = [
      {
        index: { byteStart: 0, byteEnd: 4 },
        features: [
          {
            $type: 'app.bsky.richtext.facet#link',
            uri: 'https://moth.example',
          },
        ],
      },
    ];
    const s = state({
      posts: [
        post({
          text: 'moth night',
          images: [{ id: 'i1', localRef: 'virga-media:1', alt: 'a moth' }],
          record: { kind: 'list', uri: LIST_URI, cid: 'cidl' },
        }),
        post({
          text: 'two',
          video: {
            localRef: 'virga-media:v',
            alt: 'flying',
            mime: 'video/mp4',
            size: 9,
            status: 'idle',
          },
        }),
      ],
      reply: {
        uri: POST_URI,
        cid: 'cidq',
        root: { uri: ROOT_URI, cid: 'cidr' },
      },
      tags: ['moths'],
      labels: ['graphic-media'],
      langs: ['de'],
    });
    const draft = composerStateToDraft(s, {
      texts: [
        { text: 'moth night', facets },
        { text: 'two', facets: [] },
      ],
    });
    const back = draftToComposerState(
      { id: '3d1', draft, createdAt: 'x', updatedAt: 'y' },
      { asDid: ALICE, defaults: { langs: ['en'] } },
    );

    expect(back.posts.map((p) => p.text)).toEqual([
      '[moth](https://moth.example) night',
      'two',
    ]);
    expect(back.posts[0].images[0]).toMatchObject({
      localRef: 'virga-media:1',
      alt: 'a moth',
    });
    expect(back.posts[0].record).toEqual({
      kind: 'list',
      uri: LIST_URI,
      cid: 'cidl',
    });
    expect(back.posts[1].video).toMatchObject({
      localRef: 'virga-media:v',
      alt: 'flying',
      status: 'idle',
    });
    expect(back.reply).toEqual({
      uri: POST_URI,
      cid: 'cidq',
      root: { uri: ROOT_URI, cid: 'cidr' },
    });
    expect(back).toMatchObject({
      tags: ['moths'],
      labels: ['graphic-media'],
      langs: ['de'],
      asDid: ALICE,
      gates: { custom: false, reply: null, quotes: true },
      source: { kind: 'draft', id: '3d1', ownerDid: ALICE },
      schedule: null,
    });
  });

  it('reads back reply and quote settings chosen for the post', () => {
    const gates = {
      custom: true,
      reply: [{ type: 'mention' }, { type: 'list', list: LIST_URI }],
      quotes: false,
    };
    const draft = composerStateToDraft(
      state({ posts: [post({ text: 'x' })], gates }),
      { texts: [{ text: 'x' }] },
    );
    expect(
      draftToComposerState({ id: 'g', draft }, { asDid: ALICE }).gates,
    ).toEqual(gates);
  });

  it('reads back "anyone can reply and quote" as a choice, not as the defaults', () => {
    for (const gates of [
      { custom: true, reply: null, quotes: true },
      { custom: true, reply: [], quotes: true },
      { custom: true, reply: null, quotes: false },
    ]) {
      const draft = composerStateToDraft(
        state({ posts: [post({ text: 'x' })], gates }),
        { texts: [{ text: 'x' }] },
      );
      expect(
        draftToComposerState({ id: 'g', draft }, { asDid: ALICE }).gates,
      ).toEqual(gates);
    }
  });

  it('reads a draft from Bluesky’s app, which writes only the lexicon’s fields', () => {
    const view = {
      id: '3bsky',
      draft: {
        deviceName: 'iPhone',
        posts: [
          {
            text: 'see this',
            embedImages: [
              { localRef: { path: 'file:///photo.jpg' }, alt: 'photo' },
            ],
            embedExternals: [{ uri: 'https://example.com/a' }],
            embedRecords: [{ record: { uri: POST_URI, cid: 'cidq' } }],
          },
        ],
      },
    };
    const back = draftToComposerState(view, {
      asDid: ALICE,
      defaults: { langs: ['en'], gates: { reply: [], quotes: true } },
    });
    expect(back.posts[0]).toMatchObject({
      text: 'see this',
      record: { kind: 'post', uri: POST_URI, cid: 'cidq' },
      card: {
        url: 'https://example.com/a',
        title: '',
        description: '',
        thumb: null,
      },
    });
    expect(back.posts[0].images).toEqual([
      expect.objectContaining({ localRef: 'file:///photo.jpg', alt: 'photo' }),
    ]);
    expect(back.langs).toEqual(['en']);
    // No settings in the draft: the account's defaults, not chosen for this post.
    expect(back.gates).toEqual({ custom: false, reply: [], quotes: true });
  });

  it('reads a draft from Anisota, whose media are uploaded blobs', () => {
    const view = {
      id: '3anisota',
      draft: {
        posts: [
          {
            text: 'blobbed',
            tags: ['anisota', 'moths'],
            embed: {
              $type: 'app.bsky.embed.images',
              images: [
                {
                  image: BLOB,
                  alt: 'night',
                  aspectRatio: { width: 2, height: 1 },
                },
              ],
            },
          },
        ],
      },
    };
    const back = draftToComposerState(view, { asDid: ALICE });
    expect(back.posts[0].images[0]).toMatchObject({
      blob: BLOB,
      blobDid: ALICE,
      alt: 'night',
      aspectRatio: { width: 2, height: 1 },
      mime: 'image/jpeg',
      previewUrl:
        'https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:alice/bafkreiimage@jpeg',
    });
    expect(back.tags).toEqual(['anisota', 'moths']);
  });

  it('starts from the defaults for an empty or broken draft', () => {
    const back = draftToComposerState(
      { id: 'x' },
      { asDid: ALICE, defaults: { langs: ['en'] } },
    );
    expect(back.posts).toHaveLength(1);
    expect(back.posts[0].text).toBe('');
    expect(back.source).toEqual({ kind: 'draft', id: 'x', ownerDid: ALICE });
  });
});

describe('the drafts service', () => {
  it('always asks Bluesky’s AppView', async () => {
    const { agent, calls } = fakeAgent();
    await listDrafts(agent);
    expect(calls.proxies).toEqual([['bsky_appview', 'did:web:api.bsky.app']]);
  });

  it('pages, and lists every draft once', async () => {
    const { agent, draft } = fakeAgent({ pageSize: 2 });
    const media = memoryMedia();
    for (const text of ['a', 'b', 'c', 'd', 'e']) {
      await createDraft(agent, state({ posts: [post({ text })] }), {
        ...quietly,
        media,
        texts: [{ text, facets: [] }],
      });
    }
    const first = await listDrafts(agent, { limit: 2 });
    expect(first.drafts).toHaveLength(2);
    expect(first.cursor).toBe('2');
    const all = await listAllDrafts(agent);
    expect(all.map((d) => d.draft.posts[0].text)).toEqual([
      'e',
      'd',
      'c',
      'b',
      'a',
    ]);
    expect(all.complete).toBe(true);
    expect(draft.getDrafts.mock.calls.at(-1)[0]).toMatchObject({
      limit: 100,
      cursor: '4',
    });
  });

  it('stops paging on a cursor handed back twice', async () => {
    const agent = {
      did: ALICE,
      app: {
        bsky: {
          draft: {
            getDrafts: vi.fn(async () => ({
              data: {
                drafts: [{ id: 'x', draft: { posts: [] } }],
                cursor: 'same',
              },
            })),
          },
        },
      },
    };
    const all = await listAllDrafts(agent);
    expect(all).toHaveLength(1);
    expect(all.complete).toBe(false);
    expect(agent.app.bsky.draft.getDrafts).toHaveBeenCalledTimes(2);
  });

  it('saves a new draft with its files kept here, and says so', async () => {
    const { agent, stash } = fakeAgent();
    const media = memoryMedia();
    const target = new EventTarget();
    const heard = vi.fn();
    onPostingEvent(POSTING_EVENTS.drafts, heard, { target });
    const file = { name: 'a.jpg', type: 'image/jpeg', size: 10 };
    const out = await createDraft(
      agent,
      state({
        posts: [post({ text: 'pic', images: [{ id: 'i', file, alt: 'a' }] })],
      }),
      {
        media,
        target,
        deviceId: DEVICE,
        texts: [{ text: 'pic', facets: [] }],
      },
    );
    expect(out.id).toBe('3draft1');
    const ref = out.state.posts[0].images[0].localRef;
    expect(media.rows.get(ref).file).toBe(file);
    expect(
      stash.get('3draft1').draft.posts[0].embedImages[0].localRef.path,
    ).toBe(ref);
    expect(stash.get('3draft1').draft.deviceId).toBe(DEVICE);
    expect(out.state.source).toEqual({
      kind: 'draft',
      id: '3draft1',
      ownerDid: ALICE,
    });
    expect(heard).toHaveBeenCalledWith({
      did: ALICE,
      id: '3draft1',
      action: 'created',
    });
  });

  it('resolves the texts itself when not given them', async () => {
    const { agent, stash } = fakeAgent();
    await createDraft(
      agent,
      state({ posts: [post({ text: '  [label](https://example.com)  ' })] }),
      { ...quietly, media: memoryMedia() },
    );
    const [p] = stash.get('3draft1').draft.posts;
    expect(p.text).toBe('label');
    expect(p.facets[0].features[0]).toMatchObject({
      uri: 'https://example.com',
    });
  });

  it('turns Bluesky’s limit on drafts into a sentence', async () => {
    const limit = Object.assign(new Error('DraftLimitReached'), {
      error: 'DraftLimitReached',
      status: 400,
    });
    const { agent } = fakeAgent({ failCreate: limit });
    const error = await createDraft(
      agent,
      state({ posts: [post({ text: 'x' })] }),
      { ...quietly, media: memoryMedia(), texts: [{ text: 'x' }] },
    ).catch((e) => e);
    expect(error).toMatchObject({
      code: 'DRAFT_LIMIT',
      message: DRAFT_LIMIT_MESSAGE,
      cause: limit,
    });
    expect(isDraftLimitError({ message: 'Error: DraftLimitReached' })).toBe(
      true,
    );
    expect(isDraftLimitError(new Error('offline'))).toBe(false);
  });

  it('updates a draft in place, and forgets media it no longer names', async () => {
    const { agent, stash } = fakeAgent();
    const media = memoryMedia();
    const made = await createDraft(
      agent,
      state({
        posts: [
          post({
            text: 'v1',
            images: [
              { id: 'i', file: { name: 'a', type: 'image/png', size: 1 } },
            ],
          }),
        ],
      }),
      {
        ...quietly,
        media,
        texts: [{ text: 'v1' }],
      },
    );
    const oldRef = made.state.posts[0].images[0].localRef;
    const edited = {
      ...made.state,
      posts: [{ ...made.state.posts[0], text: 'v2', images: [] }],
    };
    const out = await updateDraft(agent, made.id, edited, {
      ...quietly,
      media,
      texts: [{ text: 'v2' }],
    });
    expect(out).toMatchObject({ id: made.id, recreated: false });
    expect(stash.get(made.id).draft.posts[0].text).toBe('v2');
    expect(media.rows.has(oldRef)).toBe(false);
  });

  it('saves as a new draft when the old one is gone, rather than losing the edit', async () => {
    const { agent, stash, draft } = fakeAgent();
    const out = await updateDraft(
      agent,
      '3gone',
      state({ posts: [post({ text: 'kept' })] }),
      { ...quietly, media: memoryMedia(), texts: [{ text: 'kept' }] },
    );
    expect(out.recreated).toBe(true);
    expect(draft.updateDraft).not.toHaveBeenCalled();
    expect(stash.get(out.id).draft.posts[0].text).toBe('kept');
    expect(out.state.source.id).toBe(out.id);
  });

  it('sends the update anyway when the list can’t be read', async () => {
    const { agent, draft } = fakeAgent({ failGet: true });
    const out = await updateDraft(
      agent,
      '3d',
      state({ posts: [post({ text: 'x' })] }),
      { ...quietly, media: memoryMedia(), texts: [{ text: 'x' }] },
    );
    expect(out.recreated).toBe(false);
    expect(draft.updateDraft).toHaveBeenCalledTimes(1);
  });

  it('deletes a draft and its files; one already gone counts as deleted', async () => {
    const { agent, stash, draft } = fakeAgent();
    const media = memoryMedia();
    const made = await createDraft(
      agent,
      state({
        posts: [
          post({
            text: 'x',
            images: [
              { id: 'i', file: { name: 'a', type: 'image/png', size: 1 } },
            ],
          }),
        ],
      }),
      {
        ...quietly,
        media,
        texts: [{ text: 'x' }],
      },
    );
    const refs = draftLocalRefs(stash.get(made.id));
    await deleteDraft(agent, made.id, { localRefs: refs, media, target: null });
    expect(stash.has(made.id)).toBe(false);
    expect(media.rows.size).toBe(0);

    draft.deleteDraft.mockRejectedValueOnce(
      Object.assign(new Error('Draft not found'), { status: 404 }),
    );
    await expect(
      deleteDraft(agent, '3gone', { media, target: null }),
    ).resolves.toBeUndefined();
    draft.deleteDraft.mockRejectedValueOnce(new Error('502'));
    await expect(
      deleteDraft(agent, '3x', { media, target: null }),
    ).rejects.toThrow('502');
  });

  it('finds the files of the draft it deletes, and keeps those another draft still names', async () => {
    const { agent, stash } = fakeAgent();
    const media = memoryMedia();
    const file = { name: 'a', type: 'image/png', size: 1 };
    const first = await createDraft(
      agent,
      state({ posts: [post({ text: 'x', images: [{ id: 'i', file }] })] }),
      { ...quietly, media, texts: [{ text: 'x' }] },
    );
    // Saved again as a second draft: both name the one file.
    const second = await createDraft(agent, first.state, {
      ...quietly,
      media,
      texts: [{ text: 'x' }],
    });
    const [ref] = draftLocalRefs(stash.get(first.id));
    expect(draftLocalRefs(stash.get(second.id))).toEqual([ref]);

    await deleteDraft(agent, first.id, { media, target: null });
    expect(media.rows.has(ref)).toBe(true);
    await deleteDraft(agent, second.id, { media, target: null });
    expect(media.rows.has(ref)).toBe(false);
  });

  it('forgets the files it kept for a save that failed', async () => {
    const offline = new Error('offline');
    const { agent } = fakeAgent({ failCreate: offline });
    const media = memoryMedia();
    const file = { name: 'a', type: 'image/png', size: 1 };
    await expect(
      createDraft(
        agent,
        state({ posts: [post({ text: 'x', images: [{ id: 'i', file }] })] }),
        { ...quietly, media, texts: [{ text: 'x' }] },
      ),
    ).rejects.toBe(offline);
    expect(media.rows.size).toBe(0);

    const ok = fakeAgent();
    const made = await createDraft(
      ok.agent,
      state({ posts: [post({ text: 'x', images: [{ id: 'i', file }] })] }),
      { ...quietly, media, texts: [{ text: 'x' }] },
    );
    const kept = made.state.posts[0].images[0].localRef;
    ok.draft.updateDraft.mockRejectedValueOnce(offline);
    const more = {
      ...made.state,
      posts: [
        {
          ...made.state.posts[0],
          images: [
            ...made.state.posts[0].images,
            { id: 'j', file: { name: 'b', type: 'image/png', size: 2 } },
          ],
        },
      ],
    };
    await expect(
      updateDraft(ok.agent, made.id, more, {
        ...quietly,
        media,
        texts: [{ text: 'x' }],
      }),
    ).rejects.toBe(offline);
    expect([...media.rows.keys()]).toEqual([kept]);
  });

  it('says so when a draft that is gone can’t be saved again, rather than sending an update nobody keeps', async () => {
    const limit = Object.assign(new Error('DraftLimitReached'), {
      error: 'DraftLimitReached',
    });
    const { agent, draft } = fakeAgent({ failCreate: limit });
    const error = await updateDraft(
      agent,
      '3gone',
      state({ posts: [post({ text: 'x' })] }),
      { ...quietly, media: memoryMedia(), texts: [{ text: 'x' }] },
    ).catch((e) => e);
    expect(error).toMatchObject({ code: 'DRAFT_LIMIT' });
    expect(draft.updateDraft).not.toHaveBeenCalled();
  });

  it('opens a draft with the files this browser kept, and names the rest', async () => {
    const { agent, stash } = fakeAgent();
    const media = memoryMedia();
    const file = { name: 'a.jpg', type: 'image/jpeg', size: 10 };
    const made = await createDraft(
      agent,
      state({ posts: [post({ text: 'x', images: [{ id: 'i', file }] })] }),
      { ...quietly, media, texts: [{ text: 'x' }] },
    );
    const view = stash.get(made.id);
    const here = await openDraft(view, {
      asDid: ALICE,
      media,
      makePreviewUrl: () => 'blob:p',
    });
    expect(here.missing).toEqual([]);
    expect(here.state.posts[0].images[0]).toMatchObject({
      file,
      previewUrl: 'blob:p',
    });

    const elsewhere = await openDraft(view, {
      asDid: ALICE,
      media: memoryMedia(),
      makePreviewUrl: null,
    });
    expect(elsewhere.missing).toHaveLength(1);
  });
});

describe('summarizeDraft', () => {
  it('says what a row needs without opening the draft', () => {
    const view = {
      id: '3d',
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-02T00:00:00.000Z',
      draft: {
        deviceId: 'another-device',
        deviceName: 'Virga',
        langs: ['en'],
        posts: [
          {
            text: 'first',
            tags: ['t'],
            reply: {
              root: { uri: ROOT_URI, cid: 'r' },
              parent: { uri: POST_URI, cid: 'p' },
            },
            embedImages: [
              { localRef: { path: 'virga-media:1' } },
              { localRef: { path: 'virga-media:2' } },
            ],
            embedRecords: [{ record: { uri: POST_URI, cid: 'p' } }],
          },
          { text: 'second' },
        ],
      },
    };
    expect(summarizeDraft(view, { deviceId: DEVICE })).toMatchObject({
      id: '3d',
      text: 'first',
      posts: 2,
      isThread: true,
      isReply: true,
      tags: ['t'],
      images: 2,
      video: false,
      link: null,
      record: { kind: 'post', uri: POST_URI },
      updatedAt: '2026-11-02T00:00:00.000Z',
      savedHere: false,
      mediaElsewhere: true,
    });
    expect(
      summarizeDraft(
        { ...view, draft: { ...view.draft, deviceId: DEVICE } },
        { deviceId: DEVICE },
      ).mediaElsewhere,
    ).toBe(false);
  });
});

describe('postingDeviceId', () => {
  it('is made once per browser and kept', () => {
    const data = new Map();
    const store = {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => data.set(k, v),
    };
    const id = postingDeviceId(store);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(data.get('virga:posting-device')).toBe(id);
    expect(postingDeviceId(store)).toBe(id);
    expect(postingDeviceId(null)).toBeNull();
  });
});

describe('a draft’s link card', () => {
  const CARD = {
    url: 'https://example.com/a',
    title: 'Ex',
    description: 'D',
    thumb: 'https://cardyb.bsky.app/v1/image?url=x',
  };

  it('keeps an image that isn’t uploaded yet, and reads it back', () => {
    const s = state({ posts: [post({ text: 'see', card: CARD })] });
    const draft = composerStateToDraft(s, { texts: [{ text: 'see' }], deviceId: DEVICE });
    // Not in the embed: an app that publishes the embed as it stands
    // mustn't carry an address out in a record.
    expect(draft.posts[0].embed.external).not.toHaveProperty('thumb');
    const back = draftToComposerState({ id: '3d', draft }, { asDid: ALICE });
    expect(back.posts[0].card).toEqual(CARD);
  });

  it('keeps only https images, and says when the writer edited the card', () => {
    const s = state({
      posts: [post({ text: 'see', card: { ...CARD, thumb: 'blob:https://virga/1', edited: true } })],
    });
    const draft = composerStateToDraft(s, { texts: [{ text: 'see' }], deviceId: DEVICE });
    const back = draftToComposerState({ id: '3d', draft }, { asDid: ALICE });
    expect(back.posts[0].card).toMatchObject({ thumb: null, edited: true });
  });

  it('is read again when opened from a draft that kept only its address', async () => {
    const fetchCard = vi.fn(async (url) => ({
      url,
      title: 'Fetched',
      description: 'From the card service',
      thumb: 'https://cardyb.bsky.app/v1/image?url=y',
    }));
    const view = {
      id: '3app',
      draft: {
        posts: [
          {
            text: 'from the app',
            embedExternals: [{ $type: 'app.bsky.draft.defs#draftEmbedExternal', uri: CARD.url }],
          },
        ],
      },
    };
    const { state: opened } = await openDraft(view, { asDid: ALICE, media: memoryMedia(), fetchCard });
    expect(fetchCard).toHaveBeenCalledWith(CARD.url, expect.any(Object));
    expect(opened.posts[0].card).toEqual({
      url: CARD.url,
      title: 'Fetched',
      description: 'From the card service',
      thumb: 'https://cardyb.bsky.app/v1/image?url=y',
    });
  });

  it('fills in a missing image without touching what the writer wrote', async () => {
    const fetchCard = vi.fn(async (url) => ({ url, title: 'Theirs', description: 'Theirs', thumb: 'https://img.example/t.jpg' }));
    const s = state({ posts: [post({ text: 'x', card: { ...CARD, thumb: null } })] });
    const draft = composerStateToDraft(s, { texts: [{ text: 'x' }], deviceId: DEVICE });
    const { state: opened } = await openDraft({ id: '3d', draft }, { asDid: ALICE, media: memoryMedia(), fetchCard });
    expect(opened.posts[0].card).toMatchObject({ title: 'Ex', description: 'D', thumb: 'https://img.example/t.jpg' });
  });

  it('leaves a whole card, an edited one and an unreachable service alone', async () => {
    const fetchCard = vi.fn(async () => null);
    const whole = state({ posts: [post({ text: 'x', card: CARD })] });
    const edited = state({ posts: [post({ text: 'x', card: { ...CARD, title: '', thumb: null, edited: true } })] });
    const lacking = state({ posts: [post({ text: 'x', card: { ...CARD, thumb: null } })] });
    for (const s of [whole, edited]) {
      const draft = composerStateToDraft(s, { texts: [{ text: 'x' }], deviceId: DEVICE });
      await openDraft({ id: '3d', draft }, { asDid: ALICE, media: memoryMedia(), fetchCard });
    }
    expect(fetchCard).not.toHaveBeenCalled();
    const draft = composerStateToDraft(lacking, { texts: [{ text: 'x' }], deviceId: DEVICE });
    const { state: opened } = await openDraft({ id: '3d', draft }, { asDid: ALICE, media: memoryMedia(), fetchCard });
    expect(fetchCard).toHaveBeenCalledTimes(1);
    expect(opened.posts[0].card).toMatchObject({ title: 'Ex', thumb: null });
  });
});

describe('pruneOrphanedDraftMedia', () => {
  const NOW = Date.UTC(2026, 10, 20);
  const OLD = NOW - 3 * 24 * 60 * 60 * 1000;
  const entry = (ref, savedAt = OLD) => ({ ref, file: { name: ref, type: 'image/jpeg', size: 1 }, savedAt });
  const withImage = (path) => ({
    posts: [{ text: 'x', embedImages: [{ image: {}, localRef: { path }, alt: '' }] }],
  });
  const memoryStore = (entries = {}) => {
    const rows = new Map(Object.entries(entries));
    return { getItem: (k) => (rows.has(k) ? rows.get(k) : null) };
  };

  it('forgets files no draft, stored post or open post names, and keeps new ones', async () => {
    const { agent, stash } = fakeAgent({ pageSize: 1 });
    stash.set('d1', { id: 'd1', draft: withImage('virga-media:kept'), createdAt: 'a', updatedAt: '2' });
    stash.set('d2', { id: 'd2', draft: withImage('virga-media:kept2'), createdAt: 'a', updatedAt: '1' });
    const media = memoryMedia();
    await media.put([
      entry('virga-media:kept'),
      entry('virga-media:kept2'),
      entry('virga-media:posted-elsewhere'),
      entry('virga-media:autosaved'),
      entry('virga-media:in-memory'),
      entry('virga-media:just-saved', NOW - 60_000),
    ]);
    const store = memoryStore({
      [autosaveKey(ALICE)]: JSON.stringify({
        version: 1,
        state: { posts: [{ images: [{ localRef: 'virga-media:autosaved' }] }] },
      }),
    });
    saveSessionDraft(ALICE, state({ posts: [post({ text: 'x', images: [{ id: 'i', localRef: 'virga-media:in-memory' }] })] }));
    try {
      const dropped = await pruneOrphanedDraftMedia(agent, ALICE, { media, store, now: NOW });
      expect(dropped).toEqual(['virga-media:posted-elsewhere']);
      expect((await media.refs()).sort()).toEqual([
        'virga-media:autosaved',
        'virga-media:in-memory',
        'virga-media:just-saved',
        'virga-media:kept',
        'virga-media:kept2',
      ]);
    } finally {
      clearSessionDraft(ALICE);
    }
  });

  it('does nothing when the list couldn’t be read to the end', async () => {
    const media = memoryMedia();
    await media.put([entry('virga-media:a')]);
    const { agent: failing } = fakeAgent({ failGet: true });
    await expect(pruneOrphanedDraftMedia(failing, ALICE, { media, now: NOW })).rejects.toThrow('offline');
    const endless = {
      did: ALICE,
      withProxy: () => endless,
      app: { bsky: { draft: { getDrafts: vi.fn(async ({ cursor } = {}) => ({ data: { drafts: [{ id: `d${cursor || 0}`, draft: { posts: [] } }], cursor: String(Number(cursor || 0) + 1) } })) } } },
    };
    expect(await pruneOrphanedDraftMedia(endless, ALICE, { media, now: NOW, store: memoryStore() })).toEqual([]);
    expect(await media.refs()).toEqual(['virga-media:a']);
  });
});
