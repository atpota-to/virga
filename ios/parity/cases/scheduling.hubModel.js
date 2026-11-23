// src/posting/pages/hubModel.js: the posting overview's figures. A count in
// words, what goes out next, a scheduled row's snippet, the latest drafts,
// a post view as an archive row, the feed laid over the archive, the
// timers counting down, and when something happens in words. Swift:
// VirgaPosting/Pages/HubModel.swift.
//
// Inputs from hubModel.test.js, plus loose rows and limits, emoji cut at
// the limit, unreadable times, and the days around a clock change in the
// zone a case names (`tz`), in several locales.

import * as H from '../../../src/posting/pages/hubModel.js';
import { DEFAULT_LOCALE, setActiveLocale } from '../../../src/lib/locale.js';
import { each, inZone } from './_helpers.js';

export const sources = ['src/posting/pages/hubModel.js'];

const DID = 'did:plc:mira';

function under(tz, locale, fn) {
  return inZone(tz, () => {
    setActiveLocale(locale);
    try {
      return fn();
    } finally {
      setActiveLocale(DEFAULT_LOCALE);
    }
  });
}

const counts = [
  [1, 'draft'],
  [2, 'draft'],
  [1200, 'post'],
  [undefined, 'reply', 'replies'],
  [0, 'reply', 'replies'],
  [1.5, 'image'],
  [-1, 'post'],
  [NaN, 'post'],
  ['3', 'post'],
  [1234567.891, 'like'],
];
const countInputs = ['en-US', 'en-GB', 'en-IN', 'en-FR'].flatMap((locale) =>
  counts.map(([n, one, many]) => ({
    locale,
    n,
    one,
    ...(many ? { many } : {}),
  })),
);

const ROWS = [
  {
    id: 'a',
    status: 'pending',
    queued: true,
    scheduledFor: '2026-11-14T09:00:00.000Z',
  },
  {
    id: 'b',
    status: 'pending',
    queued: false,
    scheduledFor: '2026-11-13T09:00:00.000Z',
  },
  {
    id: 'c',
    status: 'failed',
    queued: false,
    scheduledFor: '2026-11-10T09:00:00.000Z',
  },
  {
    id: 'd',
    status: 'publishing',
    queued: false,
    scheduledFor: '2026-11-12T09:00:00.000Z',
  },
  {
    id: 'e',
    status: 'pending',
    queued: true,
    scheduledFor: '2026-11-20T09:00:00.000Z',
  },
  { id: 'f', status: 'pending', queued: 1, scheduledFor: 'whenever' },
  { id: 'g', status: 'pending', queued: false },
  { id: 'h', status: 'pending', scheduledFor: 1794495600000 },
  { id: 'i', status: 'pending', scheduledFor: '2026-11-13T08:00' },
  null,
];
const overviewInputs = [
  ...['UTC', 'Asia/Kolkata'].flatMap((tz) =>
    [3, 4, 0, -1, 2.7, 100, NaN, undefined].map((limit) => ({
      tz,
      rows: ROWS,
      ...(limit === undefined ? {} : { limit }),
    })),
  ),
  { tz: 'UTC', rows: null },
  { tz: 'UTC', rows: 'nope' },
  { tz: 'UTC', rows: [] },
];

const snippetInputs = [
  { row: { payload: { posts: [{ record: { text: '  hello\n world ' } }] } } },
  {
    row: { payload: { posts: [{ record: { text: 'x'.repeat(200) } }] } },
    max: 10,
  },
  { row: { payload: { posts: [{ record: { text: 'x'.repeat(120) } }] } } },
  { row: { payload: { posts: [{ record: { text: 'x'.repeat(121) } }] } } },
  {
    row: {
      payload: { posts: [{ record: { text: `${'x'.repeat(8)}😀😀😀` } }] },
    },
    max: 10,
  },
  {
    row: { payload: { posts: [{ record: { text: '😀'.repeat(5) } }] } },
    max: 3,
  },
  { row: { payload: { posts: [{ record: { text: 'abc' } }] } }, max: 0 },
  { row: { payload: { posts: [{ record: { text: 'abcdef' } }] } }, max: -2 },
  {
    row: {
      payload: { posts: [{ record: { text: '' }, embed: { type: 'images' } }] },
    },
  },
  {
    row: {
      payload: {
        posts: [{ record: { text: '' }, embed: { type: 'external' } }],
      },
    },
  },
  {
    row: {
      payload: {
        posts: [{ record: { text: '' }, embed: { type: 'record' } }, {}],
      },
    },
  },
  {
    row: {
      payload: {
        posts: [{ record: { text: '' }, embed: { type: 'recordWithMedia' } }],
      },
    },
  },
  {
    row: {
      payload: {
        posts: [{ record: { text: '' } }, { record: { text: 'two' } }],
      },
    },
  },
  { row: { payload: { posts: [] } } },
  {
    row: {
      payload: { posts: { 0: { record: { text: 'keyed' } }, length: 2 } },
    },
  },
  { row: null },
  { row: { payload: { posts: [{ record: { text: 5 } }] } } },
];

const view = (id, updatedAt, text = 'hi', extra = {}) => ({
  id,
  createdAt: updatedAt,
  updatedAt,
  draft: { posts: [{ text }] },
  ...extra,
});
const DRAFTS = [
  view('a', '2026-11-01T00:00:00Z'),
  view('b', '2026-11-05T00:00:00Z', 'newest'),
  view('c', '2026-11-03T00:00:00Z'),
  view('d', 'whenever'),
  view('e', '2026-11-04T00:00:00', 'local'),
  { draft: { posts: [] } },
  null,
  view('f', '2026-11-05T00:00:00Z', 'tie', {
    draft: {
      posts: [{ text: 'tie' }],
      deviceId: 'dev-1',
      deviceName: 'iPhone',
    },
  }),
];
const draftInputs = [
  ...['UTC', 'America/New_York'].flatMap((tz) => [
    { tz, drafts: DRAFTS },
    { tz, drafts: DRAFTS, limit: 2 },
    { tz, drafts: DRAFTS, limit: 0 },
    { tz, drafts: DRAFTS, limit: -1 },
    { tz, drafts: DRAFTS, deviceId: 'dev-1' },
  ]),
  { tz: 'UTC', drafts: [{ draft: { posts: [] } }] },
  { tz: 'UTC', drafts: null },
];

const VIEW = {
  uri: `at://${DID}/app.bsky.feed.post/3new`,
  cid: 'bafy',
  record: { text: 'fresh', createdAt: '2026-11-12T10:00:00.000Z' },
  likeCount: 4,
  repostCount: 1,
  replyCount: 2,
  quoteCount: 0,
};
const viewInputs = [
  { view: VIEW },
  { view: { ...VIEW, uri: 'at://did:plc:other/app.bsky.feed.post/1' } },
  { view: { ...VIEW, uri: `at://${DID}/app.bsky.feed.repost/1` } },
  {
    view: {
      ...VIEW,
      likeCount: undefined,
      repostCount: null,
      replyCount: 0,
      quoteCount: 7,
    },
  },
  { view: { ...VIEW, record: undefined } },
  {
    view: {
      ...VIEW,
      record: {
        text: 'a reply with #tags and a link https://example.com',
        createdAt: '2026-11-12T10:00:00',
        reply: {
          parent: { uri: 'at://did:plc:x/app.bsky.feed.post/p' },
          root: { uri: 'at://did:plc:x/app.bsky.feed.post/r' },
        },
        facets: [
          {
            index: { byteStart: 0, byteEnd: 1 },
            features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'tags' }],
          },
        ],
        langs: ['en'],
      },
    },
  },
  { view: { ...VIEW, uri: 5 } },
  { view: null },
];

const ARCHIVE = [
  {
    uri: `at://${DID}/app.bsky.feed.post/old`,
    at: '2026-11-01T00:00:00.000Z',
    text: 'old',
    likes: 1,
  },
  {
    uri: `at://${DID}/app.bsky.feed.post/both`,
    at: '2026-11-10T00:00:00.000Z',
    text: 'both',
    likes: 1,
  },
  {
    uri: `at://${DID}/app.bsky.feed.post/gone`,
    at: '2026-11-11T00:00:00.000Z',
    text: 'gone',
  },
  {
    uri: `at://${DID}/app.bsky.feed.post/both`,
    at: '2026-11-10T00:00:00.000Z',
    text: 'both again',
    likes: 2,
  },
  { text: 'no uri' },
  { uri: `at://${DID}/app.bsky.feed.post/undated`, text: 'undated' },
];
const FEED = [
  H.rowFromPostView(VIEW, DID),
  {
    uri: `at://${DID}/app.bsky.feed.post/both`,
    at: '2026-11-10T00:00:00.000Z',
    likes: 9,
    reposts: 0,
    replies: 0,
    quotes: 0,
  },
  {
    uri: `at://${DID}/app.bsky.feed.post/gone`,
    at: '2026-11-11T00:00:00.000Z',
    likes: 3,
  },
  {
    uri: `at://${DID}/app.bsky.feed.post/twin`,
    at: '2026-11-10T00:00:00.000Z',
    likes: 5,
  },
  null,
];
const mergeInputs = [
  {
    archive: ARCHIVE,
    feed: FEED,
    removed: [`at://${DID}/app.bsky.feed.post/gone`],
  },
  { archive: ARCHIVE, feed: FEED },
  { archive: null, feed: FEED },
  { archive: ARCHIVE, feed: null },
  { archive: [], feed: [] },
];

const TIMERS = [
  { status: 'armed', checkAt: '2026-11-15T00:00:00Z' },
  { status: 'checking', checkAt: '2026-11-13T00:00:00Z' },
  { status: 'deleted', checkAt: '2026-11-01T00:00:00Z' },
  { status: 'armed', checkAt: 'whenever' },
  { status: 'armed' },
  { status: 'armed', checkAt: '2026-11-12T23:00' },
];
const timerInputs = [
  ...['UTC', 'Pacific/Chatham'].map((tz) => ({ tz, rows: TIMERS })),
  { tz: 'UTC', rows: undefined },
  { tz: 'UTC', rows: [{ status: 'deleted' }] },
  { tz: 'UTC', rows: [{ status: 'armed', checkAt: '' }] },
];

// Local times as the case's zone reads them.
const local = (y, m, d, h, mi) => new Date(y, m, d, h, mi).toISOString();
const whenInputs = [];
for (const tz of [
  'UTC',
  'America/New_York',
  'Asia/Kolkata',
  'Australia/Lord_Howe',
]) {
  inZone(tz, () => {
    const now = new Date(2026, 10, 12, 8, 0).getTime();
    const isos = [
      local(2026, 10, 12, 9, 0),
      local(2026, 10, 13, 17, 30),
      local(2026, 10, 20, 9, 0),
      local(2027, 0, 2, 9, 0),
      local(2026, 10, 9, 18, 0),
      local(2026, 10, 11, 18, 0),
      local(2026, 10, 11, 0, 0),
      local(2026, 10, 12, 23, 59),
      null,
      'whenever',
      '2026-11-12T09:00',
    ];
    for (const iso of isos) {
      whenInputs.push({ tz, iso, now });
      whenInputs.push({ tz, iso, now, weekday: false });
    }
    // Across the clock change: New York falls back on Nov 1 2026, Lord Howe
    // springs forward on Oct 4 2026.
    const before = new Date(2026, 9, 31, 22, 0).getTime();
    whenInputs.push({ tz, iso: local(2026, 10, 1, 23, 0), now: before });
    whenInputs.push({ tz, iso: local(2026, 10, 2, 0, 30), now: before });
    const lh = new Date(2026, 9, 3, 23, 0).getTime();
    whenInputs.push({ tz, iso: local(2026, 9, 4, 23, 0), now: lh });
    whenInputs.push({ tz, iso: local(2026, 9, 5, 1, 0), now: lh });
  });
}
for (const locale of ['en-GB', 'en-AU', 'en-FR'])
  whenInputs.push({
    tz: 'UTC',
    locale,
    iso: '2026-11-20T09:00:00Z',
    now: Date.parse('2026-11-12T08:00:00Z'),
  });

export default async function cases() {
  const run = (fn, inputs, compute) =>
    each(fn, inputs, (i) =>
      under(i.tz || 'UTC', i.locale || 'en-US', () => compute(i)),
    );
  return [
    ...(await run('countPhrase', countInputs, (i) =>
      'many' in i
        ? H.countPhrase(i.n, i.one, i.many)
        : H.countPhrase(i.n, i.one),
    )),
    ...(await run('scheduledOverview', overviewInputs, (i) =>
      'limit' in i
        ? H.scheduledOverview(i.rows, { limit: i.limit })
        : H.scheduledOverview(i.rows),
    )),
    ...(await run('scheduledSnippet', snippetInputs, (i) =>
      'max' in i ? H.scheduledSnippet(i.row, i.max) : H.scheduledSnippet(i.row),
    )),
    ...(await run('draftRows', draftInputs, (i) => {
      const options = {};
      if ('limit' in i) options.limit = i.limit;
      if ('deviceId' in i) options.deviceId = i.deviceId;
      return H.draftRows(i.drafts, options);
    })),
    ...(await run(
      'rowFromPostView',
      ['UTC', 'Asia/Kolkata'].flatMap((tz) =>
        viewInputs.map((v) => ({ tz, ...v })),
      ),
      (i) => H.rowFromPostView(i.view, DID),
    )),
    ...(await run('mergePostRows', mergeInputs, (i) =>
      'removed' in i
        ? H.mergePostRows(i.archive, i.feed, { removed: i.removed })
        : H.mergePostRows(i.archive, i.feed),
    )),
    ...(await run('timersOverview', timerInputs, (i) =>
      H.timersOverview(i.rows),
    )),
    ...(await run('whenLabel', whenInputs, (i) =>
      'weekday' in i
        ? H.whenLabel(i.iso, new Date(i.now), { weekday: i.weekday })
        : H.whenLabel(i.iso, new Date(i.now)),
    )),
  ];
}
