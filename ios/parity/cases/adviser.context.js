// src/posting/adviser/context.js: what one adviser read is about. The goal
// list, the draft's facts for the posting account, the draft as read, the
// read's plan (and the analyze-post body built from it), when the
// pre-publish check stops a post, and the conversation a reply or a quote
// answers, read from the public AppView over a recorded fetch (the deadline
// it races is in `waits`). Swift: VirgaPosting/Adviser/Context.swift.
//
// Inputs from context.test.js, plus loose states and setups, threads that
// run long or have gaps, authors with and without names, and AppView answers
// that fail or aren't what they should be.

import {
  CONTEXT_PARENT_HEIGHT,
  READ_MIN_MS,
  SLOW_READ_AFTER_MS,
  adviserDraftFacts,
  adviserGoalCount,
  adviserGoalItems,
  adviserReadPlan,
  adviserShouldInterrupt,
  adviserSource,
  analyzePayload,
  gatherReplyContext,
  readExpectation,
} from '../../../src/posting/adviser/context.js';
import {
  ADVISER_CONTEXT_TIMEOUT_MS,
  ADVISER_GATE_TIMEOUT_MS,
} from '../../../src/posting/adviser/gate.js';
import {
  DEFAULT_ADVISER_SETTINGS,
  nextPostingAdviserState,
} from '../../../src/posting/adviser/setup.js';
import {
  emptyComposerState,
  emptyPost,
} from '../../../src/posting/lib/composerModel.js';
import { each, value } from './_helpers.js';
import { atNow } from './_composer.js';
import { inTurn, json, recordFetch } from './_fetch.js';

export const sources = ['src/posting/adviser/context.js'];

const ME = 'did:plc:me';
const ALT = 'did:plc:alt';
const OTHER = 'did:plc:other';
const NOW = Date.parse('2026-11-12T10:00:00Z');
const postUri = (did, rkey = 'r1') => `at://${did}/app.bsky.feed.post/${rkey}`;

// emptyComposerState makes ids from the clock; hold it, so the states are
// the same at every run.
const state = (patch = {}, posts = [{ text: 'a draft' }]) =>
  atNow(NOW, () => ({
    ...emptyComposerState({ asDid: ME }),
    posts: posts.map((p, i) => ({ ...emptyPost(), id: `p${i}`, ...p })),
    ...patch,
  }));

const replyTo = (did, extra = {}) => ({
  uri: postUri(did),
  cid: 'c',
  root: { uri: postUri(did), cid: 'c' },
  ...extra,
});

const seeded = nextPostingAdviserState(DEFAULT_ADVISER_SETTINGS);

const SETUPS = {
  seeded,
  off: DEFAULT_ADVISER_SETTINGS,
  nothing: {
    ...DEFAULT_ADVISER_SETTINGS,
    enabled: true,
    checkBeforePublish: true,
  },
  replies: { ...seeded, checkScope: 'replies' },
  topLevel: { ...seeded, checkScope: 'topLevel' },
  roomOff: { ...seeded, checkReplyContext: false },
  always: { ...seeded, reviewMode: 'always' },
  noWriting: { ...seeded, writingChecks: { typos: false } },
  goalsOnly: {
    enabled: true,
    checkBeforePublish: true,
    goals: {
      presets: { limitTopic: { enabled: true, topic: ' politics ' } },
      customText: 'be kind',
    },
  },
  roomOnly: {
    enabled: true,
    checkBeforePublish: true,
    checkReplyContext: true,
  },
  style: {
    ...seeded,
    writingChecks: {
      typos: true,
      customText: ' British spelling ',
      styleProfile: { summary: ' Lowercase. ' },
    },
  },
  loose: {
    enabled: 'yes',
    checkBeforePublish: 1,
    reviewMode: 'Always',
    goals: 'x',
  },
  missing: undefined,
};

const quoting = (did, kind = 'post', extra = {}) => ({
  text: 'x',
  record: {
    kind,
    uri:
      kind === 'feed' ? `at://${did}/app.bsky.feed.generator/f` : postUri(did),
    cid: 'c',
    ...extra,
  },
});

const STATES = {
  post: state(),
  empty: state({}, [{ text: '  ' }]),
  thread: state({}, [{ text: 'a' }, { text: 'b' }]),
  replyOther: state({ reply: replyTo(OTHER) }),
  replySelf: state({ reply: replyTo(ME) }),
  replySelfAsAlt: state({ asDid: ALT, reply: replyTo(ME) }),
  replyAuthorProfile: state({ reply: replyTo(ME, { author: { did: OTHER } }) }),
  replyAuthorBlank: state({ reply: replyTo(OTHER, { author: { did: '' } }) }),
  replyNoUri: state({ reply: { cid: 'c', author: { handle: 'h.example' } } }),
  replyBadUri: state({ reply: { uri: 'https://bsky.app/x', cid: 'c' } }),
  quoteOther: state({}, [quoting(OTHER)]),
  quoteSelf: state({}, [quoting(ME)]),
  quoteFeed: state({}, [quoting(OTHER, 'feed')]),
  quoteNoKind: state({}, [
    { text: 'x', record: { uri: postUri(OTHER), cid: 'c' } },
  ]),
  quoteViewAuthor: state({}, [
    quoting(ME, 'post', { view: { author: { did: OTHER } } }),
  ]),
  quoteAndReply: state({ reply: replyTo(OTHER) }, [quoting('did:plc:third')]),
  quoteInSecondPost: state({}, [{ text: 'one' }, quoting(OTHER)]),
  threadReplyOther: state({ reply: replyTo(OTHER) }, [
    { text: 'a' },
    { text: 'b' },
  ]),
  threadReplySelf: state({ reply: replyTo(ME) }, [
    { text: 'a' },
    { text: 'b' },
  ]),
  unicode: state({}, [{ text: ' 👩‍👩‍👧 café ' }, { text: ' two ' }]),
  textsLoose: state({}, [{ text: 5 }, { text: 'kept' }, { text: null }]),
  noAsDid: { posts: [{ text: 'x' }], reply: replyTo(OTHER) },
  postsString: { asDid: ME, posts: 'ab' },
  postsLengthy: { asDid: ME, posts: { length: 3 } },
  nothing: null,
};

const GOAL_SETUPS = [
  {
    goals: {
      presets: {
        reduceNegativity: true,
        lessConfrontational: true,
        limitTopic: { enabled: true, topic: ' politics ' },
      },
      customText: 'be kind',
    },
    writingChecks: { typos: true, clarity: true },
  },
  { goals: { customText: 'x' } },
  { goals: { presets: { limitTopic: { enabled: true, topic: ' ' } } } },
  { goals: { presets: { limitTopic: { enabled: false, topic: 'x' } } } },
  { goals: { presets: { limitTopic: { enabled: 1, topic: 5 } } } },
  { goals: { presets: { reduceNegativity: 'yes', lessConfrontational: 0 } } },
  { goals: { customText: '   ' } },
  { writingChecks: { typos: 'true', grammar: true, clarity: true } },
  { writingChecks: { grammar: true } },
  { goals: 'none', writingChecks: [] },
  undefined,
  null,
  seeded,
];

const node = (author, text, parent) => ({
  post: { author, record: { text } },
  ...(parent ? { parent } : {}),
});

const chain = (n) => {
  let at = null;
  for (let i = n; i >= 1; i--) {
    at = {
      post: {
        author: { handle: `p${i}.example` },
        record: { text: `post ${i}` },
      },
      ...(at ? { parent: at } : {}),
    };
  }
  return at;
};

const replyState = (extra = {}) =>
  state({
    reply: replyTo(OTHER, {
      author: { did: OTHER, handle: 'other.example.com' },
      text: 'the reply target',
      ...extra,
    }),
  });

const GATHERS = [
  {
    $id: 'reads-the-conversation',
    state: replyState(),
    kind: 'reply',
    answers: [
      json({
        thread: node(
          { did: OTHER, handle: 'other.example.com' },
          'the reply target',
          node({ did: 'x', displayName: ' Sam ' }, 'the root'),
        ),
      }),
    ],
  },
  {
    $id: 'falls-back-on-a-failure',
    state: state({
      reply: replyTo(OTHER, { author: { displayName: 'Ana' }, text: 'hello' }),
    }),
    kind: 'reply',
    answers: [json({ error: 'NotFound', message: 'Post not found' }, 400)],
  },
  {
    $id: 'falls-back-offline',
    state: state({ reply: replyTo(OTHER, { text: 'hello' }) }),
    kind: 'reply',
    answers: ['offline'],
  },
  {
    $id: 'falls-back-on-a-bad-answer',
    state: state({ reply: replyTo(OTHER, { text: 'hello' }) }),
    kind: 'reply',
    answers: [{ status: 200, text: '<html>' }],
  },
  {
    $id: 'quote-target-from-the-view',
    state: state({}, [
      quoting(OTHER, 'post', {
        view: {
          author: { handle: 'q.example.com' },
          record: { text: 'quoted words' },
        },
      }),
    ]),
    kind: 'quote',
    answers: [json({ error: 'nope' }, 502)],
  },
  {
    $id: 'quote-read-with-its-thread',
    state: state({}, [
      quoting(OTHER, 'post', {
        view: {
          author: { handle: 'q.example.com' },
          value: { text: 'from value' },
        },
      }),
    ]),
    kind: 'quote',
    answers: [
      json({
        thread: node({ handle: 'q.example.com' }, 'quoted', node({}, 'above')),
      }),
    ],
  },
  {
    $id: 'target-from-the-thread',
    state: state({ reply: replyTo(OTHER) }),
    kind: 'reply',
    answers: [
      json({ thread: node({ handle: 'p.example.com' }, 'parent text') }),
    ],
  },
  {
    $id: 'self-reply',
    state: state({ reply: replyTo(ME, { text: 'mine' }) }),
    kind: 'selfReply',
    answers: [
      json({
        thread: node(
          { did: ME, handle: 'me.example' },
          'mine',
          node({ did: ME }, 'first'),
        ),
      }),
    ],
  },
  {
    $id: 'a-long-thread',
    state: state({ reply: replyTo(OTHER) }),
    kind: 'reply',
    answers: [json({ thread: chain(9) })],
  },
  {
    $id: 'gaps-in-the-thread',
    state: state({ reply: replyTo(OTHER, { text: 'target' }) }),
    kind: 'reply',
    answers: [
      json({
        thread: {
          post: { author: { handle: 'a.example' }, record: { text: '  ' } },
          parent: {
            post: {
              author: { displayName: '   ', handle: 'b.example' },
              text: 'bare text',
            },
            parent: {
              notFound: true,
              uri: postUri('did:plc:gone'),
              parent: node({ handle: 'never.example' }, 'unreached'),
            },
          },
        },
      }),
    ],
  },
  {
    $id: 'authors-of-every-kind',
    state: state({ reply: replyTo(OTHER) }),
    kind: 'reply',
    answers: [
      json({
        thread: node(
          { handle: 5 },
          'numeric handle',
          node(
            { displayName: 7, handle: '' },
            'no name at all',
            node(
              null,
              'no author',
              node({ displayName: ' Zoë ' }, 'trimmed name'),
            ),
          ),
        ),
      }),
    ],
  },
  {
    $id: 'an-empty-answer',
    state: state({ reply: replyTo(OTHER, { text: 't' }) }),
    kind: 'reply',
    answers: [json({})],
  },
  {
    $id: 'a-null-answer',
    state: state({ reply: replyTo(OTHER, { text: 't' }) }),
    kind: 'reply',
    answers: [json(null)],
  },
  {
    $id: 'nothing-anywhere',
    state: state({ reply: replyTo(OTHER) }),
    kind: 'reply',
    answers: [json({ thread: { post: { record: {} } } })],
  },
  {
    $id: 'unicode-uri',
    state: state({
      reply: { uri: postUri('did:plc:é', 'ü 1'), cid: 'c', text: 'x' },
    }),
    kind: 'reply',
    answers: [json({ thread: node({ handle: 'u.example' }, 'ünïcode') })],
  },
  {
    $id: 'uri-not-a-string',
    state: state({ reply: { uri: 42, cid: 'c', text: 'x' } }),
    kind: 'reply',
    answers: [json({ thread: null })],
  },
  { $id: 'no-kind', state: state({ reply: replyTo(OTHER) }), kind: null },
  { $id: 'empty-kind', state: state({ reply: replyTo(OTHER) }), kind: '' },
  { $id: 'no-reply', state: state(), kind: 'reply' },
  { $id: 'reply-without-uri', state: STATES.replyNoUri, kind: 'reply' },
  { $id: 'no-quote', state: state(), kind: 'quote' },
  { $id: 'feed-is-not-a-quote', state: STATES.quoteFeed, kind: 'quote' },
  {
    $id: 'other-kinds-read-the-reply',
    state: state({ reply: replyTo(OTHER, { text: 'x' }) }),
    kind: 'thread',
    answers: [json({ thread: node({ handle: 'r.example' }, 'read') })],
  },
];

const RESULTS = [
  { overallStatus: 'conflict' },
  { overallStatus: 'caution' },
  { overallStatus: 'ok', writing: { issues: [{ found: 'x' }] } },
  { overallStatus: 'ok', writing: { issues: [] } },
  { overallStatus: 'ok', writing: { issues: 'x' } },
  { overallStatus: 'ok' },
  {},
  null,
  0,
  'x',
];

export default async function cases() {
  const all = [
    value('contextConstants', {
      READ_MIN_MS,
      SLOW_READ_AFTER_MS,
      CONTEXT_PARENT_HEIGHT,
      ADVISER_GATE_TIMEOUT_MS,
      ADVISER_CONTEXT_TIMEOUT_MS,
    }),
  ];
  all.push(
    ...(await each(
      'adviserGoalItems',
      GOAL_SETUPS.map((adviser) => ({ adviser })),
      ({ adviser }) => ({
        items: adviserGoalItems(adviser),
        count: adviserGoalCount(adviser),
      }),
    )),
  );
  all.push(
    ...(await each(
      'readExpectation',
      [0, 1000, 7999, 8000, 8000.5, 60000, '8000', 'soon', null, -1].map(
        (elapsedMs) => ({ elapsedMs }),
      ),
      ({ elapsedMs }) => readExpectation(elapsedMs),
    )),
  );
  // The states and setups once; each case names its own.
  all.push(value('contextStates', STATES));
  all.push(value('contextSetups', SETUPS));
  const facts = [];
  for (const name of Object.keys(STATES)) {
    facts.push({ $id: name, state: name });
    facts.push({ $id: `${name}/as-me`, state: name, asDid: ME });
    facts.push({ $id: `${name}/as-other`, state: name, asDid: OTHER });
  }
  all.push(
    ...(await each('adviserDraftFacts', facts, ({ state: name, asDid }) =>
      asDid === undefined
        ? adviserDraftFacts(STATES[name])
        : adviserDraftFacts(STATES[name], { asDid }),
    )),
  );
  all.push(
    ...(await each(
      'adviserSource',
      Object.keys(STATES)
        .filter((name) => !['postsString', 'postsLengthy'].includes(name))
        .map((name) => ({ $id: name, state: name })),
      ({ state: name }) => adviserSource(STATES[name]),
    )),
  );
  const plans = [];
  for (const setup of Object.keys(SETUPS))
    for (const name of [
      'post',
      'empty',
      'thread',
      'replyOther',
      'replySelf',
      'replySelfAsAlt',
      'quoteOther',
      'quoteAndReply',
      'unicode',
      'noAsDid',
    ])
      // Every setup with AI on; the seeded one with every option.
      for (const opts of setup === 'seeded'
        ? [
            { canUseAi: true },
            { canUseAi: false },
            { canUseAi: true, atLimit: true },
            { canUseAi: true, asDid: OTHER },
          ]
        : [{ canUseAi: true }])
        plans.push({
          $id: `${setup}/${name}/${JSON.stringify(opts)}`,
          setup,
          state: name,
          ...opts,
        });
  plans.push({
    $id: 'no-options',
    setup: 'seeded',
    state: 'post',
    noOptions: true,
  });
  all.push(
    ...(await each(
      'adviserReadPlan',
      plans,
      ({ setup, state: name, noOptions, ...opts }) => {
        const adviser = SETUPS[setup];
        const s = STATES[name];
        const plan = noOptions
          ? adviserReadPlan(adviser, s)
          : adviserReadPlan(adviser, s, opts);
        const ctx = {
          kind: 'reply',
          thread: [{ author: 'a', text: 'b' }],
          target: null,
        };
        return {
          plan,
          payload: analyzePayload(plan),
          withContext: analyzePayload(plan, ctx),
        };
      },
    )),
  );
  all.push(
    ...(await each(
      'adviserShouldInterrupt',
      RESULTS.flatMap((result) =>
        [undefined, 'significant', 'always', 'odd', null].map((reviewMode) => ({
          result,
          reviewMode,
        })),
      ),
      ({ result, reviewMode }) =>
        reviewMode === undefined
          ? adviserShouldInterrupt(result)
          : adviserShouldInterrupt(result, reviewMode),
    )),
  );
  all.push(
    ...(await each(
      'gatherReplyContext',
      GATHERS,
      ({ state: s, kind, answers = [] }) =>
        recordFetch(inTurn(...(answers.length ? answers : [json({})])), () =>
          gatherReplyContext(s, kind),
        ),
    )),
  );
  return all;
}
