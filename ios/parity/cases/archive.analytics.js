// The dashboard's derivations: buckets in local time (several zones, across
// clock changes, with each first day of the week Settings offers), dense
// series, comparisons, rates, the ranked lists, the archive's shapers and
// the tile formats. Swift: VirgaArchive/Lib/Analytics.swift.

import {
  ANALYTICS_PERIODS,
  ENGAGEMENT_KINDS,
  EVENT_KINDS,
  POST_ROW_VERSION,
  blockReach,
  compactPostFromFeedItem,
  compactPostFromRecord,
  comparePeriods,
  compareRates,
  cumulativeSeries,
  defaultUnitFor,
  didFromAtUri,
  engagementOf,
  fmtCompact,
  fmtDelta,
  givenEvents,
  inboundFromNotification,
  isOwnVoicePost,
  linkHost,
  movingAverage,
  oldestEventMs,
  outboundFromPosts,
  outboundFromRecord,
  rateSeries,
  rollingRate,
  topActors,
  topPosts,
  unitChoicesFor,
  upgradePostRows,
} from '../../../src/lib/analytics.js';
import { value, inZone } from './_helpers.js';
import { LOCALES, eachN, local, under } from './_archive.js';

export const sources = ['src/lib/analytics.js'];

const ME = 'did:plc:me';

const post = (over = {}) => ({
  uri: `at://${ME}/app.bsky.feed.post/${over.rkey || '3abc'}`,
  rkey: '3abc',
  at: '2026-06-10T12:00:00.000Z',
  likes: 0,
  reposts: 0,
  replies: 0,
  quotes: 0,
  replyTo: null,
  quoteOf: null,
  ...over,
});

const PICK_VALUE = {
  count: undefined,
  likes: (p) => p.likes,
  engagement: (p) => engagementOf(p),
};

export default async function cases() {
  const out = [];

  out.push(
    value('constants', {
      POST_ROW_VERSION,
      ANALYTICS_PERIODS,
      ENGAGEMENT_KINDS,
      EVENT_KINDS,
    }),
  );

  out.push(
    ...(await eachN(
      'cumulativeSeries',
      [
        {
          series: [
            { t: 1, v: 2 },
            { t: 2, v: 0 },
            { t: 3, v: 3 },
          ],
          baseline: 100,
        },
        {
          series: [
            { t: 1, v: 2.5 },
            { t: 2, v: -1 },
          ],
        },
        { series: [], baseline: 4 },
        { series: null },
      ],
      ({ series, baseline }) => cumulativeSeries(series, baseline),
    )),
  );

  const bumpy = [4, 1, 0, 9, 2, 2, 7, 3, 0, 0, 11, 5].map((v, i) => ({
    t: i * 10,
    v,
  }));
  out.push(
    ...(await eachN(
      'movingAverage',
      [
        ...[7, 3, 1, 0, 2, 5.5, 8, 30, -4, '$Infinity'].map((window) => ({
          $id: `window ${window}`,
          series: bumpy,
          window,
        })),
        { $id: 'default', series: bumpy },
        {
          $id: 'flat',
          series: [4, 4, 4, 4].map((v, i) => ({ t: i, v })),
          window: 3,
        },
        { $id: 'one', series: [{ t: 5, v: 3 }], window: 7 },
        { $id: 'empty', series: [], window: 7 },
        { $id: 'null', series: null, window: 7 },
      ],
      ({ series, window }) => movingAverage(series, window),
    )),
  );

  // Comparisons: in a few zones, since zone-less strings read as local time.
  const compareItems = (zone) =>
    inZone(zone, () => [
      { at: local(2026, 6, 19), likes: 3 },
      { at: local(2026, 6, 18), likes: 1 },
      { at: new Date(local(2026, 6, 13, 12)).toISOString(), likes: 2 },
      { at: '2026-06-12T12:00:00', likes: 5 },
      { at: local(2026, 6, 6, 12), likes: 8 },
      { at: local(2026, 6, 6, 11, 59), likes: 13 },
      { at: local(2026, 6, 1), likes: 21 },
      { at: local(2026, 6, 21), likes: 34 },
      { at: 'garbage', likes: 55 },
      { at: local(2026, 6, 19, 1), likes: 'x' },
    ]);
  out.push(
    ...(await eachN(
      'comparePeriods',
      ['UTC', 'America/New_York', 'Asia/Kolkata', 'Pacific/Chatham'].flatMap(
        (zone) => {
          const now = inZone(zone, () => local(2026, 6, 20));
          return [7, 1, 14, 0, null, 2.5].flatMap((days) =>
            ['count', 'likes'].map((pickValue) => ({
              $id: `${zone} ${days} ${pickValue}`,
              zone,
              days,
              now,
              pickValue,
              items: compareItems(zone),
            })),
          );
        },
      ),
      ({ zone, days, now, pickValue, items }) =>
        under({ zone }, () =>
          comparePeriods(items, {
            days,
            now,
            pickValue: PICK_VALUE[pickValue],
          }),
        ),
    )),
  );
  out.push(
    ...(await eachN(
      'comparePeriods',
      [
        {
          $id: 'refuses-over-zero',
          items: [{ at: Date.UTC(2026, 5, 19) }],
          days: 7,
          now: Date.UTC(2026, 5, 20),
        },
        {
          $id: 'only-previous',
          items: [{ at: Date.UTC(2026, 5, 12) }],
          days: 7,
          now: Date.UTC(2026, 5, 20),
        },
        { $id: 'none', items: null, days: 7, now: Date.UTC(2026, 5, 20) },
      ],
      ({ items, days, now }) => comparePeriods(items, { days, now }),
    )),
  );

  // Rates.
  const ratePost = (day, likes, over = {}) =>
    post({
      uri: `at://${ME}/app.bsky.feed.post/r${day}${likes}`,
      at: new Date(Date.UTC(2026, 5, day, 12)).toISOString(),
      likes,
      ...over,
    });
  const ratePosts = [
    ratePost(1, 10),
    ratePost(1, 2, { reposts: 3 }),
    ratePost(3, 5, { replies: 1, quotes: 2 }),
    ratePost(4, 0, { atMs: Date.UTC(2026, 5, 6, 12) }),
    ratePost(5, 7, { at: 'garbage' }),
    ...Array.from({ length: 9 }, (_, i) =>
      ratePost(2, 0, { uri: `at://${ME}/app.bsky.feed.post/n${i}` }),
    ),
  ];
  const rateInputs = [];
  for (const zone of ['UTC', 'America/Sao_Paulo', 'Asia/Kolkata']) {
    for (const unit of ['day', 'week']) {
      for (const kind of [
        'all',
        'like',
        'repost',
        'reply',
        'quote',
        'mention',
      ]) {
        rateInputs.push({
          $id: `${zone} ${unit} ${kind}`,
          zone,
          unit,
          kind,
          t0: Date.UTC(2026, 5, 1, 0),
          t1: Date.UTC(2026, 5, 7, 23),
          posts: ratePosts,
        });
      }
    }
  }
  out.push(
    ...(await eachN(
      'rateSeries',
      rateInputs,
      ({ zone, unit, kind, t0, t1, posts }) =>
        under({ zone }, () => rateSeries(posts, { unit, t0, t1, kind })),
    )),
  );

  const rated = inZone('UTC', () =>
    rateSeries(ratePosts, {
      unit: 'day',
      t0: Date.UTC(2026, 5, 1),
      t1: Date.UTC(2026, 5, 7, 23),
    }),
  );
  out.push(
    ...(await eachN(
      'rollingRate',
      [
        ...[7, 3, 1, 0, 2.5, '$Infinity'].map((window) => ({
          $id: `window ${window}`,
          series: rated,
          window,
        })),
        { $id: 'default', series: rated },
        {
          $id: 'no-posts',
          series: [{ t: 0, v: null, total: 0, posts: 0 }],
          window: 3,
        },
        { $id: 'empty', series: [], window: 3 },
      ],
      ({ series, window }) => rollingRate(series, window),
    )),
  );

  out.push(
    ...(await eachN(
      'compareRates',
      [7, 1, 3, 0, null].flatMap((days) =>
        ['all', 'like', 'reply'].map((kind) => ({
          $id: `${days} ${kind}`,
          days,
          kind,
          now: Date.UTC(2026, 5, 6, 13),
          posts: ratePosts,
        })),
      ),
      ({ days, kind, now, posts }) => compareRates(posts, { days, now, kind }),
    )),
  );
  out.push(
    ...(await eachN(
      'compareRates',
      [
        {
          $id: 'web-test',
          days: 7,
          now: Date.UTC(2026, 5, 20, 12),
          posts: [ratePost(19, 8), ratePost(18, 4), ratePost(12, 3)],
        },
        {
          $id: 'no-previous',
          days: 7,
          now: Date.UTC(2026, 5, 20, 12),
          posts: [ratePost(19, 8)],
        },
        {
          $id: 'previous-zero',
          days: 7,
          now: Date.UTC(2026, 5, 20, 12),
          posts: [ratePost(19, 8), ratePost(12, 0)],
        },
        { $id: 'none', days: 7, now: Date.UTC(2026, 5, 20, 12), posts: null },
      ],
      ({ days, now, posts }) => compareRates(posts, { days, now }),
    )),
  );

  out.push(
    ...(await eachN(
      'isOwnVoicePost',
      [
        { post: post(), owner: ME },
        { post: post({ replyTo: ME }), owner: ME },
        { post: post({ replyTo: 'did:plc:them' }), owner: ME },
        { post: post({ replyTo: '' }), owner: ME },
        { post: null, owner: ME },
        { post: post({ replyTo: ME }), owner: null },
      ],
      ({ post: p, owner }) => isOwnVoicePost(p, owner),
    )),
  );

  out.push(
    ...(await eachN(
      'givenEvents',
      [
        {
          outbound: [
            {
              uri: 'l1',
              did: 'did:plc:a',
              kind: 'like',
              at: '2026-06-01T00:00:00Z',
            },
            { uri: 'l2', did: ME, kind: 'like', at: '2026-06-01T00:00:00Z' },
            { uri: 'l3', did: '', kind: 'repost', at: '2026-06-01T00:00:00Z' },
          ],
          posts: [
            post({
              uri: 'p1',
              at: '2026-06-02T00:00:00Z',
              replyTo: 'did:plc:b',
            }),
            post({
              uri: 'p2',
              at: '2026-06-02T00:00:00Z',
              replyTo: ME,
              quoteOf: 'did:plc:c',
            }),
            post({ uri: 'p3', at: '2026-06-03T00:00:00Z', quoteOf: ME }),
          ],
          owner: ME,
        },
        { outbound: null, posts: null, owner: ME },
      ],
      ({ outbound, posts, owner }) => givenEvents(outbound, posts, owner),
    )),
  );

  const ranked = [
    post({ uri: 'a', at: '2026-06-10T12:00:00.000Z', likes: 5, replies: 9 }),
    post({ uri: 'b', at: '2026-06-11T12:00:00.000Z', likes: 5, replies: 1 }),
    post({ uri: 'c', at: '2026-06-12T12:00:00.000Z', likes: 1 }),
    post({ uri: 'd', at: '2026-06-11T12:00:00.000Z', likes: 5, replies: 1 }),
    post({ uri: 'e', at: 'garbage', likes: 99 }),
    post({ uri: 'f', at: '2026-06-09T12:00:00', reposts: 4, quotes: 4 }),
  ];
  out.push(
    ...(await eachN(
      'topPosts',
      [
        { kind: 'like', limit: 2 },
        { kind: 'reply', limit: 1 },
        { kind: 'all', t0: Date.UTC(2026, 5, 12), limit: 5 },
        { kind: 'all' },
        { kind: 'quote', t1: Date.UTC(2026, 5, 11, 12) },
        { kind: 'mention', limit: 3 },
        { kind: 'all', limit: 0 },
        { kind: 'all', limit: -2 },
      ].flatMap((opts) =>
        ['UTC', 'Asia/Kolkata'].map((zone) => ({
          $id: `${zone} ${JSON.stringify(opts)}`,
          zone,
          ...opts,
          posts: ranked,
        })),
      ),
      ({ zone, posts, ...opts }) =>
        under({ zone }, () => topPosts(posts, opts)),
    )),
  );

  const events = [
    { uri: '1', did: 'did:plc:ana', kind: 'like', at: Date.UTC(2026, 5, 10) },
    { uri: '2', did: 'did:plc:ana', kind: 'reply', at: '2026-06-11T00:00:00Z' },
    { uri: '3', did: 'did:plc:bo', kind: 'like', at: Date.UTC(2026, 5, 11) },
    { uri: '4', did: 'did:plc:me', kind: 'like', at: Date.UTC(2026, 5, 11) },
    { uri: '5', did: 'did:plc:old', kind: 'like', at: Date.UTC(2026, 5, 1) },
    { uri: '6', did: 'did:plc:bo', kind: 'quote', at: '2026-06-11T08:00:00' },
    { uri: '7', did: 'did:plc:Ana', kind: 'like', at: Date.UTC(2026, 5, 10) },
    { uri: '8', did: 'did:plc:cy', kind: 'mention', at: 'garbage' },
    { uri: '9', did: '', kind: 'like', at: Date.UTC(2026, 5, 10) },
    { uri: '10', did: 'did:plc:dee', at: Date.UTC(2026, 5, 10) },
    {
      uri: '11',
      did: 'did:plc:bo',
      kind: 'like',
      at: Date.UTC(2026, 5, 10, 5),
    },
  ];
  out.push(
    ...(await eachN(
      'topActors',
      [
        {
          t0: Date.UTC(2026, 5, 9),
          t1: Date.UTC(2026, 5, 12),
          excludeDid: 'did:plc:me',
        },
        { kind: 'like', t0: Date.UTC(2026, 5, 9), t1: Date.UTC(2026, 5, 12) },
        { kind: 'quote' },
        {},
        { limit: 1 },
        { limit: 0 },
      ].flatMap((opts) =>
        ['UTC', 'America/New_York'].map((zone) => ({
          $id: `${zone} ${JSON.stringify(opts)}`,
          zone,
          ...opts,
          events,
        })),
      ),
      ({ zone, events: evs, ...opts }) =>
        under({ zone }, () => topActors(evs, opts)),
    )),
  );

  out.push(
    ...(await eachN(
      'blockReach',
      [
        {
          $id: 'web-test',
          blocks: [
            {
              uri: 'direct-a',
              did: 'did:a',
              source: 'direct',
              blockedAt: '2026-06-12T12:00:00.000Z',
            },
            {
              uri: 'list-a-1',
              did: 'did:a',
              source: 'list',
              blockedAt: '2026-06-10T12:00:00.000Z',
            },
            {
              uri: 'list-a-2',
              did: 'did:a',
              source: 'list',
              blockedAt: '2026-06-11T12:00:00.000Z',
            },
            {
              uri: 'list-b',
              did: 'did:b',
              source: 'list',
              blockedAt: '2026-06-13T12:00:00.000Z',
            },
          ],
        },
        { $id: 'old-rows', blocks: [{ uri: 'old', did: 'did:old' }] },
        {
          $id: 'ties-and-undated',
          blocks: [
            {
              uri: 'l',
              did: 'did:t',
              source: 'list',
              blockedAt: '2026-06-10T12:00:00.000Z',
            },
            {
              uri: 'd',
              did: 'did:t',
              source: 'direct',
              blockedAt: '2026-06-10T12:00:00.000Z',
            },
            { uri: 'u', did: 'did:u', source: 'list', blockedAt: null },
            { uri: 'v', did: 'did:v', source: 'weird', blockedAt: 'garbage' },
            { uri: 'w', did: '', source: 'direct' },
            {
              uri: 'x',
              did: 'did:x',
              source: 'list',
              blockedAt: '2026-06-10T12:00:00',
            },
          ],
        },
        { $id: 'none', blocks: null },
      ],
      ({ blocks }) => blockReach(blocks),
    )),
  );

  out.push(
    ...(await eachN(
      'engagementOf',
      [
        { post: { likes: 1, reposts: 2, replies: 3, quotes: 4 } },
        ...[
          'all',
          'like',
          'repost',
          'reply',
          'quote',
          'mention',
          'toString',
          '',
        ].map((kind) => ({
          $id: `kind ${kind}`,
          post: { likes: 1, reposts: 2, replies: 3, quotes: 4 },
          kind,
        })),
        { post: { likes: 5 } },
        { post: null },
        { post: {}, kind: 'like' },
      ],
      ({ post: p, kind }) => engagementOf(p, kind),
    )),
  );

  out.push(
    ...(await eachN(
      'didFromAtUri',
      [
        'at://did:plc:abc/app.bsky.feed.post/1',
        'at://did:plc:abc',
        'at://did:/x',
        'at://did:web:example.com/app.bsky.feed.post/1',
        'at://alice.bsky.social/app.bsky.feed.post/1',
        'https://bsky.app/x',
        ' at://did:plc:abc/x',
        'at://did:plc:é́/x',
        '',
        null,
      ].map((uri) => ({ uri })),
      ({ uri }) => didFromAtUri(uri),
    )),
  );

  out.push(
    ...(await eachN(
      'linkHost',
      [
        'https://www.Example.com/a/b?c=1',
        'https://example.com',
        'http://WWW.example.org:8080/x',
        'https://www.',
        'https://wwwx.example.com',
        'mailto:someone@example.com',
        'foo://Bar.Example/x',
        'not a url',
        'https://xn--bcher-kva.example/',
        'https://bücher.example/',
        'https://[::1]/',
        'https://192.168.0.1/',
        'file:///etc/passwd',
        '',
        null,
      ].map((uri) => ({ uri })),
      ({ uri }) => linkHost(uri ?? undefined),
    )),
  );

  // The shapers.
  const base = {
    uri: `at://${ME}/app.bsky.feed.post/3abc`,
    likeCount: 2,
    repostCount: 1,
    replyCount: 0,
    quoteCount: 4,
    record: { text: 'hello atmosphere', createdAt: '2026-06-10T12:00:00.000Z' },
  };
  const withRecord = (over) => ({
    post: { ...base, record: { ...base.record, ...over } },
  });
  const feedItems = [
    ['plain', { post: base }],
    [
      'repost',
      { post: base, reason: { $type: 'app.bsky.feed.defs#reasonRepost' } },
    ],
    ['pin', { post: base, reason: null }],
    [
      'reply',
      withRecord({
        reply: { parent: { uri: 'at://did:plc:parent/app.bsky.feed.post/1' } },
      }),
    ],
    [
      'quote',
      withRecord({
        embed: {
          $type: 'app.bsky.embed.record',
          record: { uri: 'at://did:plc:quoted/app.bsky.feed.post/2' },
        },
      }),
    ],
    [
      'quote-with-media',
      withRecord({
        embed: {
          $type: 'app.bsky.embed.recordWithMedia',
          record: {
            record: { uri: 'at://did:plc:quoted/app.bsky.feed.post/3' },
          },
          media: { $type: 'app.bsky.embed.images' },
        },
      }),
    ],
    ['undated', { post: { ...base, record: { text: 'x' } } }],
    ['bad-date', withRecord({ createdAt: 'yesterday-ish' })],
    ['local-date', withRecord({ createdAt: '2026-06-10T12:00:00' })],
    ['long', withRecord({ text: 'y'.repeat(280) })],
    ['emoji', withRecord({ text: 'hi 👨‍👩‍👧 é́ 🇬🇧' })],
    ['not-text', withRecord({ text: 42 })],
    [
      'facets',
      withRecord({
        text: 'see #Gardens and example.com with @someone',
        tags: ['allotment', '#Gardens', '  #spaced  ', '#', '', 7, 'allotment'],
        facets: [
          {
            features: [
              { $type: 'app.bsky.richtext.facet#tag', tag: 'Gardens' },
            ],
          },
          {
            features: [
              {
                $type: 'app.bsky.richtext.facet#link',
                uri: 'https://www.Example.com/a/b?c=1',
              },
            ],
          },
          {
            features: [
              { $type: 'app.bsky.richtext.facet#link', uri: 'not a url' },
            ],
          },
          {
            features: [
              {
                $type: 'app.bsky.richtext.facet#link',
                uri: 'https://example.com/again',
              },
            ],
          },
          {
            features: [
              {
                $type: 'app.bsky.richtext.facet#mention',
                did: 'did:plc:someone',
              },
            ],
          },
          { features: [{ $type: 'app.bsky.richtext.facet#mention', did: 5 }] },
          {
            features: [
              { $type: 'app.bsky.richtext.facet#tag', tag: '##double' },
            ],
          },
          { features: 'nope' },
          null,
          { features: [null, { $type: 'other' }] },
        ],
      }),
    ],
    ['facets-not-array', withRecord({ facets: { features: [] }, tags: 'tag' })],
    [
      'images',
      withRecord({
        embed: {
          $type: 'app.bsky.embed.images',
          images: [{ alt: 'A heron' }, { alt: '  ' }, {}, { alt: 3 }],
        },
      }),
    ],
    [
      'images-not-array',
      withRecord({ embed: { $type: 'app.bsky.embed.images', images: 'x' } }),
    ],
    [
      'video',
      withRecord({ embed: { $type: 'app.bsky.embed.video', alt: 'A canal' } }),
    ],
    [
      'video-no-alt',
      withRecord({ embed: { $type: 'app.bsky.embed.video', alt: '\n' } }),
    ],
    [
      'card',
      withRecord({
        embed: {
          $type: 'app.bsky.embed.external',
          external: { uri: 'https://news.example.org/story' },
        },
      }),
    ],
    [
      'card-also-faceted',
      withRecord({
        embed: {
          $type: 'app.bsky.embed.external',
          external: { uri: 'https://www.news.example.org/story' },
        },
        facets: [
          {
            features: [
              {
                $type: 'app.bsky.richtext.facet#link',
                uri: 'https://news.example.org/',
              },
            ],
          },
        ],
      }),
    ],
    [
      'gif',
      withRecord({
        embed: {
          $type: 'app.bsky.embed.external',
          external: { uri: 'https://media.tenor.com/abc/x.gif' },
        },
      }),
    ],
    [
      'giphy',
      withRecord({
        embed: {
          $type: 'app.bsky.embed.external',
          external: { uri: 'https://giphy.com/x' },
        },
      }),
    ],
    [
      'not-gif',
      withRecord({
        embed: {
          $type: 'app.bsky.embed.external',
          external: { uri: 'https://notgiphy.com/x' },
        },
      }),
    ],
    [
      'card-bad-uri',
      withRecord({
        embed: { $type: 'app.bsky.embed.external', external: { uri: 'nope' } },
      }),
    ],
    [
      'quote-with-pictures',
      withRecord({
        embed: {
          $type: 'app.bsky.embed.recordWithMedia',
          record: {
            record: { uri: 'at://did:plc:other/app.bsky.feed.post/3q' },
          },
          media: { $type: 'app.bsky.embed.images', images: [{ alt: 'x' }] },
        },
      }),
    ],
    ['embed-string', withRecord({ embed: 'x' })],
    ['embed-array', withRecord({ embed: [] })],
    [
      'embed-unknown',
      withRecord({ embed: { $type: 'app.bsky.embed.somethingNew' } }),
    ],
    [
      'thread',
      withRecord({
        langs: ['en', 'fr', '', 3, 'de', 'ja'],
        reply: {
          parent: { uri: 'at://did:plc:me/app.bsky.feed.post/3parent' },
          root: { uri: 'at://did:plc:me/app.bsky.feed.post/3root?x#y' },
        },
      }),
    ],
    [
      'root-not-uri',
      withRecord({
        reply: {
          parent: { uri: 'https://x' },
          root: { uri: 'at://did:plc:me/onlycollection' },
        },
      }),
    ],
    ['langs-not-array', withRecord({ langs: 'en' })],
    ['counts-missing', { post: { uri: base.uri, record: base.record } }],
    [
      'counts-zero-and-nan',
      { post: { ...base, likeCount: 0, repostCount: null } },
    ],
    ['no-record', { post: { uri: base.uri } }],
    ['no-uri', { post: { record: base.record } }],
    [
      'rkey-trailing-slash',
      { post: { ...base, uri: 'at://did:plc:me/app.bsky.feed.post/' } },
    ],
    ['null', null],
  ];
  out.push(
    ...(await eachN(
      'compactPostFromFeedItem',
      feedItems.map(([$id, item]) => ({ $id, item })),
      ({ item }) => compactPostFromFeedItem(item),
    )),
  );
  out.push(
    ...(await eachN(
      'compactPostFromFeedItem',
      ['America/New_York', 'Asia/Kolkata'].map((zone) => ({
        $id: `${zone} local-date`,
        zone,
        item: withRecord({ createdAt: '2026-06-10T12:00:00' }),
      })),
      ({ zone, item }) => under({ zone }, () => compactPostFromFeedItem(item)),
    )),
  );

  const recordUri = `at://${ME}/app.bsky.feed.post/3abc`;
  out.push(
    ...(await eachN(
      'compactPostFromRecord',
      [
        {
          $id: 'web-test',
          uri: recordUri,
          record: {
            text: 'from the car',
            createdAt: '2026-06-10T12:00:00.000Z',
            reply: {
              parent: { uri: 'at://did:plc:parent/app.bsky.feed.post/1' },
            },
            embed: {
              $type: 'app.bsky.embed.record',
              record: { uri: 'at://did:plc:quoted/app.bsky.feed.post/2' },
            },
          },
        },
        { $id: 'undated', uri: recordUri, record: { text: 'x' } },
        {
          $id: 'no-uri',
          uri: null,
          record: { createdAt: '2026-06-10T12:00:00.000Z' },
        },
        {
          $id: 'empty-uri',
          uri: '',
          record: { createdAt: '2026-06-10T12:00:00.000Z' },
        },
        { $id: 'no-record', uri: recordUri, record: null },
        {
          $id: 'no-slash',
          uri: 'plainkey',
          record: { createdAt: '2026-06-10T12:00:00.000Z', text: 'x' },
        },
      ],
      ({ uri, record }) => compactPostFromRecord(uri, record),
    )),
  );

  const old = {
    uri: recordUri,
    rkey: '3abc',
    at: '2026-06-10T12:00:00.000Z',
    text: 'x'.repeat(200),
    replyTo: null,
    quoteOf: null,
    hasMedia: false,
    likes: 7,
    reposts: 2,
    replies: 1,
    quotes: 0,
  };
  out.push(
    ...(await eachN(
      'upgradePostRows',
      [
        {
          $id: 'fills-in',
          rows: [
            old,
            { ...old, uri: 'at://did:plc:me/app.bsky.feed.post/gone' },
          ],
          records: [
            [
              recordUri,
              {
                text: `${'x'.repeat(250)} #tag`,
                createdAt: old.at,
                facets: [
                  {
                    features: [
                      { $type: 'app.bsky.richtext.facet#tag', tag: 'tag' },
                    ],
                  },
                ],
                embed: {
                  $type: 'app.bsky.embed.images',
                  images: [{ alt: 'a' }],
                },
              },
            ],
          ],
        },
        { $id: 'gone', rows: [old], records: [] },
        {
          $id: 'undated',
          rows: [old],
          records: [[recordUri, { text: 'no date' }]],
        },
        { $id: 'falsy-record', rows: [old], records: [[recordUri, 0]] },
        { $id: 'nothing', rows: null, records: null },
      ],
      ({ rows, records }) =>
        upgradePostRows(rows, records ? new Map(records) : null),
    )),
  );

  const note = (over) => ({
    uri: 'at://did:plc:them/app.bsky.feed.like/1',
    reason: 'like',
    author: { did: 'did:plc:them' },
    indexedAt: '2026-06-10T12:00:00.000Z',
    ...over,
  });
  out.push(
    ...(await eachN(
      'inboundFromNotification',
      [
        ...[
          'like',
          'repost',
          'reply',
          'quote',
          'mention',
          'follow',
          'starterpack-joined',
          'like-via-repost',
          'verified',
        ].map((reason) => ({
          $id: reason,
          n: note({ reason, uri: `at://did:plc:them/x/${reason}` }),
        })),
        {
          $id: 'subject',
          n: note({ reasonSubject: 'at://did:plc:me/app.bsky.feed.post/3abc' }),
        },
        { $id: 'subject-not-uri', n: note({ reasonSubject: 'not a uri' }) },
        { $id: 'subject-not-string', n: note({ reasonSubject: 7 }) },
        {
          $id: 'created-wins',
          n: note({ record: { createdAt: '2026-06-09T00:00:00.000Z' } }),
        },
        { $id: 'created-bad', n: note({ record: { createdAt: 'garbage' } }) },
        { $id: 'created-empty', n: note({ record: { createdAt: '' } }) },
        { $id: 'no-time', n: note({ indexedAt: null }) },
        { $id: 'no-author', n: note({ author: null }) },
        { $id: 'no-uri', n: note({ uri: '' }) },
        { $id: 'null', n: null },
      ],
      ({ n }) => inboundFromNotification(n),
    )),
  );

  out.push(
    ...(await eachN(
      'outboundFromRecord',
      [
        {
          $id: 'like',
          kind: 'like',
          record: {
            uri: 'at://did:plc:me/app.bsky.feed.like/3abc',
            value: {
              subject: { uri: 'at://did:plc:them/app.bsky.feed.post/9' },
              createdAt: '2026-06-10T12:00:00.000Z',
            },
          },
        },
        {
          $id: 'repost',
          kind: 'repost',
          record: {
            uri: 'at://did:plc:me/app.bsky.feed.repost/3abd',
            value: {
              subject: { uri: 'at://did:plc:them/app.bsky.feed.post/9' },
              createdAt: '2026-06-10T12:00:00',
            },
          },
        },
        {
          $id: 'no-subject',
          kind: 'like',
          record: {
            uri: 'at://x',
            value: { createdAt: '2026-06-10T12:00:00.000Z' },
          },
        },
        {
          $id: 'handle-subject',
          kind: 'like',
          record: {
            uri: 'at://x',
            value: {
              subject: { uri: 'at://alice.test/p/1' },
              createdAt: '2026-06-10T12:00:00.000Z',
            },
          },
        },
        {
          $id: 'undated',
          kind: 'like',
          record: {
            uri: 'at://x',
            value: { subject: { uri: 'at://did:plc:them/p/1' } },
          },
        },
        {
          $id: 'no-uri',
          kind: 'like',
          record: {
            value: {
              subject: { uri: 'at://did:plc:them/p/1' },
              createdAt: '2026-06-10T12:00:00.000Z',
            },
          },
        },
        { $id: 'null', kind: 'like', record: null },
      ],
      ({ kind, record }) => outboundFromRecord(kind, record),
    )),
  );

  out.push(
    ...(await eachN(
      'outboundFromPosts',
      [
        {
          posts: [
            post({
              uri: 'at://me/p/1',
              at: '2026-06-10T12:00:00.000Z',
              replyTo: 'did:plc:a',
              quoteOf: 'did:plc:b',
            }),
            post({ uri: 'at://me/p/2', at: '2026-06-10T12:00:00.000Z' }),
            post({
              uri: 'at://me/p/3',
              at: '2026-06-11T12:00:00.000Z',
              quoteOf: 'did:plc:c',
            }),
          ],
        },
        { posts: [] },
        { posts: null },
      ],
      ({ posts }) => outboundFromPosts(posts),
    )),
  );

  out.push(
    ...(await eachN(
      'unitChoices',
      [7, 31, 31.5, 32, 90, 120, 121, 365, 366, 367, 0, -1, null, '$NaN'].map(
        (span) => ({ span }),
      ),
      ({ span }) => ({
        choices: unitChoicesFor(span),
        default: defaultUnitFor(span),
      }),
    )),
  );

  out.push(
    ...(await eachN(
      'fmtCompact',
      LOCALES.flatMap((locale) =>
        [
          5935,
          24736,
          10000,
          9999.5,
          1_200_000,
          999_999,
          1_000_000,
          10_950,
          12_345_678.9,
          -24736,
          -5000.5,
          0,
          0.4,
          -0.4,
          1234.5,
          null,
          '$NaN',
          '$Infinity',
        ].map((n) => ({ $id: `${locale} ${n}`, locale, n })),
      ),
      ({ locale, n }) => under({ locale }, () => fmtCompact(n)),
    )),
  );

  out.push(
    ...(await eachN(
      'fmtDelta',
      [
        12.4,
        -3.21,
        0,
        null,
        100,
        9.95,
        -9.95,
        10,
        0.04,
        -0.04,
        1e21,
        '$NaN',
        0.05,
        250.5,
      ].map((pct) => ({ pct })),
      ({ pct }) => fmtDelta(pct),
    )),
  );

  out.push(
    ...(await eachN(
      'oldestEventMs',
      [
        {
          events: [{ at: Date.UTC(2026, 5, 10) }, { at: Date.UTC(2026, 5, 3) }],
        },
        {
          events: [
            { at: '2026-06-10T00:00:00Z' },
            { at: 'garbage' },
            { at: Date.UTC(2026, 5, 12) },
            {},
            null,
          ],
        },
        { events: [{ at: '2026-06-10T00:00:00' }], zone: 'America/New_York' },
        { events: [] },
        { events: null },
      ],
      ({ events: evs, zone }) => under({ zone }, () => oldestEventMs(evs)),
    )),
  );

  return out;
}
