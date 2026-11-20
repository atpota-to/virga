// src/posting/lib/gates.js: who can reply and quote, as the composer holds
// it and as lexicon rules; the account's default gates; and changing a
// published post's gates over a fake agent, keeping hidden replies and
// detached quotes. Swift: VirgaPosting/Lib/Gates.swift.
//
// The fake agent is the one src/posting/lib/gates.test.js uses (a store of
// gate records; reads of a missing record throw RecordNotFound). The two
// gate reads start together, so they are recorded sorted; the writes after
// them are in order. Inputs from gates.test.js, plus every naming the
// lexicons use, duplicates, unknown and malformed rules, and failures.

import {
  defaultGatesFromPreferences,
  DEFAULT_GATES_TIMEOUT_MS,
  EVERYONE_GATES,
  gatesEqual,
  gatesFromRules,
  gatesToRules,
  MAX_REPLY_RULES,
  readDefaultGates,
  updatePostGates,
} from '../../../src/posting/lib/gates.js';
import { each, value } from './_helpers.js';

export const sources = ['src/posting/lib/gates.js'];

const TG = 'app.bsky.feed.threadgate';
const PG = 'app.bsky.feed.postgate';
const LIST = 'at://did:plc:me/app.bsky.graph.list/3l';
const LIST2 = 'at://did:plc:me/app.bsky.graph.list/3m';
const URI = 'at://did:plc:me/app.bsky.feed.post/3p';

const GATES = [
  { reply: null, quotes: true },
  { reply: [], quotes: true },
  { reply: [], quotes: false },
  {
    reply: [
      { type: 'mention' },
      { type: 'following' },
      { type: 'follower' },
      { type: 'list', list: LIST },
    ],
    quotes: false,
  },
  {
    reply: [
      { type: 'mention' },
      { type: 'mention' },
      { type: 'nope' },
      { type: 'list', list: 'x' },
    ],
  },
  {
    reply: [
      { type: 'list', list: LIST },
      { type: 'list', list: LIST },
      { type: 'list', list: LIST2 },
      { type: 'list' },
      { type: 'list', list: 5 },
      null,
      'mention',
      { type: 'follower' },
    ],
    quotes: true,
  },
  { reply: 'everyone', quotes: 'no' },
  { quotes: false },
  {},
  null,
  { reply: [{ type: 'follower' }, { type: 'list', list: LIST }], quotes: true },
  // Two lists whose URIs differ only in how the é is written: two rules, as
  // a JavaScript Set compares code units.
  {
    reply: [
      { type: 'list', list: 'at://did:plc:me/app.bsky.graph.list/caf\u00E9' },
      { type: 'list', list: 'at://did:plc:me/app.bsky.graph.list/cafe\u0301' },
      { type: 'list', list: 'at://did:plc:me/app.bsky.graph.list/caf\u00E9' },
    ],
    quotes: true,
  },
];

const RULES = [
  {
    threadgateAllowRules: [],
    embeddingRules: [{ $type: `${PG}#disableRule` }],
  },
  { allow: [{ $type: `${TG}#mentionRule` }] },
  { threadgateAllow: [{ $type: `${TG}#futureRule` }] },
  {
    threadgateAllow: null,
    threadgateAllowRules: [{ $type: `${TG}#followerRule` }],
  },
  { threadgateAllow: [{ $type: `${TG}#followingRule` }], allow: [] },
  {
    threadgateAllow: [
      { $type: `${TG}#listRule`, list: LIST },
      { $type: `${TG}#listRule`, list: LIST },
      { $type: `${TG}#listRule` },
      { $type: `${TG}#mentionRule` },
      { $type: `${TG}#mentionRule` },
      null,
    ],
    postgateEmbeddingRules: [
      { $type: 'other' },
      { $type: `${PG}#disableRule` },
    ],
  },
  {
    postgateEmbeddingRules: [],
    embeddingRules: [{ $type: `${PG}#disableRule` }],
  },
  {
    postgateEmbeddingRules: null,
    embeddingRules: [{ $type: `${PG}#disableRule` }],
  },
  { postgateEmbeddingRules: 'disable' },
  { threadgateAllow: 'all' },
  {},
  null,
  'rules',
  [{ $type: `${TG}#mentionRule` }],
];

const PREFS = [
  [],
  [
    { $type: 'app.bsky.actor.defs#savedFeedsPrefV2' },
    { $type: 'app.bsky.actor.defs#postInteractionSettingsPref' },
  ],
  [
    {
      $type: 'app.bsky.actor.defs#postInteractionSettingsPref',
      threadgateAllowRules: [],
    },
  ],
  [
    {
      $type: 'app.bsky.actor.defs#postInteractionSettingsPref',
      threadgateAllowRules: [{ $type: `${TG}#followingRule` }],
      postgateEmbeddingRules: [{ $type: `${PG}#disableRule` }],
    },
  ],
  [
    {
      $type: 'app.bsky.actor.defs#postInteractionSettingsPref',
      threadgateAllowRules: null,
      postgateEmbeddingRules: null,
    },
  ],
  [
    {
      $type: 'app.bsky.actor.defs#postInteractionSettingsPref',
      postgateEmbeddingRules: [],
    },
  ],
  [
    {
      $type: 'app.bsky.actor.defs#postInteractionSettingsPref',
      threadgateAllowRules: [{ $type: `${TG}#mentionRule` }],
    },
    {
      $type: 'app.bsky.actor.defs#postInteractionSettingsPref',
      threadgateAllowRules: [],
    },
  ],
  null,
  'prefs',
  [null, 5],
];

function fakeAgent({
  store: initial = {},
  failGet = {},
  failPut = {},
  failDelete = {},
} = {}) {
  const store = { ...initial };
  const reads = [];
  const writes = [];
  const notFound = () =>
    Object.assign(new Error('Could not locate record'), {
      error: 'RecordNotFound',
    });
  const repo = {
    getRecord: async ({ repo, collection, rkey }) => {
      reads.push({ op: 'get', repo, collection, rkey });
      if (failGet[collection]) throw new Error(failGet[collection]);
      if (!store[collection]) throw notFound();
      return {
        data: {
          uri: `at://${repo}/${collection}/${rkey}`,
          value: store[collection],
        },
      };
    },
    putRecord: async ({ repo, collection, rkey, record }) => {
      writes.push({ op: 'put', repo, collection, rkey, record });
      if (failPut[collection]) throw new Error(failPut[collection]);
      store[collection] = record;
      return { data: {} };
    },
    deleteRecord: async ({ repo, collection, rkey }) => {
      writes.push({ op: 'delete', repo, collection, rkey });
      if (failDelete[collection]) throw new Error(failDelete[collection]);
      if (!store[collection]) throw notFound();
      delete store[collection];
      return { data: {} };
    },
  };
  const sortedReads = () =>
    [...reads].sort((a, b) =>
      a.collection < b.collection ? -1 : a.collection > b.collection ? 1 : 0,
    );
  return { agent: { com: { atproto: { repo } } }, store, sortedReads, writes };
}

const NOW = '2026-11-12T00:00:00.000Z';
const UPDATES = [
  { $id: 'writes both gates', change: { reply: [], quotes: false } },
  {
    $id: 'keeps hidden replies and detached quotes',
    store: {
      [TG]: {
        $type: TG,
        post: URI,
        createdAt: '2025-01-01T00:00:00.000Z',
        allow: [],
        hiddenReplies: ['at://h'],
      },
      [PG]: {
        $type: PG,
        post: URI,
        createdAt: '2025-01-01T00:00:00.000Z',
        embeddingRules: [],
        detachedEmbeddingUris: ['at://d'],
      },
    },
    change: { reply: [{ type: 'follower' }], quotes: false },
  },
  {
    $id: 'opens a post by deleting its gates',
    store: {
      [TG]: { $type: TG, post: URI, allow: [], hiddenReplies: [] },
      [PG]: {
        $type: PG,
        post: URI,
        embeddingRules: [{ $type: `${PG}#disableRule` }],
        detachedEmbeddingUris: [],
      },
    },
    change: { reply: null, quotes: true },
  },
  {
    $id: 'unless they still hold something',
    store: {
      [TG]: { $type: TG, post: URI, allow: [], hiddenReplies: ['at://h'] },
      [PG]: {
        $type: PG,
        post: URI,
        embeddingRules: [{ $type: `${PG}#disableRule` }],
        detachedEmbeddingUris: ['at://d'],
      },
    },
    change: { reply: null, quotes: true },
  },
  { $id: 'nothing to do', change: { reply: null, quotes: true } },
  {
    $id: 'a gate that could not be read',
    failGet: { [TG]: 'boom' },
    change: { reply: [], quotes: true },
  },
  {
    $id: 'the postgate could not be read',
    failGet: { [PG]: 'RecordNotFound in a message' },
    change: { reply: [], quotes: false },
  },
  {
    $id: 'a put that fails',
    failPut: { [PG]: 'nope' },
    change: { reply: [{ type: 'mention' }], quotes: false },
  },
  {
    $id: 'a delete that fails',
    store: { [TG]: { $type: TG, post: URI, allow: [] } },
    failDelete: { [TG]: 'denied' },
    change: { reply: null, quotes: true },
  },
  {
    $id: 'a delete of what is already gone',
    store: { [TG]: { $type: TG, post: URI, allow: [] } },
    failDelete: { [TG]: 'Could not locate record' },
    change: { reply: null, quotes: true },
  },
  {
    $id: 'not a post URI',
    uri: 'at://did:plc:me/app.bsky.feed.like/3x',
    change: { reply: null, quotes: true },
  },
  { $id: 'no URI', uri: '', change: { reply: null, quotes: true } },
  {
    $id: 'lists and repeats',
    change: {
      reply: [
        { type: 'list', list: LIST },
        { type: 'mention' },
        { type: 'list', list: LIST },
        { type: 'bogus' },
      ],
      quotes: true,
    },
  },
  {
    $id: 'malformed stored lists',
    store: {
      [TG]: { $type: TG, post: URI, hiddenReplies: 'x', createdAt: '' },
      [PG]: { $type: PG, post: URI, detachedEmbeddingUris: { a: 1 } },
    },
    change: { reply: [], quotes: false },
  },
];

const READS = [
  {
    $id: 'reads the preferences',
    answer: {
      preferences: [
        {
          $type: 'app.bsky.actor.defs#postInteractionSettingsPref',
          threadgateAllowRules: [],
        },
      ],
    },
  },
  { $id: 'none set', answer: { preferences: [] } },
  { $id: 'not an array', answer: { preferences: {} } },
  { $id: 'no data', answer: null },
  { $id: 'a failed read', fails: true },
  { $id: 'too slow', never: true, timeoutMs: 20 },
];

export default async function cases() {
  const out = [
    value('constants', {
      MAX_REPLY_RULES,
      EVERYONE_GATES,
      DEFAULT_GATES_TIMEOUT_MS,
    }),
  ];
  out.push(
    ...(await each(
      'gatesToRules',
      GATES.map((gates) => ({ gates })),
      ({ gates }) => gatesToRules(gates),
    )),
  );
  out.push(
    ...(await each(
      'gatesFromRules',
      [...RULES, ...GATES.map((g) => gatesToRules(g))].map((rules) => ({
        rules,
      })),
      ({ rules }) => gatesFromRules(rules),
    )),
  );
  const pairs = [];
  for (const a of GATES) for (const b of GATES) pairs.push({ a, b });
  pairs.push({
    a: { reply: [{ type: 'mention' }, { type: 'follower' }], quotes: true },
    b: { reply: [{ type: 'follower' }, { type: 'mention' }], quotes: true },
  });
  pairs.push({
    a: {
      reply: [
        { type: 'list', list: LIST2 },
        { type: 'list', list: LIST },
      ],
    },
    b: {
      reply: [
        { type: 'list', list: LIST },
        { type: 'list', list: LIST2 },
      ],
    },
  });
  out.push(
    ...(await each('gatesEqual', pairs, ({ a, b }) => gatesEqual(a, b))),
  );
  out.push(
    ...(await each(
      'defaultGatesFromPreferences',
      PREFS.map((preferences) => ({ preferences })),
      ({ preferences }) => defaultGatesFromPreferences(preferences),
    )),
  );
  out.push(
    ...(await each(
      'readDefaultGates',
      READS,
      ({ answer, fails, never, timeoutMs }) =>
        readDefaultGates(
          {
            app: {
              bsky: {
                actor: {
                  getPreferences: async () => {
                    if (fails) throw new Error('x');
                    if (never) return new Promise(() => {});
                    return answer === null ? null : { data: answer };
                  },
                },
              },
            },
          },
          timeoutMs ? { timeoutMs } : undefined,
        ),
    )),
  );
  out.push(
    ...(await each(
      'updatePostGates',
      UPDATES,
      async ({ store, failGet, failPut, failDelete, uri, change }) => {
        const fake = fakeAgent({ store, failGet, failPut, failDelete });
        let result;
        try {
          result = await updatePostGates(fake.agent, {
            uri: uri ?? URI,
            ...change,
            now: new Date(NOW),
          });
        } catch (error) {
          result = { $throws: error.message };
        }
        return {
          result,
          reads: fake.sortedReads(),
          writes: fake.writes,
          store: fake.store,
        };
      },
    )),
  );
  return out;
}
