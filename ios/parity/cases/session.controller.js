// The session controller's decisions (src/session/sessionController.js):
// what an account can do from its row and status (capabilitiesFrom), how
// much of Defense a grant covers (holdsDefense, grantedDefenseLevel), and
// what a sign-in asks for: the handle as typed, the prompt it may send, the
// Defense level it keeps or is told, which account was open when it left,
// and for a long session the request to Virga's server (recorded, its nonce
// from a fixed byte pattern) and what is kept for the return. The rest of
// the controller is behaviour, held by SessionControllerTests.swift (a port
// of sessionController.test.js). Swift: VirgaSession/Session/SessionController.swift.

import { Agent } from '@atproto/api';
import {
  DEFENSE_SCOPE,
  DEFENSE_TOKENS,
  LISTS_SCOPE,
  LIST_TOKENS,
  OAUTH_SCOPE,
} from '../../../src/config.js';
import {
  OPEN_AT_SIGNIN_KEY,
  recordSignIn,
  writeActiveDid,
} from '../../../src/session/accounts.js';
import { SIGNIN_PENDING_KEY } from '../../../src/session/backendClient.js';
import {
  NO_ACTIVE,
  capabilitiesFrom,
  createSessionController,
  grantedDefenseLevel,
  holdsDefense,
} from '../../../src/session/sessionController.js';
import { SESSION_HINT_KEY } from '../../../src/lib/sessionHint.js';
import { each, grid, value } from './_helpers.js';
import { inTurn, json, recordFetch } from './_fetch.js';

export const sources = ['src/session/sessionController.js'];

const MIRA = 'did:plc:virgaharnessmira2zq4x';
const LAB = 'did:plc:virgaharnesslab7k2pq';
const SERVER = 'https://server.example';
const ORIGIN = 'https://virga.example';

const SCOPES = [
  undefined,
  '',
  'atproto',
  OAUTH_SCOPE,
  DEFENSE_SCOPE,
  LISTS_SCOPE,
  'atproto repo:app.bsky.graph.follow?action=create&action=delete',
  `atproto ${DEFENSE_TOKENS[0]}`,
  `${OAUTH_SCOPE} ${LIST_TOKENS.join(' ')}`,
  `${DEFENSE_SCOPE} ${LIST_TOKENS[0]}`,
  `  ${OAUTH_SCOPE.split(' ').join('   ')}\n${DEFENSE_TOKENS[0]}\t`,
  'atproto repo:* rpc:*?aud=* blob:*/*',
  'ATPROTO REPO:APP.BSKY.FEED.POST',
  'transition:generic',
  `atproto ${DEFENSE_TOKENS[0].replace('getProfiles', 'getProfile')}`,
  'not a scope at all',
];

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
    map,
  };
}

/** A browser driver that remembers what it was asked. */
function fakeBrowser(sessions) {
  const signIns = [];
  return {
    signIns,
    finishCallback: async () => null,
    legacySession: async () => null,
    restore: async (did) => {
      if (sessions.includes(did))
        return { sub: did, did, fetchHandler: async () => new Response('{}') };
      throw Object.assign(
        new Error('The session was deleted by another process'),
        { restoreFailure: 'expired' },
      );
    },
    signIn: async (input, opts) => {
      signIns.push({ input, options: opts, keys: Object.keys(opts) });
    },
    signOut: async () => {},
    grantedScope: async (s) => (s ? OAUTH_SCOPE : null),
    onDeleted: () => {},
  };
}

const ROWS = {
  // Mira kept Defense, Lab the lists; Third never read its grant.
  remembered: [
    {
      did: MIRA,
      mode: 'browser',
      handle: 'mira.example.com',
      scope: DEFENSE_SCOPE,
      at: 3,
    },
    {
      did: LAB,
      mode: 'backend',
      handle: 'lab.example.org',
      scope: LISTS_SCOPE,
      at: 2,
    },
    {
      did: 'did:plc:virgaharnessthird2kq',
      mode: 'browser',
      handle: 'third.example.net',
      at: 1,
    },
  ],
  // Lab once had the handle Mira has now, and still says so here.
  shared: [
    {
      did: LAB,
      mode: 'browser',
      handle: 'shared.example',
      scope: DEFENSE_SCOPE,
      at: 3,
    },
    {
      did: MIRA,
      mode: 'browser',
      handle: 'shared.example',
      scope: OAUTH_SCOPE,
      at: 2,
    },
  ],
  // A handle in another script, and one with a capital the row kept.
  unicode: [
    {
      did: MIRA,
      mode: 'browser',
      handle: 'ΟΔΟΣ.example',
      scope: DEFENSE_SCOPE,
      at: 2,
    },
    {
      did: LAB,
      mode: 'browser',
      handle: 'café.example',
      scope: LISTS_SCOPE,
      at: 1,
    },
  ],
};

const SIGN_INS = [
  {
    $id: 'backend-add',
    input: '@mira.example.com',
    options: { mode: 'backend', intent: 'add' },
  },
  {
    $id: 'browser-reauth',
    input: 'mira.example.com',
    options: { mode: 'browser', intent: 'reauth' },
  },
  {
    $id: 'one-at-only',
    input: ' @@Mira.Example.com ',
    options: { mode: 'browser' },
  },
  {
    $id: 'no-break-space',
    input: ' ﻿mira.example.com ',
    options: { mode: 'backend' },
  },
  {
    $id: 'full-width-at',
    input: '＠mira.example.com',
    options: { mode: 'browser' },
  },
  { $id: 'empty', input: '', options: { mode: 'browser' } },
  { $id: 'nothing', input: null, options: { mode: 'browser' } },
  { $id: 'mode-unsaid', input: 'mira.example.com', options: {} },
  { $id: 'no-options', input: 'mira.example.com' },
  {
    $id: 'create-backend',
    input: 'https://eurosky.social',
    options: { mode: 'backend', prompt: 'create' },
  },
  {
    $id: 'create-browser',
    input: 'https://eurosky.social',
    options: { mode: 'browser', prompt: 'create' },
  },
  ...['none', 'login', 'consent', 'select_account', 'CREATE', ''].map(
    (prompt) => ({
      $id: `prompt-${prompt || 'empty'}`,
      input: 'mira.example.com',
      options: { mode: 'browser', prompt },
    }),
  ),
  {
    $id: 'prompt-login-backend',
    input: 'mira.example.com',
    options: { mode: 'backend', prompt: 'login' },
  },
  ...[true, false, 'scan', 'lists', 'LISTS', 'junk', 1, null].flatMap(
    (defense) =>
      ['browser', 'backend'].map((mode) => ({
        $id: `defense-${String(defense)}-${mode}`,
        input: 'mira.example.com',
        options: { mode, intent: 'reauth', defense },
      })),
  ),
  // What a remembered account keeps.
  ...[
    ['Mira.Example.com', {}],
    [MIRA, {}],
    ['lab.example.org', {}],
    ['@lab.example.org', {}],
    [LAB.toUpperCase(), {}],
    ['third.example.net', {}],
    ['someone.else.example', {}],
    [MIRA, { defense: false }],
    [MIRA, { defense: 'lists' }],
    ['lab.example.org', { defense: 'scan' }],
    ['anything', { did: LAB }],
    ['mira.example.com', { did: 'did:plc:notremembered' }],
    ['mira.example.com', { did: '' }],
  ].flatMap(([input, extra], i) =>
    ['browser', 'backend'].map((mode) => ({
      $id: `remembered-${i}-${mode}`,
      rows: ROWS.remembered,
      input,
      options: { mode, intent: 'reauth', ...extra },
    })),
  ),
  ...[
    ['shared.example', { did: MIRA }],
    ['shared.example', { did: LAB }],
    ['shared.example', {}],
    ['SHARED.example', {}],
  ].map(([input, extra], i) => ({
    $id: `shared-${i}`,
    rows: ROWS.shared,
    input,
    options: { mode: 'browser', intent: 'reauth', ...extra },
  })),
  ...[
    'οδος.example',
    'ΟΔΟΣ.EXAMPLE',
    'café.example',
    'café.example',
    'CAFÉ.example',
  ].map((input, i) => ({
    $id: `unicode-${i}`,
    rows: ROWS.unicode,
    input,
    options: { mode: 'browser', intent: 'reauth' },
  })),
  // Which account was open when a sign-in again left.
  {
    $id: 'reauth-open',
    open: MIRA,
    input: 'lab.example.org',
    options: { mode: 'browser', intent: 'reauth' },
  },
  {
    $id: 'add-open',
    open: MIRA,
    input: 'lab.example.org',
    options: { mode: 'browser', intent: 'add' },
  },
  {
    $id: 'reauth-open-backend',
    open: MIRA,
    input: 'lab.example.org',
    options: { mode: 'backend', intent: 'reauth' },
  },
  {
    $id: 'other-intent-open',
    open: MIRA,
    input: 'lab.example.org',
    options: { mode: 'browser', intent: 'switch' },
  },
  // A long session the server won't start.
  {
    $id: 'server-refuses',
    input: 'nobody.example',
    options: { mode: 'backend' },
    answer: json(
      {
        success: false,
        code: 'HANDLE_NOT_FOUND',
        error: 'Could not resolve handle',
      },
      400,
    ),
  },
  {
    $id: 'server-offline',
    input: 'mira.example.com',
    options: { mode: 'backend' },
    answer: 'offline',
  },
];

async function signInCase({ rows = [], open = null, input, options, answer }) {
  const storage = memoryStorage();
  const tabStorage = memoryStorage({
    [OPEN_AT_SIGNIN_KEY]: 'did:plc:stalestale',
  });
  for (const row of rows) recordSignIn(storage, row, row.at);
  const sessions = [];
  if (open) {
    recordSignIn(storage, { did: open, mode: 'browser' }, 9);
    writeActiveDid(storage, open);
    sessions.push(open);
  }
  const browser = fakeBrowser(sessions);
  let assigned = null;
  let settle = () => {};
  const env = {
    storage,
    tabStorage,
    browser,
    backendUrl: SERVER,
    fetch: undefined,
    loadAgent: async () => Agent,
    backendReturn: null,
    onCallbackPath: false,
    authMode: 'backend',
    getProfile: async () => null,
    resolvePdsUrl: async () => 'https://pds.example',
    rememberPdsUrl: () => {},
    resetAnalyticsStore: () => {},
    deleteDatabase: async () => true,
    dispatch: () => {},
    origin: () => ORIGIN,
    assign: (url) => {
      assigned = url;
      settle({});
    },
    sleep: async () => {},
  };
  const state = { active: NO_ACTIVE };
  const set = {
    rows: () => {},
    statuses: () => {},
    active: (v) => (state.active = v),
    switching: () => {},
    error: () => {},
  };
  const realRandom = globalThis.crypto.getRandomValues;
  globalThis.crypto.getRandomValues = (bytes) => {
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 37 + 11) & 0xff;
    return bytes;
  };
  try {
    const recorded = await recordFetch(
      inTurn(
        answer ??
          json({
            success: true,
            authUrl: 'https://bsky.social/oauth/authorize?request_uri=x',
          }),
      ),
      async () => {
        const ctrl = createSessionController(set, env);
        if (open) await ctrl.startOnce();
        // A browser sign-in resolves once the driver is asked; a long
        // session's never does once it has handed the address on.
        const outcome = await new Promise((resolve) => {
          settle = resolve;
          ctrl.signIn(input, options).then(
            () => resolve({}),
            (error) =>
              resolve({
                error: {
                  name: error.name,
                  message: error.message,
                  code: error.code ?? null,
                  status: error.status ?? null,
                },
              }),
          );
        });
        const pending = tabStorage.getItem(SIGNIN_PENDING_KEY);
        return {
          ...outcome,
          browser: browser.signIns,
          assigned,
          pending: pending == null ? null : JSON.parse(pending),
          openAtSignIn: tabStorage.getItem(OPEN_AT_SIGNIN_KEY),
          hint: storage.getItem(SESSION_HINT_KEY),
          openBefore: state.active.did,
        };
      },
    );
    return recorded;
  } finally {
    globalThis.crypto.getRandomValues = realRandom;
  }
}

export default async function cases() {
  return [
    value('NO_ACTIVE', NO_ACTIVE),
    ...(await each(
      'capabilitiesFrom',
      grid({
        mode: ['backend', 'browser'],
        scope: SCOPES,
        status: ['ready', 'unknown', 'needsSignIn', undefined],
      })
        .map(({ mode, scope, status }) => ({
          row: { did: MIRA, mode, ...(scope === undefined ? {} : { scope }) },
          status,
        }))
        .concat(
          ['ready', 'needsSignIn', undefined].map((status) => ({
            row: null,
            status,
          })),
        )
        // Rows as nothing writes them (readAccounts cleans the mode), held
        // all the same: an empty or unknown mode, none, a scope that isn't
        // a string.
        .concat(
          [
            { did: MIRA, mode: '' },
            { did: MIRA, mode: 'other', scope: OAUTH_SCOPE },
            { did: MIRA, mode: 'BACKEND', scope: LISTS_SCOPE },
            { did: MIRA },
            { did: MIRA, mode: 'backend', scope: 42 },
            { did: MIRA, mode: 'backend', scope: null },
          ].flatMap((row) =>
            ['ready', 'needsSignIn'].map((status) => ({ row, status })),
          ),
        ),
      ({ row, status }) => capabilitiesFrom(row, status),
    )),
    ...(await each(
      'grantedDefenseLevel',
      [...SCOPES, null, 42, ['atproto', DEFENSE_TOKENS[0]]].map((granted) => ({
        granted,
      })),
      ({ granted }) => ({
        holdsDefense: holdsDefense(granted),
        grantedDefenseLevel: grantedDefenseLevel(granted),
      }),
    )),
    ...(await each('signIn', SIGN_INS, signInCase)),
  ];
}
