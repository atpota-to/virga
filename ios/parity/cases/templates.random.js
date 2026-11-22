// src/posting/templates/{postTemplates,editorDrafts,templateUsage}.js and
// src/posting/library/templateEditorModel.js over seeded random inputs:
// texts built from blanks, names, protected spans, every kind of space and
// punctuation, case-changing letters (dotted I, final sigma, sharp s, the
// Kelvin sign, the long s, U+0345), marks, emoji and astral letters. The
// hand-picked fixtures (templates.postTemplates, templates.fill,
// templates.editorDrafts, templates.editorModel, templates.templateUsage)
// hold each branch; this one holds the combinations nobody thought of.
// Only well-typed shapes: the deliberate differences (non-string labels and
// the like) stay out, as in the other fixtures. Swift:
// VirgaPostingTests/TemplatesRandomParityTests.swift.

import * as PT from '../../../src/posting/templates/postTemplates.js';
import * as ED from '../../../src/posting/templates/editorDrafts.js';
import * as EM from '../../../src/posting/library/templateEditorModel.js';
import { sortTemplatesForShelf } from '../../../src/posting/templates/templateUsage.js';
import { each } from './_helpers.js';

export const sources = [
  'src/posting/templates/postTemplates.js',
  'src/posting/templates/editorDrafts.js',
  'src/posting/templates/templateUsage.js',
  'src/posting/library/templateEditorModel.js',
];

const NOW = '2026-10-14T12:00:00.000Z';

// mulberry32: a small seeded generator, so the fixture is the same each run.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FAMILY = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}';

const LETTERS = [
  'a',
  'b',
  'e',
  'i',
  'k',
  's',
  'z',
  'A',
  'E',
  'I',
  'K',
  'S',
  'W',
  'r',
  'n',
  'é',
  'e\u0301',
  '\u0345',
  'ß',
  'İ',
  'ı',
  'Σ',
  'σ',
  'ς',
  'ﬁ',
  'K',
  'ſ',
  'ǆ',
  'ǅ',
  'ŉ',
  'Ω',
  'ω',
  'Å',
  'ü',
  '山',
  'م',
  '\u{1D49C}',
  'ﬀ',
];
const DIGITS = ['0', '1', '7', '٣'];
const SPACES = [
  ' ',
  ' ',
  ' ',
  '\t',
  '\n',
  '\r',
  '\r\n',
  '\u00A0',
  '\u2028',
  '\u3000',
  '\uFEFF',
  '\u200B',
  '\u000B',
];
const PUNCT = [
  '.',
  ',',
  ';',
  ':',
  '!',
  '?',
  ')',
  '(',
  '/',
  '-',
  '_',
  '@',
  '#',
  "'",
  '’',
  '%',
  '+',
  '{',
  '}',
  '{{',
  '}}',
  '$',
  '*',
  '[',
  ']',
  '\\',
  '|',
  '^',
];
const EMOJI = ['🌿', FAMILY, '🇫🇷', '😀', '\uFE0F', '1\uFE0F\u20E3'];
const BLANKS = [
  '{{a}}',
  '{{ b }}',
  '{{c}}',
  '{{\tc\u00A0}}',
  '{{their.firstName}}',
  '{{their.name}}',
  '{{their.handle}}',
  '{{my.handle}}',
  '{{today}}',
  '{{x}}',
  '{{their.other}}',
  '{{constructor}}',
  '{{A1_b-c.d}}',
  '{{1a}}',
  '{{a b}}',
  '{{ a }}',
];
const WORDS = [
  'wren',
  'Wren',
  'WREN',
  'https://',
  'http://x.example/',
  'HTTPS://',
  'mode',
  'dark',
  'reset',
  'resetting',
  "don't",
  'don’t',
  '.com',
  'e-mail',
  '#mothweek',
  'app',
  'apple',
  'Zoë',
  'zoë',
  'élise',
  'O’Brien',
  "O'Brien",
  'Anne-Marie',
  'İstanbul',
  'istanbul',
  'ΣΑΣ',
  'σας',
  'straße',
  'STRASSE',
];
const KEYS = [
  'a',
  'b',
  'c',
  'x',
  'their.firstName',
  'their.name',
  'their.handle',
  'my.handle',
  'today',
  'their.other',
  'constructor',
  'A1_b-c.d',
];

function makeTools(seed) {
  const r = rng(seed);
  const int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  const pick = (list) => list[Math.floor(r() * list.length)];
  const chance = (p) => r() < p;
  const token = (weights = {}) => {
    const w = {
      letter: 6,
      digit: 1,
      space: 3,
      punct: 2,
      emoji: 1,
      blank: 2,
      word: 2,
      ...weights,
    };
    const total = Object.values(w).reduce((s, v) => s + v, 0);
    let x = r() * total;
    for (const [kind, n] of Object.entries(w)) {
      x -= n;
      if (x < 0) {
        switch (kind) {
          case 'letter':
            return pick(LETTERS);
          case 'digit':
            return pick(DIGITS);
          case 'space':
            return pick(SPACES);
          case 'punct':
            return pick(PUNCT);
          case 'emoji':
            return pick(EMOJI);
          case 'blank':
            return pick(BLANKS);
          default:
            return pick(WORDS);
        }
      }
    }
    return 'a';
  };
  const text = (max = 12, weights) => {
    let out = '';
    const n = int(0, max);
    for (let i = 0; i < n; i++) out += token(weights);
    return out;
  };
  const plain = (max = 8) => text(max, { blank: 0 });
  const repeatTo = (unit, n) => unit.repeat(Math.max(0, n));
  return { r, int, pick, chance, token, text, plain, repeatTo };
}

function randomVariable(t) {
  const v = { key: t.chance(0.9) ? t.pick(KEYS) : t.plain(3) };
  if (t.chance(0.5)) v.label = t.plain(5);
  if (t.chance(0.3)) v.hint = t.plain(5);
  if (t.chance(0.4)) v.kind = t.pick(['choice', 'text', 'Choice']);
  if (t.chance(0.4))
    v.choices = Array.from({ length: t.int(0, 4) }, () => t.plain(4));
  if (t.chance(0.3)) v.default = t.plain(4);
  if (t.chance(0.3)) v.optional = t.pick([true, false]);
  return v;
}

function randomTemplate(t) {
  const out = { name: t.plain(6), text: t.text(14) };
  if (t.chance(0.7))
    out.variables = Array.from({ length: t.int(0, 5) }, () =>
      randomVariable(t),
    );
  if (t.chance(0.2))
    out.embed = {
      $type: 'app.bsky.embed.record',
      record: { uri: 'at://did:plc:x/app.bsky.feed.post/1', cid: 'c' },
    };
  if (t.chance(0.5)) out.use = t.pick(['any', 'reply', 'post', 'Reply', '']);
  if (t.chance(0.4)) out.group = t.plain(4);
  if (t.chance(0.5)) out.shortcut = t.text(4, { blank: 0, word: 1 });
  if (t.chance(0.5))
    out.keywords = Array.from({ length: t.int(0, 4) }, () => t.plain(4));
  if (t.chance(0.3))
    out.langs = Array.from({ length: t.int(0, 4) }, () =>
      t.pick(['en', 'pt', '', 'de']),
    );
  if (t.chance(0.3)) out.createdAt = '2026-01-01T00:00:00.000Z';
  if (t.chance(0.3)) out.rkey = t.pick(['3la', '3lb', 'a', '']);
  return out;
}

// A template near the limits, for validateTemplate.
function longTemplate(t) {
  const unit = () => t.pick(['a', 'é', 'e\u0301', FAMILY, '🌿', '山', ' ']);
  const out = {
    name: t.repeatTo(unit(), t.int(60, 68)),
    text: t.repeatTo(unit(), t.int(295, 305)),
  };
  if (t.chance(0.5)) out.group = t.repeatTo(unit(), t.int(60, 68));
  if (t.chance(0.5))
    out.keywords = Array.from({ length: t.int(18, 22) }, (_, i) =>
      t.chance(0.1) ? t.repeatTo(unit(), t.int(60, 68)) : `k${i}`,
    );
  if (t.chance(0.5)) {
    const n = t.int(10, 14);
    out.text = Array.from({ length: n }, (_, i) => `{{q${i}}}`).join(' ');
  }
  return out;
}

function randomContext(t) {
  if (t.chance(0.1)) return null;
  if (t.chance(0.15))
    return PT.buildTemplateContext({ now: new Date(NOW), locale: 'en-US' });
  return PT.buildTemplateContext({
    replyTo: {
      author: {
        handle: t.chance(0.85) ? t.plain(4) + '.example' : '',
        displayName: t.text(6, { blank: 0, word: 3 }),
      },
    },
    self: { handle: t.chance(0.8) ? 'me.example' : '' },
    now: new Date(NOW),
    locale: 'en-US',
  });
}

function randomAnswers(t) {
  const out = {};
  const n = t.int(0, 5);
  for (let i = 0; i < n; i++) out[t.pick(KEYS)] = t.plain(4);
  return out;
}

function randomName(t) {
  // Letters, marks, apostrophes and hyphens, so a first word is found.
  const parts = [];
  const n = t.int(0, 3);
  for (let i = 0; i < n; i++) {
    let w = '';
    const m = t.int(1, 6);
    for (let j = 0; j < m; j++)
      w += t.chance(0.85)
        ? t.pick(LETTERS)
        : t.pick(["'", '’', '-', '\u0301', '🌿']);
    parts.push(w);
  }
  return (
    (t.chance(0.2) ? t.pick(['🌿 ', ' ', '1 ']) : '') +
    parts.join(t.pick([' ', '  ', '\u00A0']))
  );
}

function randomReplyText(t, first) {
  let out = '';
  const n = t.int(0, 10);
  for (let i = 0; i < n; i++) {
    if (first && t.chance(0.4)) {
      const before = t.pick([
        '',
        ' ',
        '@',
        '#',
        '/',
        '-',
        '_',
        '.',
        'x.',
        'a',
        'https://',
        'http://x/',
        'me@',
        '(',
        '’',
        "'",
        '1',
        '\u0301',
      ]);
      const after = t.pick([
        '',
        ' ',
        '.',
        '. ',
        '.x',
        '.1',
        '!',
        ',',
        '@',
        '/',
        '-',
        '_',
        "'s",
        '’s',
        'a',
        '1',
        '\u0301',
        '..',
        '.com',
        ')',
      ]);
      out += before + first + after;
    } else out += t.token({ blank: 1, word: 3 });
  }
  return out;
}

const firstWordOf = (name) =>
  String(name)
    .trim()
    .match(/[\p{L}\p{M}][\p{L}\p{M}'’-]*/u)?.[0] || '';

export default async function cases() {
  const out = [];
  const t = makeTools(0x7e417);

  const texts = Array.from({ length: 70 }, () => ({ text: t.text(16) }));
  out.push(
    ...(await each('placeholderKeys', texts, ({ text }) =>
      PT.placeholderKeys(text),
    )),
  );
  out.push(
    ...(await each('splitTemplateText', texts, ({ text }) =>
      PT.splitTemplateText(text),
    )),
  );

  out.push(
    ...(await each(
      'buildTemplateContext',
      Array.from({ length: 30 }, () => ({
        replyTo: {
          author: {
            handle: t.plain(4),
            displayName: t.text(8, { blank: 0, word: 3 }),
          },
        },
        self: { handle: t.plain(3) },
        now: NOW,
        locale: 'en-US',
        tz: 'UTC',
      })),
      ({ replyTo, self, now, locale }) =>
        PT.buildTemplateContext({ replyTo, self, now: new Date(now), locale }),
    )),
  );

  const filling = Array.from({ length: 45 }, () => ({
    template: randomTemplate(t),
    answers: randomAnswers(t),
    context: randomContext(t),
  }));
  out.push(
    ...(await each('templateQuestions', filling, ({ template, context }) =>
      PT.templateQuestions(template, context),
    )),
  );
  out.push(
    ...(await each(
      'describeTemplate',
      filling.slice(0, 15),
      ({ template, context }) => PT.describeTemplate(template, context),
    )),
  );
  out.push(
    ...(await each(
      'missingAnswers',
      filling.slice(0, 20),
      ({ template, answers, context }) =>
        PT.missingAnswers(PT.templateQuestions(template, context), answers),
    )),
  );
  out.push(
    ...(await each('fillTemplate', filling, ({ template, answers, context }) =>
      PT.fillTemplate(template, answers, context),
    )),
  );
  out.push(
    ...(await each(
      'templatePreviewParts',
      filling,
      ({ template, answers, context }) =>
        PT.templatePreviewParts(template, answers, context),
    )),
  );

  out.push(
    ...(await each(
      'tidyTemplateParts',
      Array.from({ length: 70 }, () => ({
        parts: Array.from({ length: t.int(0, 7) }, () =>
          t.chance(0.35)
            ? { text: '', kind: 'empty' }
            : {
                text: t.text(5, { blank: 0, space: 6, punct: 3 }),
                kind: t.pick(['text', 'value', 'answer', 'context']),
              },
        ),
      })),
      ({ parts }) => PT.tidyTemplateParts(parts),
    )),
  );

  // Keywords drawn from the text's own pieces, so they match as often as not.
  const keywordInputs = Array.from({ length: 110 }, () => {
    const pieces = Array.from({ length: t.int(1, 8) }, () =>
      t.chance(0.6) ? t.pick(WORDS) : t.token({ blank: 0, space: 3 }),
    );
    const text = pieces.join(t.pick([' ', '', ', ', '-', '’', "'"]));
    const keywords = Array.from({ length: t.int(1, 4) }, () => {
      const from = t.int(0, pieces.length - 1);
      const kw = pieces
        .slice(from, from + t.int(1, 3))
        .join(t.pick([' ', '-', '']));
      if (t.chance(0.3)) return kw.slice(0, t.int(1, Math.max(1, kw.length)));
      if (t.chance(0.2)) return kw.toUpperCase();
      return kw;
    });
    return { template: { keywords }, text };
  });
  out.push(
    ...(await each('keywordMatches', keywordInputs, ({ template, text }) =>
      PT.keywordMatches(template, text),
    )),
  );

  // A context key asked for because the author has no display name: the
  // default is the handle's first label, capitalised by its first code unit.
  const HEADS = [
    'ß',
    'ŉ',
    'ǆ',
    'ǅ',
    'ﬁ',
    'ı',
    'i',
    'İ',
    'σ',
    'ς',
    'ſ',
    'ǰ',
    'ΐ',
    'ﬀ',
    '\u{1D49C}',
    '🌿',
    '1',
    'é',
    'e\u0301',
    'ǳ',
    'ꭰ',
    'ა',
  ];
  out.push(
    ...(await each(
      'templateQuestions',
      Array.from({ length: 44 }, (_, i) => ({
        $id: `capitalise-${i}`,
        template: {
          text: t.pick([
            '{{their.firstName}}',
            '{{their.name}} {{their.firstName}}',
          ]),
        },
        context: PT.buildTemplateContext({
          replyTo: {
            author: {
              handle: `${HEADS[i % HEADS.length]}${t.plain(2)}.${t.plain(2)}`,
              displayName: t.pick(['', ' ', '123', '🌿']),
            },
          },
          now: new Date(NOW),
          locale: 'en-US',
        }),
      })),
      ({ template, context }) => PT.templateQuestions(template, context),
    )),
  );

  out.push(
    ...(await each(
      'normalizeShortcut',
      Array.from({ length: 80 }, () => ({
        value: t.text(5, { blank: 0, punct: 4 }),
      })),
      ({ value: v }) => PT.normalizeShortcut(v),
    )),
  );
  out.push(
    ...(await each(
      'matchShortcut',
      Array.from({ length: 80 }, () => ({
        templates: Array.from({ length: t.int(0, 7) }, () => ({
          name: t.text(4, { blank: 0, word: 4 }),
          shortcut: t.chance(0.8)
            ? t.pick([
                'app',
                'apps',
                'ap',
                'a',
                'reset',
                'σας',
                'İ',
                '/App',
                'x-1',
                '',
              ])
            : t.plain(2),
          use: t.pick(['any', 'reply', 'post', undefined]),
        })),
        query: t.pick([
          'app',
          'ap',
          'a',
          'res',
          'σας',
          'ΣΑΣ',
          'i\u0307',
          '/A',
          '',
          'APP',
          'wren',
          'mode',
        ]),
        replying: t.chance(0.5),
        limit: t.pick([5, 5, 2, 0]),
      })),
      ({ templates, query, replying, limit }) =>
        PT.matchShortcut(templates, query, { replying, limit }),
    )),
  );

  out.push(
    ...(await each(
      'blankKeyFromLabel',
      Array.from({ length: 80 }, () => ({
        label: t.text(8, { blank: 0, word: 3, digit: 3 }),
      })),
      ({ label }) => PT.blankKeyFromLabel(label),
    )),
  );

  out.push(
    ...(await each(
      'normalizeTemplateRecord',
      Array.from({ length: 20 }, () => ({
        entry: {
          uri: `at://did:plc:me/net.anisota.feed.template/${t.pick(['3la', '3lb', '', 'a/b'])}`,
          cid: t.pick(['bafy', '', undefined]),
          value: randomTemplate(t),
        },
      })),
      ({ entry }) => PT.normalizeTemplateRecord(entry),
    )),
  );

  out.push(
    ...(await each(
      'templateToRecord',
      Array.from({ length: 30 }, () => ({
        template: randomTemplate(t),
        now: NOW,
        isUpdate: t.chance(0.5),
      })),
      ({ template, now, isUpdate }) =>
        PT.templateToRecord(template, { now: new Date(now), isUpdate }),
    )),
  );

  out.push(
    ...(await each(
      'validateTemplate',
      Array.from({ length: 50 }, () => ({
        template: t.chance(0.5) ? longTemplate(t) : randomTemplate(t),
        others: Array.from({ length: t.int(0, 3) }, () => ({
          rkey: t.pick(['3la', '3lb', 'a']),
          name: t.plain(3),
          shortcut: t.pick(['app', '/APP', 'x', '']),
        })),
      })),
      ({ template, others }) => {
        const errors = PT.validateTemplate(template, others);
        return { errors, order: Object.keys(errors) };
      },
    )),
  );

  const replies = Array.from({ length: 100 }, () => {
    const name = randomName(t);
    const first = firstWordOf(name);
    const args = {
      text: randomReplyText(t, first) + t.pick(['', ' ', '\n', ' \t ']),
      replyTo: { author: { displayName: name } },
    };
    if (t.chance(0.2))
      args.recordEmbed = {
        uri: 'at://did:plc:me/app.bsky.feed.post/3kq',
        cid: 'c',
      };
    if (t.chance(0.2)) args.linkUrl = 'https://docs.example/a';
    return args;
  });
  out.push(
    ...(await each('draftFromReply', replies, (args) =>
      ED.draftFromReply(args),
    )),
  );

  const templates = Array.from({ length: 15 }, () => ({
    template: randomTemplate(t),
  }));
  out.push(
    ...(await each('draftFromTemplate', templates, ({ template }) =>
      ED.draftFromTemplate(template),
    )),
  );
  out.push(
    ...(await each('roundTrip', templates, ({ template }) =>
      ED.templateFromDraft(ED.draftFromTemplate(template)),
    )),
  );
  const drafts = Array.from({ length: 22 }, () => {
    const d = ED.draftFromTemplate(randomTemplate(t));
    if (t.chance(0.5))
      d.keywordsText = t.text(6, { blank: 0, word: 3, punct: 3 });
    if (t.chance(0.3)) d.text = t.text(10);
    if (t.chance(0.3)) d.quoteMode = t.pick(['none', 'link', 'post']);
    if (t.chance(0.3)) d.quoteUrl = t.pick(['', ' ', 'https://x.example']);
    for (const v of d.variables)
      if (t.chance(0.4)) v.choicesText = t.text(5, { space: 5, blank: 0 });
    return { draft: d };
  });
  out.push(
    ...(await each('templateFromDraft', drafts, ({ draft }) =>
      ED.templateFromDraft(draft),
    )),
  );
  out.push(
    ...(await each('syncDraftVariables', drafts, ({ draft }) =>
      ED.syncDraftVariables(draft),
    )),
  );
  out.push(
    ...(await each('blanksIn', drafts.slice(0, 15), ({ draft }) =>
      EM.blanksIn(draft),
    )),
  );
  out.push(
    ...(await each(
      'editorProblems',
      drafts.map(({ draft }) => ({
        draft,
        others: [
          { rkey: '3la', name: 'Other', shortcut: t.pick(['app', 'x', '']) },
        ],
      })),
      ({ draft, others }) => {
        const problems = EM.editorProblems(draft, others);
        return { problems, order: Object.keys(problems) };
      },
    )),
  );
  out.push(
    ...(await each(
      'editorHasChanges',
      drafts.slice(0, 12).map(({ draft }, i) => ({
        initial: draft,
        draft:
          i % 2
            ? drafts[(i + 1) % drafts.length].draft
            : { ...draft, keywordsText: `${draft.keywordsText ?? ''}, ` },
      })),
      ({ initial, draft }) => EM.editorHasChanges(initial, draft),
    )),
  );

  out.push(
    ...(await each(
      'insertAtSelection',
      Array.from({ length: 80 }, () => {
        const text = t.text(8);
        const len = text.length;
        return {
          text,
          token: t.pick(['{{a}}', '{{their.firstName}}', '{{today}}']),
          selection: t.chance(0.85)
            ? { start: t.int(-2, len + 2), end: t.int(-2, len + 2) }
            : {},
        };
      }),
      ({ text, token, selection }) =>
        EM.insertAtSelection(text, token, selection),
    )),
  );
  out.push(
    ...(await each(
      'addBlank',
      drafts.slice(0, 20).map(({ draft }) => ({
        draft,
        label: t.text(5, { blank: 0, word: 3, digit: 2 }),
        selection: { start: t.int(0, 10), end: t.int(0, 10) },
      })),
      ({ draft, label, selection }) => EM.addBlank(draft, label, selection),
    )),
  );

  const groups = [
    '',
    ' ',
    'Help',
    'help',
    'Hélp',
    'Ω',
    'ω',
    'a',
    'B',
    'ß',
    'ss',
    'İ',
    'i',
  ];
  const names = [
    '',
    'a',
    'A',
    'á',
    'b',
    'Same',
    'same',
    'Zoë',
    'zoe',
    'ß',
    'ss',
    'é',
    'e\u0301',
    '🌿',
    'ﬁ',
    'fi',
  ];
  out.push(
    ...(await each(
      'sortTemplatesForShelf',
      Array.from({ length: 35 }, () => {
        const n = t.int(0, 9);
        const templates = Array.from({ length: n }, (_, i) => ({
          rkey: t.pick(['3la', '3lb', '3LA', 'a', `r${i}`, '3l-a', '3l.a']),
          name: t.pick(names),
          group: t.pick(groups),
        }));
        const usage = {};
        for (const tpl of templates)
          if (t.chance(0.4)) usage[tpl.rkey] = { count: t.int(0, 3) };
        return { templates, usage };
      }),
      ({ templates, usage }) => sortTemplatesForShelf(templates, usage),
    )),
  );

  return out;
}
