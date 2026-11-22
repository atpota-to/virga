// src/posting/lib/publishRecord.js: which failures are the network's and
// worth a retry, the gate records a post's threadgate and postgate are, and
// the idempotent writes themselves as recorded exchanges with a PDS behind
// Virga's server: a write under a client key, the landed-check after any
// failure, the retries, timeouts that fire, and a post written with its
// gates in one applyWrites. Swift: VirgaPosting/Lib/PublishRecord.swift,
// replayed through MockTransport with XRPCAgent over BackendFetchHandler.
//
// Inputs from publishRecord.test.js, and more: every status band, codes and
// messages in every case, messages that aren't strings, gates of every
// shape, scripts where the write hangs, lands and fails, or the check hangs.

import { each } from './_helpers.js';
import { recordFetch } from './_fetch.js';
import {
  ME,
  NOW,
  agentFor,
  hangs,
  loadFresh,
  pds,
  resetTids,
  withFixedDate,
  withTimers,
} from './_publish.js';

export const sources = ['src/posting/lib/publishRecord.js'];

const POST = 'app.bsky.feed.post';
const RKEY = '3m5abcdefgh22';
const RECORD = {
  $type: POST,
  text: 'hi',
  createdAt: '2026-07-24T00:00:00.000Z',
};
const REPLY = {
  ...RECORD,
  reply: {
    root: { uri: `at://${ME}/${POST}/3root`, cid: 'bafyroot' },
    parent: { uri: `at://${ME}/${POST}/3root`, cid: 'bafyroot' },
  },
};
const MENTION = { $type: 'app.bsky.feed.threadgate#mentionRule' };
const FOLLOWING = { $type: 'app.bsky.feed.threadgate#followingRule' };
const LIST = {
  $type: 'app.bsky.feed.threadgate#listRule',
  list: `at://${ME}/app.bsky.graph.list/3l`,
};
const DISABLE = { $type: 'app.bsky.feed.postgate#disableRule' };

const ERRORS = [
  ['null', null],
  ['empty', {}],
  ['string-transient', 'fetch failed'],
  ['string-other', 'nope'],
  ['number', 5],
  ['zero', 0],
  ['true', true],
  ['empty-array', []],
  ['array-message', ['fetch failed']],
  ['code-econnreset', { code: 'ECONNRESET' }],
  ['code-lower', { code: 'econnrefused' }],
  ['code-und', { code: 'UND_ERR_SOCKET' }],
  ['code-etimedout', { code: 'ETIMEDOUT' }],
  ['code-enotfound', { code: 'ENOTFOUND' }],
  ['code-eai-again', { code: 'EAI_AGAIN' }],
  ['code-epipe', { code: 'EPIPE' }],
  ['code-not-at-start', { code: 'XECONNRESET' }],
  ['code-other', { code: 'EACCES' }],
  ['code-number', { code: 5 }],
  ['code-true', { code: true }],
  ['code-empty', { code: '' }],
  ['cause-code', { cause: { code: 'UND_ERR_SOCKET' } }],
  ['empty-code-cause', { code: '', cause: { code: 'ECONNRESET' } }],
  ['code-wins-over-cause', { code: 'EACCES', cause: { code: 'ECONNRESET' } }],
  ['cause-null', { cause: null }],
  ['cause-string', { cause: 'ECONNRESET' }],
  ['status-504', { status: 504 }],
  ['status-408', { status: 408 }],
  ['status-string', { status: '504' }],
  ['status-code-504', { statusCode: 504 }],
  ['status-string-code', { status: 'x', statusCode: 408 }],
  ['status-500', { status: 500 }],
  ['status-503', { status: 503 }],
  ['status-429', { status: 429 }],
  ['status-400', { status: 400, message: 'InvalidRequest' }],
  ['status-400-timeout', { status: 400, message: 'timeout' }],
  ['status-403', { status: 403 }],
  ['status-1-bad', { status: 1, message: 'Bad record' }],
  ['status-1-fetch', { status: 1, message: 'fetch failed' }],
  ['status-99', { status: 99, message: 'timeout' }],
  ['status-100', { status: 100, message: 'timeout' }],
  ['status-0', { status: 0 }],
  ['status-negative', { status: -1, message: 'x' }],
  ['status-599', { status: 599 }],
  ['status-600', { status: 600 }],
  ['status-499', { status: 499 }],
  ['timed-out', { timedOut: true }],
  ['timed-out-one', { timedOut: 1 }],
  ['timed-out-zero', { timedOut: 0, status: 503 }],
  ['timed-out-string', { timedOut: 'yes', status: 400 }],
  ['failed-to-fetch', { message: 'Failed to fetch' }],
  ['load-failed', { message: 'Load failed' }],
  [
    'network-error-firefox',
    { message: 'NetworkError when attempting to fetch resource.' },
  ],
  ['network-error', { message: 'network error' }],
  ['networkerror', { message: 'networkerror' }],
  ['network-two-spaces', { message: 'Network  error' }],
  ['timed-out-caps', { message: 'TIMED OUT' }],
  ['request-timeout', { message: 'Request Timeout' }],
  ['socket-hang-up', { message: 'socket hang up' }],
  ['connection-reset', { message: 'Connection reset by peer' }],
  ['gateway-timeout', { message: 'Gateway Timeout' }],
  ['service-unavailable', { message: 'Service Unavailable' }],
  [
    'temporarily-unavailable',
    { message: 'Backend temporarily unavailable, please retry' },
  ],
  ['und-err-message', { message: 'UND_ERR_CONNECT_TIMEOUT error' }],
  ['econnreset-message', { message: 'read ECONNRESET' }],
  ['enotfound-message', { message: 'getaddrinfo ENOTFOUND x' }],
  ['eai-again-message', { message: 'eai_again' }],
  ['other-message', { message: 'Something else' }],
  ['empty-message', { message: '' }],
  ['cause-message', { message: '', cause: { message: 'fetch failed' } }],
  [
    'message-wins-over-cause',
    { message: 'nope', cause: { message: 'fetch failed' } },
  ],
  ['zero-message-cause', { message: 0, cause: { message: 'timeout' } }],
  ['kelvin', { message: 'networK error' }],
  ['dotted-i', { message: 'FETCH FAİLED' }],
  ['message-number', { message: 42 }],
  ['message-object', { message: {} }],
  ['message-array', { message: ['Timeout'] }],
  ['cause-message-number', { cause: { message: 5 } }],
  ['message-true', { message: true }],
];

const RULES = [
  ['array-empty', []],
  ['array-one', [MENTION]],
  ['array-null-rule', [null]],
  ['null', null],
  ['missing', undefined],
  ['object', {}],
  ['string', 'abc'],
  ['zero', 0],
];

/** Writes `fn(agent)` against a scripted PDS, with every exchange recorded. */
async function exchange({ script = {}, fire = [] }, fn) {
  const server = pds(script);
  resetTids();
  const out = await withFixedDate(NOW, () =>
    recordFetch(
      server.responder,
      () =>
        withTimers(fire, async () => {
          const agent = await agentFor(ME);
          return fn(agent);
        }),
      { now: NOW },
    ),
  );
  return hangs(out, server);
}

export default async function cases() {
  const [m] = await loadFresh(['../../../src/posting/lib/publishRecord.js']);
  const all = [];

  all.push(
    ...(await each(
      'isTransientNetworkError',
      ERRORS.map(([$id, err]) => ({ $id, err })),
      ({ err }) => m.isTransientNetworkError(err),
    )),
    ...(await each(
      'isRetriablePublishError',
      ERRORS.map(([$id, err]) => ({ $id, err })),
      ({ err }) => m.isRetriablePublishError(err),
    )),
    ...(await each(
      'needsThreadgateRecord',
      RULES.map(([$id, rules]) => ({ $id, rules })),
      ({ rules }) => m.needsThreadgateRecord(rules),
    )),
    ...(await each(
      'needsPostgateRecord',
      [...RULES, ['array-disable', [DISABLE]]].map(([$id, rules]) => ({
        $id,
        rules,
      })),
      ({ rules }) => m.needsPostgateRecord(rules),
    )),
  );

  const gateInputs = [];
  const threadgates = [
    ['tg-missing', undefined],
    ['tg-null', null],
    ['tg-nobody', []],
    ['tg-rules', [MENTION, FOLLOWING, LIST]],
    ['tg-string', 'x'],
  ];
  const postgates = [
    ['pg-missing', undefined],
    ['pg-null', null],
    ['pg-empty', []],
    ['pg-disable', [DISABLE]],
    ['pg-object', {}],
  ];
  for (const [t, threadgateRules] of threadgates)
    for (const [p, postgateRules] of postgates)
      gateInputs.push({
        $id: `${t}-${p}`,
        did: ME,
        rkey: 'rk1',
        threadgateRules,
        postgateRules,
        createdAt: '2026-11-12T15:00:00.000Z',
      });
  gateInputs.push(
    {
      $id: 'default-createdAt',
      did: ME,
      rkey: 'rk2',
      threadgateRules: [],
      postgateRules: [DISABLE],
    },
    {
      $id: 'null-createdAt',
      did: ME,
      rkey: 'rk3',
      threadgateRules: [],
      createdAt: null,
    },
    {
      $id: 'unicode-did',
      did: 'did:web:café.example',
      rkey: '3k\u{1F600}',
      threadgateRules: [MENTION],
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  );
  all.push(
    ...(await each('buildGateWrites', gateInputs, (input) =>
      withFixedDate(NOW, () => m.buildGateWrites(input)),
    )),
  );

  // createRecordIdempotent(agent, { repo, collection, record }, opts)
  const plain = [
    { $id: 'happy', script: { writes: ['ok'] } },
    {
      $id: 'transient-then-ok',
      script: { writes: ['fail:503', 'ok'], checks: ['missing'] },
    },
    {
      $id: 'genuine-4xx',
      script: { writes: ['fail:400:InvalidRequest:InvalidRequest'] },
    },
    {
      $id: 'exhausted',
      script: { writes: ['fail:502:still down', 'fail:502:still down'] },
    },
    {
      $id: 'duplicate-rkey-landed',
      script: { writes: ['fail:400:Record already exists'] },
      records: true,
    },
    { $id: 'landed-then-504', script: { writes: ['land-fail:504'] } },
    {
      $id: 'timed-out-but-landed',
      script: { writes: ['hang'] },
      records: true,
      fire: [[30000, 0]],
    },
    {
      $id: 'timed-out-then-retried',
      script: { writes: ['hang', 'ok'] },
      fire: [[30000, 0]],
    },
    { $id: 'offline-then-ok', script: { writes: ['offline', 'ok'] } },
    { $id: 'offline-twice', script: { writes: ['offline', 'offline'] } },
    {
      $id: 'check-hangs',
      script: { writes: ['fail:503', 'ok'], checks: ['hang'] },
      fire: [[15000, 0]],
    },
    {
      $id: 'check-offline',
      script: { writes: ['fail:503', 'ok'], checks: ['offline'] },
    },
    {
      $id: 'check-fails',
      script: { writes: ['fail:500', 'ok'], checks: ['fail:500'] },
    },
    {
      $id: 'one-attempt',
      script: { writes: ['fail:503'] },
      opts: { attempts: 1 },
    },
    {
      $id: 'three-attempts',
      script: { writes: ['fail:503', 'fail:500', 'ok'] },
      opts: { attempts: 3 },
    },
    {
      $id: 'three-attempts-exhausted',
      script: { writes: ['fail:503', 'fail:500', 'fail:429'] },
      opts: { attempts: 3 },
    },
    { $id: 'no-attempts', script: {}, opts: { attempts: 0 } },
    {
      $id: 'own-timeout',
      script: { writes: ['hang', 'ok'] },
      opts: { timeoutMs: 5 },
      fire: [[5, 0]],
    },
    { $id: 'minted-rkey', script: { writes: ['ok'] }, mint: true },
    {
      $id: 'missing-scope',
      script: {
        writes: [
          'fail:403:Missing required scope "repo:app.bsky.feed.post":ScopeMissingError',
        ],
      },
    },
    { $id: 'rate-limited', script: { writes: ['fail:429', 'ok'] } },
    {
      $id: 'signed-out',
      script: { writes: ['fail:401:Sign in again:AuthenticationRequired'] },
    },
  ];
  all.push(
    ...(await each('createRecordIdempotent', plain, (input) =>
      exchange(
        {
          script: {
            ...input.script,
            records: input.records
              ? { [`at://${ME}/${POST}/${RKEY}`]: RECORD }
              : undefined,
          },
          fire: input.fire,
        },
        (agent) =>
          m.createRecordIdempotent(
            agent,
            { repo: ME, collection: POST, record: RECORD },
            input.mint
              ? input.opts || {}
              : { rkey: RKEY, ...(input.opts || {}) },
          ),
      ),
    )),
  );

  // publishWithIdempotentRetry with an applyWrites of the caller's.
  all.push(
    ...(await each(
      'publishWithIdempotentRetry',
      [
        {
          $id: 'apply-writes-retried',
          script: { writes: ['fail:500', 'ok'] },
          rkey: 'fixedrkey',
        },
        {
          $id: 'apply-writes-landed',
          script: { writes: ['land-fail:502'] },
          rkey: 'fixedrkey',
        },
      ],
      ({ script, rkey }) =>
        exchange({ script }, (agent) =>
          m.publishWithIdempotentRetry(
            agent,
            async (key) => {
              const res = await agent.com.atproto.repo.applyWrites({
                repo: ME,
                validate: true,
                writes: [
                  {
                    $type: 'com.atproto.repo.applyWrites#create',
                    collection: POST,
                    rkey: key,
                    value: RECORD,
                  },
                ],
              });
              return res?.data;
            },
            { repo: ME, collection: POST, rkey },
          ),
        ),
    )),
  );

  // createPostWithGates(agent, { repo, collection, record, threadgateRules, postgateRules }, opts)
  const gated = [
    { $id: 'no-gates', threadgateRules: null, postgateRules: [] },
    { $id: 'nobody-can-reply', threadgateRules: [] },
    {
      $id: 'both-gates',
      threadgateRules: [FOLLOWING],
      postgateRules: [DISABLE],
    },
    { $id: 'postgate-only', postgateRules: [DISABLE] },
    { $id: 'empty-postgate-only', postgateRules: [] },
    { $id: 'reply-never-gated', record: REPLY, threadgateRules: [] },
    {
      $id: 'null-reply-gated',
      record: { ...RECORD, reply: null },
      threadgateRules: [],
    },
    {
      $id: 'other-collection',
      collection: 'com.example.note',
      record: { ...RECORD, $type: 'com.example.note' },
      threadgateRules: [MENTION],
    },
    {
      $id: 'gate-batch-retried',
      threadgateRules: [],
      script: { writes: ['fail:500', 'ok'] },
    },
    {
      $id: 'no-results-recovered',
      threadgateRules: [],
      script: { noResults: true },
      recover: true,
    },
    {
      $id: 'no-results-not-landed',
      threadgateRules: [],
      script: { noResults: true, checks: ['missing'] },
    },
    { $id: 'minted-rkey', threadgateRules: [], mint: true },
  ];
  all.push(
    ...(await each('createPostWithGates', gated, (input) => {
      const { script = {}, recover, mint, record = RECORD, ...rest } = input;
      return exchange(
        {
          script: {
            ...script,
            records: recover
              ? { [`at://${ME}/${POST}/${RKEY}`]: RECORD }
              : undefined,
          },
        },
        (agent) =>
          m.createPostWithGates(
            agent,
            { repo: ME, record, ...rest },
            mint ? {} : { rkey: RKEY },
          ),
      );
    })),
  );

  return all;
}
