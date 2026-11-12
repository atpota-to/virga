import { describe, it, expect, vi } from 'vitest';
import {
  buildPostRecords,
  createDuplicateGuard,
  publish,
  publishSignature,
  PublishError,
} from './publish.js';
import {
  composerReducer,
  emptyComposerState,
  normalizeComposerState,
} from './composerModel.js';
import { computeRecordCid } from './recordCid.js';
import { isTid } from './tid.js';
import * as CID from '@atcute/cid';

const ME = 'did:plc:writer';
const OTHER = 'did:plc:other';
const NOW = new Date('2026-11-12T15:00:00.000Z');
// Real CIDs: the fake PDS hashes every record it stores.
const cidFor = (name) =>
  CID.toString(CID.createSync(0x55, new TextEncoder().encode(name)));
const blob = (name, mimeType = 'image/jpeg') => ({
  $type: 'blob',
  ref: { $link: cidFor(name) },
  mimeType,
  size: 1,
});
const imageFile = (name = 'a.jpg') =>
  new File([new Uint8Array([1, 2])], name, { type: 'image/jpeg' });

// A fake write agent: remembers every record written, answers getRecord from
// that, and can be told to fail.
function fakeTarget({ did = ME, failWrites = 0, failWith } = {}) {
  const records = new Map();
  let uploads = 0;
  let writeFailures = failWrites;
  const repo = {
    uploadBlob: vi.fn(async (bytes, { encoding }) => {
      uploads += 1;
      return { data: { blob: blob(`bafkreiup${uploads}`, encoding) } };
    }),
    createRecord: vi.fn(async ({ repo: r, collection, rkey, record }) => {
      if (writeFailures-- > 0)
        throw failWith || Object.assign(new Error('blip'), { status: 502 });
      const uri = `at://${r}/${collection}/${rkey}`;
      const cid = await computeRecordCid(record);
      records.set(uri, { uri, cid, value: record });
      return { data: { uri, cid } };
    }),
    applyWrites: vi.fn(async ({ repo: r, writes }) => {
      if (writeFailures-- > 0)
        throw failWith || Object.assign(new Error('blip'), { status: 502 });
      const results = [];
      for (const w of writes) {
        const uri = `at://${r}/${w.collection}/${w.rkey}`;
        const cid = await computeRecordCid(w.value);
        records.set(uri, { uri, cid, value: w.value });
        results.push({ uri, cid });
      }
      return { data: { results } };
    }),
    getRecord: vi.fn(async ({ repo: r, collection, rkey }) => {
      const hit = records.get(`at://${r}/${collection}/${rkey}`);
      if (!hit)
        throw Object.assign(new Error('Could not locate record'), {
          status: 400,
        });
      return { data: hit };
    }),
  };
  return {
    target: {
      did,
      pdsUrl: 'https://pds.example.com',
      agent: { com: { atproto: { repo } } },
    },
    repo,
    records,
  };
}

const state = (posts, extra = {}) =>
  normalizeComposerState({
    ...emptyComposerState({ asDid: ME }),
    posts,
    langs: ['en'],
    ...extra,
  });
const go = (s, target, options = {}) =>
  publish(s, target, {
    now: () => NOW,
    duplicateGuard: null,
    resolveMention: async () => null,
    ...options,
  });

describe('buildPostRecords', () => {
  it('stamps text, facets, embed, langs, labels and tags on every post, and createdAt a millisecond apart', () => {
    const s = state(
      [
        { text: 'one' },
        {
          text: 'two',
          images: [
            { id: 'i', alt: 'pic', aspectRatio: { width: 3, height: 2 } },
          ],
        },
      ],
      {
        tags: ['a', 'b'],
        labels: ['graphic-media'],
      },
    );
    const facets = [{ index: { byteStart: 0, byteEnd: 3 }, features: [] }];
    const records = buildPostRecords(s, {
      now: NOW,
      texts: [
        { text: 'one', facets },
        { text: 'two', facets: [] },
      ],
      blobs: [{}, { images: [blob('img')] }],
    });
    expect(records).toEqual([
      {
        $type: 'app.bsky.feed.post',
        text: 'one',
        facets,
        langs: ['en'],
        labels: {
          $type: 'com.atproto.label.defs#selfLabels',
          values: [{ val: 'graphic-media' }],
        },
        tags: ['a', 'b'],
        createdAt: '2026-11-12T15:00:00.000Z',
      },
      {
        $type: 'app.bsky.feed.post',
        text: 'two',
        embed: {
          $type: 'app.bsky.embed.images',
          images: [
            {
              alt: 'pic',
              image: blob('img'),
              aspectRatio: { width: 3, height: 2 },
            },
          ],
        },
        langs: ['en'],
        labels: {
          $type: 'com.atproto.label.defs#selfLabels',
          values: [{ val: 'graphic-media' }],
        },
        tags: ['a', 'b'],
        createdAt: '2026-11-12T15:00:00.001Z',
      },
    ]);
  });

  it('gives the first post the reply, with the thread’s root', () => {
    const reply = {
      uri: 'at://did:plc:p/app.bsky.feed.post/2',
      cid: 'bafyparent',
      root: { uri: 'at://did:plc:p/app.bsky.feed.post/1', cid: 'bafyroot' },
    };
    const [record] = buildPostRecords(state([{ text: 'hi' }], { reply }), {
      now: NOW,
      texts: [{ text: 'hi', facets: [] }],
    });
    expect(record.reply).toEqual({
      root: { uri: reply.root.uri, cid: 'bafyroot' },
      parent: { uri: reply.uri, cid: 'bafyparent' },
    });
    // Replying to a root: root and parent are the same post.
    const [own] = buildPostRecords(
      state([{ text: 'hi' }], { reply: { uri: 'at://x', cid: 'c' } }),
      {
        now: NOW,
        texts: [{ text: 'hi', facets: [] }],
      },
    );
    expect(own.reply).toEqual({
      root: { uri: 'at://x', cid: 'c' },
      parent: { uri: 'at://x', cid: 'c' },
    });
  });

  it('leaves out empty fields', () => {
    const [record] = buildPostRecords(state([{ text: 'x' }], { langs: [] }), {
      now: NOW,
      texts: [{ text: 'x', facets: [] }],
    });
    expect(Object.keys(record)).toEqual(['$type', 'text', 'createdAt']);
  });
});

describe('publish: a single post', () => {
  it('writes one record under a client key, with resolved facets', async () => {
    const { target, repo } = fakeTarget();
    const s = state([
      { text: 'hi @friend.test https://example.com/a/rather/long/path/here' },
    ]);
    const result = await go(s, target, {
      resolveMention: async (h) =>
        h === 'friend.test' ? 'did:plc:friend' : null,
    });

    expect(repo.createRecord).toHaveBeenCalledTimes(1);
    expect(repo.applyWrites).not.toHaveBeenCalled();
    const call = repo.createRecord.mock.calls[0][0];
    expect(call).toMatchObject({ repo: ME, collection: 'app.bsky.feed.post' });
    expect(isTid(call.rkey)).toBe(true);
    expect(call.record.text).toBe(
      'hi @friend.test example.com/a/rather/lon...',
    );
    expect(call.record.facets.map((f) => f.features[0].$type)).toEqual([
      'app.bsky.richtext.facet#mention',
      'app.bsky.richtext.facet#link',
    ]);
    expect(result.root).toEqual(result.posts[0]);
    expect(result.written[0].record).toBe(call.record);
    expect(result.warnings).toEqual([]);
  });

  it('writes the post and its gates in one applyWrites at one key', async () => {
    const { target, repo } = fakeTarget();
    const s = state([{ text: 'quiet' }], {
      gates: { custom: true, reply: [], quotes: false },
    });
    const result = await go(s, target);
    expect(repo.createRecord).not.toHaveBeenCalled();
    const { writes, validate } = repo.applyWrites.mock.calls[0][0];
    expect(validate).toBe(true);
    expect(writes.map((w) => w.collection)).toEqual([
      'app.bsky.feed.post',
      'app.bsky.feed.threadgate',
      'app.bsky.feed.postgate',
    ]);
    expect(new Set(writes.map((w) => w.rkey)).size).toBe(1);
    expect(writes[1].value).toMatchObject({ allow: [], post: result.root.uri });
    expect(writes[2].value.embeddingRules).toEqual([
      { $type: 'app.bsky.feed.postgate#disableRule' },
    ]);
  });

  it('never puts gates on a reply', async () => {
    const { target, repo } = fakeTarget();
    const s = state([{ text: 'reply' }], {
      reply: { uri: 'at://did:plc:p/app.bsky.feed.post/1', cid: 'bafyp' },
      gates: { custom: true, reply: [], quotes: false },
    });
    await go(s, target);
    expect(repo.applyWrites).not.toHaveBeenCalled();
    expect(repo.createRecord.mock.calls[0][0].record.reply.parent.uri).toBe(
      'at://did:plc:p/app.bsky.feed.post/1',
    );
  });

  it('counts a write that timed out but landed as published, without writing twice', async () => {
    const { target, repo, records } = fakeTarget();
    const inner = repo.createRecord.getMockImplementation();
    repo.createRecord.mockImplementationOnce(async (input) => {
      await inner(input);
      throw Object.assign(new Error('Gateway Timeout'), { status: 504 });
    });
    const result = await go(state([{ text: 'once' }]), target);
    expect(repo.createRecord).toHaveBeenCalledTimes(1);
    expect(records.size).toBe(1);
    expect(result.root.uri).toMatch(
      /^at:\/\/did:plc:writer\/app\.bsky\.feed\.post\//,
    );
  });

  it('retries a transient failure under the same key', async () => {
    const { target, repo } = fakeTarget({ failWrites: 1 });
    await go(state([{ text: 'again' }]), target);
    expect(repo.createRecord).toHaveBeenCalledTimes(2);
    expect(repo.createRecord.mock.calls[0][0].rkey).toBe(
      repo.createRecord.mock.calls[1][0].rkey,
    );
  });

  it('turns a missing scope into a sign-in-again error', async () => {
    const { target } = fakeTarget({
      failWrites: 5,
      failWith: Object.assign(
        new Error('Missing required scope "repo:app.bsky.feed.post"'),
        { status: 403 },
      ),
    });
    await expect(go(state([{ text: 'x' }]), target)).rejects.toMatchObject({
      code: 'MISSING_SCOPE',
    });
  });
});

describe('publish: a thread', () => {
  it('writes every post in one applyWrites, chained by local CIDs, gates on the root', async () => {
    const { target, repo, records } = fakeTarget();
    const s = state([{ text: 'one' }, { text: 'two' }, { text: 'three' }], {
      tags: ['t'],
      gates: { custom: true, reply: [{ type: 'follower' }], quotes: true },
    });
    const result = await go(s, target);
    expect(repo.applyWrites).toHaveBeenCalledTimes(1);
    const { writes } = repo.applyWrites.mock.calls[0][0];
    expect(writes.map((w) => w.collection)).toEqual([
      'app.bsky.feed.post',
      'app.bsky.feed.post',
      'app.bsky.feed.post',
      'app.bsky.feed.threadgate',
    ]);
    const rkeys = writes.slice(0, 3).map((w) => w.rkey);
    expect([...rkeys].sort()).toEqual(rkeys);
    expect(writes[3].rkey).toBe(rkeys[0]);
    const times = writes.slice(0, 3).map((w) => w.value.createdAt);
    expect(times).toEqual([
      '2026-11-12T15:00:00.000Z',
      '2026-11-12T15:00:00.001Z',
      '2026-11-12T15:00:00.002Z',
    ]);

    // The CIDs the replies name are the ones the PDS computed.
    expect(result.posts).toHaveLength(3);
    for (const p of result.posts) expect(records.get(p.uri).cid).toBe(p.cid);
    expect(records.get(result.posts[2].uri).value.reply).toEqual({
      root: result.posts[0],
      parent: result.posts[1],
    });
    // Tags on every post.
    expect(writes.slice(0, 3).every((w) => w.value.tags?.[0] === 't')).toBe(
      true,
    );
  });

  it('continues an existing thread, with no gates', async () => {
    const { target, repo } = fakeTarget();
    const reply = {
      uri: 'at://did:plc:writer/app.bsky.feed.post/3old',
      cid: 'bafyold',
      root: {
        uri: 'at://did:plc:writer/app.bsky.feed.post/3root',
        cid: 'bafyroot',
      },
    };
    await go(
      state([{ text: 'a' }, { text: 'b' }], {
        reply,
        gates: { custom: true, reply: [], quotes: false },
      }),
      target,
    );
    const { writes } = repo.applyWrites.mock.calls[0][0];
    expect(writes).toHaveLength(2);
    expect(writes[0].value.reply).toEqual({
      root: { uri: reply.root.uri, cid: 'bafyroot' },
      parent: { uri: reply.uri, cid: 'bafyold' },
    });
    expect(writes[1].value.reply.root).toEqual({
      uri: reply.root.uri,
      cid: 'bafyroot',
    });
  });
});

describe('publish: media', () => {
  it('uploads images as the target, reports each blob, and reuses one already this account’s', async () => {
    const { target, repo } = fakeTarget();
    const events = [];
    const s = state([
      {
        text: 'pics',
        images: [
          { id: 'new', file: imageFile(), mime: 'image/jpeg', alt: 'fresh' },
          {
            id: 'kept',
            file: imageFile(),
            blob: blob('bafkreikept'),
            blobDid: ME,
            alt: '',
          },
          {
            id: 'foreign',
            file: imageFile(),
            blob: blob('bafkreiforeign'),
            blobDid: OTHER,
            alt: '',
          },
        ],
      },
    ]);
    await go(s, target, { onProgress: (e) => events.push(e) });
    expect(repo.uploadBlob).toHaveBeenCalledTimes(2);
    const images = repo.createRecord.mock.calls[0][0].record.embed.images;
    expect(images.map((i) => i.image.ref.$link)).toEqual([
      cidFor('bafkreiup1'),
      cidFor('bafkreikept'),
      cidFor('bafkreiup2'),
    ]);
    expect(
      events
        .filter((e) => e.phase === 'uploaded')
        .map((e) => [e.id, e.blobDid]),
    ).toEqual([
      ['new', ME],
      ['foreign', ME],
    ]);
  });

  it('uploads the video as the target and embeds what the service returned', async () => {
    const { target, repo } = fakeTarget();
    const uploadVideo = vi.fn(async (t, file, { onProgress }) => {
      onProgress({ phase: 'processing', progress: 50 });
      return { blob: blob('bafkreivideo', 'video/mp4'), jobId: 'j1' };
    });
    const video = {
      file: new File([new Uint8Array(4)], 'v.mp4', { type: 'video/mp4' }),
      alt: 'clip',
      aspectRatio: { width: 16, height: 9 },
    };
    const events = [];
    await go(state([{ text: 'watch', video }]), target, {
      uploadVideo,
      onProgress: (e) => events.push(e),
    });
    expect(uploadVideo.mock.calls[0][0]).toBe(target);
    expect(repo.createRecord.mock.calls[0][0].record.embed).toEqual({
      $type: 'app.bsky.embed.video',
      video: blob('bafkreivideo', 'video/mp4'),
      alt: 'clip',
      aspectRatio: { width: 16, height: 9 },
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        phase: 'video',
        step: 'processing',
        postIndex: 0,
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        phase: 'uploaded',
        kind: 'video',
        jobId: 'j1',
        blobDid: ME,
      }),
    );
  });

  it('reuses a video blob only when it is this account’s', async () => {
    const { target } = fakeTarget();
    const uploadVideo = vi.fn(async () => ({
      blob: blob('bafkreinew', 'video/mp4'),
      jobId: 'j',
    }));
    const file = new File([new Uint8Array(4)], 'v.mp4', { type: 'video/mp4' });
    await go(
      state([
        {
          text: 'a',
          video: {
            file,
            blob: blob('bafkreimine', 'video/mp4'),
            blobDid: ME,
            status: 'ready',
          },
        },
      ]),
      target,
      { uploadVideo },
    );
    expect(uploadVideo).not.toHaveBeenCalled();
    await go(
      state([
        {
          text: 'b',
          video: {
            file,
            blob: blob('bafkreitheirs', 'video/mp4'),
            blobDid: OTHER,
            status: 'ready',
          },
        },
      ]),
      target,
      { uploadVideo },
    );
    expect(uploadVideo).toHaveBeenCalledTimes(1);
  });

  it('refuses media whose bytes are gone', async () => {
    const { target, repo } = fakeTarget();
    const s = state([
      { text: 'x', images: [{ id: 'i', blob: blob('b'), blobDid: OTHER }] },
    ]);
    await expect(go(s, target)).rejects.toMatchObject({
      code: 'MEDIA_MISSING',
    });
    expect(repo.createRecord).not.toHaveBeenCalled();
  });

  it('attaches a card with its thumbnail, or without one when that fails', async () => {
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      blob: async () => new Blob([new Uint8Array(3)], { type: 'image/png' }),
    }));
    const compress = async () => new Blob([new Uint8Array(2)]);
    const decode = async () => null;
    const card = {
      url: 'https://e.com',
      title: 'T',
      description: 'D',
      thumb: 'https://img.e.com/x.png',
    };
    const { target, repo } = fakeTarget();
    await go(state([{ text: 'see https://e.com', card }]), target, {
      fetch,
      compress,
      decode,
    });
    expect(repo.createRecord.mock.calls[0][0].record.embed).toMatchObject({
      $type: 'app.bsky.embed.external',
      external: {
        uri: 'https://e.com',
        thumb: { ref: { $link: cidFor('bafkreiup1') } },
      },
    });

    const failing = fakeTarget();
    const result = await go(
      state([{ text: 'see https://e.com/b', card }]),
      failing.target,
      {
        fetch: async () => ({ ok: false, status: 404 }),
      },
    );
    expect(
      failing.repo.createRecord.mock.calls[0][0].record.embed.external,
    ).not.toHaveProperty('thumb');
    expect(result.warnings).toEqual([
      expect.objectContaining({ code: 'CARD_THUMB_FAILED', postIndex: 0 }),
    ]);
  });

  it('quotes with media through recordWithMedia', async () => {
    const { target, repo } = fakeTarget();
    const record = {
      kind: 'post',
      uri: 'at://did:plc:q/app.bsky.feed.post/1',
      cid: 'bafyq',
    };
    await go(
      state([{ text: 'q', record, images: [{ id: 'i', file: imageFile() }] }]),
      target,
    );
    expect(repo.createRecord.mock.calls[0][0].record.embed).toMatchObject({
      $type: 'app.bsky.embed.recordWithMedia',
      record: { record: { uri: record.uri, cid: record.cid } },
      media: { $type: 'app.bsky.embed.images' },
    });
  });

  it('cancels during uploads and writes nothing', async () => {
    const { target, repo } = fakeTarget();
    const controller = new AbortController();
    repo.uploadBlob.mockImplementationOnce(() => new Promise(() => {}));
    const pending = go(
      state([{ text: 'x', images: [{ id: 'i', file: imageFile() }] }]),
      target,
      { signal: controller.signal },
    );
    await new Promise((r) => setTimeout(r, 0));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' });
    expect(repo.createRecord).not.toHaveBeenCalled();
  });
});

describe('publish: guards', () => {
  it('refuses an invalid composer with its problems', async () => {
    const { target, repo } = fakeTarget();
    const err = await go(state([{ text: '' }]), target).catch((e) => e);
    expect(err).toBeInstanceOf(PublishError);
    expect(err.code).toBe('INVALID');
    expect(err.problems.map((p) => p.code)).toEqual(['EMPTY']);
    expect(repo.createRecord).not.toHaveBeenCalled();
  });

  it('never writes as an account other than the one chosen', async () => {
    const { target } = fakeTarget({ did: OTHER });
    await expect(go(state([{ text: 'x' }]), target)).rejects.toMatchObject({
      code: 'WRONG_ACCOUNT',
    });
    await expect(go(state([{ text: 'x' }]), null)).rejects.toMatchObject({
      code: 'NO_TARGET',
    });
  });

  it('refuses the same post twice within two minutes, but only once it went out', async () => {
    let t = 0;
    const duplicateGuard = createDuplicateGuard({ now: () => t });
    const failing = fakeTarget({
      failWrites: 5,
      failWith: Object.assign(new Error('nope'), { status: 400 }),
    });
    const s = state([{ text: 'same' }]);
    await expect(
      go(s, failing.target, { duplicateGuard }),
    ).rejects.toMatchObject({ code: 'WRITE_FAILED' });

    const { target } = fakeTarget();
    await go(s, target, { duplicateGuard });
    await expect(go(s, target, { duplicateGuard })).rejects.toMatchObject({
      code: 'DUPLICATE',
    });
    t = 120_000;
    await expect(go(s, target, { duplicateGuard })).resolves.toBeTruthy();
  });
});

describe('publishSignature', () => {
  it('changes with the account, the text and the attachments', () => {
    const base = state([{ text: 'x' }]);
    const sig = publishSignature(base, ME);
    expect(publishSignature(base, OTHER)).not.toBe(sig);
    expect(
      publishSignature(
        composerReducer(base, { type: 'setText', index: 0, text: 'y' }),
        ME,
      ),
    ).not.toBe(sig);
    expect(
      publishSignature(
        composerReducer(base, {
          type: 'setRecord',
          index: 0,
          record: { uri: 'at://q', cid: 'c' },
        }),
        ME,
      ),
    ).not.toBe(sig);
    expect(publishSignature(state([{ text: ' x ' }]), ME)).toBe(sig);
  });
});
