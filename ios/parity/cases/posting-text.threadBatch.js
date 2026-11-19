// src/posting/lib/threadBatch.js: a whole thread as one applyWrites batch,
// with increasing createdAt and TIDs, each reply naming its parent's locally
// computed CID. Swift: VirgaPosting/Lib/ThreadBatch.swift (over VirgaRepo's
// RecordCid).
//
// TIDs come from the clock, so the generator mints them from the time
// instead (`tid<ms>`); the Swift test passes the same minter. Inputs from
// src/posting/lib/threadBatch.test.js, plus records' own createdAt in every
// order and form (zone-less forms read in UTC, as the runner's TZ), records
// carrying a reply to replace, invalid clocks and the encoder's refusals.

import { buildThreadWrites } from '../../../src/posting/lib/threadBatch.js';
import { each } from './_helpers.js';

export const sources = ['src/posting/lib/threadBatch.js'];

const DID = 'did:plc:testwriter';
const base = (text, extra = {}) => ({
  $type: 'app.bsky.feed.post',
  text,
  facets: [],
  langs: ['en'],
  ...extra,
});
const NOW = Date.UTC(2026, 10, 12, 15, 0, 0);
const replyTo = {
  root: {
    uri: 'at://did:plc:other/app.bsky.feed.post/3aaa',
    cid: 'bafyreig6kgwgaixxenkfv62gkz43fgdyoe2ddbgqbfr2edkqv5ya5kginu',
  },
  parent: {
    uri: 'at://did:plc:other/app.bsky.feed.post/3bbb',
    cid: 'bafyreihlfz7eeyynraq3zqhozs4q3l3wabewbjevjb5jgophbtcjj7eijm',
  },
};

const INPUTS = [
  {
    $id: 'three posts',
    records: [base('one'), base('two'), base('three')],
    now: NOW,
  },
  {
    $id: 'collection given',
    collection: 'app.bsky.feed.post',
    records: [base('root post'), base('second'), base('third')],
    now: NOW,
  },
  {
    $id: 'reply into a thread',
    records: [base('reply one'), base('reply two')],
    replyTo,
    now: NOW,
  },
  {
    $id: 'own createdAt kept while it increases',
    records: [
      base('a', { createdAt: '2026-01-01T00:00:00.000Z' }),
      base('b', { createdAt: '2026-01-01T00:00:05.000Z' }),
      base('c', { createdAt: '2025-01-01T00:00:00.000Z' }),
    ],
    now: NOW,
  },
  {
    $id: 'equal createdAt steps a millisecond',
    records: [
      base('a', { createdAt: '2026-01-01T00:00:00.000Z' }),
      base('b', { createdAt: '2026-01-01T00:00:00.000Z' }),
    ],
    now: NOW,
  },
  {
    $id: 'first record earlier than now keeps its own',
    records: [base('a', { createdAt: '2020-05-05T05:05:05.005Z' }), base('b')],
    now: NOW,
  },
  {
    $id: 'zone-less and legacy dates',
    records: [
      base('a', { createdAt: '2026-03-01T10:00:00' }),
      base('b', { createdAt: 'March 1, 2026 10:00:01' }),
      base('c', { createdAt: '2026-03-01' }),
      base('d', { createdAt: 'not a date' }),
    ],
    now: NOW,
  },
  {
    $id: 'non-string createdAt',
    records: [
      base('a', { createdAt: null }),
      base('b', { createdAt: 0 }),
      base('c', { createdAt: 1773576000000 }),
      base('d', { createdAt: true }),
    ],
    now: NOW,
  },
  {
    $id: 'a carried reply is replaced',
    records: [
      base('a', { reply: { root: 'x', parent: 'y' } }),
      base('b', { reply: 7 }),
    ],
    now: NOW,
  },
  {
    $id: 'rich records',
    records: [
      base('🦋 see https://example.com', {
        facets: [
          {
            $type: 'app.bsky.richtext.facet',
            features: [
              {
                $type: 'app.bsky.richtext.facet#link',
                uri: 'https://example.com',
              },
            ],
            index: { byteStart: 9, byteEnd: 28 },
          },
        ],
        embed: {
          $type: 'app.bsky.embed.images',
          images: [
            {
              alt: '',
              image: {
                $type: 'blob',
                ref: {
                  $link:
                    'bafkreifvw4djmv7ney453nfyozyvoxvrwrlnpmbfhezarsn6plkrcvrw64',
                },
                mimeType: 'image/jpeg',
                size: 1234,
              },
              aspectRatio: { width: 4, height: 3 },
            },
          ],
        },
        labels: {
          $type: 'com.atproto.label.defs#selfLabels',
          values: [{ val: 'nudity' }],
        },
        tags: ['a', 'b'],
      }),
      base('second'),
    ],
    replyTo,
    now: NOW,
  },
  { $id: 'one record', records: [base('only')], now: NOW },
  { $id: 'no records', records: [], now: NOW },
  {
    $id: 'fractional now is cut',
    records: [base('a'), base('b')],
    now: NOW + 0.75,
  },
  {
    $id: 'now as a date string',
    records: [base('a'), base('b')],
    now: '2026-11-12T15:00:00.000Z',
  },
  { $id: 'invalid now', records: [base('a')], now: 'nope' },
  { $id: 'now past the end of time', records: [base('a')], now: 8.64e15 + 1 },
  { $id: 'last instant', records: [base('a'), base('b')], now: 8.64e15 - 1 },
  {
    $id: 'record without $type',
    records: [{ text: 'bare' }, base('b')],
    now: NOW,
  },
  {
    $id: 'record with a float',
    records: [base('a', { ratio: 1.5 })],
    now: NOW,
  },
  { $id: 'null and non-object records', records: [null, base('b')], now: NOW },
  // `{ ...base }` spreads what it is given: a string's code units and an
  // array's elements under their indexes, nothing of a number or a boolean.
  {
    $id: 'spreads of strings, arrays and scalars',
    records: ['ab\u{1F98B}', ['x', { y: 1 }], 7, true, false, ''],
    now: NOW,
  },
  // The shared clock's nextTid refuses a time that isn't a number before
  // toISOString is reached, and before the clock moves, so these throw
  // the same whatever ran before.
  {
    $id: 'invalid now, the default minter',
    records: [base('a')],
    now: 'nope',
    defaultMinter: true,
  },
  {
    $id: 'now past the end of time, the default minter',
    records: [base('a')],
    now: 8.64e15 + 1,
    defaultMinter: true,
  },
  {
    $id: 'no records, the default minter',
    records: [],
    now: 'nope',
    defaultMinter: true,
  },
];

// The minter is asked for each post's key before its time is written, so
// an invalid time reaches it first.
const MINTED = [
  { $id: 'invalid now', records: [base('a'), base('b')], now: 'nope' },
  {
    $id: 'the end of time',
    records: [base('a'), base('b'), base('c')],
    now: 8.64e15 - 1,
  },
  {
    $id: 'own times',
    records: [
      base('a', { createdAt: '2026-01-01T00:00:00.000Z' }),
      base('b', { createdAt: '2025-01-01T00:00:00.000Z' }),
    ],
    now: NOW,
  },
];

export default async function cases() {
  const out = await each(
    'buildThreadWrites',
    INPUTS,
    ({ records, collection, replyTo, now, defaultMinter }) =>
      buildThreadWrites({
        did: DID,
        ...(collection ? { collection } : {}),
        records,
        replyTo: replyTo ?? null,
        now,
        ...(defaultMinter ? {} : { mintTid: (ms) => `tid${ms}` }),
      }),
  );
  out.push(
    ...(await each('mintTidCalls', MINTED, async ({ records, now }) => {
      const calls = [];
      try {
        const { created } = await buildThreadWrites({
          did: DID,
          records,
          now,
          mintTid: (ms) => {
            calls.push(String(ms));
            return `tid${ms}`;
          },
        });
        return { calls, created: created.length };
      } catch (error) {
        return { calls, $throws: error.message };
      }
    })),
  );
  return out;
}
