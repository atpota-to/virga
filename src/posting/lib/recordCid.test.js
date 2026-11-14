import { describe, it, expect } from 'vitest';
import { BlobRef, jsonToLex } from '@atproto/api';
import { computeRecordCid, toJsonShape } from './recordCid.js';

// computeRecordCid must match the PDS byte for byte: a thread written as one
// applyWrites batch chains replies through locally computed parent CIDs, and a
// mismatch silently corrupts the thread. The vectors are real records from the
// bsky.app account's PDS (listRecords) with the CIDs the server reports. If
// these fail, do not adjust the expectations; the encoding is wrong.

const VECTORS = [
  {
    name: 'post with record embed, facets (mention), unicode text',
    cid: 'bafyreig6kgwgaixxenkfv62gkz43fgdyoe2ddbgqbfr2edkqv5ya5kginu',
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
    name: 'post with image blob ($link ref) over 1MB',
    cid: 'bafyreibowb4zpdgv74mzhpn3w433q4affyql5jd6c43tluinucj4q2jdzy',
    record: {
      text: "v1.127 is live! We're rolling out improvements to search over the coming weeks. You'll get more relevant results and more ways to find what you're looking for. \n\nThe new \"Filters\" button lets you query and filter by keywords, people, date range, language and more. You can even share your searches!",
      $type: 'app.bsky.feed.post',
      embed: {
        $type: 'app.bsky.embed.images',
        images: [
          {
            alt: 'A rendering of the new "Filters" button and option fields, which allow you to query and filter by keywords, people, date range, language and more.',
            image: {
              ref: {
                $link:
                  'bafkreifvw4djmv7ney453nfyozyvoxvrwrlnpmbfhezarsn6plkrcvrw64',
              },
              size: 1554074,
              $type: 'blob',
              mimeType: 'image/jpeg',
            },
            aspectRatio: { width: 2140, height: 2000 },
          },
        ],
      },
      langs: ['en'],
      createdAt: '2026-07-09T19:50:16.599Z',
    },
  },
  {
    name: 'reply with image blob — the thread-chaining shape',
    cid: 'bafyreib3xpze6k6lagrwhjn75wj4daeaj73hvhhjkmt3d5umm6qkqba5fa',
    record: {
      text: 'wait a minute',
      $type: 'app.bsky.feed.post',
      embed: {
        $type: 'app.bsky.embed.images',
        images: [
          {
            alt: 'two spidermen pointing at each other',
            image: {
              ref: {
                $link:
                  'bafkreihlfz7eeyynraq3zqhozs4q3l3wabewbjevjb5jgophbtcjj7eijm',
              },
              size: 161421,
              $type: 'blob',
              mimeType: 'image/jpeg',
            },
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

describe('computeRecordCid', () => {
  for (const { name, cid, record } of VECTORS) {
    it(`matches the PDS-computed CID: ${name}`, async () => {
      await expect(computeRecordCid(record)).resolves.toBe(cid);
    });
  }

  it('ignores fields set to undefined (matches what JSON transport drops)', async () => {
    const base = VECTORS[0].record;
    const withUndefined = { ...base, labels: undefined, tags: undefined };
    await expect(computeRecordCid(withUndefined)).resolves.toBe(VECTORS[0].cid);
  });

  it('gives the same CID for a record whose blob is a BlobRef instance', async () => {
    const { record, cid } = VECTORS[1];
    const json = record.embed.images[0].image;
    const blobRef = jsonToLex(json);
    expect(blobRef).toBeInstanceOf(BlobRef);
    const withInstance = {
      ...record,
      embed: {
        ...record.embed,
        images: [{ ...record.embed.images[0], image: blobRef }],
      },
    };
    await expect(computeRecordCid(withInstance)).resolves.toBe(cid);
  });
});

describe('toJsonShape', () => {
  it('turns a BlobRef into its JSON form', () => {
    const json = {
      $type: 'blob',
      ref: {
        $link: 'bafkreihlfz7eeyynraq3zqhozs4q3l3wabewbjevjb5jgophbtcjj7eijm',
      },
      mimeType: 'image/jpeg',
      size: 42,
    };
    expect(toJsonShape({ image: jsonToLex(json) })).toEqual({
      image: json,
    });
  });

  it('turns bytes into $bytes', () => {
    expect(toJsonShape({ b: new Uint8Array([1, 2, 3]) })).toEqual({
      b: { $bytes: 'AQID' },
    });
  });

  it('leaves primitives, arrays and nested objects intact, dropping undefined', () => {
    const input = { a: 1, b: 'two', c: [true, null, { d: 'e', f: undefined }] };
    expect(toJsonShape(input)).toEqual({
      a: 1,
      b: 'two',
      c: [true, null, { d: 'e' }],
    });
  });
});
