// src/lib/carRepo.js: a repo CAR downloaded (fetchRepoCar), parsed into
// records (readRepoCar) and dated into atmosphere rows
// (atmosphereRowFromEntry). Swift: VirgaRepo/CarRepo.swift.
//
// The CARs are real: the harness's own builder (harness/buildCar.js), repos
// laid out as a real MST lays them out, the web tests' fixture, and repos
// with every kind of malformed block the walk reads without checking its
// shape. The download is recorded against a fake fetch that answers with
// exactly the chunks the case names, so the Swift test can replay them.

import {
  atmosphereRowFromEntry,
  fetchRepoCar,
  readRepoCar,
} from '../../../src/lib/carRepo.js';
import { createHash } from 'node:crypto';
import { toBytes } from '@atcute/cbor';
import { toCidLink } from '@atcute/cid';
import { buildRepoCar } from '../../../harness/buildCar.js';
import {
  buildMstRepo,
  carOf,
  compressedEntries,
  dagBlock,
  fromB64,
  keyBytes,
  rawBlock,
  rawKey,
  toB64,
} from './_repoCars.js';
import { each, FIXED_NOW, DAY } from './_helpers.js';

export const sources = ['src/lib/carRepo.js'];

const DID = 'did:plc:repoparity';
const B32 = '234567abcdefghijklmnopqrstuvwxyz';

/** A real TID for a time, as the web's tests mint one. */
function tidFor(ms, clock = 5) {
  let n = ((BigInt(Math.floor(ms)) * 1000n) << 10n) | BigInt(clock);
  let s = '';
  for (let i = 0; i < 13; i++) {
    s = B32[Number(n & 31n)] + s;
    n >>= 5n;
  }
  return s;
}

const BLOB = {
  $type: 'blob',
  ref: { $link: 'bafkreifvw4djmv7ney453nfyozyvoxvrwrlnpmbfhezarsn6plkrcvrw64' },
  mimeType: 'image/jpeg',
  size: 1554074,
};

/** Records across several collections, as a live repo holds them. */
function repoRecords() {
  const at = (days) => new Date(FIXED_NOW - days * DAY).toISOString();
  const records = [
    [
      `app.bsky.actor.profile/self`,
      {
        $type: 'app.bsky.actor.profile',
        displayName: 'Parity ✨',
        avatar: BLOB,
      },
    ],
    [
      `app.bsky.feed.like/${tidFor(FIXED_NOW - 3 * DAY)}`,
      {
        $type: 'app.bsky.feed.like',
        subject: {
          uri: 'at://did:plc:them/app.bsky.feed.post/3kaaaaaaaaaa2',
          cid: 'bafyreig6kgwgaixxenkfv62gkz43fgdyoe2ddbgqbfr2edkqv5ya5kginu',
        },
        createdAt: at(3),
      },
    ],
    [
      `app.bsky.feed.like/${tidFor(FIXED_NOW - 2 * DAY)}`,
      {
        $type: 'app.bsky.feed.like',
        subject: {
          uri: 'at://did:plc:them/app.bsky.feed.post/3kaaaaaaaaab2',
          cid: 'bafyx',
        },
        createdAt: at(2),
      },
    ],
    [
      `app.bsky.feed.post/${tidFor(FIXED_NOW - 5 * DAY)}`,
      {
        $type: 'app.bsky.feed.post',
        text: 'héllo 👋🏽 @friend.bsky.social #tag https://example.com',
        langs: ['en', 'fr'],
        facets: [
          {
            $type: 'app.bsky.richtext.facet',
            index: { byteStart: 12, byteEnd: 31 },
            features: [
              {
                $type: 'app.bsky.richtext.facet#mention',
                did: 'did:plc:friend',
              },
            ],
          },
        ],
        embed: {
          $type: 'app.bsky.embed.images',
          images: [
            { alt: 'a cat', image: BLOB, aspectRatio: { width: 4, height: 3 } },
          ],
        },
        createdAt: at(5),
      },
    ],
    [
      `app.bsky.feed.post/${tidFor(FIXED_NOW - DAY)}`,
      {
        $type: 'app.bsky.feed.post',
        text: '',
        reply: {
          root: {
            uri: 'at://did:plc:them/app.bsky.feed.post/3kaaaaaaaaaa2',
            cid: 'bafyroot',
          },
          parent: {
            uri: 'at://did:plc:them/app.bsky.feed.post/3kaaaaaaaaab2',
            cid: 'bafyparent',
          },
        },
        createdAt: '2026-03-14T12:00:00.000000Z',
      },
    ],
    [
      `app.bsky.feed.repost/${tidFor(FIXED_NOW - 4 * DAY)}`,
      {
        $type: 'app.bsky.feed.repost',
        subject: {
          uri: 'at://did:plc:them/app.bsky.feed.post/x',
          cid: 'bafyx',
        },
        createdAt: at(4),
      },
    ],
    [
      `app.bsky.graph.follow/${tidFor(FIXED_NOW - 10 * DAY)}`,
      {
        $type: 'app.bsky.graph.follow',
        subject: 'did:plc:them',
        createdAt: at(10),
      },
    ],
    [
      `app.bsky.graph.listitem/${tidFor(FIXED_NOW - 6 * DAY)}`,
      {
        $type: 'app.bsky.graph.listitem',
        list: 'at://did:plc:repoparity/app.bsky.graph.list/3kaaaaaaaaaa2',
        subject: 'did:plc:them',
        createdAt: at(6),
      },
    ],
    [
      'is.dame.arena.mirror.connection/12345',
      {
        $type: 'is.dame.arena.mirror.connection',
        connectedAt: '2026-01-02T03:04:05.000Z',
      },
    ],
    [
      'is.dame.page/about',
      { $type: 'is.dame.page', title: 'About', updatedAt: 'Mar 1, 2026' },
    ],
    [
      'is.dame.page/undated',
      { $type: 'is.dame.page', title: 'No date', big: 2 ** 53 - 1, neg: -7 },
    ],
    [
      'xyz.custom.thing/日本',
      {
        $type: 'xyz.custom.thing',
        nested: { deep: [[], {}, [{ a: null }]] },
        sig: { $bytes: 'AQIDBAU' },
        link: {
          $link: 'bafyreig6kgwgaixxenkfv62gkz43fgdyoe2ddbgqbfr2edkqv5ya5kginu',
        },
        float: 0.5,
        publishedAt: '2025-12-25',
      },
    ],
  ];
  return records.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** Many records for a multi-level tree. */
function manyRecords() {
  const collections = [
    'app.bsky.feed.like',
    'app.bsky.feed.post',
    'app.bsky.feed.repost',
    'app.bsky.graph.block',
    'app.bsky.graph.follow',
    'fyi.unravel.frontpage.post',
  ];
  const out = [];
  for (let i = 0; i < 60; i++) {
    const collection = collections[i % collections.length];
    const ms = FIXED_NOW - i * 3_600_000;
    out.push([
      `${collection}/${tidFor(ms, i % 1024)}`,
      { $type: collection, n: i, createdAt: new Date(ms).toISOString() },
    ]);
  }
  return out.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

const RECORD = { $type: 'x.test', text: 'present' };

/**
 * A CAR whose commit points at one hand-built MST node: `node` is the
 * node's value (any shape), `extra` more blocks, `commit` commit fields.
 */
async function nodeCar({ node, extra = [], commit = {}, records = [RECORD] }) {
  const recordBlocks = await Promise.all(records.map((r) => dagBlock(r)));
  const nodeValue =
    typeof node === 'function' ? node(recordBlocks.map((b) => b.link)) : node;
  const nodeBlock = await dagBlock(nodeValue);
  const commitBlock = await dagBlock({
    did: DID,
    version: 3,
    data: nodeBlock.link,
    rev: '3mnoderev2222',
    prev: null,
    ...commit,
  });
  return carOf(
    [commitBlock.cid],
    [commitBlock, nodeBlock, ...recordBlocks, ...extra],
  );
}

/** An MST node holding `entries` (each `{ p, k, v, t }`). */
const node = (entries, l = null) => ({ l, e: entries });
/** An entry whose key is `key` in full. */
const full = (key, v, extra = {}) => ({
  p: 0,
  k: keyBytes(key),
  v,
  t: null,
  ...extra,
});

async function readCases() {
  const cases = [];
  const add = (id, car) => cases.push({ $id: id, car: toB64(car) });

  // Real repos.
  add('harness repo', await buildRepoCar(DID, repoRecords()));
  const mst = await buildMstRepo(DID, manyRecords());
  add('multi-level tree', await carOf([mst.commit.cid], mst.blocks));
  // A diff: some subtrees and records absent.
  const dropped = new Set([
    ...mst.nodes.slice(0, 2),
    ...[...mst.records.values()].slice(0, 9),
  ]);
  add(
    'multi-level diff',
    await carOf(
      [mst.commit.cid],
      mst.blocks.filter((b) => !dropped.has(b)),
    ),
  );

  // The web tests' fixture, whole and as a diff missing one record.
  const NOW = Date.parse('2026-06-20T12:00:00.000Z');
  const likeKey = `app.bsky.feed.like/${tidFor(NOW - 86_400_000)}`;
  const postKey = `app.bsky.feed.post/${tidFor(NOW)}`;
  const fixture = [
    [
      likeKey,
      {
        $type: 'app.bsky.feed.like',
        subject: { uri: 'at://did:plc:them/app.bsky.feed.post/x' },
        createdAt: new Date(NOW - 86_400_000).toISOString(),
      },
    ],
    [
      postKey,
      {
        $type: 'app.bsky.feed.post',
        text: 'hello car',
        createdAt: new Date(NOW).toISOString(),
      },
    ],
    [
      'is.dame.page/about',
      {
        $type: 'is.dame.page',
        title: 'About',
        createdAt: new Date(NOW).toISOString(),
      },
    ],
  ];
  const web = await buildMstRepo('did:plc:carfixture', fixture, {
    rev: '3mttfixture22',
  });
  add('web fixture', await carOf([web.commit.cid], web.blocks));
  add(
    'web fixture, blocks reversed',
    await carOf([web.commit.cid], [...web.blocks].reverse()),
  );
  const likeBlock = web.records.get(likeKey);
  add(
    'web fixture diff',
    await carOf(
      [web.commit.cid],
      web.blocks.filter((b) => b !== likeBlock),
    ),
  );

  // Empty and broken CARs.
  const stray = await dagBlock({ did: DID, rev: '3mttfixture22' });
  add('empty diff', await carOf([stray.cid], []));
  add('root not among blocks', await carOf([stray.cid], web.blocks));
  add('no roots', await carOf([], web.blocks));
  add('no roots, no blocks', await carOf([], []));
  add('not a car', Uint8Array.from([1, 2, 3, 4]));
  const tampered = await dagBlock(RECORD);
  const bad = Uint8Array.from(tampered.bytes);
  bad[bad.length - 1] ^= 1;
  add(
    'tampered record',
    await carOf(
      [web.commit.cid],
      [...web.blocks, { cid: tampered.cid, bytes: bad }],
    ),
  );

  // Commits.
  const rawRoot = await rawBlock(Uint8Array.from([0xff, 0x00]));
  add('root not cbor', await carOf([rawRoot.cid], [rawRoot]));
  for (const [id, commit] of [
    ['commit without did', { did: undefined }],
    ['commit without rev', { rev: '' }],
    ['commit without data', { data: null }],
    ['commit did zero', { did: 0 }],
    ['commit did a number', { did: 5 }],
    ['commit did an array', { did: ['did:plc', 'x'] }],
    ['commit did an object', { did: { a: 1 } }],
    ['commit did with toString', { did: { toString: 1 } }],
    ['commit did bytes', { did: toBytes(new Uint8Array([1, 2])) }],
    ['commit rev a number', { rev: 12 }],
    ['commit data a string', { data: 'not-a-cid' }],
  ]) {
    add(
      id,
      await nodeCar({
        node: (links) => node([full('x.test/a', links[0])]),
        commit,
      }),
    );
  }
  for (const [id, value] of [
    ['commit null', null],
    ['commit an array', [1, 2]],
    ['commit a string', 'commit'],
  ]) {
    const blk = await dagBlock(value);
    add(id, await carOf([blk.cid], [blk]));
  }
  // The commit's data link in other shapes.
  {
    const rec = await dagBlock(RECORD);
    const n = await dagBlock(node([full('x.test/a', rec.link)]));
    for (const [id, data] of [
      ['data as a cid string', n.link.$link],
      ['data as a link-shaped map', { $link: n.link.$link, extra: true }],
      ['data as an array of a cid string', [n.link.$link]],
      ['data missing block', (await dagBlock({ elsewhere: 1 })).link],
    ]) {
      const c = await dagBlock({ did: DID, rev: '3mdata', data, version: 3 });
      add(id, await carOf([c.cid], [c, n, rec]));
    }
  }

  // Nodes of other shapes.
  for (const [id, value] of [
    ['node null', null],
    ['node a number', 7],
    ['node a string', 'node'],
    ['node an array', [1, 2]],
    ['node empty map', {}],
    ['entries null', { l: null, e: null }],
    ['entries zero', { e: 0 }],
    ['entries a number', { e: 5 }],
    ['entries a float', { e: 2.5 }],
    ['entries true', { e: true }],
    ['entries a map', { e: { p: 0 } }],
    ['entries a string', { e: 'ab' }],
    ['entries bytes', { e: toBytes(new Uint8Array([1])) }],
    ['entry null', { e: [null] }],
    ['entry a number', { e: [3] }],
    ['entry empty map', { e: [{}] }],
  ]) {
    add(id, await nodeCar({ node: value }));
  }

  // Prefix lengths in other shapes; the key before is "x.test/abc".
  for (const [id, p] of [
    ['p missing', undefined],
    ['p a string', '3'],
    ['p a hex string', '0x3'],
    ['p a padded string', ' 7 '],
    ['p not a number', 'abc'],
    ['p a float', 7.9],
    ['p negative', -2],
    ['p huge', 2 ** 52 - 0.5],
    ['p hugely negative', -(2 ** 52 - 0.5)],
    ['p past the end', 50],
    ['p true', true],
    ['p null', null],
    ['p an array', [4]],
    ['p an empty array', []],
    ['p a map', { a: 1 }],
    ['p with toString', { toString: 1 }],
    ['p bytes', toBytes(new Uint8Array([1]))],
  ]) {
    add(
      id,
      await nodeCar({
        node: (links) => {
          const second = { k: keyBytes('Z'), v: links[0], t: null };
          if (p !== undefined) second.p = p;
          return node([full('x.test/abc', links[0]), second]);
        },
      }),
    );
  }

  // Key bytes in other shapes.
  for (const [id, k] of [
    ['k missing', undefined],
    ['k null', null],
    ['k a string', 'x.test/a'],
    ['k a number', 4],
    [
      'k bytes-shaped map',
      {
        $bytes: Buffer.from('x.test/m').toString('base64').replace(/=+$/, ''),
        x: 1,
      },
    ],
    [
      'k bytes-shaped map padded',
      { $bytes: Buffer.from('x.test/m').toString('base64'), x: 1 },
    ],
    ['k bytes-shaped map invalid', { $bytes: 'AQ=', x: 1 }],
    ['k $bytes a number', { $bytes: 5, x: 1 }],
    ['k $bytes null', { $bytes: null, x: 1 }],
    ['k $bytes an array', { $bytes: [1, 2], x: 1 }],
    [
      'k $bytes with a bad length',
      { $bytes: { length: { toString: 1 } }, x: 1 },
    ],
    ['k $bytes with a length', { $bytes: { length: 3 }, x: 1 }],
    ['k a link', toCidLink((await dagBlock(1)).cid)],
    ['k empty map', {}],
  ]) {
    add(
      id,
      await nodeCar({
        node: (links) => {
          const e = { p: 0, v: links[0], t: null };
          if (k !== undefined) e.k = k;
          return node([e]);
        },
      }),
    );
  }

  // Key text: invalid UTF-8, byte-order marks, split characters, slashes.
  for (const [id, entries] of [
    ['key invalid utf-8', [[0, [0x78, 0x2f, 0xff, 0xfe, 0x61]]]],
    [
      'key overlong and surrogate',
      [[0, [0x78, 0x2f, 0xc0, 0xaf, 0xed, 0xa0, 0x80, 0x62]]],
    ],
    ['key truncated sequence', [[0, [0x78, 0x2f, 0xe2, 0x82]]]],
    ['key bom', [[0, [0xef, 0xbb, 0xbf, 0x78, 0x2f, 0x61]]]],
    [
      'key bom twice',
      [[0, [0xef, 0xbb, 0xbf, 0xef, 0xbb, 0xbf, 0x78, 0x2f, 0x61]]],
    ],
    [
      'key bom after a prefix',
      [
        [0, [...Buffer.from('x.test/a')]],
        [7, [0xef, 0xbb, 0xbf, 0x62]],
      ],
    ],
    [
      'key prefix splits an emoji',
      [
        [0, [...Buffer.from('x/😀')]],
        [3, [...Buffer.from('z')]],
      ],
    ],
    [
      'key prefix splits a two-byte char',
      [
        [0, [...Buffer.from('x/é')]],
        [3, [...Buffer.from('z')]],
      ],
    ],
    ['key no slash', [[0, [...Buffer.from('noslash')]]]],
    ['key leading slash', [[0, [...Buffer.from('/rkey')]]]],
    ['key empty', [[0, []]]],
    ['key two slashes', [[0, [...Buffer.from('a.b/c/d')]]]],
    ['key trailing slash', [[0, [...Buffer.from('a.b/')]]]],
    ['key unicode', [[0, [...Buffer.from('xyz.custom/日本語👍🏽')]]]],
  ]) {
    add(
      id,
      await nodeCar({
        node: (links) =>
          node(
            entries.map(([p, bytes]) => ({
              p,
              k: rawKey(bytes),
              v: links[0],
              t: null,
            })),
          ),
      }),
    );
  }

  // Value links in other shapes.
  {
    const present = await dagBlock(RECORD);
    const absent = (await dagBlock({ absent: true })).link;
    for (const [id, v] of [
      ['v a link', present.link],
      ['v absent', absent],
      ['v missing', undefined],
      ['v null', null],
      ['v a cid string', present.link.$link],
      ['v a link-shaped map', { $link: present.link.$link, more: 1 }],
      ['v an array of a cid string', [[present.link.$link]]],
      ['v a number', 12],
      ['v with toString', { toString: 1 }],
      ['v $link with toString', { $link: 7, toString: 1 }],
    ]) {
      add(
        id,
        await nodeCar({
          records: [],
          extra: [present],
          node: () => {
            const e = { p: 0, k: keyBytes('x.test/v'), t: null };
            if (v !== undefined) e.v = v;
            return node([e]);
          },
        }),
      );
    }
  }

  // Subtrees in other shapes, and shared subtrees.
  {
    const rec = await dagBlock(RECORD);
    const leaf = await dagBlock(node([full('x.test/leaf', rec.link)]));
    const leftLeaf = await dagBlock(node([full('a.test/left', rec.link)]));
    for (const [id, t, l] of [
      ['t a link', leaf.link, null],
      ['t a cid string', leaf.link.$link, null],
      ['t zero', 0, null],
      ['t absent', (await dagBlock({ nope: 1 })).link, null],
      ['l and t', leaf.link, leftLeaf.link],
      ['l a cid string', null, leftLeaf.link.$link],
      ['l the same as t', leaf.link, leaf.link],
    ]) {
      const n = await dagBlock(node([full('m.test/mid', rec.link, { t })], l));
      const c = await dagBlock({ did: DID, rev: '3msub', data: n.link });
      add(id, await carOf([c.cid], [c, n, leaf, leftLeaf, rec]));
    }
    // A subtree shared by every entry of two levels: a DAG, walked as a tree.
    const shared = await dagBlock(
      node(
        compressedEntries(
          ['s/1', 's/2', 's/3'].map((k) => [k, rec.link, leaf.link]),
        ),
      ),
    );
    const top = await dagBlock(
      node(
        compressedEntries(
          ['t/1', 't/2'].map((k) => [k, rec.link, shared.link]),
        ),
        shared.link,
      ),
    );
    const c = await dagBlock({ did: DID, rev: '3mshared', data: top.link });
    add('shared subtrees', await carOf([c.cid], [c, top, shared, leaf, rec]));
  }

  // Records that don't decode, or decode to odd values.
  {
    const garbage = await rawBlock(Uint8Array.from([0x1c]));
    const rawCbor = await rawBlock(Uint8Array.from([0xa1, 0x61, 0x61, 0x01]));
    const nul = await dagBlock(null);
    for (const [id, blk] of [
      ['record not cbor', garbage],
      ['record raw codec cbor', rawCbor],
      ['record null', nul],
    ]) {
      add(
        id,
        await nodeCar({
          records: [],
          extra: [blk],
          node: () => node([full('x.test/r', blk.link)]),
        }),
      );
    }
  }
  return cases;
}

/** Summarizes a parse whose entries are too many to hold in the fixture. */
function summary(out, progress) {
  const uris = out.entries.map((e) => e.uri).join('\n');
  return {
    did: out.did,
    rev: out.rev,
    count: out.entries.length,
    uriDigest: createHash('sha256').update(uris, 'utf8').digest('hex'),
    first: out.entries[0] ?? null,
    last: out.entries.at(-1) ?? null,
    progress,
  };
}

/**
 * A CAR large enough for the parse to report progress: a root of 64
 * entries over one node of 64 entries over a leaf, all naming one record,
 * so 3 node blocks walk 4,161 times and yield 8,256 paths. `repeat` copies
 * of the record's block entry follow, which a case holds once with the
 * count (the Swift test lays them out again) so the fixture stays small.
 */
async function progressCar(repeat) {
  const rec = await dagBlock(null);
  const leaf = await dagBlock(node([full('c/leaf', rec.link)]));
  const keys = (prefix) =>
    Array.from(
      { length: 64 },
      (_, i) => `c/${prefix}${String(i).padStart(2, '0')}`,
    );
  const middle = await dagBlock(
    node(compressedEntries(keys('m').map((k) => [k, rec.link, leaf.link]))),
  );
  const root = await dagBlock(
    node(compressedEntries(keys('r').map((k) => [k, rec.link, middle.link]))),
  );
  const commit = await dagBlock({
    did: DID,
    rev: '3mprogress22',
    data: root.link,
  });
  const head = await carOf([commit.cid], [commit, root, middle, leaf, rec]);
  // One block entry as the CAR holds it: the tail of a CAR of just it.
  const one = await carOf([], [rec]);
  const headerOnly = await carOf([], []);
  const entry = one.subarray(headerOnly.length);
  return { car: toB64(head), repeat: toB64(entry), times: repeat };
}

/** A CAR laid out from a progress case: the head, then the entry repeated. */
function layOut({ car, repeat, times }) {
  const head = fromB64(car);
  const entry = fromB64(repeat);
  const out = new Uint8Array(head.length + entry.length * times);
  out.set(head, 0);
  for (let i = 0; i < times; i++)
    out.set(entry, head.length + i * entry.length);
  return out;
}

/** A fake fetch answering with exactly the response a case names. */
async function recordedFetch(response, fn) {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    requests.push({
      url: String(url),
      method: String(init.method || 'GET'),
      headers: init.headers || {},
      body: null,
    });
    const chunks = (response.chunks || []).map(fromB64);
    const whole = response.body != null ? fromB64(response.body) : null;
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      headers: new Headers(response.headers || {}),
      body: response.chunks
        ? {
            getReader() {
              let i = 0;
              return {
                read: async () =>
                  i < chunks.length
                    ? { done: false, value: chunks[i++] }
                    : { done: true },
              };
            },
          }
        : null,
      arrayBuffer: async () => (whole ?? new Uint8Array(0)).buffer,
    };
  };
  try {
    try {
      return { requests, result: await fn() };
    } catch (error) {
      return {
        requests,
        $throws: String(error?.message || error),
        status: error?.status ?? null,
      };
    }
  } finally {
    globalThis.fetch = original;
  }
}

const DATES = [
  '2026-03-15T12:00:00.000Z',
  '2026-03-15T12:00:00Z',
  '2026-03-15T12:00Z',
  '2026-03-15T12:00:00',
  '2026-03-15T12:00',
  '2026-03-15T12:00:00.1Z',
  '2026-03-15T12:00:00.12Z',
  '2026-03-15T12:00:00.123456Z',
  '2026-03-15T12:00:00.123456789123Z',
  '2026-03-15T12:00:00.000000000123Z',
  '2026-03-15T12:00:00+01:00',
  '2026-03-15T12:00:00-05:30',
  '2026-03-15T12:00:00+0100',
  '2026-03-15T12:00:00+01',
  '2026-03-15T12:00:00+24:00',
  '2026-03-15T12:00:00.000+00:00',
  '2026-03-15T12:00:00.000-00:00',
  '2026-03-15t12:00:00z',
  '2026-03-15T12:00:00.000ZZ',
  '2026-03-15T12:00:00.000 Z',
  '2026-03-15T12:00:00.Z',
  '2026-03-15T12:60:00Z',
  '2026-03-15T12:00:60Z',
  '2026-03-15T24:00:00Z',
  '2026-03-15T24:00:00.000Z',
  '2026-03-15T24:00:01Z',
  '2026-03-15T24:01Z',
  '2026-03-15T25:00Z',
  '2026-03-15T1:00Z',
  '2026-03-15',
  '2026-03',
  '2026',
  '2026-3-5',
  '2026-02-30',
  '2026-02-29',
  '2024-02-29',
  '2026-13-01',
  '2026-00-10',
  '2026-01-32',
  '+002026-03-15T00:00:00Z',
  '-000001-01-01T00:00:00Z',
  '-000000-01-01T00:00:00Z',
  '+275760-09-13T00:00:00.000Z',
  '+275760-09-13T00:00:00.001Z',
  '-271821-04-20T00:00:00.000Z',
  '-271821-04-19T23:59:59.999Z',
  '1970-01-01T00:00:00.000Z',
  '1969-12-31T23:59:59.999Z',
  '0000-01-01',
  '0099-06-01',
  '20260315T120000Z',
  '2026-W11',
  '2026-074',
  '2026-03-15 12:00:00',
  '2026-03-15 12:00:00Z',
  '2026-03-15 12:00:00 Z',
  '2026-03-15 12:00:00 +0100',
  '2026-03-15 12:00:00 GMT+0100',
  '2026-03-15 12:00:00.250',
  '2026-03-15 12:00:00.25 +01:00',
  '2026/03/15',
  '2026/3/15 10:20',
  '03/15/2026',
  '3/15/26',
  '3/15/76',
  '15/3/2026',
  '1/2/3',
  '1/2',
  '15 Mar 2026',
  '15 March 2026 10:00',
  'Mar 15, 2026',
  'March 15 2026 10:30 PM',
  'March 15 2026 10:30 am',
  'March 15 2026 12:30 am',
  'March 15 2026 12:30 pm',
  'March 15 2026 13:30 pm',
  'Mar 15 2026 1:2:3',
  'Mar 15 2026 01:02:03.4567',
  'Mar 15 2026 10::',
  'Mar 15 2026 10:20:30:40',
  'Mar 15 2026 10.20',
  'Mar 15 2026 10:20.5',
  'Mar-15-2026',
  '15-Mar-2026',
  'Sun, 15 Mar 2026 12:00:00 GMT',
  'Sun Mar 15 2026 12:00:00 GMT+0000 (Coordinated Universal Time)',
  'Sun Mar 15 2026 12:00:00 GMT-0800 (Pacific Standard Time)',
  'Thu, 01 Jan 1970 00:00:00 GMT-0800',
  'Thu, 01 Jan 1970 00:00:00 GMT+01:30',
  'Thu, 01 Jan 1970 00:00:00 UTC',
  'Thu, 01 Jan 1970 00:00:00 UT',
  'Mar 15 2026 EST',
  'Mar 15 2026 EDT',
  'Mar 15 2026 CST',
  'Mar 15 2026 CDT',
  'Mar 15 2026 MST',
  'Mar 15 2026 MDT',
  'Mar 15 2026 PST',
  'Mar 15 2026 PDT',
  'Mar 15 2026 10:00 UTC+5',
  'Mar 15 2026 10:00 UTC+05:30',
  'Mar 15 2026 10:00 GMT-12345',
  'Mar 15 2026 10:00 +',
  'Mar 15 2026 10:00 Z',
  'Mar 15 2026 10:00 z',
  '12:00 PM Mar 15 2026',
  '12:00 Mar 15 2026 pm',
  '2000-01-01 00:00 +298262:00',
  '2000-01-01 00:00 +1193047:00',
  '2000-01-01 00:00 +596524:00',
  'Mars 15 2026',
  'Marzo 15 2026',
  'Septembre 3 2026',
  'Mayday 1 2026',
  'foo 2026-03-15',
  'foo2026-03-15',
  '2026-03-15 foo',
  'foo bar 3 15 2026',
  '(note) Mar 15 2026',
  'Mar 15 2026 (note (nested)) 10:00',
  'Mar 15 2026 (unclosed',
  'Mar 15 2026)',
  'Mar 15 2026 +',
  '2026-03-15T12:00:00.000Z\u0000junk',
  'Jan 1 2000\u0000garbage',
  '\u00002026',
  '２０２６-03-15',
  ' 2026-03-15',
  '　2026-03-15',
  '2026-03-15 ',
  '2026-03-15﻿',
  '﻿2026-03-15',
  'yesterday',
  'now',
  'Infinity',
  'NaN',
  '1e3',
  '-1',
  '+1',
  '0',
  '1',
  '12',
  '49',
  '50',
  '99',
  '100',
  '1234',
  '12345',
  '123456',
  '1773576000000',
  '1000000000',
  ' ',
  '\t2026-03-15\n',
  'T12:00',
  '12:30',
  '12:30:45.678',
  'Z',
  'am',
  '😀 2026',
  '2026 😀',
  'Ⅻ 2026',
];

const rkeyEntry = (rkey, record = {}) => ({
  uri: `at://${DID}/x.test/${rkey}`,
  collection: 'x.test',
  rkey,
  record,
});

const ENTRIES = [
  // Dated by the rkey's TID.
  { $id: 'tid', entry: rkeyEntry(tidFor(FIXED_NOW)) },
  {
    $id: 'tid beats createdAt',
    entry: rkeyEntry(tidFor(FIXED_NOW), { createdAt: '2001-01-01T00:00:00Z' }),
  },
  {
    $id: 'tid of zero',
    entry: rkeyEntry('2222222222222', { createdAt: '2001-01-01T00:00:00Z' }),
  },
  { $id: 'tid zero, no date', entry: rkeyEntry('2222222222222') },
  { $id: 'tid starting z', entry: rkeyEntry('zzzzzzzzzzzzz') },
  { $id: 'tid starting k', entry: rkeyEntry('kzzzzzzzzzzzz') },
  { $id: 'tid smallest', entry: rkeyEntry('2222222222m22') },
  { $id: 'tid of 1ms', entry: rkeyEntry(tidFor(1)) },
  {
    $id: 'tid uppercase',
    entry: rkeyEntry('3JZFCIJPJ2Z2A', { createdAt: '2001-01-01T00:00:00Z' }),
  },
  { $id: 'tid with a 1', entry: rkeyEntry('3jzfcijpj2z21') },
  { $id: 'tid too short', entry: rkeyEntry('3jzfcijpj2z2') },
  { $id: 'tid too long', entry: rkeyEntry('3jzfcijpj2z2aa') },
  { $id: 'tid with emoji', entry: rkeyEntry('3jzfcijpj2z😀') },
  { $id: 'rkey self', entry: rkeyEntry('self') },
  { $id: 'rkey empty', entry: rkeyEntry('', { createdAt: '2026-01-01' }) },
  // Then the record's own timestamps, in order.
  {
    $id: 'createdAt',
    entry: rkeyEntry('self', {
      createdAt: '2026-01-01T00:00:00Z',
      connectedAt: '2000-01-01',
    }),
  },
  {
    $id: 'connectedAt',
    entry: rkeyEntry('12345', { connectedAt: '2026-06-01T00:00:00.000Z' }),
  },
  {
    $id: 'publishedAt',
    entry: rkeyEntry('a', {
      publishedAt: '2026-02-01',
      updatedAt: '2000-01-01',
    }),
  },
  { $id: 'updatedAt', entry: rkeyEntry('a', { updatedAt: '2026-02-02' }) },
  {
    $id: 'empty createdAt falls through',
    entry: rkeyEntry('a', { createdAt: '', publishedAt: '2026-02-03' }),
  },
  {
    $id: 'zero createdAt falls through',
    entry: rkeyEntry('a', { createdAt: 0, updatedAt: '2026-02-04' }),
  },
  {
    $id: 'null createdAt falls through',
    entry: rkeyEntry('a', { createdAt: null, connectedAt: '2026-02-05' }),
  },
  {
    $id: 'false createdAt falls through',
    entry: rkeyEntry('a', { createdAt: false, connectedAt: '2026-02-06' }),
  },
  {
    $id: 'invalid createdAt does not fall through',
    entry: rkeyEntry('a', { createdAt: 'soon', updatedAt: '2026-02-07' }),
  },
  {
    $id: 'createdAt a number',
    entry: rkeyEntry('a', { createdAt: 1773576000000 }),
  },
  {
    $id: 'createdAt a year number',
    entry: rkeyEntry('a', { createdAt: 2026 }),
  },
  { $id: 'createdAt true', entry: rkeyEntry('a', { createdAt: true }) },
  {
    $id: 'createdAt an array',
    entry: rkeyEntry('a', { createdAt: ['2026-03-15'] }),
  },
  {
    $id: 'createdAt a nested array',
    entry: rkeyEntry('a', { createdAt: [['2026-03-15'], []] }),
  },
  {
    $id: 'createdAt an array with null',
    entry: rkeyEntry('a', { createdAt: [null, '2026'] }),
  },
  { $id: 'createdAt an empty array', entry: rkeyEntry('a', { createdAt: [] }) },
  {
    $id: 'createdAt an object',
    entry: rkeyEntry('a', { createdAt: { iso: '2026-03-15' } }),
  },
  {
    $id: 'createdAt a link',
    entry: rkeyEntry('a', { createdAt: { $link: 'bafy' } }),
  },
  {
    $id: 'createdAt with toString',
    entry: rkeyEntry('a', { createdAt: { toString: 1 } }),
  },
  {
    $id: 'createdAt array with toString',
    entry: rkeyEntry('a', { createdAt: [{ toString: 1 }] }),
  },
  { $id: 'no dates', entry: rkeyEntry('a', { text: 'hi' }) },
  { $id: 'record null', entry: rkeyEntry('a', null) },
  {
    $id: 'record missing',
    entry: { uri: 'at://x/c/a', collection: 'c', rkey: 'a' },
  },
  { $id: 'record a string', entry: rkeyEntry('a', '2026-03-15') },
  { $id: 'record an array', entry: rkeyEntry('a', ['2026-03-15']) },
  {
    $id: 'record zero, rkey tid',
    entry: { ...rkeyEntry(tidFor(FIXED_NOW)), record: 0 },
  },
  // The entry itself.
  { $id: 'entry null', entry: null },
  { $id: 'entry missing', entry: undefined },
  { $id: 'entry a string', entry: 'at://x' },
  { $id: 'no uri', entry: { collection: 'c', rkey: tidFor(FIXED_NOW) } },
  {
    $id: 'empty uri',
    entry: { uri: '', collection: 'c', rkey: tidFor(FIXED_NOW) },
  },
  {
    $id: 'no collection',
    entry: { uri: 'at://x/c/r', rkey: tidFor(FIXED_NOW) },
  },
  {
    $id: 'empty collection',
    entry: { uri: 'at://x/c/r', collection: '', rkey: tidFor(FIXED_NOW) },
  },
  {
    $id: 'uri a number',
    entry: { uri: 7, collection: 'c', rkey: tidFor(FIXED_NOW) },
  },
  {
    $id: 'collection an object',
    entry: { uri: 'u', collection: { a: 1 }, rkey: tidFor(FIXED_NOW) },
  },
  {
    $id: 'rkey a number',
    entry: {
      uri: 'u',
      collection: 'c',
      rkey: 2222222222222,
      record: { createdAt: '2026-01-01' },
    },
  },
  {
    $id: 'rkey an array',
    entry: { uri: 'u', collection: 'c', rkey: [tidFor(FIXED_NOW)] },
  },
  {
    $id: 'rkey with toString',
    entry: { uri: 'u', collection: 'c', rkey: { toString: 1 } },
  },
  {
    $id: 'rkey zero',
    entry: {
      uri: 'u',
      collection: 'c',
      rkey: 0,
      record: { createdAt: '2026-01-01' },
    },
  },
  // Every date shape a record carries in the wild.
  ...DATES.map((date) => ({
    $id: `date ${JSON.stringify(date)}`,
    entry: rkeyEntry('self', { createdAt: date }),
  })),
];

// Local times (no zone written) are read in the browser's zone: the same
// strings in zones with clock changes, half-hour offsets and history.
// (Not Africa/Casablanca: Morocco's 2026 rules are newer than the zone data
// some Swift toolchains carry, so the two would disagree on the zone, not
// on the parse.)
const ZONES = [
  'America/New_York',
  'America/Los_Angeles',
  'America/St_Johns',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Kolkata',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Australia/Lord_Howe',
  'Pacific/Chatham',
  'Pacific/Apia',
];
const LOCAL_DATES = [
  '2026-01-15 12:00',
  'Mar 15 2026',
  '2026-03-15T12:00:00',
  '2026-03-08T02:30:00',
  '2026-11-01T01:30:00',
  '2026-03-29T01:30:00',
  '2026-03-29T02:30:00',
  '2026-10-25T01:30:00',
  '2026-10-25T02:30:00',
  '2026-04-05T02:30:00',
  '2026-04-05T02:45:00',
  '2026-09-27T02:45:00',
  '2026-10-04T02:15:00',
  '2026-10-04T02:30:00',
  '2011-12-30T12:00:00',
  '2000-01-01T00:00:00',
  '1970-01-01T00:00:00',
  '1950-06-01 12:00',
  '2026-03-15T12:00:00Z',
  '2026-03-15',
];

function inZone(zone, fn) {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try {
    return fn();
  } finally {
    process.env.TZ = previous;
  }
}

export default async function cases() {
  const read = async ({ car }) => {
    const progress = [];
    const out = await readRepoCar(fromB64(car), {
      onProgress: (p) => progress.push(p),
    });
    return { ...out, progress };
  };
  const readCasesList = await readCases();

  // Every row the parsed repos give.
  const harness = await readRepoCar(fromB64(readCasesList[0].car));
  const tree = await readRepoCar(fromB64(readCasesList[1].car));
  const parsedEntries = [...harness.entries, ...tree.entries.slice(0, 15)].map(
    (entry, i) => ({
      $id: `parsed ${i} ${entry.collection}/${entry.rkey}`,
      entry: JSON.parse(JSON.stringify(entry)),
    }),
  );

  // A small repo for the downloads that read one; an empty diff (a header
  // and no blocks, as a PDS sends for since=<current rev>) for the rest.
  const CAR = toB64(await buildRepoCar(DID, repoRecords().slice(0, 2)));
  const SMALL = toB64(await carOf([(await dagBlock({ did: DID })).cid], []));
  const chunked = (b64, sizes) => {
    const bytes = fromB64(b64);
    const out = [];
    let at = 0;
    for (const size of sizes) {
      out.push(toB64(bytes.subarray(at, at + size)));
      at += size;
    }
    out.push(toB64(bytes.subarray(at)));
    return out;
  };
  const FETCHES = [
    {
      $id: 'whole repo',
      pds: 'https://pds.example.com',
      did: DID,
      response: { status: 200, chunks: [CAR] },
    },
    {
      $id: 'in chunks',
      pds: 'https://pds.example.com',
      did: DID,
      response: { status: 200, chunks: chunked(CAR, [1, 10, 100]) },
    },
    {
      $id: 'with a content-length',
      pds: 'https://pds.example.com',
      did: DID,
      response: {
        status: 200,
        headers: { 'content-length': '999' },
        chunks: chunked(CAR, [50]),
      },
    },
    ...[
      ['zero', '0'],
      ['text', 'abc'],
      ['padded', ' 42 '],
      ['exponent', '1e3'],
      ['hex', '0x10'],
      ['negative', '-5'],
      ['fraction', '12.5'],
    ].map(([name, value]) => ({
      $id: `content-length ${name}`,
      pds: 'https://pds.example.com',
      did: DID,
      response: {
        status: 200,
        headers: { 'Content-Length': value },
        chunks: [SMALL],
      },
    })),
    {
      $id: 'no chunks',
      pds: 'https://pds.example.com',
      did: DID,
      response: { status: 200, chunks: [] },
    },
    {
      $id: 'since a rev',
      pds: 'https://pds.example.com',
      did: DID,
      since: '3mabcdefghi22',
      response: { status: 200, chunks: [SMALL] },
    },
    {
      $id: 'since empty',
      pds: 'https://pds.example.com',
      did: DID,
      since: '',
      response: { status: 200, chunks: [SMALL] },
    },
    {
      $id: 'whole body, no stream',
      pds: 'https://pds.example.com',
      did: DID,
      response: { status: 200, body: SMALL },
    },
    {
      $id: 'whole body with a content-length',
      pds: 'https://pds.example.com',
      did: DID,
      response: {
        status: 200,
        headers: { 'content-length': '7' },
        body: SMALL,
      },
    },
    {
      $id: 'empty body, no stream',
      pds: 'https://pds.example.com',
      did: DID,
      response: { status: 204 },
    },
    {
      $id: 'not found',
      pds: 'https://pds.example.com',
      did: DID,
      response: {
        status: 404,
        chunks: [toB64(Buffer.from('{"error":"RepoNotFound"}'))],
      },
    },
    {
      $id: 'diff refused',
      pds: 'https://pds.example.com',
      did: DID,
      since: '3mgone2222222',
      response: { status: 400, chunks: [] },
    },
    {
      $id: 'server error',
      pds: 'https://pds.example.com',
      did: DID,
      response: { status: 500 },
    },
    {
      $id: 'redirect status',
      pds: 'https://pds.example.com',
      did: DID,
      response: { status: 301 },
    },
    {
      $id: 'odd did and pds',
      pds: 'http://localhost:2583/base',
      did: 'did:web:example.com:user name&x=1/é',
      since: 'a b+c',
      response: { status: 200, chunks: [SMALL] },
    },
  ];

  return [
    ...(await each('readRepoCar', readCasesList, read)),
    ...(await each(
      'readRepoCar.progress',
      [
        { $id: 'walk and decode', ...(await progressCar(0)) },
        { $id: 'index, walk and decode', ...(await progressCar(3995)) },
      ],
      async (input) => {
        const progress = [];
        const out = await readRepoCar(layOut(input), {
          onProgress: (p) => progress.push(p),
        });
        return summary(out, progress);
      },
    )),
    ...(await each(
      'atmosphereRowFromEntry',
      [...ENTRIES, ...parsedEntries],
      ({ entry }) => atmosphereRowFromEntry(entry),
    )),
    ...(await each(
      'atmosphereRowFromEntry.zoned',
      ZONES.flatMap((zone) =>
        LOCAL_DATES.map((date) => ({
          $id: `${zone} ${date}`,
          zone,
          entry: rkeyEntry('self', { createdAt: date }),
        })),
      ),
      ({ zone, entry }) => inZone(zone, () => atmosphereRowFromEntry(entry)),
    )),
    ...(await each('fetchRepoCar', FETCHES, ({ pds, did, since, response }) =>
      recordedFetch(response, async () => {
        const progress = [];
        const bytes = await fetchRepoCar(pds, did, {
          since,
          onProgress: (p) => progress.push(p),
        });
        return { bytes: toB64(bytes), progress };
      }),
    )),
  ];
}
