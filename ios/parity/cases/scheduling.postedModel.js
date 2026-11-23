// src/posting/pages/postedModel.js: the Posted page's logic. Which rows a
// filter and a search keep, a post's text and template seed, "Post again"
// (its seed, its intent and the row's actions), and as recorded exchanges
// (_fetch.js): reading a post as it is now (the public AppView, then the
// account's repo through Virga's server), reading its reply and quote
// settings, deleting it, and reading its pictures back from the PDS.
// Swift: VirgaPosting/Pages/PostedModel.swift over MockTransport.
//
// Inputs from postedModel.test.js, plus every way each read can fail.

import * as P from '../../../src/posting/pages/postedModel.js';
import { each, toJSON, value } from './_helpers.js';
import { recordFetch, json } from './_fetch.js';
import { markFiles } from './_composer.js';
import {
  agentFor,
  fail,
  inputOf,
  methodOf,
  ok,
  paramsOf,
  rawCid,
} from './_publish.js';

export const sources = ['src/posting/pages/postedModel.js'];

const DID = 'did:plc:mira';
const URI = `at://${DID}/app.bsky.feed.post/3abc`;
const APPVIEW = 'https://public.api.bsky.app';
const PDS = 'https://pds.example';

const ROWS = [
  {
    uri: `at://${DID}/app.bsky.feed.post/1`,
    text: 'A walk by the river',
    replyTo: null,
    hasMedia: true,
  },
  {
    uri: `at://${DID}/app.bsky.feed.post/2`,
    text: 'Agreed, the river',
    replyTo: 'did:plc:other',
    hasMedia: false,
  },
  {
    uri: `at://${DID}/app.bsky.feed.post/3`,
    text: 'continuing my thread',
    replyTo: DID,
    hasMedia: false,
  },
  {
    uri: `at://${DID}/app.bsky.feed.post/4`,
    text: 'ΟΔΟΣ İstanbul Straße',
    hasMedia: 1,
  },
  { uri: `at://${DID}/app.bsky.feed.post/5`, text: 42 },
  { text: 'no uri' },
  null,
];

const filterInputs = [];
for (const filter of ['all', 'posts', 'replies', 'media', 'bogus', undefined]) {
  for (const query of [
    '',
    ' RIVER ',
    'river',
    'οδος',
    'odos',
    'i̇stanbul',
    'STRASSE',
    'straße',
    '42',
    null,
  ]) {
    filterInputs.push({ filter, query });
  }
}

const LINK_FACET = {
  index: { byteStart: 5, byteEnd: 15 },
  features: [
    {
      $type: 'app.bsky.richtext.facet#link',
      uri: 'https://example.com/a-long-page',
    },
  ],
};
const blob = (cid, mimeType = 'image/jpeg') => ({
  $type: 'blob',
  ref: { $link: cid },
  mimeType,
  size: 10,
});
const QUOTED = 'at://did:plc:other/app.bsky.feed.post/3q';
const RECORDS = [
  {
    text: 'read this',
    facets: [
      {
        index: { byteStart: 5, byteEnd: 9 },
        features: [
          {
            $type: 'app.bsky.richtext.facet#link',
            uri: 'https://example.com/x',
          },
        ],
      },
    ],
    embed: {
      $type: 'app.bsky.embed.record',
      record: { uri: 'at://did:plc:x/app.bsky.feed.post/1', cid: 'c' },
    },
  },
  {},
  {
    text: '',
    embed: {
      $type: 'app.bsky.embed.external',
      external: { uri: 'https://a.example', title: 'A' },
    },
  },
  {
    text: '',
    embed: {
      $type: 'app.bsky.embed.recordWithMedia',
      record: { record: { uri: 'at://x/app.bsky.feed.post/1', cid: 'c' } },
      media: { $type: 'app.bsky.embed.images', images: [] },
    },
  },
  { text: 'x', embed: { $type: 'app.bsky.embed.images', images: [] } },
  {
    text: 'Read example.co… today',
    facets: [LINK_FACET],
    tags: ['Gardens', 'gardens', 'seeds'],
    langs: ['en', 'fr', '', 5],
  },
  {
    text: 'q',
    embed: {
      $type: 'app.bsky.embed.record',
      record: { uri: QUOTED, cid: 'c' },
    },
  },
  {
    text: 'q',
    embed: { $type: 'app.bsky.embed.record', record: { uri: QUOTED } },
  },
  {
    text: 'l',
    embed: {
      $type: 'app.bsky.embed.external',
      external: {
        uri: 'https://example.com/x',
        title: 'T',
        description: 'D',
        thumb: blob('bafthumb'),
      },
    },
  },
  {
    text: 'both',
    embed: {
      $type: 'app.bsky.embed.recordWithMedia',
      record: {
        $type: 'app.bsky.embed.record',
        record: { uri: QUOTED, cid: 'c' },
      },
      media: {
        $type: 'app.bsky.embed.images',
        images: [
          { image: blob('bafone'), alt: 'a lamp' },
          { image: blob('baftwo', 'image/png') },
          { image: null, alt: 'no blob' },
        ],
      },
    },
  },
  {
    text: 'card and quote',
    embed: {
      $type: 'app.bsky.embed.recordWithMedia',
      record: { record: { uri: QUOTED, cid: 'c' } },
      media: {
        $type: 'app.bsky.embed.external',
        external: { uri: 'https://e.example', title: 5 },
      },
    },
  },
  {
    embed: {
      $type: 'app.bsky.embed.gallery',
      items: [
        { image: blob('bafg'), alt: 'g' },
        { image: { cid: 'bafcid', mimeType: 7 } },
      ],
    },
  },
  {
    embed: { $type: 'app.bsky.embed.video', video: blob('bafv', 'video/mp4') },
  },
  {
    labels: {
      $type: 'com.atproto.label.defs#selfLabels',
      values: [{ val: 'nudity' }],
    },
  },
  { labels: { values: [] } },
  {
    text: 'x',
    embed: { $type: 'app.bsky.embed.external', external: { title: 'no uri' } },
  },
  { text: 7, facets: 'nope' },
  null,
];

const FILE = { $file: true, name: 'a.jpg', type: 'image/jpeg', size: 1 };
const SEED = {
  text: 'Hello again',
  tags: ['seeds'],
  langs: ['en'],
  quote: QUOTED,
  link: null,
  images: [
    { cid: 'a', mime: 'image/jpeg', alt: 'x' },
    { cid: 'b', mime: 'image/jpeg', alt: '' },
  ],
  video: false,
  labelled: false,
};
const BASE = {
  text: 'x',
  tags: [],
  langs: [],
  quote: null,
  images: [],
  video: false,
  labelled: false,
};
const LINK = { url: 'https://example.com/x', title: 'T', description: 'D' };
const intentInputs = [
  { seed: SEED, files: [{ file: FILE, alt: 'x' }], missing: 1 },
  { seed: SEED, files: [], missing: 2 },
  { seed: SEED, files: [], missing: 0 },
  { seed: { ...BASE, link: LINK }, files: [] },
  { seed: { ...BASE, link: LINK }, files: [{ file: FILE, alt: '' }] },
  {
    seed: {
      ...BASE,
      text: '  ',
      images: [{ cid: 'a', mime: 'image/jpeg', alt: '' }],
    },
    files: [],
    missing: 1,
  },
  {
    seed: {
      ...BASE,
      text: '',
      labelled: true,
      images: [{ cid: 'a', mime: 'image/jpeg', alt: '' }],
    },
    files: [{ file: FILE, alt: '' }],
  },
  { seed: { ...BASE, text: '', labelled: true }, files: [] },
  { seed: { ...BASE, text: '', video: true }, files: [] },
  { seed: { ...BASE, text: '', tags: ['only'] }, files: [] },
  { seed: { ...BASE, text: '', quote: QUOTED }, files: [] },
];

const actionInputs = [
  { row: ROWS[0], canPost: true, canSchedule: false },
  { row: ROWS[1], canPost: false, canSchedule: true },
  { row: ROWS[2], canPost: true, canSchedule: true },
  { row: null, canPost: false, canSchedule: false },
];
const quotesOnlyInputs = [
  { offer: { gatesQuotesOnly: true }, record: {} },
  { offer: { gatesQuotesOnly: false }, record: { reply: { root: {} } } },
  { offer: { gatesQuotesOnly: false }, record: {} },
  { offer: null, record: null },
];

// ---- the network ----------------------------------------------------------------

/**
 * A responder for the AppView (`appview`: posts, or 'fail:<status>' /
 * 'offline'), the repo through Virga's server (`repo`: `{ collection:
 * value | 'missing' | 'fail:<status>[:<message>]' | 'nocid' | 'offline' }`)
 * and the PDS's blobs (`blobs`: `{ cid: { type, bytes } | 'fail:<status>' |
 * 'offline' | 'empty' }`).
 */
function network(script = {}) {
  return (request) => {
    if (request.url.startsWith(`${APPVIEW}/`)) {
      const a = script.appview ?? [];
      if (a === 'offline') throw new TypeError('fetch failed');
      if (typeof a === 'string') {
        const status = Number(a.split(':')[1]);
        return json(
          { error: 'UpstreamFailure', message: `upstream said ${status}` },
          status,
        );
      }
      return json({ posts: a });
    }
    if (request.url.startsWith(`${PDS}/`)) {
      const cid = new URL(request.url).searchParams.get('cid');
      const b = (script.blobs || {})[cid] ?? {
        type: 'image/png',
        bytes: [1, 2, 3],
      };
      if (b === 'offline') throw new TypeError('fetch failed');
      if (b === 'empty')
        return { bytes: new Uint8Array(0), contentType: 'image/png' };
      if (typeof b === 'string')
        return json({ error: 'BlobNotFound' }, Number(b.split(':')[1]));
      return { bytes: new Uint8Array(b.bytes), contentType: b.type };
    }
    const method = methodOf(request);
    const collection =
      method === 'com.atproto.repo.getRecord'
        ? paramsOf(request).collection
        : inputOf(request)?.collection;
    const step =
      (script.repo || {})[collection] ??
      (method === 'com.atproto.repo.deleteRecord' ? 'ok' : 'missing');
    if (step === 'offline') throw new TypeError('fetch failed');
    if (step === 'missing')
      return fail(400, 'Could not locate record', 'RecordNotFound');
    if (typeof step === 'string' && step.startsWith('fail:')) {
      const [, status, message = `failed with ${status}`, code] =
        step.split(':');
      return fail(Number(status), message, code);
    }
    // Answers the SDK's lexicon check accepts (real CIDs, a TID rev).
    if (method === 'com.atproto.repo.deleteRecord')
      return ok({ commit: { cid: rawCid('commit'), rev: '3lcommitrev22' } });
    const uri = `at://${DID}/${collection}/3abc`;
    if (step === 'nocid') return ok({ uri, value: { text: 'no cid' } });
    return ok({ uri, cid: rawCid(`record-${collection}`), value: step });
  };
}

function errorJSON(err) {
  return { message: err?.message ?? null, code: err?.code ?? null };
}

/** A recorded call: `run(agent)` with the account's agent (or none). */
function recorded(script, run, { noAgent = false } = {}) {
  return recordFetch(network(script), async () => {
    const agent = noAgent ? null : await agentFor(DID);
    try {
      return { value: toJSON(markFiles((await run(agent)) ?? null)) };
    } catch (err) {
      return { $error: errorJSON(err) };
    }
  });
}

const VIEW = {
  uri: URI,
  cid: 'bafy1',
  record: { text: 'hi' },
  author: { did: DID },
};
const flows = [
  ['readPostNow', 'public-view', { uri: URI }, { appview: [VIEW] }],
  [
    'readPostNow',
    'repo-fallback',
    { uri: URI },
    { appview: [], repo: { 'app.bsky.feed.post': { text: 'repo' } } },
  ],
  ['readPostNow', 'gone', { uri: URI }, { appview: [] }],
  [
    'readPostNow',
    'read-failed',
    { uri: URI },
    { appview: 'fail:502', repo: { 'app.bsky.feed.post': 'offline' } },
  ],
  [
    'readPostNow',
    'read-failed-then-gone',
    { uri: URI },
    { appview: 'fail:502', repo: { 'app.bsky.feed.post': 'missing' } },
  ],
  [
    'readPostNow',
    'appview-offline-repo-ok',
    { uri: URI },
    { appview: 'offline', repo: { 'app.bsky.feed.post': { text: 'r' } } },
  ],
  [
    'readPostNow',
    'view-without-cid',
    { uri: URI },
    {
      appview: [{ uri: URI, record: {} }],
      repo: { 'app.bsky.feed.post': { text: 'r' } },
    },
  ],
  [
    'readPostNow',
    'view-without-record',
    { uri: URI },
    { appview: [{ uri: URI, cid: 'c' }] },
  ],
  [
    'readPostNow',
    'other-view',
    { uri: URI },
    {
      appview: [{ ...VIEW, uri: `${URI}x` }],
      repo: { 'app.bsky.feed.post': { text: 'r' } },
    },
  ],
  [
    'readPostNow',
    'repo-no-cid',
    { uri: URI },
    { appview: [], repo: { 'app.bsky.feed.post': 'nocid' } },
  ],
  [
    'readPostNow',
    'repo-500',
    { uri: URI },
    { appview: [], repo: { 'app.bsky.feed.post': 'fail:500:Internal error' } },
  ],
  [
    'readPostNow',
    'repo-404',
    { uri: URI },
    { appview: [], repo: { 'app.bsky.feed.post': 'fail:404:Nope' } },
  ],
  [
    'readPostNow',
    'repo-message',
    { uri: URI },
    {
      appview: [],
      repo: { 'app.bsky.feed.post': 'fail:400:Could not locate record' },
    },
  ],
  [
    'readPostNow',
    'repo-message-case',
    { uri: URI },
    {
      appview: [],
      repo: { 'app.bsky.feed.post': 'fail:400:Thing NOT FOUND here' },
    },
  ],
  [
    'readPostNow',
    'not-a-post',
    { uri: `at://${DID}/app.bsky.feed.repost/3abc` },
    { appview: [] },
  ],
  ['readPostNow', 'rkey-with-query', { uri: `${URI}?x` }, { appview: [] }],
  ['readPostNow', 'no-agent', { uri: URI }, { appview: [] }, { noAgent: true }],
  [
    'readPostNow',
    'no-agent-failed',
    { uri: URI },
    { appview: 'fail:503' },
    { noAgent: true },
  ],
  ['readPostGates', 'everyone', { uri: URI }, {}],
  [
    'readPostGates',
    'rules',
    { uri: URI },
    {
      repo: {
        'app.bsky.feed.threadgate': {
          allow: [{ $type: 'app.bsky.feed.threadgate#followingRule' }],
        },
        'app.bsky.feed.postgate': {
          embeddingRules: [{ $type: 'app.bsky.feed.postgate#disableRule' }],
        },
      },
    },
  ],
  [
    'readPostGates',
    'nobody',
    { uri: URI },
    { repo: { 'app.bsky.feed.threadgate': { allow: [] } } },
  ],
  [
    'readPostGates',
    'no-allow',
    { uri: URI },
    { repo: { 'app.bsky.feed.threadgate': { hiddenReplies: ['x'] } } },
  ],
  [
    'readPostGates',
    'fails',
    { uri: URI },
    { repo: { 'app.bsky.feed.threadgate': 'fail:500' } },
  ],
  ['readPostGates', 'not-a-post', { uri: 'https://bsky.app/x' }, {}],
  ['deletePost', 'all', { uri: URI }, {}],
  [
    'deletePost',
    'refused',
    { uri: URI },
    { repo: { 'app.bsky.feed.post': 'fail:403:Missing required scope' } },
  ],
  [
    'deletePost',
    'already-gone',
    { uri: URI },
    {
      repo: {
        'app.bsky.feed.post': 'missing',
        'app.bsky.feed.threadgate': 'fail:500',
        'app.bsky.feed.postgate': 'offline',
      },
    },
  ],
  ['deletePost', 'not-a-post', { uri: 'nope' }, {}],
  [
    'fetchPostImages',
    'one-missing',
    {
      images: [
        { cid: 'bafone', mime: 'image/jpeg', alt: 'a lamp' },
        { cid: 'bafgone', mime: 'image/jpeg', alt: '' },
      ],
      pdsUrl: `${PDS}/`,
    },
    { blobs: { bafgone: 'fail:400' } },
  ],
  [
    'fetchPostImages',
    'no-pds',
    { images: [{ cid: 'bafone', mime: 'image/jpeg', alt: '' }] },
    {},
  ],
  [
    'fetchPostImages',
    'types',
    {
      images: [
        { cid: 'a', mime: 'image/webp', alt: '1' },
        { cid: 'b', mime: 'image/jpeg', alt: '2' },
        { cid: 'c', mime: 'image/gif', alt: '3' },
        { cid: 'd', mime: 'IMAGE/PNG', alt: '4' },
        { cid: 'e', mime: 'image/jpeg', alt: '5' },
        { cid: 'f/g h', mime: 'image/jpeg', alt: '6' },
        { cid: 'i', mime: 'image/jpeg', alt: '7' },
      ],
      pdsUrl: `${PDS}///`,
      did: 'did:web:a b',
    },
    {
      blobs: {
        a: { type: 'application/octet-stream', bytes: [9] },
        b: { type: 'image/svg+xml', bytes: [1, 2] },
        c: { type: 'IMAGE/GIF; charset=x', bytes: [3] },
        d: { type: 'text/plain', bytes: [4] },
        e: 'empty',
        i: 'offline',
      },
    },
  ],
];

export default async function cases() {
  const out = [
    value('POSTED_FILTERS', P.POSTED_FILTERS),
    ...(await each(
      'isReplyRow',
      ROWS.map((row) => ({ row })),
      ({ row }) => P.isReplyRow(row, DID),
    )),
    ...(await each('filterPostRows', filterInputs, ({ filter, query }) => {
      const options = { did: DID };
      if (filter !== undefined) options.filter = filter;
      if (query !== undefined) options.query = query;
      return P.filterPostRows(ROWS, options);
    })),
    ...(await each(
      'textForComposer',
      RECORDS.map((record) => ({ record })),
      ({ record }) => P.textForComposer(record),
    )),
    ...(await each(
      'templateSeedFrom',
      RECORDS.map((record) => ({ record })),
      ({ record }) => P.templateSeedFrom(record),
    )),
    ...(await each(
      'postAgainSeed',
      RECORDS.map((record) => ({ record })),
      ({ record }) => P.postAgainSeed(record),
    )),
    ...(await each(
      'postAgainIntent',
      intentInputs,
      ({ seed, files, missing }) =>
        markFiles(
          P.postAgainIntent(seed, {
            did: DID,
            files,
            ...(missing === undefined ? {} : { missing }),
          }),
        ),
    )),
    ...(await each(
      'postRowActions',
      actionInputs,
      ({ row, canPost, canSchedule }) =>
        P.postRowActions(row, { canPost, canSchedule }),
    )),
    ...(await each(
      'gatesQuotesOnlyFor',
      quotesOnlyInputs,
      ({ offer, record }) => P.gatesQuotesOnlyFor(offer, record),
    )),
  ];
  for (const [fn, id, args, script, options] of flows) {
    const run = {
      readPostNow: (agent) => P.readPostNow(args.uri, { agent }),
      readPostGates: (agent) => P.readPostGates(args.uri, { agent }),
      deletePost: (agent) => P.deletePost(args.uri, { agent }),
      fetchPostImages: () =>
        P.fetchPostImages(args.images, {
          did: args.did ?? DID,
          pdsUrl: args.pdsUrl,
        }),
    }[fn];
    const output = await recorded(script, run, options);
    // A made file's lastModified is the machine's clock.
    for (const f of output.result?.value?.files || [])
      delete f.file.lastModified;
    out.push({
      id,
      fn,
      input: toJSON({ ...args, ...(options || {}) }),
      output,
    });
  }
  return out;
}
