// The harness's repo CAR (harness/buildCar.js): small CARs whole, as
// base64 (prefix-compressed keys, links and bytes in records, keys past
// ASCII, an empty repo, a record the encoder refuses), and both accounts'
// whole repos by length and digest. Swift: VirgaDemo/Harness/BuildCar.swift;
// tests in ios/VirgaKit/Tests/VirgaDemoTests/BuildCarParityTests.swift, which
// also read every CAR back through VirgaRepo's reader.

import { buildRepoCar } from '../../../harness/buildCar.js';
import { LAB, buildWorld, repoRecords } from '../../../harness/world.js';
import { each } from './_helpers.js';
import { sha256Bytes } from './_canonical.js';
import { NOW } from './_demoWorld.js';

export const sources = ['harness/buildCar.js'];

const POST = 'app.bsky.feed.post';

const SMALL = [
  {
    $id: 'handful',
    did: 'did:plc:carparity',
    records: [
      [
        'app.bsky.actor.profile/self',
        { $type: 'app.bsky.actor.profile', displayName: 'Car' },
      ],
      [
        `${POST}/3kaaaaaaaaaa2`,
        { $type: POST, text: 'one', createdAt: '2026-03-15T12:00:00.000Z' },
      ],
      [`${POST}/3kaaaaaaaaab2`, { $type: POST, text: 'two 😀', langs: ['en'] }],
      [
        `${POST}/3kbbbbbbbbbb2`,
        {
          $type: POST,
          text: 'é',
          facets: [{ index: { byteStart: 0, byteEnd: 2 }, features: [] }],
        },
      ],
      [
        'app.bsky.feed.post/3kccccccccc22',
        {
          $type: POST,
          text: 'with a picture',
          embed: {
            $type: 'app.bsky.embed.images',
            images: [
              {
                alt: '',
                image: {
                  $type: 'blob',
                  ref: {
                    $link:
                      'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
                  },
                  mimeType: 'image/png',
                  size: 0,
                },
              },
            ],
          },
        },
      ],
      [
        'zz.bytes/one',
        {
          $type: 'zz.bytes',
          data: { $bytes: 'AQID' },
          n: -7,
          f: 1.5,
          ok: true,
          none: null,
        },
      ],
    ],
  },
  {
    $id: 'custom-rev',
    did: 'did:web:example.com',
    rev: '3zzzzzzzzzzzz',
    records: [['a.b/c', { $type: 'a.b' }]],
  },
  { $id: 'empty', did: 'did:plc:empty', records: [] },
  {
    $id: 'same-record-twice',
    did: 'did:plc:twice',
    records: [
      ['a.b/1', { $type: 'a.b', n: 1 }],
      ['a.b/2', { $type: 'a.b', n: 1 }],
    ],
  },
  {
    $id: 'keys-past-ascii',
    did: 'did:plc:unicode',
    records: [
      ['a.b/é1', { $type: 'a.b' }],
      ['a.b/é2', { $type: 'a.b' }],
      ['a.b/😀', { $type: 'a.b' }],
      ['a.b/😁', { $type: 'a.b' }],
    ],
  },
  {
    $id: 'bad-link',
    did: 'did:plc:bad',
    records: [['a.b/c', { $type: 'a.b', ref: { $link: 'not a cid' } }]],
  },
];

const base64 = (bytes) => Buffer.from(bytes).toString('base64');

export default async function cases() {
  return [
    ...(await each('buildRepoCar', SMALL, async ({ did, records, rev }) => {
      const car = await buildRepoCar(
        did,
        records,
        rev === undefined ? undefined : { rev },
      );
      return {
        length: car.length,
        sha256: sha256Bytes(car),
        base64: base64(car),
      };
    })),
    ...(await each(
      'buildRepoCar-world',
      [
        { $id: 'mira', account: 'me' },
        { $id: 'lab', account: 'lab' },
      ],
      async ({ account }) => {
        const world = buildWorld({
          now: NOW,
          account: account === 'lab' ? LAB : undefined,
        });
        const records = repoRecords(world);
        const car = await buildRepoCar(world.me.did, records);
        return {
          records: records.length,
          length: car.length,
          sha256: sha256Bytes(car),
        };
      },
    )),
  ];
}
