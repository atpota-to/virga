// What the harness's AppView says (harness/views.js): pages and cursors,
// TID times, live counts, people, every post of both accounts as a view,
// embeds of every kind (and the malformed ones the web chokes on), author
// feeds, threads, feeds and lists, and search. The worlds first take a few
// writes through the harness's repo (posts with images, video, cards,
// quotes, a reply chain, a threadgate, uploaded blobs), so written posts
// are held too. Swift: VirgaDemo/Harness/Views.swift; tests in
// ios/VirgaKit/Tests/VirgaDemoTests/ViewsParityTests.swift.

import { storeBlob, writeRecord } from '../../../harness/repo.js';
import {
  createViews,
  liveCounts,
  pageOf,
  tidTime,
} from '../../../harness/views.js';
import { LAB, ME, buildWorld } from '../../../harness/world.js';
import { each, grid, value } from './_helpers.js';
import { part } from './_canonical.js';
import { NOW, atTime, thrown } from './_demoWorld.js';

export const sources = ['harness/views.js'];

/** When the views are asked (posts were written a little before). */
export const VIEW_NOW = NOW + 3 * 3_600_000;
const POST = 'app.bsky.feed.post';

/** The writes both the generator and the Swift test make before asking. */
export const WRITES = [
  {
    $blob: 'png',
    bytes: [137, 80, 78, 71, 13, 10, 26, 10],
    mimeType: 'image/png',
  },
  {
    $blob: 'jpeg',
    bytes: [255, 216, 255, 224, 0, 16],
    mimeType: 'image/jpeg',
  },
];

/** Posts written in Mira's world: `$png`/`$jpeg` stand for the blobs' CIDs. */
export function miraWrites(mira) {
  const fixture = mira.posts.find((p) => p.media && !p.video && p.quoteOf);
  const plain = mira.posts[0];
  const me = (rkey) => `at://${ME.did}/${POST}/${rkey}`;
  const cast3 = `at://did:plc:virgaharnesscast0003/${POST}/3kaaaaaaaaaa2`;
  const feed = mira.feeds[0].uri;
  const ownList = mira.ownLists[1].uri;
  const theirList = mira.lists[2].uri;
  const at = (minutes) => new Date(NOW - minutes * 60_000).toISOString();
  return [
    {
      rkey: '3zzzzzzzzzza2',
      record: {
        $type: POST,
        text: 'Pictures from the allotment',
        createdAt: at(90),
        embed: {
          $type: 'app.bsky.embed.images',
          images: [
            {
              alt: 'Beans',
              image: {
                $type: 'blob',
                ref: { $link: '$png' },
                mimeType: 'image/png',
                size: 8,
              },
              aspectRatio: { width: 4, height: 3 },
            },
            {
              alt: '',
              image: {
                ref: {
                  $link:
                    'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
                },
              },
            },
            { image: {} },
            null,
            7,
          ],
        },
      },
    },
    {
      rkey: '3zzzzzzzzzzb2',
      record: {
        $type: POST,
        text: 'A card with a picture',
        createdAt: at(80),
        embed: {
          $type: 'app.bsky.embed.external',
          external: {
            uri: 'https://library.example/x',
            title: 'Library',
            description: 'Events',
            thumb: { ref: { $link: '$jpeg' } },
          },
        },
      },
    },
    {
      rkey: '3zzzzzzzzzzc2',
      record: {
        $type: POST,
        text: 'A quote of a quote',
        createdAt: at(70),
        embed: {
          $type: 'app.bsky.embed.record',
          record: { uri: me(fixture.rkey), cid: 'bafyharness' },
        },
      },
    },
    {
      rkey: '3zzzzzzzzzzd2',
      record: {
        $type: POST,
        text: 'Quoting the quote',
        createdAt: at(60),
        embed: {
          $type: 'app.bsky.embed.record',
          record: { uri: me('3zzzzzzzzzzc2'), cid: 'x' },
        },
      },
    },
    {
      rkey: '3zzzzzzzzzze2',
      record: {
        $type: POST,
        text: 'With media and a cast post',
        createdAt: at(50),
        embed: {
          $type: 'app.bsky.embed.recordWithMedia',
          record: { record: { uri: cast3, cid: 'x' } },
          media: {
            $type: 'app.bsky.embed.video',
            video: {
              ref: {
                $link:
                  'bafkreigp4mbuvtxk2twhjnd66cmq5sumxzbh777vzlkbvf3jymgaqf3h4i',
              },
            },
            alt: 'A clip',
            aspectRatio: { width: 16, height: 9 },
          },
        },
      },
    },
    {
      rkey: '3zzzzzzzzzzf2',
      record: {
        $type: POST,
        text: 'A feed',
        createdAt: at(45),
        embed: { $type: 'app.bsky.embed.record', record: { uri: feed } },
      },
    },
    {
      rkey: '3zzzzzzzzzzg2',
      record: {
        $type: POST,
        text: 'A list',
        createdAt: at(44),
        embed: { $type: 'app.bsky.embed.record', record: { uri: ownList } },
      },
    },
    {
      rkey: '3zzzzzzzzzzh2',
      record: {
        $type: POST,
        text: 'Their list',
        createdAt: at(43),
        embed: { $type: 'app.bsky.embed.record', record: { uri: theirList } },
      },
    },
    {
      rkey: '3zzzzzzzzzzi2',
      record: {
        $type: POST,
        text: 'Gallery and nothing',
        createdAt: at(42),
        embed: {
          $type: 'app.bsky.embed.recordWithMedia',
          record: { record: { uri: 'at://nobody/app.bsky.feed.like/x' } },
          media: {
            $type: 'app.bsky.embed.gallery',
            items: [{ alt: 'One', image: { ref: { $link: '$png' } } }],
          },
        },
      },
    },
    {
      rkey: '3zzzzzzzzzzj2',
      record: {
        $type: POST,
        text: 'Unknown embed',
        createdAt: at(41),
        embed: { $type: 'app.bsky.embed.somethingNew' },
      },
    },
    // A reply chain: k answers j? No: l opens, m answers l, n answers m, o answers l.
    {
      rkey: '3zzzzzzzzzzl2',
      record: { $type: POST, text: 'Opening a thread', createdAt: at(30) },
    },
    {
      rkey: '3zzzzzzzzzzm2',
      record: {
        $type: POST,
        text: 'First reply',
        createdAt: at(29),
        reply: {
          root: { uri: me('3zzzzzzzzzzl2') },
          parent: { uri: me('3zzzzzzzzzzl2') },
        },
      },
    },
    {
      rkey: '3zzzzzzzzzzn2',
      record: {
        $type: POST,
        text: 'Reply to the reply',
        createdAt: at(28),
        reply: {
          root: { uri: me('3zzzzzzzzzzl2') },
          parent: { uri: me('3zzzzzzzzzzm2') },
        },
      },
    },
    {
      rkey: '3zzzzzzzzzzo2',
      record: {
        $type: POST,
        text: 'Second reply',
        createdAt: at(27),
        reply: {
          root: { uri: me('3zzzzzzzzzzl2') },
          parent: { uri: me('3zzzzzzzzzzl2') },
        },
      },
    },
    {
      rkey: '3zzzzzzzzzzp2',
      record: {
        $type: POST,
        text: 'Answering a gone post',
        createdAt: at(26),
        reply: { parent: { uri: me('3zzzzzzzzzzzz') } },
      },
    },
    {
      rkey: '3zzzzzzzzzzq2',
      record: {
        $type: POST,
        text: 'Answering the cast',
        createdAt: at(25),
        reply: { parent: { uri: cast3 } },
      },
    },
    {
      collection: 'app.bsky.feed.threadgate',
      rkey: '3zzzzzzzzzzl2',
      record: { post: me('3zzzzzzzzzzl2'), allow: [] },
    },
    // Over a fixture post: it keeps its place, with the written record.
    {
      rkey: plain.rkey,
      record: { $type: POST, text: 'Rewritten', createdAt: plain.at },
    },
    // A post whose time can't be read.
    {
      rkey: '3zzzzzzzzzzr2',
      record: { $type: POST, text: 'No time', createdAt: 'not a date' },
    },
  ];
}

/**
 * Uploads the blobs and writes the posts, and answers what it did, for the
 * Swift test to do the same: `{ blobs, mira, lab }`, each write as
 * `{ collection, rkey, record, now }` with the blobs' CIDs in place.
 */
export async function prepare(mira, lab, writes) {
  const cids = {};
  for (const b of WRITES)
    cids[`$${b.$blob}`] = (
      await storeBlob(mira, Uint8Array.from(b.bytes), b.mimeType)
    ).ref.$link;
  const swap = (v) =>
    typeof v === 'string' && cids[v]
      ? cids[v]
      : Array.isArray(v)
        ? v.map(swap)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)]))
          : v;
  const done = { blobs: WRITES, mira: [], lab: [] };
  const apply = async (world, list, w) => {
    list.push(w);
    await atTime(w.now, () => writeRecord(world, w));
  };
  for (const w of writes)
    await apply(mira, done.mira, {
      collection: w.collection ?? POST,
      rkey: w.rkey,
      record: swap(w.record),
      now: NOW - 60_000,
    });
  await apply(lab, done.lab, {
    collection: POST,
    rkey: '3zzzzzzzzzzz2',
    record: {
      $type: POST,
      text: 'Lab writes',
      createdAt: new Date(NOW).toISOString(),
    },
    now: NOW,
  });
  return done;
}

const EMBEDS = [
  null,
  'text',
  7,
  [],
  [{ $type: 'app.bsky.embed.images' }],
  {},
  { $type: 'app.bsky.embed.images' },
  { $type: 'app.bsky.embed.images', images: [] },
  { $type: 'app.bsky.embed.images', images: 'abc' },
  { $type: 'app.bsky.embed.images', images: { 0: 1 } },
  { $type: 'app.bsky.embed.images', images: 0 },
  { $type: 'app.bsky.embed.gallery', items: true },
  { $type: 'app.bsky.embed.gallery' },
  {
    $type: 'app.bsky.embed.images',
    images: [
      { image: { ref: { $link: 5 } }, alt: 3, aspectRatio: 0 },
      { image: { ref: { $link: { a: 1 } } } },
      'str',
    ],
  },
  { $type: 'app.bsky.embed.video' },
  { $type: 'app.bsky.embed.video', video: { ref: { $link: 12 } }, alt: '' },
  { $type: 'app.bsky.embed.video', video: { ref: { $link: [1] } } },
  { $type: 'app.bsky.embed.video', video: { ref: { $link: [] } } },
  { $type: 'app.bsky.embed.video', video: { ref: { $link: { length: 2 } } } },
  { $type: 'app.bsky.embed.video', video: { ref: { $link: { length: 0 } } } },
  { $type: 'app.bsky.embed.video', video: { ref: { $link: 'bafkrei x/y' } } },
  { $type: 'app.bsky.embed.external' },
  { $type: 'app.bsky.embed.external', external: 'str' },
  {
    $type: 'app.bsky.embed.external',
    external: {
      uri: null,
      title: 0,
      description: 'd',
      thumb: { ref: { $link: true } },
    },
  },
  {
    $type: 'app.bsky.embed.external',
    external: { thumb: { ref: { $link: [] } } },
  },
  { $type: 'app.bsky.embed.record' },
  { $type: 'app.bsky.embed.record', record: { uri: null } },
  { $type: 'app.bsky.embed.record', record: { uri: 5 } },
  {
    $type: 'app.bsky.embed.record',
    record: { uri: [`at://${ME.did}/${POST}/3zzzzzzzzzzl2`] },
  },
  {
    $type: 'app.bsky.embed.record',
    record: { uri: `at://${ME.did}/${POST}/3zzzzzzzzzzc2` },
  },
  {
    $type: 'app.bsky.embed.record',
    record: { uri: `at://${ME.did}/app.bsky.feed.generator/nope` },
  },
  {
    $type: 'app.bsky.embed.record',
    record: { uri: `at://${ME.did}/app.bsky.graph.list/nope` },
  },
  {
    $type: 'app.bsky.embed.record',
    record: {
      uri: 'at://did:plc:virgaharnessfol0003/app.bsky.feed.post/3kaaaaaaaaaa2',
    },
  },
  {
    $type: 'app.bsky.embed.record',
    record: {
      uri: 'at://did:plc:virgaharnesscast0001/app.bsky.feed.post/notatid',
    },
  },
  { $type: 'app.bsky.embed.recordWithMedia' },
  {
    $type: 'app.bsky.embed.recordWithMedia',
    record: { record: { uri: `at://${LAB.did}/${POST}/3zzzzzzzzzzz2` } },
    media: { $type: 'app.bsky.embed.images', images: 'x' },
  },
  {
    $type: 'app.bsky.embed.recordWithMedia',
    record: 'x',
    media: { $type: 'app.bsky.embed.external', external: { uri: 'u' } },
  },
];

export default async function cases() {
  const mira = buildWorld({ now: NOW });
  const lab = buildWorld({ now: NOW, account: LAB });
  const writes = miraWrites(mira);
  const done = await prepare(mira, lab, writes);
  const views = createViews([mira, lab]);
  const ask = (fn) => atTime(VIEW_NOW, fn);
  const uriOf = (w, p) => `at://${w.me.did}/${POST}/${p.rkey}`;
  const opener = mira.posts.find((p) =>
    mira.posts.some((q) => q.thread?.root === p.rkey),
  );
  const selfReply = mira.posts.find(
    (p) => p.thread && p.thread.parent !== p.thread.root,
  );
  const castReply = mira.posts.find(
    (p) => p.replyTo && !p.thread && p.replyTo !== ME.did,
  );
  const people = [
    ME.did,
    LAB.did,
    ME.handle,
    `@${ME.handle}`,
    'MIRA.EXAMPLE.COM',
    'ana.example.com',
    'did:plc:virgaharnesscast0000',
    'did:plc:virgaharnesscast0030',
    'did:plc:virgaharnesscast0004',
    'did:plc:virgaharnessfol0001',
    'did:plc:virgaharnesscrowd00007',
    mira.followers.find((f) => f.did.includes('fan')).did,
    'did:plc:nobody',
    'nobody.example.com',
    '@',
    '',
  ];

  return [
    value('writes', done),
    ...(await each(
      'pageOf',
      grid({
        length: [10, 0],
        limit: [
          undefined,
          null,
          3,
          '3',
          0,
          -5,
          2.5,
          'abc',
          1000,
          'Infinity',
          '1e1',
        ],
        cursor: [
          undefined,
          null,
          '0',
          '3',
          3,
          '-4',
          '2.5',
          'abc',
          '9',
          '10',
          '11',
          'Infinity',
          '-Infinity',
        ],
      }),
      ({ length, limit, cursor }) =>
        pageOf(
          Array.from({ length }, (_, i) => i),
          limit,
          cursor,
        ),
    )),
    ...(await each(
      'tidTime',
      [
        '3kaaaaaaaaaa2',
        '2222222222222',
        'zzzzzzzzzzzzz',
        '7zzzzzzzzzzzz',
        'jzzzzzzzzzzzz',
        '3KAAAAAAAAAA2',
        '3kaaaaaaaaaa',
        '3kaaaaaaaaaa22',
        '3kaaaaaaaaaa1',
        '3kaaaaaaaaaa2\n',
        '',
        5,
        null,
        '😀aaaaaaaaaaa',
      ].map((rkey) => ({ rkey })),
      ({ rkey }) => tidTime(rkey),
    )),
    ...(await each(
      'liveCounts',
      [
        { $id: 'fixture', post: mira.posts[1], now: VIEW_NOW },
        {
          $id: 'written',
          post: mira.posts.find((p) => p.rkey === '3zzzzzzzzzzl2'),
          now: VIEW_NOW,
        },
        {
          $id: 'written-far-later',
          post: mira.posts.find((p) => p.rkey === '3zzzzzzzzzzl2'),
          now: VIEW_NOW + 100 * 86_400_000,
        },
        {
          $id: 'written-before',
          post: mira.posts.find((p) => p.rkey === '3zzzzzzzzzzl2'),
          now: NOW - 86_400_000,
        },
        {
          $id: 'unreadable',
          post: mira.posts.find((p) => p.rkey === '3zzzzzzzzzzr2'),
          now: VIEW_NOW,
        },
        {
          $id: 'no-at',
          post: {
            rkey: 'x',
            at: '',
            text: '',
            indexedAt: '2026-11-19T10:00:00.000Z',
            writtenAt: 5,
            likes: 0,
            reposts: 0,
            replies: 0,
            quotes: 0,
          },
          now: VIEW_NOW,
        },
        {
          $id: 'nothing',
          post: {
            rkey: 'x',
            at: '',
            text: '',
            writtenAt: 5,
            likes: 0,
            reposts: 0,
            replies: 0,
            quotes: 0,
          },
          now: VIEW_NOW,
        },
        {
          $id: 'written-zero',
          post: {
            rkey: 'x',
            at: '2026-01-01T00:00:00.000Z',
            text: '',
            writtenAt: 0,
            likes: 4,
            reposts: 3,
            replies: 2,
            quotes: 1,
          },
          now: VIEW_NOW,
        },
        {
          $id: 'minutes-boundary',
          post: {
            rkey: 'x',
            at: '2026-01-01T00:00:00.000Z',
            text: '',
            writtenAt: 1,
            likes: 0,
            reposts: 0,
            replies: 0,
            quotes: 0,
          },
          now: Date.parse('2026-01-01T01:00:00.000Z'),
        },
      ],
      ({ post, now }) => liveCounts(post, now),
    )),
    ...(await each(
      'card',
      people.map((did) => ({ did })),
      ({ did }) => views.card(did),
    )),
    ...(await each(
      'person',
      [...people.map((actor) => ({ actor })), { $id: 'undefined' }],
      ({ actor }) => views.person(actor),
    )),
    ...(await each(
      'resolveHandle',
      [...people.map((handle) => ({ handle })), { $id: 'undefined' }],
      ({ handle }) => views.resolveHandle(handle),
    )),
    value(
      'postView-every-post',
      await ask(() =>
        part(
          [mira, lab].flatMap((w) =>
            w.posts.map((p) => views.postView(uriOf(w, p), { now: VIEW_NOW })),
          ),
        ),
      ),
    ),
    ...(await each(
      'postView',
      [
        ...writes
          .filter((w) => !w.collection)
          .map((w) => ({
            $id: `written-${w.rkey}`,
            uri: `at://${ME.did}/${POST}/${w.rkey}`,
          })),
        { $id: 'lab-written', uri: `at://${LAB.did}/${POST}/3zzzzzzzzzzz2` },
        {
          $id: 'fixture-quote',
          uri: uriOf(
            mira,
            mira.posts.find((p) => p.quoteOf && p.media),
          ),
        },
        {
          $id: 'fixture-video',
          uri: uriOf(
            mira,
            mira.posts.find((p) => p.video),
          ),
        },
        {
          $id: 'fixture-gif',
          uri: uriOf(
            mira,
            mira.posts.find((p) => p.gif),
          ),
        },
        {
          $id: 'cast',
          uri: `at://did:plc:virgaharnesscast0007/${POST}/3kaaaaaaaaaa2`,
        },
        {
          $id: 'followed-only',
          uri: `at://did:plc:virgaharnessfol0002/${POST}/3kaaaaaaaaaa2`,
        },
        {
          $id: 'cast-bad-rkey',
          uri: `at://did:plc:virgaharnesscast0007/${POST}/self`,
        },
        {
          $id: 'stranger',
          uri: `at://did:plc:virgaharnesscrowd00001/${POST}/3kaaaaaaaaaa2`,
        },
        { $id: 'missing', uri: `at://${ME.did}/${POST}/3kaaaaaaaaaa2` },
        {
          $id: 'not-a-post',
          uri: `at://${ME.did}/app.bsky.feed.like/3kaaaaaaaaaa2`,
        },
        { $id: 'malformed', uri: `at://${ME.did}/${POST}` },
        { $id: 'empty', uri: '' },
        { $id: 'undefined' },
      ],
      ({ uri }) => ask(() => views.postView(uri, { now: VIEW_NOW })),
    )),
    ...(await each(
      'embedView',
      EMBEDS.flatMap((embed, i) => [
        { $id: `mira-${i}`, embed, did: ME.did, depth: 1 },
        ...(i >= 25
          ? [{ $id: `deep-${i}`, embed, did: ME.did, depth: 2 }]
          : []),
      ]),
      async ({ embed, did, depth }) => {
        try {
          return (
            (await ask(() => views.embedView(embed, did, depth))) ?? {
              $undefined: true,
            }
          );
        } catch (error) {
          return thrown(error);
        }
      },
    )),
    ...(await each(
      'authorFeed',
      [{ world: 'me' }, { world: 'lab' }],
      ({ world }) =>
        ask(() =>
          part(
            views.authorFeed(world === 'lab' ? lab : mira, { now: VIEW_NOW }),
          ),
        ),
    )),
    ...(await each(
      'threadView',
      [
        { $id: 'written-opener', uri: `at://${ME.did}/${POST}/3zzzzzzzzzzl2` },
        { $id: 'written-leaf', uri: `at://${ME.did}/${POST}/3zzzzzzzzzzn2` },
        {
          $id: 'written-leaf-short',
          uri: `at://${ME.did}/${POST}/3zzzzzzzzzzn2`,
          parentHeight: 1,
        },
        {
          $id: 'written-opener-shallow',
          uri: `at://${ME.did}/${POST}/3zzzzzzzzzzl2`,
          depth: 1,
        },
        {
          $id: 'written-opener-flat',
          uri: `at://${ME.did}/${POST}/3zzzzzzzzzzl2`,
          depth: 0,
        },
        { $id: 'gone-parent', uri: `at://${ME.did}/${POST}/3zzzzzzzzzzp2` },
        { $id: 'cast-parent', uri: `at://${ME.did}/${POST}/3zzzzzzzzzzq2` },
        { $id: 'fixture-opener', uri: uriOf(mira, opener) },
        { $id: 'fixture-self-reply', uri: uriOf(mira, selfReply) },
        { $id: 'fixture-cast-reply', uri: uriOf(mira, castReply) },
        {
          $id: 'cast-post',
          uri: `at://did:plc:virgaharnesscast0007/${POST}/3kaaaaaaaaaa2`,
        },
        { $id: 'missing', uri: `at://${ME.did}/${POST}/3kaaaaaaaaaa2` },
      ],
      ({ uri, depth, parentHeight }) =>
        ask(() => views.threadView(uri, { depth, parentHeight })),
    )),
    ...(await each(
      'generatorView',
      [
        ...mira.feeds.map((f) => ({ uri: f.uri })),
        { uri: `at://${ME.did}/app.bsky.feed.generator/nope` },
        {},
      ],
      ({ uri }) => views.generatorView(uri),
    )),
    ...(await each(
      'listView',
      [
        ...mira.ownLists.map((l) => ({ uri: l.uri })),
        ...mira.lists.slice(0, 3).map((l) => ({ uri: l.uri })),
        { uri: `at://${ME.did}/app.bsky.graph.list/nope` },
        {},
      ],
      ({ uri }) => ask(() => views.listView(uri)),
    )),
    ...(await each(
      'listMembers',
      [
        ...mira.ownLists.map((l) => ({ uri: l.uri })),
        { uri: mira.lists[0].uri },
        { uri: 'nope' },
      ],
      ({ uri }) => views.listMembers(uri),
    )),
    ...(await each(
      'searchPosts',
      [
        '',
        '   ',
        'the',
        'GARDEN',
        'sourdough starter',
        '  bench \t sun ',
        'heron',
        'zzz',
        'café',
        'written',
        'reply',
        'Morning.',
        undefined,
      ].map((q) => ({ q })),
      ({ q }) => ask(() => part(views.searchPosts(q, { now: VIEW_NOW }))),
    )),
    ...(await each(
      'searchActors',
      grid({
        q: [
          'a',
          '@ana',
          'ANA',
          'mira',
          'okafor',
          'field',
          'reader',
          'z',
          '',
          'Featherstonehaugh',
          'de',
          'é',
          undefined,
        ],
        limit: [undefined, 3, null, '2', 100],
      }),
      ({ q, limit }) => views.searchActors(q, limit),
    )),
  ];
}
