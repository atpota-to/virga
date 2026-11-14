// publishScheduledPost through a real @atproto/api Agent whose session answers
// locally: what reaches the PDS, at which keys, with which timestamps, and
// how a missing or rotated session is handled.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TID } from '@atproto/common-web';
import { createFakeSupabase } from '../test/fakeSupabase.js';
import {
  setSupabaseClientForTests,
  resetSupabaseClientForTests,
} from '../supabase.js';
import {
  DID,
  CIDS,
  PNG_BASE64,
  fakePds,
  invalidTokenResponse,
} from './testing/fixtures.js';

const oauth = vi.hoisted(() => ({ restoreSession: vi.fn() }));
vi.mock('../oauth/client.js', () => ({ getOAuthClient: () => oauth }));

const safeFetch = vi.hoisted(() => ({ safeFetchBuffer: vi.fn() }));
vi.mock('../net/safeFetch.js', async (importOriginal) => ({
  ...(await importOriginal()),
  safeFetchBuffer: safeFetch.safeFetchBuffer,
}));

const { publishScheduledPost, classifyFailure, storeMedia, MEDIA_BUCKET } =
  await import('./scheduledPosts.js');
const { deps: replyDeps } = await import('./replyTarget.js');
const realReplyDeps = { ...replyDeps };

const SCHEDULED_FOR = '2026-11-06T17:00:00.000Z';
// As assignRkeys mints them: from the scheduled time, one microsecond apart.
const RKEYS = [0, 1, 2].map((i) =>
  TID.fromTime(Date.parse(SCHEDULED_FOR) * 1000 + i, 7).toString(),
);

const row = (texts, extra = {}) => ({
  id: '00000000-0000-4000-8000-000000000001',
  user_did: DID,
  target: 'bluesky',
  scheduled_for: SCHEDULED_FOR,
  progress: [],
  payload: {
    posts: texts.map((text) => ({ record: { text } })),
    gates: {},
    rkeys: RKEYS.slice(0, texts.length),
  },
  ...extra,
});

let pds;
let supabase;
beforeEach(() => {
  pds = fakePds();
  oauth.restoreSession.mockReset();
  oauth.restoreSession.mockResolvedValue(pds.session);
  safeFetch.safeFetchBuffer.mockReset();
  supabase = createFakeSupabase();
  setSupabaseClientForTests(supabase);
});
afterEach(() => {
  resetSupabaseClientForTests();
  Object.assign(replyDeps, realReplyDeps);
  vi.restoreAllMocks();
});

describe('publishScheduledPost createdAt', () => {
  it('gives each post in a thread its own createdAt, one millisecond apart', async () => {
    await publishScheduledPost(row(['first', 'second', 'third']));
    const stamps = pds.posts().map((w) => w.record.createdAt);
    expect(stamps).toEqual([
      '2026-11-06T17:00:00.000Z',
      '2026-11-06T17:00:00.001Z',
      '2026-11-06T17:00:00.002Z',
    ]);
  });

  it('keeps the root at exactly the scheduled time, and its threadgate with it', async () => {
    await publishScheduledPost(
      row(['first', 'second'], {
        payload: {
          ...row(['first', 'second']).payload,
          gates: { threadgate: [] },
        },
      }),
    );
    const gate = pds.writes.find(
      (w) => w.collection === 'app.bsky.feed.threadgate',
    );
    expect(pds.posts()[0].record.createdAt).toBe(SCHEDULED_FOR);
    expect(gate.record.createdAt).toBe(SCHEDULED_FOR);
  });

  it('leaves a single post at exactly the scheduled time', async () => {
    await publishScheduledPost(row(['alone']));
    expect(pds.posts().map((w) => w.record.createdAt)).toEqual([SCHEDULED_FOR]);
  });

  it('threads each reply to the root and to the post before it', async () => {
    await publishScheduledPost(row(['first', 'second', 'third']));
    const [root, second, third] = pds.posts();
    const rootRef = {
      uri: `at://${DID}/app.bsky.feed.post/${root.rkey}`,
      cid: CIDS[0],
    };
    const secondRef = {
      uri: `at://${DID}/app.bsky.feed.post/${second.rkey}`,
      cid: CIDS[1],
    };
    expect(root.record.reply).toBeUndefined();
    expect(second.record.reply).toEqual({ root: rootRef, parent: rootRef });
    expect(third.record.reply).toEqual({ root: rootRef, parent: secondRef });
  });

  it('resumes a partly written thread, stamping the tail by index', async () => {
    const rootRef = {
      uri: `at://${DID}/app.bsky.feed.post/${RKEYS[0]}`,
      cid: CIDS[2],
    };
    const seen = [];
    const result = await publishScheduledPost(
      row(['first', 'second', 'third'], { progress: [rootRef] }),
      {
        onProgress: (p) => seen.push(p.length),
      },
    );
    expect(pds.posts().map((w) => [w.rkey, w.record.createdAt])).toEqual([
      [RKEYS[1], '2026-11-06T17:00:00.001Z'],
      [RKEYS[2], '2026-11-06T17:00:00.002Z'],
    ]);
    expect(pds.posts()[0].record.reply).toEqual({
      root: rootRef,
      parent: rootRef,
    });
    expect(seen).toEqual([2, 3]);
    expect(result).toEqual(rootRef);
  });
});

describe('publishScheduledPost writes', () => {
  it('writes with putRecord at the reserved key and answers the root', async () => {
    const ref = await publishScheduledPost(row(['hello']));
    expect(pds.writes[0]).toMatchObject({
      nsid: 'com.atproto.repo.putRecord',
      repo: DID,
      collection: 'app.bsky.feed.post',
      rkey: RKEYS[0],
    });
    expect(ref).toEqual({
      uri: `at://${DID}/app.bsky.feed.post/${RKEYS[0]}`,
      cid: CIDS[0],
    });
    expect(oauth.restoreSession).toHaveBeenCalledWith(DID, undefined);
  });

  it('copies facets, langs, labels and tags, and drops empty ones', async () => {
    const facets = [
      {
        index: { byteStart: 0, byteEnd: 1 },
        features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'm' }],
      },
    ];
    const labels = {
      $type: 'com.atproto.label.defs#selfLabels',
      values: [{ val: 'nudity' }],
    };
    const r = row(['x']);
    r.payload.posts[0].record = {
      text: 'm',
      facets,
      langs: ['en'],
      labels,
      tags: ['moths'],
    };
    await publishScheduledPost(r);
    expect(pds.posts()[0].record).toEqual({
      $type: 'app.bsky.feed.post',
      text: 'm',
      createdAt: SCHEDULED_FOR,
      facets,
      langs: ['en'],
      labels,
      tags: ['moths'],
    });
    const bare = row(['y']);
    bare.payload.posts[0].record = {
      text: 'y',
      facets: [],
      langs: [],
      tags: [],
    };
    pds = fakePds();
    oauth.restoreSession.mockResolvedValue(pds.session);
    await publishScheduledPost(bare);
    expect(Object.keys(pds.posts()[0].record).sort()).toEqual([
      '$type',
      'createdAt',
      'text',
    ]);
  });

  it('writes the threadgate and postgate at the root key', async () => {
    const threadgate = [{ $type: 'app.bsky.feed.threadgate#mentionRule' }];
    const postgate = [{ $type: 'app.bsky.feed.postgate#disableRule' }];
    const r = row(['root', 'reply']);
    r.payload.gates = { threadgate, postgate };
    await publishScheduledPost(r);
    const rootUri = `at://${DID}/app.bsky.feed.post/${RKEYS[0]}`;
    expect(
      pds.writes.find((w) => w.collection === 'app.bsky.feed.threadgate'),
    ).toMatchObject({
      rkey: RKEYS[0],
      record: {
        $type: 'app.bsky.feed.threadgate',
        post: rootUri,
        allow: threadgate,
        hiddenReplies: [],
      },
    });
    expect(
      pds.writes.find((w) => w.collection === 'app.bsky.feed.postgate'),
    ).toMatchObject({
      rkey: RKEYS[0],
      record: {
        $type: 'app.bsky.feed.postgate',
        post: rootUri,
        detachedEmbeddingUris: [],
        embeddingRules: postgate,
      },
    });
  });

  it('writes no gate records for null gates or an empty postgate', async () => {
    const r = row(['root']);
    r.payload.gates = { threadgate: null, postgate: [] };
    await publishScheduledPost(r);
    expect(pds.writes.map((w) => w.collection)).toEqual(['app.bsky.feed.post']);
  });

  it('falls back to keys derived from the time for a row without stored ones', async () => {
    const r = row(['a', 'b']);
    delete r.payload.rkeys;
    await publishScheduledPost(r);
    const base = Date.parse(SCHEDULED_FOR) * 1000;
    expect(pds.posts().map((w) => w.rkey)).toEqual(
      [0, 1].map((i) => TID.fromTime(base + i, 0).toString()),
    );
  });
});

describe('publishScheduledPost media', () => {
  async function stash(rowId, ids) {
    const media = {};
    for (const id of ids) {
      media[id] = {
        storagePath: await storeMedia(rowId, id, PNG_BASE64, 'image/png'),
        encoding: 'image/png',
      };
    }
    return media;
  }

  it('uploads stashed images as blobs and embeds them', async () => {
    const r = row(['pictures']);
    r.payload.media = await stash(r.id, ['p0-img0', 'p0-img1']);
    r.payload.posts[0].embed = {
      type: 'images',
      images: [
        {
          mediaId: 'p0-img0',
          alt: 'one',
          aspectRatio: { width: 1, height: 1 },
        },
        { mediaId: 'p0-img1' },
      ],
    };
    await publishScheduledPost(r);
    expect(pds.blobs).toHaveLength(2);
    expect(pds.blobs[0]).toMatchObject({
      mimeType: 'image/png',
      size: Buffer.from(PNG_BASE64, 'base64').length,
    });
    const embed = pds.posts()[0].record.embed;
    expect(embed.$type).toBe('app.bsky.embed.images');
    expect(embed.images.map((i) => i.alt)).toEqual(['one', '']);
    expect(embed.images[0].aspectRatio).toEqual({ width: 1, height: 1 });
    expect(embed.images[0].image.ref.$link).toBeTruthy();
    expect(
      supabase.storage.ops.filter(
        (o) => o.verb === 'download' && o.bucket === MEDIA_BUCKET,
      ),
    ).toHaveLength(2);
  });

  it('sends five to ten images as a gallery', async () => {
    const ids = Array.from({ length: 5 }, (_, i) => `p0-img${i}`);
    const r = row(['many']);
    r.payload.media = await stash(r.id, ids);
    r.payload.posts[0].embed = {
      type: 'images',
      images: ids.map((mediaId) => ({ mediaId })),
    };
    await publishScheduledPost(r);
    const embed = pds.posts()[0].record.embed;
    expect(embed.$type).toBe('app.bsky.embed.gallery');
    expect(embed.items).toHaveLength(5);
    expect(
      embed.items.every((i) => i.$type === 'app.bsky.embed.gallery#image'),
    ).toBe(true);
  });

  it('fails terminally with MEDIA_MISSING when the payload names media never stored', async () => {
    const r = row(['pictures']);
    r.payload.posts[0].embed = {
      type: 'images',
      images: [{ mediaId: 'p0-img0' }],
    };
    const err = await publishScheduledPost(r).catch((e) => e);
    expect(err).toMatchObject({ code: 'MEDIA_MISSING', nonRetryable: true });
    expect(pds.writes).toEqual([]);
  });

  it('fails terminally with MEDIA_MISSING when a stashed object is gone, and retriably on other Storage errors', async () => {
    const r = row(['pictures']);
    r.payload.posts[0].embed = {
      type: 'images',
      images: [{ mediaId: 'p0-img0' }],
    };
    // Named in the map, but swept from Storage.
    r.payload.media = {
      'p0-img0': { storagePath: `${r.id}/p0-img0.png`, encoding: 'image/png' },
    };
    const gone = await publishScheduledPost(r).catch((e) => e);
    expect(gone).toMatchObject({ code: 'MEDIA_MISSING', nonRetryable: true });

    r.payload.media = await stash(r.id, ['p0-img0']);
    supabase.storage.failNext(MEDIA_BUCKET, 'download');
    const flaky = await publishScheduledPost(r).catch((e) => e);
    expect(flaky.nonRetryable).toBeUndefined();
    expect(flaky.message).toMatch(/media download failed/);
    expect(pds.writes).toEqual([]);
  });

  it('reads a stashed card thumbnail, or fetches a remote one safely', async () => {
    const r = row(['card']);
    r.payload.media = await stash(r.id, ['p0-thumb']);
    r.payload.posts[0].embed = {
      type: 'external',
      uri: 'https://a.example',
      title: 'A',
      thumbMediaId: 'p0-thumb',
    };
    await publishScheduledPost(r);
    expect(pds.posts()[0].record.embed.external.thumb).toBeTruthy();
    expect(safeFetch.safeFetchBuffer).not.toHaveBeenCalled();

    pds = fakePds();
    oauth.restoreSession.mockResolvedValue(pds.session);
    safeFetch.safeFetchBuffer.mockResolvedValue({
      bytes: Buffer.from(PNG_BASE64, 'base64'),
      contentType: 'image/png',
    });
    const remote = row(['card']);
    remote.payload.posts[0].embed = {
      type: 'external',
      uri: 'https://a.example',
      thumbUrl: 'https://a.example/t.png',
    };
    await publishScheduledPost(remote);
    expect(safeFetch.safeFetchBuffer).toHaveBeenCalledWith(
      'https://a.example/t.png',
      { maxBytes: 1_000_000, timeoutMs: 8000 },
    );
    expect(pds.posts()[0].record.embed.external.thumb).toBeTruthy();
  });

  it('publishes the card without a thumbnail when the fetch fails', async () => {
    safeFetch.safeFetchBuffer.mockRejectedValue(
      new Error('refused: private address'),
    );
    const r = row(['card']);
    r.payload.posts[0].embed = {
      type: 'external',
      uri: 'https://a.example',
      thumbUrl: 'https://a.example/t.png',
    };
    await publishScheduledPost(r);
    expect(pds.posts()[0].record.embed.external).not.toHaveProperty('thumb');
  });
});

describe('publishScheduledPost replies', () => {
  const PARENT = {
    uri: 'at://did:plc:ewvi7nxzyoun6zhxrhs64oiz/app.bsky.feed.post/3lwcs2m4ock2z',
    cid: CIDS[3],
  };
  const ROOT = {
    uri: 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.post/3lwcrzq3bbc2y',
    cid: CIDS[4],
  };
  const replyRow = (texts, extra = {}) => {
    const base = row(texts);
    return {
      ...base,
      payload: { ...base.payload, reply: { root: ROOT, parent: PARENT } },
      ...extra,
    };
  };
  const pdsAnswers = (response) => {
    replyDeps.resolvePdsEndpoint = vi.fn(async (did) => ({
      did,
      pdsEndpoint: 'https://their-pds.example',
    }));
    replyDeps.safeFetch = vi.fn(async () => response());
  };
  const there = () =>
    new Response(JSON.stringify({ uri: PARENT.uri, cid: PARENT.cid, value: {} }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  const xrpcError = (error, status = 400) => () =>
    new Response(JSON.stringify({ error, message: 'no' }), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  it('writes the first post as a reply to the parent, under the parent’s root', async () => {
    pdsAnswers(there);
    const ref = await publishScheduledPost(replyRow(['a reply']));
    expect(pds.posts()).toHaveLength(1);
    expect(pds.posts()[0].record.reply).toEqual({ root: ROOT, parent: PARENT });
    // What it answers is the caller's row, not the thread's root.
    expect(ref.uri).toBe(`at://${DID}/app.bsky.feed.post/${RKEYS[0]}`);
    // The parent was looked for at its own PDS, as its own DID.
    expect(replyDeps.resolvePdsEndpoint).toHaveBeenCalledWith(
      'did:plc:ewvi7nxzyoun6zhxrhs64oiz',
    );
    expect(replyDeps.safeFetch.mock.calls[0][0]).toContain(
      'https://their-pds.example/xrpc/com.atproto.repo.getRecord?',
    );
  });

  it('threads later posts to the one before, under the same root, as a live threaded reply does', async () => {
    pdsAnswers(there);
    await publishScheduledPost(replyRow(['one', 'two', 'three']));
    const [first, second, third] = pds.posts();
    const mine = (w, n) => ({
      uri: `at://${DID}/app.bsky.feed.post/${w.rkey}`,
      cid: CIDS[n],
    });
    expect(first.record.reply).toEqual({ root: ROOT, parent: PARENT });
    expect(second.record.reply).toEqual({ root: ROOT, parent: mine(first, 0) });
    expect(third.record.reply).toEqual({ root: ROOT, parent: mine(second, 1) });
  });

  it('writes no threadgate or postgate for a reply, even if the row holds some', async () => {
    pdsAnswers(there);
    const base = replyRow(['a reply']);
    await publishScheduledPost({
      ...base,
      payload: {
        ...base.payload,
        gates: {
          threadgate: [],
          postgate: [{ $type: 'app.bsky.feed.postgate#disableRule' }],
        },
      },
    });
    expect(pds.writes.map((w) => w.collection)).toEqual(['app.bsky.feed.post']);
  });

  it('does not post an orphan: a deleted parent fails the row terminally, before anything is written', async () => {
    pdsAnswers(xrpcError('RecordNotFound'));
    await expect(
      publishScheduledPost(replyRow(['a reply'])),
    ).rejects.toMatchObject({
      nonRetryable: true,
      code: 'REPLY_TARGET_GONE',
      message:
        'the post this replies to has been deleted, so the reply was not posted.',
    });
    expect(pds.writes).toEqual([]);
    expect(pds.blobs).toEqual([]);
  });

  it('says so when it is the account that is gone', async () => {
    pdsAnswers(xrpcError('RepoTakendown'));
    await expect(
      publishScheduledPost(replyRow(['a reply'])),
    ).rejects.toMatchObject({
      nonRetryable: true,
      code: 'REPLY_TARGET_GONE',
      message:
        'the account this replies to is no longer available, so the reply was not posted.',
    });
  });

  it('does not post blind: a parent it couldn’t check fails retriably, with its own code', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    pdsAnswers(xrpcError('InternalServerError', 500));
    const attempt = publishScheduledPost(replyRow(['a reply']));
    await expect(attempt).rejects.toMatchObject({
      code: 'REPLY_TARGET_UNCHECKED',
      message:
        "couldn't check that the post this replies to is still there, so the reply was held back.",
    });
    await expect(attempt).rejects.not.toHaveProperty('nonRetryable', true);
    expect(classifyFailure(await attempt.catch((e) => e))).toBe(
      'REPLY_TARGET_UNCHECKED',
    );
    expect(pds.writes).toEqual([]);
  });

  it('asks once: a thread that is resuming has already answered', async () => {
    pdsAnswers(xrpcError('RecordNotFound'));
    const first = {
      uri: `at://${DID}/app.bsky.feed.post/${RKEYS[0]}`,
      cid: CIDS[2],
    };
    await publishScheduledPost(replyRow(['one', 'two'], { progress: [first] }));
    expect(replyDeps.safeFetch).not.toHaveBeenCalled();
    expect(pds.posts()).toHaveLength(1);
    expect(pds.posts()[0].record.reply).toEqual({ root: ROOT, parent: first });
  });

  it('never looks for a parent a plain post doesn’t have', async () => {
    pdsAnswers(xrpcError('RecordNotFound'));
    await publishScheduledPost(row(['plain']));
    expect(replyDeps.resolvePdsEndpoint).not.toHaveBeenCalled();
  });
});

describe('publishScheduledPost sessions', () => {
  it('fails retriably as SESSION_UNAVAILABLE when the session can’t be restored', async () => {
    oauth.restoreSession.mockResolvedValue(null);
    const err = await publishScheduledPost(row(['x'])).catch((e) => e);
    expect(err).toMatchObject({ code: 'SESSION_UNAVAILABLE' });
    expect(err.nonRetryable).toBeFalsy();
    expect(err.message).toBe(
      "couldn't reach your account session. reconnect your account if this keeps happening.",
    );
  });

  it('fails as SESSION_UNAVAILABLE, not with the library’s words, when the client never started', async () => {
    oauth.restoreSession.mockRejectedValue(
      new Error(
        'Client authentication method "private_key_jwt" requires at least one active signing key',
      ),
    );
    const err = await publishScheduledPost(row(['x'])).catch((e) => e);
    expect(err).toMatchObject({ code: 'SESSION_UNAVAILABLE' });
    expect(err.message).not.toMatch(/private_key_jwt|signing key/);
    expect(err.nonRetryable).toBeFalsy();
    expect(pds.writes).toEqual([]);
  });

  it('restores a fresh session once on "Invalid token" and retries the write', async () => {
    const stale = fakePds({
      id: 'stale',
      behaviour: async () => invalidTokenResponse(),
    });
    const fresh = fakePds({ id: 'fresh' });
    oauth.restoreSession.mockImplementation(async (did, opts) =>
      opts?.fresh ? fresh.session : stale.session,
    );
    await publishScheduledPost(row(['x']));
    expect(oauth.restoreSession).toHaveBeenCalledWith(DID, { fresh: true });
    expect(oauth.restoreSession).toHaveBeenCalledTimes(2);
    expect(fresh.posts()).toHaveLength(1);
  });

  it('keeps the rotated-token error when the fresh restore throws', async () => {
    const stale = fakePds({
      id: 'stale',
      behaviour: async () => invalidTokenResponse(),
    });
    oauth.restoreSession.mockImplementation(async (did, opts) => {
      if (opts?.fresh) throw new Error('keyset went away');
      return stale.session;
    });
    const err = await publishScheduledPost(row(['x'])).catch((e) => e);
    expect(oauth.restoreSession).toHaveBeenCalledTimes(2);
    expect(err.message).not.toMatch(/keyset went away/);
    expect(classifyFailure(err)).toBe('SESSION_UNAVAILABLE');
  });

  it('passes a PDS refusal through for the worker to classify', async () => {
    const refusing = fakePds({
      behaviour: async () =>
        new Response(
          JSON.stringify({
            error: 'InvalidRequest',
            message: 'record too long',
          }),
          {
            status: 400,
            headers: { 'content-type': 'application/json' },
          },
        ),
    });
    oauth.restoreSession.mockResolvedValue(refusing.session);
    const err = await publishScheduledPost(row(['x'])).catch((e) => e);
    expect(classifyFailure(err)).toBe('REFUSED');
  });
});
