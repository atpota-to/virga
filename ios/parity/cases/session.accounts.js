// The accounts this device remembers, which one is open, a long session's
// token, how an account is named, and what it keeps here (accounts.js); the
// words the account screens use (accountCopy.js); the "a session may exist"
// hint (sessionHint.js); and the count of work a sign-out would stop
// (pendingWork.js). Swift: VirgaSession/Session/Accounts.swift,
// Accounts/AccountCopy.swift, Lib/SessionHint.swift, Accounts/PendingWork.swift.
//
// The list's operations run as scripts over one storage, each step recording
// what it returned and everything stored after it, so the Swift port is held
// to the same rows, in the same order, written the same way. The web keeps
// the token in localStorage; the app keeps it in its secret store under the
// same key, and the Swift test reads both stores as one.

import {
  ACCOUNTS_KEY,
  ACTIVE_KEY,
  MODES,
  OPEN_AT_SIGNIN_KEY,
  REAUTH_REQUIRED_CODE,
  SESSION_EXPIRED_EVENT,
  accountHandle,
  accountName,
  accountSignInId,
  backendTokenKey,
  findAccount,
  forgetAccount,
  isBackendToken,
  isDid,
  isReauthRequiredError,
  lastOpenedLabel,
  localDataKeys,
  localDatabases,
  makeReauthRequiredError,
  markSignedOut,
  needsRefresh,
  nextReadyAccount,
  pickActiveAccount,
  readAccounts,
  readActiveDid,
  readBackendToken,
  reauthNoticeLabel,
  recordSignIn,
  removeBackendToken,
  removeLocalData,
  shortDid,
  signedInAccounts,
  takeOpenAtSignIn,
  touchAccount,
  updateAccount,
  writeAccounts,
  writeActiveDid,
  writeBackendToken,
  writeOpenAtSignIn,
} from '../../../src/session/accounts.js';
import {
  POSTING_REGRANT_MESSAGE,
  REAUTH_REQUEST_EVENT,
  SESSION_NOTICE_EVENT,
  modeLabel,
  offersLongerSession,
  pendingWorkWarning,
  reauthModeFor,
  statusLabel,
} from '../../../src/accounts/accountCopy.js';
import {
  countPendingWork,
  hasPendingWork,
} from '../../../src/accounts/pendingWork.js';
import {
  SESSION_HINT_KEY,
  readSessionHint,
  restoresAtStartup,
  syncSessionHint,
} from '../../../src/lib/sessionHint.js';
import { isActiveScheduledRow } from '../../../src/posting/schedule/scheduleService.js';
import { isLiveTimer } from '../../../src/posting/timers/timerService.js';
import {
  DAY,
  FIXED_NOW,
  ZONES,
  each,
  grid,
  inZone,
  value,
} from './_helpers.js';

export const sources = [
  'src/session/accounts.js',
  'src/accounts/accountCopy.js',
  'src/lib/sessionHint.js',
  'src/accounts/pendingWork.js',
];

const MIRA = 'did:plc:virgaharnessmira2zq4x';
const LAB = 'did:plc:virgaharnesslab7k2pq';
const THIRD = 'did:plc:virgaharnessthird2kq';
const LONG = 'did:web:a-rather-long-host-name.example.com';
const TOKEN = `vg_${'a1'.repeat(32)}`;
const TOKEN2 = `vg_${'cd'.repeat(32)}`;

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

const sorted = (map) =>
  Object.fromEntries(
    [...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );

// What readAccounts may find stored.
const STORED_LISTS = [
  null,
  '',
  '{oops',
  'null',
  '{"did":"x"}',
  '"[]"',
  '[]',
  JSON.stringify([
    { did: MIRA, lastUsed: 1, mode: 'browser' },
    null,
    { handle: 'nobody' },
    { did: 'not-a-did', lastUsed: 9 },
    { did: LAB, lastUsed: 5, mode: 'backend' },
    { did: MIRA, lastUsed: 99 },
  ]),
  JSON.stringify([{ did: MIRA, mode: 'pigeon' }]),
  JSON.stringify([
    {
      did: MIRA,
      handle: '  mira.example.com  ',
      displayName: '   ',
      avatar: 7,
      mode: 'backend',
      lastUsed: '5',
      addedAt: 3,
      signedOut: 'yes',
      scope: '',
      extra: true,
    },
    {
      did: LAB,
      handle: '',
      displayName: 'Lab',
      lastUsed: 5,
      signedOut: true,
      scope: null,
    },
    { did: THIRD, lastUsed: 5, addedAt: null, scope: 'atproto' },
    { did: 'did:web:example.com', lastUsed: -1e300, addedAt: 1e300 },
    { did: 'did:plc:', lastUsed: 1 },
    { did: 'DID:plc:x', lastUsed: 1 },
    'did:plc:stringrow',
    7,
    [MIRA],
  ]),
  JSON.stringify([
    { did: MIRA, lastUsed: 3 },
    { did: LAB, lastUsed: 3 },
    { did: THIRD, lastUsed: 3 },
    { did: 'did:plc:fourth', lastUsed: 4 },
  ]),
  JSON.stringify([{ did: 'did:plc:café', lastUsed: 1 }]),
];

// Steps a script may take, each run against the same storage.
function step(storage, op) {
  switch (op.op) {
    case 'recordSignIn': {
      const { did, mode, handle, displayName, avatar, now } = op;
      const fields = { did, mode, handle, displayName, avatar };
      if ('scope' in op) fields.scope = op.scope;
      return recordSignIn(storage, fields, now);
    }
    case 'updateAccount':
      return updateAccount(storage, op.did, op.fields);
    case 'touchAccount':
      return touchAccount(storage, op.did, op.now);
    case 'markSignedOut':
      return markSignedOut(storage, op.did);
    case 'forgetAccount':
      return forgetAccount(storage, op.did);
    case 'writeAccounts':
      return writeAccounts(storage, op.list);
    case 'writeActiveDid':
      return writeActiveDid(storage, op.did) ?? null;
    case 'readActiveDid':
      return readActiveDid(storage);
    case 'writeBackendToken':
      return writeBackendToken(storage, op.did, op.token);
    case 'readBackendToken':
      return readBackendToken(storage, op.did);
    case 'removeBackendToken':
      return removeBackendToken(storage, op.did) ?? null;
    case 'writeOpenAtSignIn':
      return writeOpenAtSignIn(storage, op.did) ?? null;
    case 'takeOpenAtSignIn':
      return takeOpenAtSignIn(storage);
    case 'removeLocalData':
      return [...removeLocalData(storage, op.did)].sort();
    default:
      throw new Error(`no step ${op.op}`);
  }
}

const SCRIPTS = [
  {
    $id: 'sign-in-out-and-back',
    ops: [
      {
        op: 'recordSignIn',
        did: MIRA,
        mode: 'browser',
        handle: 'mira.example.com',
        now: 1000,
      },
      { op: 'recordSignIn', did: LAB, mode: 'backend', now: 2000 },
      { op: 'markSignedOut', did: MIRA },
      { op: 'recordSignIn', did: MIRA, mode: 'backend', now: 3000 },
      {
        op: 'recordSignIn',
        did: LAB,
        mode: 'backend',
        handle: '',
        displayName: 'Lab',
        avatar: 'https://cdn.example/a.jpg',
        now: 4000,
      },
      {
        op: 'recordSignIn',
        did: LAB,
        mode: 'backend',
        handle: 'lab.example.org',
        displayName: '',
        now: 5000,
      },
    ],
  },
  {
    $id: 'scope',
    ops: [
      {
        op: 'recordSignIn',
        did: MIRA,
        mode: 'browser',
        scope: 'atproto',
        now: 1,
      },
      { op: 'recordSignIn', did: MIRA, mode: 'browser', now: 2 },
      { op: 'recordSignIn', did: MIRA, mode: 'backend', now: 3 },
      {
        op: 'recordSignIn',
        did: MIRA,
        mode: 'backend',
        scope: 'atproto repo:*',
        now: 4,
      },
      { op: 'recordSignIn', did: MIRA, mode: 'backend', scope: null, now: 5 },
      { op: 'recordSignIn', did: MIRA, mode: 'backend', scope: '', now: 6 },
      { op: 'recordSignIn', did: MIRA, mode: 'browser', now: 7 },
    ],
  },
  {
    $id: 'odd-sign-ins',
    ops: [
      { op: 'recordSignIn', did: 'not-a-did', mode: 'browser', now: 1 },
      {
        op: 'recordSignIn',
        did: MIRA,
        mode: 'pigeon',
        handle: '  spaced.example  ',
        now: 2,
      },
      { op: 'recordSignIn', did: MIRA, mode: 'browser', now: 0 },
      { op: 'recordSignIn', did: LAB, mode: 'backend', now: 0 },
      { op: 'recordSignIn', did: THIRD, mode: 'backend', now: 1.5 },
    ],
  },
  {
    $id: 'update',
    ops: [
      { op: 'recordSignIn', did: MIRA, mode: 'browser', now: 1 },
      { op: 'recordSignIn', did: LAB, mode: 'browser', now: 2 },
      {
        op: 'updateAccount',
        did: MIRA,
        fields: { displayName: 'Mira Okafor', did: 'did:plc:smuggled' },
      },
      { op: 'updateAccount', did: 'did:plc:absent', fields: { handle: 'x' } },
      {
        op: 'updateAccount',
        did: LAB,
        fields: { handle: '  lab.example.org ', avatar: '', displayName: null },
      },
      {
        op: 'updateAccount',
        did: LAB,
        fields: { scope: 'atproto', signedOut: false, mode: 'backend' },
      },
      {
        op: 'updateAccount',
        did: LAB,
        fields: { scope: null, mode: 'pigeon' },
      },
      { op: 'touchAccount', did: MIRA, now: 50 },
      { op: 'touchAccount', did: 'did:plc:absent', now: 60 },
      { op: 'markSignedOut', did: MIRA },
      { op: 'markSignedOut', did: MIRA },
    ],
  },
  {
    $id: 'forget',
    ops: [
      { op: 'recordSignIn', did: MIRA, mode: 'backend', now: 1 },
      { op: 'writeBackendToken', did: MIRA, token: TOKEN },
      { op: 'writeActiveDid', did: MIRA },
      { op: 'forgetAccount', did: MIRA },
      { op: 'readActiveDid' },
      { op: 'recordSignIn', did: LAB, mode: 'browser', now: 2 },
      { op: 'recordSignIn', did: MIRA, mode: 'browser', now: 3 },
      { op: 'writeActiveDid', did: LAB },
      { op: 'forgetAccount', did: MIRA },
      { op: 'readActiveDid' },
      { op: 'forgetAccount', did: 'did:plc:absent' },
    ],
  },
  {
    $id: 'write-accounts',
    ops: [
      {
        op: 'writeAccounts',
        list: [
          { did: MIRA, lastUsed: 1 },
          {
            did: LAB,
            lastUsed: 2,
            handle: ' x ',
            signedOut: true,
            scope: 'atproto',
          },
          { did: MIRA, lastUsed: 3 },
          { did: 'nope' },
        ],
      },
      { op: 'writeAccounts', list: [] },
    ],
  },
  {
    $id: 'active',
    ops: [
      { op: 'readActiveDid' },
      { op: 'writeActiveDid', did: MIRA },
      { op: 'readActiveDid' },
      { op: 'writeActiveDid', did: 'mira.example.com' },
      { op: 'readActiveDid' },
      { op: 'writeActiveDid', did: LAB },
      { op: 'writeActiveDid', did: null },
      { op: 'readActiveDid' },
    ],
  },
  {
    $id: 'open-at-sign-in',
    ops: [
      { op: 'writeOpenAtSignIn', did: MIRA },
      { op: 'takeOpenAtSignIn' },
      { op: 'takeOpenAtSignIn' },
      { op: 'writeOpenAtSignIn', did: 'nobody' },
      { op: 'takeOpenAtSignIn' },
      { op: 'writeOpenAtSignIn', did: LAB },
      { op: 'writeOpenAtSignIn', did: null },
      { op: 'takeOpenAtSignIn' },
    ],
  },
  {
    $id: 'tokens',
    ops: [
      { op: 'writeBackendToken', did: MIRA, token: TOKEN },
      { op: 'writeBackendToken', did: LAB, token: 'deadbeef' },
      { op: 'writeBackendToken', did: 'nobody', token: TOKEN },
      { op: 'writeBackendToken', did: LAB, token: TOKEN.toUpperCase() },
      { op: 'writeBackendToken', did: LAB, token: `${TOKEN}0` },
      { op: 'readBackendToken', did: MIRA },
      { op: 'readBackendToken', did: LAB },
      { op: 'writeBackendToken', did: MIRA, token: TOKEN2 },
      { op: 'readBackendToken', did: MIRA },
      { op: 'removeBackendToken', did: MIRA },
      { op: 'readBackendToken', did: MIRA },
    ],
  },
  {
    $id: 'local-data',
    stored: {
      [`virga:keep:followback:${MIRA}`]: '[]',
      [`virga:keep:cleanup:${MIRA}`]: '[]',
      [`virga:keep:cleanup:${LAB}`]: '[]',
      [`virga:keep:${MIRA}`]: '[]',
      [`virga:dashboards:${MIRA}`]: '[]',
      [`virga:dashboards:${LAB}`]: '[]',
      [`virga:terms-accepted:${MIRA}`]: '{}',
      [`virga:backend-token:${MIRA}`]: TOKEN,
      'virga:preferences': '{}',
      'virga:posting-device': 'x',
      [`other:keep:${MIRA}`]: 'x',
    },
    ops: [
      { op: 'removeLocalData', did: MIRA },
      { op: 'removeLocalData', did: 'nope' },
      { op: 'removeLocalData', did: LAB },
    ],
  },
];

const LISTS = [
  [],
  [
    { did: LAB, lastUsed: 3, signedOut: true },
    { did: MIRA, lastUsed: 2 },
    { did: THIRD, lastUsed: 1 },
  ],
  [{ did: LAB, signedOut: true }],
  [{ did: MIRA }, { did: LAB }, { did: THIRD }],
  [{ did: MIRA }],
];

const NAMED = [
  null,
  { did: MIRA, handle: 'mira.example.com', displayName: MIRA },
  {
    did: MIRA,
    handle: 'mira.example.com',
    displayName: 'Mira Okafor',
    avatar: 'https://x',
  },
  { did: MIRA, handle: MIRA },
  { did: MIRA, handle: MIRA, displayName: 'Mira', avatar: 'https://x' },
  { did: MIRA, handle: null },
  { did: MIRA, handle: '', displayName: '' },
  { did: MIRA },
  { did: '', handle: '' },
  { did: LONG, handle: 'a.example.com' },
  { did: 'did:plc:exactly24charsxxxx', handle: 'did:plc:also' },
  { did: 'did:plc:😀😀😀😀😀😀😀😀', displayName: 'did:x:y' },
];

export default async function cases() {
  const now = new Date(2026, 10, 12, 21, 0).getTime();
  return [
    value('ACCOUNTS_KEY', ACCOUNTS_KEY),
    value('ACTIVE_KEY', ACTIVE_KEY),
    value('MODES', MODES),
    value('SESSION_EXPIRED_EVENT', SESSION_EXPIRED_EVENT),
    value('OPEN_AT_SIGNIN_KEY', OPEN_AT_SIGNIN_KEY),
    value('REAUTH_REQUIRED_CODE', REAUTH_REQUIRED_CODE),
    value('backendTokenKey', backendTokenKey(MIRA)),
    value('REAUTH_REQUEST_EVENT', REAUTH_REQUEST_EVENT),
    value('SESSION_NOTICE_EVENT', SESSION_NOTICE_EVENT),
    value('POSTING_REGRANT_MESSAGE', POSTING_REGRANT_MESSAGE),
    value('SESSION_HINT_KEY', SESSION_HINT_KEY),

    ...(await each(
      'isDid',
      [
        MIRA,
        'did:web:example.com',
        'did:plc:',
        'did::x',
        'DID:plc:x',
        'did:plc:a b',
        'did:plc:x#y',
        '',
        null,
        5,
      ].map((v) => ({ value: v })),
      ({ value: v }) => isDid(v),
    )),

    ...(await each(
      'readAccounts',
      STORED_LISTS.map((stored) => ({ stored })),
      ({ stored }) =>
        readAccounts(
          memoryStorage(stored === null ? {} : { [ACCOUNTS_KEY]: stored }),
        ),
    )),

    ...(await each('script', SCRIPTS, ({ stored = {}, ops }) => {
      const storage = memoryStorage(stored);
      return ops.map((op) => ({
        result: step(storage, op) ?? null,
        stored: sorted(storage.map),
      }));
    })),

    ...(await each(
      'findAccount',
      [
        { list: LISTS[1], did: MIRA },
        { list: LISTS[1], did: 'did:plc:absent' },
        { list: null, did: MIRA },
        { list: LISTS[1], did: null },
      ],
      ({ list, did }) => findAccount(list, did),
    )),

    ...(await each(
      'signedInAccounts',
      LISTS.map((list) => ({ list })),
      ({ list }) => signedInAccounts(list),
    )),

    ...(await each(
      'pickActiveAccount',
      LISTS.flatMap((list) =>
        [THIRD, LAB, MIRA, null].map((activeDid) => ({ list, activeDid })),
      ),
      ({ list, activeDid }) => pickActiveAccount(list, activeDid),
    )),

    ...(await each(
      'nextReadyAccount',
      LISTS.flatMap((list) =>
        [MIRA, LAB].flatMap((did) =>
          [null, LAB].map((needsSignIn) => ({ list, did, needsSignIn })),
        ),
      ),
      ({ list, did, needsSignIn }) =>
        nextReadyAccount(
          list,
          did,
          needsSignIn
            ? (d) => (d === needsSignIn ? 'needsSignIn' : 'ready')
            : undefined,
        ),
    )),

    ...(await each(
      'naming',
      NAMED.map((account) => ({ account })),
      ({ account }) => ({
        accountName: accountName(account),
        accountHandle: accountHandle(account),
        accountSignInId: accountSignInId(account),
        needsRefresh: needsRefresh(account),
        reauthNoticeLabel: reauthNoticeLabel(account),
      }),
    )),

    ...(await each(
      'shortDid',
      [
        MIRA,
        LONG,
        '',
        null,
        'did:plc:exactly24charsxx',
        'did:plc:exactly25charsxxx',
        'did:plc:😀😀😀😀😀😀😀😀',
      ].map((did) => ({
        did,
      })),
      ({ did }) => shortDid(did),
    )),

    // By calendar day in the zone, across each zone's clock changes.
    ...(await each(
      'lastOpenedLabel',
      [
        ...ZONES.flatMap((zone) =>
          [
            [0, 8],
            [0, 0],
            [1, 23],
            [1, 0],
            [3, 12],
            [6, 12],
            [7, 12],
            [8, 12],
            [21, 12],
            [24, 12],
            [29, 12],
            [30, 12],
            [40, 12],
            [44, 12],
            [46, 12],
            [364, 12],
            [365, 12],
            [400, 12],
            [-2, 12],
          ].map(([daysAgo, hour]) => ({ zone, daysAgo, hour })),
        ),
      ],
      ({ zone, daysAgo, hour }) =>
        inZone(zone, () => {
          const at = new Date(2026, 10, 12 - daysAgo, hour).getTime();
          const nowHere = new Date(2026, 10, 12, 21, 0).getTime();
          return {
            lastUsed: at,
            now: nowHere,
            label: lastOpenedLabel(at, nowHere),
          };
        }),
    )),
    ...(await each(
      'lastOpenedLabel',
      [
        { $id: 'nothing', lastUsed: null },
        { $id: 'zero', lastUsed: 0 },
        { $id: 'nan', lastUsed: 'NaN' },
        { $id: 'march', lastUsed: FIXED_NOW - 3 * DAY, now: FIXED_NOW },
        {
          $id: 'dst-spring',
          lastUsed: Date.UTC(2026, 2, 7, 12),
          now: Date.UTC(2026, 2, 9, 4),
        },
      ],
      ({ lastUsed, now: at = now }) =>
        ZONES.map((zone) =>
          inZone(zone, () => ({
            zone,
            lastUsed: lastUsed === 'NaN' ? null : lastUsed,
            now: at,
            label: lastOpenedLabel(
              lastUsed === 'NaN' ? Number.NaN : (lastUsed ?? undefined),
              at,
            ),
          })),
        ),
    )),

    ...(await each(
      'isReauthRequiredError',
      [
        {
          error: {
            code: 'REAUTH_REQUIRED',
            message: 'This account needs to sign in again.',
          },
        },
        { error: { message: 'REAUTH_REQUIRED' } },
        { error: { code: 'reauth_required' } },
        { error: null },
      ],
      ({ error }) =>
        isReauthRequiredError(
          error && Object.assign(new Error(error.message || ''), error),
        ),
    )),
    value(
      'makeReauthRequiredError',
      (() => {
        const error = makeReauthRequiredError(MIRA);
        return {
          message: error.message,
          code: error.code,
          did: error.did,
          isReauth: isReauthRequiredError(error),
        };
      })(),
    ),

    ...(await each(
      'localDatabases',
      [MIRA, 'nope', ''].map((did) => ({ did })),
      ({ did }) => localDatabases(did),
    )),
    ...(await each(
      'localDataKeys',
      [MIRA, LAB, 'nope'].map((did) => ({ did })),
      ({ did }) => {
        const storage = memoryStorage({
          [`virga:keep:followback:${MIRA}`]: '[]',
          [`virga:keep:cleanup:${MIRA}`]: '[]',
          [`virga:keep:cleanup:${LAB}`]: '[]',
          'virga:preferences': '{}',
          'virga:posting-device': 'x',
          [`virga:keep:x:${MIRA}:${LAB}`]: '[]',
        });
        return localDataKeys(storage, did);
      },
    )),

    // accountCopy.js
    ...(await each(
      'modeLabel',
      ['backend', 'browser', null, 'pigeon'].map((mode) => ({ mode })),
      ({ mode }) => modeLabel(mode),
    )),
    ...(await each(
      'statusLabel',
      grid({
        status: ['ready', 'needsSignIn', 'unknown', null],
        active: [false, true],
        switching: [false, true],
      }),
      ({ status, active, switching }) =>
        statusLabel(status, { active, switching }),
    )),
    ...(await each(
      'reauthModeFor',
      grid({
        mode: ['backend', 'browser', null],
        authMode: ['backend', 'browser'],
      }),
      ({ mode, authMode }) => ({
        reauthModeFor: reauthModeFor(mode ? { mode } : null, authMode),
        offersLongerSession: offersLongerSession(
          mode ? { mode } : null,
          authMode,
        ),
      }),
    )),
    ...(await each(
      'pendingWorkWarning',
      [
        { posts: 3, timers: 1 },
        { posts: 1, timers: 0 },
        { posts: 0, timers: 2 },
        { posts: 1, timers: 1 },
        { posts: 2, timers: 3 },
        { posts: 0, timers: 0 },
        null,
      ].flatMap((work) =>
        ['Mira', '@mira.example.com'].map((name) => ({ name, work })),
      ),
      ({ name, work }) => pendingWorkWarning(name, work),
    )),

    // sessionHint.js
    ...(await each(
      'readSessionHint',
      ['1', 'yes', '', 'true', null].map((stored) => ({ stored })),
      ({ stored }) =>
        readSessionHint(
          memoryStorage(stored === null ? {} : { [SESSION_HINT_KEY]: stored }),
        ),
    )),
    ...(await each(
      'syncSessionHint',
      [
        [{ did: 'did:plc:a', signedOut: true }, { did: 'did:plc:b' }],
        [{ did: 'did:plc:a', signedOut: true }],
        [],
        null,
      ].flatMap((accounts) =>
        [true, false].map((hinted) => ({ accounts, hinted })),
      ),
      ({ accounts, hinted }) => {
        const storage = memoryStorage(
          hinted ? { [SESSION_HINT_KEY]: '1' } : {},
        );
        syncSessionHint(storage, accounts);
        return readSessionHint(storage);
      },
    )),
    ...(await each(
      'restoresAtStartup',
      grid({
        hint: [false, true],
        onCallback: [false, true],
        onReturn: [false, true],
        hasAccounts: [false, true],
      }),
      (input) => restoresAtStartup(input),
    )),

    // pendingWork.js, with the posting services' own predicates.
    ...(await each(
      'countPendingWork',
      [
        {
          scheduled: [
            { id: 1, status: 'pending', clientKey: 'virga' },
            { id: 2, status: 'publishing', clientKey: 'virga' },
            { id: 3, status: 'failed', clientKey: 'virga' },
            { id: 4, status: 'published', clientKey: 'virga' },
            { id: 5, status: 'pending' },
            null,
            {},
          ],
          timers: [
            { id: 1, status: 'armed' },
            { id: 2, status: 'checking' },
            { id: 3, status: 'deleted' },
            { id: 4, status: 'failed' },
            null,
          ],
        },
        { scheduled: [], timers: [] },
        { scheduled: null, timers: null },
        {},
      ],
      (input) => countPendingWork(input, { isActiveScheduledRow, isLiveTimer }),
    )),
    ...(await each(
      'hasPendingWork',
      [
        { posts: 0, timers: 0 },
        { posts: 1, timers: 0 },
        { posts: 0, timers: 2 },
        null,
      ].map((work) => ({ work })),
      ({ work }) => hasPendingWork(work),
    )),
    value('hasPendingWork:undefined', hasPendingWork(undefined) ?? null),
    value(
      'isBackendToken',
      [TOKEN, TOKEN.toUpperCase(), `${TOKEN}0`, 'vg_', '', null].map(
        isBackendToken,
      ),
    ),
  ];
}
