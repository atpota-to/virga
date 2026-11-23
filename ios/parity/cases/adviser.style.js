// src/posting/adviser/{style,styleSession}.js: learning the writer's style.
// The author's own texts from a feed page; reading up to a sample of them
// from the public AppView, page by page (recorded, with every onPage count);
// a reading from gathered posts through the web's own requester to Virga's
// server (recorded, with the usage store after it); both in turn; the
// profile kept from a reading and forgetting it; and the dialog's words (its
// errors and its profile line, in every offered locale and several zones).
// Swift: VirgaPosting/Adviser/{Style,StyleSession}.swift.
//
// Inputs from style.test.js and adviserUi.test.js, plus reposts, other
// authors, cursors that end or aren't strings, failures part way, loose
// answers and loose profiles.

import {
  MAX_STYLE_POSTS,
  MIN_STYLE_POSTS,
  extractStyleTexts,
  fetchStylePostTexts,
  forgetStyleProfile,
  learnWritingStyle,
  styleProfileFrom,
  synthesizeStyleFromTexts,
} from '../../../src/posting/adviser/style.js';
import {
  INITIAL_STYLE_VIEW,
  STYLE_STAGES,
  WRITE_STAGE_FLIP_MS,
  styleErrorMessage,
  styleProfileLine,
} from '../../../src/posting/adviser/styleSession.js';
import { createBackendRequester } from '../../../src/session/backendClient.js';
import {
  DEFAULT_LOCALE,
  LOCALE_CHOICES,
  setActiveLocale,
} from '../../../src/lib/locale.js';
import { each, value, withTimeZone } from './_helpers.js';
import { atNow } from './_composer.js';
import { inTurn, json, recordFetch } from './_fetch.js';

export const sources = [
  'src/posting/adviser/style.js',
  'src/posting/adviser/styleSession.js',
];

const ME = 'did:plc:me';
const SERVER = 'https://server.example';
const TOKEN = `vg_${'0f'.repeat(32)}`;
const NOW = Date.parse('2026-11-12T10:00:00Z');
const REPOST = { $type: 'app.bsky.feed.defs#reasonRepost' };

const entry = ({ did = ME, text = 'hello', reason = null } = {}) => ({
  ...(reason ? { reason } : {}),
  post: { author: { did }, record: { text } },
});

const page = (n, { start = 0, cursor = 'next', did = ME } = {}) => ({
  feed: Array.from({ length: n }, (_, i) =>
    entry({ did, text: `post ${start + i}` }),
  ),
  ...(cursor ? { cursor: `${cursor}-${start}` } : {}),
});

const reposts = (n, cursor = 'more') => ({
  feed: Array.from({ length: n }, () => entry({ reason: REPOST })),
  cursor,
});

function memoryStore(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

function snapshot(store) {
  const out = {};
  for (const [k, v] of store.map) out[k] = { json: JSON.parse(v) };
  return out;
}

const errorShape = (err) => ({
  name: err?.name ?? null,
  message: err?.message ?? null,
  status: err?.status ?? null,
  code: err?.code ?? null,
  detail: err?.detail ?? null,
  payload: err?.payload ?? null,
  ...(err?.found !== undefined ? { found: err.found } : {}),
  ...(err?.minimum !== undefined ? { minimum: err.minimum } : {}),
});

/** Runs `fn(store)` over a recorded fetch, the clock held at `now`. */
const recorded = (answers, fn, { now = NOW } = {}) => {
  const store = memoryStore();
  return atNow(now, () =>
    recordFetch(
      inTurn(...(answers.length ? answers : [json({})])),
      async () => {
        try {
          return { value: (await fn(store)) ?? null, store: snapshot(store) };
        } catch (err) {
          return { error: errorShape(err), store: snapshot(store) };
        }
      },
      { now },
    ),
  );
};

const requester = (did = ME) =>
  createBackendRequester({ backendUrl: SERVER, token: () => TOKEN, did });

const FEEDS = [
  {
    $id: 'own-posts-trimmed',
    feed: [entry({ text: ' newest ' }), entry({ text: 'older' })],
  },
  {
    $id: 'reposts-dropped',
    feed: [
      entry({ text: 'mine' }),
      entry({ text: 'not mine', reason: REPOST }),
    ],
  },
  {
    $id: 'others-and-no-text',
    feed: [
      entry({ did: 'did:plc:other', text: 'their post' }),
      entry({ text: '   ' }),
      { post: { author: { did: ME }, record: {} } },
      null,
      entry({ text: 'kept' }),
    ],
  },
  {
    $id: 'loose-entries',
    feed: [
      'x',
      5,
      [],
      { post: { author: { did: ME }, record: { text: 7 } } },
      {
        reason: { $type: 'app.bsky.feed.defs#reasonPin' },
        post: { author: { did: ME }, record: { text: 'pinned' } },
      },
      {
        reason: 'repost',
        post: { author: { did: ME }, record: { text: 'odd reason' } },
      },
      entry({ did: 'did:plc:mé', text: 'nfd author' }),
      entry({ text: '  unicode trimmed　' }),
    ],
  },
  { $id: 'no-feed', feed: undefined },
  { $id: 'feed-not-a-list', feed: { length: 2 } },
];

const FETCHES = [
  { $id: 'one-page', answers: [json(page(40, { cursor: null }))] },
  {
    $id: 'pages-on-with-the-cursor',
    sampleSize: 250,
    answers: [
      json(page(100, { start: 0 })),
      json(page(100, { start: 100 })),
      json(page(100, { start: 200 })),
    ],
  },
  {
    $id: 'page-budget',
    sampleSize: 100,
    answers: [
      json(page(10)),
      json(reposts(100)),
      json(reposts(100)),
      json(reposts(100)),
      json(reposts(100)),
    ],
  },
  {
    $id: 'largest-sample',
    sampleSize: 500,
    answers: [
      json(page(100, { start: 0 })),
      json(page(60, { start: 100 })),
      json(page(100, { start: 160 })),
      json(page(100, { start: 260 })),
      json(page(100, { start: 360 })),
      json(page(100, { start: 460 })),
    ],
  },
  {
    $id: 'unknown-sample-size',
    sampleSize: 9999,
    answers: [json(page(100)), json(page(10, { cursor: null }))],
  },
  {
    $id: 'sample-size-as-text',
    sampleSize: '250',
    answers: [json(page(100)), json(page(30, { start: 100, cursor: null }))],
  },
  { $id: 'not-enough', answers: [json(page(4, { cursor: null }))] },
  { $id: 'none-at-all', answers: [json({ feed: [] })] },
  { $id: 'appview-fails', answers: [json({}, 502)] },
  {
    $id: 'appview-fails-later',
    sampleSize: 250,
    answers: [json(page(100)), json({ error: 'x' }, 500)],
  },
  { $id: 'offline', answers: ['offline'] },
  { $id: 'not-json', answers: [{ status: 200, text: 'nope' }] },
  { $id: 'null-body', answers: [json(null)] },
  {
    $id: 'cursor-a-number',
    answers: [json({ ...page(3), cursor: 7 }), json(page(3, { cursor: '' }))],
  },
  { $id: 'cursor-empty', answers: [json({ ...page(3), cursor: '' })] },
  {
    $id: 'other-authors-only',
    answers: [json(page(50, { did: 'did:plc:other', cursor: null }))],
  },
  { $id: 'needs-an-account', did: '' },
  { $id: 'needs-an-account-null', did: null },
];

const TEXTS = ['a', 'b', 'c', 'd', 'e', 'f'];

const SYNTHESES = [
  {
    $id: 'sends-and-dates',
    texts: TEXTS,
    guidance: '  i capitalize names  ',
    previousSummary: 'Old reading.',
    answers: [
      json({
        success: true,
        summary: ' Writes in lowercase. ',
        analyzedCount: 6,
        usage: { used: 1, limit: 3 },
      }),
    ],
  },
  {
    $id: 'empty-note-left-out',
    texts: TEXTS,
    guidance: '  ',
    answers: [json({ summary: 'x', analyzedCount: 6 })],
  },
  { $id: 'too-few', texts: ['a', 'b'] },
  { $id: 'no-texts', texts: undefined },
  {
    $id: 'exactly-five',
    texts: TEXTS.slice(0, 5),
    answers: [json({ summary: 'five', analyzedCount: 5 })],
  },
  {
    $id: 'empty-reading',
    texts: TEXTS,
    answers: [json({ summary: '  ', analyzedCount: 6 })],
  },
  { $id: 'summary-not-text', texts: TEXTS, answers: [json({ summary: 5 })] },
  {
    $id: 'long-texts-clipped',
    texts: Array.from({ length: 520 }, (_, i) => `t${i}`),
    guidance: 'g'.repeat(700),
    previousSummary: ` ${'p'.repeat(1600)} `,
    answers: [json({ summary: `${'s'.repeat(1600)}`, analyzedCount: 500 })],
  },
  {
    $id: 'unicode-clipped',
    texts: TEXTS,
    guidance: '😀'.repeat(300),
    answers: [json({ summary: '😀'.repeat(800), analyzedCount: 6 })],
  },
  {
    $id: 'monthly-limit',
    texts: TEXTS,
    answers: [json({ error: 'monthly_limit', limit: 3, used: 3 }, 429)],
  },
  {
    $id: 'not-enough-from-the-server',
    texts: TEXTS,
    answers: [json({ error: 'not_enough_posts', minimum: 5 }, 400)],
  },
  {
    $id: 'server-down',
    texts: TEXTS,
    answers: [json({ error: 'Down.' }, 503)],
  },
  { $id: 'needs-the-server', texts: TEXTS, requester: 'none' },
  {
    $id: 'invalid-time',
    texts: TEXTS,
    answers: [json({ summary: 'S', analyzedCount: 6 })],
    now: 9e15,
  },
];

const LEARNS = [
  {
    $id: 'reads-then-sends',
    answers: [
      json(page(20, { cursor: null })),
      json({ summary: 'Short posts.', analyzedCount: 20 }),
    ],
  },
  {
    $id: 'with-a-sample-and-a-note',
    sampleSize: 250,
    guidance: ' keep emoji ',
    previousSummary: 'Before.',
    answers: [
      json(page(100)),
      json(page(100, { start: 100 })),
      json(page(100, { start: 200, cursor: null })),
      json({
        summary: 'After.',
        analyzedCount: 250,
        usage: { used: 2, limit: 3 },
      }),
    ],
  },
  { $id: 'too-few-sends-nothing', answers: [json(page(3, { cursor: null }))] },
  { $id: 'no-account', did: null },
];

const PROFILES = [
  {
    result: {
      summary: 'S',
      analyzedCount: 12.7,
      updatedAt: '2026-11-12T00:00:00Z',
    },
    guidance: 'my note',
  },
  {
    result: { summary: 'x'.repeat(1600), analyzedCount: -3, updatedAt: 5 },
    guidance: 'g'.repeat(600),
  },
  { result: { summary: 7, analyzedCount: '12' } },
  { result: { analyzedCount: Infinity } },
  { result: null, guidance: null },
  { result: { summary: '', analyzedCount: 0 }, guidance: 42 },
];

const ERRORS = [
  { code: 'monthly_limit' },
  { code: 'not_enough_posts', message: 'x' },
  { status: 502 },
  { status: 500, detail: 'Server error.', message: 'Server error.' },
  { status: 499, message: 'Odd.' },
  { status: '503' },
  { code: 'STYLE_FETCH_FAILED', message: 'Couldn’t load.' },
  {
    code: 'EMPTY_STYLE',
    message: 'No style came back from that reading. Try again.',
  },
  {
    code: 'rate_limited',
    status: 429,
    message: 'That’s the limit on AI requests for now. Try again later.',
  },
  { message: '' },
  {},
  null,
];

const LINES = [
  { analyzedCount: 212, updatedAt: '2026-11-12T10:00:00Z' },
  { analyzedCount: 1 },
  {},
  { analyzedCount: 1234, updatedAt: '2026-06-30T23:30:00Z' },
  { analyzedCount: 0, updatedAt: '2026-01-01T00:00:00Z' },
  { analyzedCount: -5, updatedAt: 'not a date' },
  { analyzedCount: '40', updatedAt: '' },
  { analyzedCount: 12.5, updatedAt: 1773576000000 },
  { updatedAt: '2026-03-08T07:30:00Z' },
];

export default async function cases() {
  const all = [
    value('styleConstants', {
      MIN_STYLE_POSTS,
      MAX_STYLE_POSTS,
      STYLE_STAGES,
      WRITE_STAGE_FLIP_MS,
      INITIAL_STYLE_VIEW,
    }),
  ];
  all.push(
    ...(await each('extractStyleTexts', FEEDS, ({ feed }) =>
      extractStyleTexts(feed, ME),
    )),
  );
  all.push(
    ...(await each(
      'extractStyleTextsNoDid',
      [
        {
          feed: [
            entry({ text: 'a' }),
            { post: { record: { text: 'no author' } } },
          ],
        },
      ],
      ({ feed }) => extractStyleTexts(feed, undefined),
    )),
  );
  all.push(
    ...(await each(
      'fetchStylePostTexts',
      FETCHES,
      ({ answers = [], sampleSize, did = ME }) =>
        recorded(answers, async () => {
          const pages = [];
          const texts = await fetchStylePostTexts(did, {
            sampleSize,
            onPage: ({ posts }) => pages.push(posts),
          });
          return { texts, pages };
        }).then((out) => out),
    )),
  );
  all.push(
    ...(await each(
      'synthesizeStyleFromTexts',
      SYNTHESES,
      ({
        answers = [],
        texts,
        guidance,
        previousSummary,
        requester: r,
        now = NOW,
      }) =>
        recorded(
          answers,
          (store) =>
            synthesizeStyleFromTexts(r === 'none' ? null : requester(), {
              texts,
              guidance,
              previousSummary,
              now: new Date(now),
              store,
            }),
          { now: NOW },
        ),
    )),
  );
  all.push(
    ...(await each(
      'learnWritingStyle',
      LEARNS,
      ({ answers = [], did = ME, sampleSize, guidance, previousSummary }) =>
        recorded(answers, async (store) => {
          const pages = [];
          const result = await learnWritingStyle(requester(did), {
            sampleSize,
            guidance,
            previousSummary,
            onPage: ({ posts }) => pages.push(posts),
            store,
          });
          return { result, pages };
        }),
    )),
  );
  all.push(
    ...(await each('styleProfileFrom', PROFILES, ({ result, guidance }) =>
      guidance === undefined
        ? styleProfileFrom(result)
        : styleProfileFrom(result, guidance),
    )),
  );
  all.push(
    ...(await each(
      'forgetStyleProfile',
      [
        {
          profile: {
            summary: 'S',
            analyzedCount: 3,
            updatedAt: 'x',
            guidance: 'keep me',
          },
        },
        { profile: { guidance: 'g'.repeat(600) } },
        { profile: { guidance: 5 } },
        { profile: null },
      ],
      ({ profile }) => forgetStyleProfile(profile),
    )),
  );
  all.push(
    ...(await each(
      'styleErrorMessage',
      ERRORS.map((err) => ({ err })),
      ({ err }) => styleErrorMessage(err),
    )),
  );
  const lines = [];
  for (const locale of LOCALE_CHOICES)
    for (const tz of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo'])
      for (const line of LINES) lines.push({ locale, tz, ...line });
  for (const line of LINES.slice(0, 2))
    lines.push({ locale: 'en-GB', active: 'en-IN', tz: 'UTC', ...line });
  all.push(
    ...(await each(
      'styleProfileLine',
      lines,
      ({ locale, active, tz, ...profile }) =>
        withTimeZone(tz, () => {
          setActiveLocale(active || locale);
          try {
            return styleProfileLine(profile, { locale });
          } finally {
            setActiveLocale(DEFAULT_LOCALE);
          }
        }),
    )),
  );
  return all;
}
