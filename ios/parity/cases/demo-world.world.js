// The demo worlds (harness/world.js): the seeded generator bit for bit, TIDs
// at every kind of time, the cast, the hashes and activity the fakes answer
// with, posts as records, and whole worlds for both accounts at several
// moments and seeds, held part by part to a digest of the web's own output
// (_canonical.js). Swift: VirgaDemo/Harness/World.swift; tests in
// ios/VirgaKit/Tests/VirgaDemoTests/WorldParityTests.swift.

import {
  LAB,
  ME,
  PDS,
  activityOf,
  buildCast,
  buildWorld,
  hashOf,
  mulberry,
  postRecord,
  repoRecords,
  tidAt,
} from '../../../harness/world.js';
import { each, grid, value } from './_helpers.js';
import { NOW, worldDigest, worldFor } from './_demoWorld.js';

export const sources = ['harness/world.js'];

// Numbers JSON can't carry (NaN, ±Infinity) and the ones it bends travel as
// strings, read back with Number().
const SEEDS = [
  '0',
  '1',
  '-1',
  '20261112',
  '20261209',
  '2147483647',
  '2147483648',
  '4294967301',
  '-2147483649',
  '0.5',
  '-0.5',
  '123.999',
  '1e+20',
  '-1e+20',
  'NaN',
  'Infinity',
  '3735928559',
];

const TIMES = [
  '0',
  '1',
  '1.9',
  '-1',
  '-1.5',
  '-1000',
  '1794700000000',
  '1794700000000.7',
  '1700000000123.25',
  '9007199254740992',
  '9223372036854775807',
  '9223372036854775808',
  '18446744073709551616',
  '36893488147419103232',
  '1e+20',
  '-1e+20',
  '-9223372036854775808',
  '-18446744073709551616',
  '1e+300',
  '-1e+300',
  '5e-324',
  '-5e-324',
  'NaN',
  'Infinity',
  '-Infinity',
];

const CLOCKS = ['0', '1', '1023', '1024', '-1', '5.7', '4294967299', 'NaN'];

const TEXTS = [
  '',
  'a',
  'did:plc:virgaharnessmira2zq4x',
  'did:plc:virgaharnesscrowd00007',
  'at://did:plc:virgaharnessmira2zq4x/app.bsky.feed.post/3kaaaaaaaaaa2',
  'did:plc:virgaharnesscast0003>did:plc:virgaharnesscast0010',
  'é',
  'é',
  '😀',
  'ＡＢＣ',
  'x'.repeat(5000),
  '\u0000￿',
];

/** Posts as the fixtures and the repo shape them, and the odd ones they could be. */
function crafted() {
  const base = {
    rkey: '3kaaaaaaaaaa2',
    at: '2026-03-15T12:00:00.000Z',
    text: 'Hello there',
    replyTo: null,
    quoteOf: null,
    media: false,
    video: false,
    images: 0,
    described: 1,
    link: null,
    gif: false,
    tags: [],
    thread: null,
    langs: ['en'],
    likes: 3,
    reposts: 1,
    replies: 0,
    quotes: 0,
  };
  const quiet = {
    rkey: '3kbbbbbbbbbb2',
    at: '2026-03-15T12:00:00.000Z',
    text: 'Quiet one',
    replyTo: null,
    quoteOf: null,
    media: false,
    likes: 2,
    reposts: 0,
    replies: 0,
    quotes: 0,
  };
  return [
    { $id: 'plain', post: base },
    { $id: 'quiet', post: quiet },
    { $id: 'quiet-reply', post: { ...quiet, replyTo: 'did:plc:someone' } },
    {
      $id: 'link-www',
      post: { ...base, link: 'https://www.youtube.com/watch?v=harness' },
    },
    {
      $id: 'link-plain',
      post: { ...base, link: 'https://allotments.example/agm' },
    },
    { $id: 'link-http', post: { ...base, link: 'http://www.example.com/x' } },
    {
      $id: 'link-empty-text',
      post: { ...base, text: '', link: 'https://a.example/' },
    },
    { $id: 'tags', post: { ...base, tags: ['gardening', 'Cities'] } },
    {
      $id: 'tags-unicode',
      post: { ...base, text: 'Café ☕ 😀', tags: ['café', '日本'] },
    },
    {
      $id: 'link-and-tags',
      post: {
        ...base,
        text: 'é',
        link: 'https://www.x.example/é',
        tags: ['b'],
      },
    },
    { $id: 'empty-text-tags', post: { ...base, text: '', tags: ['only'] } },
    {
      $id: 'reply',
      post: { ...base, replyTo: 'did:plc:virgaharnesscast0004' },
    },
    {
      $id: 'thread',
      post: {
        ...base,
        replyTo: ME.did,
        thread: { root: '3kroot2222222', parent: '3kparent22222' },
      },
    },
    {
      $id: 'thread-no-reply-to',
      post: {
        ...base,
        thread: { root: '3kroot2222222', parent: '3kroot2222222' },
      },
    },
    {
      $id: 'quote',
      post: { ...base, quoteOf: 'did:plc:virgaharnesscast0001' },
    },
    {
      $id: 'quote-images',
      post: {
        ...base,
        quoteOf: 'did:plc:virgaharnesscast0001',
        media: true,
        images: 3,
        described: 2,
      },
    },
    {
      $id: 'images-none-described',
      post: { ...base, media: true, images: 4, described: 0 },
    },
    {
      $id: 'images-zero',
      post: { ...base, media: true, images: 0, described: 0 },
    },
    { $id: 'quiet-media', post: { ...quiet, media: true } },
    {
      $id: 'video-described',
      post: { ...base, media: true, video: true, described: 1 },
    },
    {
      $id: 'video-undescribed',
      post: { ...base, media: true, video: true, described: 0 },
    },
    { $id: 'gif', post: { ...base, gif: true } },
    {
      $id: 'gif-and-link',
      post: { ...base, gif: true, link: 'https://a.example/' },
    },
    {
      $id: 'media-and-link',
      post: { ...base, media: true, images: 1, link: 'https://a.example/' },
    },
    { $id: 'langs-fr', post: { ...base, langs: ['en', 'fr'] } },
    { $id: 'langs-empty', post: { ...base, langs: [] } },
    {
      $id: 'written',
      post: {
        rkey: '3kcccccccccc2',
        at: '2026-03-15T12:00:00.000Z',
        text: 'ignored',
        record: {
          $type: 'app.bsky.feed.post',
          text: 'As written',
          createdAt: '2026-03-15T12:00:00.000Z',
        },
        cid: 'bafyreiexample',
        indexedAt: '2026-03-15T12:00:01.000Z',
        writtenAt: 1773576001000,
        likes: 0,
        reposts: 0,
        replies: 0,
        quotes: 0,
      },
    },
    { $id: 'record-empty-string', post: { ...base, record: '' } },
  ];
}

/** Changes to a small world, to hold repoRecords' order, dedupe and deletes. */
const EDITS = {
  written: [
    [
      'app.bsky.feed.post/3zzzzzzzzzzzz',
      { $type: 'app.bsky.feed.post', text: 'written over nothing' },
    ],
    ['zz.unicode.é/key', { $type: 'zz.unicode.é' }],
    ['zz.unicode.😀/key', { $type: 'zz.unicode.😀' }],
    ['zz.unicode.ｚ/key', { $type: 'zz.unicode.ｚ' }],
    [
      'app.bsky.actor.profile/self',
      { $type: 'app.bsky.actor.profile', displayName: 'Written profile' },
    ],
  ],
  others: [
    { collection: 'zz.dupe', rkey: 'one', value: { $type: 'zz.dupe', n: 1 } },
    { collection: 'zz.dupe', rkey: 'one', value: { $type: 'zz.dupe', n: 2 } },
    { collection: 'zz.gone', rkey: 'two', value: { $type: 'zz.gone' } },
  ],
  removed: ['zz.gone/two', 'app.bsky.feed.like/nothing-here'],
};

function edited(edits) {
  const world = buildWorld({ now: NOW, account: LAB });
  for (const [key, record] of edits.written)
    world.written.set(key, { value: record, cid: 'bafyedit' });
  world.others.push(...edits.others);
  for (const key of edits.removed) world.removed.add(key);
  // A written post that repeats a fixture post's key: the written one wins.
  world.written.set(`app.bsky.feed.post/${world.posts[3].rkey}`, {
    value: { $type: 'app.bsky.feed.post', text: 'over a fixture' },
    cid: 'bafyedit',
  });
  return world;
}

export default async function cases() {
  return [
    value('constants', { ME, LAB, PDS }),
    ...(await each(
      'mulberry',
      SEEDS.map((seed) => ({ seed })),
      ({ seed }) => {
        const rand = mulberry(Number(seed));
        return Array.from({ length: 24 }, () => rand());
      },
    )),
    ...(await each(
      'tidAt',
      grid({ ms: TIMES, clock: CLOCKS }),
      ({ ms, clock }) => tidAt(Number(ms), Number(clock)),
    )),
    ...(await each('tidAt-default-clock', [{ ms: '1794700000000' }], ({ ms }) =>
      tidAt(Number(ms)),
    )),
    value('buildCast', buildCast()),
    ...(await each(
      'hashOf',
      TEXTS.map((text) => ({ text })),
      ({ text }) => hashOf(text),
    )),
    ...(await each(
      'activityOf',
      [
        ...Array.from(
          { length: 36 },
          (_, i) => `did:plc:virgaharnessfol${String(i).padStart(4, '0')}`,
        ),
        ...Array.from(
          { length: 8 },
          (_, i) => `did:plc:virgaharnesscast${String(i * 7).padStart(4, '0')}`,
        ),
        'did:plc:virgaharnesscrowd00011',
        'fol',
        '',
        'did:plc:folk',
      ].map((did) => ({ did })),
      ({ did }) => activityOf(did),
    )),
    ...(await each('postRecord', crafted(), ({ post }) => postRecord(post))),
    ...(await each(
      'repoRecords',
      [{ $id: 'edited-lab', now: NOW, edits: EDITS }],
      ({ edits }) => repoRecords(edited(edits)),
    )),
    ...(await each(
      'buildWorld',
      [
        { $id: 'mira', now: NOW, account: 'me' },
        {
          $id: 'mira-fractional-now-seed-7',
          now: 1700000000123.7,
          seed: 7,
          account: 'me',
        },
        {
          $id: 'mira-before-1970',
          now: 1e10,
          seed: -123456789.5,
          account: 'me',
        },
        {
          $id: 'mira-wrapping-seed',
          now: 1773576000000,
          seed: 4294967301,
          account: 'me',
        },
        { $id: 'lab', now: NOW, account: 'lab' },
        { $id: 'lab-seed-99', now: 1700000000123.7, seed: 99, account: 'lab' },
        { $id: 'someone-else', now: 1773576000000, account: 'someone' },
      ],
      (input) => worldDigest(worldFor(input)),
    )),
  ];
}
