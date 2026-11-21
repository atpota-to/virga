// src/posting/templates/postTemplates.js: blanks, the context they fill
// from, the questions a template asks, filling and previewing (with the gap
// an empty blank leaves closed), keywords and shortcuts, and the record
// written to net.anisota.feed.template and read back. Swift:
// VirgaPosting/Templates/PostTemplates.swift.
//
// Inputs from postTemplates.test.js, plus unicode and emoji (ZWJ families,
// combining marks, a leading emoji, RTL names, Turkish dotted I, Greek final
// sigma), empty and malformed templates, contexts with parts missing, odd
// answers, every placeholder and every branch of tidyTemplateParts.
//
// Kept out, because the port differs there on purpose (see the Swift
// header): shapes the web throws a TypeError on (a null in `variables`,
// `variables` that isn't an array), and labels, hints, choices, keywords,
// handles, URIs and CIDs that aren't strings, which the web passes through
// raw and the port gives as their String form.

import * as PT from '../../../src/posting/templates/postTemplates.js';
import { each, value } from './_helpers.js';
import { inZone } from './_zones.js';
import {
  ANSWERS,
  CONTEXTS,
  FAMILY,
  NOW,
  RECORDS,
  REPLIES,
  TEMPLATES,
  TIDY,
  TO_RECORD,
  VALIDATE,
  ZONES,
  ada,
  idea,
  self,
} from './_templates.js';

export const sources = ['src/posting/templates/postTemplates.js'];

export default async function cases() {
  const out = [];

  out.push(value('TEMPLATE_COLLECTION', PT.TEMPLATE_COLLECTION));
  out.push(value('TEMPLATE_LIMITS', PT.TEMPLATE_LIMITS));
  out.push(value('TEMPLATE_USES', PT.TEMPLATE_USES));
  out.push(value('TEMPLATE_RECORD_FIELDS', PT.TEMPLATE_RECORD_FIELDS));
  out.push(value('TEMPLATE_VARIABLE_FIELDS', PT.TEMPLATE_VARIABLE_FIELDS));
  out.push(value('CONTEXT_KEYS', PT.CONTEXT_KEYS));
  out.push(value('CONTEXT_LABELS', PT.CONTEXT_LABELS));

  const KEYS = [
    'their.firstName',
    'their.name',
    'their.handle',
    'their.',
    'their',
    'their.anything',
    'my.handle',
    'my.',
    'my',
    'today',
    'Today',
    'today ',
    'tomorrow',
    'idea',
    '',
    'their\u0301.x',
  ];
  out.push(
    ...(await each(
      'isContextKey',
      [...KEYS, null, 5, true, ['today']].map((key) => ({ key })),
      ({ key }) => PT.isContextKey(key),
    )),
  );

  const TEXTS = [
    '{{a}} {{ b }} {{a}} {{their.name}}',
    '',
    '{{1bad}} {{}}',
    'Hi {{name}}!',
    'No blanks at all',
    '{{a}}{{b}}{{c}}',
    '{{a}',
    '{a}}',
    '{{ a  }}',
    '{{\na\n}}',
    '{{\u2028a\u2029}}',
    '{{\u00A0a\u00A0}}',
    '{{a b}}',
    `{{${'z'.repeat(32)}}}`,
    `{{${'z'.repeat(33)}}}`,
    '{{a.b.c}} {{a-b}} {{a_b}} {{_a}} {{-a}} {{.a}}',
    '{{é}} {{e\u0301}} {{K}} {{K}}',
    '{{{a}}} {{{{b}}}}',
    '🌿{{plant}}🌿 {{their.firstName}}!',
    `${FAMILY}{{x}}${FAMILY}`,
    'trailing {{x}}',
    '{{x}} leading',
    ...Object.values(TEMPLATES)
      .map((t) => t.text)
      .filter((t) => typeof t === 'string'),
  ];
  out.push(
    ...(await each(
      'placeholderKeys',
      [
        ...TEXTS,
        null,
        undefined,
        12345,
        ['{{a}}', '{{b}}'],
        { text: '{{a}}' },
        true,
      ].map((text) => ({ text })),
      ({ text }) => PT.placeholderKeys(text),
    )),
  );
  out.push(
    ...(await each(
      'splitTemplateText',
      [...TEXTS, null, 12345, ['{{a}}', 'x']].map((text) => ({ text })),
      ({ text }) => PT.splitTemplateText(text),
    )),
  );

  // buildTemplateContext, in several zones and locales.
  const contextInputs = [];
  for (const [name, reply] of Object.entries(REPLIES)) {
    contextInputs.push({
      $id: `reply-${name}`,
      replyTo: reply,
      self,
      now: NOW,
      locale: 'en-US',
      tz: 'UTC',
    });
  }
  for (const tz of ZONES) {
    for (const now of [
      '2026-10-14T12:00:00.000Z',
      '2026-12-31T23:30:00.000Z',
      '2026-01-01T00:15:00.000Z',
      '2027-02-28T11:00:00.000Z',
    ]) {
      for (const locale of ['en-US', 'en-GB', 'en-IN', 'en-DE']) {
        contextInputs.push({
          $id: `today-${tz}-${now}-${locale}`,
          replyTo: ada,
          self,
          now,
          locale,
          tz,
        });
      }
    }
  }
  contextInputs.push(
    { $id: 'no-args', now: NOW, locale: 'en-US', tz: 'UTC' },
    { $id: 'no-self', replyTo: ada, now: NOW, locale: 'en-US', tz: 'UTC' },
    {
      $id: 'self-empty-handle',
      replyTo: ada,
      self: { handle: '' },
      now: NOW,
      locale: 'en-US',
      tz: 'UTC',
    },
    {
      $id: 'self-null',
      replyTo: ada,
      self: null,
      now: NOW,
      locale: 'en-US',
      tz: 'UTC',
    },
    {
      $id: 'reply-null',
      replyTo: null,
      self,
      now: NOW,
      locale: 'en-US',
      tz: 'UTC',
    },
    {
      $id: 'reply-string',
      replyTo: 'post',
      self,
      now: NOW,
      locale: 'en-US',
      tz: 'UTC',
    },
  );
  out.push(
    ...(await each(
      'buildTemplateContext',
      contextInputs,
      ({ replyTo, self: me, now, locale, tz }) =>
        inZone(tz, () =>
          PT.buildTemplateContext({
            replyTo,
            self: me,
            now: new Date(now),
            locale,
          }),
        ),
    )),
  );

  const contextKeys = [
    ...PT.CONTEXT_KEYS,
    'their.other',
    'my.name',
    'idea',
    '',
  ];
  const valueInputs = [];
  for (const [cname, context] of Object.entries(CONTEXTS))
    for (const key of contextKeys)
      valueInputs.push({ $id: `${cname}-${key}`, key, context });
  out.push(
    ...(await each('contextValue', valueInputs, ({ key, context }) =>
      PT.contextValue(key, context),
    )),
  );

  // Questions, filling and previews over every template, context and answer set.
  const questionInputs = [];
  const QUESTION_CONTEXTS = [
    'ada',
    'juniper',
    'none',
    'noSelf',
    'noName',
    'dottedHandle',
    'upperHandle',
    'null',
    'emptyStrings',
    'handleOnly',
    'leadingDot',
    'emojiHandle',
  ];
  for (const [tname, template] of Object.entries(TEMPLATES))
    for (const cname of QUESTION_CONTEXTS)
      questionInputs.push({
        $id: `${tname}-${cname}`,
        template,
        context: CONTEXTS[cname],
      });
  out.push(
    ...(await each(
      'templateQuestions',
      questionInputs,
      ({ template, context }) => PT.templateQuestions(template, context),
    )),
  );
  out.push(
    ...(await each(
      'describeTemplate',
      questionInputs.filter((c) => /-(ada|juniper|none|null)$/.test(c.$id)),
      ({ template, context }) => PT.describeTemplate(template, context),
    )),
  );

  const initialInputs = [];
  for (const [tname, template] of Object.entries(TEMPLATES))
    for (const cname of ['ada', 'juniper', 'none'])
      initialInputs.push({
        $id: `${tname}-${cname}`,
        questions: PT.templateQuestions(template, CONTEXTS[cname]),
      });
  initialInputs.push(
    { $id: 'null', questions: null },
    { $id: 'empty', questions: [] },
  );
  out.push(
    ...(await each('initialAnswers', initialInputs, ({ questions }) =>
      PT.initialAnswers(questions),
    )),
  );

  const missingInputs = [];
  for (const [tname, template] of Object.entries(TEMPLATES))
    for (const aname of [
      'none',
      'empty',
      'idea',
      'everything',
      'padded',
      'numbers',
      'prototype',
    ]) {
      const answers = ANSWERS[aname];
      missingInputs.push({
        $id: `${tname}-${aname}`,
        questions: PT.templateQuestions(template, CONTEXTS.juniper),
        answers,
      });
    }
  out.push(
    ...(await each('missingAnswers', missingInputs, ({ questions, answers }) =>
      PT.missingAnswers(questions, answers),
    )),
  );

  out.push(
    ...(await each(
      'tidyTemplateParts',
      Object.entries(TIDY).map(([name, parts]) => ({ $id: name, parts })),
      ({ parts }) => PT.tidyTemplateParts(parts),
    )),
  );

  // Use and keywords.
  const offeredInputs = [];
  for (const use of [
    'reply',
    'post',
    'any',
    'bogus',
    '',
    null,
    undefined,
    'Reply',
    5,
  ])
    for (const replying of [true, false])
      offeredInputs.push({
        template: use === undefined ? {} : { use },
        replying,
      });
  offeredInputs.push(
    { template: null, replying: true },
    { template: null, replying: false },
  );
  out.push(
    ...(await each('templateOffered', offeredInputs, ({ template, replying }) =>
      PT.templateOffered(template, { replying }),
    )),
  );

  const KEYWORD_CASES = [
    [idea, 'Would LOVE this'],
    [idea, 'it keeps resetting'],
    [idea, 'Lovely features'],
    [{ keywords: ['app'] }, 'apple pie'],
    [{ keywords: ['app'] }, 'the app!'],
    [{ keywords: [] }, 'anything'],
    [
      {
        keywords: ['dark mode', 'battery life', '#mothweek', 'e-mail', 'don’t'],
      },
      "How do I turn on dark mode? Battery life is bad. #mothweek e-mail, don't",
    ],
    [
      { keywords: ['#mothweek', 'dark mode'] },
      'mothweek is here, in dark-mode',
    ],
    [{ keywords: ['dark mode'] }, 'mode is dark'],
    [{ keywords: ['dark mode'] }, 'the dark modes'],
    [{ keywords: ['dark mode'] }, 'darker mode'],
    [{ keywords: ['#', '--'] }, '# -- #'],
    [{ keywords: ['don’t', "won't"] }, 'I don’t and won’t'],
    [{ keywords: ["'quoted'"] }, "it's 'quoted' here"],
    [{ keywords: ['ΣΑΣ', 'οδος'] }, 'σας ΟΔΟΣ'],
    [{ keywords: ['istanbul', 'İstanbul'] }, 'İSTANBUL is big'],
    [{ keywords: ['café'] }, 'CAFÉ au lait'],
    [{ keywords: ['café'] }, 'cafe\u0301 au lait'],
    [{ keywords: ['naïve'] }, 'naïveté'],
    [{ keywords: ['日本'] }, '日本語を話す'],
    [{ keywords: ['🌿', 'plant'] }, '🌿 plants 🌿'],
    [{ keywords: ['123', '2026'] }, 'in 2026 we 1234'],
    [{ keywords: ['abcd'] }, 'abc abcd'],
    [{ keywords: ['abc'] }, 'abcd'],
    [{ keywords: ['a b c d'] }, 'a b c dee'],
    [{ keywords: ['a b c d'] }, 'a b cc d'],
    [{ keywords: ['', null, 'x'] }, 'x'],
    [{ keywords: 'x' }, 'x'],
    [{ keywords: ['x'] }, ''],
    [{ keywords: ['x'] }, null],
    [{}, 'x'],
    [null, 'x'],
    [{ keywords: ['mod'] }, 'MODE modular'],
    [{ keywords: ['mode'] }, 'MODE modular'],
    [{ keywords: ['İ'] }, 'i\u0307'],
    [{ keywords: ['ﬁle'] }, 'file'],
  ];
  out.push(
    ...(await each(
      'keywordMatches',
      KEYWORD_CASES.map(([template, text]) => ({ template, text })),
      ({ template, text }) => PT.keywordMatches(template, text),
    )),
  );

  const SHORTCUTS = [
    '  /Bug ',
    '/',
    '//a',
    '/ a',
    'A/B',
    'İ',
    'ΣΑΣ',
    '',
    null,
    undefined,
    'x\u00A0',
    '\u3000/y',
    5,
    0,
    true,
    ['a'],
  ];
  out.push(
    ...(await each(
      'normalizeShortcut',
      SHORTCUTS.map((value) => ({ value })),
      ({ value: v }) => PT.normalizeShortcut(v),
    )),
  );

  const LISTS = {
    apps: [
      { name: 'Application notes', shortcut: 'notes' },
      { name: 'Apps', shortcut: 'apps' },
      { name: 'Is there an app?', shortcut: 'app' },
    ],
    tones: [
      { name: 'Thanks', shortcut: '' },
      { name: 'Stamina help', shortcut: 'stamina' },
      { name: 'Just because' },
    ],
    uses: [
      { name: 'Release', shortcut: 'rel', use: 'post' },
      { name: 'Reply', shortcut: 'rely', use: 'reply' },
      { name: 'Either', shortcut: 'reither' },
    ],
    many: Array.from({ length: 9 }, (_, i) => ({
      name: `Item ${i}`,
      shortcut: `it${i}`,
      use: i % 2 ? 'post' : 'any',
    })),
    odd: [
      { name: 42, shortcut: 5 },
      { name: null, shortcut: '/UPPER' },
      { name: 'ΣΑΣ thing', shortcut: 'σας' },
      { name: 'Café', shortcut: 'cafe' },
      {},
    ],
  };
  const QUERIES = [
    'app',
    '/APP',
    'zzz',
    's',
    'j',
    'hj',
    'srs',
    'tha',
    'help',
    're',
    '',
    '/',
    'it',
    'item',
    'ΣΑΣ',
    'σας',
    'caf',
    'café',
    'upper',
    '42',
    null,
  ];
  const matchInputs = [];
  for (const [lname, templates] of Object.entries(LISTS))
    for (const query of QUERIES)
      for (const replying of lname === 'uses' ? [false, true] : [false])
        matchInputs.push({
          $id: `${lname}-${query}-${replying}`,
          templates,
          query,
          replying,
        });
  for (const limit of [0, 1, 2, 3, -1, -2, 100])
    matchInputs.push({
      $id: `limit-${limit}`,
      templates: LISTS.many,
      query: 'it',
      replying: false,
      limit,
    });
  matchInputs.push({
    $id: 'null-list',
    templates: null,
    query: 'a',
    replying: false,
  });
  out.push(
    ...(await each(
      'matchShortcut',
      matchInputs,
      ({ templates, query, replying, limit }) =>
        PT.matchShortcut(
          templates,
          query,
          limit === undefined ? { replying } : { replying, limit },
        ),
    )),
  );

  const LABELS = [
    'device type',
    '2 things',
    'Which app?',
    '???',
    '',
    null,
    '  Lots   of   SPACE  ',
    'snake_case_label',
    'kebab-case-label',
    'CamelCase Label',
    '123 456',
    '1st place 2nd',
    'Café olé',
    'ÄÖÜ ok',
    '🌿 plant name',
    'a'.repeat(40),
    'one two three four five six seven eight',
    'x',
    'X',
    5,
    'İstanbul trip',
  ];
  out.push(
    ...(await each(
      'blankKeyFromLabel',
      LABELS.map((label) => ({ label })),
      ({ label }) => PT.blankKeyFromLabel(label),
    )),
  );

  out.push(
    ...(await each(
      'normalizeTemplateRecord',
      Object.entries(RECORDS).map(([name, entry]) => ({ $id: name, entry })),
      ({ entry }) => PT.normalizeTemplateRecord(entry),
    )),
  );

  const toRecordInputs = [];
  for (const [name, template] of Object.entries(TO_RECORD))
    for (const isUpdate of [false, true])
      toRecordInputs.push({
        $id: `${name}-${isUpdate}`,
        template,
        now: NOW,
        isUpdate,
      });
  toRecordInputs.push({
    $id: 'no-opts',
    template: TO_RECORD.fromTest,
    now: NOW,
  });
  out.push(
    ...(await each(
      'templateToRecord',
      toRecordInputs,
      ({ template, now, isUpdate }) =>
        PT.templateToRecord(
          template,
          isUpdate === undefined
            ? { now: new Date(now) }
            : { now: new Date(now), isUpdate },
        ),
    )),
  );

  out.push(
    ...(await each(
      'validateTemplate',
      Object.entries(VALIDATE).map(([name, [template, others]]) => ({
        $id: name,
        template,
        others,
      })),
      ({ template, others }) => {
        const errors =
          others === undefined
            ? PT.validateTemplate(template)
            : PT.validateTemplate(template, others);
        // The order matters: the first is the message a refused save shows.
        return { errors, order: Object.keys(errors) };
      },
    )),
  );

  return out;
}
