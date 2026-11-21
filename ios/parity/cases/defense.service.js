// src/defense/defenseService.js: Defense's calls to Virga's server, as
// recorded exchanges (_fetch.js) through the real requester
// (backendClient.js createBackendRequester), and defenseErrorMessage word
// for word. Swift: VirgaDefense/DefenseService.swift over VirgaNetwork's
// VirgaBackend.

import {
  chooseLinkList,
  createList,
  defenseErrorMessage,
  fetchHistory,
  fetchLink,
  fetchLists,
  keepAccount,
  makeLinkCode,
  planAndApprove,
  undoAdds,
  unkeepAccount,
  unlinkModerator,
} from '../../../src/defense/defenseService.js';
import { createBackendRequester } from '../../../src/session/backendClient.js';
import { each } from './_helpers.js';
import { inTurn, json, recordFetch } from './_fetch.js';

export const sources = ['src/defense/defenseService.js'];

const SERVER = 'https://server.example';
const TOKEN = `vg_${'0f'.repeat(32)}`;
const DID = 'did:plc:virgaharnessmira2zq4x';

const ok = (data) => json({ success: true, data });

const LISTS = {
  lists: [
    {
      id: 7,
      holderDid: DID,
      mode: 'own',
      uri: `at://${DID}/app.bsky.graph.list/3l`,
      name: 'Pile-on',
      purpose: 'app.bsky.graph.defs#modlist',
      createdAt: '2026-11-01T00:00:00.000Z',
      listed: 12,
      waiting: 3,
      heldUntil: null,
      lastError: null,
    },
  ],
  kept: [
    {
      did: 'did:plc:sister',
      reason: 'my sister',
      addedAt: '2026-11-02T00:00:00.000Z',
    },
  ],
  writes: true,
};

/** What a call threw, as a case records it. */
function thrown(err) {
  return {
    $error: {
      name: err?.name,
      message: err?.message,
      code: err?.code ?? null,
      status: err?.status ?? null,
    },
  };
}

/** `call(req)` through a real requester (or none), recorded. */
function called(answers, call, { noBackend = false } = {}) {
  return recordFetch(inTurn(...answers), async () => {
    const req = noBackend
      ? null
      : createBackendRequester({
          backendUrl: SERVER,
          token: () => TOKEN,
          did: DID,
        });
    try {
      return { value: (await call(req)) ?? null };
    } catch (err) {
      return thrown(err);
    }
  });
}

const calls = {
  fetchLists: (req) => fetchLists(req),
  createList: (req, a) => createList(req, a),
  keepAccount: (req, a) => keepAccount(req, a.did, a.reason),
  unkeepAccount: (req, a) => unkeepAccount(req, a.did),
  planAndApprove: (req, a) => planAndApprove(req, a),
  fetchHistory: (req, a) => fetchHistory(req, a),
  undoAdds: (req, a) => undoAdds(req, a),
  fetchLink: (req) => fetchLink(req),
  makeLinkCode: (req) => makeLinkCode(req),
  unlinkModerator: (req) => unlinkModerator(req),
  chooseLinkList: (req, a) => chooseLinkList(req, a.listId),
};

const ROWS = [
  { did: 'did:plc:a', band: 'UNKNOWN', trust: 3 },
  { did: 'did:plc:b', band: 'NOTABLE', trust: 41 },
];
const TOTALS = {
  participants: 40,
  PROTECTED: 1,
  CONNECTED: 2,
  PERIPHERAL: 3,
  NOTABLE: 4,
  UNKNOWN: 30,
};

const cases = [
  // The account's lists.
  ['fetchLists', 'lists', {}, [ok(LISTS)]],
  ['fetchLists', 'bare-body', {}, [json(LISTS)]],
  ['fetchLists', 'data-null', {}, [json({ success: true, data: null })]],
  ['fetchLists', 'not-json', {}, [{ status: 200, text: '<html>' }]],
  [
    'fetchLists',
    'signed-out',
    {},
    [
      {
        status: 401,
        json: { success: false, code: 'SIGNED_OUT', error: 'Sign in again.' },
      },
    ],
  ],
  [
    'fetchLists',
    'unavailable',
    {},
    [
      {
        status: 503,
        json: {
          success: false,
          code: 'UNAVAILABLE',
          error: 'Defense isn’t set up.',
        },
      },
    ],
  ],
  [
    'fetchLists',
    'refused-in-the-body',
    {},
    [json({ success: false, error: 'nope' })],
  ],
  ['fetchLists', 'offline', {}, ['offline']],
  ['fetchLists', 'no-backend', {}, [], { noBackend: true }],
  // Making a list.
  [
    'createList',
    'made',
    {
      name: 'Pile-on',
      purpose: 'app.bsky.graph.defs#modlist',
      description: 'From a scan',
    },
    [ok({ list: LISTS.lists[0] })],
  ],
  [
    'createList',
    'no-description',
    {
      name: 'Pile-on',
      purpose: 'app.bsky.graph.defs#curatelist',
      description: '',
    },
    [ok({ list: { id: 'l2' } })],
  ],
  ['createList', 'nothing-said', {}, [ok({ list: { id: 'l3' } })]],
  [
    'createList',
    'no-list-in-the-answer',
    { name: 'x', purpose: 'y' },
    [ok({ other: 1 })],
  ],
  [
    'createList',
    'answer-not-json',
    { name: 'x', purpose: 'y' },
    [{ status: 200, text: 'ok' }],
  ],
  [
    'createList',
    'no-scope',
    { name: 'x', purpose: 'y' },
    [
      {
        status: 403,
        json: { success: false, code: 'NO_SCOPE', error: 'No scope.' },
      },
    ],
  ],
  ['createList', 'no-backend', { name: 'x' }, [], { noBackend: true }],
  // Keeping someone by hand.
  [
    'keepAccount',
    'with-a-reason',
    { did: 'did:plc:sister', reason: 'my sister' },
    [ok({ kept: true })],
  ],
  [
    'keepAccount',
    'no-reason',
    { did: 'did:plc:sister', reason: null },
    [ok({ kept: true })],
  ],
  [
    'keepAccount',
    'empty-reason',
    { did: 'did:plc:sister', reason: '' },
    [ok({ kept: true })],
  ],
  ['unkeepAccount', 'unkept', { did: 'did:plc:sister' }, [ok({ removed: 1 })]],
  [
    'unkeepAccount',
    'no-backend',
    { did: 'did:plc:sister' },
    [],
    { noBackend: true },
  ],
  // A plan, then its approval.
  [
    'planAndApprove',
    'planned-and-approved',
    {
      listId: 7,
      postUri: `at://${DID}/app.bsky.feed.post/3p`,
      rows: ROWS,
      totals: TOTALS,
      bands: ['UNKNOWN', 'NOTABLE'],
      note: 'pile-on',
    },
    [ok({ planId: 'p1', rows: 2 }), ok({ queued: 2, kept: 0, already: 0 })],
  ],
  [
    'planAndApprove',
    'no-post-no-note',
    {
      listId: 'l9',
      postUri: null,
      rows: [],
      totals: { participants: 0 },
      bands: [],
      note: null,
    },
    [
      ok({ planId: 12, rows: 0 }),
      ok({ queued: 0, kept: 0, already: 0, planId: 'from-approve' }),
    ],
  ],
  [
    'planAndApprove',
    'plan-without-an-id',
    {
      listId: 7,
      postUri: null,
      rows: ROWS,
      totals: TOTALS,
      bands: ['UNKNOWN'],
      note: null,
    },
    [ok({ rows: 2 }), ok({ queued: 1 })],
  ],
  [
    'planAndApprove',
    'approve-answers-nothing',
    {
      listId: 7,
      postUri: null,
      rows: ROWS,
      totals: TOTALS,
      bands: ['UNKNOWN'],
      note: null,
    },
    [ok({ planId: 'p1' }), { status: 200, text: '' }],
  ],
  [
    'planAndApprove',
    'plan-answers-nothing',
    {
      listId: 7,
      postUri: null,
      rows: ROWS,
      totals: TOTALS,
      bands: ['UNKNOWN'],
      note: null,
    },
    [{ status: 200, text: '' }],
  ],
  [
    'planAndApprove',
    'approve-fails',
    {
      listId: 7,
      postUri: null,
      rows: ROWS,
      totals: TOTALS,
      bands: ['UNKNOWN'],
      note: null,
    },
    [
      ok({ planId: 'p1' }),
      {
        status: 409,
        json: { success: false, code: 'WRITES_OFF', error: 'Writes are off.' },
      },
    ],
  ],
  [
    'planAndApprove',
    'plan-fails',
    {
      listId: 7,
      postUri: null,
      rows: ROWS,
      totals: TOTALS,
      bands: ['UNKNOWN'],
      note: null,
    },
    [
      {
        status: 404,
        json: {
          success: false,
          code: 'NO_LIST',
          error: 'That list isn’t one of yours, or isn’t kept any more.',
        },
      },
    ],
  ],
  // History.
  ['fetchHistory', 'newest', {}, [ok({ decisions: [], plans: [] })]],
  [
    'fetchHistory',
    'before-a-decision',
    { before: 4012 },
    [ok({ decisions: [], plans: [] })],
  ],
  [
    'fetchHistory',
    'before-and-list',
    { before: '4012', list: 'l 7&x' },
    [ok({ decisions: [] })],
  ],
  ['fetchHistory', 'falsy', { before: 0, list: '' }, [ok({ decisions: [] })]],
  // Taking adds back.
  [
    'undoAdds',
    'a-plan',
    { planId: 'p1' },
    [ok({ jobId: 'j1', cancelled: 2, queued: 3 })],
  ],
  [
    'undoAdds',
    'some-decisions',
    { ids: [4, 5], note: 'mistake' },
    [ok({ jobId: 'j2', cancelled: 0, queued: 2 })],
  ],
  [
    'undoAdds',
    'no-ids',
    { planId: null, ids: [], note: '' },
    [ok({ jobId: null })],
  ],
  [
    'undoAdds',
    'nothing',
    {},
    [{ status: 400, json: { success: false, error: 'Say what to undo.' } }],
  ],
  // The moderator.
  [
    'fetchLink',
    'linked',
    {},
    [
      ok({
        moderator: 'did:plc:mod',
        linked: true,
        linkedAt: '2026-11-03T00:00:00.000Z',
        codeExpiresAt: null,
        listId: 7,
      }),
    ],
  ],
  [
    'makeLinkCode',
    'code',
    {},
    [
      ok({
        code: 'ABCD-1234',
        expiresAt: '2026-11-03T00:10:00.000Z',
        moderator: 'did:plc:mod',
      }),
    ],
  ],
  ['unlinkModerator', 'unlinked', {}, [ok({ unlinked: true })]],
  ['chooseLinkList', 'a-list', { listId: 7 }, [ok({ listId: 7 })]],
  ['chooseLinkList', 'the-only-one', { listId: '' }, [ok({ listId: null })]],
  ['chooseLinkList', 'none', { listId: null }, [ok({ listId: null })]],
  ['chooseLinkList', 'no-backend', { listId: 7 }, [], { noBackend: true }],
];

export default async function cases_() {
  const out = [];
  for (const [fn, id, args, answers, options] of cases) {
    out.push({
      id,
      fn,
      input: { args, noBackend: Boolean(options?.noBackend) },
      output: await called(answers, (req) => calls[fn](req, args), options),
    });
  }
  return [
    ...out,
    ...(await each(
      'defenseErrorMessage',
      [
        { error: { code: 'NEEDS_BACKEND', message: 'x' } },
        { error: { code: 'WRITES_OFF' } },
        { error: { code: 'NO_SCOPE' } },
        { error: { code: 'SIGNED_OUT' } },
        { error: { code: 'FRONTEND_SESSION_INVALID' } },
        { error: { code: 'UNAVAILABLE', message: 'ignored' } },
        {
          error: {
            code: 'NO_LIST',
            message: 'That list isn’t one of yours, or isn’t kept any more.',
          },
        },
        {
          error: {
            code: 'needs_backend',
            message: 'lower case is another code',
          },
        },
        {
          error: {
            code: 'NEEDS_BACKEND',
            message: 'a Kelvin sign is another code',
          },
        },
        { error: { code: 5, message: 'a number' } },
        { error: { message: 'Couldn’t reach Virga’s server.' } },
        { error: { message: '' } },
        { error: {} },
        { error: null },
      ],
      ({ error }) => defenseErrorMessage(error),
    )),
  ];
}
