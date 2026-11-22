// src/posting/{autosave,settings}.js, src/posting/composer/restore.js and
// src/lib/pendingCompose.js: what the composer keeps on this device. The
// autosave's two layers, set-aside posts, the debounced writer, the posting
// settings' checks and every refusal word for word, what a composer opening
// brings back, and the compose link kept across a sign-in. Swift:
// VirgaPosting/{Autosave,Settings}.swift, Composer/ComposerRestore.swift,
// Lib/PendingCompose.swift.
//
// Stateful cases are scripts: each step runs against a fresh in-memory
// store (with a quota, or refusing writes, where a step says so) and the
// module's in-memory layer, and the case records every step's result and
// the store's entries (parsed) after it. Fresh ids are canonIds'.

import {
  AUTOSAVE_PREFIX,
  AUTOSAVE_VERSION,
  AUTOSAVE_TTL_MS,
  AUTOSAVE_DEBOUNCE_MS,
  MAX_SET_ASIDE,
  autosaveKey,
  serializeComposerState,
  hasAutosaveContent,
  deserializeComposerState,
  clearAutosave,
  writeAutosave,
  readAutosave,
  setAside,
  countSetAside,
  takeSetAside,
  createAutosaver,
  saveSessionDraft,
  loadSessionDraft,
  clearSessionDraft,
  forgetSessionDrafts,
  clearAllSessionDrafts,
  collectPreviewUrls,
  previewUrlIsHeld,
} from '../../../src/posting/autosave.js';
import {
  restoredTouched,
  keptPostFor,
  clearKept,
  setAsideState,
  setAsideKept,
  isUntouchedSeed,
  worthSettingAside,
  mediaPatches,
  otherKeptAccount,
} from '../../../src/posting/composer/restore.js';
import {
  POSTING_SETTINGS_PREFIX,
  DEFAULT_ACTIONS,
  WEEKDAY_KEYS,
  MAX_LANGS,
  MAX_SLOTS_PER_DAY,
  POSTING_SETTING_KEYS,
  postingSettingsKey,
  baseLanguage,
  defaultPostingSettings,
  readPostingSettings,
  writePostingSettings,
  resolveDefaultGates,
} from '../../../src/posting/settings.js';
import {
  PENDING_COMPOSE_KEY,
  PENDING_COMPOSE_TTL_MS,
  isComposePath,
  rememberPendingCompose,
  takePendingCompose,
} from '../../../src/lib/pendingCompose.js';
import { emptyComposerState } from '../../../src/posting/lib/composerModel.js';
import { each, value } from './_helpers.js';
import {
  atNow,
  blob,
  canonIds,
  file,
  markFiles,
  withFiles,
} from './_composer.js';

export const sources = [
  'src/posting/autosave.js',
  'src/posting/settings.js',
  'src/posting/composer/restore.js',
  'src/lib/pendingCompose.js',
];

const ME = 'did:plc:mira';
const OTHER = 'did:plc:other';
const T0 = Date.UTC(2026, 10, 16, 9, 0, 0);
const H = 60 * 60 * 1000;
const plain = (v) => JSON.parse(JSON.stringify(markFiles(v) ?? null));

/** localStorage over a Map: a quota in UTF-16 units of keys and values. */
function fakeStore(quota = null) {
  const items = new Map();
  let refusing = false;
  return {
    getItem: (k) => (items.has(k) ? items.get(k) : null),
    setItem(k, v) {
      if (refusing) throw new Error('refused');
      const text = String(v);
      if (quota != null) {
        let used = 0;
        for (const [kk, vv] of items)
          if (kk !== k) used += kk.length + vv.length;
        if (used + k.length + text.length > quota) throw new Error('quota');
      }
      items.set(k, text);
    },
    removeItem: (k) => items.delete(k),
    plant: (k, v) => items.set(k, v),
    refuse: (flag) => {
      refusing = flag;
    },
    snapshot() {
      const out = {};
      for (const [k, v] of [...items].sort(([a], [b]) => (a < b ? -1 : 1))) {
        try {
          out[k] = { json: JSON.parse(v) };
        } catch {
          out[k] = { text: v };
        }
      }
      return out;
    },
  };
}

// ---- states ------------------------------------------------------------------

const post = (id, text = '', extra = {}) => ({
  id,
  text,
  images: [],
  video: null,
  record: null,
  card: null,
  ...extra,
});
const state = (posts, extra = {}) => ({
  ...plain(emptyComposerState({ asDid: ME })),
  posts,
  ...extra,
});
const RICH = state(
  [
    post('p1', 'hello 😀', {
      images: [
        {
          id: 'i1',
          file: file('a.jpg'),
          alt: 'a picked file',
          mime: 'image/jpeg',
          size: 9,
          previewUrl: 'blob:x/1',
        },
        {
          id: 'i2',
          blob: blob('bafyimg'),
          blobDid: ME,
          alt: 'uploaded',
          mime: 'image/png',
          size: '12',
          aspectRatio: { width: 3, height: 2, extra: 1 },
        },
        {
          id: 'i3',
          localRef: 'draft:1',
          alt: 'kept',
          previewUrl: 'https://cdn.example/i3.jpg',
        },
        null,
        { id: '', localRef: 'draft:2', previewUrl: 'blob:x/2' },
      ],
      card: {
        url: 'https://example.org',
        title: 'T',
        description: 'D',
        thumb: 'blob:x/3',
        thumbFile: file('t.jpg'),
        edited: true,
      },
    }),
    post('p2', 'second', {
      video: {
        status: 'uploading',
        file: file('v.mp4', 'video/mp4'),
        alt: 'v',
        previewUrl: 'blob:x/4',
      },
      record: {
        kind: 'post',
        uri: 'at://did:plc:abc/app.bsky.feed.post/3k',
        cid: 'bafyrec',
        view: { uri: 'x', text: 'quoted' },
      },
    }),
    post('', '', {
      video: {
        status: 'ready',
        blob: blob('bafyvid', 'video/mp4'),
        blobDid: ME,
        mime: 'video/mp4',
        size: 99,
        alt: '',
      },
      card: {
        url: 'https://example.com/a',
        thumb: 'https://cdn.example/t.jpg',
        thumbBlob: blob('bafythumb'),
      },
    }),
  ],
  {
    reply: {
      uri: 'at://did:plc:abc/app.bsky.feed.post/1',
      cid: 'bafyparent',
      author: { did: 'did:plc:abc', handle: 'abc.example' },
      text: 'the parent',
      view: { big: true },
    },
    tags: ['a', 5, 'b'],
    langs: ['en', null],
    labels: ['nudity'],
    gates: { custom: true, reply: [{ type: 'mention' }], quotes: false },
    schedule: {
      mode: 'at',
      at: '2026-11-17T09:00:00.000Z',
      repeat: { every: 'week' },
    },
    lifespan: { enabled: true, lifespanSeconds: 3600 },
    source: { kind: 'draft', id: 'd1', ownerDid: ME },
  },
);
const SIMPLE = state([post('p1', 'just words')]);
const EMPTY = state([post('p1', '')]);
const TAGS_ONLY = state([post('p1', '  ')], { tags: ['only'] });
const REPLY_ONLY = state([post('p1', '')], {
  reply: { uri: 'at://x/app.bsky.feed.post/2' },
});
const FILES_ONLY = state([
  post('p1', '', { images: [{ id: 'i9', file: file('z.jpg') }] }),
]);
const STATES = [
  ['rich', RICH],
  ['simple', SIMPLE],
  ['empty', EMPTY],
  ['tags-only', TAGS_ONLY],
  ['reply-only', REPLY_ONLY],
  ['files-only', FILES_ONLY],
  ['null', null],
  [
    'loose',
    {
      posts: [null, 5, { text: 7, images: null }],
      reply: { cid: 'c' },
      tags: 'abc',
      gates: [],
      lifespan: 5,
    },
  ],
  ['no-posts', {}],
];

// ---- the scripts ------------------------------------------------------------

function runScript(script) {
  clearAllSessionDrafts();
  const store = script.noStore ? null : fakeStore(script.quota ?? null);
  const timers = [];
  let clock = T0;
  let saver = null;
  const steps = [];
  for (const step of script.steps) {
    const opts = {
      ...(store ? { store } : { store: null }),
      now: step.now ?? clock,
    };
    let result;
    try {
      const s = step.state === undefined ? undefined : withFiles(step.state);
      const id =
        step.idFrom !== undefined ? steps[step.idFrom].result : step.id;
      switch (step.op) {
        case 'write':
          result = writeAutosave(step.did, s, {
            ...opts,
            lifespanTouched: step.touched,
          });
          break;
        case 'read':
          result = readAutosave(step.did, { ...opts, base: step.base });
          break;
        case 'clear':
          result = clearAutosave(step.did, opts);
          break;
        case 'aside':
          result = setAside(step.did, s, {
            ...opts,
            lifespanTouched: step.touched,
          });
          break;
        case 'count':
          result = countSetAside(step.did, opts);
          break;
        case 'take':
          result = takeSetAside(step.did, { ...opts, id, base: step.base });
          break;
        case 'saveSession':
          result = saveSessionDraft(step.did, s, {
            now: opts.now,
            lifespanTouched: step.touched,
          });
          break;
        case 'loadSession':
          result = loadSessionDraft(step.did);
          break;
        case 'clearSession':
          result = clearSessionDraft(step.did);
          break;
        case 'forget':
          result = forgetSessionDrafts(step.did);
          break;
        case 'held':
          result = previewUrlIsHeld(step.url, s);
          break;
        case 'plant':
          store.plant(
            step.key,
            typeof step.value === 'string'
              ? step.value
              : JSON.stringify(step.value),
          );
          break;
        case 'refuse':
          store.refuse(step.flag);
          break;
        case 'kept':
          result = keptPostFor(step.did, { ...opts, base: step.base });
          break;
        case 'clearKept':
          result = clearKept(step.did, opts);
          break;
        case 'asideState':
          result = setAsideState(step.did, s, {
            ...opts,
            touched: step.touched,
          });
          break;
        case 'asideKept':
          result = setAsideKept(step.did, { ...opts, base: step.base });
          break;
        case 'otherKept':
          result = otherKeptAccount(step.accounts, step.did, opts);
          break;
        case 'saver':
          saver = createAutosaver({
            store,
            now: () => clock,
            ...(step.currentDid !== undefined
              ? { currentDid: () => step.currentDid }
              : {}),
            setTimer: (fn, ms) => {
              timers.push({ fn, ms, live: true });
              return timers.length - 1;
            },
            clearTimer: (n) => {
              if (timers[n]) timers[n].live = false;
            },
          });
          break;
        case 'save':
          result = saver.save(
            step.did,
            s,
            step.touched === undefined
              ? undefined
              : { lifespanTouched: step.touched },
          );
          break;
        case 'flush':
          result = saver.flush();
          break;
        case 'cancel':
          result = saver.cancel();
          break;
        case 'pending':
          result = saver.pending();
          break;
        case 'fire':
          for (const t of timers)
            if (t.live) {
              t.live = false;
              t.fn();
            }
          break;
        case 'tick':
          clock = step.to;
          break;
        default:
          throw new Error(`unknown step ${step.op}`);
      }
    } catch (error) {
      result = { $throws: String(error?.message || error) };
    }
    steps.push({
      result: plain(result),
      store: store ? store.snapshot() : null,
    });
  }
  return steps;
}

const W = (did, s, extra = {}) => ({ op: 'write', did, state: s, ...extra });
const R = (did, extra = {}) => ({ op: 'read', did, ...extra });
const base = (did = ME) => {
  const b = plain(
    emptyComposerState({ asDid: did, defaults: { langs: ['de'] } }),
  );
  b.posts[0].id = 'b1';
  return b;
};

const SCRIPTS = [
  [
    'write-read',
    { steps: [W(ME, RICH, { touched: true }), R(ME, { base: base() }), R(ME)] },
  ],
  ['write-each-state', { steps: STATES.map(([, s]) => W(ME, s)) }],
  ['empty-clears', { steps: [W(ME, SIMPLE), W(ME, EMPTY), R(ME)] }],
  [
    'expires',
    {
      steps: [
        W(ME, SIMPLE, { now: T0 }),
        R(ME, { now: T0 + 24 * H }),
        R(ME, { now: T0 + 24 * H + 1 }),
      ],
    },
  ],
  [
    'other-account',
    {
      steps: [
        W(ME, SIMPLE),
        R(OTHER),
        {
          op: 'plant',
          key: autosaveKey(OTHER),
          value: { version: 1, did: ME, savedAt: T0, state: SIMPLE },
        },
        R(OTHER),
      ],
    },
  ],
  [
    'malformed',
    {
      steps: [
        { op: 'plant', key: autosaveKey(ME), value: 'not json' },
        R(ME),
        {
          op: 'plant',
          key: autosaveKey(ME),
          value: { version: 2, savedAt: T0, state: SIMPLE },
        },
        R(ME),
        {
          op: 'plant',
          key: autosaveKey(ME),
          value: { version: 1, savedAt: String(T0), state: SIMPLE },
        },
        R(ME),
        {
          op: 'plant',
          key: autosaveKey(ME),
          value: {
            version: 1,
            savedAt: T0,
            state: SIMPLE,
            mediaLeftOut: '3',
            lifespanTouched: 'yes',
          },
        },
        R(ME),
        { op: 'plant', key: autosaveKey(ME), value: [1] },
        R(ME),
        { op: 'plant', key: autosaveKey(ME), value: '' },
        R(ME),
      ],
    },
  ],
  ['quota-drops-views', { quota: 2600, steps: [W(ME, RICH), R(ME)] }],
  ['quota-full', { quota: 200, steps: [W(ME, RICH), R(ME)] }],
  [
    'refused',
    {
      steps: [
        W(ME, SIMPLE),
        { op: 'refuse', flag: true },
        W(ME, RICH),
        R(ME),
        { op: 'clear', did: ME },
        R(ME),
      ],
    },
  ],
  [
    'no-store',
    {
      noStore: true,
      steps: [
        W(ME, SIMPLE),
        R(ME),
        { op: 'aside', did: ME, state: SIMPLE },
        { op: 'count', did: ME },
        { op: 'take', did: ME },
      ],
    },
  ],
  [
    'no-did',
    {
      steps: [
        W('', SIMPLE),
        R(''),
        { op: 'aside', did: '', state: SIMPLE },
        { op: 'count', did: '' },
        { op: 'take', did: '' },
      ],
    },
  ],
  [
    'aside',
    {
      steps: [
        W(ME, SIMPLE),
        { op: 'aside', did: ME, state: RICH, touched: false },
        { op: 'aside', did: ME, state: TAGS_ONLY, now: T0 + 1000 },
        { op: 'aside', did: ME, state: EMPTY },
        { op: 'count', did: ME },
        R(ME),
        { op: 'clear', did: ME },
        R(ME),
        { op: 'count', did: ME },
        { op: 'take', did: ME, base: base() },
        { op: 'count', did: ME },
        { op: 'take', did: ME, idFrom: 1, base: base() },
        { op: 'take', did: ME },
        { op: 'count', did: ME },
      ],
    },
  ],
  [
    'aside-from-store-only',
    {
      steps: [
        { op: 'aside', did: ME, state: SIMPLE },
        { op: 'forget', did: ME },
        { op: 'count', did: ME },
        { op: 'take', did: ME, base: base() },
        { op: 'take', did: ME, id: 'aside-missing-1' },
      ],
    },
  ],
  [
    'aside-cap',
    {
      steps: [
        ...Array.from({ length: 12 }, (_, n) => ({
          op: 'aside',
          did: ME,
          state: state([post('p1', `post ${n}`)]),
          now: T0 + n,
        })),
        { op: 'count', did: ME },
        { op: 'forget', did: ME },
        { op: 'count', did: ME },
      ],
    },
  ],
  [
    'aside-expires',
    {
      steps: [
        { op: 'aside', did: ME, state: SIMPLE, now: T0 },
        { op: 'forget', did: ME },
        { op: 'count', did: ME, now: T0 + 25 * H },
        { op: 'take', did: ME, now: T0 + 25 * H },
        W(ME, SIMPLE, { now: T0 + 25 * H }),
      ],
    },
  ],
  [
    'session',
    {
      steps: [
        { op: 'saveSession', did: ME, state: RICH, touched: true },
        { op: 'loadSession', did: ME },
        { op: 'held', url: 'blob:x/1', state: EMPTY },
        { op: 'held', url: 'blob:x/9', state: EMPTY },
        {
          op: 'held',
          url: 'blob:x/9',
          state: state([
            post('p1', '', { images: [{ previewUrl: 'blob:x/9' }] }),
          ]),
        },
        { op: 'saveSession', did: ME, state: EMPTY },
        { op: 'loadSession', did: ME },
        { op: 'held', url: 'blob:x/1', state: EMPTY },
        { op: 'aside', did: ME, state: RICH },
        { op: 'held', url: 'blob:x/4', state: null },
        { op: 'clearSession', did: ME },
        { op: 'forget', did: ME },
        { op: 'held', url: 'blob:x/4', state: null },
        { op: 'loadSession', did: '' },
      ],
    },
  ],
  [
    'restore',
    {
      steps: [
        { op: 'kept', did: ME, base: base() },
        W(ME, RICH),
        { op: 'kept', did: ME, base: base() },
        { op: 'saveSession', did: ME, state: SIMPLE, touched: false },
        { op: 'kept', did: ME, base: base() },
        { op: 'clearKept', did: ME },
        { op: 'kept', did: ME },
        W(ME, state([post('p1', 'timer on')], { lifespan: { enabled: true } })),
        { op: 'kept', did: ME },
        { op: 'asideKept', did: ME, base: base() },
        { op: 'kept', did: ME },
        { op: 'count', did: ME },
        { op: 'asideState', did: ME, state: EMPTY },
        { op: 'asideState', did: OTHER, state: SIMPLE, touched: true },
        {
          op: 'otherKept',
          accounts: [
            { did: ME },
            null,
            { did: '' },
            { did: OTHER, handle: 'o.example' },
          ],
          did: ME,
        },
        { op: 'otherKept', accounts: [{ did: ME }], did: ME },
        { op: 'otherKept', accounts: null, did: ME },
        { op: 'asideKept', did: 'did:plc:nobody' },
      ],
    },
  ],
  [
    'autosaver',
    {
      steps: [
        { op: 'saver', currentDid: ME },
        { op: 'save', did: ME, state: SIMPLE, touched: true },
        { op: 'pending' },
        { op: 'tick', to: T0 + 500 },
        { op: 'save', did: ME, state: RICH },
        { op: 'fire' },
        { op: 'pending' },
        R(ME),
        { op: 'save', did: OTHER, state: SIMPLE },
        { op: 'flush' },
        R(OTHER),
        { op: 'save', did: ME, state: TAGS_ONLY },
        { op: 'cancel' },
        { op: 'pending' },
        { op: 'fire' },
        { op: 'save', did: '', state: SIMPLE },
        { op: 'pending' },
        { op: 'flush' },
        { op: 'save', did: ME, state: EMPTY },
        { op: 'flush' },
        R(ME),
      ],
    },
  ],
  [
    'autosaver-any-account',
    {
      steps: [
        { op: 'saver' },
        { op: 'save', did: OTHER, state: SIMPLE },
        { op: 'fire' },
        R(OTHER),
      ],
    },
  ],
];

// ---- autosave and restore ------------------------------------------------------

async function autosaveCases() {
  const all = [
    value('autosaveConstants', {
      AUTOSAVE_PREFIX,
      AUTOSAVE_VERSION,
      AUTOSAVE_TTL_MS,
      AUTOSAVE_DEBOUNCE_MS,
      MAX_SET_ASIDE,
      key: autosaveKey(ME),
    }),
  ];
  const inputs = [];
  for (const [sid, s] of STATES)
    for (const views of [true, false])
      inputs.push({ $id: `${sid}/${views}`, state: s, views });
  all.push(
    ...(await each('serializeComposerState', inputs, (i) =>
      serializeComposerState(withFiles(i.state), { views: i.views }),
    )),
    ...(await each(
      'hasAutosaveContent',
      [
        ...STATES.map(([$id, s]) => ({ $id, state: s })),
        { $id: 'serialized', state: serializeComposerState(RICH).state },
      ],
      (i) => hasAutosaveContent(withFiles(i.state)),
    )),
  );
  const stored = [
    serializeComposerState(withFiles(RICH)).state,
    serializeComposerState(withFiles(SIMPLE), { views: false }).state,
    { posts: [] },
    {
      posts: [
        {
          images: [{ alt: 'no id' }, null],
          video: 'v',
          record: 5,
          card: { url: 'x' },
        },
      ],
    },
    {
      posts: [{ id: 'kept', text: 'x' }],
      reply: null,
      schedule: null,
      gates: null,
      lifespan: [],
      asDid: '',
    },
    {
      tags: ['t'],
      langs: ['fr'],
      labels: [],
      source: { kind: 'scheduled', id: 's1' },
    },
    null,
    'nonsense',
  ];
  const deserialize = [];
  for (const [n, s] of stored.entries())
    for (const b of [undefined, base(), { posts: [], asDid: OTHER }])
      deserialize.push({
        $id: `${n}/${b ? (b.posts.length ? 'base' : 'empty-base') : 'none'}`,
        stored: s,
        base: b,
      });
  all.push(
    ...(await each('deserializeComposerState', deserialize, (i) =>
      atNow(T0, () =>
        canonIds(plain(deserializeComposerState(i.stored, i.base)), i),
      ),
    )),
    ...(await each(
      'collectPreviewUrls',
      STATES.map(([$id, s]) => ({ $id, state: s })),
      (i) => collectPreviewUrls(withFiles(i.state)),
    )),
  );
  all.push(
    ...(await each(
      'autosaveScript',
      SCRIPTS.map(([$id, script]) => ({ $id, script })),
      (i) => atNow(T0, () => canonIds(runScript(i.script), i)),
    )),
  );
  all.push(
    ...(await each(
      'restoredTouched',
      [
        { kept: { lifespanTouched: true } },
        {
          kept: {
            lifespanTouched: false,
            state: { lifespan: { enabled: true } },
          },
        },
        { kept: { state: { lifespan: { enabled: true } } } },
        { kept: { state: { lifespan: { enabled: 0 } } } },
        { kept: { lifespanTouched: 'yes' } },
        { kept: null },
      ],
      (i) => restoredTouched(i.kept),
    )),
    ...(await each(
      'isUntouchedSeed',
      [
        {
          state: state([post('p1', 'from the link')]),
          seed: { texts: ['from the link'] },
        },
        {
          state: state([post('p1', 'from the link!')]),
          seed: { texts: ['from the link'] },
        },
        { state: state([post('p1', '')]), seed: { texts: [] } },
        {
          state: state([post('p1', 'a'), post('p2', 'b')]),
          seed: { texts: ['a', 'b'] },
        },
        { state: state([post('p1', 'a')]), seed: { texts: ['a', 'b'] } },
        {
          state: state([post('p1', 'a', { images: [{ id: 'i' }] })]),
          seed: { texts: ['a'] },
        },
        {
          state: state([post('p1', 'a', { video: { status: 'idle' } })]),
          seed: { texts: ['a'] },
        },
        {
          state: state([post('p1', 'a', { record: { uri: 'x' } })]),
          seed: { texts: ['a'] },
        },
        { state: state([post('p1', 'a')]), seed: null },
        { state: state([post('p1', 'a')]), seed: { texts: 'a' } },
        { state: null, seed: { texts: [] } },
      ],
      (i) => isUntouchedSeed(i.state, i.seed),
    )),
    ...(await each(
      'worthSettingAside',
      [
        { state: SIMPLE },
        { state: SIMPLE, seed: { texts: ['just words'] } },
        { state: EMPTY },
        { state: TAGS_ONLY, seed: { texts: [''] } },
        { state: null },
      ],
      (i) => worthSettingAside(i.state, i.seed),
    )),
  );
  const cur = state([
    post('p1', 'one', {
      images: [
        { id: 'i1', localRef: 'r1', mime: 'image/png' },
        { id: 'i2', localRef: 'r2', file: file('have.jpg') },
        { id: 'i3' },
        { id: 'i4', localRef: 'r4', previewUrl: 'blob:mine' },
        { id: 'i5', localRef: 'r5' },
      ],
      video: { localRef: 'v1', status: 'idle', alt: 'clip' },
    }),
    post('p2', 'two', {
      video: { localRef: 'v2', file: file('v.mp4', 'video/mp4') },
    }),
    post('p3', 'three', { images: [{ id: 'i6', localRef: 'r6' }] }),
  ]);
  const filled = {
    posts: [
      {
        id: 'p1',
        images: [
          {
            id: 'i1',
            localRef: 'r1',
            file: file('one.png', 'image/png', 30),
            previewUrl: 'blob:one',
          },
          { id: 'i2', localRef: 'r2', file: file('two.jpg') },
          {
            id: 'i4',
            localRef: 'r4',
            file: file('four.jpg', 'image/jpeg', 4),
            mime: 'image/jpeg',
            size: 400,
            previewUrl: 'blob:four',
          },
          { id: 'i5', localRef: 'other', file: file('five.jpg') },
        ],
        video: {
          localRef: 'v1',
          file: file('clip.mp4', 'video/mp4', 77),
          mime: 'video/mp4',
        },
      },
      {
        id: 'p2',
        video: { localRef: 'v2', file: file('again.mp4', 'video/mp4') },
      },
      {
        id: 'p3',
        images: [
          { id: 'i6', localRef: 'r6', file: { size: 5, type: 'image/png' } },
        ],
      },
    ],
  };
  all.push(
    ...(await each(
      'mediaPatches',
      [
        { current: cur, filled },
        { current: cur, filled: { posts: [] } },
        { current: cur, filled: null },
        { current: null, filled },
      ],
      (i) => plain(mediaPatches(withFiles(i.current), withFiles(i.filled))),
    )),
  );
  return all;
}

// ---- settings ----------------------------------------------------------------

function runSettings(script) {
  const store = script.noStore ? null : fakeStore(script.quota ?? null);
  const events = [];
  const target = { dispatchEvent: (e) => events.push(plain(e.detail)) };
  const steps = [];
  for (const step of script.steps) {
    let result;
    try {
      switch (step.op) {
        case 'write':
          result = writePostingSettings(step.did, step.patch, store, {
            target,
          });
          break;
        case 'read':
          result = readPostingSettings(
            step.did,
            store,
            step.language === undefined ? {} : { language: step.language },
          );
          break;
        case 'plant':
          store.plant(
            postingSettingsKey(step.did),
            typeof step.value === 'string'
              ? step.value
              : JSON.stringify(step.value),
          );
          break;
        case 'refuse':
          store.refuse(step.flag);
          break;
        default:
          throw new Error(`unknown step ${step.op}`);
      }
    } catch (error) {
      result = {
        $throws: String(error?.message || error),
        field: error?.field ?? null,
      };
    }
    steps.push({
      result: plain(result),
      store: store ? store.snapshot() : null,
    });
  }
  return { steps, events };
}

const LIST = `at://${ME}/app.bsky.graph.list/l1`;
const WRITE = (patch, did = ME) => ({ op: 'write', did, patch });
const READ = (did = ME, language) => ({ op: 'read', did, language });
const SETTINGS_SCRIPTS = [
  [
    'defaults',
    {
      steps: [
        READ(),
        READ(ME, 'fr-CA'),
        READ(ME, 'zz-top'),
        READ(ME, ''),
        READ(null),
      ],
    },
  ],
  [
    'langs',
    {
      steps: [
        WRITE({ langs: ['en', 'EN', ' pt-BR ', 'zh-Hant'] }),
        WRITE({ langs: ['en', 'fr', 'de', 'es'] }),
        WRITE({ langs: 'en' }),
        WRITE({ langs: ['english!'] }),
        WRITE({ langs: [null] }),
        WRITE({ langs: [] }),
        READ(),
      ],
    },
  ],
  [
    'gates',
    {
      steps: [
        WRITE({
          gates: {
            reply: [
              { type: 'mention' },
              { type: 'mention' },
              { type: 'list', list: LIST },
            ],
            quotes: false,
          },
        }),
        WRITE({ gates: null }),
        WRITE({ gates: 'everyone' }),
        WRITE({ gates: { reply: 'all' } }),
        WRITE({
          gates: { reply: [{ type: 'list', list: 'https://bsky.app/x' }] },
        }),
        WRITE({ gates: { reply: [{ type: 'bogus' }] } }),
        WRITE({
          gates: {
            reply: Array.from({ length: 6 }, (_, n) => ({
              type: 'list',
              list: `${LIST}${n}`,
            })),
          },
        }),
        WRITE({ gates: [] }),
        WRITE({ gates: { quotes: 0 } }),
        READ(),
      ],
    },
  ],
  [
    'queue',
    {
      steps: [
        WRITE({
          queue: {
            timezone: ' Europe/Paris ',
            slots: { mon: ['17:00', '09:00', '09:00'], sun: [] },
          },
        }),
        WRITE({ queue: { timezone: 'Nowhere/Land', slots: {} } }),
        WRITE({ queue: { timezone: 'america/new_york', slots: {} } }),
        WRITE({ queue: { slots: { mon: '09:00' } } }),
        WRITE({ queue: { slots: { tue: ['9:00'] } } }),
        WRITE({ queue: { slots: { tue: ['24:00'] } } }),
        WRITE({ queue: { slots: { tue: [930] } } }),
        WRITE({
          queue: {
            slots: {
              wed: Array.from(
                { length: 49 },
                (_, n) =>
                  `${String(Math.floor(n / 2)).padStart(2, '0')}:${n % 2 ? '30' : '00'}`,
              ),
            },
          },
        }),
        WRITE({ queue: [] }),
        WRITE({ queue: { timezone: 5, slots: null } }),
        READ(),
      ],
    },
  ],
  [
    'switches',
    {
      steps: [
        WRITE({
          defaultAction: 'queue',
          requireAltText: true,
          showThreadSuggestion: false,
          threadNumbering: 'counter',
          suggestBestTimes: false,
          unknownKey: 1,
        }),
        WRITE({ defaultAction: 'publish' }),
        WRITE({ defaultAction: { a: 1 } }),
        WRITE({ requireAltText: 'yes' }),
        WRITE({ threadNumbering: 'roman' }),
        WRITE({ suggestBestTimes: 1 }),
        READ(),
      ],
    },
  ],
  [
    'objects',
    {
      steps: [
        WRITE({
          lifespan: {
            enabled: true,
            lifespanSeconds: 7200,
            deleteAt: '2026-12-01T00:00:00Z',
          },
        }),
        WRITE({
          adviser: {
            enabled: true,
            reviewMode: 'always',
            goals: { customText: 'x'.repeat(600) },
          },
        }),
        WRITE({ lifespan: [] }),
        WRITE({ adviser: 'on' }),
        READ(),
      ],
    },
  ],
  [
    'stored',
    {
      steps: [
        {
          op: 'plant',
          did: ME,
          value: {
            langs: ['en', 'xx-'],
            gates: 5,
            queue: { slots: { mon: ['09:00'] } },
            defaultAction: 'draft',
            adviser: [],
            lifespan: { enabled: true },
            other: 1,
          },
        },
        READ(),
        WRITE({ requireAltText: true }),
        { op: 'plant', did: ME, value: 'not json' },
        READ(),
        { op: 'plant', did: ME, value: [1, 2] },
        READ(),
      ],
    },
  ],
  [
    'refused',
    {
      steps: [
        WRITE({ requireAltText: true }),
        { op: 'refuse', flag: true },
        WRITE({ defaultAction: 'draft' }),
        READ(),
      ],
    },
  ],
  [
    'no-store',
    { noStore: true, steps: [WRITE({ requireAltText: true }), READ()] },
  ],
  [
    'no-account',
    { steps: [WRITE({ requireAltText: true }, ''), WRITE({}, null)] },
  ],
];

async function settingsCases() {
  const all = [
    value('settingsConstants', {
      POSTING_SETTINGS_PREFIX,
      DEFAULT_ACTIONS,
      WEEKDAY_KEYS,
      MAX_LANGS,
      MAX_SLOTS_PER_DAY,
      POSTING_SETTING_KEYS,
      key: postingSettingsKey(ME),
    }),
  ];
  all.push(
    ...(await each(
      'baseLanguage',
      [
        'en-GB',
        'pt_BR',
        ' FR ',
        'zh-Hant-TW',
        'english',
        'e',
        '',
        null,
        'x1',
        'ast-ES',
        5,
      ].map((language) => ({ language })),
      (i) => baseLanguage(i.language),
    )),
    ...(await each(
      'defaultPostingSettings',
      ['en-GB', 'de', '', null, 'nonsense'].map((language) => ({ language })),
      (i) => defaultPostingSettings({ language: i.language }),
    )),
    ...(await each(
      'settingsScript',
      SETTINGS_SCRIPTS.map(([$id, script]) => ({ $id, script })),
      (i) => runSettings(i.script),
    )),
  );
  const GATE_SETTINGS = [
    { gates: { reply: [{ type: 'follower' }], quotes: false } },
    { gates: null },
    {},
    null,
  ];
  const FOUND = [
    { found: { reply: [{ type: 'following' }], quotes: true } },
    { found: { quotes: false } },
    { found: { reply: [{ type: 'nonsense' }] } },
    { found: null },
    { found: 'yes' },
    { throws: true },
    { none: true },
  ];
  const gateInputs = [];
  for (const settings of GATE_SETTINGS)
    for (const f of FOUND) gateInputs.push({ settings, ...f });
  gateInputs.push({ settings: { gates: { reply: 'all' } }, found: null });
  all.push(
    ...(await each('resolveDefaultGates', gateInputs, (i) =>
      resolveDefaultGates(
        i.settings,
        i.none
          ? {}
          : {
              agent: {},
              readDefaultGates: async () => {
                if (i.throws) throw new Error('down');
                return i.found;
              },
            },
      ),
    )),
  );
  return all;
}

// ---- pending compose ---------------------------------------------------------

async function pendingCases() {
  const all = [
    value('pendingConstants', { PENDING_COMPOSE_KEY, PENDING_COMPOSE_TTL_MS }),
  ];
  all.push(
    ...(await each(
      'isComposePath',
      [
        '/intent/compose',
        '/intent/compose/',
        '/intent/compose//',
        '/posting/compose',
        '/posting',
        '/intent/compose?x',
        '',
        null,
        5,
        ['/intent/compose'],
      ].map((path) => ({ path })),
      (i) => isComposePath(i.path),
    )),
  );
  const RUNS = [
    [
      {
        op: 'remember',
        path: '/intent/compose/',
        search: '?text=hi%20there',
        now: T0,
      },
      { op: 'take', now: T0 + 1000 },
      { op: 'take', now: T0 + 2000 },
    ],
    [
      {
        op: 'remember',
        path: '/posting/compose',
        search: 'text=no-question-mark',
        now: T0,
      },
      { op: 'take', now: T0 },
    ],
    [
      { op: 'remember', path: '/posting', search: '?x', now: T0 },
      { op: 'take', now: T0 },
    ],
    [
      { op: 'remember', path: '/intent/compose', now: T0 },
      { op: 'take', now: T0 + 30 * 60 * 1000 },
    ],
    [
      { op: 'remember', path: '/intent/compose', now: T0 },
      { op: 'take', now: T0 + 30 * 60 * 1000 + 1 },
    ],
    [
      { op: 'remember', path: '/intent/compose', now: T0 },
      { op: 'take', now: T0 - 1 },
    ],
    [
      { op: 'plant', value: '{"path":"/intent/compose","search":5,"at":0}' },
      { op: 'take', now: 1 },
    ],
    [
      { op: 'plant', value: '{"path":"/elsewhere","search":"?a","at":0}' },
      { op: 'take', now: 1 },
    ],
    [
      { op: 'plant', value: '{"path":"/intent/compose","at":"0"}' },
      { op: 'take', now: 1 },
    ],
    [
      { op: 'plant', value: 'not json' },
      { op: 'take', now: 1 },
    ],
    [
      { op: 'plant', value: 'null' },
      { op: 'take', now: 1 },
    ],
    [{ op: 'take', now: 1 }],
    [
      { op: 'refuse' },
      { op: 'remember', path: '/intent/compose', now: T0 },
      { op: 'take', now: T0 },
    ],
    [
      { op: 'noStore' },
      { op: 'remember', path: '/intent/compose', now: T0 },
      { op: 'take', now: T0 },
    ],
  ];
  all.push(
    ...(await each(
      'pendingScript',
      RUNS.map((steps) => ({ steps })),
      (i) => {
        let store = fakeStore();
        return i.steps.map((step) => {
          let result;
          if (step.op === 'remember')
            result = rememberPendingCompose(
              step.path,
              ...(step.search === undefined ? [undefined] : [step.search]),
              { store, now: step.now },
            );
          else if (step.op === 'take')
            result = takePendingCompose({ store, now: step.now });
          else if (step.op === 'plant')
            store.plant(PENDING_COMPOSE_KEY, step.value);
          else if (step.op === 'refuse') store.refuse(true);
          else if (step.op === 'noStore') store = null;
          return {
            result: result ?? null,
            store: store ? store.snapshot() : null,
          };
        });
      },
    )),
  );
  return all;
}

export default async function cases() {
  return [
    ...(await autosaveCases()),
    ...(await settingsCases()),
    ...(await pendingCases()),
  ];
}
