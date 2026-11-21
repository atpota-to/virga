// Shared inputs for the template generators (templates.*.js): templates,
// reply contexts, answers, parts, records and drafts, from the web modules'
// own tests plus unicode, emoji and malformed shapes.

import * as PT from '../../../src/posting/templates/postTemplates.js';

export const NOW = '2026-10-14T12:00:00.000Z';
export const FAMILY = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}';

export const ada = {
  author: { handle: 'ada.example', displayName: 'Ada Ferreira' },
  record: { text: 'would love a way to pin feeds' },
};
export const juniper = {
  author: { handle: 'juniper.example', displayName: '' },
};
export const self = { handle: 'you.example' };

export const idea = {
  name: 'Thanks for the idea',
  text: "Thank you, {{their.firstName}}. I like the idea of {{idea}}, and it's on our list now. {{timing}}",
  variables: [
    { key: 'idea', label: 'What did they suggest?', hint: 'A few words' },
    {
      key: 'timing',
      label: 'When?',
      kind: 'choice',
      optional: true,
      choices: ['Soon.', 'Someday.'],
    },
  ],
  use: 'reply',
  keywords: ['love', 'feature', 'reset'],
};

export const optional = (text, keys = ['a', 'b', 'c']) => ({
  text,
  variables: keys.map((key) => ({ key, optional: true })),
});

// ---- contexts -----------------------------------------------------------

export const REPLIES = {
  ada,
  juniper,
  emoji: { author: { handle: 'w.example', displayName: '🌿 Wren Okafor' } },
  spaces: { author: { handle: 'sp.example', displayName: '   Zoë  ' } },
  apostrophe: {
    author: { handle: 'o.example', displayName: "O'Brien-Smith Jr" },
  },
  curly: { author: { handle: 'd.example', displayName: 'D’Angelo' } },
  digits: { author: { handle: 'n.example', displayName: '123 456' } },
  marks: { author: { handle: 'm.example', displayName: 'e\u0301lise' } },
  arabic: { author: { handle: 'ar.example', displayName: 'مريم أحمد' } },
  cjk: { author: { handle: 'cjk.example', displayName: '山田 太郎' } },
  family: { author: { handle: 'f.example', displayName: `${FAMILY} Sam` } },
  noName: { author: { handle: 'quiet.example' } },
  numberName: { author: { handle: 'num.example', displayName: 42 } },
  noHandle: { author: { displayName: 'Nameless' } },
  emptyAuthor: { author: {} },
  nullAuthor: { author: null },
  stringAuthor: { author: 'someone' },
  noAuthor: { record: { text: 'x' } },
  dottedHandle: { author: { handle: 'çiçek.bsky.social', displayName: '' } },
  upperHandle: { author: { handle: 'İlker.example', displayName: ' ' } },
  sigma: { author: { handle: 'σ.example', displayName: 'ΟΔΥΣΣΕΑΣ Π' } },
};

export const ZONES = [
  'UTC',
  'Pacific/Chatham',
  'America/Los_Angeles',
  'Pacific/Kiritimati',
];

export function contextFor(
  reply,
  { me = self, now = NOW, locale = 'en-US' } = {},
) {
  return PT.buildTemplateContext({
    replyTo: reply,
    self: me,
    now: new Date(now),
    locale,
  });
}

// Built by hand, as a caller might.
export const HAND_CONTEXTS = {
  null: null,
  empty: {},
  theirNull: { their: null, my: { handle: 'me.example' }, today: 'May 1' },
  theirEmpty: { their: {}, my: {}, today: '' },
  emptyStrings: {
    their: { name: '', firstName: '', handle: '' },
    my: { handle: '' },
    today: '',
  },
  noMy: { their: { name: 'A B', firstName: 'A', handle: 'a.example' } },
  handleOnly: { their: { handle: 'h.example' }, my: { handle: 'me.example' } },
  dotless: { their: { handle: 'localhost' } },
  leadingDot: { their: { handle: '.hidden.example' } },
  emojiHandle: { their: { handle: '🙂.example' } },
};

export const CONTEXTS = {
  ada: contextFor(ada),
  juniper: contextFor(juniper),
  none: contextFor(undefined),
  noSelf: contextFor(ada, { me: {} }),
  emoji: contextFor(REPLIES.emoji),
  noName: contextFor(REPLIES.noName),
  dottedHandle: contextFor(REPLIES.dottedHandle),
  upperHandle: contextFor(REPLIES.upperHandle),
  emptyAuthor: contextFor(REPLIES.emptyAuthor),
  ...HAND_CONTEXTS,
};

// ---- templates ----------------------------------------------------------

export const TEMPLATES = {
  idea,
  undeclared: { text: 'Version {{version}}' },
  prototype: { text: 'Ask the {{constructor}} about {{valueOf}}' },
  proto: { text: '{{toString}} {{hasOwnProperty}} {{__proto__}}' },
  allContext: {
    text: '{{their.firstName}} / {{their.name}} / {{their.handle}} / {{my.handle}} / {{today}}',
  },
  contextLabelled: {
    text: 'Hi {{their.firstName}}, I am {{my.handle}}',
    variables: [
      {
        key: 'their.firstName',
        label: 'Their name, please',
        default: 'friend',
      },
      { key: 'my.handle', hint: 'Yours' },
    ],
  },
  otherContext: { text: '{{their.pronoun}} and {{my.name}} and {{today2}}' },
  choices: {
    text: 'Use {{device}} or {{os}} or {{empty}}',
    variables: [
      { key: 'device', kind: 'choice', choices: ['Phone', 'Tablet', ''] },
      { key: 'os', kind: 'choice', choices: [] },
      { key: 'empty', kind: 'choice' },
      {
        key: 'device',
        label: 'Later wins',
        kind: 'choice',
        choices: ['Laptop'],
      },
    ],
  },
  defaults: {
    text: '{{a}} {{b}} {{c}}',
    variables: [
      { key: 'a', default: 'alpha' },
      { key: 'b', default: '' },
      { key: 'c', default: 7 },
    ],
  },
  optionalFlags: {
    text: '{{a}}{{b}}{{c}}{{d}}',
    variables: [
      { key: 'a', optional: 1 },
      { key: 'b', optional: 'yes' },
      { key: 'c', optional: 0 },
      { key: 'd', optional: false },
    ],
  },
  spacing: { text: '{{ spaced }} {{\ttab\t}} {{\u00A0nbsp\u00A0}} {{\u3000ideo\u3000}}' },
  badKeys: { text: '{{1bad}} {{}} {{_x}} {{a-b.c_d}} {{a b}} {{{x}}} {{y}}}' },
  longKey: {
    text: `{{${'k'.repeat(32)}}} {{${'k'.repeat(33)}}}`,
  },
  repeated: { text: '{{a}} {{a}} {{ a }} {{A}}' },
  unicode: { text: 'Héllo {{name}} — 🌿 {{plant}}! ΣΑΣ {{their.firstName}}' },
  emptyText: { text: '' },
  noText: {},
  numberText: { text: 12345 },
  arrayText: { text: ['{{a}}', 'b'] },
  embedOnly: { text: '', embed: { $type: 'app.bsky.embed.record' } },
  nullVariables: { text: '{{a}}', variables: null },
  keyless: { text: '{{a}}', variables: [{ label: 'No key' }, { key: 5 }, {}] },
  labels: {
    text: '{{a}} {{b}}',
    variables: [
      { key: 'a', label: '', hint: '' },
      { key: 'b', label: 'Bee', hint: 'Buzz' },
    ],
  },
  lineBreaks: optional('first {{a}}\nsecond\r\n{{b}} third\n{{c}}'),
};

// ---- answers ------------------------------------------------------------

export const ANSWERS = {
  none: undefined,
  empty: {},
  idea: { idea: 'pinned feeds' },
  ideaTiming: { idea: 'pinned feeds', timing: 'Soon.' },
  padded: { idea: '  spaced out  ', timing: '\n' },
  prototype: { constructor: 'owl', valueOf: 'moths' },
  numbers: { a: 0, b: 12, c: false, idea: 3.5 },
  nulls: { a: null, b: null, idea: null },
  context: {
    'my.handle': '@alt.test',
    'their.firstName': 'Pal',
    today: 'Someday',
  },
  unicode: { name: 'Zoë 🌿', plant: FAMILY, idea: 'ΟΔΟΣ' },
  everything: {
    a: 'A',
    b: 'B',
    c: 'C',
    d: 'D',
    version: '2.0',
    device: 'Phone',
    os: 'iOS',
    empty: 'x',
    spaced: 's',
    tab: 't',
    nbsp: 'n',
    ideo: 'i',
    name: 'N',
    plant: 'P',
  },
  string: 'not an object',
  array: ['zero'],
  nested: { a: { deep: true }, b: ['x', 'y'] },
};

// ---- tidy inputs --------------------------------------------------------

export const T = (text, kind = 'text', key) =>
  key === undefined ? { text, kind } : { text, kind, key };
export const E = (key) =>
  key === undefined
    ? { text: '', kind: 'empty' }
    : { text: '', kind: 'empty', key };

export const TIDY = {
  fromTest: [
    T('Hi '),
    T('Ada', 'context', 'their.firstName'),
    T(' '),
    E('x'),
    T('. '),
    E(),
  ],
  empty: [],
  null: null,
  onlyEmpties: [E(), E(), E()],
  onlySpaces: [T('   '), E(), T('\t')],
  leadingEmpty: [E(), T(' starts here')],
  trailingEmpty: [T('on our list. '), E()],
  middle: [T('one '), E(), T(' two')],
  doubleSpace: [T('one  '), E(), T(' two')],
  adjacent: [T('one '), E(), E(), T(' two')],
  spacedRun: [T('one '), E(), T(' '), E(), T(' two')],
  newline: [T('first '), E(), T('\nsecond')],
  crlf: [T('first '), E(), T('\r\nsecond')],
  indent: [T('Code:\n    '), E(), T('indented')],
  indentSpace: [T('Code:\n    '), E(), T(' indented')],
  comma: [T('the idea of '), E(), T(', and')],
  bang: [T('Bonjour '), E(), T(' !')],
  smiley: [T('Hi '), E(), T(' :) there')],
  punctuationRight: [T('Hi '), E(), T('?')],
  noSpaces: [T('a'), E(), T('b')],
  tabs: [T('a\t'), E(), T('\tb')],
  nbsp: [T('a\u00A0'), E(), T('\u00A0b')],
  ideographic: [T('a\u3000'), E(), T('.')],
  whitespaceEnds: [T('\u2028 \u00A0 x \uFEFF\n')],
  keepsFields: [
    { text: 'A', kind: 'answer', key: 'a', extra: 1 },
    { text: ' ', kind: 'text' },
    { text: '', kind: 'empty', key: 'b', note: 'gone' },
    { text: 'C', kind: 'blank', key: 'c', label: 'Cee' },
  ],
  falsy: [null, T('a '), 0, false, '', E(), T(' b')],
  numbers: [
    { text: 12, kind: 'text' },
    { text: null, kind: 'text' },
    { kind: 'text' },
    { text: true },
  ],
  emojiAround: [T('🌿 '), E(), T(' 🌿'), E(), T(FAMILY)],
  surrogates: [T('\u{1F600}'), E(), T('\u{1F600} ')],
  emptyBetweenLines: [T('line\n'), E(), T('\nnext')],
  spaceBeforeEnd: [T('end '), E()],
  emptyTextPart: [T(''), T('x'), T('')],
};

// ---- records ------------------------------------------------------------

export const URI = 'at://did:plc:me/net.anisota.feed.template/3abc';

export const RECORDS = {
  fromTest: {
    uri: URI,
    cid: 'cid1',
    value: {
      name: 'N',
      text: 'T {{x}}',
      use: 'later',
      shortcut: '/X',
      variables: [{ key: 'x', kind: 'choice', choices: [] }, { nokey: true }],
      keywords: ['a', 3],
    },
  },
  full: {
    uri: URI,
    cid: 'bafy',
    value: {
      $type: 'net.anisota.feed.template',
      name: 'Full',
      text: 'Hi {{their.firstName}}, try {{app}}',
      variables: [
        {
          key: 'app',
          label: '  Which app?  ',
          hint: ' A hint ',
          kind: 'choice',
          choices: [
            ' One ',
            '',
            'Two',
            3,
            null,
            ...Array.from({ length: 14 }, (_, i) => `c${i}`),
          ],
          default: '  One ',
          optional: true,
          extra: 'dropped',
        },
        { key: 'their.firstName', label: 'Name', optional: 'yes' },
        { key: '', label: 'empty key' },
        null,
        'string',
      ],
      embed: {
        $type: 'app.bsky.embed.record',
        record: { uri: 'at://x/app.bsky.feed.post/1', cid: 'c' },
      },
      use: 'post',
      group: ' Support ',
      shortcut: '  //App ',
      keywords: ['ok', ' ', '', 'Two Words', null, 7],
      langs: ['en', 3, 'pt-BR', null],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
      unknownField: 1,
    },
  },
  empty: {},
  noValue: { uri: URI },
  nullValue: { uri: URI, cid: null, value: null },
  stringValue: { uri: URI, value: 'nope' },
  trailingSlash: {
    uri: 'at://did:plc:me/net.anisota.feed.template/',
    value: {},
  },
  noSlash: { uri: 'plain', value: {} },
  wrongTypes: {
    uri: URI,
    value: {
      name: 7,
      text: ['t'],
      variables: 'x',
      embed: 'link',
      use: 7,
      group: null,
      shortcut: 9,
      keywords: 'k',
      langs: 'en',
      createdAt: 1,
      updatedAt: false,
    },
  },
  arrayEmbed: { uri: URI, value: { embed: [1, 2] } },
  falsyEmbed: { uri: URI, value: { embed: 0 } },
  uses: { uri: URI, value: { use: 'reply' } },
  usesCase: { uri: URI, value: { use: 'Reply' } },
  unicodeShortcut: {
    uri: URI,
    value: { shortcut: ' /İSTANBUL ', keywords: ['\u00A0', 'ΣΑΣ'] },
  },
};

export const TO_RECORD = {
  fromTest: {
    ...idea,
    variables: [
      ...idea.variables,
      { key: 'gone', label: 'Removed from the text' },
      { key: 'idea2' },
    ],
    group: '  Ideas ',
    shortcut: '/Idea',
    keywords: ['Love', 'love', ' '],
    langs: ['en'],
  },
  keepsCreated: { name: 'x', text: 'y', createdAt: '2026-01-01T00:00:00.000Z' },
  minimal: { name: '  ', text: '' },
  empty: {},
  embed: {
    ...idea,
    group: 'g',
    shortcut: 's',
    langs: ['en'],
    embed: {
      $type: 'app.bsky.embed.record',
      record: { uri: 'at://x/app.bsky.feed.post/1', cid: 'c' },
    },
  },
  manyVariables: {
    name: 'Many',
    text: Array.from({ length: 14 }, (_, i) => `{{v${i}}}`).join(' '),
    variables: Array.from({ length: 14 }, (_, i) => ({
      key: `v${i}`,
      label: `Q${i}`,
    })),
  },
  manyKeywords: {
    name: 'K',
    text: 'x',
    keywords: Array.from({ length: 25 }, (_, i) => `K${i % 22}`),
  },
  keywordCase: {
    name: 'K',
    text: 'x',
    keywords: [
      'ΣΑΣ',
      'σας',
      'İstanbul',
      'i\u0307stanbul',
      'é',
      'e\u0301',
      'STRASSE',
      'straße',
    ],
  },
  manyLangs: {
    name: 'L',
    text: 'x',
    langs: ['en', '', null, 'pt', 0, 'de', 'fr'],
  },
  weirdUse: { name: 'U', text: 'x', use: 'later' },
  numberText: { name: 'N', text: 42 },
  falsyEmbed: { name: 'E', text: 'x', embed: 0, createdAt: '' },
  contextVariables: {
    name: 'C',
    text: '{{their.firstName}} {{asked}}',
    variables: [
      { key: 'their.firstName', label: 'Name' },
      { key: 'asked' },
      { key: 'asked', label: 'Second wins? No, both kept' },
    ],
  },
  rawCreated: { name: 'R', text: 'x', createdAt: 12345 },
  unicodeName: { name: `  ${FAMILY} Names \u00A0`, text: 'x', group: '\u3000Gruppe\u3000' },
};

export const VALIDATE = {
  emptyBoth: [{ name: '', text: '' }],
  embedNoText: [
    { name: 'Ok', text: '', embed: { $type: 'app.bsky.embed.record' } },
  ],
  longText: [{ name: 'Ok', text: 'x'.repeat(301) }],
  exactText: [{ name: 'Ok', text: 'x'.repeat(300) }],
  emojiText: [{ name: 'Ok', text: FAMILY.repeat(300) }],
  emojiTextOver: [{ name: 'Ok', text: FAMILY.repeat(301) }],
  badShortcut: [{ name: 'Ok', text: 'x', shortcut: 'no spaces' }],
  upperShortcut: [{ name: 'Ok', text: 'x', shortcut: '/APP' }],
  longShortcut: [{ name: 'Ok', text: 'x', shortcut: 'a'.repeat(33) }],
  exactShortcut: [{ name: 'Ok', text: 'x', shortcut: 'a'.repeat(32) }],
  unicodeShortcut: [{ name: 'Ok', text: 'x', shortcut: 'café' }],
  clash: [
    { name: 'Ok', text: 'x', shortcut: 'app', rkey: 'b' },
    [{ rkey: 'a', name: 'Other', shortcut: 'app' }],
  ],
  sameRkey: [
    { name: 'Ok', text: 'x', shortcut: 'app', rkey: 'a' },
    [{ rkey: 'a', name: 'Same', shortcut: 'app' }],
  ],
  noRkeys: [
    { name: 'Ok', text: 'x', shortcut: 'app' },
    [{ name: 'Other', shortcut: '/App' }],
  ],
  nullVsMissing: [
    { name: 'Ok', text: 'x', shortcut: 'app', rkey: null },
    [{ name: 'Other', shortcut: 'app' }],
  ],
  clashNoName: [
    { name: 'Ok', text: 'x', shortcut: 'app', rkey: 'b' },
    [{ rkey: 'a', shortcut: 'app' }],
  ],
  clashNullName: [
    { name: 'Ok', text: 'x', shortcut: 'app', rkey: 'b' },
    [{ rkey: 'a', shortcut: 'app', name: null }],
  ],
  clashFalsyOthers: [
    { name: 'Ok', text: 'x', shortcut: 'app', rkey: 'b' },
    [null, 0, '', { rkey: 'c', name: 'Third', shortcut: ' /APP ' }],
  ],
  emptyChoice: [
    {
      name: 'Ok',
      text: '{{when}}',
      variables: [{ key: 'when', kind: 'choice', choices: [' '] }],
    },
  ],
  choiceNotAsked: [
    {
      name: 'Ok',
      text: '{{their.firstName}}',
      variables: [
        { key: 'their.firstName', kind: 'choice', choices: [] },
        { key: 'gone', kind: 'choice' },
      ],
    },
  ],
  choiceLabel: [
    {
      name: 'Ok',
      text: '{{a}} {{b}}',
      variables: [
        { key: 'a', kind: 'choice', choices: ['x'] },
        { key: 'b', label: 'Which?', kind: 'choice', choices: [null, ''] },
      ],
    },
  ],
  tooManyQuestions: [
    {
      name: 'Ok',
      text:
        Array.from({ length: 13 }, (_, i) => `{{q${i}}}`).join(' ') +
        ' {{their.firstName}} {{today}}',
    },
  ],
  twelveQuestions: [
    {
      name: 'Ok',
      text: Array.from({ length: 12 }, (_, i) => `{{q${i}}}`).join(' '),
    },
  ],
  tooManyKeywords: [
    {
      name: 'Ok',
      text: 'x',
      keywords: Array.from({ length: 21 }, (_, i) => 'k' + i),
    },
  ],
  twentyKeywords: [
    {
      name: 'Ok',
      text: 'x',
      keywords: [...Array.from({ length: 20 }, (_, i) => 'k' + i), ' ', ''],
    },
  ],
  longKeyword: [{ name: 'Ok', text: 'x', keywords: ['a'.repeat(65)] }],
  exactKeyword: [{ name: 'Ok', text: 'x', keywords: ['a'.repeat(64)] }],
  emojiKeyword: [{ name: 'Ok', text: 'x', keywords: ['\u{1F600}'.repeat(33)] }],
  keywordShapes: [
    { name: 'Ok', text: 'x', keywords: ['dark mode', '#mothweek', 'e-mail'] },
  ],
  noLetters: [{ name: 'Ok', text: 'x', keywords: ['moths', '#'] }],
  punctuationKeyword: [{ name: 'Ok', text: 'x', keywords: ['’', "'"] }],
  longName: [{ name: 'n'.repeat(65), text: 'x' }],
  exactName: [{ name: 'n'.repeat(64), text: 'x' }],
  emojiName: [{ name: FAMILY.repeat(64), text: 'x' }],
  longGroup: [{ name: 'Ok', text: 'x', group: 'g'.repeat(65) }],
  paddedGroup: [{ name: 'Ok', text: 'x', group: `  ${'g'.repeat(64)}  ` }],
  allAtOnce: [
    {
      name: '',
      text: 'x'.repeat(301),
      group: 'g'.repeat(70),
      shortcut: 'bad one',
      variables: [{ key: 'q', kind: 'choice' }],
      keywords: ['#'],
    },
  ],
  whitespaceText: [{ name: 'Ok', text: ' \n\t\u00A0' }],
  numberName: [{ name: 5, text: 'x' }],
  nullTemplate: [null],
  missing: [{}],
  numberText: [{ name: 'Ok', text: 7 }],
  unicodeShortcutClash: [
    { name: 'Ok', text: 'x', shortcut: 'İ', rkey: 'b' },
    [{ rkey: 'a', name: 'Other', shortcut: 'i\u0307' }],
  ],
};
