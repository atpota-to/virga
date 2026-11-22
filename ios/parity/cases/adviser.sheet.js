// src/posting/adviser/{sheet,sheetView}.js: the adviser sheet's layout of a
// read (the verdict, where each finding is marked in the draft, how the notes
// are numbered, the proofread's count line, the draft's caption) and its
// words and buttons (the title, the footer, the context line, the thread
// labels). Swift: VirgaPosting/Adviser/{Sheet,SheetView}.swift.
//
// Inputs from sheet.test.js and adviserUi.test.js, plus overlapping,
// touching, nested and crossing passages, excerpts in several posts, unicode
// offsets, loose reads and loose results.

import {
  adviserDraftLabel,
  adviserSheetModel,
  adviserVerdict,
  adviserWritingTally,
  placeAdviserMarks,
} from '../../../src/posting/adviser/sheet.js';
import {
  STATUS_WORDS,
  VERDICT_COPY,
  WRITING_TYPE_LABELS,
  fixAllLabel,
  postIndexLabel,
  readFoundSomething,
  sheetActions,
  sheetContextLine,
  sheetTitle,
} from '../../../src/posting/adviser/sheetView.js';
import { each, value } from './_helpers.js';

export const sources = [
  'src/posting/adviser/sheet.js',
  'src/posting/adviser/sheetView.js',
];

const placed = (out) => ({ posts: out.posts, placed: [...out.placed] });

const MARKS = [
  {
    $id: 'first-occurrence-first-post',
    posts: ['no slip here', 'teh cat and teh dog'],
    fixes: [{ key: 'fix:0', found: 'teh' }],
  },
  {
    $id: 'fix-inside-span',
    posts: ['you clearly havent read it. ok'],
    spans: [{ key: 'check:0', excerpt: 'you clearly havent read it.' }],
    fixes: [{ key: 'fix:0', found: 'havent' }],
  },
  {
    $id: 'overlapping-passages-merge',
    posts: ['AI sucks, anti people suck, the end'],
    spans: [
      { key: 'a', excerpt: 'AI sucks' },
      { key: 'b', excerpt: 'anti people suck' },
      { key: 'c', excerpt: 'AI sucks, anti people suck' },
    ],
  },
  {
    $id: 'touching-passages-apart',
    posts: ['one two'],
    spans: [
      { key: 'a', excerpt: 'one' },
      { key: 'b', excerpt: ' two' },
    ],
  },
  {
    $id: 'crossing-and-overlapping-fixes',
    posts: ['alpha beta gamma delta'],
    spans: [{ key: 'a', excerpt: 'beta gamma' }],
    fixes: [
      { key: 'f', found: 'alpha beta' },
      { key: 'g', found: 'delta' },
      { key: 'h', found: 'elt' },
    ],
  },
  {
    $id: 'spanning-two-posts',
    posts: ['end of one', 'start of two'],
    spans: [{ key: 's', excerpt: 'one\n\nstart' }],
    fixes: [{ key: 'f', found: '' }],
  },
  {
    $id: 'same-start-different-ends',
    posts: ['abcdefghij'],
    spans: [
      { key: 'long', excerpt: 'abcdefgh' },
      { key: 'short', excerpt: 'abc' },
      { key: 'mid', excerpt: 'cdef' },
      { key: 'late', excerpt: 'hij' },
    ],
    fixes: [
      { key: 'x', found: 'b' },
      { key: 'y', found: 'gh' },
      { key: 'z', found: 'ij' },
    ],
  },
  {
    $id: 'fixes-out-of-order',
    posts: ['one two three four five'],
    fixes: [
      { key: 'd', found: 'four' },
      { key: 'b', found: 'two' },
      { key: 'e', found: 'five' },
      { key: 'a', found: 'one' },
    ],
  },
  {
    $id: 'fix-same-as-span',
    posts: ['exactly this'],
    spans: [{ key: 's', excerpt: 'exactly this' }],
    fixes: [{ key: 'f', found: 'exactly this' }],
  },
  {
    $id: 'two-fixes-same-text',
    posts: ['teh teh'],
    fixes: [
      { key: 'f1', found: 'teh' },
      { key: 'f2', found: 'teh' },
    ],
  },
  {
    $id: 'unicode-offsets',
    posts: ['👩‍👩‍👧 café naïve 😀 smile', 'café again'],
    spans: [
      { key: 'emoji', excerpt: '😀' },
      { key: 'nfd', excerpt: 'café' },
    ],
    fixes: [
      { key: 'nfc', found: 'café' },
      { key: 'smile', found: 'smile' },
    ],
  },
  {
    $id: 'loose-entries',
    posts: ['a b c', 5, null, 'b'],
    spans: [
      null,
      { key: 'n', excerpt: 5 },
      { key: 'w', excerpt: '  ' },
      { key: 'b', excerpt: 'b' },
    ],
    fixes: [{ key: 'c', found: 'c' }, null, { key: 'x' }],
  },
  { $id: 'no-posts', posts: undefined, spans: [{ key: 'a', excerpt: 'a' }] },
  {
    $id: 'posts-not-a-list',
    posts: 'abc',
    spans: [{ key: 'a', excerpt: 'a' }],
  },
  {
    $id: 'same-key-twice',
    posts: ['a b a'],
    spans: [
      { key: 'k', excerpt: 'a' },
      { key: 'k', excerpt: 'b' },
    ],
    fixes: [{ key: 'k', found: 'a b' }],
  },
];

const CONFLICT_READ = {
  sentiment: { label: 'negative', score: -0.6 },
  overallStatus: 'conflict',
  suggestion: 'Lead with the numbers.',
  checks: [
    {
      id: 'reduceNegativity',
      label: 'Reduce negativity',
      status: 'caution',
      note: 'Weary.',
      excerpt: 'Honestly exhausted.',
    },
    {
      id: 'lessConfrontational',
      label: 'Less confrontational',
      status: 'conflict',
      note: 'Aimed at people.',
      excerpt: 'has not read past the headline',
    },
    {
      id: 'limitTopic',
      label: 'Limit AI topic',
      status: 'ok',
      note: 'Fine.',
      excerpt: null,
    },
    {
      id: 'custom',
      label: 'Custom goals',
      status: 'caution',
      note: 'Hmm.',
      excerpt: 'not in the draft',
    },
  ],
  writing: {
    issues: [
      {
        type: 'typo',
        found: 'teh',
        replacement: 'the',
        note: 'Swapped letters.',
      },
      {
        type: 'clarity',
        found: 'The sample was small',
        replacement: null,
        note: 'Small compared to what?',
      },
    ],
  },
};
const CONFLICT_POSTS = [
  'Honestly exhausted. Anyone who disagrees has not read past the headline. The sample was small, teh end.',
];
const TALLY_POSTS = ['teh cat sat on teh mat and then their was more'];
const TYPOS = [
  { type: 'typo', found: 'teh cat', replacement: 'the cat' },
  { type: 'typo', found: 'teh mat', replacement: 'the mat' },
];
const MIXED = [
  { type: 'typo', found: 'teh cat', replacement: 'the cat' },
  { type: 'grammar', found: 'their was', replacement: 'there was' },
  { type: 'clarity', found: 'and then', replacement: null, note: 'Then what?' },
];
const OK = {
  checks: [
    { id: 'reduceNegativity', label: 'Reduce negativity', status: 'ok' },
  ],
  overallStatus: 'ok',
  writing: { issues: [] },
};
const CONFLICT = {
  checks: [{ id: 'limitTopic', label: 'Limit topics', status: 'conflict' }],
  overallStatus: 'conflict',
};
const TYPO = {
  ...OK,
  writing: { issues: [{ type: 'typo', found: 'the the', replacement: 'the' }] },
};

const MODELS = [
  { $id: 'conflict-read', result: CONFLICT_READ, posts: CONFLICT_POSTS },
  {
    $id: 'no-goal-checks',
    result: { checks: [], overallStatus: 'ok', writing: { issues: [] } },
    posts: ['hi'],
  },
  { $id: 'nothing', result: null, posts: undefined },
  {
    $id: 'typos',
    result: { checks: [], writing: { issues: TYPOS } },
    posts: TALLY_POSTS,
  },
  {
    $id: 'mixed',
    result: { checks: [], writing: { issues: MIXED } },
    posts: TALLY_POSTS,
  },
  { $id: 'no-proofread', result: { checks: [] }, posts: ['hi'] },
  { $id: 'ok', result: OK, posts: ['x'] },
  { $id: 'conflict', result: CONFLICT, posts: ['about politics'] },
  { $id: 'typo', result: TYPO, posts: ['see the the thing'] },
  {
    $id: 'loose-checks',
    result: {
      overallStatus: 'odd',
      checks: [
        null,
        'text',
        [],
        { status: 'conflict', excerpt: 'x' },
        { id: 'idOnly', status: 'caution', excerpt: 'y' },
        { label: '', id: '', status: 'ok' },
        { label: 0, id: 7, status: 'ok' },
        { status: 'CONFLICT', label: 'Shouting' },
      ],
      sentiment: { label: 5 },
      writing: [],
    },
    posts: ['x y z'],
  },
  {
    $id: 'loose-issues',
    result: {
      checks: [],
      writing: {
        issues: [
          null,
          { found: '  ' },
          { found: 5, replacement: 'five' },
          { type: 'typo', found: 'same', replacement: 'same' },
          { found: 'kept', note: 7 },
          { type: { odd: true }, found: 'odd', replacement: 'even' },
          { type: 'grammar', found: 'missing', replacement: 'gone' },
        ],
      },
    },
    posts: ['same kept odd', 'nothing'],
  },
  {
    $id: 'writing-not-an-object',
    result: { checks: [{ status: 'ok', label: 'A' }], writing: 'yes' },
    posts: ['a'],
  },
  {
    $id: 'thread-and-unicode',
    result: {
      overallStatus: 'caution',
      checks: [
        { id: 'a', label: 'A', status: 'caution', excerpt: '😀 here' },
        { id: 'b', label: 'B', status: 'conflict', excerpt: 'café' },
      ],
      writing: {
        issues: [
          { type: 'typo', found: 'herre', replacement: 'here' },
          { type: 'clarity', found: '😀', note: 'Which?' },
          { type: 'grammar', found: 'second', replacement: 'Second' },
        ],
      },
    },
    posts: ['first 😀 here and herre', 'second café', 'third café'],
  },
];

const TAKEN = [
  [],
  ['fix:0'],
  ['fix:0', 'fix:1'],
  ['fix:1', 'other'],
  ['fix:2'],
];

const ready = (result, extra = {}) => ({
  status: 'ready',
  mode: 'gate',
  result,
  posts: ['see the the thing'],
  taken: [],
  ...extra,
});
const thread = (n) =>
  Array.from({ length: n }, () => ({ author: 'a', text: 'b' }));

const READS = [
  { read: ready(CONFLICT) },
  { read: ready(OK) },
  { read: ready(TYPO) },
  { read: ready(TYPO, { taken: ['fix:0'] }) },
  { read: ready(TYPO, { taken: 'fix:0' }) },
  { read: ready(TYPO, { posts: null }) },
  { read: ready(null) },
  { read: { status: 'error' } },
  { read: { status: 'error', mode: 'manual' } },
  { read: { status: 'needsText' } },
  { read: { status: 'empty' } },
  { read: { status: 'limit' } },
  { read: null },
  { read: { mode: 'manual', status: 'ready', result: OK, posts: ['x'] } },
  { read: ready(CONFLICT, { mode: 'manual' }) },
];

const CONTEXTS = [
  ready(OK, { contextKind: 'reply', context: { thread: thread(3) } }),
  ready(OK, { contextKind: 'reply', context: { thread: thread(1) } }),
  ready(OK, { contextKind: 'quote', context: { thread: thread(1) } }),
  ready(OK, { contextKind: 'quote', context: { thread: thread(4) } }),
  ready(OK, { contextKind: 'selfReply', context: { thread: thread(2) } }),
  ready(OK, { contextKind: 'selfReply', context: { thread: thread(1) } }),
  ready(OK, { contextKind: 'reply', context: { thread: [] } }),
  ready(OK, {
    contextKind: 'reply',
    context: null,
    scenario: 'reply',
    readTheRoom: false,
  }),
  ready(OK, { contextKind: 'odd', context: { thread: thread(2) } }),
  ready(OK, {
    contextKind: '',
    context: { thread: thread(2) },
    scenario: 'quote',
  }),
  ready(OK, { contextKind: 'reply', context: { thread: 'abc' } }),
  ready(OK, { contextKind: 'reply', context: { thread: { length: 2 } } }),
  ready(OK, { scenario: 'reply', readTheRoom: false }),
  ready(OK, { scenario: 'quote', readTheRoom: false }),
  ready(OK, { scenario: 'reply', readTheRoom: true }),
  ready(OK, { scenario: 'post', readTheRoom: false }),
  ready(OK, { scenario: 'thread' }),
  { status: 'error', scenario: 'reply', readTheRoom: false },
  null,
];

export default async function cases() {
  const all = [
    value('sheetViewConstants', {
      VERDICT_COPY,
      STATUS_WORDS,
      WRITING_TYPE_LABELS,
    }),
  ];
  all.push(
    ...(await each('placeAdviserMarks', MARKS, ({ posts, spans, fixes }) =>
      placed(placeAdviserMarks(posts, { spans, fixes })),
    )),
  );
  all.push(
    ...(await each(
      'adviserVerdict',
      [
        { result: { overallStatus: 'caution', checks: [{ status: 'ok' }] } },
        {
          result: {
            overallStatus: 'odd',
            checks: [{ status: 'ok' }, { status: 'conflict' }],
          },
        },
        { result: { checks: [{ status: 'caution' }] } },
        { result: { checks: [{ status: 'ok' }] } },
        { result: { checks: [], overallStatus: 'conflict' } },
        { result: { overallStatus: 'ok', checks: [{ status: 'conflict' }] } },
        { result: { overallStatus: 'conflict', checks: [null] } },
        {
          result: {
            checks: [null, 'x', { status: 'caution' }, { status: 'conflict' }],
          },
        },
        { result: { checks: 'x' } },
        { result: null },
        { result: { overallStatus: 'OK', checks: [{}] } },
      ],
      ({ result }) => adviserVerdict(result),
    )),
  );
  all.push(
    ...(await each('adviserSheetModel', MODELS, ({ result, posts }) => {
      const model = adviserSheetModel(result, posts);
      return { ...model, posts: model.posts };
    })),
  );
  const tallies = [];
  for (const m of MODELS)
    for (const taken of TAKEN)
      tallies.push({ ...m, $id: `${m.$id}/${taken.join('+')}`, taken });
  all.push(
    ...(await each(
      'adviserWritingTally',
      tallies,
      ({ result, posts, taken }) => ({
        tally: adviserWritingTally(
          adviserSheetModel(result, posts),
          new Set(taken),
        ),
        found: readFoundSomething(adviserSheetModel(result, posts), taken),
      }),
    )),
  );
  all.push(
    ...(await each(
      'adviserWritingTallyNone',
      [{ model: null }, { model: { writingRequested: false } }],
      ({ model }) => adviserWritingTally(model),
    )),
  );
  const labels = [];
  for (const scenario of [
    'post',
    'thread',
    'reply',
    'selfReply',
    'quote',
    'unknown',
    '',
    null,
  ])
    for (const withContext of [true, false])
      labels.push({ scenario, withContext });
  all.push(
    ...(await each('adviserDraftLabel', labels, ({ scenario, withContext }) =>
      adviserDraftLabel(scenario, withContext),
    )),
  );
  all.push(
    ...(await each(
      'sheetTitle',
      [
        { read: { mode: 'gate' } },
        { read: { mode: 'manual' } },
        { read: null },
        { read: { mode: 'Gate' } },
      ],
      ({ read }) => sheetTitle(read),
    )),
  );
  const actions = [];
  for (const r of READS)
    for (const opts of [
      {},
      { canPublish: false },
      { canSaveDraft: false },
      { canPublish: false, canSaveDraft: false },
    ])
      actions.push({ ...r, ...opts });
  all.push(
    ...(await each('sheetActions', actions, ({ read, ...opts }) =>
      sheetActions(read, opts),
    )),
  );
  all.push(
    ...(await each(
      'sheetContextLine',
      CONTEXTS.map((read) => ({ read })),
      ({ read }) => sheetContextLine(read),
    )),
  );
  all.push(
    ...(await each(
      'postIndexLabel',
      [
        [0, 1],
        [1, 3],
        [0, 2],
        [24, 25],
        [0, 0],
        [2.5, 4],
        [-1, 2],
      ].map(([index, total]) => ({ index, total })),
      ({ index, total }) => postIndexLabel(index, total),
    )),
  );
  all.push(
    ...(await each(
      'fixAllLabel',
      [1, 3, 0, 2, 12, 1.5].map((remaining) => ({ remaining })),
      ({ remaining }) => fixAllLabel(remaining),
    )),
  );
  return all;
}
