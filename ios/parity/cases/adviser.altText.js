// src/posting/adviser/{altTextFollowUp,altTextModel}.js: the alt-text
// dialog's quick notes and image kinds, the note sent to the server, which
// quick notes fit a description, the count under the field, what a
// description or a revision asks for, what the dialog keeps after one, and
// the allowance line, in every locale the app offers.
// Swift: VirgaPosting/Adviser/{AltTextFollowUp,AltTextModel}.swift.
//
// Inputs from altTextFollowUp.test.js and adviserUi.test.js, plus unicode,
// whitespace of every kind, limits and loose values.

import {
  ALT_TEXT_FOLLOW_UP_MAX,
  ALT_TEXT_IMAGE_KINDS,
  ALT_TEXT_NOTE_MAX,
  ALT_TEXT_QUICK_NOTES,
  CARD_QUICK_NOTES,
  ITS_A,
  appendItsA,
  cardQuickNotes,
  composeFollowUp,
  describeRequest,
  hasFollowUpDraft,
  looksTranscribed,
  normalizeImageKind,
  quickNoteIds,
  rankQuickNotes,
  toggleQuickNote,
} from '../../../src/posting/adviser/altTextFollowUp.js';
import {
  ALT_CONTEXT_MAX,
  ALT_TEXT_MAX_GRAPHEMES,
  GENERATED_ALT_MAX,
  afterGeneration,
  altGenerationRequest,
  altTextCount,
  altTextUsageLine,
  revisingLine,
} from '../../../src/posting/adviser/altTextModel.js';
import {
  DEFAULT_LOCALE,
  LOCALE_CHOICES,
  setActiveLocale,
} from '../../../src/lib/locale.js';
import { each, grid, value } from './_helpers.js';

export const sources = [
  'src/posting/adviser/altTextFollowUp.js',
  'src/posting/adviser/altTextModel.js',
];

const IDS = ALT_TEXT_QUICK_NOTES.map((n) => n.id);
const NOW = Date.parse('2026-11-12T00:00:00Z');

const TRANSCRIPT =
  'Settings. Account. Display name: Sam. Handle: @sam.example.com. Email: Hidden. Notifications. Push notifications: On. Save changes. Cancel.';
const PHOTO =
  'Three potted plants on a wooden table. At left, a ribbed green pot holds a plant with narrow, pointed green leaves. At right, a speckled gray pot holds a croton with glossy green leaves edged in bright yellow. Behind them, a blurred living room with a framed print of yellow birds on branches.';

const TEXTS = [
  TRANSCRIPT,
  PHOTO,
  'Name: Sam. Plan: Team. Status: Active.',
  'Name: Sam. Plan: Team. Status: Active. Seats: 4.',
  '',
  null,
  'A heron on a fence post.',
  'm '.repeat(400),
  'm'.repeat(99),
  'm'.repeat(100),
  'm'.repeat(140),
  'm'.repeat(160),
  'm'.repeat(161),
  'm'.repeat(350),
  'm'.repeat(351),
  'm'.repeat(399),
  'm'.repeat(400),
  'm'.repeat(700),
  'm'.repeat(701),
  'One.\nTwo.\nThree.\nFour.',
  'One\n\n\nTwo\nThree\nFour',
  'One. Two! Three? Four.',
  'One.Two.Three.Four.',
  'One.\r\nTwo.\r\nThree.\r\nFour.',
  'Name: Sam\nPlan: Team\nStatus: Active',
  'Wait... what? Really!? Yes.',
  'Ünïcödé fräg. Ëmoji 👩‍👩‍👧 here. Ånd mørë. Ünd so.',
  'a:\u00a0b c:\u2028d e:\u3000f',
  'é: x é: y é: z é: w',
  'x:\ty.z:\tq. Long sentence with many words in it here. Another long sentence with many words.',
  ' Leading.  Trailing.   Spaced.    Out.  ',
  'A short one. Another short one here, and then a much longer fragment follows it. Brief. Ok.',
];

const SELECTIONS = [
  [],
  ['shorter'],
  ['describe'],
  ['transcribe'],
  ['describe', 'detail'],
  ['plain', 'describe'],
  ['describe', 'detail', 'plain'],
  ['describe', 'shorter', 'transcribe', 'detail', 'plain'],
  ['nonsense'],
  ['shorter', 'nonsense', 'shorter'],
  ['Shorter'],
];

const NOTES = [
  '',
  '   ',
  null,
  "  It's the settings page in the app  ",
  'a heron',
  'm'.repeat(ALT_TEXT_NOTE_MAX),
  'm'.repeat(ALT_TEXT_NOTE_MAX + 20),
  ` ${'é'.repeat(310)} `,
  '👩‍👩‍👧'.repeat(60),
  '\u00a0note\u2029',
];

const USAGES = [
  { used: 5, limit: 15 },
  { used: 15, limit: 15 },
  { used: 14, limit: 15 },
  { used: 0, limit: 1 },
  { used: 20, limit: 15 },
  { used: 2.5, limit: 15 },
  null,
  { used: 1 },
  { used: 'x', limit: 15 },
];

export default async function cases() {
  const all = [
    value('altTextConstants', {
      ALT_TEXT_QUICK_NOTES,
      ALT_TEXT_IMAGE_KINDS,
      ITS_A,
      ALT_TEXT_NOTE_MAX,
      ALT_TEXT_FOLLOW_UP_MAX,
      CARD_QUICK_NOTES,
      ALT_TEXT_MAX_GRAPHEMES,
      GENERATED_ALT_MAX,
      ALT_CONTEXT_MAX,
    }),
  ];

  const toggles = [];
  for (const selected of SELECTIONS)
    for (const id of [...IDS, 'summon-help', '', 'Describe'])
      toggles.push({ selected, id });
  all.push(
    ...(await each('toggleQuickNote', toggles, ({ selected, id }) =>
      toggleQuickNote(selected, id),
    )),
  );
  all.push(
    ...(await each(
      'tapsInOrder',
      [
        { taps: ['plain', 'describe'] },
        { taps: ['describe', 'transcribe', 'detail', 'shorter', 'plain'] },
        { taps: ['shorter', 'shorter', 'detail', 'describe', 'detail'] },
      ],
      ({ taps }) => taps.reduce(toggleQuickNote, []),
    )),
  );
  all.push(
    ...(await each(
      'quickNoteIds',
      SELECTIONS.map((selected) => ({ selected })),
      ({ selected }) => quickNoteIds(selected),
    )),
  );
  const pairs = grid({ selected: SELECTIONS.slice(0, 8), note: NOTES });
  all.push(
    ...(await each('composeFollowUp', pairs, ({ selected, note }) =>
      composeFollowUp(selected, note),
    )),
  );
  all.push(
    ...(await each('hasFollowUpDraft', pairs, ({ selected, note }) =>
      hasFollowUpDraft(selected, note),
    )),
  );
  all.push(
    ...(await each('describeRequest', pairs, ({ selected, note }) =>
      describeRequest(selected, note),
    )),
  );
  all.push(
    ...(await each('revisingLine', pairs, ({ selected, note }) =>
      revisingLine(selected, note),
    )),
  );
  all.push(
    ...(await each(
      'appendItsA',
      [
        ...NOTES,
        'Not a leaf.  ',
        'Not a leaf.\n\n',
        `${'m'.repeat(296)}  `,
        'm'.repeat(299),
        'tab\t',
      ].map((note) => ({ note })),
      ({ note }) => appendItsA(note),
    )),
  );
  all.push(
    ...(await each(
      'normalizeImageKind',
      [
        ...ALT_TEXT_IMAGE_KINDS.map((k) => k.id),
        'unset',
        undefined,
        null,
        '',
        'Photo',
        5,
        ['photo'],
      ].map((kind) => ({ kind })),
      ({ kind }) => normalizeImageKind(kind),
    )),
  );
  all.push(
    ...(await each(
      'looksTranscribed',
      TEXTS.map((text) => ({ text })),
      ({ text }) => looksTranscribed(text),
    )),
  );
  // Every text alone; the short and the borderline ones with every kind and
  // every last request too (the long ones only change the length scores).
  const ranks = [];
  for (const text of TEXTS) {
    const full = text === null || text.length <= 160 || text === PHOTO;
    for (const kind of full
      ? [null, 'photo', 'chart', 'text', 'interface', 'odd']
      : [null, 'text'])
      for (const lastAsked of full
        ? [[], ['describe'], ['transcribe'], ['shorter', 'plain']]
        : [[], ['transcribe']])
        ranks.push({ text, kind, lastAsked });
  }
  all.push(
    ...(await each('rankQuickNotes', ranks, ({ text, kind, lastAsked }) => {
      const ranked = rankQuickNotes({ text, kind, lastAsked });
      return { ranked, card: cardQuickNotes(ranked) };
    })),
  );
  all.push(
    ...(await each('rankQuickNotesDefaults', [{}], () => rankQuickNotes())),
  );

  const counts = [];
  for (const locale of LOCALE_CHOICES)
    for (const text of [
      'a 👩‍👩‍👧 b',
      'x'.repeat(ALT_TEXT_MAX_GRAPHEMES),
      'x'.repeat(ALT_TEXT_MAX_GRAPHEMES + 1),
      'é'.repeat(1234),
      '🇫🇷🇩🇪',
      null,
      '',
      0,
      42,
    ])
      counts.push({ locale, text });
  all.push(
    ...(await each('altTextCount', counts, ({ locale, text }) => {
      setActiveLocale(locale);
      try {
        return altTextCount(text);
      } finally {
        setActiveLocale(DEFAULT_LOCALE);
      }
    })),
  );

  const requests = [
    { mode: 'describe', kind: 'chart', context: ' my post ' },
    { mode: 'describe', kind: 'nonsense' },
    { mode: 'describe', context: 'x'.repeat(900) },
    { mode: 'describe', context: `${'👩‍👩‍👧'.repeat(100)}` },
    { mode: 'describe', context: 42 },
    { mode: 'describe', context: null, kind: null },
    { mode: 'describe', context: '   ' },
    {
      mode: 'revise',
      alt: 'A cat on a mat.',
      selected: ['shorter'],
      note: "It's a kitten",
    },
    { mode: 'revise', alt: 'x', selected: [], note: ' ' },
    { mode: 'revise', alt: '  ', selected: ['plain'], note: '' },
    {
      mode: 'revise',
      alt: ' Old. ',
      selected: ['plain', 'describe', 'odd'],
      kind: 'text',
      context: 'ctx',
    },
    { mode: 'revise', selected: ['detail'] },
    { mode: 'revise', alt: 42, selected: [], note: 'more' },
    { mode: 'other', alt: 'x', selected: ['shorter'], note: 'n' },
    {},
  ];
  all.push(
    ...(await each('altGenerationRequest', requests, (input) =>
      altGenerationRequest(input),
    )),
  );
  all.push(
    ...(await each(
      'afterGeneration',
      [
        {
          before: 'old',
          generated: ' new ',
          mode: 'revise',
          selected: ['detail'],
        },
        { before: '  ', generated: 'new', mode: 'describe' },
        { before: 'old', generated: '   ' },
        { generated: 'x'.repeat(1500) },
        {
          generated: '👩‍👩‍👧'.repeat(300),
          mode: 'revise',
          selected: ['plain', 'odd', 'shorter'],
        },
        { before: null, generated: 'n', mode: 'revise' },
        { before: ' kept as it was ', generated: 7, mode: 'describe' },
        { generated: null },
        {},
      ],
      (input) => afterGeneration(input),
    )),
  );
  const lines = [];
  for (const locale of LOCALE_CHOICES)
    for (const usage of USAGES) lines.push({ locale, usage, now: NOW });
  all.push(
    ...(await each('altTextUsageLine', lines, ({ locale, usage, now }) => {
      setActiveLocale(locale);
      try {
        return altTextUsageLine(usage, { now: new Date(now) });
      } finally {
        setActiveLocale(DEFAULT_LOCALE);
      }
    })),
  );
  return all;
}
