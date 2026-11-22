// src/posting/lib/composerModel.js: the composer's state, its normalizers,
// the reducer (every action, the media rules, splitting and its undo, the
// write account changing), self-labels, every validation message, and the
// text pipeline. Swift: VirgaPosting/Lib/ComposerModel*.swift.
//
// Inputs are composerModel.test.js's, plus loose and malformed shapes,
// unicode and emoji, boundaries (25 posts, 4 images, 300 graphemes, 3000
// bytes, a minute and 90 days out), zone-less scheduled times in several
// zones, and files (see _composer.js for how a File and a fresh id are
// written down).

import {
  composerReducer,
  emptyComposerState,
  emptyPost,
  isEmptyComposer,
  labelsToSelfLabels,
  normalizeComposerState,
  normalizePost,
  postHasContent,
  resolvePostTexts,
  selfLabelsToLabels,
  validateComposer,
  MAX_POSTS,
  MAX_IMAGES,
  MAX_POST_GRAPHEMES,
  MAX_POST_BYTES,
  MAX_LANGS,
  SCHEDULE_MIN_LEAD_MS,
  SCHEDULE_MAX_DAYS,
  ADULT_LABELS,
  SELF_LABELS,
} from '../../../src/posting/lib/composerModel.js';
import { each, value, inZone, FIXED_NOW } from './_helpers.js';
import { blob, canonIds, file, markFiles, withFiles } from './_composer.js';

export const sources = ['src/posting/lib/composerModel.js'];

const ME = 'did:plc:me';
const OTHER = 'did:plc:other';
// JSON.stringify of a File is {} (it has no own members), so files are marked first.
const settle = (result, input) =>
  canonIds(JSON.parse(JSON.stringify(markFiles(result))), input);

const post = (id, text = '', extra = {}) => ({
  id,
  text,
  images: [],
  video: null,
  record: null,
  card: null,
  ...extra,
});
const state = (posts, extra = {}) =>
  normalizeComposerState({ asDid: ME, posts, ...extra });
const one = (text = '', extra = {}) => state([post('p1', text)], extra);
const three = () =>
  state([
    post('p1', 'first'),
    post('p2', 'long', { images: [{ id: 'i1', file: file(), alt: 'a' }] }),
    post('p3', 'last'),
  ]);

const RAW_POSTS = [
  undefined,
  null,
  5,
  'text',
  [],
  {},
  { text: 'x' },
  { id: 'p1', text: 5 },
  { id: 0, text: 'zero id' },
  { id: '', text: 'empty id' },
  { id: 'p1', text: 'é́ 👩‍🔬', extra: { kept: true } },
  {
    id: 'p1',
    images: [
      null,
      5,
      'img',
      [],
      { id: 'i1' },
      { alt: 5 },
      { id: 'i2', alt: 'ok', file: file(), blob: blob('b') },
    ],
  },
  { id: 'p1', images: 'not a list' },
  { id: 'p1', video: { status: 'uploading' } },
  { id: 'p1', video: { status: 'bogus', blob: blob('v') } },
  { id: 'p1', video: { status: 'bogus' } },
  { id: 'p1', video: { alt: 5, status: 'ready', jobId: 'j' } },
  { id: 'p1', video: [] },
  { id: 'p1', video: 'v' },
  { id: 'p1', record: { uri: 'at://q', kind: 'feed', cid: 'c' } },
  { id: 'p1', record: { uri: 'at://q', kind: 'bogus' } },
  { id: 'p1', record: { kind: 'post' } },
  { id: 'p1', record: { uri: 5 } },
  {
    id: 'p1',
    card: { url: 'https://e.com', title: 'T', description: 5, thumb: '' },
  },
  {
    id: 'p1',
    card: { url: 'https://e.com', thumb: 'https://t', thumbBlob: blob('t') },
  },
  { id: 'p1', card: { url: '' } },
  { id: 'p1', card: { url: 5 } },
  { id: 'p1', card: { title: 'no url' } },
];

const RAW_STATES = [
  undefined,
  null,
  'state',
  [],
  {},
  { posts: [] },
  { posts: 'x' },
  { asDid: ME, posts: [{ text: 'x' }], gates: {} },
  {
    posts: Array.from({ length: 30 }, (_, i) => ({ id: `p${i}` })),
    langs: ['a', 'b', 'c', 'd'],
  },
  {
    asDid: 5,
    extra: 'kept',
    posts: [{ id: 'p1', text: 'hi' }],
    reply: { uri: 'at://p', cid: 'c', root: { uri: 'at://r', cid: 'rc' } },
    tags: ['a', '', 5, 'b', 'a'],
    langs: ['en', '', 'de', 5, 'fr', 'ja'],
    labels: ['porn', 7, ''],
    gates: { custom: 1, reply: [{ type: 'mention' }], quotes: 0 },
    schedule: {
      mode: 'at',
      at: '2026-12-01T00:00:00.000Z',
      repeat: { every: 'week' },
    },
    lifespan: { enabled: true, lifespanSeconds: 60 },
    source: { kind: 'draft', id: 'd1' },
  },
  {
    reply: { cid: 'c' },
    gates: { reply: 'everyone', quotes: false },
    schedule: { mode: 'queue', at: 'x' },
  },
  { reply: [], gates: [], schedule: { mode: 'at' }, lifespan: [], source: [] },
  { schedule: { mode: 'at', at: 5 } },
  { schedule: { mode: 'at', at: '2026-12-01', repeat: [] } },
  { schedule: { mode: 'later' } },
  { gates: { reply: null, quotes: 'no' } },
  { gates: { custom: false, reply: [], quotes: false } },
];

// Reducer scripts: a state and actions, the state recorded after each.
const SCRIPTS = [
  ['setText', one(), [{ type: 'setText', index: 0, text: 'hello' }]],
  [
    'setText-coerced',
    one(),
    [
      { type: 'setText', index: 0, text: 5 },
      { type: 'setText', index: 0, text: null },
      { type: 'setText', index: 0 },
      { type: 'setText', index: 0, text: ['a', 'b'] },
      { type: 'setText', index: 0, text: { a: 1 } },
      { type: 'setText', index: 0, text: true },
    ],
  ],
  [
    'setText-bad-index',
    one('x'),
    [
      { type: 'setText', index: 1, text: 'y' },
      { type: 'setText', index: -1, text: 'y' },
      { type: 'setText', index: 0.5, text: 'y' },
      { type: 'setText', index: '0', text: 'y' },
      { type: 'setText', text: 'y' },
    ],
  ],
  [
    'add-move-remove',
    one('a'),
    [
      { type: 'addPost', after: 0 },
      { type: 'setText', index: 1, text: 'b' },
      { type: 'addPost', after: 0 },
      { type: 'movePost', from: 2, to: 0 },
      { type: 'removePost', index: 2 },
      { type: 'removePost', index: 0 },
      { type: 'removePost', index: 0 },
    ],
  ],
  [
    'addPost-positions',
    one('a'),
    [
      { type: 'addPost' },
      { type: 'addPost', after: -5 },
      { type: 'addPost', after: 99 },
      { type: 'addPost', after: 1.5 },
      { type: 'addPost', after: 1e20 },
      { type: 'addPost', after: -1e20 },
      { type: 'addPost', post: { id: 'given', text: 'given' } },
      { type: 'addPost', post: 0 },
    ],
  ],
  [
    'addPost-full',
    state(Array.from({ length: 25 }, (_, i) => post(`p${i}`, `t${i}`))),
    [
      { type: 'addPost' },
      { type: 'movePost', from: 0, to: 24 },
      { type: 'movePost', from: 0, to: 25 },
      { type: 'movePost', from: 3, to: 3 },
      { type: 'movePost', from: '0', to: 1 },
    ],
  ],
  [
    'removePost-bad',
    three(),
    [
      { type: 'removePost', index: 3 },
      { type: 'removePost', index: -1 },
      { type: 'removePost' },
      { type: 'removePost', index: 1 },
    ],
  ],
  [
    'split-unsplit',
    three(),
    [
      {
        type: 'splitPost',
        id: 'p2',
        text: 'lo',
        rest: [post('a', 'n'), post('b', 'g')],
      },
      { type: 'movePost', from: 0, to: 4 },
      { type: 'unsplitPost', id: 'p2', remove: ['a', 'b'], text: 'long' },
      { type: 'unsplitPost', id: 'nope', remove: [], text: 'x' },
    ],
  ],
  [
    'split-limits',
    three(),
    [
      { type: 'splitPost', id: 'nope', text: 'x', rest: [post('a', 'x')] },
      { type: 'splitPost', id: 'p2', text: 'x', rest: [] },
      { type: 'splitPost', id: 'p2', text: 'x', rest: 'nope' },
      {
        type: 'splitPost',
        id: 'p2',
        text: 5,
        rest: [null, 'x', { text: 'made' }],
      },
      {
        type: 'splitPost',
        id: 'p1',
        text: 'lo',
        rest: Array.from({ length: 25 }, (_, i) => post(`r${i}`, 'x')),
      },
    ],
  ],
  // Past the limit (a state that skipped the normalizer): slice(0, -2) keeps
  // all but the last two of `rest`.
  [
    'split-over-full',
    {
      ...one(),
      posts: Array.from({ length: 27 }, (_, i) => post(`p${i}`, `t${i}`)),
    },
    [
      {
        type: 'splitPost',
        id: 'p3',
        text: 'x',
        rest: [post('a', 'a'), post('b', 'b'), post('c', 'c')],
      },
    ],
  ],
  [
    'unsplit-self-in-remove',
    three(),
    [
      {
        type: 'unsplitPost',
        id: 'p1',
        remove: ['p1', 'p3', 'p3', 5, null],
        text: 'back',
      },
      { type: 'unsplitPost', id: 'p1', remove: 'p2', text: 'again' },
    ],
  ],
  [
    'setTexts',
    three(),
    [
      { type: 'setTexts', texts: { p1: 'one', p3: 'three', nope: 'x' } },
      { type: 'setTexts', texts: { nope: 'x' } },
      { type: 'setTexts' },
      { type: 'setTexts', texts: { p2: 5 } },
      { type: 'setTexts', texts: ['x'] },
      { type: 'setTexts', texts: { p2: '' } },
    ],
  ],
  [
    'setTexts-odd-ids',
    state([post('1', 'a'), post('café', 'b')]),
    [
      { type: 'setTexts', texts: { 1: 'one', café: 'NFD', toString: 'x' } },
      { type: 'setTexts', texts: { café: 'NFC' } },
    ],
  ],
  [
    'images',
    one(),
    [
      { type: 'setCard', index: 0, card: { url: 'https://e.com', title: 'T' } },
      {
        type: 'addImages',
        index: 0,
        images: [1, 2, 3].map((n) => ({ id: `i${n}`, file: file() })),
      },
      { type: 'addImages', index: 0, images: [{ id: 'i4' }, { id: 'i5' }] },
      { type: 'addImages', index: 0, images: [] },
      { type: 'addImages', index: 0, images: 'x' },
    ],
  ],
  [
    'images-update-move-remove',
    one(),
    [
      {
        type: 'addImages',
        index: 0,
        images: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      },
      {
        type: 'updateImage',
        index: 0,
        id: 'b',
        patch: { alt: 'bee', id: 'zzz' },
      },
      { type: 'updateImage', index: 0, id: 'c', patch: 'xy' },
      { type: 'updateImage', index: 0, id: 'a', patch: ['p', 'q'] },
      { type: 'updateImage', index: 0, id: 'a', patch: null },
      { type: 'updateImage', index: 0, id: 'nope', patch: { alt: 'x' } },
      { type: 'moveImage', index: 0, from: 2, to: 0 },
      { type: 'moveImage', index: 0, from: 0, to: 3 },
      { type: 'removeImage', index: 0, id: 'a' },
      { type: 'removeImage', index: 0, id: 'nope' },
    ],
  ],
  [
    'images-no-id',
    one(),
    [
      {
        type: 'addImages',
        index: 0,
        images: [{ alt: 'x' }, { id: 0 }, { id: '' }, null],
      },
    ],
  ],
  [
    'video',
    one(),
    [
      { type: 'addImages', index: 0, images: [{ id: 'a' }] },
      {
        type: 'setVideo',
        index: 0,
        video: { file: file('v.mp4', 'video/mp4'), mime: 'video/mp4', size: 1 },
      },
      { type: 'setCard', index: 0, card: { url: 'https://e.com' } },
      { type: 'setVideo', index: 0, video: null },
      { type: 'setVideo', index: 0, video: 'x' },
      {
        type: 'setVideo',
        index: 0,
        video: { blob: blob('v'), status: 'nope', alt: 'v' },
      },
    ],
  ],
  [
    'record-card',
    one(),
    [
      { type: 'addImages', index: 0, images: [{ id: 'a' }] },
      { type: 'setCard', index: 0, card: { url: 'https://e.com' } },
      {
        type: 'setRecord',
        index: 0,
        record: { kind: 'post', uri: 'at://q', cid: 'c' },
      },
      { type: 'removeImage', index: 0, id: 'a' },
      {
        type: 'setCard',
        index: 0,
        card: { url: 'https://e.com', thumb: 'https://t' },
      },
      { type: 'setCard', index: 0, card: { url: '' } },
      { type: 'setRecord', index: 0, record: { uri: 5 } },
    ],
  ],
  [
    'composer-wide',
    one(),
    [
      { type: 'setTags', tags: '#a, A, b' },
      { type: 'setTags', tags: ['#x', 'X', '  ', 'y', 5] },
      { type: 'setTags', tags: null },
      { type: 'setLangs', langs: ['en', 'en', 'de', 'fr', 'ja'] },
      { type: 'setLangs', langs: ['café', 'café', '', 5] },
      { type: 'setLangs', langs: 'en' },
      {
        type: 'setLabels',
        labels: ['nudity', 'graphic-media', 'porn', 'bogus'],
      },
      { type: 'setLabels', labels: ['sexual', 'sexual'] },
      { type: 'setLabels', labels: ['porn', 'nudity', 'sexual', 'porn'] },
      { type: 'setLabels', labels: 'porn' },
    ],
  ],
  [
    'gates',
    one(),
    [
      { type: 'setDefaultGates', gates: { reply: [], quotes: true } },
      { type: 'setGates', gates: { reply: null, quotes: false } },
      { type: 'setDefaultGates', gates: { reply: [], quotes: true } },
      { type: 'setGates', gates: 'x' },
      {
        type: 'setGates',
        gates: { custom: false, reply: [{ type: 'follower' }] },
      },
    ],
  ],
  [
    'reply-schedule-lifespan-source',
    one(),
    [
      {
        type: 'setReply',
        reply: { uri: 'at://p', cid: 'c', root: { uri: 'at://r', cid: 'rc' } },
      },
      {
        type: 'setSchedule',
        schedule: { mode: 'at', at: '2026-12-01T00:00:00.000Z' },
      },
      { type: 'setLifespan', lifespan: { enabled: true } },
      { type: 'setSource', source: { kind: 'draft', id: 'd1', ownerDid: ME } },
      { type: 'setSchedule', schedule: { mode: 'queue', at: 'x' } },
      {
        type: 'setSchedule',
        schedule: {
          mode: 'at',
          at: '2026-12-01T00:00:00.000Z',
          repeat: { every: 'day' },
        },
      },
      { type: 'setLifespan', lifespan: null },
      { type: 'setSource', source: 'x' },
      { type: 'setReply', reply: [] },
      { type: 'setSchedule', schedule: null },
    ],
  ],
  [
    'setAsDid',
    state([
      post('p1', '', {
        images: [
          { id: 'mine', file: file(), blob: blob('1'), blobDid: OTHER },
          { id: 'theirs', file: file(), blob: blob('2'), blobDid: ME },
          { id: 'none', file: file() },
        ],
      }),
      post('p2', '', {
        video: {
          file: file('v.mp4', 'video/mp4'),
          blob: blob('v'),
          blobDid: ME,
          jobId: 'j',
          status: 'ready',
          error: 'e',
        },
      }),
      post('p3', '', {
        card: {
          url: 'https://e.com',
          thumb: 'https://t',
          thumbBlob: blob('t'),
          thumbBlobDid: ME,
        },
      }),
      post('p4', '', {
        video: { file: file('v.mp4', 'video/mp4'), status: 'uploading' },
      }),
      post('p5', '', {
        video: { file: file('v.mp4', 'video/mp4'), status: 'idle' },
      }),
      post('p6', '', {
        card: {
          url: 'https://e.com',
          thumbBlob: blob('t'),
          thumbBlobDid: OTHER,
        },
      }),
    ]),
    [
      { type: 'setAsDid', did: OTHER },
      { type: 'setAsDid', did: OTHER },
      { type: 'setAsDid', did: '' },
      { type: 'setAsDid', did: 5 },
    ],
  ],
  [
    'setAsDid-no-video-key',
    normalizeComposerState({ asDid: ME, posts: [{ id: 'p1' }] }),
    [{ type: 'setAsDid', did: OTHER }],
  ],
  [
    'load-reset',
    one('x'),
    [
      { type: 'load', state: { asDid: ME, posts: [{ text: 'x' }], gates: {} } },
      { type: 'reset', state: { asDid: OTHER } },
      { type: 'load' },
    ],
  ],
  [
    'not-actions',
    one('x'),
    [null, 5, 'setText', [], {}, { type: 'nope' }, { type: 5 }],
  ],
];

function runScript(start, actions) {
  const states = [];
  let s = withFiles(start);
  for (const action of actions) {
    s = composerReducer(s, withFiles(action));
    states.push(s);
  }
  return states;
}

const VALIDATE = [
  ['ordinary', one('hello'), {}],
  ['empty', one(), {}],
  ['post-empty', state([post('p1', 'a'), post('p2', '  ')]), {}],
  ['all-empty-thread', state([post('p1'), post('p2')]), {}],
  ['300', one('a'.repeat(300)), {}],
  ['301', one('a'.repeat(301)), {}],
  [
    'link-counts-short',
    one(`${'a'.repeat(250)} https://example.com/${'x'.repeat(200)}`),
    {},
  ],
  [
    'inline-link',
    one(`${'a'.repeat(290)} [words](https://example.com/very/long/path/here)`),
    {},
  ],
  ['trimmed', one(`   ${'a'.repeat(300)}   `), {}],
  ['emoji-300', one('\u{1F469}‍\u{1F52C}'.repeat(300)), {}],
  ['emoji-272', one('\u{1F469}‍\u{1F52C}'.repeat(272)), {}],
  ['emoji-273', one('\u{1F469}‍\u{1F52C}'.repeat(273)), {}],
  ['combining', one('é'.repeat(301)), {}],
  [
    'media',
    normalizeComposerState({
      asDid: ME,
      posts: [
        {
          id: 'p1',
          text: 'x',
          images: [1, 2, 3, 4, 5].map((n) => ({ id: `i${n}`, file: file() })),
        },
        {
          id: 'p2',
          text: 'y',
          images: [{ id: 'i6', file: file() }],
          video: { file: file() },
        },
        { id: 'p3', text: 'z', images: [{ id: 'i7', alt: 'gone' }] },
        { id: 'p4', text: 'w', video: { alt: 'v'.repeat(1001) } },
        {
          id: 'p5',
          text: 'v',
          video: { alt: 'v'.repeat(1000), blob: blob('v') },
        },
        { id: 'p6', text: 'u', images: [{ id: 'i8', blob: blob('b') }] },
      ],
    }),
    {},
  ],
  ['alt-required-off', one('x', {}), {}],
  [
    'alt-required',
    state([
      post('p1', 'x', {
        images: [
          { id: 'i1', file: file(), alt: ' ' },
          { id: 'i2', file: file(), alt: 'ok' },
        ],
      }),
    ]),
    { requireAltText: true },
  ],
  [
    'alt-not-required',
    state([
      post('p1', 'x', { images: [{ id: 'i1', file: file(), alt: ' ' }] }),
    ]),
    {},
  ],
  [
    'record-unresolved',
    state([post('p1', 'x', { record: { kind: 'post', uri: 'at://q' } })]),
    {},
  ],
  [
    'record-only',
    state([
      post('p1', '', { record: { kind: 'post', uri: 'at://q', cid: 'c' } }),
    ]),
    {},
  ],
  [
    'tags-langs-labels-gates',
    {
      ...one('x'),
      tags: Array.from({ length: 9 }, (_, i) => `t${i}`),
      langs: ['a', 'b', 'c', 'd'],
      labels: ['porn', 'nudity', 'bogus'],
      gates: {
        custom: true,
        reply: Array.from({ length: 6 }, () => ({ type: 'mention' })),
        quotes: true,
      },
    },
    {},
  ],
  ['tag-too-long', { ...one('x'), tags: ['a'.repeat(65)] }, {}],
  ['tag-64', { ...one('x'), tags: ['a'.repeat(64)] }, {}],
  ['tag-bytes', { ...one('x'), tags: ['\u{1F469}‍\u{1F52C}'.repeat(59)] }, {}],
  ['tag-empty', { ...one('x'), tags: [''] }, {}],
  [
    'gates-on-reply',
    {
      ...one('x'),
      reply: { uri: 'at://p', cid: 'c' },
      gates: {
        custom: true,
        reply: Array.from({ length: 6 }, () => ({ type: 'mention' })),
        quotes: true,
      },
    },
    {},
  ],
  ['no-account', { ...one('x'), asDid: '' }, {}],
  [
    'reply-schedule',
    one('x', {
      reply: { uri: 'at://p', cid: 'c', root: { uri: 'at://p', cid: 'c' } },
    }),
    { forSchedule: true },
  ],
  [
    'reply-queue',
    one('x', {
      reply: { uri: 'at://p', cid: 'c', root: { uri: 'at://p', cid: 'c' } },
      schedule: { mode: 'queue' },
    }),
    { forSchedule: true },
  ],
  [
    'reply-queue-not-scheduling',
    one('x', {
      reply: { uri: 'at://p', cid: 'c' },
      schedule: { mode: 'queue' },
    }),
    {},
  ],
  [
    'video-schedule',
    state([post('p1', 'x', { video: { file: file('v.mp4', 'video/mp4') } })]),
    { forSchedule: true },
  ],
  [
    'video-now',
    state([post('p1', 'x', { video: { file: file('v.mp4', 'video/mp4') } })]),
    {},
  ],
  ['queued', one('x', { schedule: { mode: 'queue' } }), { forSchedule: true }],
  [
    'at-invalid',
    one('x', { schedule: { mode: 'at', at: 'soon' } }),
    { forSchedule: true },
  ],
  ['lifespan-off', one('x'), { lifespan: 'passed' }],
  [
    'lifespan-on',
    one('x', { lifespan: { enabled: true } }),
    { lifespan: 'passed' },
  ],
  [
    'lifespan-on-fine',
    one('x', { lifespan: { enabled: true } }),
    { lifespan: 'fine' },
  ],
  [
    'lifespan-on-number',
    one('x', { lifespan: { enabled: 1 } }),
    { lifespan: 'number' },
  ],
  ['lifespan-no-check', one('x', { lifespan: { enabled: true } }), {}],
  [
    'too-many-posts',
    {
      ...one('x'),
      posts: Array.from({ length: 26 }, (_, i) => post(`p${i}`, 'x')),
    },
    {},
  ],
  ['malformed-null', null, {}],
  ['malformed-object', {}, {}],
  [
    'malformed-posts',
    { asDid: ME, posts: [{ text: 'x', images: [{}] }, {}] },
    {},
  ],
];

// Scheduled times around the limits, in several zones.
const AT = [
  ['in-2-min', new Date(FIXED_NOW + 120_000).toISOString()],
  ['in-30-s', new Date(FIXED_NOW + 30_000).toISOString()],
  ['exactly-1-min', new Date(FIXED_NOW + 60_000).toISOString()],
  ['1-min-less-1ms', new Date(FIXED_NOW + 59_999).toISOString()],
  ['90-days', new Date(FIXED_NOW + 90 * 86_400_000).toISOString()],
  ['90-days-1ms', new Date(FIXED_NOW + 90 * 86_400_000 + 1).toISOString()],
  ['91-days', new Date(FIXED_NOW + 91 * 86_400_000).toISOString()],
  ['past', new Date(FIXED_NOW - 86_400_000).toISOString()],
  ['local-same-hour', '2026-03-15T12:05'],
  ['local-tomorrow', '2026-03-16T09:00'],
  ['date-only', '2026-03-16'],
  ['offset', '2026-03-15T08:30:00-04:00'],
  ['legacy', 'Mar 16 2026 09:00'],
];

const RESOLVE = [
  [
    'mentions',
    [
      { text: '  hi @known.test and @nobody.test  ' },
      {
        text: 'read [this](https://example.com/a/very/long/path/indeed) or https://example.com/another/long/path',
      },
    ],
  ],
  [
    'punctuation',
    [
      { text: 'Did you see https://example.com/page?' },
      { text: 'Look: https://example.com: neat' },
      { text: 'Read https://example.com/page. Thanks' },
      { text: 'See (https://example.com/page) ok' },
      { text: '<https://example.com/x>' },
    ],
  ],
  [
    'address-in-url',
    [
      {
        text: `${'a'.repeat(270)} https://example.com/newsletter/subscribe?ref=share&email=reader@example.org&utm_source=bsky&utm_medium=social`,
      },
    ],
  ],
  [
    'tags-and-emoji',
    [
      { text: '#tag \u{1F469}‍\u{1F52C} @known.test #ünïcode' },
      { text: '' },
      { text: '   ' },
    ],
  ],
  [
    'misleading-inline',
    [
      {
        text: '[example.org](https://example.com/x) and [words](https://example.com)',
      },
    ],
  ],
  ['non-string', [{ text: 5 }, {}]],
];

const TABLE = { 'known.test': 'did:plc:known' };

export default async function cases() {
  const all = [];
  all.push(
    value('constants', {
      MAX_POSTS,
      MAX_IMAGES,
      MAX_POST_GRAPHEMES,
      MAX_POST_BYTES,
      MAX_LANGS,
      SCHEDULE_MIN_LEAD_MS,
      SCHEDULE_MAX_DAYS,
      ADULT_LABELS,
      SELF_LABELS,
    }),
  );

  all.push(
    ...(await each(
      'emptyComposerState',
      [
        { $id: 'plain', asDid: ME },
        { $id: 'no-did' },
        { $id: 'did-number', asDid: 5 },
        {
          $id: 'defaults',
          asDid: ME,
          defaults: {
            langs: ['de', 'en', 'fr', 'es'],
            gates: { reply: [], quotes: false },
            lifespan: { enabled: true, lifespanSeconds: 3600 },
          },
        },
        {
          $id: 'defaults-loose',
          asDid: ME,
          defaults: {
            langs: ['', 5, 'en'],
            gates: { reply: 'x' },
            lifespan: [],
          },
        },
        { $id: 'gates-not-object', asDid: ME, defaults: { gates: [] } },
        {
          $id: 'gates-quotes-undefined',
          asDid: ME,
          defaults: { gates: { reply: [{ type: 'mention' }] } },
        },
        {
          $id: 'gates-reply-null',
          asDid: ME,
          defaults: { gates: { reply: null, quotes: 0 } },
        },
        { $id: 'langs-not-list', asDid: ME, defaults: { langs: 'en' } },
      ],
      (input) =>
        settle(
          emptyComposerState({
            asDid: input.asDid,
            ...(input.defaults ? { defaults: input.defaults } : {}),
          }),
          input,
        ),
    )),
  );

  all.push(
    ...(await each('emptyPost', [{ $id: 'one' }], (input) =>
      settle(emptyPost(), input),
    )),
  );

  all.push(
    ...(await each(
      'normalizePost',
      RAW_POSTS.map((raw, i) => ({ $id: `raw${i}`, raw })),
      (input) => settle(normalizePost(withFiles(input.raw)), input),
    )),
  );

  all.push(
    ...(await each(
      'normalizeComposerState',
      RAW_STATES.map((raw, i) => ({ $id: `raw${i}`, raw })),
      (input) => settle(normalizeComposerState(withFiles(input.raw)), input),
    )),
  );

  all.push(
    ...(await each(
      'composerReducer',
      SCRIPTS.map(([id, start, actions]) => ({
        $id: id,
        state: markFiles(start),
        actions,
      })),
      (input) => settle(runScript(input.state, input.actions), input),
    )),
  );

  const contentPosts = [
    null,
    {},
    { text: '' },
    { text: '  \n ' },
    { text: 'x' },
    { text: '　' },
    { text: '​' },
    { images: [] },
    { images: [{}] },
    { images: 'ab' },
    { video: {} },
    { video: null },
    { record: { uri: 'at://q' } },
    { card: { url: 'u' } },
    { card: 0 },
  ];
  all.push(
    ...(await each(
      'postHasContent',
      contentPosts.map((p, i) => ({ $id: `post${i}`, post: p })),
      (input) => postHasContent(input.post),
    )),
  );
  all.push(
    ...(await each(
      'isEmptyComposer',
      [
        { $id: 'null', state: null },
        { $id: 'no-posts', state: {} },
        { $id: 'empty', state: { posts: [{ text: ' ' }, {}] } },
        { $id: 'text', state: { posts: [{ text: ' ' }, { text: 'x' }] } },
        { $id: 'card', state: { posts: [{ card: { url: 'x' } }] } },
      ],
      (input) => isEmptyComposer(input.state),
    )),
  );

  all.push(
    ...(await each(
      'labelsToSelfLabels',
      [
        { $id: 'mixed', labels: ['porn', 'graphic-media', 'porn', 'bogus'] },
        { $id: 'empty', labels: [] },
        { $id: 'none', labels: null },
        { $id: 'loose', labels: ['', 5, 'sexual', 'nudity', 'NUDITY'] },
        { $id: 'string', labels: 'porn' },
      ],
      (input) => labelsToSelfLabels(input.labels),
    )),
  );
  all.push(
    ...(await each(
      'selfLabelsToLabels',
      [
        {
          $id: 'round-trip',
          selfLabels: {
            $type: 'com.atproto.label.defs#selfLabels',
            values: [{ val: 'porn' }, { val: 'graphic-media' }],
          },
        },
        { $id: 'undefined' },
        {
          $id: 'loose',
          selfLabels: {
            values: [
              null,
              { val: 'porn' },
              { val: 'porn' },
              { val: 5 },
              { val: 'bogus' },
              'sexual',
              { val: 'nudity' },
            ],
          },
        },
        { $id: 'values-not-list', selfLabels: { values: 'porn' } },
      ],
      (input) => selfLabelsToLabels(input.selfLabels),
    )),
  );

  const checks = {
    passed: () => 'That time has passed.',
    fine: () => null,
    number: () => 42,
  };
  const validateInputs = [];
  for (const [id, s, opts] of VALIDATE) {
    validateInputs.push({
      $id: id,
      state: markFiles(s),
      now: FIXED_NOW,
      tz: 'UTC',
      ...opts,
    });
  }
  for (const [id, at] of AT) {
    for (const tz of [
      'UTC',
      'America/New_York',
      'Asia/Kolkata',
      'Pacific/Chatham',
    ]) {
      validateInputs.push({
        $id: `${id}-${tz}`,
        state: one('x', { schedule: { mode: 'at', at } }),
        now: FIXED_NOW,
        forSchedule: true,
        tz,
      });
    }
  }
  all.push(
    ...(await each('validateComposer', validateInputs, (input) => {
      let calls = 0;
      const check = input.lifespan ? checks[input.lifespan] : undefined;
      const problems = inZone(input.tz, () =>
        validateComposer(withFiles(input.state), {
          now: input.now,
          ...(input.forSchedule ? { forSchedule: true } : {}),
          ...(input.requireAltText ? { requireAltText: true } : {}),
          ...(check
            ? {
                lifespanProblem: (rule) => {
                  calls += 1;
                  return check(rule);
                },
              }
            : {}),
        }),
      );
      return { problems, calls };
    })),
  );

  all.push(
    ...(await each(
      'resolvePostTexts',
      RESOLVE.map(([id, posts]) => ({
        $id: id,
        state: normalizeComposerState({
          asDid: ME,
          posts: posts.map((p, i) => ({ id: `p${i}`, ...p })),
        }),
        table: TABLE,
      })),
      async (input) =>
        resolvePostTexts(input.state, {
          resolveMention: async (handle) => input.table[handle] ?? null,
        }),
    )),
  );
  // Cases a fixed resolver can't make: a state with no posts.
  all.push(
    ...(await each(
      'resolvePostTexts',
      [{ $id: 'no-posts', state: {}, table: TABLE }],
      async (input) =>
        resolvePostTexts(input.state, { resolveMention: async () => null }),
    )),
  );

  return all;
}
