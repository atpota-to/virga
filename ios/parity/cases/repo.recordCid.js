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

// Encoder boundaries: argument widths for integers, string and array
// lengths and map sizes, the encoder's long-string path (1,024 UTF-16 units
// and up), its sort for more than 32 keys, and keys whose UTF-16 order is
// not their UTF-8 order.
const lengthOf = (n, unit = 'x') => unit.repeat(n);
const BOUNDARY_RECORDS = [
  {
    $id: 'integer argument widths',
    record: {
      $type: 'x.y',
      values: [
        22,
        23,
        24,
        25,
        254,
        255,
        256,
        257,
        65_534,
        65_535,
        65_536,
        65_537,
        2 ** 32 - 2,
        2 ** 32 - 1,
        2 ** 32,
        2 ** 32 + 1,
        2 ** 52,
        2 ** 53 - 2,
      ],
    },
  },
  {
    $id: 'negative integer argument widths',
    record: {
      $type: 'x.y',
      values: [
        -23,
        -24,
        -25,
        -26,
        -255,
        -256,
        -257,
        -258,
        -65_535,
        -65_536,
        -65_537,
        -(2 ** 32) + 1,
        -(2 ** 32),
        -(2 ** 32) - 1,
        -(2 ** 53) + 2,
      ],
    },
  },
  {
    $id: 'floats of every size',
    record: {
      $type: 'x.y',
      values: [
        -0.5,
        1.5,
        1e300,
        -1e300,
        5e-324,
        -5e-324,
        2 ** 52 + 0.5,
        1e-7,
        0.1,
        2 ** 53 - 1.5,
        123456.789,
      ],
    },
  },
  { $id: 'negative zero in an array', record: [-0, 0, -0.0] },
  ...[23, 24, 255, 256, 1023, 1024, 1025, 65_535, 65_536].map((n) => ({
    $id: `ascii string of ${n}`,
    record: { $type: 'x.y', text: lengthOf(n) },
  })),
  ...[11, 12, 127, 128, 511, 512, 513, 1023, 1024].map((n) => ({
    $id: `two-byte string of ${n} units`,
    record: { $type: 'x.y', text: lengthOf(n, 'é') },
  })),
  ...[341, 342, 1024].map((n) => ({
    $id: `three-byte string of ${n} units`,
    record: { $type: 'x.y', text: lengthOf(n, '€') },
  })),
  {
    $id: 'surrogate pairs past the long-string mark',
    record: { $type: 'x.y', text: lengthOf(600, '😀') },
  },
  {
    $id: 'mixed text past the long-string mark',
    record: { $type: 'x.y', text: `${lengthOf(1000)}é😀€${lengthOf(30)}` },
  },
  ...[23, 24, 255, 256].map((n) => ({
    $id: `array of ${n}`,
    record: { $type: 'x.y', a: Array.from({ length: n }, (_, i) => i % 3) },
  })),
  ...[23, 24, 32, 33, 255, 256].map((n) => ({
    $id: `map of ${n} keys`,
    record: Object.fromEntries(
      Array.from({ length: n }, (_, i) => [`k${(i * 7919) % 1000}`, i]),
    ),
  })),
  {
    $id: 'more than 32 keys, some not ASCII',
    record: Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [
        ['é', '日', '😀', 'a', 'Z', '\u{10000}', '｡', '\u007f'][i % 8] +
          String(i),
        i,
      ]),
    ),
  },
  {
    $id: 'keys whose UTF-16 order is not their UTF-8 order',
    record: {
      '\u{10000}a': 1,
      '｡é': 2,
      '￿': 3,
      '\u{10000}': 4,
      '': 5,
    },
  },
  {
    $id: 'keys of equal UTF-8 length, different UTF-16 length',
    record: { '😀': 1, éé: 2, aaaa: 3, '€a': 4, 'a€': 5 },
  },
  {
    $id: 'a key that is a number',
    record: { 10: 'ten', 9: 'nine', a: 'a', '-1': 'm', 1.5: 'f' },
  },
  { $id: 'empty key', record: { '': 1, a: 2 } },
  {
    $id: 'nested deeply',
    record: JSON.parse(`${'{"a":'.repeat(100)}1${'}'.repeat(100)}`),
  },
  // Links and bytes.
  { $id: 'bytes empty', record: { sig: { $bytes: '' } } },
  { $id: 'bytes one byte', record: { sig: { $bytes: 'AQ' } } },
  { $id: 'bytes one byte padded', record: { sig: { $bytes: 'AQ==' } } },
  { $id: 'bytes two bytes padded', record: { sig: { $bytes: 'AQI=' } } },
  { $id: 'bytes only padding', record: { sig: { $bytes: '=' } } },
  { $id: 'bytes wrong padding', record: { sig: { $bytes: 'AQ=' } } },
  { $id: 'bytes non-canonical bits', record: { sig: { $bytes: 'AR' } } },
  { $id: 'bytes url alphabet', record: { sig: { $bytes: '-_8' } } },
  { $id: 'bytes with a newline', record: { sig: { $bytes: 'AQID\n' } } },
  { $id: 'bytes one char', record: { sig: { $bytes: 'A' } } },
  {
    $id: 'bytes 256 long',
    record: {
      sig: {
        $bytes: Buffer.from(Array.from({ length: 256 }, (_, i) => i))
          .toString('base64')
          .replace(/=+$/, ''),
      },
    },
  },
  { $id: 'link uppercase', record: { ref: { $link: CID_POST.toUpperCase() } } },
  { $id: 'link padded', record: { ref: { $link: ` ${CID_POST}` } } },
  { $id: 'link short', record: { ref: { $link: CID_POST.slice(0, 58) } } },
  {
    $id: 'link CIDv0',
    record: {
      ref: { $link: 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG' },
    },
  },
  { $id: 'link null', record: { ref: { $link: null } } },
  { $id: 'bytes null', record: { sig: { $bytes: null } } },
  { $id: 'link an object', record: { ref: { $link: { $link: CID_POST } } } },
  // Objects with their own `constructor`, which the encoder doesn't take
  // for plain objects.
  {
    $id: 'constructor and toString',
    record: { constructor: 1, toString: 'x' },
  },
  { $id: 'constructor and valueOf', record: { constructor: 1, valueOf: 'x' } },
  { $id: 'constructor null', record: { constructor: null } },
  { $id: 'constructor an object', record: { constructor: {} } },
  {
    $id: 'constructor and a link',
    record: { constructor: 1, $link: CID_POST, other: 2 },
  },
  { $id: 'constructor and bytes', record: { constructor: 1, $bytes: 'AQID' } },
  {
    $id: 'constructor, a link and bytes',
    record: { constructor: 1, $bytes: 'AQID', $link: CID_POST },
  },
  { $id: 'constructor and a bad link', record: { constructor: 1, $link: 7 } },
  {
    $id: 'constructor and a null link',
    record: { constructor: 1, $link: null },
  },
  { $id: 'constructor and bad bytes', record: { constructor: 1, $bytes: 7 } },
  {
    $id: 'constructor and invalid bytes',
    record: { constructor: 1, $bytes: '@@' },
  },
  {
    $id: 'first refusal in key order',
    record: { b: { constructor: 1 }, a: { $link: 'bad' } },
  },
  {
    $id: 'first refusal in canonical key order',
    record: { aa: { $link: 'bad' }, b: { constructor: 1 } },
  },
];

// Records as JSON text, parsed by JSON.parse as a record from the network
// or storage is, so a member named "__proto__" is a real member (the
// fixtures' own JSON can't carry one any other way). toJsonShape rebuilds
// each object with `out[key] = …`, which makes it the prototype instead.
const LINK = CID_POST;
const PROTO_RECORDS = [
  '{"a":1}',
  '{"__proto__":5,"a":1}',
  '{"__proto__":"x","a":1}',
  '{"__proto__":true}',
  '{"__proto__":{},"a":1}',
  '{"__proto__":{"b":2},"a":1}',
  '{"__proto__":null,"a":1}',
  '{"__proto__":null}',
  `{"__proto__":null,"$link":"${LINK}"}`,
  '{"__proto__":null,"$bytes":"AQID"}',
  '{"__proto__":null,"$link":5}',
  '{"__proto__":null,"toString":1}',
  `{"__proto__":{"$link":"${LINK}"},"constructor":1}`,
  `{"__proto__":{"$link":"${LINK}"}}`,
  `{"__proto__":{"$link":"${LINK}"},"$link":"${LINK}"}`,
  '{"__proto__":{"$bytes":"AQID"},"constructor":1}',
  '{"__proto__":{"constructor":1}}',
  '{"__proto__":{"constructor":null}}',
  '{"__proto__":{"constructor":1,"toString":1}}',
  '{"__proto__":{"constructor":1,"$link":"x"}}',
  '{"__proto__":{"constructor":1,"$bytes":"@@"}}',
  '{"__proto__":{"constructor":1,"$bytes":5}}',
  '{"__proto__":{"valueOf":1}}',
  '{"__proto__":{"__proto__":null},"a":1}',
  '{"__proto__":{"__proto__":null,"constructor":1}}',
  '{"__proto__":{"__proto__":[7,8]}}',
  '{"__proto__":{"0":1,"length":2},"constructor":1}',
  '{"__proto__":[1,2],"a":1}',
  '{"__proto__":[],"x":1}',
  '{"__proto__":[[]],"x":1}',
  '{"__proto__":[1,2],"0":"own0"}',
  '{"__proto__":[1,2],"5":"five"}',
  '{"__proto__":[1,2],"length":3}',
  '{"__proto__":[1,2],"length":"2"}',
  '{"__proto__":[1,2],"length":-4}',
  '{"__proto__":[1,2],"length":2.9}',
  '{"__proto__":[1,2],"length":1000}',
  '{"__proto__":[1,2],"length":4294967296}',
  '{"__proto__":[1,2],"length":1e300}',
  '{"__proto__":[1,2],"length":{"toString":1}}',
  '{"__proto__":[1,2],"length":[3]}',
  '{"__proto__":[1,[2,3],null,{"a":1}]}',
  '{"__proto__":[{"toString":1}]}',
  '{"__proto__":[{"__proto__":null}]}',
  '{"__proto__":[{"__proto__":[4,5]}]}',
  '{"__proto__":[1e21,-0,0.5,true,"s"]}',
  '{"__proto__":[1,2],"join":1}',
  '{"__proto__":[1,2],"toString":1}',
  '{"__proto__":[1,2],"constructor":1}',
  '{"__proto__":[1,2],"$link":5}',
  `{"__proto__":[1,2],"$link":"${LINK}"}`,
  '{"x":{"__proto__":null}}',
  '[{"__proto__":null}]',
  '{"a":{"__proto__":{"constructor":1}},"b":{"$link":"bad"}}',
  '{"b":{"__proto__":{"constructor":1}},"a":{"$link":"bad"}}',
  `{"$type":"app.bsky.feed.post","text":"hi","createdAt":"${AT}","__proto__":{"text":"shadowed"}}`,
  `{"$type":"app.bsky.feed.post","text":"hi","createdAt":"${AT}","embed":{"__proto__":[1]}}`,
].map((json) => ({ $id: json, json }));

export default async function cases() {
  return [
    ...(await each(
      'computeRecordCid',
      [...RECORDS, ...BOUNDARY_RECORDS],
      ({ record }) => computeRecordCid(record),
    )),
    ...(await each('computeRecordCid.json', PROTO_RECORDS, ({ json }) =>
      computeRecordCid(JSON.parse(json)),
    )),
    ...(await each('toJsonShape.json', PROTO_RECORDS, ({ json }) =>
      toJsonShape(JSON.parse(json)),
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
