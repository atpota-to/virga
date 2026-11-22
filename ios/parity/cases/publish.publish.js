// src/posting/lib/publish.js: what makes two publishes the same post, the
// duplicate guard, the records a state becomes, and whole publishes as
// recorded exchanges with a PDS behind Virga's server, Bluesky's video
// service and a card image's host: single posts and threads, gates, replies,
// images uploaded or reused, video, link cards, quotes, failures part way
// and what is kept, retries, and the progress events. Swift:
// VirgaPosting/Lib/Publish.swift, replayed through MockTransport.
//
// Inputs from publish.test.js, every flow it has, with the PDS faked at the
// network instead of the agent, so the records, their keys (a fixed TID
// clock, _publish.js) and the CIDs replies name are the web's own.

import { each, value } from './_helpers.js';
import { recordFetch, json } from './_fetch.js';
import { file, markFiles, withFiles } from './_composer.js';
import {
  ME,
  NOW,
  OTHER,
  agentFor,
  hangs,
  loadFresh,
  methodOf,
  ok,
  pds,
  rawCid,
  resetTids,
  scriptedImages,
  withFixedDate,
  withTimers,
} from './_publish.js';

export const sources = ['src/posting/lib/publish.js'];

const VIDEO = 'https://video.bsky.app/xrpc/app.bsky.video.';
const VIDEO_BLOB = {
  $type: 'blob',
  ref: { $link: rawCid('video') },
  mimeType: 'video/mp4',
  size: 4,
};
const imageBlob = (name) => ({
  $type: 'blob',
  ref: { $link: rawCid(name) },
  mimeType: 'image/jpeg',
  size: 1,
});
const FACETS = [
  {
    index: { byteStart: 0, byteEnd: 3 },
    features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'one' }],
  },
];

/** A post with a fixed id. */
const post = (id, fields = {}) => ({ id, text: '', ...fields });
const img = (id, fields = {}) => ({ id, alt: '', ...fields });

/** crypto.getRandomValues filled the same way every run (a video's name). */
async function withFixedRandom(fn) {
  const real = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {
      ...globalThis.crypto,
      getRandomValues(bytes) {
        for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37 + 11) % 256;
        return bytes;
      },
      subtle: real.value?.subtle ?? globalThis.crypto?.subtle,
    },
  });
  try {
    return await fn();
  } finally {
    Object.defineProperty(globalThis, 'crypto', real);
  }
}

/** Bluesky's video service, as the script says: `upload` 'done' | 'processing' | 'refused' | 'limit'. */
function videoService(script = {}) {
  let polls = 0;
  return (request) => {
    if (request.url.startsWith(`${VIDEO}getUploadLimits`))
      return script.upload === 'limit'
        ? json({ canUpload: false, message: 'Daily limit reached' })
        : json({ canUpload: true });
    if (request.url.startsWith(`${VIDEO}uploadVideo`)) {
      if (script.upload === 'refused')
        return json({ error: 'InvalidVideo', message: 'Bad video' }, 400);
      if (script.upload === 'processing')
        return json({
          jobId: 'j1',
          did: ME,
          state: 'JOB_STATE_ENCODING',
          progress: 10,
        });
      return json({
        jobId: 'j1',
        did: ME,
        state: 'JOB_STATE_COMPLETED',
        blob: VIDEO_BLOB,
      });
    }
    if (request.url.startsWith(`${VIDEO}getJobStatus`)) {
      polls += 1;
      return polls < 2
        ? json({
            jobStatus: {
              jobId: 'j1',
              did: ME,
              state: 'JOB_STATE_ENCODING',
              progress: 60,
            },
          })
        : json({
            jobStatus: {
              jobId: 'j1',
              did: ME,
              state: 'JOB_STATE_COMPLETED',
              blob: VIDEO_BLOB,
            },
          });
    }
    return null;
  };
}

/** A card image's host. */
function imageHost(script = {}) {
  return (request) => {
    if (!request.url.startsWith('https://img.e.com/')) return null;
    if (script.image === 'missing') return { status: 404, text: '' };
    return { bytes: new Uint8Array(3), contentType: 'image/png' };
  };
}

// The upload's body is the File itself: recorded as its bytes (all zeros).
function withBodies(out, sizes) {
  for (const exchange of out.exchanges || []) {
    const { request } = exchange;
    if (request.body?.$other && request.url.startsWith(`${VIDEO}uploadVideo`))
      request.body = {
        $bytes: Buffer.from(new Uint8Array(sizes.video ?? 0)).toString(
          'base64',
        ),
      };
  }
  return out;
}

const tokens = (request) =>
  methodOf(request) === 'com.atproto.server.getServiceAuth'
    ? ok({ token: `tok-${new URL(request.url).searchParams.get('lxm')}` })
    : null;

/**
 * Publishes `state` as `target` ('me', 'other' or 'none') against the
 * scripted services, recording every exchange, the progress events and the
 * result or the PublishError.
 */
async function publishCase(m, input) {
  const {
    state,
    target = 'me',
    script = {},
    fire = [],
    mentions = {},
    options = {},
    images: imageScript,
    videoSize = 4,
  } = input;
  const server = pds(script.pds);
  const video = videoService(script.video);
  const host = imageHost(script.card);
  const images = scriptedImages(imageScript, markFiles);
  const events = [];
  const fired = [];
  let sent = 0;
  resetTids();
  const out = await withFixedDate(NOW, () =>
    withFixedRandom(() =>
      recordFetch(
        (request, index) => {
          sent += 1;
          return (
            tokens(request) ??
            video(request) ??
            host(request) ??
            server.responder(request, index)
          );
        },
        () =>
          withTimers(
            fire,
            async () => {
              const t =
                target === 'none'
                  ? null
                  : {
                      did: target === 'other' ? OTHER : ME,
                      agent: await agentFor(target === 'other' ? OTHER : ME),
                      pdsUrl: 'https://pds.example.com',
                    };
              try {
                return await m.publish(withFiles(state), t, {
                  now: () => new Date(NOW),
                  duplicateGuard: null,
                  resolveMention: async (h) => mentions[h] ?? null,
                  onProgress: (e) => events.push(markFiles(e)),
                  compress: images.compress,
                  decode: images.decode,
                  ...options,
                });
              } catch (error) {
                return {
                  $error: {
                    message: error.message,
                    name: error.name,
                    code: error.code ?? null,
                    status: error.status ?? null,
                    problems: error.problems ?? null,
                  },
                };
              }
            },
            { sent: () => sent, fired },
          ),
        { now: NOW },
      ),
    ),
  );
  return {
    ...withBodies(hangs(out, server), { video: videoSize }),
    fired,
    events,
    calls: images.calls,
  };
}

export default async function cases() {
  const [m, cm] = await loadFresh([
    '../../../src/posting/lib/publish.js',
    '../../../src/posting/lib/composerModel.js',
  ]);
  const state = (posts, extra = {}) =>
    cm.normalizeComposerState({
      ...cm.emptyComposerState({ asDid: ME }),
      posts,
      langs: ['en'],
      ...extra,
    });

  const all = [
    value('publishConstants', {
      IMAGE_UPLOAD_CONCURRENCY: m.IMAGE_UPLOAD_CONCURRENCY,
      DUPLICATE_WINDOW_MS: m.DUPLICATE_WINDOW_MS,
    }),
  ];

  // publishSignature(state, did)
  const sigBase = state([post('p1', { text: 'x' })]);
  all.push(
    ...(await each(
      'publishSignature',
      [
        { $id: 'base', state: sigBase, did: ME },
        { $id: 'other-account', state: sigBase, did: OTHER },
        { $id: 'no-did', state: sigBase },
        {
          $id: 'trimmed',
          state: state([post('p1', { text: '  x \n' })]),
          did: ME,
        },
        {
          $id: 'reply',
          state: state([post('p1', { text: 'x' })], {
            reply: { uri: 'at://did:plc:p/app.bsky.feed.post/1', cid: 'c' },
          }),
          did: ME,
        },
        {
          $id: 'attachments',
          state: state([
            post('p1', {
              text: 'pics "quoted" \u{1F600}',
              images: [
                img('i1', {
                  file: file('a.jpg', 'image/jpeg', 10),
                  alt: 'one',
                }),
                img('i2', { blob: imageBlob('kept') }),
                img('i3', { blob: { cid: 'legacy', mimeType: 'image/png' } }),
                img('i4', {}),
              ],
              record: { kind: 'post', uri: 'at://q', cid: 'cq' },
              card: { url: 'https://e.com', title: 'T' },
            }),
            post('p2', {
              text: 'two',
              video: { file: file('v.mp4', 'video/mp4', 9), alt: 'clip' },
            }),
            post('p3', { video: { blob: VIDEO_BLOB } }),
            post('p4', { video: { status: 'idle' } }),
          ]),
          did: ME,
        },
        {
          $id: 'loose',
          state: {
            posts: [
              { images: [{ file: {}, alt: 0 }] },
              { images: [{ file: { name: 'n', size: null } }] },
            ],
            reply: { uri: '' },
          },
          did: ME,
        },
        { $id: 'no-state', state: null, did: ME },
      ],
      ({ state: s, did }) => m.publishSignature(withFiles(s), did),
    )),
  );

  // createDuplicateGuard({ windowMs, now })
  all.push(
    ...(await each(
      'createDuplicateGuard',
      [
        {
          $id: 'window',
          steps: [
            ['isDuplicate', 'a', 0],
            ['remember', 'a', 0],
            ['isDuplicate', 'a', 1000],
            ['isDuplicate', 'b', 1000],
            ['isDuplicate', 'a', 119999],
            ['isDuplicate', 'a', 120000],
            ['remember', 'b', 120000],
            ['isDuplicate', 'a', 120001],
            ['isDuplicate', 'b', 120001],
            ['clear', null, 120001],
            ['isDuplicate', 'b', 120001],
          ],
        },
        {
          $id: 'short-window',
          windowMs: 10,
          steps: [
            ['remember', 'x', 5],
            ['isDuplicate', 'x', 14],
            ['isDuplicate', 'x', 15],
            ['isDuplicate', 'x', 1],
          ],
        },
      ],
      ({ steps, windowMs }) => {
        let t = 0;
        const guard = m.createDuplicateGuard({
          ...(windowMs ? { windowMs } : {}),
          now: () => t,
        });
        return steps.map(([op, sig, at]) => {
          t = at;
          return op === 'isDuplicate'
            ? guard.isDuplicate(sig)
            : (guard[op](sig) ?? null);
        });
      },
    )),
  );

  // buildPostRecords(state, { now, blobs, texts })
  all.push(
    ...(await each(
      'buildPostRecords',
      [
        {
          $id: 'stamps-every-post',
          state: state(
            [
              post('p1', { text: 'one' }),
              post('p2', {
                text: 'two',
                images: [
                  img('i', {
                    alt: 'pic',
                    aspectRatio: { width: 3, height: 2 },
                  }),
                ],
              }),
            ],
            { tags: ['a', 'b'], labels: ['graphic-media'] },
          ),
          texts: [
            { text: 'one', facets: FACETS },
            { text: 'two', facets: [] },
          ],
          blobs: [{}, { images: [imageBlob('img')] }],
        },
        {
          $id: 'reply-with-root',
          state: state([post('p1', { text: 'hi' })], {
            reply: {
              uri: 'at://did:plc:p/app.bsky.feed.post/2',
              cid: 'bafyparent',
              root: {
                uri: 'at://did:plc:p/app.bsky.feed.post/1',
                cid: 'bafyroot',
              },
            },
          }),
          texts: [{ text: 'hi', facets: [] }],
        },
        {
          $id: 'reply-to-root',
          state: state([post('p1', { text: 'hi' })], {
            reply: { uri: 'at://x', cid: 'c' },
          }),
          texts: [{ text: 'hi', facets: [] }],
        },
        {
          $id: 'reply-root-without-cid',
          state: state(
            [post('p1', { text: 'hi' }), post('p2', { text: 'b' })],
            {
              reply: { uri: 'at://x', cid: 'c', root: { uri: 'at://r' } },
            },
          ),
          texts: [],
        },
        {
          $id: 'reply-without-cid',
          state: state([post('p1', { text: 'hi' })], {
            reply: { uri: 'at://x' },
          }),
          texts: [{ text: 'hi', facets: [] }],
        },
        {
          $id: 'leaves-out-empty',
          state: state([post('p1', { text: 'x' })], { langs: [] }),
          texts: [{ text: 'x', facets: [] }],
        },
        {
          $id: 'no-texts',
          state: state([post('p1', { text: '  untouched  ' })]),
          texts: [],
        },
        {
          $id: 'langs-filtered',
          state: {
            ...state([post('p1', { text: 'x' })]),
            langs: ['en', '', null, 'de'],
          },
          texts: [{ text: 'x', facets: [] }],
        },
        {
          $id: 'langs-not-a-list',
          state: { ...state([post('p1', { text: 'x' })]), langs: 'en' },
          texts: [{ text: 'x', facets: [] }],
        },
        {
          $id: 'tags-and-labels',
          state: state([post('p1', { text: 'x' })], {
            tags: ['#One', 'one', 'two'],
            labels: ['porn', 'porn', 'nonsense'],
          }),
          texts: [{ text: 'x', facets: [] }],
        },
        {
          $id: 'embeds',
          state: state([
            post('p1', {
              text: 'q',
              record: { kind: 'post', uri: 'at://q/1', cid: 'cq' },
            }),
            post('p2', {
              text: 'v',
              video: { alt: 'clip', aspectRatio: { width: 16, height: 9 } },
            }),
            post('p3', {
              text: 'c',
              card: {
                url: 'https://e.com',
                title: 'T',
                description: 'D',
                associatedRefs: [{ uri: 'at://a/b/c', cid: 'x' }],
              },
            }),
          ]),
          texts: [],
          blobs: [{}, { video: VIDEO_BLOB }, { cardThumb: imageBlob('thumb') }],
        },
        {
          $id: 'text-missing',
          state: state([post('p1', { text: 'x' })]),
          texts: [{ facets: FACETS }],
        },
        {
          $id: 'thirty-posts',
          state: {
            ...state([]),
            posts: Array.from({ length: 30 }, (_, i) =>
              post(`p${i}`, { text: `${i}` }),
            ),
          },
          texts: [],
        },
        {
          $id: 'invalid-time',
          state: state([post('p1', { text: 'x' })]),
          texts: [],
          now: 'nope',
        },
        {
          $id: 'number-time',
          state: state([post('p1', { text: 'x' }), post('p2', { text: 'y' })]),
          texts: [],
          now: Date.parse('2026-12-31T23:59:59.999Z'),
        },
      ],
      ({ state: s, texts, blobs, now }) =>
        m.buildPostRecords(withFiles(s), {
          now: now === undefined ? new Date(NOW) : now === 'nope' ? NaN : now,
          texts,
          ...(blobs ? { blobs } : {}),
        }),
    )),
  );

  // publish(state, target, options)
  const thread = (n, extra) =>
    state(
      Array.from({ length: n }, (_, i) =>
        post(`p${i}`, { text: ['one', 'two', 'three', 'four'][i] }),
      ),
      extra,
    );
  const flows = [
    {
      $id: 'single-with-facets',
      state: state([
        post('p1', {
          text: 'hi @friend.test https://example.com/a/rather/long/path/here',
        }),
      ]),
      mentions: { 'friend.test': 'did:plc:friend' },
    },
    {
      $id: 'single-with-gates',
      state: state([post('p1', { text: 'quiet' })], {
        gates: { custom: true, reply: [], quotes: false },
      }),
    },
    {
      $id: 'reply-never-gated',
      state: state([post('p1', { text: 'reply' })], {
        reply: { uri: 'at://did:plc:p/app.bsky.feed.post/1', cid: 'bafyp' },
        gates: { custom: true, reply: [], quotes: false },
      }),
    },
    {
      $id: 'timed-out-but-landed',
      state: state([post('p1', { text: 'once' })]),
      script: { pds: { writes: ['land-fail:504:Gateway Timeout'] } },
    },
    {
      $id: 'transient-retried',
      state: state([post('p1', { text: 'again' })]),
      script: { pds: { writes: ['fail:502:blip'] } },
    },
    {
      $id: 'write-hangs-then-lands',
      state: state([post('p1', { text: 'slow' })]),
      script: { pds: { writes: ['hang', 'ok'] } },
      fire: [[30000, 0]],
    },
    {
      $id: 'missing-scope',
      state: state([post('p1', { text: 'x' })]),
      script: {
        pds: {
          writes: ['fail:403:Missing required scope "repo:app.bsky.feed.post"'],
        },
      },
    },
    {
      $id: 'scope-error-name',
      state: state([post('p1', { text: 'x' })]),
      script: { pds: { writes: ['fail:403:Not allowed:ScopeMissingError'] } },
    },
    {
      $id: 'write-refused',
      state: state([post('p1', { text: 'x' })]),
      script: { pds: { writes: ['fail:400:Bad record:InvalidRequest'] } },
    },
    {
      $id: 'write-offline',
      state: state([post('p1', { text: 'x' })]),
      script: { pds: { writes: ['offline', 'offline'] } },
    },
    {
      $id: 'thread-with-root-gate',
      state: thread(3, {
        tags: ['t'],
        gates: { custom: true, reply: [{ type: 'follower' }], quotes: true },
      }),
    },
    {
      $id: 'thread-postgate-on-every-post',
      state: thread(3, {
        gates: { custom: true, reply: [{ type: 'follower' }], quotes: false },
      }),
    },
    {
      $id: 'thread-continues-a-reply',
      state: thread(2, {
        reply: {
          uri: 'at://did:plc:writer/app.bsky.feed.post/3old',
          cid: 'bafyold',
          root: {
            uri: 'at://did:plc:writer/app.bsky.feed.post/3root',
            cid: 'bafyroot',
          },
        },
        gates: { custom: true, reply: [], quotes: false },
      }),
    },
    {
      $id: 'thread-retried',
      state: thread(2),
      script: { pds: { writes: ['fail:503'] } },
    },
    {
      $id: 'thread-fails',
      state: thread(2),
      script: { pds: { writes: ['fail:400:Invalid record:InvalidRequest'] } },
    },
    {
      $id: 'images-uploaded-kept-and-foreign',
      state: state([
        post('p1', {
          text: 'pics',
          images: [
            img('new', {
              file: file('a.jpg', 'image/jpeg', 2),
              mime: 'image/jpeg',
              alt: 'fresh',
            }),
            img('kept', {
              file: file('b.jpg', 'image/jpeg', 3),
              blob: imageBlob('kept'),
              blobDid: ME,
            }),
            img('foreign', {
              file: file('c.png', 'image/png', 4),
              blob: imageBlob('foreign'),
              blobDid: OTHER,
            }),
          ],
        }),
      ]),
    },
    {
      $id: 'images-across-a-thread',
      state: state([
        post('p1', {
          text: 'one',
          images: [img('a', { file: file('a.jpg', 'image/jpeg', 5) })],
        }),
        post('p2', {
          text: 'two',
          images: [
            img('b', { file: file('b.webp', 'image/webp', 6), alt: 'b' }),
            img('c', { file: file('c', '', 7) }),
          ],
        }),
      ]),
    },
    {
      $id: 'image-upload-fails',
      state: state([
        post('p1', {
          text: 'x',
          images: [img('i', { file: file('a.jpg', 'image/jpeg', 2) })],
        }),
      ]),
      script: { pds: { uploads: ['fail:500:upload broke'] } },
    },
    {
      $id: 'image-upload-offline',
      state: state([
        post('p1', {
          text: 'x',
          images: [img('i', { file: file('a.jpg', 'image/jpeg', 2) })],
        }),
      ]),
      script: { pds: { uploads: ['offline'] } },
    },
    {
      $id: 'image-bytes-gone',
      state: state([
        post('p1', {
          text: 'x',
          images: [img('i', { blob: imageBlob('b'), blobDid: OTHER })],
        }),
      ]),
    },
    {
      $id: 'alt-text-required',
      state: state([
        post('p1', {
          text: 'x',
          images: [img('i', { file: file('a.jpg', 'image/jpeg', 2) })],
        }),
      ]),
      options: { requireAltText: true },
    },
    {
      $id: 'video-uploaded',
      state: state([
        post('p1', {
          text: 'watch',
          video: {
            file: file('v.mp4', 'video/mp4', 4),
            alt: 'clip',
            aspectRatio: { width: 16, height: 9 },
          },
        }),
      ]),
    },
    {
      $id: 'video-processing',
      state: state([
        post('p1', {
          text: 'watch',
          video: { file: file('v.mp4', 'video/mp4', 4) },
        }),
      ]),
      script: { video: { upload: 'processing' } },
      fire: [
        [1500, 0],
        [1500, 1],
      ],
    },
    {
      $id: 'video-kept',
      state: state([
        post('p1', {
          text: 'a',
          video: {
            file: file('v.mp4', 'video/mp4', 4),
            blob: VIDEO_BLOB,
            blobDid: ME,
            status: 'ready',
          },
        }),
      ]),
    },
    {
      $id: 'video-foreign',
      state: state([
        post('p1', {
          text: 'b',
          video: {
            file: file('v.mp4', 'video/mp4', 4),
            blob: VIDEO_BLOB,
            blobDid: OTHER,
            status: 'ready',
          },
        }),
      ]),
    },
    {
      $id: 'video-refused',
      state: state([
        post('p1', {
          text: 'b',
          video: { file: file('v.mp4', 'video/mp4', 4) },
        }),
      ]),
      script: { video: { upload: 'refused' } },
    },
    {
      $id: 'video-over-limit',
      state: state([
        post('p1', {
          text: 'b',
          video: { file: file('v.mp4', 'video/mp4', 4) },
        }),
      ]),
      script: { video: { upload: 'limit' } },
    },
    {
      $id: 'video-not-a-file',
      state: state([
        post('p1', { text: 'b', video: { file: { name: 'v.mp4' } } }),
      ]),
    },
    {
      $id: 'image-not-a-file',
      state: state([
        post('p1', {
          text: 'b',
          images: [img('i', { file: { name: 'a.jpg', size: 2 } })],
        }),
      ]),
    },
    {
      $id: 'video-bytes-gone',
      state: state([
        post('p1', { text: 'b', video: { blob: VIDEO_BLOB, blobDid: OTHER } }),
      ]),
    },
    {
      $id: 'card-with-thumbnail',
      state: state([
        post('p1', {
          text: 'see https://e.com',
          card: {
            url: 'https://e.com',
            title: 'T',
            description: 'D',
            thumb: 'https://img.e.com/x.png',
          },
        }),
      ]),
      images: { compress: { size: 2 } },
    },
    {
      $id: 'card-thumbnail-fails',
      state: state([
        post('p1', {
          text: 'see https://e.com/b',
          card: {
            url: 'https://e.com/b',
            title: 'T',
            description: 'D',
            thumb: 'https://img.e.com/x.png',
          },
        }),
      ]),
      script: { card: { image: 'missing' } },
    },
    {
      $id: 'card-thumbnail-kept',
      state: state([
        post('p1', {
          text: 'see',
          card: {
            url: 'https://e.com',
            title: 'T',
            thumb: 'https://img.e.com/x.png',
            thumbBlob: imageBlob('thumb'),
            thumbBlobDid: ME,
          },
        }),
      ]),
    },
    {
      $id: 'card-without-image',
      state: state([
        post('p1', { text: 'see', card: { url: 'https://e.com', title: 'T' } }),
      ]),
    },
    {
      $id: 'card-under-images',
      state: state([
        post('p1', {
          text: 'see',
          card: { url: 'https://e.com', thumb: 'https://img.e.com/x.png' },
          images: [img('i', { file: file('a.jpg', 'image/jpeg', 2) })],
        }),
      ]),
    },
    {
      $id: 'quote-with-media',
      state: state([
        post('p1', {
          text: 'q',
          record: {
            kind: 'post',
            uri: 'at://did:plc:q/app.bsky.feed.post/1',
            cid: 'bafyq',
          },
          images: [img('i', { file: file('a.jpg', 'image/jpeg', 2) })],
        }),
      ]),
    },
    { $id: 'invalid', state: state([post('p1', { text: '' })]) },
    {
      $id: 'wrong-account',
      state: state([post('p1', { text: 'x' })]),
      target: 'other',
    },
    {
      $id: 'no-target',
      state: state([post('p1', { text: 'x' })]),
      target: 'none',
    },
    {
      $id: 'no-account-on-state',
      state: { ...state([post('p1', { text: 'x' })]), asDid: '' },
    },
    {
      $id: 'labels-langs-tags',
      state: thread(2, {
        tags: ['news', '#Two words'],
        labels: ['nudity'],
        langs: ['en', 'pt-BR'],
      }),
    },
  ];
  all.push(...(await each('publish', flows, (input) => publishCase(m, input))));

  // The duplicate guard across publishes: a failure isn't remembered, a
  // success is, for two minutes.
  all.push(
    ...(await each(
      'publishTwice',
      [
        {
          $id: 'duplicate-guard',
          state: state([post('p1', { text: 'same' })]),
          steps: [0, 0, 0, 120000],
          writes: ['fail:400:nope', 'ok', 'ok'],
        },
      ],
      async ({ state: s, steps, writes }) => {
        const server = pds({ writes });
        let t = 0;
        const guard = m.createDuplicateGuard({ now: () => t });
        resetTids();
        const out = await withFixedDate(NOW, () =>
          recordFetch(
            server.responder,
            () =>
              withTimers([], async () => {
                const agent = await agentFor(ME);
                const results = [];
                for (const at of steps) {
                  t = at;
                  try {
                    const r = await m.publish(
                      s,
                      { did: ME, agent, pdsUrl: 'https://pds.example.com' },
                      {
                        now: () => new Date(NOW),
                        duplicateGuard: guard,
                        resolveMention: async () => null,
                      },
                    );
                    results.push({ ok: r.root });
                  } catch (error) {
                    results.push({ code: error.code, message: error.message });
                  }
                }
                return results;
              }),
            { now: NOW },
          ),
        );
        return hangs(out, server);
      },
    )),
  );

  return all;
}
