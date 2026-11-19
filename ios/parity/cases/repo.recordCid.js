// src/posting/lib/recordCid.js: a record's CID as the PDS will assign it
// (the parent { uri, cid } a thread written in one applyWrites names), and
// the JSON form every value is brought to first. Swift:
// VirgaRepo/RecordCid.swift.
//
// The first records are real ones with the CIDs bsky.app's PDS reports
// (src/posting/lib/recordCid.test.js); the rest cover what records carry:
// facets, embeds with blobs, unicode, nested and empty containers, large
// integers, bytes and links, and the shapes the encoder refuses.
//
// toJsonShape's inputs hold JavaScript objects JSON can't: they are written
// tagged ({ $u8 }, { $cid }, { $blobRef }, { $date }, { $lex },
// { $undefined }) and built before the call; the Swift test builds the
// same values from its own types (Data, CID, BlobRef, Date).

import { BlobRef, jsonToLex } from '@atproto/api';
import { CID } from 'multiformats/cid';
import {
  computeRecordCid,
  toJsonShape,
} from '../../../src/posting/lib/recordCid.js';
import { each } from './_helpers.js';

export const sources = ['src/posting/lib/recordCid.js'];

const CID_POST = 'bafyreig6kgwgaixxenkfv62gkz43fgdyoe2ddbgqbfr2edkqv5ya5kginu';
const CID_IMAGE = 'bafkreifvw4djmv7ney453nfyozyvoxvrwrlnpmbfhezarsn6plkrcvrw64';
const CID_THUMB = 'bafkreihlfz7eeyynraq3zqhozs4q3l3wabewbjevjb5jgophbtcjj7eijm';

const blob = (ref, mimeType = 'image/jpeg', size = 1234) => ({
  $type: 'blob',
  ref: { $link: ref },
  mimeType,
  size,
});

// Real records from bsky.app's PDS, with the CIDs it reports for them.
const VECTORS = [
  {
    $id: 'pds: post with record embed, facets, unicode',
    expect: 'bafyreig6kgwgaixxenkfv62gkz43fgdyoe2ddbgqbfr2edkqv5ya5kginu',
    record: {
      text: 'Personnel news: @toni.bsky.team is dropping the “interim” from his title and will serve as our permanent CEO!',
      $type: 'app.bsky.feed.post',
      embed: {
        $type: 'app.bsky.embed.record',
        record: {
          cid: 'bafyreigov2ns6elnyiksqufzr6ctfg4i4eiodharfupyoc5sq23tvyew4a',
          uri: 'at://did:plc:cwf4mmm7mpzistinx3ox2zhj/app.bsky.feed.post/3mqcp425edfgx',
        },
      },
      langs: ['en'],
      facets: [
        {
          $type: 'app.bsky.richtext.facet',
          index: { byteEnd: 31, byteStart: 16 },
          features: [
            {
              did: 'did:plc:cwf4mmm7mpzistinx3ox2zhj',
              $type: 'app.bsky.richtext.facet#mention',
            },
          ],
        },
      ],
      createdAt: '2026-07-10T17:43:30.972Z',
    },
  },
  {
    $id: 'pds: post with an image blob over 1MB',
    expect: 'bafyreibowb4zpdgv74mzhpn3w433q4affyql5jd6c43tluinucj4q2jdzy',
    record: {
      text: "v1.127 is live! We're rolling out improvements to search over the coming weeks. You'll get more relevant results and more ways to find what you're looking for. \n\nThe new \"Filters\" button lets you query and filter by keywords, people, date range, language and more. You can even share your searches!",
      $type: 'app.bsky.feed.post',
      embed: {
        $type: 'app.bsky.embed.images',
        images: [
          {
            alt: 'A rendering of the new "Filters" button and option fields, which allow you to query and filter by keywords, people, date range, language and more.',
            image: blob(CID_IMAGE, 'image/jpeg', 1554074),
            aspectRatio: { width: 2140, height: 2000 },
          },
        ],
      },
      langs: ['en'],
      createdAt: '2026-07-09T19:50:16.599Z',
    },
  },
  {
    $id: 'pds: reply with an image blob',
    expect: 'bafyreib3xpze6k6lagrwhjn75wj4daeaj73hvhhjkmt3d5umm6qkqba5fa',
    record: {
      text: 'wait a minute',
      $type: 'app.bsky.feed.post',
      embed: {
        $type: 'app.bsky.embed.images',
        images: [
          {
            alt: 'two spidermen pointing at each other',
            image: blob(CID_THUMB, 'image/jpeg', 161421),
            aspectRatio: { width: 686, height: 386 },
          },
        ],
      },
      langs: ['en'],
      reply: {
        root: {
          cid: 'bafyreigjxsxzw2ywmz3uu5pr33eg5j7xqwzarpjthc4nxmpn3cy4v3vopu',
          uri: 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.post/3mpoezgevvc23',
        },
        parent: {
          cid: 'bafyreifzkundbxh3docpjjd5oyffcxyjk63ha7zoht6iy4y6bjvvct5zgy',
          uri: 'at://did:plc:xxj5ugkba3k6ftpmcl67vv6r/app.bsky.feed.post/3mpog44tffs2r',
        },
      },
      createdAt: '2026-07-02T17:21:51.498Z',
    },
  },
];

const AT = '2026-03-15T12:00:00.000Z';
const post = (fields) => ({
  $type: 'app.bsky.feed.post',
  text: '',
  createdAt: AT,
  ...fields,
});

const RECORDS = [
  ...VECTORS,
  {
    $id: 'pds vector with undefined fields',
    record: { ...VECTORS[0].record, labels: undefined, tags: undefined },
  },
  { $id: 'empty post', record: post({}) },
  { $id: 'plain text', record: post({ text: 'hello world' }) },
  { $id: 'emoji and zwj', record: post({ text: '👨‍👩‍👧‍👦 🏳️‍🌈 👍🏽 🇬🇧' }) },
  { $id: 'cjk', record: post({ text: '日本語のテキスト、한국어, 中文' }) },
  { $id: 'rtl and combining', record: post({ text: 'مرحبا שלום é ä' }) },
  {
    $id: 'nul and controls',
    record: post({ text: 'a\u0000b\u0007c\td\ne\r\n' }),
  },
  { $id: 'bom', record: post({ text: '﻿bom' }) },
  { $id: 'long text', record: post({ text: 'word '.repeat(60).trim() }) },
  { $id: 'long unicode text', record: post({ text: 'ünïcödé '.repeat(150) }) },
  {
    $id: 'facets of every kind',
    record: post({
      text: '@alice.test https://example.com #tag',
      facets: [
        {
          index: { byteStart: 0, byteEnd: 11 },
          features: [
            { $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:alice' },
          ],
        },
        {
          index: { byteStart: 12, byteEnd: 31 },
          features: [
            {
              $type: 'app.bsky.richtext.facet#link',
              uri: 'https://example.com',
            },
          ],
        },
        {
          index: { byteStart: 32, byteEnd: 36 },
          features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'tag' }],
        },
      ],
    }),
  },
  {
    $id: 'external embed with thumb',
    record: post({
      text: 'a link',
      embed: {
        $type: 'app.bsky.embed.external',
        external: {
          uri: 'https://example.com/a?b=c&d=é',
          title: 'Title “quoted”',
          description: '',
          thumb: blob(CID_THUMB, 'image/png', 9),
        },
      },
    }),
  },
  {
    $id: 'record with media',
    record: post({
      embed: {
        $type: 'app.bsky.embed.recordWithMedia',
        record: {
          $type: 'app.bsky.embed.record',
          record: {
            uri: 'at://did:plc:x/app.bsky.feed.post/3k2',
            cid: CID_POST,
          },
        },
        media: {
          $type: 'app.bsky.embed.images',
          images: [
            { alt: 'one', image: blob(CID_IMAGE) },
            {
              alt: 'two',
              image: blob(CID_THUMB, 'image/webp', 0),
              aspectRatio: { width: 1, height: 1 },
            },
          ],
        },
      },
    }),
  },
  {
    $id: 'video',
    record: post({
      embed: {
        $type: 'app.bsky.embed.video',
        video: blob(CID_IMAGE, 'video/mp4', 50_000_000),
        captions: [{ lang: 'en', file: blob(CID_THUMB, 'text/vtt', 120) }],
        alt: 'a video',
        aspectRatio: { width: 16, height: 9 },
      },
    }),
  },
  {
    $id: 'self labels and tags',
    record: post({
      text: 'nsfw',
      labels: {
        $type: 'com.atproto.label.defs#selfLabels',
        values: [{ val: 'porn' }],
      },
      tags: ['one', 'two'],
      langs: ['en', 'ja', 'pt-BR'],
    }),
  },
  {
    $id: 'like',
    record: {
      $type: 'app.bsky.feed.like',
      subject: { uri: 'at://did:plc:x/app.bsky.feed.post/3k2', cid: CID_POST },
      createdAt: AT,
    },
  },
  {
    $id: 'repost via',
    record: {
      $type: 'app.bsky.feed.repost',
      subject: { uri: 'at://did:plc:x/app.bsky.feed.post/3k2', cid: CID_POST },
      via: { uri: 'at://did:plc:y/app.bsky.feed.repost/3k3', cid: CID_POST },
      createdAt: AT,
    },
  },
  {
    $id: 'follow',
    record: {
      $type: 'app.bsky.graph.follow',
      subject: 'did:plc:x',
      createdAt: AT,
    },
  },
  {
    $id: 'block',
    record: {
      $type: 'app.bsky.graph.block',
      subject: 'did:plc:x',
      createdAt: AT,
    },
  },
  {
    $id: 'threadgate',
    record: {
      $type: 'app.bsky.feed.threadgate',
      post: 'at://did:plc:x/app.bsky.feed.post/3k2',
      allow: [
        { $type: 'app.bsky.feed.threadgate#mentionRule' },
        {
          $type: 'app.bsky.feed.threadgate#listRule',
          list: 'at://did:plc:x/app.bsky.graph.list/3k',
        },
      ],
      hiddenReplies: [],
      createdAt: AT,
    },
  },
  {
    $id: 'postgate',
    record: {
      $type: 'app.bsky.feed.postgate',
      post: 'at://did:plc:x/app.bsky.feed.post/3k2',
      detachedEmbeddingUris: [],
      embeddingRules: [{ $type: 'app.bsky.feed.postgate#disableRule' }],
      createdAt: AT,
    },
  },
  {
    $id: 'profile',
    record: {
      $type: 'app.bsky.actor.profile',
      displayName: 'Ünïcödé ✨',
      description: 'line one\nline two',
      avatar: blob(CID_IMAGE, 'image/png', 1),
      banner: blob(CID_THUMB, 'image/jpeg', 2),
      pinnedPost: {
        uri: 'at://did:plc:x/app.bsky.feed.post/3k2',
        cid: CID_POST,
      },
    },
  },
  {
    $id: 'list and listitem shapes',
    record: {
      $type: 'app.bsky.graph.list',
      purpose: 'app.bsky.graph.defs#modlist',
      name: 'Mods',
      descriptionFacets: [],
      createdAt: AT,
    },
  },
  // Values a custom lexicon may hold.
  {
    $id: 'integers',
    record: {
      $type: 'x.y',
      a: 0,
      b: -1,
      c: 23,
      d: 24,
      e: 255,
      f: 65_536,
      g: 2 ** 32,
    },
  },
  {
    $id: 'largest integers',
    record: { $type: 'x.y', max: 2 ** 53 - 1, min: -(2 ** 53 - 1) },
  },
  {
    $id: 'floats',
    record: { $type: 'x.y', half: 0.5, tiny: 1e-7, pi: 3.141592653589793 },
  },
  { $id: 'negative zero', record: { $type: 'x.y', z: -0 } },
  {
    $id: 'booleans and null',
    record: { $type: 'x.y', t: true, f: false, n: null },
  },
  {
    $id: 'nested arrays',
    record: { $type: 'x.y', a: [[[]], [[1, [2, [3]]]], [{}, []]] },
  },
  {
    $id: 'empty objects',
    record: { $type: 'x.y', a: {}, b: { c: {} }, d: [{}] },
  },
  { $id: 'empty record', record: {} },
  {
    $id: 'unicode keys',
    record: {
      $type: 'x.y',
      é: 1,
      z: 2,
      日本: 3,
      '\u{10000}': 4,
      '｡': 5,
      aa: 6,
    },
  },
  {
    $id: 'many keys',
    record: Object.fromEntries(
      Array.from({ length: 50 }, (_, i) => [`key${(i * 37) % 101}`, i]),
    ),
  },
  {
    $id: 'same-length keys',
    record: { $type: 'x.y', ab: 1, ba: 2, aB: 3, Ab: 4, 'a-': 5, a_: 6 },
  },
  { $id: 'bytes', record: { $type: 'x.y', sig: { $bytes: 'AQIDBAUGBwg' } } },
  {
    $id: 'bytes padded',
    record: { $type: 'x.y', sig: { $bytes: 'AQIDBAUGBwg=' } },
  },
  { $id: 'link', record: { $type: 'x.y', ref: { $link: CID_POST } } },
  { $id: 'raw link', record: { $type: 'x.y', ref: { $link: CID_IMAGE } } },
  {
    $id: 'link-shaped map',
    record: { $type: 'x.y', ref: { $link: CID_POST, note: 'not a link' } },
  },
  // Values that aren't records but encode all the same.
  { $id: 'a string', record: 'hello' },
  { $id: 'a number', record: 42 },
  { $id: 'an array', record: [1, 'two', null] },
  { $id: 'null', record: null },
  // What the encoder refuses.
  { $id: 'bad link', record: { $type: 'x.y', ref: { $link: 'not-a-cid' } } },
  { $id: 'link not a string', record: { $type: 'x.y', ref: { $link: 7 } } },
  { $id: 'bad bytes', record: { $type: 'x.y', sig: { $bytes: '@@' } } },
  { $id: 'bytes not a string', record: { $type: 'x.y', sig: { $bytes: [1] } } },
  { $id: 'number past 2^53', record: { $type: 'x.y', big: 2 ** 53 } },
  { $id: 'constructor key', record: { $type: 'x.y', constructor: 'z' } },
  {
    $id: 'nested constructor key',
    record: { $type: 'x.y', o: { constructor: 1, $link: CID_POST } },
  },
];

/** Builds the JavaScript values a tagged input names. */
function untag(value) {
  if (Array.isArray(value)) return value.map(untag);
  if (value === null || typeof value !== 'object') return value;
  if ('$u8' in value) return new Uint8Array(value.$u8);
  if ('$cid' in value) return CID.parse(value.$cid);
  if ('$blobRef' in value) {
    const ref = jsonToLex(value.$blobRef);
    if (!(ref instanceof BlobRef)) throw new Error('not a BlobRef');
    return ref;
  }
  if ('$date' in value) return new Date(value.$date);
  if ('$lex' in value) return jsonToLex(value.$lex);
  if ('$undefined' in value) return undefined;
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, untag(v)]),
  );
}

const SHAPES = [
  {
    $id: 'blob ref',
    value: { image: { $blobRef: blob(CID_THUMB, 'image/jpeg', 42) } },
  },
  {
    $id: 'legacy blob ref',
    value: { $blobRef: { cid: CID_THUMB, mimeType: 'image/png' } },
  },
  { $id: 'bytes', value: { b: { $u8: [1, 2, 3] } } },
  { $id: 'bytes empty', value: { $u8: [] } },
  { $id: 'bytes one', value: { $u8: [255] } },
  { $id: 'bytes two', value: { $u8: [255, 254] } },
  {
    $id: 'bytes many',
    value: { $u8: Array.from({ length: 100 }, (_, i) => (i * 7) % 256) },
  },
  { $id: 'cid', value: { ref: { $cid: CID_POST } } },
  { $id: 'raw cid', value: { $cid: CID_IMAGE } },
  { $id: 'date', value: { at: { $date: AT } } },
  { $id: 'date with ms', value: { $date: '2026-03-15T12:00:00.123Z' } },
  {
    $id: 'primitives and nesting',
    value: {
      a: 1,
      b: 'two',
      c: [true, null, { d: 'e', f: { $undefined: true } }],
    },
  },
  {
    $id: 'undefined members dropped',
    value: { a: { $undefined: true }, b: 2 },
  },
  { $id: 'undefined in an array', value: [1, { $undefined: true }] },
  { $id: 'string', value: 'text' },
  { $id: 'number', value: 3.5 },
  { $id: 'null', value: null },
  { $id: 'boolean', value: false },
  { $id: 'empty object', value: {} },
  {
    $id: 'record with instances',
    value: {
      $lex: {
        $type: 'app.bsky.feed.post',
        text: 'x',
        embed: {
          $type: 'app.bsky.embed.images',
          images: [{ alt: '', image: blob(CID_IMAGE) }],
        },
        sig: { $bytes: 'AQID' },
        ref: { $link: CID_POST },
        createdAt: AT,
      },
    },
  },
];

export default async function cases() {
  return [
    ...(await each('computeRecordCid', RECORDS, ({ record }) =>
      computeRecordCid(record),
    )),
    ...(await each(
      'computeRecordCid.instances',
      [
        {
          $id: 'pds vector with a BlobRef instance',
          value: {
            ...VECTORS[1].record,
            embed: {
              ...VECTORS[1].record.embed,
              images: [
                {
                  ...VECTORS[1].record.embed.images[0],
                  image: { $blobRef: VECTORS[1].record.embed.images[0].image },
                },
              ],
            },
          },
        },
        { $id: 'record with instances', value: SHAPES.at(-1).value },
      ],
      ({ value }) => computeRecordCid(untag(value)),
    )),
    ...(await each('toJsonShape', SHAPES, ({ value }) =>
      toJsonShape(untag(value)),
    )),
  ];
}
