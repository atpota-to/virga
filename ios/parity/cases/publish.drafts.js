// src/posting/drafts/drafts.js: a ComposerState written as Bluesky's draft
// and read back, what a drafts list shows for one, the paths a draft names,
// the device id, the errors, a draft's cards completed, and the account's
// drafts through Bluesky's AppView (through Virga's server) as recorded
// scripts: listing and paging, saving, updating, deleting, opening and
// pruning, with the media store's contents and the drafts-changed events
// each leaves behind. Swift: VirgaPosting/Drafts/Drafts.swift and
// Drafts+Shapes.swift, replayed through MockTransport.
//
// Inputs from drafts.test.js, every case it has, and more: lexicon limits in
// several locales, drafts from Bluesky's app and from Anisota, broken and
// loose drafts, cursors handed back twice and walks that never end, refusals
// and failures part way.

import { each, value } from './_helpers.js';
import { recordFetch, json } from './_fetch.js';
import { canonIds } from './_composer.js';
import {
  NOW,
  agentFor,
  fail,
  loadFresh,
  methodOf,
  ok,
  paramsOf,
  inputOf,
  withFixedDate,
  withTimers,
  withUuids,
} from './_publish.js';

export const sources = ['src/posting/drafts/drafts.js'];

const ALICE = 'did:plc:alice';
const BOB = 'did:plc:bob';
const DEVICE = '0b6c3c2e-9f0a-4d6e-8a1b-2c3d4e5f6a7b';
const POST_URI = 'at://did:plc:carol/app.bsky.feed.post/3kq';
const ROOT_URI = 'at://did:plc:carol/app.bsky.feed.post/3kp';
const LIST_URI = 'at://did:plc:carol/app.bsky.graph.list/3kl';
const BLOB = {
  $type: 'blob',
  ref: { $link: 'bafkreiimage' },
  mimeType: 'image/jpeg',
  size: 2048,
};
const THUMB = {
  $type: 'blob',
  ref: { $link: 'bafkreithumb' },
  mimeType: 'image/jpeg',
  size: 512,
};
const CARD = {
  url: 'https://example.com/a',
  title: 'Ex',
  description: 'D',
  thumb: 'https://cardyb.bsky.app/v1/image?url=x',
};
const LINK_FACETS = [
  {
    index: { byteStart: 0, byteEnd: 4 },
    features: [
      { $type: 'app.bsky.richtext.facet#link', uri: 'https://moth.example' },
    ],
  },
];
const FAMILY = '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}';
const B32 = '234567abcdefghijklmnopqrstuvwxyz';

/** The AppView's n-th draft id (a TID, as the lexicon wants). */
export function draftId(n) {
  let out = '';
  for (let i = 0, v = n; i < 5; i++, v = Math.floor(v / 32))
    out = B32[v % 32] + out;
  return `3ldraft2${out}`;
}

// The ids a run mints that no two runs agree on: newId's, and drafts.js's
// read ids (`image-<now>-<n>`).
const READ_ID = /^image-[0-9a-z]+-\d+$/;
function canon(value, input) {
  const named = new Map();
  const walk = (v) => {
    if (typeof v === 'string' && READ_ID.test(v)) {
      if (!named.has(v))
        named.set(v, `pm${'0'.repeat(8)}read${named.size + 1}`);
      return named.get(v);
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object')
      return Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, walk(x)]),
      );
    return v;
  };
  return canonIds(walk(value), input);
}

const post = (fields = {}) => ({
  id: 'p1',
  text: '',
  images: [],
  video: null,
  record: null,
  card: null,
  ...fields,
});

/**
 * Bluesky's AppView, as drafts.js meets it through Virga's server: drafts
 * kept in memory, newest edit first. `script`: `pageSize`, `drafts` (views
 * it already holds), `get`/`create`/`update`/`delete` (what each call does
 * in turn: 'ok', 'offline', 'fail:<status>:<message>[:<code>]', or for
 * create 'noid'), and `cursor` 'same' (every page hands the same cursor
 * back) or 'endless' (every page a new draft and a new cursor).
 */
function appView(script = {}) {
  const stash = new Map();
  for (const view of script.drafts || []) stash.set(view.id, view);
  const turns = { get: 0, create: 0, update: 0, delete: 0 };
  let minted = 0;
  const step = (kind) => (script[kind] || [])[turns[kind]++] || 'ok';
  const fault = (s) => {
    if (s === 'offline') throw new TypeError('fetch failed');
    if (s.startsWith('fail:')) {
      const [, status, message, code] = s.split(':');
      return fail(Number(status), message, code);
    }
    return null;
  };
  function responder(request) {
    const method = methodOf(request);
    if (!method || !method.startsWith('app.bsky.draft.')) return null;
    const input = request.method === 'POST' ? inputOf(request) : undefined;
    switch (method) {
      case 'app.bsky.draft.getDrafts': {
        const s = step('get');
        const f = fault(s);
        if (f) return f;
        const p = paramsOf(request);
        if (script.cursor === 'same')
          return ok({
            drafts: [...stash.values()].slice(0, 1),
            cursor: 'same',
          });
        if (script.cursor === 'endless') {
          const n = Number(p.cursor || 0);
          return ok({
            drafts: [
              {
                id: draftId(n + 1),
                draft: { posts: [{ text: `d${n}` }] },
                createdAt: '2026-11-01T00:00:00.000Z',
                updatedAt: '2026-11-01T00:00:00.000Z',
              },
            ],
            cursor: String(n + 1),
          });
        }
        const all = [...stash.values()].sort((a, b) =>
          a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0,
        );
        const size = script.pageSize || Number(p.limit);
        const start = p.cursor ? Number(p.cursor) : 0;
        const page = all.slice(start, start + size);
        const next =
          start + size < all.length ? String(start + size) : undefined;
        return ok(
          next === undefined
            ? { drafts: page }
            : { drafts: page, cursor: next },
        );
      }
      case 'app.bsky.draft.createDraft': {
        const s = step('create');
        const f = fault(s);
        if (f) return f;
        if (s === 'noid') return ok({ id: '' });
        minted += 1;
        const id = draftId(minted + (script.idsFrom || 0));
        const at = new Date(Date.UTC(2026, 10, 12, 0, minted)).toISOString();
        stash.set(id, { id, draft: input.draft, createdAt: at, updatedAt: at });
        return ok({ id });
      }
      case 'app.bsky.draft.updateDraft': {
        const s = step('update');
        const f = fault(s);
        if (f) return f;
        const { id, draft } = input.draft;
        const prev = stash.get(id);
        // Bluesky ignores an update to a draft that isn't there.
        if (prev)
          stash.set(id, {
            ...prev,
            draft,
            updatedAt: new Date(Date.UTC(2026, 10, 13)).toISOString(),
          });
        return ok({});
      }
      case 'app.bsky.draft.deleteDraft': {
        const s = step('delete');
        const f = fault(s);
        if (f) return f;
        stash.delete(input.id);
        return ok({});
      }
      default:
        return null;
    }
  }
  return { stash, responder };
}

/** The card service, for opening drafts: `cards` by address (null for none). */
function cardService(cards = {}) {
  return (request) => {
    if (!request.url.startsWith('https://cardyb.bsky.app/')) return null;
    const url = new URL(request.url).searchParams.get('url');
    const card = cards[url];
    if (card === 'offline') throw new TypeError('fetch failed');
    return card
      ? json(card)
      : json({ error: 'Unable to generate link preview' });
  };
}

const PREVIEWS = { named: (f) => `blob:${f.name}`, none: null };

/** What a step threw, as the fixture keeps it. */
const thrown = (error) => ({
  $throws: String(error?.message || error),
  code: error?.code ?? null,
  postIndex: error?.postIndex ?? null,
});

/**
 * A script of drafts calls against one AppView, one media store and one
 * event listener, every request recorded. Each step's outcome is kept, and
 * after the last step the AppView's drafts, the store and the events heard.
 */
async function script(m, dm, au, ev, { app, media: seed = [], steps, cards }) {
  const view = appView(app);
  const service = cardService(cards);
  freshMedia = () => dm.openDraftMedia(BOB, { indexedDB: null });
  dm.resetDraftMedia();
  const media = await dm.openDraftMedia(ALICE, { indexedDB: null });
  await media.put(seed);
  const heard = [];
  const target = new EventTarget();
  ev.onPostingEvent(ev.POSTING_EVENTS.drafts, (detail) => heard.push(detail), {
    target,
  });
  const outcomes = [];
  const out = await withFixedDate(NOW, () =>
    withUuids(() =>
      recordFetch(
        (request) => {
          const answer = view.responder(request) ?? service(request);
          if (!answer) throw new Error(`no answer for ${request.url}`);
          return answer;
        },
        () =>
          withTimers([], async () => {
            const agent = await agentFor(ALICE);
            for (const s of steps) {
              try {
                outcomes.push(
                  await run(m, au, agent, media, target, s, outcomes),
                );
              } catch (error) {
                outcomes.push(thrown(error));
              }
            }
            return outcomes;
          }),
        { now: NOW },
      ),
    ),
  );
  const refs = await media.refs();
  const entries = [];
  for (const ref of refs) entries.push(await media.get(ref));
  return {
    ...out,
    result: canon(out.result, steps),
    stash: [...view.stash.values()],
    store: { refs, entries },
    heard,
  };
}

/** A store in memory of another account, holding nothing (another device's view). */
let freshMedia = null;

async function run(m, au, agent, media, target, s, outcomes) {
  const opts = {
    media,
    target,
    ...(s.deviceId === undefined ? { deviceId: DEVICE } : {}),
    ...(s.deviceId === 'this-device'
      ? {}
      : s.deviceId
        ? { deviceId: s.deviceId }
        : {}),
    ...(s.texts ? { texts: s.texts } : {}),
    ...(s.mentions
      ? { resolveMention: async (h) => s.mentions[h] ?? null }
      : {}),
  };
  if (s.deviceId === 'this-device') delete opts.deviceId;
  const who = s.agent === 'none' ? null : agent;
  switch (s.op) {
    case 'create':
      return await m.createDraft(who, s.state, opts);
    case 'update':
      return await m.updateDraft(who, s.id, s.state, opts);
    case 'delete':
      return (
        (await m.deleteDraft(who, s.id, {
          media,
          target,
          ...(s.localRefs ? { localRefs: s.localRefs } : {}),
        })) ?? null
      );
    case 'list': {
      const page = await m.listDrafts(who, {
        ...(s.cursor !== undefined ? { cursor: s.cursor } : {}),
        ...(s.limit !== undefined ? { limit: s.limit } : {}),
      });
      return page;
    }
    case 'listAll': {
      const all = await m.listAllDrafts(
        who,
        s.maxPages !== undefined ? { maxPages: s.maxPages } : {},
      );
      return { drafts: [...all], complete: all.complete };
    }
    case 'open': {
      const [at, index] = s.fromList;
      const draftView = outcomes[at].drafts[index];
      return await m.openDraft(draftView, {
        asDid: ALICE,
        media: s.media === 'fresh' ? await freshMedia() : media,
        ...(s.defaults ? { defaults: s.defaults } : {}),
        makePreviewUrl: PREVIEWS[s.preview || 'none'],
        ...(s.fetchCard === 'none' ? { fetchCard: null } : {}),
      });
    }
    case 'prune': {
      const rows = new Map(Object.entries(s.autosave || {}));
      const store = { getItem: (k) => (rows.has(k) ? rows.get(k) : null) };
      if (s.session) au.saveSessionDraft(ALICE, s.session);
      try {
        return await m.pruneOrphanedDraftMedia(who, s.did ?? ALICE, {
          media,
          now: s.now,
          store,
          ...(s.minAgeMs !== undefined ? { minAgeMs: s.minAgeMs } : {}),
        });
      } finally {
        au.clearSessionDraft(ALICE);
      }
    }
    default:
      throw new Error(`unknown step ${s.op}`);
  }
}

export default async function cases() {
  const [m, dm, au, ev, loc, cm] = await loadFresh([
    '../../../src/posting/drafts/drafts.js',
    '../../../src/posting/drafts/draftMedia.js',
    '../../../src/posting/autosave.js',
    '../../../src/posting/events.js',
    '../../../src/lib/locale.js',
    '../../../src/posting/lib/composerModel.js',
  ]);
  const state = (fields = {}) => ({
    ...cm.emptyComposerState({ asDid: ALICE, defaults: { langs: ['en'] } }),
    posts: [post()],
    ...fields,
  });

  const all = [
    value('draftsConstants', {
      DRAFT_LIMITS: m.DRAFT_LIMITS,
      DRAFT_DEVICE_NAME: m.DRAFT_DEVICE_NAME,
      POSTING_DEVICE_KEY: m.POSTING_DEVICE_KEY,
      DRAFT_LIMIT_MESSAGE: m.DRAFT_LIMIT_MESSAGE,
      ORPHAN_MEDIA_MIN_AGE_MS: m.ORPHAN_MEDIA_MIN_AGE_MS,
    }),
  ];

  // postingDeviceId(store)
  all.push(
    ...(await each(
      'postingDeviceId',
      [
        { $id: 'made-once', store: 'memory', calls: 2 },
        { $id: 'kept', store: 'memory', stored: DEVICE },
        {
          $id: 'kept-uppercase',
          store: 'memory',
          stored: DEVICE.toUpperCase(),
        },
        { $id: 'not-a-uuid', store: 'memory', stored: 'nope' },
        {
          $id: 'not-v4',
          store: 'memory',
          stored: '0b6c3c2e-9f0a-1d6e-8a1b-2c3d4e5f6a7b',
        },
        { $id: 'empty', store: 'memory', stored: '' },
        { $id: 'no-store', store: 'none' },
        { $id: 'refusing', store: 'refusing' },
      ],
      ({ store: kind, stored, calls = 1 }) =>
        withUuids(() => {
          const data = new Map(
            stored !== undefined ? [[m.POSTING_DEVICE_KEY, stored]] : [],
          );
          const store =
            kind === 'none'
              ? null
              : {
                  getItem: (k) => (data.has(k) ? data.get(k) : null),
                  setItem: (k, v) => {
                    if (kind === 'refusing')
                      throw new Error('QuotaExceededError');
                    data.set(k, v);
                  },
                };
          const ids = [];
          for (let i = 0; i < calls; i++) ids.push(m.postingDeviceId(store));
          return { ids, stored: data.get(m.POSTING_DEVICE_KEY) ?? null };
        }),
    )),
  );

  // isDraftLimitError(error)
  all.push(
    ...(await each(
      'isDraftLimitError',
      [
        { error: { error: 'DraftLimitReached', status: 400 } },
        { error: { code: 'DraftLimitReached' } },
        { error: { message: 'Error: DraftLimitReached' } },
        { error: { message: 'draftlimitreached' } },
        { error: { message: 'offline' } },
        { error: { message: 5 } },
        { error: { error: 'Other', message: 'x' } },
        { error: null },
        { error: {} },
        { error: 'DraftLimitReached' },
      ],
      ({ error }) => m.isDraftLimitError(error),
    )),
  );

  // composerStateToDraft(state, { texts, deviceId, deviceName, owner })
  const long = 'a'.repeat(1001);
  const drafts = [
    {
      $id: 'lexicon-and-anisota',
      state: state({
        posts: [
          post({
            text: '[moth](https://moth.example) night',
            images: [
              {
                id: 'i1',
                localRef: 'virga-media:1',
                alt: 'a moth',
                blob: BLOB,
                blobDid: ALICE,
                aspectRatio: { width: 4, height: 3 },
              },
            ],
            record: { kind: 'post', uri: POST_URI, cid: 'cidq' },
          }),
        ],
        tags: ['#Moths', 'moths', 'night'],
        labels: ['nudity'],
        langs: ['en', 'fr'],
      }),
      texts: [{ text: 'moth night', facets: LINK_FACETS }],
      deviceId: DEVICE,
    },
    {
      $id: 'thread-with-reply',
      state: state({
        posts: [
          post({ text: 'one' }),
          post({
            id: 'p2',
            text: 'two',
            card: {
              url: 'https://example.com',
              title: 'Ex',
              description: 'd',
              thumb: null,
              thumbBlob: THUMB,
              thumbBlobDid: ALICE,
            },
          }),
        ],
        reply: {
          uri: POST_URI,
          cid: 'cidq',
          root: { uri: ROOT_URI, cid: 'cidr' },
        },
        tags: ['t'],
        labels: ['porn'],
      }),
      texts: [
        { text: 'one', facets: [] },
        { text: 'two', facets: [] },
      ],
    },
    {
      $id: 'foreign-blobs-and-no-paths',
      state: state({
        posts: [
          post({
            text: 'x',
            images: [
              { id: 'a', blob: BLOB, blobDid: BOB },
              { id: 'b', file: { name: 'b' } },
            ],
          }),
        ],
      }),
      texts: [{ text: 'x', facets: [] }],
    },
    {
      $id: 'gates-custom',
      state: state({
        gates: {
          custom: true,
          reply: [{ type: 'following' }, { type: 'list', list: LIST_URI }],
          quotes: false,
        },
      }),
      texts: [{ text: 'x', facets: [] }],
    },
    {
      $id: 'gates-nobody',
      state: state({ gates: { custom: true, reply: [], quotes: true } }),
    },
    {
      $id: 'gates-everyone',
      state: state({ gates: { custom: true, reply: null, quotes: true } }),
    },
    {
      $id: 'gates-defaults',
      state: state({ gates: { custom: false, reply: [], quotes: false } }),
    },
    {
      $id: 'gates-on-a-reply',
      state: state({
        reply: { uri: POST_URI, cid: 'c', root: { uri: POST_URI, cid: 'c' } },
        gates: { custom: true, reply: [], quotes: false },
      }),
    },
    {
      $id: 'too-long',
      state: state({
        posts: [post({ text: 'ok' }), post({ id: 'p2', text: long })],
      }),
      texts: [{ text: 'ok' }, { text: long }],
    },
    {
      $id: 'at-the-limit',
      state: state({ posts: [post({ text: 'a'.repeat(1000) })] }),
      texts: [{ text: 'a'.repeat(1000) }],
    },
    {
      $id: 'too-many-bytes',
      state: state({ posts: [post({ text: FAMILY.repeat(401) })] }),
      texts: [{ text: FAMILY.repeat(401) }],
    },
    ...['de-DE', 'fr-FR', 'hi-IN', 'ja-JP'].map((locale) => ({
      $id: `too-long-${locale}`,
      state: state({ posts: [post({ text: long })] }),
      texts: [{ text: long }],
      locale,
    })),
    {
      $id: 'card-image-not-uploaded',
      state: state({ posts: [post({ text: 'see', card: CARD })] }),
      texts: [{ text: 'see' }],
      deviceId: DEVICE,
    },
    {
      $id: 'card-edited-http-thumb',
      state: state({
        posts: [
          post({
            text: 'see',
            card: { ...CARD, thumb: 'blob:https://virga/1', edited: true },
          }),
        ],
      }),
      texts: [{ text: 'see' }],
    },
    {
      $id: 'video-and-ratio',
      state: state({
        posts: [
          post({
            text: 'v',
            video: {
              localRef: 'virga-media:v',
              alt: 'flying',
              blob: { ...BLOB, mimeType: 'video/mp4' },
              blobDid: ALICE,
              aspectRatio: { width: '16', height: 9.6 },
            },
          }),
        ],
      }),
    },
    {
      $id: 'five-images',
      state: state({
        posts: [
          post({
            text: 'many',
            images: [1, 2, 3, 4, 5].map((n) => ({
              id: `i${n}`,
              localRef: `virga-media:${n}`,
              alt: n === 2 ? '' : `alt ${n}`,
              blob: BLOB,
              blobDid: ALICE,
            })),
          }),
        ],
      }),
    },
    {
      $id: 'device-name-and-owner',
      state: state({
        asDid: '',
        posts: [
          post({ text: 'x', images: [{ id: 'i', blob: BLOB, blobDid: BOB }] }),
        ],
      }),
      deviceName: 'A very long device name '.repeat(6),
      deviceId: 'not-a-uuid',
      owner: BOB,
    },
    {
      $id: 'no-texts-untrimmed',
      state: state({
        posts: [post({ text: '  untrimmed  ' })],
        langs: ['en', '', 5, 'de', 'fr', 'es'],
      }),
    },
    { $id: 'no-posts', state: state({ posts: [] }) },
    { $id: 'no-state', state: null },
  ];
  all.push(
    ...(await each(
      'composerStateToDraft',
      drafts,
      ({ state: s, locale, ...opts }) => {
        const before = loc.activeLocale();
        if (locale) loc.setActiveLocale(locale);
        try {
          return m.composerStateToDraft(s, opts);
        } catch (error) {
          return thrown(error);
        } finally {
          loc.setActiveLocale(before);
        }
      },
    )),
  );

  // draftToComposerState(draftView, { asDid, defaults })
  const roundTrip = m.composerStateToDraft(
    state({
      posts: [
        post({
          text: 'moth night',
          images: [{ id: 'i1', localRef: 'virga-media:1', alt: 'a moth' }],
          record: { kind: 'list', uri: LIST_URI, cid: 'cidl' },
        }),
        post({
          id: 'p2',
          text: 'two',
          video: {
            localRef: 'virga-media:v',
            alt: 'flying',
            mime: 'video/mp4',
            size: 9,
            status: 'idle',
          },
        }),
      ],
      reply: {
        uri: POST_URI,
        cid: 'cidq',
        root: { uri: ROOT_URI, cid: 'cidr' },
      },
      tags: ['moths'],
      labels: ['graphic-media'],
      langs: ['de'],
    }),
    {
      texts: [
        { text: 'moth night', facets: LINK_FACETS },
        { text: 'two', facets: [] },
      ],
    },
  );
  const views = [
    {
      $id: 'virgas-own',
      view: { id: '3d1', draft: roundTrip, createdAt: 'x', updatedAt: 'y' },
      defaults: { langs: ['en'] },
    },
    ...[
      {
        custom: true,
        reply: [{ type: 'mention' }, { type: 'list', list: LIST_URI }],
        quotes: false,
      },
      { custom: true, reply: null, quotes: true },
      { custom: true, reply: [], quotes: true },
      { custom: true, reply: null, quotes: false },
    ].map((gates, i) => ({
      $id: `gates-${i}`,
      view: {
        id: 'g',
        draft: m.composerStateToDraft(state({ gates }), {
          texts: [{ text: 'x' }],
        }),
      },
    })),
    {
      $id: 'bluesky-app',
      view: {
        id: '3bsky',
        draft: {
          deviceName: 'iPhone',
          posts: [
            {
              text: 'see this',
              embedImages: [
                { localRef: { path: 'file:///photo.jpg' }, alt: 'photo' },
              ],
              embedExternals: [{ uri: 'https://example.com/a' }],
              embedRecords: [{ record: { uri: POST_URI, cid: 'cidq' } }],
            },
          ],
        },
      },
      defaults: { langs: ['en'], gates: { reply: [], quotes: true } },
    },
    {
      $id: 'anisota-blobs',
      view: {
        id: '3anisota',
        draft: {
          posts: [
            {
              text: 'blobbed',
              tags: ['anisota', 'moths'],
              embed: {
                $type: 'app.bsky.embed.images',
                images: [
                  {
                    image: BLOB,
                    alt: 'night',
                    aspectRatio: { width: 2, height: 1 },
                  },
                ],
              },
            },
          ],
        },
      },
    },
    {
      $id: 'anisota-video-card-quote',
      view: {
        id: '3a2',
        draft: {
          posts: [
            {
              text: 'v',
              embed: {
                $type: 'app.bsky.embed.recordWithMedia',
                record: {
                  $type: 'app.bsky.embed.record',
                  record: { uri: POST_URI, cid: 'cq' },
                },
                media: {
                  $type: 'app.bsky.embed.video',
                  video: { ...BLOB, mimeType: 'video/mp4' },
                  alt: 'clip',
                },
              },
              embedVideos: [{ localRef: { path: 'virga-media:v' }, alt: '' }],
            },
            {
              text: 'c',
              embed: {
                $type: 'app.bsky.embed.external',
                external: {
                  uri: 'https://e.com',
                  title: 'T',
                  description: 'D',
                  thumb: THUMB,
                },
              },
              virgaCard: { thumb: 'https://img.example/x.jpg', edited: true },
            },
            {
              text: 'q',
              embed: {
                $type: 'app.bsky.embed.record',
                record: {
                  uri: 'at://did:plc:x/app.bsky.feed.generator/f',
                  cid: 'cf',
                },
              },
            },
          ],
          langs: ['en', 5, '', 'de', 'fr', 'es'],
          threadgateAllow: [{ $type: 'app.bsky.feed.threadgate#followerRule' }],
        },
      },
    },
    {
      $id: 'images-misaligned',
      view: {
        id: '3m',
        draft: {
          posts: [
            {
              text: 'x',
              embedImages: [{ localRef: { path: 'virga-media:1' } }],
              embed: {
                $type: 'app.bsky.embed.images',
                images: [
                  { image: BLOB, alt: 'a' },
                  { image: BLOB, alt: 'b' },
                ],
              },
            },
          ],
        },
      },
    },
    { $id: 'empty', view: { id: 'x' }, defaults: { langs: ['en'] } },
    {
      $id: 'broken',
      view: { id: '', draft: { posts: [null, 5, { text: 7, facets: 'x' }] } },
    },
    {
      $id: 'no-account',
      view: { id: 'x', draft: { posts: [{ text: 'a' }] } },
      asDid: null,
    },
    {
      $id: 'reply-without-cids',
      view: {
        id: 'r',
        draft: {
          posts: [
            {
              text: 'a',
              reply: { parent: { uri: POST_URI }, root: { uri: '' } },
            },
          ],
        },
      },
    },
    {
      $id: 'unknown-record-kind',
      view: {
        id: 'u',
        draft: {
          posts: [
            {
              text: 'a',
              embedRecords: [
                {
                  record: {
                    uri: 'at://did:plc:x/com.example.thing/1',
                    cid: 'c',
                  },
                },
              ],
            },
          ],
        },
      },
    },
  ];
  all.push(
    ...(await each(
      'draftToComposerState',
      views,
      async ({ view, defaults, asDid = ALICE }) =>
        withFixedDate(NOW, () =>
          canon(
            m.draftToComposerState(view, {
              asDid: asDid ?? undefined,
              ...(defaults ? { defaults } : {}),
            }),
            {
              view,
            },
          ),
        ),
    )),
  );

  // draftLocalRefs(draftView), summarizeDraft(draftView, { deviceId })
  const rows = [
    {
      $id: 'reply-thread-images',
      view: {
        id: '3d',
        createdAt: '2026-11-01T00:00:00.000Z',
        updatedAt: '2026-11-02T00:00:00.000Z',
        draft: {
          deviceId: 'another-device',
          deviceName: 'Virga',
          langs: ['en'],
          posts: [
            {
              text: 'first',
              tags: ['t'],
              reply: {
                root: { uri: ROOT_URI, cid: 'r' },
                parent: { uri: POST_URI, cid: 'p' },
              },
              embedImages: [
                { localRef: { path: 'virga-media:1' } },
                { localRef: { path: 'virga-media:2' } },
              ],
              embedRecords: [{ record: { uri: POST_URI, cid: 'p' } }],
            },
            {
              text: 'second',
              embedVideos: [{ localRef: { path: 'virga-media:v' } }],
            },
          ],
        },
      },
      deviceId: DEVICE,
    },
    {
      $id: 'saved-here',
      view: {
        id: '3d',
        draft: {
          deviceId: DEVICE,
          posts: [
            {
              text: 'x',
              embedImages: [{ localRef: { path: 'virga-media:1' } }],
            },
          ],
        },
      },
      deviceId: DEVICE,
    },
    {
      $id: 'anisota-media',
      view: {
        id: '3a',
        createdAt: '2026-11-01T00:00:00.000Z',
        draft: {
          posts: [
            {
              text: 'x',
              labels: { values: [{ val: 'porn' }, { val: 'nope' }] },
              embed: {
                $type: 'app.bsky.embed.recordWithMedia',
                record: {
                  record: {
                    uri: 'at://did:plc:x/app.bsky.graph.starterpack/s',
                    cid: 'c',
                  },
                },
                media: { $type: 'app.bsky.embed.images', images: [{}, {}, {}] },
              },
            },
          ],
        },
      },
    },
    {
      $id: 'video-and-link',
      view: {
        id: '3v',
        draft: {
          posts: [
            {
              text: 'v',
              embed: { $type: 'app.bsky.embed.video', video: BLOB },
              embedExternals: [{ uri: 'https://e.com/x' }],
            },
          ],
        },
      },
    },
    {
      $id: 'external-embed',
      view: {
        id: '3e',
        draft: {
          posts: [
            {
              text: 'e',
              embed: {
                $type: 'app.bsky.embed.external',
                external: { uri: 'https://e.com' },
              },
            },
          ],
        },
      },
    },
    {
      $id: 'loose',
      view: {
        id: 0,
        draft: {
          deviceName: '',
          langs: 'en',
          posts: [
            {
              text: 5,
              embedImages: 'ab',
              embedVideos: [],
              tags: 'x',
              embedRecords: [{}],
            },
          ],
        },
      },
    },
    { $id: 'no-draft', view: { id: 'x' } },
    { $id: 'null', view: null },
    {
      $id: 'empty-device',
      view: { id: 'x', draft: { posts: [] } },
      deviceId: '',
    },
  ];
  all.push(
    ...(await each('draftLocalRefs', rows, ({ view }) =>
      m.draftLocalRefs(view),
    )),
    ...(await each('summarizeDraft', rows, ({ view, deviceId }) =>
      m.summarizeDraft(view, deviceId === undefined ? {} : { deviceId }),
    )),
  );

  // completeDraftCards(state, { fetchCard, timeoutMs })
  const cardStates = [
    {
      $id: 'from-the-app',
      state: {
        posts: [
          { card: { url: CARD.url, title: '', description: '', thumb: null } },
        ],
      },
      answers: {
        [CARD.url]: {
          url: CARD.url,
          title: 'Fetched',
          description: 'From the card service',
          thumb: 'https://cardyb.bsky.app/v1/image?url=y',
        },
      },
    },
    {
      $id: 'missing-image-only',
      state: { posts: [{ card: { ...CARD, thumb: null } }] },
      answers: {
        [CARD.url]: {
          url: CARD.url,
          title: 'Theirs',
          description: 'Theirs',
          thumb: 'https://img.example/t.jpg',
          associatedRefs: [{ uri: 'at://a/b/c', cid: 'x' }],
        },
      },
    },
    {
      $id: 'whole-edited-unreachable',
      state: {
        posts: [
          { card: CARD },
          { card: { ...CARD, title: '', thumb: null, edited: true } },
          { card: { ...CARD, thumb: null } },
          { card: { url: 'https://throws.example', title: '' } },
          { card: null },
          { card: { url: '' } },
          {
            card: {
              url: 'https://kept.example',
              title: '',
              thumbBlob: THUMB,
              associatedRefs: [],
            },
          },
        ],
      },
      answers: {
        [CARD.url]: null,
        'https://throws.example': 'throw',
        'https://kept.example': {
          title: 'New',
          description: 'N',
          thumb: 'https://img.example/n.jpg',
          associatedRefs: [{ uri: 'at://x', cid: 'c' }],
        },
      },
    },
    { $id: 'nothing', state: { posts: [{ card: CARD }] }, answers: {} },
    { $id: 'no-posts', state: null, answers: {} },
    {
      $id: 'own-timeout',
      state: { posts: [{ card: { url: 'https://t.example' } }] },
      answers: { 'https://t.example': { title: 'T', thumb: null } },
      timeoutMs: 1234,
    },
  ];
  all.push(
    ...(await each(
      'completeDraftCards',
      cardStates,
      async ({ state: s, answers, timeoutMs }) => {
        const calls = [];
        const realTimeout = AbortSignal.timeout;
        const deadlines = [];
        AbortSignal.timeout = function timeout(ms) {
          deadlines.push(ms);
          return realTimeout.call(this, ms);
        };
        try {
          const cards = await m.completeDraftCards(s, {
            fetchCard: async (url, { signal }) => {
              calls.push([url, !!signal]);
              const answer = answers[url];
              if (answer === 'throw') throw new Error('card service down');
              return answer ?? null;
            },
            ...(timeoutMs ? { timeoutMs } : {}),
          });
          return { cards, calls: calls.sort(), deadlines };
        } finally {
          AbortSignal.timeout = realTimeout;
        }
      },
    )),
  );

  // The account's drafts through the AppView.
  const pic = (id, name, size = 10) => ({
    id,
    file: { name, type: 'image/jpeg', size },
    alt: '',
  });
  const REF = (n) =>
    `virga-media:00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const savedState = (fields, id) => ({
    ...state(fields),
    source: { kind: 'draft', id, ownerDid: ALICE },
  });
  const scripts = [
    {
      $id: 'always-the-appview',
      steps: [{ op: 'list' }],
    },
    {
      $id: 'pages-every-draft-once',
      app: { pageSize: 2 },
      steps: [
        ...['a', 'b', 'c', 'd', 'e'].map((text) => ({
          op: 'create',
          state: state({ posts: [post({ text })] }),
          texts: [{ text, facets: [] }],
        })),
        { op: 'list', limit: 2 },
        { op: 'listAll' },
        { op: 'list', cursor: '4', limit: 150 },
        { op: 'list', limit: 0 },
        { op: 'list', limit: -5 },
        { op: 'list', limit: '7' },
        { op: 'list', limit: 'many' },
      ],
    },
    {
      $id: 'cursor-handed-back-twice',
      app: {
        cursor: 'same',
        drafts: [
          {
            id: draftId(1),
            draft: { posts: [{ text: 'x' }] },
            createdAt: '2026-11-01T00:00:00.000Z',
            updatedAt: '2026-11-01T00:00:00.000Z',
          },
        ],
      },
      steps: [{ op: 'listAll' }],
    },
    {
      $id: 'walk-that-never-ends',
      app: { cursor: 'endless' },
      steps: [
        { op: 'listAll', maxPages: 3 },
        { op: 'listAll', maxPages: 0 },
      ],
    },
    {
      $id: 'saves-with-files-kept-here',
      steps: [
        {
          op: 'create',
          state: state({
            posts: [post({ text: 'pic', images: [pic('i', 'a.jpg')] })],
          }),
          texts: [{ text: 'pic', facets: [] }],
        },
        { op: 'listAll' },
      ],
    },
    {
      $id: 'resolves-the-texts',
      steps: [
        {
          op: 'create',
          state: state({
            posts: [
              post({
                text: '  [label](https://example.com) @friend.test #tag  ',
              }),
            ],
          }),
          mentions: { 'friend.test': 'did:plc:friend' },
        },
      ],
    },
    {
      $id: 'this-devices-id',
      steps: [
        {
          op: 'create',
          state: state({ posts: [post({ text: 'x' })] }),
          texts: [{ text: 'x' }],
          deviceId: 'this-device',
        },
      ],
    },
    {
      $id: 'draft-limit',
      app: { create: ['fail:400:DraftLimitReached:DraftLimitReached'] },
      steps: [
        {
          op: 'create',
          state: state({
            posts: [post({ text: 'x', images: [pic('i', 'a.jpg')] })],
          }),
          texts: [{ text: 'x' }],
        },
      ],
    },
    {
      $id: 'no-id-answered',
      app: { create: ['noid'] },
      steps: [
        {
          op: 'create',
          state: state({ posts: [post({ text: 'x' })] }),
          texts: [{ text: 'x' }],
        },
      ],
    },
    {
      $id: 'too-long-forgets-its-files',
      steps: [
        {
          op: 'create',
          state: state({
            posts: [post({ text: long, images: [pic('i', 'a.jpg')] })],
          }),
          texts: [{ text: long }],
        },
      ],
    },
    {
      $id: 'no-account',
      steps: [
        {
          op: 'create',
          agent: 'none',
          state: { ...state(), asDid: '' },
          texts: [{ text: 'x' }],
        },
        {
          op: 'create',
          agent: 'none',
          state: state({
            posts: [post({ text: 'x', images: [pic('i', 'a.jpg')] })],
          }),
          texts: [{ text: 'x' }],
        },
        { op: 'list', agent: 'none' },
        { op: 'delete', agent: 'none', id: draftId(1) },
        { op: 'update', id: '', state: state() },
        { op: 'delete', id: '' },
      ],
    },
    {
      $id: 'updates-in-place',
      steps: [
        {
          op: 'create',
          state: state({
            posts: [post({ text: 'v1', images: [pic('i', 'a', 1)] })],
          }),
          texts: [{ text: 'v1' }],
        },
        {
          op: 'update',
          id: draftId(1),
          state: savedState(
            { posts: [post({ text: 'v2', images: [] })] },
            draftId(1),
          ),
          texts: [{ text: 'v2' }],
        },
        { op: 'listAll' },
      ],
    },
    {
      $id: 'recreated-when-gone',
      steps: [
        {
          op: 'update',
          id: '3goneaaaaaaaa',
          state: state({ posts: [post({ text: 'kept' })] }),
          texts: [{ text: 'kept' }],
        },
      ],
    },
    {
      $id: 'updated-anyway-when-unlisted',
      app: { get: ['offline'] },
      steps: [
        {
          op: 'update',
          id: draftId(5),
          state: state({ posts: [post({ text: 'x' })] }),
          texts: [{ text: 'x' }],
        },
      ],
    },
    {
      $id: 'deletes-with-its-files',
      app: {
        delete: [
          'ok',
          'fail:404:Draft not found',
          'fail:502:502',
          'fail:400:Record not found',
        ],
      },
      steps: [
        {
          op: 'create',
          state: state({
            posts: [post({ text: 'x', images: [pic('i', 'a', 1)] })],
          }),
          texts: [{ text: 'x' }],
        },
        { op: 'delete', id: draftId(1), localRefs: [REF(1)] },
        { op: 'delete', id: '3goneaaaaaaaa' },
        { op: 'delete', id: '3xaaaaaaaaaaa' },
        { op: 'delete', id: '3yaaaaaaaaaaa' },
      ],
    },
    {
      $id: 'keeps-files-another-draft-names',
      steps: [
        {
          op: 'create',
          state: state({
            posts: [post({ text: 'x', images: [pic('i', 'a', 1)] })],
          }),
          texts: [{ text: 'x' }],
        },
        {
          op: 'create',
          state: savedState(
            {
              posts: [
                post({
                  text: 'x',
                  images: [{ ...pic('i', 'a', 1), localRef: REF(1) }],
                }),
              ],
            },
            draftId(1),
          ),
          texts: [{ text: 'x' }],
        },
        { op: 'delete', id: draftId(1) },
        { op: 'delete', id: draftId(2) },
      ],
    },
    {
      $id: 'delete-unlisted',
      app: { get: ['fail:500:down'] },
      media: [{ ref: REF(9), file: { name: 'a', type: 'image/png', size: 1 } }],
      steps: [
        { op: 'delete', id: draftId(1), localRefs: [REF(9), 'file:///other'] },
      ],
    },
    {
      $id: 'forgets-files-for-a-failed-save',
      app: { create: ['offline', 'ok'], update: ['offline'] },
      steps: [
        {
          op: 'create',
          state: state({
            posts: [post({ text: 'x', images: [pic('i', 'a', 1)] })],
          }),
          texts: [{ text: 'x' }],
        },
        {
          op: 'create',
          state: state({
            posts: [post({ text: 'x', images: [pic('i', 'a', 1)] })],
          }),
          texts: [{ text: 'x' }],
        },
        {
          op: 'update',
          id: draftId(1),
          state: savedState(
            {
              posts: [
                post({
                  text: 'x',
                  images: [
                    { ...pic('i', 'a', 1), localRef: REF(2) },
                    pic('j', 'b', 2),
                  ],
                }),
              ],
            },
            draftId(1),
          ),
          texts: [{ text: 'x' }],
        },
      ],
    },
    {
      $id: 'gone-and-at-the-limit',
      app: { create: ['fail:400:DraftLimitReached:DraftLimitReached'] },
      steps: [
        {
          op: 'update',
          id: '3goneaaaaaaaa',
          state: state({ posts: [post({ text: 'x' })] }),
          texts: [{ text: 'x' }],
        },
      ],
    },
    {
      $id: 'opens-with-the-files-kept-here',
      steps: [
        {
          op: 'create',
          state: state({
            posts: [post({ text: 'x', images: [pic('i', 'a.jpg')] })],
          }),
          texts: [{ text: 'x' }],
        },
        { op: 'listAll' },
        { op: 'open', fromList: [1, 0], preview: 'named' },
      ],
    },
    {
      $id: 'opens-elsewhere',
      steps: [
        {
          op: 'create',
          state: state({
            posts: [post({ text: 'x', images: [pic('i', 'a.jpg')] })],
          }),
          texts: [{ text: 'x' }],
        },
        { op: 'listAll' },
        { op: 'open', fromList: [1, 0], media: 'fresh' },
      ],
    },
    {
      $id: 'opens-and-reads-the-cards-again',
      app: {
        drafts: [
          {
            id: draftId(1),
            createdAt: '2026-11-01T00:00:00.000Z',
            updatedAt: '2026-11-01T00:00:00.000Z',
            draft: {
              posts: [
                {
                  text: 'from the app',
                  embedExternals: [
                    {
                      $type: 'app.bsky.draft.defs#draftEmbedExternal',
                      uri: CARD.url,
                    },
                  ],
                },
                {
                  text: 'lacking',
                  embedExternals: [{ uri: 'https://example.com/b' }],
                  virgaCard: { edited: true },
                },
                {
                  text: 'offline',
                  embedExternals: [{ uri: 'https://example.com/c' }],
                },
              ],
            },
          },
        ],
      },
      cards: {
        [CARD.url]: {
          title: 'Fetched',
          description: 'From the card service',
          image: 'https://cardyb.bsky.app/v1/image?url=y',
        },
        'https://example.com/c': 'offline',
      },
      steps: [
        { op: 'listAll' },
        { op: 'open', fromList: [0, 0] },
        {
          op: 'open',
          fromList: [0, 0],
          fetchCard: 'none',
          defaults: { langs: ['fr'] },
        },
      ],
    },
    {
      $id: 'prunes-orphaned-media',
      app: {
        pageSize: 1,
        drafts: [
          {
            id: 'd1',
            draft: {
              posts: [
                {
                  text: 'x',
                  embedImages: [
                    { localRef: { path: 'virga-media:kept' }, alt: '' },
                  ],
                },
              ],
            },
            createdAt: '2026-11-01T00:00:00.000Z',
            updatedAt: '2026-11-02T00:00:00.000Z',
          },
          {
            id: 'd2',
            draft: {
              posts: [
                {
                  text: 'x',
                  embedImages: [
                    { localRef: { path: 'virga-media:kept2' }, alt: '' },
                  ],
                },
              ],
            },
            createdAt: '2026-11-01T00:00:00.000Z',
            updatedAt: '2026-11-01T00:00:00.000Z',
          },
        ].map((d, i) => ({ ...d, id: draftId(i + 1) })),
      },
      media: [
        'virga-media:kept',
        'virga-media:kept2',
        'virga-media:posted-elsewhere',
        'virga-media:autosaved',
        'virga-media:in-memory',
      ]
        .map((ref) => ({
          ref,
          file: { name: ref, type: 'image/jpeg', size: 1 },
          savedAt: Date.UTC(2026, 10, 17),
        }))
        .concat([
          {
            ref: 'virga-media:just-saved',
            file: { name: 'j', type: 'image/jpeg', size: 1 },
            savedAt: Date.UTC(2026, 10, 20) - 60_000,
          },
        ]),
      steps: [
        {
          op: 'prune',
          now: Date.UTC(2026, 10, 20),
          autosave: {
            [`virga:composer-autosave:${ALICE}`]: JSON.stringify({
              version: 1,
              state: {
                posts: [
                  {
                    images: [
                      { localRef: 'virga-media:autosaved' },
                      { localRef: { localRef: 'virga-media:nested' } },
                    ],
                  },
                ],
              },
            }),
          },
          session: {
            asDid: ALICE,
            posts: [
              {
                id: 'p',
                text: 'x',
                images: [{ id: 'i', localRef: 'virga-media:in-memory' }],
              },
            ],
          },
        },
      ],
    },
    {
      $id: 'prune-does-nothing-unread',
      app: { get: ['offline'] },
      media: [
        {
          ref: 'virga-media:a',
          file: { name: 'a', type: 'image/jpeg', size: 1 },
          savedAt: 0,
        },
      ],
      steps: [{ op: 'prune', now: Date.UTC(2026, 10, 20) }],
    },
    {
      $id: 'prune-does-nothing-incomplete',
      app: { cursor: 'endless' },
      media: [
        {
          ref: 'virga-media:a',
          file: { name: 'a', type: 'image/jpeg', size: 1 },
          savedAt: 0,
        },
      ],
      steps: [
        { op: 'prune', now: Date.UTC(2026, 10, 20) },
        { op: 'prune', now: Date.UTC(2026, 10, 20), agent: 'none' },
        { op: 'prune', now: Date.UTC(2026, 10, 20), did: '' },
      ],
    },
    {
      $id: 'prune-bad-autosave',
      media: [
        {
          ref: 'virga-media:a',
          file: { name: 'a', type: 'image/jpeg', size: 1 },
          savedAt: 0,
        },
      ],
      steps: [
        {
          op: 'prune',
          now: Date.UTC(2026, 10, 20),
          minAgeMs: 0,
          autosave: { [`virga:composer-autosave:${ALICE}`]: '{not json' },
        },
      ],
    },
  ];
  all.push(
    ...(await each('draftsScript', scripts, (input) =>
      script(m, dm, au, ev, input),
    )),
  );

  return all;
}
