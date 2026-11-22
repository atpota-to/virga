// src/posting/pages/draftActions.js: the Drafts page's quick actions. A
// draft row's meta line and "Edited" label, why a row can't be posted or
// scheduled, the message for a failed action, preparing, posting and
// scheduling a draft as scripts against fake deps (each call recorded), and
// the loader that reads a draft's blob-named pictures from the PDS as
// recorded exchanges. Swift: VirgaPosting/Pages/DraftActions.swift.
//
// Inputs from draftActions.test.js, plus loose rows, the days around a
// clock change in the zone a case names (`tz`), and every way a step can
// fail.

import * as D from '../../../src/posting/pages/draftActions.js';
import { DEFAULT_LOCALE, setActiveLocale } from '../../../src/lib/locale.js';
import { each, inZone, toJSON } from './_helpers.js';
import { recordFetch, json } from './_fetch.js';
import { markFiles } from './_composer.js';

export const sources = ['src/posting/pages/draftActions.js'];

const DID = 'did:plc:mira';
const NOW = Date.parse('2026-11-12T12:00:00Z');

function under(tz, locale, fn) {
  return inZone(tz, () => {
    setActiveLocale(locale);
    try {
      return fn();
    } finally {
      setActiveLocale(DEFAULT_LOCALE);
    }
  });
}

// ---- the list ------------------------------------------------------------------

const ROW = {
  updatedAt: '2026-11-12T11:55:00Z',
  isThread: true,
  posts: 3,
  isReply: false,
  images: 2,
  video: false,
  link: null,
  record: { kind: 'post' },
  labels: [],
  tags: ['books', 'reading'],
  deviceName: 'Bluesky',
  savedHere: false,
};
const META_ROWS = [
  ROW,
  null,
  {
    ...ROW,
    isReply: true,
    images: 1,
    video: true,
    link: { url: 'x' },
    record: { kind: 'feed' },
    labels: ['nudity'],
    savedHere: true,
  },
  { ...ROW, record: { kind: 'list' }, tags: [], deviceName: '' },
  {
    ...ROW,
    record: { kind: 'starterpack' },
    images: 1200,
    updatedAt: 'whenever',
  },
  { ...ROW, record: { kind: 'other' }, isThread: true, posts: undefined },
  { text: 'bare' },
  { ...ROW, updatedAt: '2026-11-12T11:00' },
];
const metaInputs = ['UTC', 'America/New_York'].flatMap((tz) =>
  META_ROWS.map((row) => ({ tz, row, now: NOW })),
);
metaInputs.push({
  tz: 'UTC',
  locale: 'en-FR',
  row: { ...ROW, images: 1200 },
  now: NOW,
});

const EDITED = [
  '2026-11-12T11:59:50Z',
  '2026-11-12T12:00:30Z',
  '2026-11-12T13:00:00Z',
  '2026-11-12T11:59:29Z',
  '2026-11-12T11:30:00Z',
  '2026-11-12T11:00:30Z',
  '2026-11-12T09:00:00Z',
  '2026-11-11T12:30:00Z',
  '2026-11-11T12:00:00Z',
  '2026-11-02T09:00:00Z',
  '2025-11-02T09:00:00Z',
  '2025-12-31T23:30:00Z',
  'nope',
  null,
  '2026-11-01T09:00',
];
const editedInputs = ['UTC', 'America/New_York', 'Pacific/Chatham'].flatMap(
  (tz) => EDITED.map((iso) => ({ tz, iso, now: NOW })),
);
editedInputs.push({
  tz: 'UTC',
  iso: '2026-01-01T00:30:00Z',
  now: Date.parse('2025-12-31T23:00:00Z') + 2 * 86_400_000,
});
editedInputs.push({
  tz: 'America/New_York',
  iso: '2026-01-01T03:00:00Z',
  now: Date.parse('2026-01-05T12:00:00Z'),
});
for (const locale of ['en-GB', 'en-AU'])
  editedInputs.push({
    tz: 'UTC',
    locale,
    iso: '2025-11-02T09:00:00Z',
    now: NOW,
  });

const BLOCK_ROWS = [
  {},
  { isReply: true },
  { video: true },
  { mediaElsewhere: true },
  { text: 'x' },
  { text: '  ', images: 0 },
  { text: 'x', mediaElsewhere: true },
  { text: '', images: 1 },
  { text: '', link: { url: 'x' } },
  { text: '', record: { kind: 'post' } },
  { text: '', video: true },
  null,
];
const blockInputs = BLOCK_ROWS.flatMap((row) => [
  { row, can: true },
  { row, can: false },
]);

const MESSAGES = [
  { err: { code: 'MEDIA_MISSING', message: 'Open it.' }, action: 'post' },
  { err: { code: 'NEEDS_BACKEND', message: 'Sign in.' }, action: 'schedule' },
  { err: { code: 'DRAFT_LIMIT', message: 'Too many drafts.' }, action: 'post' },
  { err: { code: 'MISSING_SCOPE', message: 'No scope.' }, action: 'post' },
  {
    err: { problems: [{ message: 'Too long.' }, { message: 'Also this.' }] },
    action: 'post',
  },
  { err: { problems: [] }, action: 'post' },
  { err: { message: 'Offline.' }, action: 'post' },
  { err: {}, action: 'schedule' },
  { err: { message: '' }, action: 'post' },
  { err: null, action: 'post' },
  { err: { code: 'QUOTA_EXCEEDED', message: 'quota' }, action: 'schedule' },
  { err: { message: 'x' }, action: 'other' },
];

// ---- the actions ---------------------------------------------------------------

const VIEW = { id: 'd1', draft: { posts: [{ text: 'hello' }] } };

function baseState(over = {}) {
  return {
    posts: [
      {
        id: 'p',
        text: 'hello',
        images: [],
        video: null,
        record: null,
        card: null,
      },
    ],
    reply: null,
    tags: [],
    langs: ['en'],
    labels: [],
    gates: { custom: false, reply: null, quotes: true },
    asDid: DID,
    schedule: null,
    lifespan: { enabled: false },
    source: { kind: 'draft', id: 'd1', ownerDid: DID },
    ...over,
  };
}
const TIMED = baseState({ lifespan: { enabled: true, lifespanSeconds: 3600 } });
const RESULT = {
  posts: [{ uri: `at://${DID}/app.bsky.feed.post/1`, cid: 'c' }],
  root: { uri: `at://${DID}/app.bsky.feed.post/1`, cid: 'c' },
  written: [
    {
      uri: `at://${DID}/app.bsky.feed.post/1`,
      cid: 'c',
      record: { text: 'hello' },
    },
  ],
};

// [id, action, script]
const scripts = [
  ['defaults', 'prepare', { settings: { langs: ['en'] }, agent: true }],
  [
    'custom-gates',
    'prepare',
    {
      open: {
        state: baseState({ gates: { custom: true, reply: [], quotes: false } }),
        missing: [],
      },
    },
  ],
  [
    'reply',
    'prepare',
    {
      open: {
        state: baseState({ reply: { uri: 'at://x/app.bsky.feed.post/1' } }),
        missing: [],
      },
    },
  ],
  [
    'media-missing',
    'prepare',
    { open: { state: baseState(), missing: ['virga-media:1'] } },
  ],
  [
    'gates-notice',
    'prepare',
    {
      gates: {
        gates: { custom: false, reply: null, quotes: true },
        notice: 'Couldn’t read.',
      },
    },
  ],
  ['gates-throw', 'prepare', { gates: 'throw' }],
  [
    'timer-room',
    'prepare',
    { open: { state: TIMED, missing: [] }, timerRoom: '' },
  ],
  [
    'timer-full',
    'prepare',
    { open: { state: TIMED, missing: [] }, timerRoom: 'It’s in use.' },
  ],
  [
    'timer-null',
    'prepare',
    { open: { state: TIMED, missing: [] }, timerRoom: null },
  ],
  ['timer-no-dep', 'prepare', { open: { state: TIMED, missing: [] } }],
  ['open-throws', 'prepare', { open: 'throw' }],
  ['posts', 'post', { settings: { requireAltText: true }, agent: true }],
  ['alt-text-loose', 'post', { settings: { requireAltText: 'yes' } }],
  ['publish-fails', 'post', { publish: { throws: 'nope' } }],
  ['delete-fails', 'post', { deleteDraft: 'throw' }],
  ['emit-throws', 'post', { emit: 'throw' }],
  [
    'no-written',
    'post',
    {
      publish: {
        result: { posts: [], root: { uri: 'at://x/app.bsky.feed.post/1' } },
      },
    },
  ],
  [
    'timer-failed',
    'post',
    {
      open: { state: baseState({ lifespan: { enabled: true } }), missing: [] },
      timerRoom: '',
      arm: { status: 'failed', error: { message: 'No room' } },
    },
  ],
  [
    'timer-failed-quietly',
    'post',
    {
      open: { state: TIMED, missing: [] },
      timerRoom: '',
      arm: { status: 'failed' },
    },
  ],
  [
    'timer-armed',
    'post',
    {
      open: { state: TIMED, missing: [] },
      timerRoom: '',
      arm: { status: 'armed' },
    },
  ],
  [
    'timer-no-arm',
    'post',
    { open: { state: TIMED, missing: [] }, timerRoom: '' },
  ],
  [
    'timer-gone',
    'post',
    { open: { state: TIMED, missing: [] }, timerRoom: 'full' },
  ],
  [
    'schedules',
    'schedule',
    {
      agent: true,
      scheduledFor: '2026-11-14T09:00:00.000Z',
      queued: true,
      loadImage: true,
    },
  ],
  ['schedules-at', 'schedule', { scheduledFor: '2026-11-14T09:00:00.000Z' }],
  ['needs-backend', 'schedule', { requester: false }],
  [
    'refused',
    'schedule',
    { scheduledFor: 'x', create: { throws: 'q', code: 'QUOTA_EXCEEDED' } },
  ],
  ['serialize-refuses', 'schedule', { scheduledFor: 'x', serialize: 'throw' }],
  [
    'schedule-delete-fails',
    'schedule',
    { scheduledFor: '2026-11-14T09:00:00.000Z', deleteDraft: 'throw' },
  ],
  [
    'schedule-media-missing',
    'schedule',
    {
      scheduledFor: 'x',
      open: { state: baseState(), missing: ['virga-media:2'] },
    },
  ],
];

/** The action over scripted deps, every call recorded. */
async function act(action, script) {
  const calls = [];
  const deps = {
    openDraft: async (view, opts) => {
      calls.push(['openDraft', view.id, opts.asDid, opts.defaults ?? null]);
      if (script.open === 'throw') throw new Error('could not open');
      return script.open || { state: baseState(), missing: [] };
    },
    resolveDefaultGates: async (settings, opts) => {
      calls.push([
        'resolveDefaultGates',
        settings ?? null,
        opts.agent ? 'agent' : null,
      ]);
      if (script.gates === 'throw') throw new Error('gates broke');
      return (
        script.gates || {
          gates: {
            custom: false,
            reply: [{ type: 'following' }],
            quotes: true,
          },
          source: 'bluesky',
          notice: null,
        }
      );
    },
    targetFor: async (did) => {
      calls.push(['targetFor', did]);
      return { did };
    },
    publish: async (state, target, opts) => {
      calls.push([
        'publish',
        state,
        target,
        typeof opts.resolveMention,
        opts.requireAltText,
      ]);
      if (script.publish?.throws) throw new Error(script.publish.throws);
      return script.publish?.result || RESULT;
    },
    emitPostsChanged: (did, detail) => {
      calls.push(['emitPostsChanged', did, detail.added]);
      if (script.emit === 'throw') throw new Error('listener broke');
    },
    deleteDraft: async (agent, id) => {
      calls.push(['deleteDraft', agent ? 'agent' : null, id]);
      if (script.deleteDraft === 'throw') throw new Error('x');
    },
    resolveMention: async () => null,
    serializeForSchedule: async (state, opts) => {
      calls.push([
        'serializeForSchedule',
        state,
        {
          now: new Date(opts.now).getTime(),
          scheduledFor: opts.scheduledFor ?? null,
          queued: opts.queued,
          resolveMention: typeof opts.resolveMention,
          loadImage: typeof opts.loadImage,
        },
      ]);
      if (script.serialize === 'throw')
        throw Object.assign(new Error('Write something first.'), {
          code: 'EMPTY',
        });
      return {
        scheduledFor: opts.scheduledFor,
        queued: opts.queued,
        payload: {},
      };
    },
    createScheduled: async (req, body) => {
      calls.push(['createScheduled', req.did, body]);
      if (script.create?.throws)
        throw Object.assign(new Error(script.create.throws), {
          code: script.create.code,
        });
      return { id: 'row1' };
    },
    requester:
      script.requester === false ? null : { did: DID, request: () => {} },
  };
  if ('timerRoom' in script)
    deps.timerRoom = async (rule) => {
      calls.push(['timerRoom', rule]);
      return script.timerRoom;
    };
  if ('arm' in script)
    deps.armTimer = async (result, state) => {
      calls.push(['armTimer', result, state.lifespan]);
      const a = script.arm;
      return a && a.error ? { ...a, error: new Error(a.error.message) } : a;
    };
  if (script.loadImage) deps.loadImage = async () => null;
  const args = {
    did: DID,
    settings: script.settings ?? {},
    agent: script.agent ? 'agent' : undefined,
    deps,
  };
  try {
    let out;
    if (action === 'prepare') out = await D.prepareDraft(VIEW, args);
    else if (action === 'post') {
      out = await D.postDraftNow(VIEW, args);
      out = {
        ...out,
        timer: out.timer
          ? {
              status: out.timer.status,
              error: out.timer.error
                ? { message: out.timer.error.message }
                : null,
            }
          : null,
      };
    } else {
      out = await D.scheduleDraft(VIEW, {
        ...args,
        scheduledFor: script.scheduledFor,
        ...('queued' in script ? { queued: script.queued } : {}),
        now: new Date(NOW),
      });
    }
    return { ...out, calls };
  } catch (err) {
    return { $error: { message: err.message, code: err.code ?? null }, calls };
  }
}

// ---- the loader ----------------------------------------------------------------

const PDS = 'https://pds.example';
const blob = (cid, mimeType = 'image/jpeg') => ({
  $type: 'blob',
  ref: { $link: cid },
  mimeType,
  size: 1,
});
const FILE = { $file: true, name: 'f.jpg', type: 'image/jpeg', size: 2 };
const loaderFlows = [
  ['file', { pdsUrl: `${PDS}/` }, { file: FILE }, []],
  [
    'blob',
    { pdsUrl: `${PDS}/` },
    { blob: blob('bafkrei') },
    [{ bytes: [1, 2, 3], type: 'image/png' }],
  ],
  [
    'blob-by-cid',
    { pdsUrl: PDS },
    { blob: { cid: 'bafcid', mimeType: 'image/jpeg' } },
    [{ bytes: [9], type: 'IMAGE/JPEG; q=1' }],
  ],
  ['nothing', { pdsUrl: PDS }, {}, []],
  [
    'refused',
    { pdsUrl: 'https://p' },
    { blob: { ref: { $link: 'x' }, mimeType: 'image/png' } },
    [{ status: 404 }],
  ],
  ['offline', { pdsUrl: PDS }, { blob: blob('b') }, ['offline']],
  ['no-pds', {}, { blob: blob('b') }, []],
  [
    'odd-did-and-cid',
    { pdsUrl: `${PDS}//`, did: 'did:web:a b/c' },
    { blob: blob('f/g h') },
    [{ bytes: [], type: 'image/png' }],
  ],
];

function loaderResponder(answers) {
  return (request, index) => {
    const a = answers[Math.min(index, answers.length - 1)];
    if (a === 'offline') throw new TypeError('fetch failed');
    if (a.status) return json({ error: 'BlobNotFound' }, a.status);
    return { bytes: new Uint8Array(a.bytes), contentType: a.type };
  };
}

export default async function cases() {
  const out = [
    ...(await each('draftMeta', metaInputs, (i) =>
      under(i.tz, i.locale || 'en-US', () => D.draftMeta(i.row, i.now)),
    )),
    ...(await each('editedLabel', editedInputs, (i) =>
      under(i.tz, i.locale || 'en-US', () => D.editedLabel(i.iso, i.now)),
    )),
    ...(await each('draftScheduleBlock', blockInputs, (i) =>
      D.draftScheduleBlock(i.row, { canSchedule: i.can }),
    )),
    // summarizeDraft's rows always carry text; the web throws reading
    // `text.trim()` off a row without it.
    ...(await each(
      'draftPostBlock',
      blockInputs.filter(
        (i) => !i.can || !i.row || typeof i.row.text === 'string',
      ),
      (i) => D.draftPostBlock(i.row, { canPost: i.can }),
    )),
    ...(await each('draftActionMessage', MESSAGES, (i) =>
      D.draftActionMessage(i.err, { action: i.action }),
    )),
  ];
  for (const [id, action, script] of scripts)
    out.push(
      ...(await each(action, [{ $id: id, ...script }], (i) => act(action, i))),
    );
  for (const [id, options, image, answers] of loaderFlows) {
    const output = await recordFetch(loaderResponder(answers), async () => {
      const load = D.blobImageLoader({
        did: options.did ?? DID,
        pdsUrl: options.pdsUrl,
      });
      return toJSON(markFiles((await load(image)) ?? null));
    });
    out.push({
      id,
      fn: 'blobImageLoader',
      input: toJSON({ ...options, image }),
      output,
    });
  }
  return out;
}
