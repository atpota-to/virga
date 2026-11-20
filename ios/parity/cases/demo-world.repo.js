// The harness's repo (harness/repo.js): AT-URIs, listing and reading
// records, writes (createRecord and putRecord, with the CIDs a PDS gives,
// and every refusal word for word), deletes, and blobs, run as scenarios on
// fresh worlds. After every step the fixture keeps what the step answered
// and the world's state, so the Swift port is held to each change in turn.
// Swift: VirgaDemo/Harness/Repo.swift; tests in
// ios/VirgaKit/Tests/VirgaDemoTests/RepoParityTests.swift.

import {
  XrpcError,
  blobDataUrl,
  keyOf,
  listCollection,
  parseAtUri,
  readBlob,
  readRecord,
  removeRecord,
  storeBlob,
  writeRecord,
} from '../../../harness/repo.js';
import { LAB, buildWorld } from '../../../harness/world.js';
import { each } from './_helpers.js';
import { part } from './_canonical.js';
import { NOW, atTime, thrown } from './_demoWorld.js';

export const sources = ['harness/repo.js'];

const POST = 'app.bsky.feed.post';
const FOLLOW = 'app.bsky.graph.follow';
const LIKE = 'app.bsky.feed.like';
const LATER = NOW + 60_000;

/** One step of a scenario, against `world`. */
async function run(world, step) {
  switch (step.op) {
    case 'list':
      return part(listCollection(world, step.collection));
    case 'read':
      return readRecord(world, step.collection, step.rkey);
    case 'write':
      return atTime(step.now, () =>
        writeRecord(world, {
          collection: step.collection,
          rkey: step.rkey,
          record: step.record,
          createOnly: step.createOnly,
        }),
      );
    case 'remove':
      return removeRecord(world, step.collection, step.rkey);
    case 'storeBlob':
      return storeBlob(world, Uint8Array.from(step.bytes), step.mimeType);
    case 'readBlob':
      return readBlob(world, step.cid);
    case 'blobDataUrl':
      return blobDataUrl(
        world,
        step.cid,
        step.maxBytes === undefined ? undefined : { maxBytes: step.maxBytes },
      );
    default:
      throw new Error(`no op ${step.op}`);
  }
}

/** A list in a step's state: its count and digest (the list ops show items). */
function brief(list) {
  const { count, sha256 } = part(list);
  return { count, sha256 };
}

/** What a scenario's world looks like after a step. */
function stateOf(world) {
  return {
    revision: world.revision,
    postsCount: world.profile.postsCount,
    posts: brief(world.posts),
    follows: brief(world.follows),
    likes: brief(world.likes),
    written: brief([...world.written]),
    removed: [...world.removed],
    blobs: brief([...world.blobs]),
  };
}

async function scenario(account, steps) {
  const world = buildWorld({ now: NOW, account });
  const out = [];
  for (const step of steps) {
    let result;
    try {
      result = await run(world, step);
    } catch (error) {
      result = thrown(error);
    }
    out.push({ result: result ?? null, state: stateOf(world) });
  }
  return out;
}

const write = (collection, rkey, record, extra = {}) => ({
  op: 'write',
  collection,
  rkey,
  record,
  now: NOW,
  ...extra,
});

function labSteps(lab) {
  const newest = lab.posts[0].rkey;
  const fixturePost = lab.posts[4].rkey;
  const follow = lab.follows[2].uri.split('/').pop();
  return [
    { op: 'list', collection: POST },
    { op: 'list', collection: FOLLOW },
    { op: 'list', collection: LIKE },
    { op: 'list', collection: 'app.bsky.actor.profile' },
    { op: 'list', collection: 'net.anisota.feed.template' },
    { op: 'list', collection: 'unknown.collection' },
    { op: 'list', collection: 'toString' },
    { op: 'list', collection: '__proto__' },
    { op: 'read', collection: POST, rkey: newest },
    { op: 'read', collection: POST, rkey: 'missing' },
    { op: 'read', collection: 'app.bsky.actor.profile', rkey: 'self' },
    { op: 'read', collection: FOLLOW, rkey: follow },
    { op: 'read', collection: 'constructor', rkey: 'x' },
    // Refusals.
    write('', 'x', { a: 1 }),
    write(POST, '', { a: 1 }),
    write(POST, undefined, { a: 1 }),
    write('a.b.c', 'k', null),
    write('a.b.c', 'k', 'text'),
    write('a.b.c', 'k', 7),
    write('a.b.c', 'k', true),
    write(POST, newest, { $type: POST, text: 'clash' }, { createOnly: true }),
    write('toString', 'x', { a: 1 }),
    // Writes of every kind.
    write(
      POST,
      '3zzzzzzzzzzz2',
      { $type: POST, text: 'Newest', createdAt: '2026-11-19T10:00:00.000Z' },
      {
        createOnly: true,
      },
    ),
    write(
      POST,
      '2222222222222',
      { $type: POST, text: 'Oldest' },
      { now: LATER },
    ),
    write(
      POST,
      fixturePost,
      { $type: POST, text: 'Over a fixture', createdAt: 'whenever' },
      { now: LATER },
    ),
    write(
      POST,
      '3zzzzzzzzzzz2',
      { $type: POST, text: 'Again', createdAt: '2026-11-19T11:00:00.000Z' },
      {
        now: LATER + 1,
      },
    ),
    write(POST, `${newest}x`, { text: 12, langs: ['fr'] }),
    write(POST, 'typeless', { $type: '', text: 'empty type' }),
    write('a.b.array', 'k', []),
    write('a.b.array', 'k2', ['p', 'q']),
    write('a.b.float', 'k', {
      $type: 'a.b.float',
      n: 1.5,
      nested: [1, { b: null }],
      s: 'é😀',
    }),
    write(FOLLOW, '3zzzzzzzzzzzf', {
      subject: 'did:plc:virgaharnesscast0020',
      createdAt: '2026-11-19T10:00:00.000Z',
    }),
    write(FOLLOW, follow, {
      $type: FOLLOW,
      subject: 'did:plc:replaced',
      createdAt: '2026-11-19T10:00:00.000Z',
    }),
    write(LIKE, '3zzzzzzzzzzzl', {
      subject: { uri: 'at://x/y/z', cid: 'bafyx' },
      createdAt: '2026-11-19T10:00:00.000Z',
    }),
    write('app.bsky.feed.threadgate', 'g1', { post: 'at://x/y/z', allow: [] }),
    write('app.bsky.feed.threadgate', 'g2', { post: 'at://x/y/z2' }),
    write('app.bsky.feed.threadgate', 'g1', {
      post: 'at://x/y/z',
      allow: [{ $type: 'x' }],
    }),
    write('app.bsky.actor.profile', 'self', { displayName: 'Written' }),
    { op: 'list', collection: 'app.bsky.actor.profile' },
    { op: 'list', collection: 'app.bsky.feed.threadgate' },
    { op: 'list', collection: POST },
    { op: 'list', collection: FOLLOW },
    { op: 'read', collection: 'app.bsky.feed.threadgate', rkey: 'g1' },
    // Deletes.
    { op: 'remove', collection: POST, rkey: lab.posts[6].rkey },
    { op: 'remove', collection: POST, rkey: 'missing' },
    { op: 'remove', collection: FOLLOW, rkey: follow },
    { op: 'remove', collection: FOLLOW, rkey: 'missing' },
    { op: 'remove', collection: 'app.bsky.feed.threadgate', rkey: 'g2' },
    { op: 'remove', collection: 'app.bsky.feed.threadgate', rkey: 'g2' },
    { op: 'remove', collection: 'app.bsky.actor.profile', rkey: 'self' },
    { op: 'remove', collection: 'app.bsky.actor.profile', rkey: 'self' },
    { op: 'remove', collection: 'valueOf', rkey: 'x' },
    { op: 'list', collection: 'app.bsky.feed.threadgate' },
    // Blobs.
    { op: 'storeBlob', bytes: [1, 2, 3], mimeType: 'image/png' },
    { op: 'storeBlob', bytes: [1, 2, 3], mimeType: 'image/jpeg' },
    { op: 'storeBlob', bytes: [], mimeType: 'text/plain' },
    { op: 'storeBlob', bytes: [255, 0, 128, 64] },
    { op: 'readBlob', cid: 'bafkreiexample' },
  ];
}

function miraSteps(mira) {
  const other = mira.others.find(
    (r) => r.collection === 'fm.teal.alpha.feed.play',
  );
  const template = [...mira.written.keys()][0].split('/')[1];
  return [
    { op: 'list', collection: 'fm.teal.alpha.feed.play' },
    { op: 'list', collection: LIKE },
    { op: 'list', collection: 'net.anisota.feed.template' },
    { op: 'read', collection: 'net.anisota.feed.template', rkey: template },
    { op: 'remove', collection: 'fm.teal.alpha.feed.play', rkey: other.rkey },
    { op: 'read', collection: 'fm.teal.alpha.feed.play', rkey: other.rkey },
    { op: 'list', collection: 'fm.teal.alpha.feed.play' },
    { op: 'remove', collection: 'fm.teal.alpha.feed.play', rkey: other.rkey },
    write('fm.teal.alpha.feed.play', other.rkey, { track: 'back again' }),
    { op: 'read', collection: 'fm.teal.alpha.feed.play', rkey: other.rkey },
    { op: 'remove', collection: 'net.anisota.feed.template', rkey: template },
    { op: 'list', collection: 'net.anisota.feed.template' },
    write(POST, '3zzzzzzzzzzz2', {
      $type: POST,
      text: 'Newest of many',
      createdAt: '2026-11-19T10:00:00.000Z',
    }),
    write(LIKE, mira.likes[100].uri.split('/').pop(), {
      subject: { uri: 'at://x/y/z', cid: 'bafyx' },
    }),
    { op: 'list', collection: LIKE },
  ];
}

export default async function cases() {
  const lab = buildWorld({ now: NOW, account: LAB });
  const mira = buildWorld({ now: NOW });
  return [
    ...(await each(
      'keyOf',
      [
        { collection: POST, rkey: 'abc' },
        { collection: '', rkey: '' },
      ],
      ({ collection, rkey }) => keyOf(collection, rkey),
    )),
    ...(await each(
      'parseAtUri',
      [
        'at://did:plc:abc/app.bsky.feed.post/3kaaaaaaaaaa2',
        'at://did:plc:abc/app.bsky.feed.post/3kaa?x',
        'at://did:plc:abc/app.bsky.feed.post/3kaa#x',
        'at://did:plc:abc/app.bsky.feed.post/',
        'at://did:plc:abc/app.bsky.feed.post',
        'at://did:plc:abc//rkey',
        'at://did:plc:abc/a/b/c',
        'at://a?b/c#d/e',
        'at://did:plc:abc/app.bsky.feed.post/3kaa\n',
        'AT://did:plc:abc/app.bsky.feed.post/3kaa',
        'https://bsky.app/profile/x/post/y',
        '',
        null,
      ].map((uri) => ({ uri })),
      ({ uri }) => parseAtUri(uri),
    )),
    ...(await each(
      'XrpcError',
      [
        {
          status: 400,
          error: 'InvalidRequest',
          message: 'A record is required',
        },
        { status: 404, error: 'RecordNotFound' },
        { status: 500, error: 'InternalServerError', message: '' },
      ],
      ({ status, error, message }) => {
        const e = new XrpcError(status, error, message);
        return {
          name: e.name,
          status: e.status,
          error: e.error,
          message: e.message,
        };
      },
    )),
    ...(await each(
      'scenario',
      [{ $id: 'lab', account: 'lab', steps: labSteps(lab) }],
      async ({ steps }) => scenario(LAB, steps),
    )),
    ...(await each(
      'scenario',
      [{ $id: 'mira', account: 'me', steps: miraSteps(mira) }],
      async ({ steps }) => scenario(undefined, steps),
    )),
    ...(await each('blobDataUrl', [{ $id: 'blobs' }], async () => {
      const world = buildWorld({ now: NOW, account: LAB });
      const a = await storeBlob(
        world,
        Uint8Array.from([137, 80, 78, 71]),
        'image/png',
      );
      const b = await storeBlob(world, Uint8Array.from([1, 2, 3, 4, 5]));
      return {
        a,
        b,
        aUrl: blobDataUrl(world, a.ref.$link),
        bUrl: blobDataUrl(world, b.ref.$link),
        tooBig: blobDataUrl(world, a.ref.$link, { maxBytes: 3 }),
        justFits: blobDataUrl(world, a.ref.$link, { maxBytes: 4 }),
        missing: blobDataUrl(world, 'bafkreinothere'),
        read: readBlob(world, a.ref.$link),
      };
    })),
  ];
}
