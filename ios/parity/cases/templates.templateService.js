// src/posting/templates/templateService.js over the network: scripts of
// loads, writes, primes and resets against a template service whose
// accounts' agents are @atproto/api Agents sending every call through
// Virga's server (createBackendFetchHandler, as the app signs in). Each
// script records every request and its answer, what each call returned or
// threw (with `fieldErrors` and `permission`), what the subscribers and the
// virga:templates-changed listeners heard, and the cache left behind.
// Swift: VirgaPosting/Templates/TemplateService.swift, with XRPCAgent and
// BackendFetchHandler over MockTransport.
//
// Inputs from templateService.test.js, every case that runs one call after
// another (the races, which need a load held open, are behaviour tests on
// the Swift side), with answers the SDK's lexicon check accepts: paging and
// a repeated cursor, other accounts, a failed read over a cache, refused
// permissions, records already gone, validation and the lexicon's limits,
// record keys of every shape, and resets.

import { Agent } from '@atproto/api';
import { createBackendFetchHandler } from '../../../src/session/backendClient.js';
import {
  TEMPLATE_PERMISSION_MESSAGE,
  createTemplateService,
  isPermissionError,
  isRecordNotFound,
  templatesCacheKey,
} from '../../../src/posting/templates/templateService.js';
import { TEMPLATE_COLLECTION } from '../../../src/posting/templates/postTemplates.js';
import { TEMPLATES_CHANGED_EVENT } from '../../../src/posting/events.js';
import { each, value } from './_helpers.js';
import { inTurn, json, recordFetch } from './_fetch.js';

export const sources = ['src/posting/templates/templateService.js'];

const SERVER = 'https://server.example';
const TOKEN = `vg_${'0f'.repeat(32)}`;
const DID = 'did:plc:bob';
const OTHER = 'did:plc:carol';
const CID = 'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku';
const NOW = Date.parse('2026-10-14T12:00:00.000Z');
const FAMILY = '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}';

const uriFor = (rkey, did = DID) =>
  `at://${did}/${TEMPLATE_COLLECTION}/${rkey}`;
const value_ = (fields) => ({
  $type: TEMPLATE_COLLECTION,
  text: '',
  createdAt: '2026-09-01T00:00:00.000Z',
  ...fields,
});
const entry = (rkey, fields, did = DID) => ({
  uri: uriFor(rkey, did),
  cid: CID,
  value: value_(fields),
});
const long = (n, unit = 'a') => unit.repeat(n);

// Answers, as Virga's server wraps them.
const ok = (data) => json({ success: true, data });
const page = (records, cursor) =>
  ok(cursor === undefined ? { records } : { records, cursor });
const fail = (status, error, code) =>
  json({ success: false, error, ...(code ? { code } : {}) }, status);
const created = (rkey, did = DID) => ok({ uri: uriFor(rkey, did), cid: CID });
const gone = fail(400, 'Could not locate record', 'RecordNotFound');
const scope = fail(
  403,
  'Missing required scope "repo:net.anisota.feed.template"',
  'ScopeMissingError',
);

function memoryStore(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    clear: () => data.clear(),
  };
}

const agentFor = (did) =>
  new Agent({
    did,
    fetchHandler: createBackendFetchHandler({
      backendUrl: SERVER,
      token: () => TOKEN,
      did,
    }),
  });

function accountFor(who) {
  switch (who) {
    case 'bob':
      return { did: DID, agent: agentFor(DID) };
    case 'carol':
      return { did: OTHER, agent: agentFor(OTHER) };
    case 'getter':
      return { did: DID, agent: async (d) => agentFor(d) };
    case 'getterNull':
      return { did: DID, agent: async () => null };
    case 'other':
      return { did: DID, agent: agentFor(OTHER) };
    case 'none':
      return { did: DID };
    case 'empty':
      return { did: '', agent: agentFor(DID) };
    default:
      return null;
  }
}

/** `new Date()` at `ms` while `fn` runs. */
async function withFixedDate(ms, fn) {
  const Real = globalThis.Date;
  class Fixed extends Real {
    constructor(...args) {
      super(...(args.length ? args : [ms]));
    }
    static now() {
      return ms;
    }
  }
  globalThis.Date = Fixed;
  try {
    return await fn();
  } finally {
    globalThis.Date = Real;
  }
}

// A template an op names: as given, or one the service lists (`$from:
// [did, index]`) with fields laid over it.
function templateOf(service, spec) {
  if (spec && typeof spec === 'object' && Array.isArray(spec.$from)) {
    const { $from, ...fields } = spec;
    return { ...service.list($from[0])[$from[1]], ...fields };
  }
  return spec;
}

async function runOp(service, store, [kind, ...args]) {
  try {
    switch (kind) {
      case 'load':
        return { value: await service.load(accountFor(args[0])) };
      case 'list':
        return { value: service.list(args[0]) };
      case 'isLoaded':
        return { value: service.isLoaded(args[0]) };
      case 'prime':
        return { value: service.primeFromCache(args[0]) };
      case 'create':
        return {
          value: await service.create(
            templateOf(service, args[0]),
            accountFor(args[1]),
          ),
        };
      case 'update':
        return {
          value: await service.update(
            args[0],
            templateOf(service, args[1]),
            accountFor(args[2]),
          ),
        };
      case 'remove':
        return {
          value: (await service.remove(args[0], accountFor(args[1]))) ?? null,
        };
      case 'reset':
        service.reset(args[0]);
        return { value: null };
      case 'setStore':
        store.setItem(args[0], args[1]);
        return { value: null };
      case 'clearStore':
        store.clear();
        return { value: null };
      default:
        throw new Error(`unknown op ${kind}`);
    }
  } catch (error) {
    return {
      $throws: String(error?.message || error),
      fieldErrors: error?.fieldErrors ?? null,
      permission: error?.permission ?? null,
    };
  }
}

const parsed = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return { $text: text };
  }
};

async function runScript({
  store: initial = {},
  ops,
  answers = [fail(500, 'no answer expected')],
}) {
  const store = memoryStore(initial);
  const target = new EventTarget();
  const events = [];
  target.addEventListener(TEMPLATES_CHANGED_EVENT, (e) =>
    events.push({
      did: e.detail.did,
      names: e.detail.templates.map((t) => t.name),
    }),
  );
  const service = createTemplateService({ store, target });
  const heard = [];
  service.subscribe((did, templates) =>
    heard.push({ did: did ?? null, names: templates.map((t) => t.name) }),
  );
  return recordFetch(
    inTurn(...answers),
    () =>
      withFixedDate(NOW, async () => {
        const results = [];
        for (const op of ops) results.push(await runOp(service, store, op));
        return {
          results,
          heard,
          events,
          store: Object.fromEntries(
            [...store.data].map(([k, v]) => [k, parsed(v)]),
          ),
        };
      }),
    { now: NOW },
  );
}

const cache = (entries) => ({
  [templatesCacheKey(DID)]: JSON.stringify(
    Object.fromEntries(entries.map((e) => [e.uri.split('/').pop(), e])),
  ),
});

const SCRIPTS = {
  pagesAndNormalizes: {
    ops: [
      ['load', 'bob'],
      ['isLoaded', DID],
      ['list', DID],
    ],
    answers: [
      page(
        [
          entry('3la', {
            name: 'First page',
            text: 'Hi {{their.firstName}}',
            use: 'someday',
          }),
          entry('3lc', {
            name: 'Odd fields',
            shortcut: 9,
            keywords: ['a', 3],
            variables: [{ key: 'x', kind: 'choice', choices: [] }],
          }),
        ],
        'page-2',
      ),
      page([entry('3lb', { name: 'Second page', shortcut: '/Two' })]),
    ],
  },
  agentGetter: {
    ops: [
      ['load', 'getter'],
      ['isLoaded', DID],
    ],
    answers: [page([entry('3la', { name: 'Fetched' })])],
  },
  getterGivesNothing: {
    ops: [
      ['load', 'getterNull'],
      ['isLoaded', DID],
      ['list', DID],
    ],
  },
  otherAccountsAgent: {
    ops: [
      ['load', 'other'],
      ['isLoaded', DID],
      ['create', { name: 'A', text: 'B' }, 'other'],
    ],
  },
  repeatedCursor: {
    ops: [['load', 'bob']],
    answers: [
      page([entry('3la', { name: 'Loop' })], 'same'),
      page([entry('3lb', { name: 'Loop two' })], 'same'),
    ],
  },
  cursorsThenEnd: {
    ops: [['load', 'bob']],
    answers: [
      page([entry('3la', { name: 'One' })], 'c é+&='),
      page([], 'next'),
      page([entry('3la', { name: 'One again' })], ''),
    ],
  },
  listOrder: {
    ops: [['load', 'bob']],
    answers: [
      page([
        entry('3l1', { name: 'zebra' }),
        entry('3l2', { name: 'Beta', group: 'Support' }),
        entry('3l3', { name: 'alpha', group: 'Support' }),
        entry('3l4', { name: 'Notes', group: 'Field notes' }),
        entry('3l5', { name: 'Apple' }),
        entry('3l6', { name: 'éclair', group: ' support ' }),
        entry('3l7', { name: 'Éclair', group: 'Support' }),
        entry('3l8', { name: '🌿', group: '' }),
        entry('3l9', { name: 'same', group: 'Ω' }),
        entry('3la', { name: 'Same', group: 'ω' }),
      ]),
    ],
  },
  twoAccountsApart: {
    ops: [
      ['load', 'bob'],
      ['load', 'carol'],
      ['list', DID],
      ['list', OTHER],
      ['isLoaded', DID],
      ['isLoaded', OTHER],
    ],
    answers: [
      page([entry('3la', { name: 'Bob’s' })]),
      page([entry('3lc', { name: 'Carol’s' }, OTHER)]),
    ],
  },
  cacheKeptOnFailure: {
    ops: [
      ['load', 'bob'],
      ['load', 'bob'],
      ['list', DID],
      ['isLoaded', DID],
    ],
    answers: [
      page([entry('3la', { name: 'Cached' })]),
      fail(500, 'network down'),
    ],
  },
  firstReadFails: {
    store: cache([entry('3la', { name: 'From before' })]),
    ops: [
      ['load', 'bob'],
      ['list', DID],
      ['isLoaded', DID],
    ],
    answers: ['offline'],
  },
  nothingWithoutAccount: {
    ops: [
      ['load', null],
      ['load', 'none'],
      ['load', 'empty'],
      ['list', null],
      ['list', ''],
      ['isLoaded', null],
    ],
  },
  primeFromCache: {
    store: cache([entry('3la', { name: 'Bob’s' })]),
    ops: [
      ['prime', DID],
      ['list', DID],
      ['prime', OTHER],
      ['prime', DID],
      ['prime', null],
      ['isLoaded', DID],
    ],
  },
  corruptCache: {
    store: { [templatesCacheKey(DID)]: '{not json' },
    ops: [
      ['prime', DID],
      ['reset'],
      [
        'setStore',
        templatesCacheKey(DID),
        JSON.stringify({
          '3la': entry('3la', { name: 'Kept' }),
          '3lb': entry('3lother', { name: 'Misfiled' }),
          '3lc': { uri: uriFor('3lc'), value: 'nope' },
          '3ld': { uri: 5, value: {} },
          '3le': { uri: uriFor('3le'), cid: 7, value: { name: 'Number cid' } },
          '3lf': null,
          '3lg': { uri: uriFor('3lg'), value: [] },
        }),
      ],
      ['prime', DID],
      ['setStore', templatesCacheKey(OTHER), '[1,2]'],
      ['prime', OTHER],
    ],
  },
  confirmedMemoryStays: {
    ops: [
      ['load', 'bob'],
      [
        'setStore',
        templatesCacheKey(DID),
        JSON.stringify({ '3la': entry('3la', { name: 'Elsewhere' }) }),
      ],
      ['prime', DID],
    ],
    answers: [page([])],
  },
  primeRefillsEmptyUnconfirmed: {
    ops: [
      ['prime', DID],
      [
        'setStore',
        templatesCacheKey(DID),
        JSON.stringify({ '3la': entry('3la', { name: 'Arrived' }) }),
      ],
      ['prime', DID],
    ],
  },
  createReadsTheAnswer: {
    ops: [
      [
        'create',
        {
          name: 'Is there an app?',
          text: 'Not yet, {{their.firstName}}.',
          shortcut: '/App',
        },
        'bob',
      ],
      ['list', DID],
    ],
    answers: [created('3lnew1')],
  },
  createAddsToCache: {
    store: cache([entry('3la', { name: 'Older' })]),
    ops: [
      ['create', { name: 'Newer', text: 'Hello' }, 'bob'],
      ['list', DID],
    ],
    answers: [created('3lnew1')],
  },
  createRefusesInvalid: {
    ops: [
      ['create', { name: '  ', text: '' }, 'bob'],
      ['create', null, 'bob'],
      ['create', 'text', 'bob'],
      ['create', [], 'bob'],
    ],
  },
  createChecksShortcuts: {
    ops: [
      ['load', 'bob'],
      ['create', { name: 'Another', text: 'Hey', shortcut: '/hi' }, 'bob'],
      ['create', { name: 'Carol’s', text: 'Hey', shortcut: '/hi' }, 'carol'],
    ],
    answers: [
      page([entry('3la', { name: 'Hello', text: 'Hi', shortcut: 'hi' })]),
      created('3lnew2', OTHER),
    ],
  },
  createPermission: {
    ops: [
      ['create', { name: 'A', text: 'B' }, 'bob'],
      ['create', { name: 'A', text: 'B' }, 'bob'],
      ['create', { name: 'A', text: 'B' }, 'bob'],
      ['create', { name: 'A', text: 'B' }, 'bob'],
      ['list', DID],
    ],
    answers: [
      scope,
      fail(502, 'socket hang up'),
      fail(401, 'Unauthorized', 'AuthenticationRequired'),
      fail(400, 'Bad record', 'InvalidRequest'),
    ],
  },
  createOffline: {
    ops: [['create', { name: 'A', text: 'B' }, 'bob']],
    answers: ['offline'],
  },
  createNeedsAccount: {
    ops: [
      ['create', { name: 'A', text: 'B' }, null],
      ['create', { name: 'A', text: 'B' }, 'empty'],
      ['create', { name: 'A', text: 'B' }, 'none'],
      ['create', { name: 'A', text: 'B' }, 'getterNull'],
      ['list', DID],
    ],
  },
  createAnswerWithoutKey: {
    ops: [
      ['create', { name: 'A', text: 'B' }, 'bob'],
      ['create', { name: 'C', text: 'D' }, 'bob'],
      ['list', DID],
    ],
    answers: [
      ok({ uri: `at://${DID}/${TEMPLATE_COLLECTION}/`, cid: CID }),
      ok({ uri: `at://${DID}/${TEMPLATE_COLLECTION}`, cid: CID }),
    ],
  },
  createViaGetter: {
    ops: [['create', { name: 'Got', text: 'x' }, 'getter']],
    answers: [created('3lg')],
  },
  update: {
    ops: [
      ['load', 'bob'],
      [
        'update',
        '3la',
        { $from: [DID, 0], name: 'New name', createdAt: null },
        'bob',
      ],
      ['list', DID],
    ],
    answers: [
      page([
        entry('3la', {
          name: 'Old name',
          text: 'Hi',
          shortcut: 'hi',
          createdAt: '2026-01-01T00:00:00.000Z',
        }),
      ]),
      ok({ uri: uriFor('3la'), cid: CID }),
    ],
  },
  updateNotHeld: {
    ops: [
      [
        'update',
        '3lz',
        {
          name: 'Elsewhere',
          text: 'Hi',
          createdAt: '2025-12-25T00:00:00.000Z',
        },
        'bob',
      ],
      ['list', DID],
    ],
    answers: [ok({ uri: uriFor('3lz'), cid: CID })],
  },
  updateNoCreatedAt: {
    ops: [['update', '3lz', { name: 'Fresh', text: 'Hi' }, 'bob']],
    answers: [ok({ uri: uriFor('3lz'), cid: CID })],
  },
  updateAnswerUri: {
    store: cache([
      entry('3la', { name: 'Held', createdAt: '2020-01-01T00:00:00.000Z' }),
    ]),
    ops: [
      ['update', '3la', { name: 'Edited', text: 'x' }, 'bob'],
      ['list', DID],
    ],
    answers: [
      ok({
        uri: 'at://did:plc:bob/net.anisota.feed.template/3la-elsewhere',
        cid: CID,
      }),
    ],
  },
  updateValidates: {
    ops: [
      ['update', '3la', { name: '', text: 'x' }, 'bob'],
      ['update', '../3la', { name: 'A', text: 'B' }, 'bob'],
      ['update', '3la', { name: 'A', text: 'B' }, null],
    ],
  },
  updatePermission: {
    ops: [['update', '3la', { name: 'A', text: 'B' }, 'bob']],
    answers: [fail(403, '403 Forbidden')],
  },
  updateOwnShortcut: {
    ops: [
      ['load', 'bob'],
      ['update', '3la', { $from: [DID, 0], text: 'Changed' }, 'bob'],
      ['update', '3lb', { $from: [DID, 0], name: 'Copy' }, 'bob'],
    ],
    answers: [
      page([
        entry('3la', { name: 'Hello', text: 'Hi', shortcut: 'hi' }),
        entry('3lb', { name: 'Other', text: 'x' }),
      ]),
      ok({ uri: uriFor('3la'), cid: CID }),
    ],
  },
  remove: {
    ops: [
      ['load', 'bob'],
      ['remove', '3la', 'bob'],
      ['list', DID],
    ],
    answers: [
      page([
        entry('3la', { name: 'Going' }),
        entry('3lb', { name: 'Staying' }),
      ]),
      ok({}),
    ],
  },
  removeAlreadyGone: {
    ops: [
      ['load', 'bob'],
      ['remove', '3la', 'bob'],
      ['list', DID],
    ],
    answers: [page([entry('3la', { name: 'Ghost' })]), gone],
  },
  removeGoneByMessage: {
    ops: [
      ['load', 'bob'],
      ['remove', '3la', 'bob'],
      ['remove', '3lb', 'bob'],
      ['list', DID],
    ],
    answers: [
      page([entry('3la', { name: 'A' }), entry('3lb', { name: 'B' })]),
      fail(400, 'Record not found'),
      fail(500, 'could not find record 3lb'),
    ],
  },
  removeOtherFailure: {
    ops: [
      ['load', 'bob'],
      ['remove', '3la', 'bob'],
      ['list', DID],
    ],
    answers: [
      page([entry('3la', { name: 'Still public' })]),
      fail(502, '502 Bad Gateway'),
    ],
  },
  removePermission: {
    ops: [['remove', '3la', 'bob']],
    answers: [fail(400, 'Not authorized for this collection')],
  },
  removeNeedsKey: {
    ops: [
      ['remove', '', 'bob'],
      ['remove', 'a/b', 'bob'],
      ['remove', long(513), 'bob'],
      ['remove', '_start', 'bob'],
      ['remove', 5, 'bob'],
      ['remove', 'a\n', 'bob'],
      ['remove', 'é', 'bob'],
      ['remove', 'ok.~:-_', 'bob'],
      ['remove', long(512), 'bob'],
      ['remove', '3la', null],
    ],
    answers: [ok({}), ok({})],
  },
  nextLoadWins: {
    ops: [
      ['load', 'bob'],
      ['create', { name: 'Deleted elsewhere', text: 'Hi' }, 'bob'],
      ['list', DID],
      ['load', 'bob'],
      ['list', DID],
    ],
    answers: [page([]), created('3lnew1'), page([])],
  },
  reset: {
    ops: [
      ['load', 'bob'],
      ['reset'],
      ['list', DID],
      ['isLoaded', DID],
      ['reset'],
    ],
    answers: [page([entry('3la', { name: 'Bob’s' })])],
  },
  resetOne: {
    ops: [
      ['load', 'bob'],
      ['load', 'carol'],
      ['reset', DID],
      ['list', DID],
      ['list', OTHER],
      ['isLoaded', OTHER],
      ['load', 'bob'],
    ],
    answers: [
      page([entry('3la', { name: 'Bob’s' })]),
      page([entry('3lc', { name: 'Carol’s' }, OTHER)]),
      page([entry('3lb', { name: 'Bob’s again' })]),
    ],
  },
  resetKeepsCache: {
    ops: [['load', 'bob'], ['reset'], ['prime', DID], ['isLoaded', DID]],
    answers: [page([entry('3la', { name: 'Cached' })])],
  },
  limits: {
    ops: [
      [
        'create',
        {
          name: 'Ask',
          text: 'Thanks for {{idea}}',
          variables: [{ key: 'idea', label: long(65) }],
        },
        'bob',
      ],
      [
        'create',
        {
          name: 'Ask',
          text: 'Thanks for {{idea}}',
          variables: [{ key: 'idea', label: long(30, FAMILY) }],
        },
        'bob',
      ],
      [
        'create',
        {
          name: 'Ask',
          text: 'Which {{device}}?',
          variables: [{ key: 'device', hint: long(201) }],
        },
        'bob',
      ],
      [
        'create',
        {
          name: 'Ask',
          text: 'Which {{device}}?',
          variables: [
            { key: 'device', kind: 'choice', choices: ['Phone', long(301)] },
          ],
        },
        'bob',
      ],
      [
        'create',
        {
          name: 'Ask',
          text: '{{a}} and {{b}}',
          variables: [
            { key: 'a', label: long(65) },
            { key: 'b', kind: 'choice', choices: [] },
          ],
        },
        'bob',
      ],
      ['create', { name: 'Ask', text: 'Hi', keywords: [long(40, 'é')] }, 'bob'],
      ['create', { name: 'Ask', text: 'Hi', keywords: [long(30, 'İ')] }, 'bob'],
      ['create', { name: long(30, FAMILY), text: 'Hi' }, 'bob'],
      ['create', { name: 'Ask', text: long(250, 'é'.repeat(7)) }, 'bob'],
      [
        'create',
        { name: 'Ask', text: 'Hi', group: long(60, 'ü'.repeat(6)) },
        'bob',
      ],
      [
        'create',
        {
          name: 'Ask',
          text: '{{a}}',
          variables: [{ key: 'a', hint: long(150, FAMILY) }],
        },
        'bob',
      ],
      [
        'create',
        {
          name: 'Ask',
          text: '{{a}}',
          variables: [
            { key: 'a', kind: 'choice', choices: [long(150, FAMILY)] },
          ],
        },
        'bob',
      ],
      [
        'update',
        '3la',
        {
          name: 'Ask',
          text: 'Thanks for {{idea}}',
          variables: [{ key: 'idea', label: long(65) }],
        },
        'bob',
      ],
    ],
  },
  limitsWritten: {
    ops: [
      [
        'create',
        {
          name: 'Ask',
          text: 'Which {{device}}?',
          variables: [{ key: 'device', default: long(320) }],
        },
        'bob',
      ],
      [
        'create',
        {
          name: 'Ask',
          text: 'No blanks now',
          variables: [{ key: 'gone', label: long(90) }],
        },
        'bob',
      ],
      [
        'create',
        {
          name: 'Ask',
          text: '{{a}}',
          variables: [{ key: 'a', default: long(200, FAMILY) }],
        },
        'bob',
      ],
      [
        'create',
        {
          name: 'Ask',
          text: '{{a}}',
          variables: [{ key: 'a', default: ` ${long(299)}  x` }],
        },
        'bob',
      ],
      [
        'create',
        {
          name: 'Ask',
          text: '{{a}}',
          variables: [{ key: 'a', default: long(300), label: 'Q' }],
        },
        'bob',
      ],
      ['list', DID],
    ],
    answers: [
      created('3l1'),
      created('3l2'),
      created('3l3'),
      created('3l4'),
      created('3l5'),
    ],
  },
  wholeTemplate: {
    ops: [
      [
        'create',
        {
          name: '  Thanks for the idea ',
          text: 'Thank you, {{their.firstName}}. I like the idea of {{idea}}. {{timing}}',
          variables: [
            {
              key: 'idea',
              label: 'What did they suggest?',
              hint: 'A few words',
            },
            {
              key: 'timing',
              label: 'When?',
              kind: 'choice',
              optional: true,
              choices: ['Soon.', 'Someday.'],
            },
            { key: 'gone', label: 'Removed from the text' },
          ],
          embed: {
            $type: 'app.bsky.embed.record',
            record: { uri: 'at://did:plc:bob/app.bsky.feed.post/1', cid: CID },
          },
          use: 'reply',
          group: ' Ideas ',
          shortcut: '/Idea',
          keywords: ['Love', 'love', ' ', 'feature'],
          langs: ['en', 'pt'],
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        'bob',
      ],
      ['list', DID],
    ],
    answers: [created('3lwhole')],
  },
};

export default async function cases() {
  const out = [];
  out.push(value('TEMPLATE_PERMISSION_MESSAGE', TEMPLATE_PERMISSION_MESSAGE));
  out.push(
    ...(await each(
      'templatesCacheKey',
      [DID, '', 'did:web:é.example'].map((did) => ({ did })),
      ({ did }) => templatesCacheKey(did),
    )),
  );

  // The error helpers, over errors as data: `{ message, error, code }`, or a
  // plain object.
  const ERRORS = [
    {
      $id: 'record-not-found',
      message: 'Could not locate record',
      error: 'RecordNotFound',
    },
    { $id: 'code', plain: true, code: 'RecordNotFound' },
    { $id: 'message', message: 'record not found' },
    { $id: 'message-spaces', message: 'Record\n\t not   Found here' },
    { $id: 'could-not-find', message: 'COULD NOT FIND RECORD' },
    { $id: 'could-not-locate-two-spaces', message: 'could not  locate record' },
    { $id: 'embedded', message: 'xRecordNotFoundx' },
    { $id: 'lower-code', message: 'recordnotfound' },
    { $id: '502', message: '502' },
    { $id: 'null', isNull: true },
    { $id: 'scope', plain: true, error: 'ScopeMissingError' },
    { $id: 'forbidden', message: 'Forbidden' },
    { $id: 'socket', message: 'socket hang up' },
    { $id: 'permission', message: 'No PERMISSION for that' },
    { $id: 'not-authorized', message: 'Not authorized' },
    { $id: 'not-authorised', message: 'Not authorised' },
    { $id: 'unauthorized-code', message: 'x', code: 'Unauthorized' },
    { $id: 'number-code', message: 'x', code: 403 },
    { $id: 'long-s', message: 'ſcope' },
    { $id: 'dotted', message: 'FORBİDDEN' },
    { $id: 'empty', message: '' },
  ];
  const errorOf = (e) => {
    if (e.isNull) return null;
    const err = e.plain ? {} : new Error(e.message);
    if (e.error !== undefined) err.error = e.error;
    if (e.code !== undefined) err.code = e.code;
    return err;
  };
  out.push(
    ...(await each('isRecordNotFound', ERRORS, (e) =>
      isRecordNotFound(errorOf(e)),
    )),
  );
  out.push(
    ...(await each('isPermissionError', ERRORS, (e) =>
      isPermissionError(errorOf(e)),
    )),
  );

  out.push(
    ...(await each(
      'script',
      Object.entries(SCRIPTS).map(([name, script]) => ({
        $id: name,
        ...script,
      })),
      runScript,
    )),
  );
  return out;
}
