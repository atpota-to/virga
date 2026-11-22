// The Interaction lookup (src/tools/interactionModel.js): everything the
// archive holds between the account and one other, each way. Over the
// lookup's own tests' archive (built in three zones, so months fall on the
// reader's calendar), the harness's account (its most engaged people, a
// follower, a stranger and itself) and hand-made edges; then the directory
// and its search, the filters, the words, the export and naming an
// account. Nothing here reads the network. Swift:
// VirgaInsights/Tools/InteractionModel*.swift.

import {
  DIRECTIONS,
  KIND_LABEL,
  KIND_NOUN,
  LOOKUP_KINDS,
  LOOKUP_PATH,
  OUTBOUND_KINDS,
  eventPhrase,
  eventsCsvRows,
  filterEvents,
  interactionIndex,
  interactionModel,
  isDid,
  keepsMentions,
  kindsLine,
  lookupHref,
  matchPeople,
  parseActorInput,
  peopleDirectory,
} from '../../../src/tools/interactionModel.js';
import { each, value } from './_helpers.js';
import { under } from './_archive.js';
import {
  NOW as HARNESS_NOW,
  archiveCases,
  compact,
  contexts,
  harnessArchives,
  roundTrip,
} from './_reports.js';

export const sources = ['src/tools/interactionModel.js'];

const ME = 'did:plc:me';
const ADA = 'did:plc:ada';
const BO = 'did:plc:bo';
const CY = 'did:plc:cy';
const DEE = 'did:plc:dee';
const STRANGER = 'did:plc:stranger';
const NFC = 'did:plc:café';
const NFD = 'did:plc:café';
const WHO = [ADA, BO, CY, DEE, STRANGER, ME, NFC, NFD];

const ZONES = ['UTC', 'America/New_York', 'Pacific/Chatham'];

/** The lookup's own tests' archives, built in `zone` (they name local days). */
function testArchives(zone) {
  return under({ zone }, () => {
    const NOW = new Date(2026, 10, 14, 12).getTime();
    const at = (year, month, day, hour = 12) =>
      new Date(year, month - 1, day, hour).toISOString();
    let n = 0;
    const inbound = (did, kind, when, extra = {}) => ({
      uri: `at://${did}/app.bsky.feed.${kind === 'like' || kind === 'repost' ? kind : 'post'}/in${n++}`,
      did,
      kind,
      at: when,
      ...extra,
    });
    const outbound = (did, kind, when, extra = {}) => ({
      uri: `at://${ME}/app.bsky.feed.${kind}/out${n++}`,
      did,
      kind,
      at: when,
      ...extra,
    });
    const post = (rkey, when, extra = {}) => ({
      uri: `at://${ME}/app.bsky.feed.post/${rkey}`,
      rkey,
      at: when,
      text: `post ${rkey}`,
      replyTo: null,
      quoteOf: null,
      hasMedia: false,
      likes: 0,
      reposts: 0,
      replies: 0,
      quotes: 0,
      ...extra,
    });
    const archiveOf = (parts = {}) => ({
      did: ME,
      handle: 'me.example.com',
      posts: [],
      followers: [],
      following: [],
      blocks: [],
      inbound: [],
      outbound: [],
      atmosphere: [],
      meta: {
        posts: { complete: true },
        followers: { complete: true },
        following: { complete: true },
      },
      ...parts,
    });
    const follower = (did, handle, displayName, followedAt) => ({
      did,
      handle,
      displayName,
      avatar: '',
      followedAt,
    });
    const world = archiveOf({
      inbound: [
        inbound(ADA, 'like', at(2026, 8, 3)),
        inbound(ADA, 'like', at(2026, 8, 20)),
        inbound(ADA, 'reply', at(2026, 9, 2)),
        inbound(ADA, 'mention', at(2026, 11, 1)),
        inbound(BO, 'repost', at(2026, 7, 9)),
        inbound(BO, 'quote', at(2026, 10, 5)),
      ],
      outbound: [
        outbound(ADA, 'like', at(2024, 3, 10)),
        outbound(ADA, 'like', at(2026, 9, 3)),
        outbound(ADA, 'repost', at(2026, 9, 4)),
        outbound(CY, 'like', at(2025, 1, 15)),
      ],
      posts: [
        post('own', at(2026, 6, 1)),
        post('thread', at(2026, 6, 2), { replyTo: ME }),
        post('toada', at(2026, 9, 5), {
          replyTo: ADA,
          text: 'Agreed, and thank you',
        }),
        post('quoteada', at(2026, 10, 1), { quoteOf: ADA }),
        post('both', at(2026, 10, 2), { replyTo: ADA, quoteOf: ADA }),
        post('tocy', at(2025, 2, 1), { replyTo: CY }),
      ],
      followers: [
        follower(ADA, 'ada.example.com', 'Ada Lindqvist', at(2025, 5, 5)),
        follower(DEE, 'dee.example.com', '', null),
      ],
      following: [
        {
          uri: `at://${ME}/app.bsky.graph.follow/a1`,
          did: ADA,
          followedAt: at(2025, 6, 1),
        },
        {
          uri: `at://${ME}/app.bsky.graph.follow/c1`,
          did: CY,
          followedAt: null,
        },
      ],
    });
    const own = (rkey) => `at://${ME}/app.bsky.feed.post/${rkey}`;
    const noticedAt = new Date(2026, 9, 20).getTime();
    const since = new Date(2026, 9, 13).getTime();
    const left = archiveOf({
      meta: {
        followers: { complete: true },
        followerLog: {
          entries: [
            {
              did: BO,
              kind: 'lost',
              at: noticedAt,
              since,
              followedAt: at(2025, 1, 1),
            },
            {
              did: BO,
              kind: 'gained',
              at: 1,
              since: null,
              followedAt: at(2025, 1, 1),
            },
            { did: CY, kind: 'gained', at: noticedAt, since, followedAt: null },
            {
              did: DEE,
              kind: 'lost',
              at: 0,
              since: 0,
              followedAt: 'not a date',
            },
          ],
        },
      },
    });
    return roundTrip({
      world,
      mentions: archiveOf({
        posts: [
          post('plain', at(2026, 6, 1), { mentions: [] }),
          post('named', at(2026, 6, 2), {
            mentions: [ADA, BO, ADA],
            text: 'Thanks to both of you',
          }),
          post('answer', at(2026, 6, 3), { replyTo: ADA, mentions: [ADA] }),
          post('older', at(2026, 5, 1)),
          post('nfc', at(2026, 5, 2), { mentions: [NFC] }),
        ],
      }),
      subjects: archiveOf({
        posts: [post('own', at(2026, 6, 1), { text: 'The heron again' })],
        inbound: [
          inbound(ADA, 'like', at(2026, 8, 3), { subject: own('own') }),
          inbound(ADA, 'repost', at(2026, 8, 4), {
            subject: `at://${ME}/app.bsky.feed.generator/feed`,
          }),
          inbound(ADA, 'like', at(2026, 8, 5), {
            subject: 'at://did:web:me.example.com/app.bsky.feed.post/x',
          }),
        ],
        outbound: [
          outbound(ADA, 'like', at(2026, 8, 4), {
            subject: `at://${ADA}/app.bsky.feed.post/theirs`,
          }),
          outbound(ADA, 'repost', at(2026, 8, 6), {
            subject: `at://${ADA}/app.bsky.feed.post/a?b#c`,
          }),
          outbound(ADA, 'like', at(2026, 8, 7), {
            subject: 'at://ada.example.com/app.bsky.feed.post/byhandle',
          }),
        ],
      }),
      engaged: archiveOf({
        posts: [post('a', at(2026, 6, 1)), post('b', at(2026, 6, 2))],
        inbound: [
          inbound(ADA, 'like', at(2026, 8, 1), { subject: own('a') }),
          inbound(ADA, 'like', at(2026, 8, 2), { subject: own('b') }),
          inbound(ADA, 'reply', at(2026, 8, 3), { subject: own('b') }),
          inbound(ADA, 'repost', at(2026, 8, 4), { subject: own('gone') }),
          inbound(ADA, 'reply', at(2026, 8, 5), {
            subject: `at://${BO}/app.bsky.feed.post/elsewhere`,
          }),
          inbound(ADA, 'quote', at(2026, 8, 6)),
          inbound(ADA, 'mention', at(2026, 8, 7), { subject: own('a') }),
          inbound(BO, 'like', at(2026, 8, 7), { subject: own('a') }),
        ],
      }),
      follows: archiveOf({
        followers: [
          follower(ADA, 'ada.example.com', '', 'not a date'),
          follower(BO, 'bo.example.com', '', at(2025, 1, 1)),
          follower(BO, 'bo2.example.com', '', at(2026, 1, 1)),
        ],
        following: [
          {
            uri: `at://${ME}/app.bsky.graph.follow/b`,
            did: ADA,
            followedAt: at(2025, 9, 1),
          },
          {
            uri: `at://${ME}/app.bsky.graph.follow/a`,
            did: ADA,
            followedAt: at(2024, 2, 1),
          },
          {
            uri: `at://${ME}/app.bsky.graph.follow/c`,
            did: ADA,
            followedAt: null,
          },
          {
            uri: `at://${ME}/app.bsky.graph.follow/s`,
            did: BO,
            followedAt: '',
          },
        ],
      }),
      left,
      back: {
        ...left,
        followers: [follower(BO, 'bo.example.com', '', at(2026, 11, 1))],
      },
      blocks: archiveOf({
        blocks: [
          {
            uri: 'at://x/app.bsky.graph.listblock/1',
            did: BO,
            blockedAt: at(2026, 3, 1),
            source: 'list',
          },
          {
            uri: `at://${BO}/app.bsky.graph.block/1`,
            did: BO,
            blockedAt: at(2026, 5, 1),
            source: 'direct',
          },
          {
            uri: `at://${CY}/app.bsky.graph.block/1`,
            did: CY,
            blockedAt: at(2026, 1, 1),
            source: 'direct',
          },
          {
            uri: `at://${DEE}/app.bsky.graph.block/1`,
            did: DEE,
            blockedAt: null,
            source: 'direct',
          },
        ],
      }),
      coverage: archiveOf({
        inbound: [inbound(BO, 'like', at(2026, 2, 1))],
        meta: {
          posts: { complete: true },
          inbound: { truncated: true },
          outbound: { coverageMs: 0 },
        },
      }),
      partial: archiveOf({
        meta: {
          posts: { complete: false },
          outbound: { coverageMs: 1_700_000_000_000 },
        },
      }),
      unread: archiveOf({ meta: {} }),
      undatable: archiveOf({
        inbound: [
          inbound(ADA, 'like', 'whenever'),
          inbound(ADA, 'like', at(2026, 10, 1)),
          inbound(ADA, 'like', 1_790_000_000_000),
          inbound(ADA, 'like', null),
        ],
        posts: [
          post('nodate', 'soon', { replyTo: ADA }),
          post('dated', at(2026, 4, 1), { replyTo: ADA }),
        ],
      }),
      monthEdges: archiveOf({
        inbound: [
          inbound(ADA, 'like', at(2026, 6, 30, 23)),
          inbound(ADA, 'like', at(2026, 7, 1, 0)),
          inbound(ADA, 'reply', at(2026, 7, 31, 23)),
        ],
      }),
      noInbound: archiveOf({
        outbound: [outbound(ADA, 'like', at(2026, 9, 3))],
      }),
      unicode: archiveOf({
        inbound: [
          inbound(NFC, 'like', at(2026, 8, 3)),
          inbound(NFD, 'reply', at(2026, 8, 4)),
          inbound(ME, 'like', at(2026, 8, 5)),
        ],
        outbound: [outbound(NFD, 'like', at(2026, 8, 6))],
        posts: [
          post('', at(2026, 8, 7), {
            replyTo: NFC,
            uri: `at://${ME}/app.bsky.feed.post/emptyrkey`,
          }),
          post('ü', at(2026, 8, 8), { quoteOf: NFD }),
        ],
        followers: [follower(NFC, 'cafe.example.com', 'Café', at(2025, 1, 1))],
        following: [
          {
            uri: `at://${ME}/app.bsky.graph.follow/n`,
            did: NFD,
            followedAt: at(2025, 2, 1),
          },
        ],
      }),
      nowLater: {
        ...archiveOf({ inbound: [inbound(ADA, 'like', at(2027, 3, 1))] }),
      },
    });
  });
}

export default async function cases() {
  const out = [];
  const context = contexts(7000);
  const harness = harnessArchives();
  const built = {};
  // Every archive in UTC; the ones whose months matter in the other zones too.
  const ZONED = ['world', 'monthEdges', 'left'];
  for (const zone of ZONES) {
    for (const [name, archive] of Object.entries(testArchives(zone)))
      if (zone === 'UTC' || ZONED.includes(name))
        built[`${name}@${zone}`] = archive;
  }
  out.push(...archiveCases(built));
  const TEST_NOW = Date.UTC(2026, 10, 14, 12);

  // One account at a time.
  const lookups = [];
  for (const name of Object.keys(built)) {
    const zone = name.split('@')[1];
    const whos = name.startsWith('world')
      ? WHO
      : name.startsWith('unicode')
        ? [NFC, NFD, ME, ADA]
        : [ADA, BO, CY, STRANGER];
    for (const who of whos)
      lookups.push({
        $id: `${name}-${who}`,
        archive: name,
        nowMs: TEST_NOW,
        who,
        zone,
      });
  }
  const mira = harness.mira;
  const miraContext = context(mira, HARNESS_NOW);
  const top = interactionIndex(miraContext)
    .ranked.slice(0, 6)
    .map((r) => r.did);
  for (const who of [...top, mira.followers[5].did, STRANGER, mira.did])
    for (const zone of ['UTC', 'Asia/Kolkata'])
      lookups.push({
        $id: `mira-${who}-${zone}`,
        archive: 'mira',
        nowMs: HARNESS_NOW,
        who,
        zone,
      });
  const all = { ...harness, ...built };
  out.push(
    ...(await each('interactionModel', lookups, (input) =>
      under(input, () => {
        const archive = context(all[input.archive], input.nowMs);
        input.rev = archive.rev;
        return compact(interactionModel(archive, input.who));
      }),
    )),
  );

  const whole = Object.keys(all).map((name) => ({
    $id: name,
    archive: name,
    nowMs: name in harness ? HARNESS_NOW : TEST_NOW,
    zone: name.split('@')[1] || 'UTC',
  }));
  for (const [fn, run] of [
    ['interactionIndex', (a) => compact(interactionIndex(a))],
    ['keepsMentions', (a) => keepsMentions(a)],
  ])
    out.push(
      ...(await each(fn, whole, (input) =>
        under(input, () => {
          const archive = context(all[input.archive], input.nowMs);
          input.rev = archive.rev;
          return run(archive);
        }),
      )),
    );

  // The directory and its search.
  const cards = {
    [ADA]: {
      handle: 'ada.example.com',
      displayName: 'Ada Lindqvist',
      avatar: 'a.png',
    },
    [BO]: { handle: 'bo.lindqvist.example.org', displayName: '' },
    [DEE]: { handle: 'dee.example.com', displayName: 'Adaeze Okonkwo' },
    [NFC]: { handle: 'café.example.com', displayName: 'Café  Owner Two' },
    [NFD]: { handle: 'k.example.com', displayName: 'Kelvin   Spaced' },
  };
  const directoryInputs = [
    'world@UTC',
    'unicode@UTC',
    'mira',
    'blocks@UTC',
  ].map((name) => ({
    $id: name,
    archive: name,
    nowMs: name === 'mira' ? HARNESS_NOW : TEST_NOW,
    // As entries: two of the DIDs differ only in normalization, which a
    // Swift dictionary of the JSON can't keep apart.
    cards: Object.entries(cards),
  }));
  out.push(
    ...(await each('peopleDirectory', directoryInputs, (input) => {
      const archive = context(all[input.archive], input.nowMs);
      input.rev = archive.rev;
      const byDid = new Map(input.cards);
      return peopleDirectory(archive, (did) => byDid.get(did) || null);
    })),
  );
  const directory = peopleDirectory(
    context(all['world@UTC'], TEST_NOW),
    (did) => cards[did] || null,
  ).concat(
    peopleDirectory(
      context(all['unicode@UTC'], TEST_NOW),
      (did) => cards[did] || null,
    ),
  );
  const queries = [
    'ada',
    'Ada L',
    'lind',
    '@bo.lind',
    'example.com',
    'okonkwo',
    'zzz',
    '',
    '   ',
    CY,
    'did:plc:c',
    'did:',
    'cy',
    'DID:PLC:ADA',
    'example',
    'café',
    'café',
    'owner',
    'two',
    'kelvin',
    'Kelvin',
    'spaced',
    'https://bsky.app/profile/ada.example.com',
    'at://did:plc:ada',
    '@',
    'a',
    '.',
    'e',
  ];
  const matchInputs = [];
  for (const query of queries) matchInputs.push({ query, limit: 8 });
  for (const limit of [0, 1, 2, -1, 100])
    matchInputs.push({ query: 'e', limit });
  out.push(
    ...(await each('matchPeople', matchInputs, ({ query, limit }) =>
      matchPeople(directory, query, { limit }),
    )),
  );
  out.push(value('directory', directory));

  // Filters, words and the export, over Ada's history.
  const events = interactionModel(
    context(all['world@UTC'], TEST_NOW),
    ADA,
  ).events;
  out.push(value('events', events));
  const filters = [];
  for (const direction of ['all', 'in', 'out', 'sideways', undefined])
    for (const kind of [
      'all',
      'like',
      'reply',
      'quote',
      'mention',
      'repost',
      'nope',
      undefined,
    ])
      filters.push({ direction, kind });
  out.push(
    ...(await each('filterEvents', filters, (options) =>
      filterEvents(events, options),
    )),
  );
  const phrases = [];
  for (const dir of ['in', 'out', 'sideways', '', 'constructor', undefined])
    for (const kind of [
      'like',
      'repost',
      'reply',
      'quote',
      'mention',
      'follow',
      'toString',
      undefined,
    ])
      phrases.push({ dir, kind });
  out.push(...(await each('eventPhrase', phrases, (ev) => eventPhrase(ev))));
  out.push(
    ...(await each(
      'eventsCsvRows',
      [
        { did: ADA, handle: 'ada.example.com', events },
        {
          did: ADA,
          events: filterEvents(events, { direction: 'in', kind: 'like' }),
        },
        { did: STRANGER, events: [] },
        {
          did: null,
          handle: null,
          events: [
            {
              at: '2026-01-01T12:00:00.000Z',
              dir: 'out',
              kind: 'reply',
              url: null,
              urlOwner: null,
              text: 'one\r\ntwo\rthree\n\nfour\r\r\n',
              uri: 'at://x',
            },
          ],
        },
        {
          did: ADA,
          handle: '=cmd',
          events: [
            {
              at: '2026-01-01T12:00:00.000Z',
              dir: 'in',
              kind: 'mention',
              url: 'https://bsky.app/profile/x/post/y',
              urlOwner: 'them',
              text: '',
              uri: 'at://y',
            },
          ],
        },
      ],
      ({ events: list, did, handle }) =>
        eventsCsvRows(list, handle === undefined ? { did } : { did, handle }),
    )),
  );

  // kindsLine, from a row's byKind in its own key order.
  const lines = [
    {
      entries: [
        ['reply', 2],
        ['like', 1],
        ['quote', 0],
        ['mention', 1],
      ],
    },
    { entries: [['reply', 9]] },
    { entries: [['reply', 1]] },
    {
      entries: [
        ['like', 13],
        ['reply', 9],
        ['repost', 22],
      ],
      byCount: true,
    },
    {
      entries: [
        ['like', 13],
        ['reply', 9],
        ['repost', 22],
      ],
      byCount: false,
    },
    { entries: [['like', 1234]] },
    { entries: [['like', 1234]], locale: 'en-DE' },
    { entries: [['like', 123456]], locale: 'en-IN' },
    { entries: [] },
    { entries: null },
    {
      entries: [
        ['follow', 2],
        ['like', 1],
        ['verified', 1],
        ['zap', 3],
      ],
    },
    {
      entries: [
        ['follow', 2],
        ['like', 1],
        ['verified', 1],
        ['zap', 3],
      ],
      byCount: true,
    },
    {
      entries: [
        ['like', -1],
        ['reply', 0.4],
        ['quote', 1.5],
        ['mention', 2.5],
      ],
    },
    {
      entries: [
        ['10', 1],
        ['2', 1],
        ['b', 1],
        ['a', 1],
        ['like', 1],
      ],
    },
    {
      entries: [
        ['like', 2],
        ['repost', 2],
        ['reply', 2],
      ],
      byCount: true,
    },
  ];
  out.push(
    ...(await each('kindsLine', lines, (input) =>
      under(input, () =>
        kindsLine(input.entries ? Object.fromEntries(input.entries) : null, {
          byCount: Boolean(input.byCount),
        }),
      ),
    )),
  );

  // Naming an account.
  const typed = [
    'ada.example.com',
    '  @Ada.Example.com ',
    'did:plc:z72i7hdynmk6r22z27h6tvur',
    'did:web:example.com',
    'did:web:example.com%3A8080',
    'at://did:plc:abc',
    'AT://did:plc:abc',
    'at://ada.example.com',
    'https://bsky.app/profile/ada.example.com',
    'HTTPS://BSKY.APP/PROFILE/Ada.Example.Com',
    'http://localhost/profile/did:plc:abc/post/3kabc',
    'https://bsky.app/profile/did:plc:abc/post/3kabc',
    'https://bsky.app/profile/did%3Aplc%3Aabc',
    'https://bsky.app/profile/%E0%A4%A',
    'https://bsky.app/profile/ada.example.com?x=1',
    'https://bsky.app/profile/',
    'https:///profile/ada.example.com',
    'ftp://bsky.app/profile/ada.example.com',
    '',
    '   ',
    'ada',
    '@ada',
    '@@ada.example.com',
    'ada lindqvist',
    'did:',
    'did:key:z6Mk',
    'did:plc:',
    'did:plc:a b',
    'did:PLC:abc',
    'ada.',
    '.com',
    'a b.com',
    'example.123',
    'example.c0m',
    'a.b',
    '1.example.com',
    'a-.example.com',
    '-a.example.com',
    'a--b.example.com',
    `${'a'.repeat(63)}.com`,
    `${'a'.repeat(64)}.com`,
    `${'a.'.repeat(125)}com`,
    `${'a.'.repeat(126)}com`,
    'Kelvin.example.com',
    'café.example.com',
    'xn--caf-dma.example.com',
    'ADA.EXAMPLE.COM.',
    '﻿ada.example.com ',
    null,
  ];
  out.push(
    ...(await each(
      'parseActorInput',
      typed.map((text) => ({ text })),
      ({ text }) => parseActorInput(text),
    )),
  );
  out.push(
    ...(await each(
      'isDid',
      [
        ...typed,
        'did:plc:abc',
        'did:web:a.b:c',
        'did:plc:%',
        'did:plc:abc\n',
      ].map((text) => ({ text })),
      ({ text }) => isDid(text),
    )),
  );
  const hrefs = [
    { who: ADA },
    { who: ADA, search: '?latency=0' },
    { who: BO, search: '?who=did:plc:ada&latency=0' },
    { who: null, search: '?who=did:plc:ada' },
    { who: null, search: '?who=did:plc:ada&accounts=1' },
    { who: 'did:web:example.com%3A8080' },
    { who: 'did:web:example.com:8080', search: 'a=1&b=2' },
    { who: '', search: '?a=1' },
    { who: ADA, search: '?who=1&who=2&x=a+b&y=%20&z=%E2%9C%93' },
    { who: 'did:plc:a b&c=d', search: '' },
    { who: NFD, search: '?q=café' },
    { who: ADA, search: '??x=1' },
    { who: ADA, search: '&&x=1&&' },
    { who: ADA, search: '?x' },
    { who: ADA, search: '?Who=1&WHO=2' },
  ];
  out.push(
    ...(await each('lookupHref', hrefs, ({ who, search }) =>
      search === undefined ? lookupHref(who) : lookupHref(who, search),
    )),
  );

  out.push(
    value('constants', {
      LOOKUP_PATH,
      LOOKUP_KINDS,
      OUTBOUND_KINDS,
      KIND_LABEL,
      KIND_NOUN: Object.entries(KIND_NOUN),
      DIRECTIONS,
    }),
  );
  return out;
}
