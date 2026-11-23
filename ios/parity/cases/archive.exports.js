// The archive's exports: the whole archive as JSON (its members in order),
// the posts as CSV, the file names (by local day), and exports.js's three
// downloads with the browser's Blob, anchor and timer stood in for, so the
// text, name and type each would download are recorded.
// Swift: VirgaArchive/Lib/AnalyticsExport.swift, Archive/ArchiveExports.swift.

import {
  EXPORT_FORMAT,
  EXPORT_VERSION,
  archiveJson,
  exportFilename,
  postsCsv,
} from '../../../src/lib/analyticsExport.js';
import {
  exportArchive,
  exportPosts,
  exportRows,
} from '../../../src/archive/exports.js';
import { value, ZONES, inZone } from './_helpers.js';
import { eachN, local } from './_archive.js';

export const sources = ['src/lib/analyticsExport.js', 'src/archive/exports.js'];

const DID = 'did:plc:owner';
const OTHER = 'did:plc:someone';

const post = (over = {}) => ({
  uri: `at://${DID}/app.bsky.feed.post/${over.rkey || '3abc'}`,
  rkey: '3abc',
  at: '2026-06-10T12:00:00.000Z',
  text: 'hello',
  replyTo: null,
  quoteOf: null,
  hasMedia: false,
  likes: 0,
  reposts: 0,
  replies: 0,
  quotes: 0,
  ...over,
});

const shaped = (over = {}) =>
  post({
    len: 5,
    media: null,
    mediaCount: 0,
    altCount: 0,
    tags: [],
    links: [],
    mentions: [],
    langs: [],
    threadOf: null,
    threadKey: null,
    ...over,
  });

const POSTS = [
  shaped({
    rkey: 'a',
    at: '2026-06-03T00:00:00Z',
    text: 'one, "two"\nthree\r\nfour',
    likes: 10,
    reposts: 2,
    replies: 3,
    quotes: 1,
    hasMedia: true,
    media: 'image',
    mediaCount: 2,
    altCount: 1,
    tags: ['Gardens', 'allotment'],
    links: ['example.com'],
    langs: ['en', 'fr'],
  }),
  shaped({
    rkey: 'b',
    at: '2026-06-02T00:00:00Z',
    replyTo: OTHER,
    text: '=SUM(A1) @mention',
  }),
  shaped({
    rkey: 'c',
    at: '2026-06-01T00:00:00Z',
    replyTo: DID,
    quoteOf: OTHER,
    text: 'emoji 👨‍👩‍👧 and é́',
  }),
  post({ rkey: 'old', at: '2026-01-01T00:00:00Z', text: 'x'.repeat(200) }),
  post({ rkey: 'none', at: 'not a date', text: '' }),
  post({ rkey: 'new', at: '2026-09-01T00:00:00Z', text: 'plain' }),
  post({ rkey: 'local', at: '2026-06-02T00:00:00', text: 'zone-less' }),
  post({ rkey: 'also-none', at: 'still not', text: 'sinks too' }),
];

const ARCHIVE = {
  posts: POSTS.slice(0, 3),
  followers: [
    {
      did: OTHER,
      handle: 'x.test',
      displayName: 'X',
      avatar: '',
      followedAt: '2026-01-01T00:00:00Z',
    },
  ],
  following: [
    {
      uri: `at://${DID}/app.bsky.graph.follow/3f`,
      did: OTHER,
      followedAt: '2026-02-01T00:00:00.000Z',
    },
  ],
  blocks: [
    {
      uri: 'at://did:plc:b/app.bsky.graph.block/3b',
      did: 'did:plc:b',
      source: 'direct',
      blockedAt: '2026-03-01T00:00:00.000Z',
    },
    {
      uri: 'list:at://did:plc:l/app.bsky.graph.list/1:at://did:plc:c/app.bsky.graph.listblock/2',
      did: 'did:plc:c',
      source: 'list',
      listUri: 'at://did:plc:l/app.bsky.graph.list/1',
      blockedAt: null,
    },
  ],
  inbound: [
    {
      uri: 'at://x/app.bsky.feed.like/1',
      did: OTHER,
      kind: 'like',
      at: '2026-06-11T00:00:00Z',
      subject: `at://${DID}/app.bsky.feed.post/a`,
    },
  ],
  outbound: [
    {
      uri: `at://${DID}/app.bsky.feed.like/2`,
      kind: 'like',
      did: OTHER,
      at: '2026-06-12T00:00:00Z',
    },
  ],
  atmosphere: [
    { uri: 'at://x/c/1', collection: 'c', at: Date.UTC(2026, 5, 1) },
  ],
  meta: {
    posts: {
      key: 'posts',
      syncedAt: 1,
      complete: true,
      cursor: null,
      shape: 2,
    },
    followers: {
      key: 'followers',
      syncedAt: 1,
      count: 1,
      complete: true,
      profileCount: 3,
    },
    following: null,
    blocks: null,
    inbound: { key: 'inbound', syncedAt: 1, coverageMs: 0, truncated: false },
    outbound: null,
    repo: { key: 'repo', syncedAt: 1, rev: '3abc', bytes: 1024 },
    followerLog: null,
    lists: null,
  },
  loaded: true,
  rev: 7,
};

/** Runs `fn` with a browser's download stood in for; returns what it would download. */
async function downloading(now, fn) {
  const saved = {
    createObjectURL: URL.createObjectURL,
    revokeObjectURL: URL.revokeObjectURL,
    document: globalThis.document,
    now: Date.now,
    setTimeout: globalThis.setTimeout,
  };
  let blob = null;
  let filename = null;
  URL.createObjectURL = (b) => {
    blob = b;
    return 'blob:virga';
  };
  URL.revokeObjectURL = () => {};
  globalThis.document = {
    createElement: () => ({
      click() {},
      remove() {},
      set download(name) {
        filename = name;
      },
    }),
    body: { appendChild() {} },
  };
  globalThis.setTimeout = () => 0;
  Date.now = () => now;
  try {
    fn();
  } finally {
    URL.createObjectURL = saved.createObjectURL;
    URL.revokeObjectURL = saved.revokeObjectURL;
    globalThis.document = saved.document;
    globalThis.setTimeout = saved.setTimeout;
    Date.now = saved.now;
  }
  // Blob.text() would drop the byte-order mark the CSV starts with.
  const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(
    await blob.arrayBuffer(),
  );
  return { text, filename, type: blob.type };
}

/** A JSON document as its value and the order of its own members. */
const documentOf = (text) => ({
  document: JSON.parse(text),
  keys: Object.keys(JSON.parse(text)),
});

export default async function cases() {
  const out = [];
  out.push(value('constants', { EXPORT_FORMAT, EXPORT_VERSION }));

  const actors = [
    {
      did: OTHER,
      handle: 'x.test',
      displayName: 'X',
      avatar: 'https://cdn.example/x.jpg',
      at: 5,
    },
  ];
  out.push(
    ...(await eachN(
      'archiveJson',
      [
        {
          $id: 'whole',
          archive: ARCHIVE,
          did: DID,
          handle: 'alice.example',
          actors,
          now: Date.UTC(2026, 9, 29, 12),
        },
        { $id: 'no-options', archive: ARCHIVE, now: Date.UTC(2026, 9, 29, 12) },
        {
          $id: 'bare',
          archive: {
            posts: [],
            followers: [],
            following: [],
            blocks: [],
            inbound: [],
            outbound: [],
            atmosphere: [],
            meta: {},
          },
          actors: [],
          now: 0,
        },
        { $id: 'invalid-now', archive: ARCHIVE, now: '$NaN' },
      ],
      ({ archive, did, handle, actors: a, now }) =>
        documentOf(archiveJson(archive, { did, handle, actors: a, now })),
    )),
  );

  out.push(
    ...(await eachN(
      'postsCsv',
      [
        { $id: 'empty', posts: [] },
        { $id: 'null', posts: null },
        { $id: 'all', posts: POSTS, did: DID, handle: 'alice.example' },
        {
          $id: 'handle-only',
          posts: POSTS.slice(0, 2),
          handle: 'alice.example',
        },
        { $id: 'nobody', posts: POSTS.slice(0, 2) },
        { $id: 'zone', zone: 'Pacific/Chatham', posts: POSTS, did: DID },
        {
          $id: 'holes',
          posts: [
            null,
            post({
              rkey: '',
              uri: undefined,
              text: undefined,
              at: undefined,
              likes: undefined,
            }),
          ],
        },
      ],
      ({ zone, posts, did, handle }) =>
        inZone(zone || 'UTC', () => postsCsv(posts, { did, handle })),
    )),
  );

  out.push(
    ...(await eachN(
      'exportFilename',
      ZONES.flatMap((zone) =>
        [
          ['late', () => local(2026, 10, 3, 23, 30)],
          ['utc-midnight', () => Date.UTC(2026, 9, 3, 23, 30)],
          ['early-year', () => local(5, 1, 2)],
          ['invalid', () => '$NaN'],
        ].flatMap(([name, make]) =>
          [
            ['alice.example', 'posts', 'csv'],
            [null, 'analytics', 'json'],
            ['', 'followers', 'csv'],
          ].map(([handle, what, ext]) => ({
            $id: `${zone} ${name} ${what}`,
            zone,
            handle,
            what,
            ext,
            now: inZone(zone, make),
          })),
        ),
      ),
      ({ zone, handle, what, ext, now }) =>
        inZone(zone, () => exportFilename(handle, what, ext, now)),
    )),
  );

  // exports.js: what each download would hand the browser.
  const owners = [
    { $id: 'handle', did: DID, handle: 'alice.example' },
    { $id: 'did-only', did: DID, handle: null },
    { $id: 'odd-handle', did: DID, handle: 'Ünïcode_näme 👋.test' },
    { $id: 'nobody', did: null, handle: null },
  ];
  out.push(
    ...(await eachN(
      'exportArchive',
      owners.map((o) => ({ ...o, now: Date.UTC(2026, 9, 29, 12) })),
      async ({ did, handle, now }) => {
        const file = await downloading(now, () =>
          exportArchive({
            ...ARCHIVE,
            did,
            handle,
            actors: new Map(actors.map((a) => [a.did, a])),
          }),
        );
        return { ...file, text: documentOf(file.text) };
      },
    )),
  );
  out.push(
    ...(await eachN(
      'exportPosts',
      owners.flatMap((o) => [
        { ...o, now: Date.UTC(2026, 9, 29, 12) },
        {
          ...o,
          $id: `${o.$id} some`,
          now: Date.UTC(2026, 9, 29, 12),
          some: true,
        },
      ]),
      ({ did, handle, now, some }) =>
        downloading(now, () => {
          const archive = { ...ARCHIVE, did, handle };
          if (some) exportPosts(archive, POSTS.slice(3));
          else exportPosts(archive);
        }),
    )),
  );
  out.push(
    ...(await eachN(
      'exportRows',
      [
        {
          $id: 'table',
          did: DID,
          handle: 'alice.example',
          what: 'followers',
          rows: [
            ['did', 'handle', 'count', 'note'],
            [OTHER, 'x.test', 3, 'says "hi", then\nleaves'],
            ['did:plc:b', null, 0.5, true],
            ['did:plc:c', 'c\r', -0, ''],
          ],
        },
        { $id: 'empty', did: null, handle: null, what: 'nothing', rows: [] },
      ].map((input) => ({ ...input, now: Date.UTC(2026, 9, 29, 12) })),
      ({ did, handle, what, rows, now }) =>
        downloading(now, () => exportRows({ did, handle }, what, rows)),
    )),
  );

  return out;
}
