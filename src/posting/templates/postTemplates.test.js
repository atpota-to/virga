/*
 * The pure half of post templates: blanks, context, the questions a template
 * asks, filling, preview parts, keyword and shortcut matching, and the record
 * shape written to net.anisota.feed.template.
 */

import { describe, it, expect } from 'vitest';
import {
  TEMPLATE_COLLECTION,
  TEMPLATE_RECORD_FIELDS,
  TEMPLATE_VARIABLE_FIELDS,
  blankKeyFromLabel,
  buildTemplateContext,
  contextValue,
  describeTemplate,
  fillTemplate,
  initialAnswers,
  isContextKey,
  keywordMatches,
  matchShortcut,
  missingAnswers,
  normalizeShortcut,
  normalizeTemplateRecord,
  placeholderKeys,
  splitTemplateText,
  templateOffered,
  templatePreviewParts,
  templateQuestions,
  templateToRecord,
  tidyTemplateParts,
  validateTemplate,
} from './postTemplates.js';

// The lexicon's own lists (net.anisota.feed.template, in Anisota's repo).
const lexicon = {
  record: [
    'name',
    'text',
    'variables',
    'embed',
    'use',
    'group',
    'shortcut',
    'keywords',
    'langs',
    'createdAt',
    'updatedAt',
  ],
  variable: ['key', 'label', 'hint', 'kind', 'choices', 'default', 'optional'],
};

const NOW = new Date('2026-10-14T12:00:00Z');
const ada = {
  author: { handle: 'ada.example', displayName: 'Ada Ferreira' },
  record: { text: 'would love a way to pin feeds' },
};
const juniper = { author: { handle: 'juniper.example', displayName: '' } };
const self = { handle: 'you.example' };

const idea = {
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

describe('blanks', () => {
  it('finds unique keys in order, tolerating spaces in the braces', () => {
    expect(placeholderKeys('{{a}} {{ b }} {{a}} {{their.name}}')).toEqual([
      'a',
      'b',
      'their.name',
    ]);
    expect(placeholderKeys('')).toEqual([]);
    expect(placeholderKeys('{{1bad}} {{}}')).toEqual([]);
  });

  it('splits text into literal and blank segments', () => {
    expect(splitTemplateText('Hi {{name}}!')).toEqual([
      { type: 'text', value: 'Hi ' },
      { type: 'blank', key: 'name' },
      { type: 'text', value: '!' },
    ]);
  });

  it('knows which keys fill themselves', () => {
    expect(isContextKey('their.firstName')).toBe(true);
    expect(isContextKey('my.handle')).toBe(true);
    expect(isContextKey('today')).toBe(true);
    expect(isContextKey('idea')).toBe(false);
  });
});

describe('context', () => {
  it('takes the first word of the display name, skipping a leading emoji', () => {
    const ctx = buildTemplateContext({
      replyTo: {
        author: { handle: 'w.example', displayName: '🌿 Wren Okafor' },
      },
      self,
      now: NOW,
      locale: 'en-US',
    });
    expect(contextValue('their.firstName', ctx)).toBe('Wren');
    expect(contextValue('their.name', ctx)).toBe('🌿 Wren Okafor');
    expect(contextValue('their.handle', ctx)).toBe('@w.example');
    expect(contextValue('my.handle', ctx)).toBe('@you.example');
    expect(contextValue('today', ctx)).toBe('October 14');
  });

  it('has no "their" values without a post being replied to', () => {
    const ctx = buildTemplateContext({ self, now: NOW });
    expect(ctx.their).toBeNull();
    expect(contextValue('their.firstName', ctx)).toBeNull();
  });
});

describe('questions', () => {
  it('asks the template blanks and fills context ones', () => {
    const ctx = buildTemplateContext({ replyTo: ada, self, now: NOW });
    const qs = templateQuestions(idea, ctx);
    expect(qs.map((q) => q.key)).toEqual(['idea', 'timing']);
    expect(qs[1]).toMatchObject({
      kind: 'choice',
      optional: true,
      choices: ['Soon.', 'Someday.'],
    });
  });

  it('asks a context blank when the context is missing, starting from the handle', () => {
    const ctx = buildTemplateContext({ replyTo: juniper, self, now: NOW });
    const qs = templateQuestions(idea, ctx);
    expect(qs[0]).toMatchObject({
      key: 'their.firstName',
      isContext: true,
      defaultValue: 'Juniper',
    });
    expect(qs[0].note).toMatch(/no display name/);
  });

  it('labels an undeclared blank by its key', () => {
    const qs = templateQuestions(
      { text: 'Version {{version}}' },
      buildTemplateContext({ self, now: NOW }),
    );
    expect(qs[0].label).toBe('Fill in “version”');
  });

  it('reports the required answers still missing', () => {
    const ctx = buildTemplateContext({ replyTo: ada, self, now: NOW });
    const qs = templateQuestions(idea, ctx);
    expect(missingAnswers(qs, initialAnswers(qs))).toEqual(['idea']);
    expect(missingAnswers(qs, { idea: 'pinned feeds' })).toEqual([]);
  });

  it('reads only answers that were given, never Object.prototype’s', () => {
    const ctx = buildTemplateContext({ self, now: NOW });
    const t = { text: 'Ask the {{constructor}} about {{valueOf}}' };
    const qs = templateQuestions(t, ctx);
    expect(qs.map((q) => q.key)).toEqual(['constructor', 'valueOf']);
    expect(missingAnswers(qs, {})).toEqual(['constructor', 'valueOf']);
    expect(fillTemplate(t, {}, ctx)).toBe('Ask the about');
    expect(
      templatePreviewParts(t, {}, ctx)
        .filter((p) => p.kind === 'blank')
        .map((p) => p.text),
    ).toEqual(['constructor', 'valueOf']);
    expect(fillTemplate(t, { constructor: 'owl', valueOf: 'moths' }, ctx)).toBe(
      'Ask the owl about moths',
    );
  });
});

describe('filling', () => {
  const ctx = buildTemplateContext({ replyTo: ada, self, now: NOW });

  it('fills answers and context, and tidies an empty optional blank', () => {
    expect(fillTemplate(idea, { idea: 'pinned feeds' }, ctx)).toBe(
      "Thank you, Ada. I like the idea of pinned feeds, and it's on our list now.",
    );
    expect(
      fillTemplate(idea, { idea: 'pinned feeds', timing: 'Soon.' }, ctx),
    ).toBe(
      "Thank you, Ada. I like the idea of pinned feeds, and it's on our list now. Soon.",
    );
  });

  it('leaves the template’s own spacing and punctuation as written', () => {
    const fill = (text) => fillTemplate({ text }, {}, ctx);
    expect(fill('Glad you like it :) see you ;)')).toBe(
      'Glad you like it :) see you ;)',
    );
    expect(fill('Bonjour {{their.firstName}} ! Ça va ?')).toBe(
      'Bonjour Ada ! Ça va ?',
    );
    expect(fill('Well ... maybe')).toBe('Well ... maybe');
    expect(fill('Code:\n    indented  twice \nnext')).toBe(
      'Code:\n    indented  twice \nnext',
    );
    // Only the ends are trimmed.
    expect(fill('  Hi {{their.firstName}}.\n')).toBe('Hi Ada.');
  });

  it('closes the gap an empty blank leaves, and only there', () => {
    const optional = (text) => ({
      text,
      variables: ['a', 'b'].map((key) => ({ key, optional: true })),
    });
    const fill = (text) => fillTemplate(optional(text), {}, ctx);
    expect(fill('one {{a}} two')).toBe('one two');
    expect(fill('one  {{a}} two')).toBe('one  two');
    expect(fill('one {{a}}{{b}} two')).toBe('one two');
    expect(fill('one {{a}} {{b}} two')).toBe('one two');
    expect(fill('on our list. {{a}}')).toBe('on our list.');
    expect(fill('first {{a}}\nsecond')).toBe('first\nsecond');
    expect(fill('{{a}} starts here')).toBe('starts here');
    expect(fill('Code:\n    {{a}}indented')).toBe('Code:\n    indented');
    expect(fill('Code:\n    {{a}} indented')).toBe('Code:\n    indented');
    expect(fill('the idea of {{a}}, and')).toBe('the idea of, and');
    // A space the author put before the punctuation stays.
    expect(fill('Bonjour {{a}} !')).toBe('Bonjour !');
    expect(fill('Hi {{a}} :) there')).toBe('Hi :) there');
  });

  it('tidies parts, keeping their fields and dropping the empty ones', () => {
    expect(
      tidyTemplateParts([
        { text: 'Hi ', kind: 'text' },
        { text: 'Ada', kind: 'context', key: 'their.firstName' },
        { text: ' ', kind: 'text' },
        { text: '', kind: 'empty', key: 'x' },
        { text: '. ', kind: 'text' },
        { text: '', kind: 'empty' },
      ]),
    ).toEqual([
      { text: 'Hi ', kind: 'text' },
      { text: 'Ada', kind: 'context', key: 'their.firstName' },
      { text: '.', kind: 'text' },
    ]);
    expect(tidyTemplateParts([])).toEqual([]);
    expect(tidyTemplateParts(null)).toEqual([]);
  });

  it('fills a context key from the context once it has one, whatever was answered before', () => {
    const t = { text: "I'm {{my.handle}}" };
    const answers = { 'my.handle': '@alt.test' };
    const before = buildTemplateContext({ replyTo: ada, self: {}, now: NOW });
    expect(templateQuestions(t, before).map((q) => q.key)).toEqual([
      'my.handle',
    ]);
    expect(fillTemplate(t, answers, before)).toBe("I'm @alt.test");
    expect(fillTemplate(t, answers, ctx)).toBe("I'm @you.example");
    expect(
      templatePreviewParts(t, answers, ctx)
        .map((p) => p.text)
        .join(''),
    ).toBe(fillTemplate(t, answers, ctx));
  });

  it('previews the same text it fills once every required blank is answered', () => {
    const answers = { idea: 'pinned feeds' };
    expect(
      templatePreviewParts(idea, answers, ctx)
        .map((p) => p.text)
        .join(''),
    ).toBe(fillTemplate(idea, answers, ctx));
  });

  it('builds preview parts that mark where each word came from', () => {
    const parts = templatePreviewParts(idea, { idea: '' }, ctx);
    expect(parts.find((p) => p.kind === 'context')).toMatchObject({
      text: 'Ada',
      key: 'their.firstName',
    });
    expect(parts.find((p) => p.kind === 'blank')).toMatchObject({
      key: 'idea',
    });
    expect(parts.some((p) => p.key === 'timing')).toBe(false);
    const answered = templatePreviewParts(idea, { idea: 'pins' }, ctx);
    expect(answered.find((p) => p.kind === 'answer')).toMatchObject({
      text: 'pins',
    });
  });

  it('describes what a template does', () => {
    expect(describeTemplate(idea, ctx)).toEqual({
      questions: 2,
      quotes: false,
      fillsContext: true,
    });
    expect(
      describeTemplate(
        { text: '', embed: { $type: 'app.bsky.embed.record' } },
        ctx,
      ),
    ).toMatchObject({ quotes: true, questions: 0 });
  });
});

describe('matching', () => {
  it('matches keywords on whole words, and longer keywords on word starts', () => {
    expect(keywordMatches(idea, 'Would LOVE this')).toEqual(['love']);
    expect(keywordMatches(idea, 'it keeps resetting')).toEqual(['reset']);
    expect(keywordMatches({ keywords: ['app'] }, 'apple pie')).toEqual([]);
    expect(keywordMatches({ keywords: [] }, 'anything')).toEqual([]);
  });

  it('matches keywords with spaces, hashtags and hyphens as the words in a row', () => {
    const keywords = [
      'dark mode',
      'battery life',
      '#mothweek',
      'e-mail',
      'don’t',
    ];
    expect(
      keywordMatches(
        { keywords },
        "How do I turn on dark mode? Battery life is bad. #mothweek e-mail, don't",
      ),
    ).toEqual(keywords);
    expect(
      keywordMatches(
        { keywords: ['#mothweek', 'dark mode'] },
        'mothweek is here, in dark-mode',
      ),
    ).toEqual(['#mothweek', 'dark mode']);
    // The words must be in a row, and the last may start a longer word.
    expect(keywordMatches({ keywords: ['dark mode'] }, 'mode is dark')).toEqual(
      [],
    );
    expect(
      keywordMatches({ keywords: ['dark mode'] }, 'the dark modes'),
    ).toEqual(['dark mode']);
    expect(keywordMatches({ keywords: ['dark mode'] }, 'darker mode')).toEqual(
      [],
    );
    expect(keywordMatches({ keywords: ['#', '--'] }, '# -- #')).toEqual([]);
  });

  it('offers templates by use', () => {
    expect(templateOffered({ use: 'reply' }, { replying: true })).toBe(true);
    expect(templateOffered({ use: 'reply' }, { replying: false })).toBe(false);
    expect(templateOffered({ use: 'post' }, { replying: false })).toBe(true);
    expect(templateOffered({ use: 'bogus' }, { replying: true })).toBe(true);
  });

  it('ranks shortcut matches: exact, then prefix, then name', () => {
    const list = [
      { name: 'Application notes', shortcut: 'notes' },
      { name: 'Apps', shortcut: 'apps' },
      { name: 'Is there an app?', shortcut: 'app' },
    ];
    expect(matchShortcut(list, 'app').map((t) => t.shortcut)).toEqual([
      'app',
      'apps',
      'notes',
    ]);
    expect(matchShortcut(list, '/APP')[0].shortcut).toBe('app');
    expect(matchShortcut(list, 'zzz')).toEqual([]);
  });

  it('matches names only for three characters or more, so tone tags find nothing by name', () => {
    const list = [
      { name: 'Thanks', shortcut: '' },
      { name: 'Stamina help', shortcut: 'stamina' },
      { name: 'Just because' },
    ];
    expect(matchShortcut(list, 's').map((t) => t.name)).toEqual([
      'Stamina help',
    ]);
    expect(matchShortcut(list, 'j')).toEqual([]);
    expect(matchShortcut(list, 'hj')).toEqual([]);
    expect(matchShortcut(list, 'srs')).toEqual([]);
    expect(matchShortcut(list, 'tha').map((t) => t.name)).toEqual(['Thanks']);
    expect(matchShortcut(list, 'help').map((t) => t.name)).toEqual([
      'Stamina help',
    ]);
  });

  it('sorts templates made for the other context after the rest', () => {
    const list = [
      { name: 'Release', shortcut: 'rel', use: 'post' },
      { name: 'Reply', shortcut: 'rely', use: 'reply' },
    ];
    expect(
      matchShortcut(list, 're', { replying: true }).map((t) => t.name),
    ).toEqual(['Reply', 'Release']);
  });

  it('normalises shortcuts and blank keys', () => {
    expect(normalizeShortcut('  /Bug ')).toBe('bug');
    expect(blankKeyFromLabel('device type')).toBe('deviceType');
    expect(blankKeyFromLabel('2 things')).toBe('things');
  });
});

describe('records', () => {
  it('writes only what the template has, and only variables the text still uses', () => {
    const record = templateToRecord(
      {
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
      { now: NOW },
    );
    expect(record).toMatchObject({
      $type: TEMPLATE_COLLECTION,
      name: 'Thanks for the idea',
      use: 'reply',
      group: 'Ideas',
      shortcut: 'idea',
      keywords: ['love'],
      langs: ['en'],
      createdAt: NOW.toISOString(),
    });
    expect(record.variables.map((v) => v.key)).toEqual(['idea', 'timing']);
    expect(record.updatedAt).toBeUndefined();
    expect(
      templateToRecord(
        { name: 'x', text: 'y', createdAt: '2026-01-01T00:00:00.000Z' },
        { now: NOW, isUpdate: true },
      ),
    ).toMatchObject({
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: NOW.toISOString(),
    });
  });

  it('writes only fields the lexicon declares', () => {
    expect([...TEMPLATE_RECORD_FIELDS]).toEqual(lexicon.record);
    expect([...TEMPLATE_VARIABLE_FIELDS]).toEqual(lexicon.variable);
    const declared = new Set(['$type', ...lexicon.record]);
    const record = templateToRecord(
      {
        ...idea,
        group: 'g',
        shortcut: 's',
        langs: ['en'],
        embed: {
          $type: 'app.bsky.embed.record',
          record: { uri: 'at://x/app.bsky.feed.post/1', cid: 'c' },
        },
      },
      { now: NOW, isUpdate: true },
    );
    for (const key of Object.keys(record))
      expect(declared.has(key), key).toBe(true);
    const varProps = new Set(lexicon.variable);
    for (const v of record.variables)
      for (const key of Object.keys(v))
        expect(varProps.has(key), key).toBe(true);
  });

  it('reads a record back, forgiving unknown values', () => {
    const t = normalizeTemplateRecord({
      uri: 'at://did:plc:me/net.anisota.feed.template/3abc',
      cid: 'cid1',
      value: {
        name: 'N',
        text: 'T {{x}}',
        use: 'later',
        shortcut: '/X',
        variables: [{ key: 'x', kind: 'choice', choices: [] }, { nokey: true }],
        keywords: ['a', 3],
      },
    });
    expect(t).toMatchObject({
      rkey: '3abc',
      use: 'any',
      shortcut: 'x',
      keywords: ['a'],
    });
    expect(t.variables).toEqual([{ key: 'x' }]);
    expect(t.embed).toBeNull();
  });

  it('validates names, text, shortcuts, choices and keywords', () => {
    expect(validateTemplate({ name: '', text: '' })).toMatchObject({
      name: expect.any(String),
      text: expect.any(String),
    });
    expect(
      validateTemplate({
        name: 'Ok',
        text: '',
        embed: { $type: 'app.bsky.embed.record' },
      }),
    ).toEqual({});
    expect(
      validateTemplate({ name: 'Ok', text: 'x'.repeat(301) }).text,
    ).toMatch(/longer/);
    expect(
      validateTemplate({ name: 'Ok', text: 'x', shortcut: 'no spaces' })
        .shortcut,
    ).toMatch(/letters/);
    expect(
      validateTemplate({ name: 'Ok', text: 'x', shortcut: 'app', rkey: 'b' }, [
        { rkey: 'a', name: 'Other', shortcut: 'app' },
      ]).shortcut,
    ).toMatch(/already/);
    expect(
      validateTemplate({ name: 'Ok', text: 'x', shortcut: 'app', rkey: 'a' }, [
        { rkey: 'a', name: 'Same', shortcut: 'app' },
      ]),
    ).toEqual({});
    expect(
      validateTemplate({
        name: 'Ok',
        text: '{{when}}',
        variables: [{ key: 'when', kind: 'choice', choices: [' '] }],
      }).variables,
    ).toMatch(/choice/);
    expect(
      validateTemplate({
        name: 'Ok',
        text: 'x',
        keywords: Array.from({ length: 21 }, (_, i) => 'k' + i),
      }).keywords,
    ).toMatch(/at most/);
  });

  it('accepts keywords with spaces, hashtags and hyphens, and refuses one with no letters', () => {
    expect(
      validateTemplate({
        name: 'Ok',
        text: 'x',
        keywords: ['dark mode', '#mothweek', 'e-mail'],
      }),
    ).toEqual({});
    expect(
      validateTemplate({ name: 'Ok', text: 'x', keywords: ['moths', '#'] })
        .keywords,
    ).toBe('Each word needs a letter or a number in it.');
  });
});
