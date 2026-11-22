// The fake server's pure rules (harness/fakeServer.js): how it reads a
// timer's rule (parseEffects, parseConditions, narrowAllow, describeAllow,
// the server's own, ported there), which limit a timer counts against,
// whether a rule spares a post, and the adviser's stand-in judgement.
// Inputs are JSON as a request body carries it, with every odd shape a
// writer could send: keys of Object.prototype among the allow words, the
// legacy `minLikes` keys, numbers as text, Infinity, more than five parts.
// Swift: VirgaDemo/Harness/FakeServer+Rules.swift and +Adviser.swift; tests
// in ios/VirgaKit/Tests/VirgaDemoTests/DemoServerRulesParityTests.swift.

import {
  analyzePost,
  describeAllow,
  evaluateConditions,
  narrowAllow,
  parseConditions,
  parseEffects,
  timerBucket,
} from '../../../harness/fakeServer.js';
import { each } from './_helpers.js';

export const sources = ['harness/fakeServer.js'];

const GATE = 'app.bsky.feed.threadgate';
const LIST = 'at://did:plc:x/app.bsky.graph.list/moots';
const rule = (name) => ({ $type: `${GATE}#${name}` });

const NARROW = [
  // fakeServer.test.js's, held there to the server's own.
  [['follower'], undefined],
  [['follower', { list: LIST }], undefined],
  [['follower'], [rule('mentionRule')]],
  [['follower'], [rule('followerRule'), rule('followingRule')]],
  [['follower'], [rule('followerRule')]],
  [['follower'], []],
  [[], [rule('followerRule')]],
  [
    [{ list: LIST }],
    [{ $type: `${GATE}#listRule`, list: LIST }, rule('mentionRule')],
  ],
  [[{ list: LIST }], [{ $type: `${GATE}#listRule`, list: `${LIST}2` }]],
  // And the rest.
  [undefined, undefined],
  [null, [rule('followerRule')]],
  [
    ['following', 'mention'],
    [rule('followingRule'), rule('mentionRule'), rule('followerRule')],
  ],
  [
    ['following', 'mention'],
    [rule('mentionRule'), rule('followingRule')],
  ],
  [
    ['nobody', 7, null, { list: 'http://x' }, { list: 5 }, ['follower']],
    undefined,
  ],
  [['nobody'], [rule('followerRule')]],
  [['toString'], undefined],
  [['constructor', '__proto__', 'hasOwnProperty'], [rule('followerRule')]],
  [
    ['follower'],
    [null, 'x', { $type: 5 }, { $type: '' }, rule('followerRule')],
  ],
  [['follower'], [{ $type: `${GATE}#listRule` }, rule('followerRule')]],
  [[{ list: LIST }], [{ $type: `${GATE}#listRule`, list: LIST }]],
  [
    ['follower', 'follower'],
    [rule('followerRule'), rule('mentionRule')],
  ],
  [['follower'], { allow: [] }],
  [['follower'], 'followerRule'],
  ['follower', undefined],
  [0, [rule('followerRule')]],
];

const DESCRIBE = [
  [],
  ['follower'],
  ['follower', 'following'],
  ['follower', 'following', 'mention'],
  [{ list: LIST }],
  [{ list: LIST }, { list: `${LIST}2` }, 'mention'],
  ['following', { list: LIST }, { list: LIST }, { list: LIST }],
  ['nobody', null, 5, { list: '' }, { list: 0 }],
  ['toString'],
  ['follower', 'constructor', '__proto__'],
  undefined,
  null,
];

const EFFECTS = [
  undefined,
  null,
  [],
  'delete',
  { action: 'delete' },
  5,
  [{ action: 'delete' }],
  [
    { action: 'disableQuotes' },
    { action: 'limitReplies' },
    { action: 'delete' },
  ],
  [{ action: 'limitReplies', allow: ['following'] }],
  [
    { action: 'limitReplies', allow: ['following'] },
    { action: 'limitReplies', allow: ['mention'] },
  ],
  [{ action: 'limitReplies', allow: [] }],
  [{ action: 'limitReplies', allow: 'following' }],
  [{ action: 'limitReplies', allow: ['a', 'follower'] }],
  [
    {
      action: 'limitReplies',
      allow: [
        'follower',
        'following',
        'mention',
        { list: LIST },
        { list: `${LIST}2` },
        { list: `${LIST}3` },
      ],
    },
  ],
  [{ action: 'limitReplies', allow: ['toString', 'valueOf'] }],
  [{ action: 'limitReplies', allow: [{ list: LIST, extra: true }] }],
  [{ action: 'explode' }],
  [null],
  ['delete'],
  [{ action: 'delete' }, { action: 'delete' }],
  [
    { action: 'disableQuotes' },
    { action: 'delete' },
    { action: 'disableQuotes' },
  ],
  [{ action: 'constructor' }],
];

const clause = (metric, value, extra = {}) => ({
  metric,
  op: 'gte',
  value,
  ...extra,
});
const CONDITIONS = [
  undefined,
  null,
  'likes',
  5,
  [],
  [clause('likes', 3)],
  {},
  { clauses: [clause('likes', 20)], sense: 'unless' },
  {
    clauses: [clause('likes', 20, { op: 'gt' }), clause('replies', '4')],
    logic: 'all',
    sense: 'onlyIf',
  },
  { clauses: [clause('likes', 1.9)] },
  { clauses: [clause('likes', 0.5)] },
  { clauses: [clause('likes', -3)] },
  { clauses: [clause('likes', 'many')] },
  { clauses: [clause('likes', null)] },
  { clauses: [clause('likes')] },
  { clauses: [clause('likes', 'Infinity')] },
  { clauses: [clause('likes', 5_000_000)] },
  { clauses: [clause('likes', true)] },
  { clauses: [clause('likes', [7])] },
  { clauses: [clause('views', 3)] },
  { clauses: [null] },
  { clauses: ['likes'] },
  { clauses: [clause('replies', 2, { from: ['did:plc:x'] })] },
  {
    clauses: [
      clause('quotes', 2, { from: ['did:plc:x'] }),
      clause('quotes', 3),
      clause('quotes', 4),
    ],
  },
  { clauses: [clause('quotes', 2, { from: '' }), clause('quotes', 3)] },
  { clauses: [clause('likes', 3), clause('likes', 5)] },
  {
    clauses: [
      clause('selfReplies', 1),
      clause('quotes', 1),
      clause('reposts', 1),
      clause('replies', 1),
      clause('likes', 1),
    ],
  },
  {
    clauses: [
      clause('likes', 1),
      clause('replies', 1),
      clause('reposts', 1),
      clause('quotes', 1),
      clause('selfReplies', 1),
      clause('quotes', 2, { from: ['a'] }),
    ],
  },
  { minLikes: 10 },
  { minLikes: 10, minReplies: '2', minReposts: 0 },
  { minLikes: 10, clauses: [clause('likes', 3)] },
  { clauses: 'likes', minReplies: 4 },
  { minLikes: null },
  { mode: 'all', clauses: [clause('likes', 2)] },
  { mode: 'all', logic: 'any', clauses: [clause('likes', 2)] },
  { logic: 'ALL', mode: 'every' },
  { onSpare: 'extend' },
  { onSpare: 'extend', maxExtensions: 3 },
  { onSpare: 'extend', maxExtensions: '25' },
  { onSpare: 'extend', maxExtensions: 0 },
  { onSpare: 'extend', maxExtensions: -4 },
  { onSpare: 'extend', maxExtensions: 2.7 },
  { onSpare: 'extend', maxExtensions: null },
  { onSpare: 'extend', maxExtensions: 'lots' },
  { onSpare: 'keep', maxExtensions: 3 },
  { sense: 'onlyif' },
];

const BUCKETS = [
  {},
  { conditions: {}, effects: [] },
  { conditions: { clauses: [] }, effects: [{ action: 'delete' }] },
  {
    conditions: { clauses: [clause('likes', 1)] },
    effects: [{ action: 'delete' }],
  },
  { conditions: null, effects: [{ action: 'limitReplies', allow: [] }] },
  {
    conditions: { clauses: [] },
    effects: [{ action: 'delete' }, { action: 'disableQuotes' }],
  },
  { effects: [{}] },
  { effects: null },
  { conditions: { clauses: 'x' } },
  { conditions: { clauses: '' } },
];

const COUNTS = { likes: 12, replies: 3, reposts: 0, quotes: 2, selfReplies: 1 };
const EVALUATE = [
  {
    conditions: {
      logic: 'any',
      clauses: [clause('likes', 10)],
      sense: 'unless',
    },
    counts: COUNTS,
  },
  {
    conditions: {
      logic: 'any',
      clauses: [clause('likes', 20)],
      sense: 'unless',
    },
    counts: COUNTS,
  },
  {
    conditions: {
      logic: 'any',
      clauses: [clause('likes', 12, { op: 'gt' })],
      sense: 'unless',
    },
    counts: COUNTS,
  },
  {
    conditions: {
      logic: 'any',
      clauses: [clause('likes', 12)],
      sense: 'onlyIf',
    },
    counts: COUNTS,
  },
  {
    conditions: {
      logic: 'all',
      clauses: [clause('likes', 10), clause('replies', 5)],
      sense: 'unless',
    },
    counts: COUNTS,
  },
  {
    conditions: {
      logic: 'all',
      clauses: [clause('likes', 10), clause('replies', 3)],
      sense: 'onlyIf',
    },
    counts: COUNTS,
  },
  {
    conditions: {
      logic: 'any',
      clauses: [
        clause('reposts', 1),
        clause('quotes', 2),
        clause('selfReplies', 2),
      ],
    },
    counts: COUNTS,
  },
  { conditions: { logic: 'all', clauses: [] }, counts: COUNTS },
  { conditions: { logic: 'any', clauses: [] }, counts: COUNTS },
  {
    conditions: { logic: 'any', clauses: [clause('views', 1)] },
    counts: COUNTS,
  },
  { conditions: { clauses: [clause('likes', 1)] }, counts: {} },
  { conditions: null, counts: COUNTS },
];

const goals = (presets, extra = {}) => ({ presets, ...extra });
const ANALYZE = [
  // fakeServer.test.js's.
  {
    text: 'This is the the worst bus timetable',
    goals: goals({ reduceNegativity: true }),
    writingChecks: { typos: true },
  },
  { text: 'hello', goals: {} },
  { text: 'I hate this', goals: goals({ reduceNegativity: true }) },
  // And the rest.
  { text: 'hello' },
  { text: 'hello', goals: null, writingChecks: null },
  { text: 'hello', goals: 'loud', writingChecks: [] },
  { text: 'hello', writingChecks: { typos: false, grammar: 0, clarity: '' } },
  {
    text: 'Thanks for coming, it was lovely',
    goals: goals({ reduceNegativity: true }),
  },
  {
    text: 'A HATEFUL thing, but I HATE it.',
    goals: goals({ reduceNegativity: true }),
  },
  {
    text: 'We waited outside the library for an hour and honestly the whole thing was awful from start to end today.',
    goals: goals({ reduceNegativity: true, lessConfrontational: true }),
  },
  {
    text: 'Actually, you people should read it?!',
    goals: goals({ lessConfrontational: true }),
  },
  {
    text: 'imagine thinking that. cope.',
    goals: goals({ lessConfrontational: true }),
  },
  {
    text: 'ratio',
    goals: goals({ lessConfrontational: true, reduceNegativity: true }),
  },
  { text: 'is it real?!', goals: goals({ lessConfrontational: true }) },
  {
    text: 'factually ratios coping',
    goals: goals({ lessConfrontational: true }),
  },
  {
    text: 'the ſtupid kelvin Kelvin idiot_ idiot',
    goals: goals({ reduceNegativity: true }),
  },
  {
    text: 'Bus lanes and parking, again.',
    goals: goals({ limitTopic: { enabled: true, topic: 'parking, bikes,, ' } }),
  },
  {
    text: 'All about BIKES today',
    goals: goals({ limitTopic: { enabled: true, topic: 'parking,bikes' } }),
  },
  {
    text: 'Nothing here',
    goals: goals({ limitTopic: { enabled: true, topic: 'parking' } }),
  },
  {
    text: 'Nothing here',
    goals: goals({ limitTopic: { enabled: false, topic: 'parking' } }),
  },
  {
    text: 'about 5 things',
    goals: goals({ limitTopic: { enabled: true, topic: 5 } }),
  },
  {
    text: 'about things',
    goals: goals({ limitTopic: { enabled: true, topic: ' , ' } }),
  },
  { text: 'nothing', goals: goals({ limitTopic: { enabled: true } }) },
  { text: 'nothing', goals: { customText: 'Be kind' } },
  { text: 'nothing', goals: { customText: '   ' } },
  { text: 'nothing', goals: { customText: 7 } },
  { text: 'the The cat cat', writingChecks: { typos: true } },
  { text: 'the theory holds', writingChecks: { typos: true } },
  { text: 'go  go home', writingChecks: { typos: true } },
  { text: 'café café', writingChecks: { typos: true } },
  { text: 'K K', writingChecks: { typos: true } },
  { text: 'no doubles here', writingChecks: { typos: true } },
  { text: 'i think so', writingChecks: { grammar: true } },
  { text: "so i'm here", writingChecks: { grammar: true } },
  { text: 'what i\tsaid and i said', writingChecks: { grammar: true } },
  { text: 'hi', writingChecks: { grammar: true } },
  { text: 'I am fine', writingChecks: { grammar: true } },
  {
    text: `${Array.from({ length: 45 }, (_, i) => `w${i}`).join(' ')}. Short one.`,
    writingChecks: { clarity: true },
  },
  {
    text: `Short. ${Array.from({ length: 41 }, () => 'x').join('  ')}! And more.`,
    writingChecks: { clarity: true, typos: true },
  },
  {
    text: `${Array.from({ length: 40 }, () => 'y').join(' ')}`,
    writingChecks: { clarity: true },
  },
  {
    text: ` ${Array.from({ length: 40 }, () => 'y').join(' ')}`,
    writingChecks: { clarity: true },
  },
  { text: 'One.  Two?\nThree!', writingChecks: { clarity: true } },
  {
    text: 'This is the the worst. i hate it, you people.',
    goals: goals(
      {
        reduceNegativity: true,
        lessConfrontational: true,
        limitTopic: { enabled: true, topic: 'worst' },
      },
      { customText: 'calm' },
    ),
    writingChecks: { typos: true, grammar: true, clarity: true },
  },
  {
    text: 'emoji 😀 hate 😀',
    goals: goals({ reduceNegativity: true }),
    writingChecks: { typos: true },
  },
  { text: 'hello', goals: [1], writingChecks: 'typos' },
  {
    text: 'hello',
    goals: { presets: 'reduceNegativity' },
    writingChecks: { typos: 1 },
  },
];

export default async function cases() {
  return [
    ...(await each(
      'narrowAllow',
      NARROW.map(([wanted, existing], i) => ({
        $id: `narrow#${i}`,
        wanted,
        existing,
      })),
      ({ wanted, existing }) => narrowAllow(wanted, existing),
    )),
    ...(await each(
      'describeAllow',
      DESCRIBE.map((entries, i) => ({ $id: `describe#${i}`, entries })),
      ({ entries }) => describeAllow(entries),
    )),
    ...(await each(
      'parseEffects',
      EFFECTS.map((raw, i) => ({ $id: `effects#${i}`, raw })),
      ({ raw }) => parseEffects(raw),
    )),
    ...(await each(
      'parseConditions',
      CONDITIONS.map((raw, i) => ({ $id: `conditions#${i}`, raw })),
      ({ raw }) => parseConditions(raw),
    )),
    ...(await each(
      'timerBucket',
      BUCKETS.map((rule, i) => ({ $id: `bucket#${i}`, ...rule })),
      (rule) => timerBucket(rule),
    )),
    ...(await each(
      'evaluateConditions',
      EVALUATE.map((c, i) => ({ $id: `evaluate#${i}`, ...c })),
      ({ conditions, counts }) => evaluateConditions(conditions, counts),
    )),
    ...(await each(
      'analyzePost',
      ANALYZE.map((body, i) => ({ $id: `analyze#${i}`, ...body })),
      (body) => analyzePost(body),
    )),
  ];
}
