// src/posting/library/templateEditorModel.js: putting a blank in at the
// caret, naming a new blank from its question, patching a question, the
// blanks a draft asks, whether the form has changes worth asking about, and
// the problems shown beside it. Swift:
// VirgaPosting/Library/TemplateEditorModel.swift.
//
// Inputs from templateEditorModel.test.js, plus selections outside the text,
// reversed, fractional and not numbers, carets inside a surrogate pair,
// labels that give no key or a context key, keys already used many times
// over, and drafts that differ only in what saving wouldn't write.

import * as EM from '../../../src/posting/library/templateEditorModel.js';
import { draftFromTemplate } from '../../../src/posting/templates/editorDrafts.js';
import { each, value } from './_helpers.js';

export const sources = ['src/posting/library/templateEditorModel.js'];

const TEXTS = [
  'Hi there',
  'Hi ',
  '',
  'Hi you!',
  'Thanks',
  'a.b',
  'end.',
  '(x)',
  'x\ny',
  'x\u00A0y',
  '🌿🌿',
  'e\u0301',
  '  spaced  ',
];
const SELECTIONS = [
  undefined,
  null,
  { start: 2, end: 2 },
  { start: 3, end: 3 },
  { start: 0, end: 0 },
  { start: 3, end: 6 },
  { start: 6, end: 3 },
  { start: -5, end: 1 },
  { start: 1, end: 99 },
  { start: 1.7, end: 2.2 },
  { start: '1', end: '2' },
  { start: 1 },
  { end: 1 },
  { start: 1, end: null },
  { start: Number.NaN, end: 1 },
  {},
];

const insertInputs = [];
for (const text of TEXTS)
  for (const selection of SELECTIONS)
    insertInputs.push({ text, token: '{{x}}', selection });
insertInputs.push(
  { text: 'Hi there', token: '{{x}}', selection: { start: 2, end: 2 } },
  {
    text: 'Hi you!',
    token: '{{their.firstName}}',
    selection: { start: 3, end: 6 },
  },
  { text: 'Thanks', token: '{{today}}' },
  { text: null, token: '{{x}}' },
  { text: 5, token: '{{x}}' },
  { text: ['a', 'b'], token: '{{x}}', selection: { start: 1, end: 1 } },
  { text: 'x', token: '', selection: { start: 0, end: 1 } },
  { text: 'Hi:', token: '{{x}}', selection: { start: 2, end: 2 } },
  { text: 'Hi;', token: '{{x}}', selection: { start: 2, end: 2 } },
  { text: 'Hi?', token: '{{x}}', selection: { start: 2, end: 2 } },
  { text: 'Hi,', token: '{{x}}', selection: { start: 2, end: 2 } },
  { text: 'Hi)', token: '{{x}}', selection: { start: 2, end: 2 } },
  { text: 'Hi]', token: '{{x}}', selection: { start: 2, end: 2 } },
  { text: 'Hi\t', token: '{{x}}', selection: { start: 2, end: 2 } },
  { text: '\u2028Hi', token: '{{x}}', selection: { start: 1, end: 1 } },
);

const DRAFTS = {
  try: draftFromTemplate({ text: 'Try ' }),
  app: draftFromTemplate({ text: '{{app}}' }),
  empty: draftFromTemplate({}),
  appMany: draftFromTemplate({
    text: '{{app}} {{app2}} {{app3}}',
    variables: [{ key: 'app4', label: 'kept' }],
  }),
  longKey: draftFromTemplate({ text: `{{${'a'.repeat(32)}}}` }),
  context: draftFromTemplate({ text: 'Hi {{their.firstName}}, try {{app}}' }),
  null: null,
  raw: { text: 'Hi' },
  noText: { variables: [{ key: 'x' }] },
};

const LABELS = [
  'Which app?',
  'app',
  '???',
  '',
  'Today',
  'today',
  'their name',
  `${'a'.repeat(40)}`,
  '  Device type  ',
  '2 things',
  null,
  5,
];

const addInputs = [];
for (const [dname, draft] of Object.entries(DRAFTS))
  for (const label of LABELS)
    addInputs.push({
      $id: `${dname}-${label}`,
      draft,
      label,
      selection: dname === 'try' ? { start: 4, end: 4 } : undefined,
    });
addInputs.push(
  {
    $id: 'selection-middle',
    draft: DRAFTS.context,
    label: 'Which?',
    selection: { start: 3, end: 3 },
  },
  {
    $id: 'selection-over',
    draft: DRAFTS.context,
    label: 'Name',
    selection: { start: 3, end: 22 },
  },
  {
    $id: 'existing-question',
    draft: draftFromTemplate({
      text: 'x',
      variables: [{ key: 'whichApp', label: 'Old' }],
    }),
    label: 'Which app?',
  },
  // `{ ...draft, text }` copies an array's or a string's indexes.
  { $id: 'array-draft', draft: ['a', { key: 'b' }], label: 'Which app?' },
  { $id: 'string-draft', draft: 'Hi', label: 'Which app?' },
);

export default async function cases() {
  const out = [];
  out.push(value('USE_OPTIONS', EM.USE_OPTIONS));
  out.push(value('CONTEXT_INSERTS', EM.CONTEXT_INSERTS));
  out.push(
    ...(await each(
      'insertAtSelection',
      insertInputs,
      ({ text, token, selection }) =>
        EM.insertAtSelection(text, token, selection),
    )),
  );
  out.push(
    ...(await each('addBlank', addInputs, ({ draft, label, selection }) =>
      EM.addBlank(draft, label, selection),
    )),
  );

  const base = draftFromTemplate({
    text: 'Hi {{their.firstName}}, try {{app}}',
  });
  out.push(
    ...(await each(
      'patchVariable',
      [
        {
          $id: 'choice',
          draft: base,
          key: 'app',
          patch: { kind: 'choice', choicesText: 'A\nB' },
        },
        { $id: 'missing', draft: base, key: 'nope', patch: { label: 'x' } },
        {
          $id: 'extra',
          draft: base,
          key: 'app',
          patch: { anything: [1], label: 'L' },
        },
        { $id: 'null-patch', draft: base, key: 'app', patch: null },
        { $id: 'null-draft', draft: null, key: 'app', patch: { label: 'x' } },
        {
          $id: 'no-variables',
          draft: { text: 'x' },
          key: 'app',
          patch: { label: 'x' },
        },
        // `{ ...value }` copies an array's or a string's indexes.
        { $id: 'array-patch', draft: base, key: 'app', patch: ['p', 'q'] },
        { $id: 'string-patch', draft: base, key: 'app', patch: 'pq' },
        { $id: 'array-draft', draft: ['a', 'b'], key: 'app', patch: {} },
        { $id: 'string-draft', draft: 'ab\u{1F33F}', key: 'app', patch: {} },
      ],
      ({ draft, key, patch }) => EM.patchVariable(draft, key, patch),
    )),
  );

  const blankDrafts = {
    fromTest: EM.patchVariable(base, 'app', {
      kind: 'choice',
      choicesText: 'A\nB',
    }),
    allContext: draftFromTemplate({
      text: '{{today}} {{their.name}} {{their.other}} {{my.handle}} {{q}}',
    }),
    raw: {
      text: '{{a}} {{b}}',
      variables: [
        { key: 'b', label: 'B', other: 1 },
        { key: 'b', label: 'B2' },
      ],
    },
    empty: {},
    null: null,
  };
  out.push(
    ...(await each(
      'blanksIn',
      Object.entries(blankDrafts).map(([name, draft]) => ({
        $id: name,
        draft,
      })),
      ({ draft }) => EM.blanksIn(draft),
    )),
  );

  const a = draftFromTemplate({ name: 'A', text: 'x' });
  const t = draftFromTemplate({
    name: 'T',
    text: 'Hi {{q}}',
    variables: [
      { key: 'q', label: 'Q', kind: 'choice', choices: ['one', 'two'] },
    ],
    keywords: ['moth'],
    embed: {
      $type: 'app.bsky.embed.record',
      record: { uri: 'at://x/app.bsky.feed.post/1', cid: 'c' },
    },
  });
  const pairs = {
    quoteView: [a, { ...a, quoteView: { any: 1 } }],
    name: [a, { ...a, name: 'B' }],
    keywordsText: [a, { ...a, keywordsText: 'moth' }],
    same: [t, { ...t }],
    keywordsSameWords: [t, { ...t, keywordsText: ' moth , Moth' }],
    choicesText: [t, EM.patchVariable(t, 'q', { choicesText: 'one\ntwo\n' })],
    choicesChanged: [t, EM.patchVariable(t, 'q', { choicesText: 'one' })],
    quoteNone: [t, { ...t, quoteMode: 'none' }],
    langs: [t, { ...t, langs: ['en'] }],
    rkey: [t, { ...t, rkey: 'other', uri: 'at://x/y/z' }],
    shortcutSlash: [
      { ...a, shortcut: 'x' },
      { ...a, shortcut: '/X' },
    ],
    variableLost: [t, { ...t, text: 'Hi' }],
    nulls: [null, null],
    nullVsBlank: [null, draftFromTemplate(null)],
    useDefault: [
      { ...a, use: '' },
      { ...a, use: 'any' },
    ],
    embedRebuilt: [
      t,
      {
        ...t,
        embed: {
          record: { cid: 'c', uri: 'at://x/app.bsky.feed.post/1' },
          $type: 'app.bsky.embed.record',
        },
      },
    ],
  };
  out.push(
    ...(await each(
      'editorHasChanges',
      Object.entries(pairs)
        .filter(([name]) => name !== 'embedRebuilt')
        .map(([name, [initial, draft]]) => ({ $id: name, initial, draft })),
      ({ initial, draft }) => EM.editorHasChanges(initial, draft),
    )),
  );

  const problemInputs = [
    { $id: 'empty', draft: draftFromTemplate({ name: '', text: '' }) },
    {
      $id: 'clash-and-link',
      draft: {
        ...draftFromTemplate({ name: 'B', text: 'x', shortcut: 'hi' }),
        quoteMode: 'link',
        quoteUrl: 'https://a.example',
        embed: null,
      },
      others: [{ rkey: 'other', name: 'Hello', shortcut: 'hi' }],
    },
    {
      $id: 'link-read',
      draft: {
        ...draftFromTemplate({ name: 'B', text: 'x' }),
        quoteMode: 'link',
        quoteUrl: 'https://a.example',
        embed: {
          $type: 'app.bsky.embed.external',
          external: { uri: 'https://a.example' },
        },
      },
    },
    {
      $id: 'link-blank-url',
      draft: {
        ...draftFromTemplate({ name: 'B', text: 'x' }),
        quoteMode: 'link',
        quoteUrl: '  ',
      },
    },
    {
      $id: 'link-number-url',
      draft: {
        ...draftFromTemplate({ name: 'B', text: 'x' }),
        quoteMode: 'link',
        quoteUrl: 5,
      },
    },
    {
      $id: 'post-mode',
      draft: {
        ...draftFromTemplate({ name: 'B', text: '' }),
        quoteMode: 'post',
      },
    },
    {
      $id: 'choice-empty',
      draft: EM.patchVariable(
        draftFromTemplate({ name: 'C', text: '{{q}}' }),
        'q',
        { kind: 'choice', choicesText: '\n' },
      ),
    },
    { $id: 'null', draft: null },
    {
      $id: 'new-vs-unsaved',
      draft: draftFromTemplate({ name: 'N', text: 'x', shortcut: 'n' }),
      others: [{ name: 'Unsaved', shortcut: 'n' }],
    },
    {
      $id: 'own-rkey',
      draft: draftFromTemplate({
        name: 'N',
        text: 'x',
        shortcut: 'n',
        rkey: 'r1',
      }),
      others: [{ rkey: 'r1', name: 'Self', shortcut: 'n' }],
    },
  ];
  out.push(
    ...(await each('editorProblems', problemInputs, ({ draft, others }) => {
      const problems =
        others === undefined
          ? EM.editorProblems(draft)
          : EM.editorProblems(draft, others);
      return { problems, order: Object.keys(problems) };
    })),
  );
  return out;
}
