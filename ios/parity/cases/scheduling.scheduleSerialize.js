// src/posting/schedule/scheduleSerialize.js: the composer's state as Virga's
// server's scheduling body (serializeForSchedule), a scheduled row back as
// composer state (reconstructFromScheduled), the two in a round trip, and
// the base64 both carry images in (blobToBase64, base64ToFile). Swift:
// VirgaPosting/Schedule/ScheduleSerialize.swift and
// ScheduleSerialize+Reconstruct.swift.
//
// Inputs from scheduleSerialize.test.js, every flow and refusal it has, plus
// loose rows and stored media (bad base64, odd encodings), replies with long
// and emoji text, repeats in several zones and timers said against the
// case's clock.
//
// Files. A state's file is a marker (_composer.js) whose `ref`, when it is
// `bytes:<base64>`, names its bytes (else they are `size` zeros); the Swift
// test holds the same bytes under the same ref. A made file's lastModified
// is the machine's clock in Node's File, so it is left out of every result,
// as each File's `ref` is on the Swift side. A long base64 string is
// recorded as its length and SHA-256. The card image's re-encode is
// scripted (_publish.js scriptedImages) and its calls recorded.
// URL.createObjectURL is a counter ('blob:preview-1', …), absent, or throws,
// as the case says (`previews`).

import crypto from 'node:crypto';
import {
  MAX_IMAGE_BYTES,
  MAX_MEDIA_BASE64_CHARS,
  base64ToFile,
  blobToBase64,
  reconstructFromScheduled,
  serializeForSchedule,
} from '../../../src/posting/schedule/scheduleSerialize.js';
import { DEFAULT_LOCALE, setActiveLocale } from '../../../src/lib/locale.js';
import { each, toJSON, value, withTimeZone } from './_helpers.js';
import { canonIds, markFiles } from './_composer.js';
import { scriptedImages } from './_publish.js';

export const sources = ['src/posting/schedule/scheduleSerialize.js'];

const DID = 'did:plc:writer';
const NOW = Date.parse('2026-09-01T12:00:00.000Z');
const AT = '2026-09-01T17:00:00.000Z';
const QUOTED = 'at://did:plc:other/app.bsky.feed.post/3kquoted';
const MENTIONS = { 'friend.example.com': 'did:plc:friend' };

// ---- files ----------------------------------------------------------------

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const bytesOf = (text) => new TextEncoder().encode(text);

/** A file marker whose bytes are `bytes` (a string or a Uint8Array). */
function file(bytes = 'image-bytes', type = 'image/jpeg', name = 'photo.jpg') {
  const data = typeof bytes === 'string' ? bytesOf(bytes) : bytes;
  return {
    $file: true,
    name,
    type,
    size: data.length,
    lastModified: 0,
    ref: `bytes:${b64(data)}`,
  };
}

/** A file marker of `size` zeros. */
const zeros = (size, type = 'image/jpeg', name = 'big.jpg') => ({
  $file: true,
  name,
  type,
  size,
  lastModified: 0,
});

/** `value` with every marker a real File (its `ref` bytes, else zeros). */
function withFiles(v) {
  if (v instanceof Blob) return v;
  if (v && typeof v === 'object' && !Array.isArray(v) && v.$file === true) {
    const data =
      typeof v.ref === 'string' && v.ref.startsWith('bytes:')
        ? Buffer.from(v.ref.slice(6), 'base64')
        : new Uint8Array(Number(v.size) || 0);
    return new File([data], v.name, {
      type: v.type || '',
      lastModified: v.lastModified ?? 0,
    });
  }
  if (Array.isArray(v)) return v.map(withFiles);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = withFiles(x);
    return out;
  }
  return v;
}

/** A result as a fixture holds it: files as markers without lastModified, long base64 digested. */
function settle(v) {
  const marked = toJSON(markFiles(v));
  const walk = (x, key) => {
    if (typeof x === 'string' && key === 'base64' && x.length > 512) {
      return {
        $length: x.length,
        $sha256: crypto.createHash('sha256').update(x).digest('hex'),
      };
    }
    if (Array.isArray(x)) return x.map((y) => walk(y));
    if (x && typeof x === 'object') {
      const out = {};
      for (const [k, y] of Object.entries(x)) {
        if (x.$file === true && k === 'lastModified') continue;
        out[k] = walk(y, k);
      }
      return out;
    }
    return x;
  };
  return walk(marked);
}

// ---- the clock, the zone, the previews ------------------------------------------

/** Runs `fn` in `tz`, en-US active, Date.now() at NOW, previews as asked. */
async function under(tz, previews, fn) {
  return withTimeZone(tz, async () => {
    setActiveLocale('en-US');
    const realNow = Date.now;
    const realCreate = URL.createObjectURL;
    let n = 0;
    Date.now = () => NOW;
    if (previews === 'count') URL.createObjectURL = () => `blob:preview-${++n}`;
    else if (previews === 'throw')
      URL.createObjectURL = () => {
        throw new Error('no previews');
      };
    else URL.createObjectURL = undefined;
    try {
      return await fn();
    } finally {
      Date.now = realNow;
      URL.createObjectURL = realCreate;
      setActiveLocale(DEFAULT_LOCALE);
    }
  });
}

// ---- states -------------------------------------------------------------------

let idCount = 0;
const post = (fields = {}) => ({
  id: `p${++idCount}`,
  text: '',
  images: [],
  video: null,
  record: null,
  card: null,
  ...fields,
});
const image = (fields = {}) => ({
  id: `i${++idCount}`,
  file: file(),
  mime: 'image/jpeg',
  size: 11,
  alt: 'a lamp',
  aspectRatio: { width: 400, height: 300 },
  ...fields,
});

function state(patch = {}, posts = [{ text: 'hello' }]) {
  return {
    posts: posts.map((p) => post(p)),
    reply: null,
    tags: [],
    langs: [],
    labels: [],
    gates: { custom: false, reply: null, quotes: true },
    asDid: DID,
    schedule: null,
    lifespan: { enabled: false },
    source: null,
    ...patch,
  };
}

const REPLY = {
  uri: 'at://did:plc:alice/app.bsky.feed.post/3kparent',
  cid: 'bafyparent',
  root: {
    uri: 'at://did:plc:alice/app.bsky.feed.post/3kroot',
    cid: 'bafyroot',
  },
  author: {
    did: 'did:plc:alice',
    handle: 'alice.example.com',
    displayName: 'Alice',
  },
  text: '  What do you think of the new porch?  ',
};

const CARD = {
  url: 'https://example.com/post',
  title: 'T',
  description: 'D',
  thumb: 'https://cardyb.bsky.app/v1/image?url=x',
  associatedRefs: [
    { uri: 'at://did:plc:pub/site.standard.document/1', cid: 'bafydoc' },
  ],
};

const RULE = { enabled: true, lifespanSeconds: 3600 };

// [id, state, options] — options as the case gives them; `tz` is the device's
// zone, `previews` the object URLs, `images` the card image script,
// `loadImage` a table of localRef → file | 'throw'.
const serializeCases = [
  ['plain', state(), {}],
  [
    'time-from-the-state',
    state({ schedule: { mode: 'at', at: '2026-09-01T13:30:00-04:00' } }),
    { scheduledFor: null, tz: null },
  ],
  ['queued-by-mode', state({ schedule: { mode: 'queue' } }), {}],
  ['queued-forced', state(), { queued: true }],
  [
    'not-queued-forced',
    state({ schedule: { mode: 'queue' } }),
    { queued: false },
  ],
  ...['UTC', 'America/New_York', 'Asia/Kolkata', 'Pacific/Chatham'].map(
    (zone) => [`device-zone-${zone}`, state(), { tz: null, device: zone }],
  ),
  ['empty-tz-is-the-device', state(), { tz: '', device: 'Europe/London' }],
  [
    'thread-langs-labels-tags',
    state(
      {
        langs: ['en', 'de'],
        labels: ['nudity', 'graphic-media', 'bogus'],
        tags: ['porch', 'Lamp', 'porch'],
      },
      [{ text: 'one' }, { text: 'two' }, { text: 'three' }],
    ),
    {},
  ],
  [
    'mentions-and-links',
    state({}, [
      {
        text: 'hey @friend.example.com and @nobody.example.com see https://example.com/a/very/long/path/that/gets/shortened/for/the/post?q=1 #porch',
      },
    ]),
    {},
  ],
  [
    'inline-link',
    state({}, [{ text: 'read [the post](https://example.com/story) now' }]),
    {},
  ],
  [
    'gates',
    state({
      gates: {
        custom: true,
        reply: [
          { type: 'mention' },
          { type: 'following' },
          { type: 'list', list: 'at://did:plc:writer/app.bsky.graph.list/3kl' },
        ],
        quotes: false,
      },
    }),
    {},
  ],
  [
    'nobody-can-reply',
    state({ gates: { custom: true, reply: [], quotes: true } }),
    {},
  ],
  [
    'images',
    state({}, [
      {
        text: 'two photos',
        images: [
          image(),
          image({
            alt: '',
            aspectRatio: undefined,
            file: file('png', 'image/png'),
          }),
        ],
      },
      { text: 'and one more', images: [image({ alt: 'the porch' })] },
    ]),
    {},
  ],
  [
    'image-type-from-mime',
    state({}, [
      {
        text: 'x',
        images: [image({ file: file('raw', ''), mime: 'image/webp' })],
      },
    ]),
    {},
  ],
  [
    'image-type-default',
    state({}, [
      { text: 'x', images: [image({ file: file('raw', ''), mime: '' })] },
    ]),
    {},
  ],
  [
    'image-bytes-all-values',
    state({}, [
      {
        text: '',
        images: [
          image({
            file: file(
              Uint8Array.from({ length: 256 }, (_, i) => i),
              'image/png',
            ),
          }),
        ],
      },
    ]),
    {},
  ],
  [
    'load-image',
    state({}, [
      { text: '', images: [image({ file: undefined, localRef: 'ref-1' })] },
    ]),
    { loadImage: { 'ref-1': file('from-device') } },
  ],
  [
    'load-image-none',
    state({}, [
      { text: 'x', images: [image({ file: undefined, localRef: 'ref-2' })] },
    ]),
    { loadImage: { 'ref-1': file('from-device') } },
  ],
  [
    'load-image-throws',
    state({}, [
      { text: 'x', images: [image({ file: undefined, localRef: 'ref-1' })] },
    ]),
    { loadImage: { 'ref-1': 'throw' } },
  ],
  [
    'image-missing',
    state({}, [
      { text: 'a', images: [image({ file: undefined, blob: { ref: 'x' } })] },
    ]),
    {},
  ],
  [
    'image-missing-second-post',
    state({}, [
      { text: 'a' },
      { text: 'b', images: [image(), image({ id: 'gone', file: null })] },
    ]),
    {},
  ],
  [
    'image-too-large',
    state({}, [
      { text: 'a', images: [image({ file: zeros(MAX_IMAGE_BYTES + 1) })] },
    ]),
    {},
  ],
  [
    'image-at-the-limit',
    state({}, [
      { text: 'a', images: [image({ file: zeros(MAX_IMAGE_BYTES) })] },
    ]),
    {},
  ],
  [
    'too-many-images',
    state({}, [
      { text: 'a', images: [image(), image(), image(), image(), image()] },
    ]),
    {},
  ],
  [
    'media-too-large',
    state({}, [
      {
        text: 'a',
        images: [
          image({ file: zeros(1_600_000) }),
          image({ file: zeros(1_600_000) }),
        ],
      },
    ]),
    {},
  ],
  [
    'media-up-to-the-limit',
    state({}, [
      {
        text: 'a',
        images: [
          image({ file: zeros(1_400_000) }),
          image({ file: zeros(1_400_000) }),
        ],
      },
    ]),
    {},
  ],
  [
    'quote',
    state({}, [
      {
        text: 'this',
        record: { kind: 'post', uri: QUOTED, cid: 'bafyquoted' },
      },
    ]),
    {},
  ],
  [
    'quote-with-images',
    state({}, [
      {
        text: 'this, and a photo',
        record: { kind: 'post', uri: QUOTED, cid: 'bafyquoted' },
        images: [image()],
      },
    ]),
    {},
  ],
  [
    'quote-with-card',
    state({}, [
      {
        text: 'both',
        record: { kind: 'post', uri: QUOTED, cid: 'bafyquoted' },
        card: CARD,
      },
    ]),
    {},
  ],
  [
    'record-unresolved',
    state({}, [{ text: 'q', record: { kind: 'post', uri: QUOTED } }]),
    {},
  ],
  ['card-with-thumb-url', state({}, [{ text: 'a link', card: CARD }]), {}],
  [
    'card-http-thumb',
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
    {},
  ],
  [
    'card-bad-thumb',
    state({}, [
      {
        text: 'a link',
        card: {
          url: 'https://example.com',
          title: 'x',
          description: 'y',
          thumb: 'https://',
        },
      },
    ]),
    {},
  ],
  [
    'card-own-image',
    state({}, [
      {
        text: 'a link',
        card: {
          url: 'https://example.com',
          title: 'T',
          description: '',
          thumb: 'https://example.com/page.jpg',
          thumbFile: file('raw-thumb'),
        },
      },
    ]),
    { images: { compress: { size: 11 }, decode: null } },
  ],
  [
    'card-own-image-big',
    state({}, [
      {
        text: 'a link',
        card: {
          url: 'https://example.com',
          title: 'T',
          description: '',
          thumb: null,
          thumbFile: zeros(3_000_000, 'image/png', 'huge.png'),
        },
      },
    ]),
    {
      images: {
        compress: { size: 900_000 },
        decode: { width: 1200, height: 630 },
      },
    },
  ],
  [
    'card-own-image-fails',
    state({}, [
      {
        text: 'a link',
        card: {
          url: 'https://example.com',
          title: 'T',
          description: '',
          thumb: null,
          thumbFile: file(),
        },
      },
    ]),
    { images: { compress: 'throw' } },
  ],
  [
    'card-own-image-empty',
    state({}, [
      {
        text: 'a link',
        card: {
          url: 'https://example.com',
          title: 'T',
          description: '',
          thumb: 'https://example.com/t.jpg',
          thumbFile: file(),
        },
      },
    ]),
    { images: { compress: null } },
  ],
  [
    'card-own-image-still-too-large',
    state({}, [
      {
        text: 'a link',
        card: {
          url: 'https://example.com',
          title: 'T',
          description: '',
          thumb: null,
          thumbFile: file(),
        },
      },
    ]),
    { images: { compress: { size: 2_000_000 } } },
  ],
  [
    'card-own-file-not-an-image',
    state({}, [
      {
        text: 'a link',
        card: {
          url: 'https://example.com',
          title: 'T',
          description: '',
          thumb: null,
          thumbFile: file('x', 'text/plain', 'notes.txt'),
        },
      },
    ]),
    { images: {} },
  ],
  [
    'card-behind-images',
    state({}, [
      { text: 'both', images: [image()], card: { ...CARD, thumbFile: file() } },
    ]),
    { images: {} },
  ],
  [
    'card-only-no-text',
    state({}, [
      {
        text: '',
        card: { url: 'https://example.com', title: '', description: '' },
      },
    ]),
    {},
  ],
  ['reply-in-queue', state({ reply: REPLY }), { queued: true }],
  ['reply-unresolved', state({ reply: { ...REPLY, cid: undefined } }), {}],
  [
    'video',
    state({}, [{ text: 'v', video: { status: 'ready', blob: { ref: 'x' } } }]),
    {},
  ],
  ['no-time', state(), { scheduledFor: null }],
  ['bad-time', state(), { scheduledFor: 'whenever' }],
  ['past', state(), { scheduledFor: '2026-09-01T11:59:00.000Z' }],
  ['now-exactly', state(), { scheduledFor: '2026-09-01T12:00:00.000Z' }],
  ['too-far', state(), { scheduledFor: '2026-12-01T12:00:00.001Z' }],
  ['at-the-horizon', state(), { scheduledFor: '2026-11-30T12:00:00.000Z' }],
  [
    'offset-less-time',
    state(),
    { scheduledFor: '2026-09-01T20:00', device: 'Asia/Kolkata' },
  ],
  ['number-time', state(), { scheduledFor: 20260902 }],
  ['empty', state({}, [{ text: '   ' }]), {}],
  ['empty-second-post', state({}, [{ text: 'one' }, { text: '' }]), {}],
  [
    'timer-off',
    state({ lifespan: { enabled: false, lifespanSeconds: 3600 } }),
    {},
  ],
  ['timer-rule', state({ lifespan: RULE }), {}],
  [
    'timer-with-conditions',
    state({
      lifespan: {
        enabled: true,
        lifespanSeconds: 86400,
        conditions: {
          logic: 'any',
          clauses: [{ metric: 'likes', op: 'lt', value: 10 }],
          sense: 'keepIf',
          onSpare: 'extend',
          maxExtensions: 2,
        },
        effects: [
          { action: 'limitReplies', allow: ['follower'] },
          { action: 'delete' },
        ],
      },
    }),
    {},
  ],
  [
    'timer-pinned',
    state({
      lifespan: {
        enabled: true,
        lifespanSeconds: 3600,
        deleteAt: '2026-09-02T17:00:00.000Z',
      },
    }),
    {},
  ],
  [
    'timer-pinned-before',
    state({
      lifespan: {
        enabled: true,
        lifespanSeconds: 3600,
        deleteAt: '2026-09-01T16:00:00.000Z',
      },
    }),
    {},
  ],
  [
    'timer-pinned-local',
    state({
      lifespan: {
        enabled: true,
        lifespanSeconds: 3600,
        deleteAt: '2026-09-01T16:00',
      },
    }),
    { device: 'America/New_York' },
  ],
  ['reply', state({ reply: REPLY }), {}],
  ['reply-without-root', state({ reply: { ...REPLY, root: undefined } }), {}],
  [
    'reply-long-text',
    state({
      reply: {
        ...REPLY,
        author: { handle: '' },
        text: `${'x'.repeat(299)}😀 and the rest`,
      },
    }),
    {},
  ],
  [
    'reply-knows-nothing',
    state({ reply: { uri: REPLY.uri, cid: REPLY.cid } }),
    {},
  ],
  [
    'reply-gates-ignored',
    state({ reply: REPLY, gates: { custom: true, reply: [], quotes: false } }),
    {},
  ],
  [
    'reply-timer-fit',
    state({
      reply: REPLY,
      lifespan: {
        enabled: true,
        lifespanSeconds: 3600,
        effects: [
          { action: 'limitReplies', allow: ['follower'] },
          { action: 'delete' },
        ],
      },
    }),
    {},
  ],
  [
    'repeat-with-zone',
    state({
      schedule: { mode: 'at', at: AT, repeat: { every: 'week', count: 4 } },
    }),
    { scheduledFor: null, repeatTz: 'Europe/Paris' },
  ],
  [
    'repeat-device-zone',
    state({ schedule: { mode: 'at', at: AT, repeat: { every: 'day' } } }),
    { scheduledFor: null, tz: null, device: 'Asia/Kolkata' },
  ],
  [
    'repeat-option-wins',
    state({ schedule: { mode: 'at', at: AT, repeat: { every: 'day' } } }),
    { repeat: { every: 'month', until: '2027-01-01' } },
  ],
  [
    'repeat-option-null',
    state({ schedule: { mode: 'at', at: AT, repeat: { every: 'day' } } }),
    { repeat: null },
  ],
  [
    'repeat-queued',
    state({ schedule: { mode: 'queue' } }),
    { repeat: { every: 'week' } },
  ],
  ['repeat-reply', state({ reply: REPLY }), { repeat: { every: 'week' } }],
  ['repeat-bad', state(), { repeat: { every: 'fortnight' } }],
  [
    'repeat-count-one',
    state(),
    { repeat: { every: 'week', count: 1, ends: 'after' } },
  ],
  ['repeat-half-filled', state(), { repeat: { every: 'week', ends: 'on' } }],
  [
    'repeat-ends-before',
    state(),
    { repeat: { every: 'week', until: '2026-08-01', ends: 'on' } },
  ],
  [
    'repeat-occurrence',
    state(),
    { repeat: { every: 'week', count: 3, ends: 'after' }, occurrence: 4 },
  ],
  [
    'repeat-occurrence-ok',
    state(),
    { repeat: { every: 'week', count: 3, ends: 'after' }, occurrence: 2 },
  ],
  ['state-null', null, {}],
  ['posts-not-a-list', { posts: 'hello', asDid: DID }, {}],
  [
    'card-url-not-a-string',
    state({}, [{ text: 'x', card: { url: 5, title: 'T' } }]),
    {},
  ],
];

/** A refusal as a case records it: its message, code and extra members. */
function refusal(err) {
  const out = { name: err?.name ?? null, message: err?.message ?? null };
  for (const key of ['code', 'postIndex', 'imageId', 'size', 'limit'])
    if (err?.[key] !== undefined) out[key] = err[key];
  return { $error: out };
}

/** serializeForSchedule as the case says, its card images scripted. */
async function serialize(input) {
  const { state: s, options: o = {} } = input;
  const script = o.images ? scriptedImages(o.images, markFiles) : null;
  const options = {
    now: new Date(NOW),
    scheduledFor: AT,
    tz: 'America/New_York',
    resolveMention: async (handle) => MENTIONS[handle] ?? null,
  };
  for (const key of [
    'scheduledFor',
    'tz',
    'queued',
    'repeat',
    'repeatTz',
    'occurrence',
  ])
    if (key in o) options[key] = o[key];
  if (script) {
    options.compress = script.compress;
    options.decode = script.decode;
  }
  if (o.loadImage) {
    options.loadImage = async (img) => {
      const found = o.loadImage[img.localRef];
      if (found === 'throw') throw new Error('the device lost it');
      return found ? withFiles(found) : null;
    };
  }
  const body = await serializeForSchedule(withFiles(s), options);
  return { body, warnings: body.warnings, calls: script ? script.calls : [] };
}

// ---- rows ---------------------------------------------------------------------

const RECORD = (text, extra = {}) => ({ record: { text, ...extra } });
const LINK_FACET = (byteStart, byteEnd, uri) => ({
  index: { byteStart, byteEnd },
  features: [{ $type: 'app.bsky.richtext.facet#link', uri }],
});
const PNG = b64(Uint8Array.from([137, 80, 78, 71, 0, 1, 2, 250, 255]));

const rows = [
  [
    'thread',
    {
      id: 'r1',
      scheduledFor: '2026-09-01T17:00:00+00:00',
      payload: { posts: [RECORD('one'), RECORD('two'), RECORD('three')] },
    },
  ],
  [
    'inline-links',
    {
      id: 'r2',
      scheduledFor: AT,
      payload: {
        posts: [
          RECORD('read the post now', {
            facets: [LINK_FACET(5, 13, 'https://example.com/story')],
          }),
          RECORD('see example.com/a/very…', {
            facets: [
              LINK_FACET(
                4,
                25,
                'https://example.com/a/very/long/path/that/gets/shortened',
              ),
            ],
          }),
        ],
      },
    },
  ],
  [
    'embed-on-a-later-post',
    {
      id: 'r3',
      scheduledFor: AT,
      payload: {
        posts: [
          RECORD('one'),
          {
            ...RECORD('two'),
            embed: { type: 'record', uri: QUOTED, cid: 'bafyquoted' },
          },
        ],
      },
    },
  ],
  [
    'feed-and-list',
    {
      id: 'r4',
      scheduledFor: AT,
      payload: {
        posts: [
          {
            ...RECORD('a feed'),
            embed: {
              type: 'record',
              uri: 'at://did:plc:x/app.bsky.feed.generator/hot',
              cid: 'c1',
            },
          },
          {
            ...RECORD('a list'),
            embed: {
              type: 'record',
              uri: 'at://did:plc:x/app.bsky.graph.list/3kl',
              cid: 'c2',
            },
          },
          {
            ...RECORD('a pack'),
            embed: {
              type: 'record',
              uri: 'at://did:plc:x/app.bsky.graph.starterpack/3kp',
              cid: 'c3',
            },
          },
          {
            ...RECORD('odd'),
            embed: {
              type: 'record',
              uri: 'at://did:plc:x/com.example.thing/1',
              cid: 'c4',
            },
          },
          { ...RECORD('no cid'), embed: { type: 'record', uri: QUOTED } },
        ],
      },
    },
  ],
  [
    'record-with-media',
    {
      id: 'r5',
      scheduledFor: AT,
      payload: {
        posts: [
          {
            ...RECORD('this, and a photo'),
            embed: {
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
            },
          },
          {
            ...RECORD('this, and a link'),
            embed: {
              type: 'recordWithMedia',
              uri: QUOTED,
              cid: 'bafyquoted',
              media: {
                type: 'external',
                uri: 'https://example.com',
                title: 'T',
                description: 'D',
                thumbUrl: 'https://example.com/t.jpg',
              },
            },
          },
        ],
      },
    },
    { 'p0-img0': { base64: PNG, encoding: 'image/png' } },
  ],
  [
    'card-with-page-image',
    {
      id: 'r6',
      scheduledFor: AT,
      payload: {
        posts: [
          {
            ...RECORD('a link'),
            embed: {
              type: 'external',
              uri: 'https://example.com/post',
              title: 'T',
              description: 'D',
              thumbUrl: 'https://cardyb.bsky.app/v1/image?url=x',
              associatedRefs: [
                {
                  uri: 'at://did:plc:pub/site.standard.document/1',
                  cid: 'bafydoc',
                },
                { uri: 'not-at', cid: 'x' },
              ],
            },
          },
        ],
      },
    },
  ],
  [
    'card-with-own-image',
    {
      id: 'r7',
      queued: true,
      scheduledFor: AT,
      payload: {
        posts: [
          {
            ...RECORD('a link'),
            embed: {
              type: 'external',
              uri: 'https://example.com',
              title: 'T',
              description: '',
              thumbMediaId: 'p0-thumb',
              thumbUrl: 'https://example.com/ignored.jpg',
            },
          },
        ],
      },
    },
    {
      'p0-thumb': {
        base64: b64(bytesOf('small-thumb')),
        encoding: 'image/jpeg',
      },
    },
  ],
  [
    'card-own-image-gone',
    {
      id: 'r8',
      scheduledFor: AT,
      payload: {
        posts: [
          {
            ...RECORD('a link'),
            embed: {
              type: 'external',
              uri: 'https://example.com',
              thumbMediaId: 'p0-thumb',
            },
          },
        ],
      },
    },
    {},
  ],
  [
    'images-gone',
    {
      id: 'r9',
      scheduledFor: AT,
      payload: {
        posts: [
          {
            ...RECORD(''),
            embed: {
              type: 'images',
              images: [
                { mediaId: 'p0-img0', alt: 'kept' },
                {
                  mediaId: 'p0-img1',
                  alt: 'gone',
                  aspectRatio: { width: 0, height: 10 },
                },
                {
                  mediaId: 'p0-img2',
                  alt: 5,
                  aspectRatio: { width: '3', height: '2' },
                },
              ],
            },
          },
        ],
      },
    },
    {
      'p0-img0': { base64: PNG, encoding: 'image/png' },
      'p0-img1': { encoding: 'image/webp' },
      'p0-img2': { base64: '', encoding: 'image/gif' },
    },
  ],
  [
    'encodings',
    {
      id: 'r10',
      scheduledFor: AT,
      payload: {
        posts: [
          {
            ...RECORD('odd types'),
            embed: {
              type: 'images',
              images: ['a', 'b', 'c', 'd', 'e', 'f'].map((k) => ({
                mediaId: k,
                alt: k,
              })),
            },
          },
        ],
      },
    },
    {
      a: { base64: PNG, encoding: 'image/PNG' },
      b: { base64: PNG, encoding: 'image/svg+xml' },
      c: { base64: PNG, encoding: '' },
      d: { base64: PNG, encoding: 'image/pngé' },
      e: { base64: PNG, encoding: 5 },
      f: { base64: ' iVBO Rw0K\nGgo= ', encoding: 'a/b/c' },
    },
  ],
  [
    'bad-base64',
    {
      id: 'r11',
      scheduledFor: AT,
      payload: {
        posts: [
          {
            ...RECORD(''),
            embed: { type: 'images', images: [{ mediaId: 'x' }] },
          },
        ],
      },
    },
    { x: { base64: 'abcde', encoding: 'image/png' } },
  ],
  [
    'bad-base64-character',
    {
      id: 'r12',
      scheduledFor: AT,
      payload: {
        posts: [
          {
            ...RECORD(''),
            embed: { type: 'images', images: [{ mediaId: 'x' }] },
          },
        ],
      },
    },
    { x: { base64: 'YQ=a', encoding: 'image/png' } },
  ],
  [
    'source-and-client',
    {
      id: 'r13',
      clientKey: 'other-app',
      scheduledFor: AT,
      payload: { posts: [RECORD('hi')] },
    },
  ],
  [
    'empty-client-key',
    {
      id: 'r14',
      clientKey: '',
      scheduledFor: AT,
      payload: { posts: [RECORD('hi')] },
    },
  ],
  [
    'queued',
    {
      id: 'r15',
      queued: true,
      scheduledFor: AT,
      payload: { posts: [RECORD('hi')], repeat: { every: 'week' } },
    },
  ],
  [
    'snake-case-time',
    {
      id: 'r16',
      scheduled_for: '2026-09-01 17:00:00+00',
      payload: { posts: [RECORD('hi')] },
    },
  ],
  [
    'offset-less-time',
    {
      id: 'r17',
      scheduledFor: '2026-09-01T17:00',
      payload: { posts: [RECORD('hi')] },
    },
  ],
  [
    'bad-time',
    { id: 'r18', scheduledFor: 'whenever', payload: { posts: [RECORD('hi')] } },
  ],
  ['no-time', { id: 'r19', payload: { posts: [RECORD('hi')] } }],
  [
    'langs-labels-tags-gates',
    {
      id: 'r20',
      scheduledFor: AT,
      payload: {
        posts: [
          RECORD('root', {
            langs: ['en', 'fr'],
            labels: {
              $type: 'com.atproto.label.defs#selfLabels',
              values: [{ val: 'nudity' }, { val: 'bogus' }],
            },
            tags: ['porch', 'lamp'],
          }),
          RECORD('child', { langs: ['de'] }),
        ],
        gates: {
          threadgate: [
            { $type: 'app.bsky.feed.threadgate#mentionRule' },
            {
              $type: 'app.bsky.feed.threadgate#listRule',
              list: 'at://did:plc:writer/app.bsky.graph.list/3kl',
            },
          ],
          postgate: [{ $type: 'app.bsky.feed.postgate#disableRule' }],
        },
      },
    },
  ],
  [
    'nobody-can-reply',
    {
      id: 'r21',
      scheduledFor: AT,
      payload: {
        posts: [RECORD('x')],
        gates: { threadgate: [], postgate: null },
      },
    },
  ],
  [
    'everyone',
    {
      id: 'r22',
      scheduledFor: AT,
      payload: {
        posts: [RECORD('x')],
        gates: { threadgate: null, postgate: [] },
      },
    },
  ],
  ['no-payload', { id: 'r23', scheduledFor: AT }],
  ['nothing', null],
  ['empty-posts', { id: 'r24', payload: { posts: [] } }],
  [
    'timer',
    {
      id: 'r25',
      scheduledFor: AT,
      payload: {
        posts: [RECORD('x')],
        selfDestruct: {
          lifespanSeconds: 7200,
          conditions: {
            logic: 'any',
            clauses: [{ metric: 'likes', op: 'lt', value: 10 }],
            sense: 'keepIf',
            onSpare: 'extend',
            maxExtensions: 1,
          },
          effects: [{ action: 'delete' }],
          deleteAt: '2026-09-03T17:00:00.000Z',
        },
      },
    },
  ],
  [
    'timer-unreadable',
    {
      id: 'r26',
      scheduledFor: AT,
      payload: {
        posts: [RECORD('x')],
        selfDestruct: {
          lifespanSeconds: 3600,
          effects: [{ action: 'explode' }],
          conditions: {},
        },
      },
    },
  ],
  [
    'reply',
    {
      id: 'r27',
      scheduledFor: AT,
      payload: {
        posts: [RECORD('agreed')],
        reply: {
          root: { uri: REPLY.root.uri, cid: REPLY.root.cid },
          parent: { uri: REPLY.uri, cid: REPLY.cid },
        },
        replyTo: {
          handle: 'alice.example.com',
          displayName: 'Alice',
          text: 'What do you think?',
        },
      },
    },
  ],
  [
    'reply-without-root-or-hint',
    {
      id: 'r28',
      scheduledFor: AT,
      payload: {
        posts: [RECORD('agreed')],
        reply: { parent: { uri: REPLY.uri, cid: REPLY.cid } },
        replyTo: 'not an object',
      },
    },
  ],
  [
    'reply-hint-text-only',
    {
      id: 'r29',
      scheduledFor: AT,
      payload: {
        posts: [RECORD('agreed')],
        reply: { parent: { uri: 'not-a-uri', cid: 'c' } },
        replyTo: { text: 'hm', handle: '' },
      },
    },
  ],
  [
    'reply-no-cid',
    {
      id: 'r30',
      scheduledFor: AT,
      payload: { posts: [RECORD('x')], reply: { parent: { uri: REPLY.uri } } },
    },
  ],
  [
    'repeating',
    {
      id: 'r31',
      scheduledFor: AT,
      payload: {
        posts: [RECORD('weekly')],
        repeat: { every: '2weeks', until: '2026-12-01', tz: 'Europe/Paris' },
      },
    },
  ],
  [
    'repeating-bad',
    {
      id: 'r32',
      scheduledFor: AT,
      payload: { posts: [RECORD('weekly')], repeat: { every: 'year' } },
    },
  ],
  [
    'odd-specs',
    {
      id: 'r33',
      scheduledFor: AT,
      payload: {
        posts: [
          {},
          { record: { text: 'no embed type' }, embed: { uri: 'x' } },
          { record: { text: 'embed a string' }, embed: 'images' },
          { record: { text: 5 } },
          { embed: { type: 'external', title: 'no uri' } },
        ],
      },
    },
  ],
];

const PREVIEWS = ['count', 'none', 'throw'];

const reconstructInputs = [];
for (const [id, row, media] of rows) {
  reconstructInputs.push({
    $id: id,
    row,
    ...(media === undefined ? {} : { media }),
    asDid: DID,
    tz: 'UTC',
    previews: 'count',
  });
}
for (const previews of PREVIEWS.slice(1))
  reconstructInputs.push({
    $id: `previews-${previews}`,
    row: rows[4][1],
    media: rows[4][2],
    asDid: DID,
    tz: 'UTC',
    previews,
  });
for (const tz of ['America/New_York', 'Asia/Kolkata'])
  reconstructInputs.push({
    $id: `offset-less-${tz}`,
    row: rows[16][1],
    asDid: DID,
    tz,
    previews: 'count',
  });
reconstructInputs.push({
  $id: 'no-did',
  row: rows[0][1],
  tz: 'UTC',
  previews: 'count',
});
reconstructInputs.push({
  $id: 'media-null',
  row: rows[4][1],
  media: null,
  asDid: DID,
  tz: 'UTC',
  previews: 'count',
});

// ---- round trips ------------------------------------------------------------------

const roundTrips = [
  [
    'thread-with-everything',
    state(
      {
        langs: ['en'],
        labels: ['graphic-media'],
        tags: ['porch'],
        gates: { custom: true, reply: [{ type: 'following' }], quotes: false },
        lifespan: {
          enabled: true,
          lifespanSeconds: 7200,
          effects: [{ action: 'delete' }],
        },
      },
      [
        {
          text: 'read [the post](https://example.com/story) @friend.example.com',
          images: [image(), image({ alt: '' })],
        },
        {
          text: 'and a quote',
          record: { kind: 'post', uri: QUOTED, cid: 'bafyquoted' },
        },
        {
          text: 'and a link https://example.com/a/very/long/path/that/gets/shortened',
          card: CARD,
        },
      ],
    ),
    {},
  ],
  [
    'queued-with-own-card-image',
    state({ schedule: { mode: 'queue' } }, [
      {
        text: 'a link',
        card: {
          url: 'https://example.com',
          title: 'T',
          description: '',
          thumb: null,
          thumbFile: file('raw-thumb'),
        },
      },
    ]),
    { images: { compress: { size: 11 } } },
  ],
  [
    'nobody-can-reply',
    state({ gates: { custom: true, reply: [], quotes: true } }),
    {},
  ],
  ['reply', state({ reply: REPLY }), {}],
  [
    'repeating',
    state({
      schedule: { mode: 'at', at: AT, repeat: { every: 'week', count: 3 } },
    }),
    { scheduledFor: null, repeatTz: 'Asia/Kolkata' },
  ],
];

async function roundTrip(input) {
  const first = await serialize(input);
  const row = {
    id: 'rt',
    queued: first.body.queued,
    scheduledFor: first.body.scheduledFor,
    payload: { ...first.body.payload, mediaBytes: undefined },
  };
  const back = reconstructFromScheduled(row, first.body.payload.mediaBytes, {
    asDid: DID,
  });
  const again = await serialize({
    state: back,
    // A queued row comes back as the queue's: its slot is the caller's to give.
    options: {
      ...input.options,
      scheduledFor:
        back.schedule?.mode === 'queue' ? first.body.scheduledFor : null,
      queued: null,
    },
  });
  return { first: first.body, state: back, again: again.body };
}

// ---- base64 --------------------------------------------------------------------

const BASE64_INPUTS = [
  { base64: 'AAEC+v8=' },
  { base64: '' },
  { base64: 'YQ' },
  { base64: 'YQ==' },
  { base64: 'YQ=' },
  { base64: 'YQ===' },
  { base64: 'Y Q = =' },
  { base64: 'a b\tc\nd' },
  { base64: 'abcde' },
  { base64: 'ab=c' },
  { base64: '====' },
  { base64: 'é' },
  { base64: '-_-_' },
  { base64: null },
  { base64: 123 },
  { base64: true },
  { base64: ['YQ', '=='] },
];

const TYPES = [
  'image/png',
  'IMAGE/JPEG',
  '',
  null,
  'image/pngé',
  'x\u0019y',
  5,
  'text/plain; charset=UTF-8',
];

async function base64Cases() {
  return [
    ...(await each(
      'blobToBase64',
      [
        { bytes: [] },
        { bytes: [0, 1, 2, 250, 255] },
        { bytes: [...bytesOf('image-bytes')] },
        { bytes: [255, 255] },
        { bytes: [1] },
      ],
      ({ bytes }) => blobToBase64(new Blob([Uint8Array.from(bytes)])),
    )),
    ...(await each(
      'blobToBase64Large',
      [{ size: 200_000 }, { size: 0x8000 }, { size: 0x8001 }],
      async ({ size }) => {
        const out = await blobToBase64(
          new Blob([new Uint8Array(size).map((_, i) => (i * 7) % 256)]),
        );
        return {
          length: out.length,
          sha256: crypto.createHash('sha256').update(out).digest('hex'),
        };
      },
    )),
    ...(await each('base64ToFile', BASE64_INPUTS, async ({ base64 }) => {
      const f = base64ToFile(base64, 'image/png', 'x.png');
      return {
        type: f.type,
        name: f.name,
        size: f.size,
        bytes: [...new Uint8Array(await f.arrayBuffer())],
      };
    })),
    ...(await each(
      'base64ToFileType',
      TYPES.map((type) => ({ type })),
      ({ type }) => base64ToFile('YQ==', type, 'x').type,
    )),
  ];
}

export default async function cases() {
  const out = [
    value('constants', { MAX_MEDIA_BASE64_CHARS, MAX_IMAGE_BYTES }),
    ...(await base64Cases()),
  ];
  for (const [id, s, options] of serializeCases) {
    const input = { state: s, options };
    out.push(
      ...(await each('serializeForSchedule', [{ $id: id, ...input }], (i) =>
        under(options.device || 'UTC', 'none', async () => {
          try {
            return settle(await serialize(i));
          } catch (err) {
            return refusal(err);
          }
        }),
      )),
    );
  }
  out.push(
    ...(await each('reconstructFromScheduled', reconstructInputs, (i) =>
      under(i.tz, i.previews, async () => {
        const back =
          'media' in i
            ? reconstructFromScheduled(i.row, i.media, { asDid: i.asDid })
            : reconstructFromScheduled(i.row, undefined, { asDid: i.asDid });
        return canonIds(settle(back), toJSON(i));
      }),
    )),
  );
  for (const [id, s, options] of roundTrips) {
    const input = { state: s, options };
    out.push(
      ...(await each('roundTrip', [{ $id: id, ...input }], (i) =>
        under('UTC', 'count', async () =>
          canonIds(settle(await roundTrip(i)), toJSON(i)),
        ),
      )),
    );
  }
  return out;
}
