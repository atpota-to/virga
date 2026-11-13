import { describe, expect, it } from 'vitest';
import {
  emptyComposerState,
  emptyPost,
  validateComposer,
} from '../lib/composerModel.js';
import {
  MAX_MEDIA_BASE64_CHARS,
  base64ToFile,
  blobToBase64,
  reconstructFromScheduled,
  serializeForSchedule,
} from './scheduleSerialize.js';

const DID = 'did:plc:writer';
const NOW = new Date('2026-09-01T12:00:00.000Z');
const AT = '2026-09-01T17:00:00.000Z';
const resolveMention = async (handle) =>
  handle === 'friend.example.com' ? 'did:plc:friend' : null;

function state(patch = {}, posts = [{ text: 'hello' }]) {
  const base = emptyComposerState({ asDid: DID });
  return {
    ...base,
    posts: posts.map((p) => ({ ...emptyPost(), ...p })),
    ...patch,
  };
}

const serialize = (s, options = {}) =>
  serializeForSchedule(s, {
    now: NOW,
    scheduledFor: AT,
    tz: 'America/New_York',
    resolveMention,
    ...options,
  });

const imageFile = (bytes = 'image-bytes', type = 'image/jpeg') =>
  new File([bytes], 'photo.jpg', { type });

const image = (patch = {}) => ({
  id: `i-${Math.random()}`,
  file: imageFile(),
  mime: 'image/jpeg',
  size: 11,
  alt: 'a lamp',
  aspectRatio: { width: 400, height: 300 },
  ...patch,
});

const QUOTED = 'at://did:plc:other/app.bsky.feed.post/3kquoted';

async function rejection(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected a refusal');
}

describe('base64', () => {
  it('round-trips bytes through a File', async () => {
    const file = imageFile(new Uint8Array([0, 1, 2, 250, 255]), 'image/png');
    const b64 = await blobToBase64(file);
    expect(b64).toBe(btoa(String.fromCharCode(0, 1, 2, 250, 255)));
    const back = base64ToFile(b64, 'image/png', 'x.png');
    expect(back.type).toBe('image/png');
    expect([...new Uint8Array(await back.arrayBuffer())]).toEqual([
      0, 1, 2, 250, 255,
    ]);
  });

  it('handles more bytes than one String.fromCharCode call takes', async () => {
    const bytes = new Uint8Array(200_000).map((_, i) => i % 256);
    const b64 = await blobToBase64(new Blob([bytes]));
    const back = base64ToFile(b64, 'image/jpeg', 'big.jpg');
    expect(back.size).toBe(200_000);
  });
});

describe('serializeForSchedule: the body', () => {
  it('is exactly the server’s create body for a plain post', async () => {
    const body = await serialize(state());
    expect(body).toEqual({
      scheduledFor: AT,
      target: 'bluesky',
      queued: false,
      payload: {
        posts: [{ record: { text: 'hello' } }],
        gates: { threadgate: null, postgate: null },
        mediaBytes: {},
        tz: 'America/New_York',
        selfDestruct: null,
      },
    });
    expect(Object.keys(body)).toEqual([
      'scheduledFor',
      'target',
      'queued',
      'payload',
    ]);
  });

  it('keeps its warnings out of the request', async () => {
    const body = await serialize(state());
    expect(body.warnings).toEqual([]);
    expect(JSON.parse(JSON.stringify(body)).warnings).toBeUndefined();
    expect({ ...body }.warnings).toBeUndefined();
  });

  it('takes the time from the state when none is given, as ISO-Z', async () => {
    const body = await serializeForSchedule(
      state({ schedule: { mode: 'at', at: '2026-09-01T13:30:00-04:00' } }),
      { now: NOW, resolveMention },
    );
    expect(body.scheduledFor).toBe('2026-09-01T17:30:00.000Z');
    expect(body.queued).toBe(false);
  });

  it('marks a queued post queued', async () => {
    const queued = await serialize(state({ schedule: { mode: 'queue' } }));
    expect(queued.queued).toBe(true);
    const forced = await serialize(state(), { queued: true });
    expect(forced.queued).toBe(true);
  });

  it('falls back to the device’s zone', async () => {
    const body = await serializeForSchedule(state(), {
      now: NOW,
      scheduledFor: AT,
      resolveMention,
    });
    expect(body.payload.tz).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
  });

  it('puts langs, labels and tags on every post of a thread', async () => {
    const body = await serialize(
      state(
        {
          langs: ['en', 'fr'],
          labels: ['nudity'],
          tags: ['#Moths', 'moths', 'lamps'],
        },
        [{ text: 'one' }, { text: 'two' }],
      ),
    );
    const expected = {
      langs: ['en', 'fr'],
      labels: {
        $type: 'com.atproto.label.defs#selfLabels',
        values: [{ val: 'nudity' }],
      },
      tags: ['Moths', 'lamps'],
    };
    expect(body.payload.posts).toEqual([
      { record: { text: 'one', ...expected } },
      { record: { text: 'two', ...expected } },
    ]);
  });

  it('resolves mentions and links into facets, links shortened', async () => {
    const body = await serialize(
      state({}, [
        {
          text: 'hi @friend.example.com see https://example.com/a/very/long/path/that/goes/on/and/on',
        },
      ]),
    );
    const { text, facets } = body.payload.posts[0].record;
    expect(text).not.toContain('goes/on/and/on');
    const features = facets.map((f) => f.features[0]);
    expect(features).toContainEqual({
      $type: 'app.bsky.richtext.facet#mention',
      did: 'did:plc:friend',
    });
    expect(features).toContainEqual({
      $type: 'app.bsky.richtext.facet#link',
      uri: 'https://example.com/a/very/long/path/that/goes/on/and/on',
    });
  });

  it('writes an inline link as its label with the address in the facet', async () => {
    const body = await serialize(
      state({}, [{ text: 'read [my essay](https://example.com/essay)' }]),
    );
    expect(body.payload.posts[0].record.text).toBe('read my essay');
    expect(body.payload.posts[0].record.facets[0].features[0].uri).toBe(
      'https://example.com/essay',
    );
  });

  it('sends the gates as lexicon rules', async () => {
    const body = await serialize(
      state({
        gates: {
          custom: true,
          reply: [
            { type: 'following' },
            {
              type: 'list',
              list: 'at://did:plc:writer/app.bsky.graph.list/l1',
            },
          ],
          quotes: false,
        },
      }),
    );
    expect(body.payload.gates).toEqual({
      threadgate: [
        { $type: 'app.bsky.feed.threadgate#followingRule' },
        {
          $type: 'app.bsky.feed.threadgate#listRule',
          list: 'at://did:plc:writer/app.bsky.graph.list/l1',
        },
      ],
      postgate: [{ $type: 'app.bsky.feed.postgate#disableRule' }],
    });
  });

  it('keeps "nobody can reply" as an empty threadgate, not as none', async () => {
    const body = await serialize(
      state({ gates: { custom: true, reply: [], quotes: true } }),
    );
    expect(body.payload.gates).toEqual({ threadgate: [], postgate: null });
  });
});

describe('serializeForSchedule: media and embeds', () => {
  it('sends each image’s bytes under p{post}-img{n}', async () => {
    const body = await serialize(
      state({}, [
        {
          text: 'two photos',
          images: [
            image(),
            image({
              alt: '',
              aspectRatio: undefined,
              file: imageFile('png', 'image/png'),
            }),
          ],
        },
        { text: 'and one more', images: [image({ alt: 'the porch' })] },
      ]),
    );
    expect(body.payload.posts[0].embed).toEqual({
      type: 'images',
      images: [
        {
          mediaId: 'p0-img0',
          alt: 'a lamp',
          aspectRatio: { width: 400, height: 300 },
        },
        { mediaId: 'p0-img1', alt: '' },
      ],
    });
    expect(body.payload.posts[1].embed.images[0].mediaId).toBe('p1-img0');
    expect(body.payload.mediaBytes).toEqual({
      'p0-img0': { base64: btoa('image-bytes'), encoding: 'image/jpeg' },
      'p0-img1': { base64: btoa('png'), encoding: 'image/png' },
      'p1-img0': { base64: btoa('image-bytes'), encoding: 'image/jpeg' },
    });
  });

  it('reads an image without a file through loadImage', async () => {
    const body = await serialize(
      state({}, [
        { text: '', images: [image({ file: undefined, localRef: 'ref-1' })] },
      ]),
      {
        loadImage: async (img) =>
          img.localRef === 'ref-1' ? imageFile('from-device') : null,
      },
    );
    expect(body.payload.mediaBytes['p0-img0'].base64).toBe(btoa('from-device'));
  });

  it('quotes a post', async () => {
    const body = await serialize(
      state({}, [
        {
          text: 'this',
          record: { kind: 'post', uri: QUOTED, cid: 'bafyquoted' },
        },
      ]),
    );
    expect(body.payload.posts[0].embed).toEqual({
      type: 'record',
      uri: QUOTED,
      cid: 'bafyquoted',
    });
  });

  it('quotes a post with images as recordWithMedia', async () => {
    const body = await serialize(
      state({}, [
        {
          text: 'this, and a photo',
          record: { kind: 'post', uri: QUOTED, cid: 'bafyquoted' },
          images: [image()],
        },
      ]),
    );
    expect(body.payload.posts[0].embed).toEqual({
      type: 'recordWithMedia',
      uri: QUOTED,
      cid: 'bafyquoted',
      media: {
        type: 'images',
        images: [
          {
            mediaId: 'p0-img0',
            alt: 'a lamp',
            aspectRatio: { width: 400, height: 300 },
          },
        ],
      },
    });
  });

  it('sends a link card with the page’s image as a thumbUrl the worker fetches', async () => {
    const body = await serialize(
      state({}, [
        {
          text: 'a link',
          card: {
            url: 'https://example.com/post',
            title: 'T',
            description: 'D',
            thumb: 'https://cardyb.bsky.app/v1/image?url=x',
            associatedRefs: [
              {
                uri: 'at://did:plc:pub/site.standard.document/1',
                cid: 'bafydoc',
              },
            ],
          },
        },
      ]),
    );
    expect(body.payload.posts[0].embed).toEqual({
      type: 'external',
      uri: 'https://example.com/post',
      title: 'T',
      description: 'D',
      thumbUrl: 'https://cardyb.bsky.app/v1/image?url=x',
      associatedRefs: [
        { uri: 'at://did:plc:pub/site.standard.document/1', cid: 'bafydoc' },
      ],
    });
    expect(body.payload.mediaBytes).toEqual({});
  });

  it('sends no thumbUrl the server would refuse', async () => {
    const body = await serialize(
      state({}, [
        {
          text: 'a link',
          card: {
            url: 'https://example.com',
            title: '',
            description: '',
            thumb: 'http://example.com/i.jpg',
          },
        },
      ]),
    );
    expect(body.payload.posts[0].embed).toEqual({
      type: 'external',
      uri: 'https://example.com',
      title: '',
      description: '',
    });
  });

  it('shrinks the writer’s own card image and sends its bytes', async () => {
    const seen = [];
    const body = await serialize(
      state({}, [
        {
          text: 'a link',
          card: {
            url: 'https://example.com',
            title: 'T',
            description: '',
            thumb: 'https://example.com/page.jpg',
            thumbFile: imageFile('raw-thumb'),
          },
        },
      ]),
      {
        compress: async (file, opts) => {
          seen.push(opts.maxSizeMB);
          return new Blob(['small-thumb'], { type: 'image/jpeg' });
        },
        decode: async () => null,
      },
    );
    expect(seen).toEqual([expect.any(Number)]);
    expect(body.payload.posts[0].embed.thumbMediaId).toBe('p0-thumb');
    expect(body.payload.posts[0].embed.thumbUrl).toBeUndefined();
    expect(body.payload.mediaBytes['p0-thumb']).toEqual({
      base64: btoa('small-thumb'),
      encoding: 'image/jpeg',
    });
  });

  it('sends the card without an image when the writer’s can’t be shrunk', async () => {
    const body = await serialize(
      state({}, [
        {
          text: 'a link',
          card: {
            url: 'https://example.com',
            title: 'T',
            description: '',
            thumb: null,
            thumbFile: imageFile(),
          },
        },
      ]),
      {
        compress: async () => {
          throw new Error('no canvas');
        },
      },
    );
    expect(body.payload.posts[0].embed.thumbMediaId).toBeUndefined();
    expect(body.payload.mediaBytes).toEqual({});
    expect(body.warnings).toEqual([
      { code: 'CARD_THUMB_FAILED', postIndex: 0 },
    ]);
  });

  it('drops a card behind images, as a live post does', async () => {
    const body = await serialize(
      state({}, [
        {
          text: 'both',
          images: [image()],
          card: {
            url: 'https://example.com',
            title: 'T',
            description: '',
            thumb: 'https://example.com/t.jpg',
          },
        },
      ]),
    );
    expect(body.payload.posts[0].embed.type).toBe('images');
  });

  it('refuses more than 4,000,000 base64 characters of media', async () => {
    const big = () => image({ file: imageFile(new Uint8Array(1_600_000)) });
    const err = await rejection(
      serialize(state({}, [{ text: 'a', images: [big(), big()] }])),
    );
    expect(err.code).toBe('MEDIA_TOO_LARGE');
    expect(err.limit).toBe(MAX_MEDIA_BASE64_CHARS);
    expect(err.size).toBeGreaterThan(MAX_MEDIA_BASE64_CHARS);
  });

  it('allows media up to the limit', async () => {
    const fits = () => image({ file: imageFile(new Uint8Array(1_400_000)) });
    const body = await serialize(
      state({}, [{ text: 'a', images: [fits(), fits()] }]),
    );
    expect(Object.keys(body.payload.mediaBytes)).toHaveLength(2);
  });

  it('refuses an image over the lexicon’s size', async () => {
    const err = await rejection(
      serialize(
        state({}, [
          {
            text: 'a',
            images: [image({ file: imageFile(new Uint8Array(2_000_001)) })],
          },
        ]),
      ),
    );
    expect(err.code).toBe('IMAGE_TOO_LARGE');
  });

  it('refuses an image with no bytes to send', async () => {
    const err = await rejection(
      serialize(
        state({}, [
          {
            text: 'a',
            images: [image({ file: undefined, blob: { ref: 'x' } })],
          },
        ]),
      ),
    );
    expect(err.code).toBe('IMAGE_MISSING');
    expect(err.postIndex).toBe(0);
  });

  it('refuses a record that has no cid yet', async () => {
    const err = await rejection(
      serialize(
        state({}, [{ text: 'q', record: { kind: 'post', uri: QUOTED } }]),
      ),
    );
    expect(err.code).toBe('RECORD_UNRESOLVED');
  });
});

describe('serializeForSchedule: what the server can’t schedule', () => {
  it('refuses a reply', async () => {
    const err = await rejection(
      serialize(
        state({
          reply: { uri: QUOTED, cid: 'c', root: { uri: QUOTED, cid: 'c' } },
        }),
      ),
    );
    expect(err.code).toBe('SCHEDULE_REPLY');
    expect(err.message).toMatch(/Replies can’t be scheduled/);
  });

  it('refuses video', async () => {
    const err = await rejection(
      serialize(
        state({}, [
          {
            text: 'a clip',
            video: {
              file: imageFile('v', 'video/mp4'),
              mime: 'video/mp4',
              size: 1,
              alt: '',
              status: 'idle',
            },
          },
        ]),
      ),
    );
    expect(err.code).toBe('SCHEDULE_VIDEO');
  });

  it('agrees with validateComposer on both', () => {
    const reply = state({
      reply: { uri: QUOTED, cid: 'c', root: { uri: QUOTED, cid: 'c' } },
    });
    expect(
      validateComposer(reply, { now: NOW, forSchedule: true }).map(
        (p) => p.code,
      ),
    ).toContain('SCHEDULE_REPLY');
  });

  it('refuses a missing, past or too-distant time', async () => {
    expect(
      (await rejection(serializeForSchedule(state(), { now: NOW }))).code,
    ).toBe('SCHEDULE_INVALID');
    expect(
      (
        await rejection(
          serialize(state(), { scheduledFor: '2026-09-01T11:59:00Z' }),
        )
      ).code,
    ).toBe('SCHEDULE_PAST');
    expect(
      (
        await rejection(
          serialize(state(), { scheduledFor: '2026-12-15T12:00:00Z' }),
        )
      ).code,
    ).toBe('SCHEDULE_TOO_FAR');
  });

  it('refuses a post with nothing in it', async () => {
    const err = await rejection(
      serialize(state({}, [{ text: 'one' }, { text: '   ' }])),
    );
    expect(err.code).toBe('EMPTY');
    expect(err.postIndex).toBe(1);
  });
});

describe('serializeForSchedule: the timer', () => {
  it('sends no timer when the lifespan is off', async () => {
    const body = await serialize(
      state({ lifespan: { enabled: false, lifespanSeconds: 3600 } }),
    );
    expect(body.payload.selfDestruct).toBeNull();
  });

  it('sends the rule as the server’s wire spec', async () => {
    const body = await serialize(
      state({
        lifespan: {
          enabled: true,
          lifespanSeconds: 3600,
          conditions: { clauses: [{ metric: 'likes', value: 5 }] },
          effects: [
            {
              action: 'limitReplies',
              allow: [
                {
                  list: 'at://did:plc:writer/app.bsky.graph.list/l1',
                  name: 'Friends',
                },
              ],
            },
          ],
        },
      }),
    );
    expect(body.payload.selfDestruct).toEqual({
      lifespanSeconds: 3600,
      conditions: {
        logic: 'any',
        clauses: [{ metric: 'likes', op: 'gte', value: 5 }],
        sense: 'unless',
        onSpare: 'keep',
        maxExtensions: 0,
      },
      effects: [
        {
          action: 'limitReplies',
          allow: [{ list: 'at://did:plc:writer/app.bsky.graph.list/l1' }],
        },
      ],
    });
  });

  it('measures a pinned delete time from when the post goes out', async () => {
    const body = await serialize(
      state({
        lifespan: {
          enabled: true,
          lifespanSeconds: 600,
          deleteAt: '2026-09-01T19:00:00.000Z',
        },
      }),
    );
    expect(body.payload.selfDestruct.deleteAt).toBe('2026-09-01T19:00:00.000Z');
    expect(body.payload.selfDestruct.lifespanSeconds).toBe(2 * 3600);
  });

  it('refuses a pinned delete time before the post would go out', async () => {
    const err = await rejection(
      serialize(
        state({
          lifespan: {
            enabled: true,
            lifespanSeconds: 600,
            deleteAt: '2026-09-01T17:02:00.000Z',
          },
        }),
      ),
    );
    expect(err.code).toBe('LIFESPAN');
    expect(err.message).toMatch(/Pick a later delete time/);
  });
});

/* ---- reconstructing ---------------------------------------------------- */

const row = (posts, extra = {}) => ({
  id: 'row-1',
  clientKey: 'virga',
  status: 'pending',
  scheduledFor: AT,
  queued: false,
  target: 'bluesky',
  payload: { posts },
  ...extra,
});
const textPost = (text) => ({ record: { text } });
const IMAGE_B64 = btoa('image-bytes');

describe('reconstructFromScheduled: threads', () => {
  it('brings a three-post thread back whole', () => {
    const s = reconstructFromScheduled(
      row([textPost('one'), textPost('two'), textPost('three')]),
      {},
      { asDid: DID },
    );
    expect(s.posts.map((p) => p.text)).toEqual(['one', 'two', 'three']);
    expect(new Set(s.posts.map((p) => p.id)).size).toBe(3);
  });

  it('puts an inline link back as markdown on every post', () => {
    const linked = {
      record: {
        text: 'read my essay',
        facets: [
          {
            features: [
              {
                $type: 'app.bsky.richtext.facet#link',
                uri: 'https://example.com/essay',
              },
            ],
            index: { byteStart: 5, byteEnd: 13 },
          },
        ],
      },
    };
    const s = reconstructFromScheduled(
      row([linked, linked]),
      {},
      { asDid: DID },
    );
    expect(s.posts.map((p) => p.text)).toEqual([
      'read [my essay](https://example.com/essay)',
      'read [my essay](https://example.com/essay)',
    ]);
  });

  it('rebuilds the embed on a later post, not only the root', () => {
    const s = reconstructFromScheduled(
      row([
        textPost('root'),
        {
          record: { text: 'second' },
          embed: {
            type: 'images',
            images: [{ mediaId: 'p1-img0', alt: 'a lamp' }],
          },
        },
      ]),
      { 'p1-img0': { base64: IMAGE_B64, encoding: 'image/png' } },
      { asDid: DID },
    );
    expect(s.posts[0].images).toEqual([]);
    expect(s.posts[1].images).toHaveLength(1);
    expect(s.posts[1].images[0].alt).toBe('a lamp');
    expect(s.posts[1].images[0].file).toBeInstanceOf(File);
    expect(s.posts[1].images[0].mime).toBe('image/png');
  });
});

describe('reconstructFromScheduled: embeds', () => {
  it('rebuilds a quote', () => {
    const s = reconstructFromScheduled(
      row([
        {
          record: { text: 'quoting' },
          embed: { type: 'record', uri: QUOTED, cid: 'quotecid' },
        },
      ]),
      {},
      { asDid: DID },
    );
    expect(s.posts[0].record).toEqual({
      kind: 'post',
      uri: QUOTED,
      cid: 'quotecid',
    });
  });

  it('knows a feed or a list from its collection', () => {
    const feed = 'at://did:plc:other/app.bsky.feed.generator/cool';
    const s = reconstructFromScheduled(
      row([
        {
          record: { text: '' },
          embed: { type: 'record', uri: feed, cid: 'fc' },
        },
      ]),
      {},
      { asDid: DID },
    );
    expect(s.posts[0].record.kind).toBe('feed');
  });

  it('rebuilds both halves of a recordWithMedia', () => {
    const s = reconstructFromScheduled(
      row([
        {
          record: { text: 'quote plus pic' },
          embed: {
            type: 'recordWithMedia',
            uri: QUOTED,
            cid: 'quotecid',
            media: {
              type: 'images',
              images: [
                {
                  mediaId: 'p0-img0',
                  alt: 'lamp',
                  aspectRatio: { width: 3, height: 2 },
                },
              ],
            },
          },
        },
      ]),
      { 'p0-img0': { base64: IMAGE_B64, encoding: 'image/jpeg' } },
      { asDid: DID },
    );
    expect(s.posts[0].record.cid).toBe('quotecid');
    expect(s.posts[0].images).toHaveLength(1);
    expect(s.posts[0].images[0]).toMatchObject({
      alt: 'lamp',
      aspectRatio: { width: 3, height: 2 },
    });
  });

  it('rebuilds a link card with the page’s image', () => {
    const s = reconstructFromScheduled(
      row([
        {
          record: { text: 'a link' },
          embed: {
            type: 'external',
            uri: 'https://example.com',
            title: 'T',
            description: 'D',
            thumbUrl: 'https://example.com/thumb.jpg',
          },
        },
      ]),
      {},
      { asDid: DID },
    );
    expect(s.posts[0].card).toEqual({
      url: 'https://example.com',
      title: 'T',
      description: 'D',
      thumb: 'https://example.com/thumb.jpg',
    });
  });

  it('rebuilds a link card with the writer’s own image', () => {
    const s = reconstructFromScheduled(
      row([
        {
          record: { text: 'a link' },
          embed: {
            type: 'external',
            uri: 'https://example.com',
            title: 'T',
            description: '',
            thumbMediaId: 'p0-thumb',
          },
        },
      ]),
      { 'p0-thumb': { base64: IMAGE_B64, encoding: 'image/jpeg' } },
      { asDid: DID },
    );
    expect(s.posts[0].card.thumbFile).toBeInstanceOf(File);
    expect(s.posts[0].card.thumb).toBeNull();
  });

  it('keeps an image whose bytes are gone in place, so the composer asks for it', () => {
    const s = reconstructFromScheduled(
      row([
        {
          record: { text: 'x' },
          embed: {
            type: 'images',
            images: [{ mediaId: 'missing', alt: 'gone' }],
          },
        },
      ]),
      {},
      { asDid: DID },
    );
    expect(s.posts[0].images).toHaveLength(1);
    expect(s.posts[0].images[0].file).toBeUndefined();
    expect(s.posts[0].images[0].alt).toBe('gone');
    expect(validateComposer(s, { now: NOW }).map((p) => p.code)).toContain(
      'IMAGE_MISSING',
    );
  });
});

describe('reconstructFromScheduled: the row’s fields', () => {
  it('names the row as its source, with its client', () => {
    const s = reconstructFromScheduled(
      row([textPost('hi')]),
      {},
      { asDid: DID },
    );
    expect(s.source).toEqual({
      kind: 'scheduled',
      id: 'row-1',
      clientKey: 'virga',
    });
    expect(s.asDid).toBe(DID);
    expect(s.reply).toBeNull();
  });

  it('keeps the row’s time, or its place in the queue', () => {
    expect(
      reconstructFromScheduled(
        row([textPost('hi')], { scheduledFor: '2026-09-01 17:00:00+00' }),
        {},
        { asDid: DID },
      ).schedule,
    ).toEqual({ mode: 'at', at: AT });
    expect(
      reconstructFromScheduled(
        row([textPost('hi')], { queued: true }),
        {},
        { asDid: DID },
      ).schedule,
    ).toEqual({ mode: 'queue' });
  });

  it('reads the snake_case column too', () => {
    const s = reconstructFromScheduled(
      {
        id: 'row-2',
        scheduled_for: '2026-09-02T09:00:00.000Z',
        payload: { posts: [textPost('hi')] },
      },
      {},
      { asDid: DID },
    );
    expect(s.schedule).toEqual({ mode: 'at', at: '2026-09-02T09:00:00.000Z' });
    expect(s.source.clientKey).toBe('virga');
  });

  it('brings langs, labels and tags off the root, and the gates as the post’s own', () => {
    const root = {
      record: {
        text: 'hi',
        langs: ['fr'],
        tags: ['moths', 'lamps'],
        labels: { values: [{ val: 'nudity' }] },
      },
    };
    const s = reconstructFromScheduled(
      row([root], {
        payload: {
          posts: [root],
          gates: {
            threadgate: [{ $type: 'app.bsky.feed.threadgate#mentionRule' }],
            postgate: [{ $type: 'app.bsky.feed.postgate#disableRule' }],
          },
        },
      }),
      {},
      { asDid: DID },
    );
    expect(s.langs).toEqual(['fr']);
    expect(s.labels).toEqual(['nudity']);
    expect(s.tags).toEqual(['moths', 'lamps']);
    expect(s.gates).toEqual({
      custom: true,
      reply: [{ type: 'mention' }],
      quotes: false,
    });
  });

  it('keeps nobody-can-reply and everyone apart', () => {
    const nobody = reconstructFromScheduled(
      row([textPost('x')], {
        payload: {
          posts: [textPost('x')],
          gates: { threadgate: [], postgate: null },
        },
      }),
      {},
      { asDid: DID },
    );
    expect(nobody.gates.reply).toEqual([]);
    const everyone = reconstructFromScheduled(
      row([textPost('x')]),
      {},
      { asDid: DID },
    );
    expect(everyone.gates).toEqual({ custom: true, reply: null, quotes: true });
  });

  it('survives a row with no payload at all', () => {
    const s = reconstructFromScheduled({ id: 'empty' }, undefined, {
      asDid: DID,
    });
    expect(s.posts).toHaveLength(1);
    expect(s.posts[0].text).toBe('');
    expect(s.labels).toEqual([]);
    expect(s.schedule).toBeNull();
    expect(s.lifespan.enabled).toBe(false);
  });

  it('has no timer when the row has none, whatever the default', () => {
    const s = reconstructFromScheduled(
      row([textPost('staying put')]),
      {},
      { asDid: DID },
    );
    expect(s.lifespan.enabled).toBe(false);
  });

  it('brings the row’s timer back armed, as the writer’s rule', () => {
    const spec = {
      lifespanSeconds: 3600,
      deleteAt: null,
      conditions: {
        logic: 'any',
        clauses: [{ metric: 'replies', op: 'gte', value: 1 }],
        sense: 'unless',
        onSpare: 'keep',
        maxExtensions: 0,
      },
      effects: [{ action: 'limitReplies', allow: ['follower'] }],
    };
    const s = reconstructFromScheduled(
      row([textPost('x')], {
        payload: { posts: [textPost('x')], selfDestruct: spec },
      }),
      {},
      { asDid: DID },
    );
    expect(s.lifespan).toEqual({ enabled: true, ...spec });
  });

  it('disarms a stored rule with parts this build can’t read', () => {
    const s = reconstructFromScheduled(
      row([textPost('x')], {
        payload: {
          posts: [textPost('x')],
          selfDestruct: {
            lifespanSeconds: 3600,
            effects: [{ action: 'shout' }],
          },
        },
      }),
      {},
      { asDid: DID },
    );
    expect(s.lifespan.enabled).toBe(false);
  });
});

describe('a pinned delete time survives editing a scheduled post', () => {
  const spec = {
    lifespanSeconds: 5 * 3600,
    deleteAt: '2026-09-01T22:00:00.000Z',
    conditions: {
      logic: 'any',
      clauses: [],
      sense: 'unless',
      onSpare: 'keep',
      maxExtensions: 0,
    },
    effects: [{ action: 'delete' }],
  };

  it('goes out again unchanged at the same time', async () => {
    const s = reconstructFromScheduled(
      row([textPost('thursday evening')], {
        payload: { posts: [textPost('thursday evening')], selfDestruct: spec },
      }),
      {},
      { asDid: DID },
    );
    expect(s.lifespan.deleteAt).toBe(spec.deleteAt);
    const body = await serializeForSchedule(s, {
      now: NOW,
      tz: 'UTC',
      resolveMention,
    });
    expect(body.scheduledFor).toBe(AT);
    expect(body.payload.selfDestruct).toEqual({
      lifespanSeconds: 5 * 3600,
      deleteAt: spec.deleteAt,
      conditions: spec.conditions,
      effects: [{ action: 'delete' }],
    });
  });

  it('is refused rather than rewritten when the post moves past it', async () => {
    const s = reconstructFromScheduled(
      row([textPost('moved')], {
        payload: { posts: [textPost('moved')], selfDestruct: spec },
      }),
      {},
      { asDid: DID },
    );
    const err = await rejection(
      serializeForSchedule(s, {
        now: NOW,
        scheduledFor: '2026-09-02T09:00:00.000Z',
        resolveMention,
      }),
    );
    expect(err.code).toBe('LIFESPAN');
  });
});

describe('round trip: serialize, store, reconstruct, serialize', () => {
  async function roundTrip(s, options = {}) {
    const first = await serialize(s, options);
    const stored = {
      id: 'row-9',
      clientKey: 'virga',
      status: 'pending',
      scheduledFor: first.scheduledFor
        .replace('T', ' ')
        .replace('.000Z', '+00'),
      queued: first.queued,
      target: first.target,
      payload: {
        posts: first.payload.posts,
        gates: first.payload.gates,
        media: Object.fromEntries(
          Object.entries(first.payload.mediaBytes).map(([id, m]) => [
            id,
            { storagePath: `row-9/${id}`, encoding: m.encoding },
          ]),
        ),
        rkeys: first.payload.posts.map((_, i) => `3kabc${i}`),
        tz: first.payload.tz,
        selfDestruct: first.payload.selfDestruct,
      },
    };
    const back = reconstructFromScheduled(stored, first.payload.mediaBytes, {
      asDid: DID,
    });
    const second = await serializeForSchedule(back, {
      now: NOW,
      tz: 'America/New_York',
      resolveMention,
      ...(first.queued ? { scheduledFor: first.scheduledFor } : {}),
      ...(options.compress
        ? { compress: options.compress, decode: options.decode }
        : {}),
    });
    return { first, second, back };
  }

  it('writes the same body for a thread with everything on it', async () => {
    const s = state(
      {
        langs: ['en'],
        labels: ['graphic-media'],
        tags: ['moths'],
        gates: { custom: true, reply: [{ type: 'follower' }], quotes: false },
        lifespan: {
          enabled: true,
          lifespanSeconds: 6 * 3600,
          conditions: {
            clauses: [{ metric: 'likes', op: 'gt', value: 10 }],
            sense: 'unless',
            onSpare: 'extend',
            maxExtensions: 2,
          },
          effects: [{ action: 'delete' }],
        },
      },
      [
        {
          text: 'hi @friend.example.com, read [this](https://example.com/a/very/long/path/that/goes/on/and/on)',
        },
        { text: 'photos', images: [image(), image({ alt: 'second' })] },
        {
          text: 'and a quote',
          record: { kind: 'post', uri: QUOTED, cid: 'bafyquoted' },
          images: [image()],
        },
        {
          text: 'a link',
          card: {
            url: 'https://example.com/x',
            title: 'X',
            description: 'Y',
            thumb: 'https://example.com/x.jpg',
          },
        },
      ],
    );
    const { first, second, back } = await roundTrip(s);
    expect(second).toEqual(first);
    expect(back.source).toEqual({
      kind: 'scheduled',
      id: 'row-9',
      clientKey: 'virga',
    });
    expect(back.posts[0].text).toBe(s.posts[0].text);
  });

  it('writes the same body for a queued post with the writer’s card image', async () => {
    const compress = async () => new Blob(['thumb'], { type: 'image/jpeg' });
    const decode = async () => null;
    const s = state({ schedule: { mode: 'queue' } }, [
      {
        text: 'queued',
        card: {
          url: 'https://example.com',
          title: 'T',
          description: '',
          thumb: null,
          thumbFile: imageFile(),
        },
      },
    ]);
    const { first, second, back } = await roundTrip(s, { compress, decode });
    expect(first.queued).toBe(true);
    expect(back.schedule).toEqual({ mode: 'queue' });
    expect(second).toEqual(first);
  });

  it('writes the same body for nobody-can-reply and no timer', async () => {
    const { first, second } = await roundTrip(
      state({ gates: { custom: true, reply: [], quotes: true } }),
    );
    expect(first.payload.gates.threadgate).toEqual([]);
    expect(second).toEqual(first);
  });
});
