// src/posting/composer/loaders.js: what the composer reads before it shows
// an intent. The public reads (the post replied to, a record to quote, a
// handle to resolve) are recorded exchanges with the public AppView, through
// library/sources.js's own helpers, so the Swift port is held to the same
// requests through VirgaNetwork's PublicAppView. The draft and scheduled
// calls are scripted, each call recorded. Swift:
// VirgaPosting/Composer/ComposerLoaders.swift.

import {
  loadError,
  refUri,
  replyFromView,
  loadReplyTarget,
  loadRecordTarget,
  loadDraftTarget,
  loadScheduledTarget,
  continueCandidates,
} from '../../../src/posting/composer/loaders.js';
import { each, inZone } from './_helpers.js';
import { recordFetch, json, inTurn } from './_fetch.js';

export const sources = ['src/posting/composer/loaders.js'];

const MIRA = 'did:plc:mira';
const WREN = 'did:plc:wren';
const POST = `at://${WREN}/app.bsky.feed.post/3a`;
const view = (uri, extra = {}) => ({
  uri,
  cid: 'bafycid',
  author: {
    did: WREN,
    handle: 'wren.example.com',
    displayName: 'Wren',
    avatar: 'https://x/a.jpg',
  },
  record: { text: 'hello', ...extra },
});

const errorOf = (e) => ({
  $throws: e.message,
  code: e.code ?? null,
  status: e.status ?? null,
});

async function recorded(answers, fn) {
  const out = await recordFetch(inTurn(...answers), async () => {
    try {
      return { value: await fn() };
    } catch (e) {
      return errorOf(e);
    }
  });
  return out;
}

export default async function cases() {
  const all = [];
  all.push(
    ...(await each(
      'loadError',
      [{ code: 'GONE', message: 'It’s gone.' }],
      (i) => {
        const e = loadError(i.code, i.message);
        return { message: e.message, code: e.code };
      },
    )),
    ...(await each(
      'replyFromView',
      [
        { view: view(POST) },
        {
          view: view(POST, {
            reply: {
              root: {
                uri: 'at://did:plc:a/app.bsky.feed.post/0',
                cid: 'rootcid',
              },
            },
          }),
        },
        {
          view: view(POST, {
            reply: { root: { uri: 'at://did:plc:a/app.bsky.feed.post/0' } },
          }),
        },
        { view: { uri: POST, cid: 'c', author: { did: WREN } } },
        { view: { uri: POST, cid: 'c', record: { text: 5 } } },
        { view: { uri: 'x' } },
        { view: { cid: 'c' } },
        { view: null },
      ],
      (i) => replyFromView(i.view),
    )),
  );

  // Recorded reads.
  const RESOLVED = json({ did: WREN });
  const CASES = [
    ['refUri', 'with-uri', { uri: POST, kind: 'post' }, []],
    ['refUri', 'with-did', { kind: 'feed', did: WREN, rkey: 'gen' }, []],
    [
      'refUri',
      'handle',
      { kind: 'post', handle: '@Wren.Example.com', rkey: '3a' },
      [RESOLVED],
    ],
    [
      'refUri',
      'handle-unknown',
      { kind: 'post', handle: 'nobody.example', rkey: '3a' },
      [
        json(
          { error: 'InvalidRequest', message: 'Unable to resolve handle' },
          400,
        ),
      ],
    ],
    [
      'refUri',
      'handle-offline',
      { kind: 'list', handle: 'wren.example.com', rkey: 'l1' },
      ['offline'],
    ],
    ['refUri', 'bad-kind', { kind: 'thing', did: WREN, rkey: 'x' }, []],
    ['refUri', 'none', null, []],
    [
      'loadReplyTarget',
      'ok',
      { uri: POST, kind: 'post' },
      [json({ posts: [view(POST)] })],
    ],
    [
      'loadReplyTarget',
      'by-handle',
      { kind: 'post', handle: 'wren.example.com', rkey: '3a' },
      [
        RESOLVED,
        json({
          posts: [view(`at://${WREN}/app.bsky.feed.post/other`), view(POST)],
        }),
      ],
    ],
    [
      'loadReplyTarget',
      'first-view',
      { uri: POST },
      [json({ posts: [view(`at://${WREN}/app.bsky.feed.post/other`)] })],
    ],
    ['loadReplyTarget', 'gone', { uri: POST }, [json({ posts: [] })]],
    [
      'loadReplyTarget',
      'no-cid',
      { uri: POST },
      [json({ posts: [{ uri: POST }] })],
    ],
    [
      'loadReplyTarget',
      'server-error',
      { uri: POST },
      [
        json(
          { error: 'InternalServerError', message: 'Upstream failure' },
          502,
        ),
      ],
    ],
    [
      'loadReplyTarget',
      'server-error-bare',
      { uri: POST },
      [{ status: 500, text: 'nope' }],
    ],
    ['loadReplyTarget', 'offline', { uri: POST }, ['offline']],
    [
      'loadReplyTarget',
      'unresolved',
      { kind: 'post', handle: 'x.example', rkey: '1' },
      [json({}, 400)],
    ],
    [
      'loadRecordTarget',
      'post',
      { uri: POST, kind: 'post' },
      [json({ posts: [view(POST)] })],
    ],
    [
      'loadRecordTarget',
      'post-gone',
      { uri: POST, kind: 'post' },
      [json({ posts: [] })],
    ],
    [
      'loadRecordTarget',
      'post-offline',
      { uri: POST, kind: 'post' },
      ['offline'],
    ],
    [
      'loadRecordTarget',
      'feed',
      { kind: 'feed', did: WREN, rkey: 'gen' },
      [
        json({
          view: {
            uri: `at://${WREN}/app.bsky.feed.generator/gen`,
            cid: 'feedcid',
            displayName: 'Gen',
          },
        }),
      ],
    ],
    [
      'loadRecordTarget',
      'feed-404',
      { kind: 'feed', did: WREN, rkey: 'gen' },
      [json({ error: 'NotFound', message: 'Feed not found' }, 404)],
    ],
    [
      'loadRecordTarget',
      'feed-500',
      { kind: 'feed', did: WREN, rkey: 'gen' },
      [json({ error: 'X' }, 500)],
    ],
    [
      'loadRecordTarget',
      'list',
      { kind: 'list', handle: 'wren.example.com', rkey: 'l1' },
      [
        RESOLVED,
        json({
          list: {
            uri: `at://${WREN}/app.bsky.graph.list/l1`,
            cid: 'listcid',
            name: 'L',
          },
          items: [],
        }),
      ],
    ],
    [
      'loadRecordTarget',
      'list-400',
      { kind: 'list', did: WREN, rkey: 'l1' },
      [json({ error: 'InvalidRequest' }, 400)],
    ],
    [
      'loadRecordTarget',
      'list-no-cid',
      { kind: 'list', did: WREN, rkey: 'l1' },
      [json({ list: { uri: 'x' } })],
    ],
    [
      'loadRecordTarget',
      'starterpack',
      { kind: 'starterpack', did: WREN, rkey: 'sp' },
      [
        json({
          starterPack: {
            uri: `at://${WREN}/app.bsky.graph.starterpack/sp`,
            cid: 'spcid',
          },
        }),
      ],
    ],
    [
      'loadRecordTarget',
      'starterpack-offline',
      { kind: 'starterpack', did: WREN, rkey: 'sp' },
      ['offline'],
    ],
    [
      'loadRecordTarget',
      'not-found',
      { kind: 'feed', handle: 'nobody.example', rkey: 'gen' },
      [json({}, 400)],
    ],
    ['loadRecordTarget', 'no-kind', { uri: POST }, []],
  ];
  for (const [fn, id, ref, answers] of CASES) {
    const run = { refUri, loadReplyTarget, loadRecordTarget }[fn];
    const out = await recorded(answers.length ? answers : [json({})], () =>
      run(ref),
    );
    all.push({ id, fn, input: { ref }, output: out });
  }

  // Drafts: every call scripted.
  const DRAFT = { id: 'd1', draft: { posts: [{ text: 'saved' }] } };
  const DRAFTS = [
    ['found', { list: [{ id: 'd0' }, DRAFT] }],
    ['gone', { list: [{ id: 'd0' }] }],
    ['null-list', { list: null }],
    ['signed-out', { agentThrows: true }],
    ['read-fails', { listThrows: true }],
    ['open-throws', { list: [DRAFT], openThrows: true }],
  ];
  for (const [id, s] of DRAFTS) {
    const calls = [];
    let out;
    try {
      out = {
        value: await loadDraftTarget({
          draftId: 'd1',
          ownerDid: MIRA,
          agentFor: async (did) => {
            calls.push(['agentFor', did]);
            if (s.agentThrows) throw new Error('reauth');
            return 'agent';
          },
          listAllDrafts: async (agent) => {
            calls.push(['listAllDrafts', agent]);
            if (s.listThrows) throw new Error('down');
            return s.list;
          },
          openDraft: (v, options) => {
            calls.push(['openDraft', v, options]);
            if (s.openThrows) throw new Error('cannot open');
            return { state: { opened: v.id }, missing: [] };
          },
          defaults: { langs: ['en'] },
        }),
      };
    } catch (e) {
      out = errorOf(e);
    }
    all.push({
      id,
      fn: 'loadDraftTarget',
      input: { script: s },
      output: { ...out, calls },
    });
  }

  // Scheduled posts: every call scripted.
  const ROW = {
    id: 's1',
    status: 'pending',
    payload: { posts: [{ record: { text: 'later' } }] },
  };
  const SCHEDULED = [
    ['found', { row: ROW }],
    ['failed-row', { row: { ...ROW, status: 'failed' } }],
    [
      'with-media',
      {
        row: {
          ...ROW,
          payload: { ...ROW.payload, media: { m1: { mime: 'image/png' } } },
        },
        media: { m1: 'bytes' },
      },
    ],
    [
      'empty-media',
      { row: { ...ROW, payload: { ...ROW.payload, media: {} } } },
    ],
    [
      'media-fails',
      { row: { ...ROW, payload: { media: { m1: {} } } }, mediaThrows: true },
    ],
    ['partial', { row: { ...ROW, partial: true } }],
    ['publishing', { row: { ...ROW, status: 'publishing' } }],
    ['published', { row: { ...ROW, status: 'published' } }],
    ['missing', { row: null }],
    ['404', { getThrows: 404 }],
    ['500', { getThrows: 500 }],
    ['offline', { getThrows: 'offline' }],
    ['no-session', { noReq: true }],
  ];
  for (const [id, s] of SCHEDULED) {
    const calls = [];
    let out;
    try {
      out = {
        value: await loadScheduledTarget({
          id: 's1',
          asDid: MIRA,
          req: s.noReq ? null : 'req',
          getScheduled: async (req, sid) => {
            calls.push(['getScheduled', req, sid]);
            if (s.getThrows === 'offline') throw new TypeError('fetch failed');
            if (s.getThrows)
              throw Object.assign(new Error('nope'), { status: s.getThrows });
            return s.row;
          },
          getScheduledMedia: async (req, sid) => {
            calls.push(['getScheduledMedia', req, sid]);
            if (s.mediaThrows) throw new Error('down');
            return s.media;
          },
          reconstructFromScheduled: (row, media, options) => {
            calls.push(['reconstruct', row.id, media, options]);
            return { rebuilt: row.id, media };
          },
        }),
      };
    } catch (e) {
      out = errorOf(e);
    }
    all.push({
      id,
      fn: 'loadScheduledTarget',
      input: { script: s },
      output: { ...out, calls },
    });
  }

  const ROWS = [
    {
      uri: `at://${MIRA}/app.bsky.feed.post/1`,
      at: '2026-03-10T09:00:00.000Z',
    },
    {
      uri: `at://${MIRA}/app.bsky.feed.post/2`,
      at: '2026-03-12T09:00:00.000Z',
      replyTo: MIRA,
    },
    {
      uri: `at://${MIRA}/app.bsky.feed.post/3`,
      at: '2026-03-11T09:00:00.000Z',
      replyTo: WREN,
    },
    {
      uri: `at://${WREN}/app.bsky.feed.post/4`,
      at: '2026-03-13T09:00:00.000Z',
    },
    {
      uri: `at://${MIRA}/app.bsky.feed.repost/5`,
      at: '2026-03-14T09:00:00.000Z',
    },
    { uri: `at://${MIRA}/app.bsky.feed.post/6`, at: 'junk' },
    { uri: `at://${MIRA}/app.bsky.feed.post/7`, at: '2026-03-12T09:00:00' },
    { uri: `at://${MIRA}/app.bsky.feed.post/8` },
    {
      uri: `at://${MIRA}/app.bsky.feed.post/9`,
      at: '2026-03-12T09:00:00.000Z',
    },
    null,
  ];
  all.push(
    ...(await each(
      'continueCandidates',
      [
        { rows: ROWS, did: MIRA, tz: 'UTC' },
        { rows: ROWS, did: MIRA, tz: 'America/New_York' },
        { rows: ROWS, did: MIRA, tz: 'Pacific/Chatham', limit: 3 },
        { rows: ROWS, did: MIRA, tz: 'UTC', limit: 0 },
        { rows: ROWS, did: MIRA, tz: 'UTC', limit: -1 },
        { rows: ROWS, did: WREN, tz: 'UTC' },
        { rows: null, did: MIRA, tz: 'UTC' },
      ],
      (i) =>
        inZone(i.tz, () =>
          i.limit === undefined
            ? continueCandidates(i.rows, i.did)
            : continueCandidates(i.rows, i.did, i.limit),
        ),
    )),
  );
  return all;
}
