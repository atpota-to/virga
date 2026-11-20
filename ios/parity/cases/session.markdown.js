// The reader for Virga's legal documents: both real documents at the repo's
// root, read whole, and every edge the reader has (the web test's inputs,
// and the corners of each of its patterns). Swift:
// VirgaSession/Legal/Markdown.swift and Documents.swift (readDocument).

import privacySource from '../../../PRIVACY_POLICY.md?raw';
import termsSource from '../../../TERMS_OF_SERVICE.md?raw';
import { readDocument } from '../../../src/legal/documents.js';
import {
  inlineText,
  isSafeHref,
  outlineOf,
  parseInline,
  parseMarkdown,
  slugify,
} from '../../../src/legal/markdown.js';
import { each } from './_helpers.js';

export const sources = ['src/legal/markdown.js', 'src/legal/documents.js'];

const INLINE = [
  'Virga reads your follower list.',
  '',
  null,
  '**Who we are.** Virga is *one* app, at `/api`.',
  '**not *ever* sold**',
  '`virga:terms-accepted:<did>` and `**`',
  'See the [**Privacy** Policy](PRIVACY_POLICY.md#what-we-keep).',
  '[a spec](https://example.com/a_(b)_c)',
  '[click](javascript:alert(1)) and [this](http://plain.example)',
  '2 \\* 3, a \\[bracket\\], a \\| bar',
  'the _SESSION_KEY_ and snake_case',
  'an * alone',
  'bold **that never closes',
  'a ` alone',
  '![a picture](https://example.com/a.png)',
  'some <b>html</b>',
  'fewer than 13 (< 13), or you@example.com, or 3 > 2',
  '</div> and <!-- c --> and <B>',
  '***both***',
  '** spaced**',
  '**a** **b**',
  '**\\*\\***',
  '*a*b*',
  '* not em*',
  '*em *',
  '*a\\*b*',
  '*',
  '**',
  '***',
  '``',
  '`a``b`',
  'trailing \\',
  '\\a \\z \\\\ \\`',
  '[](https://example.com)',
  '[text]()',
  '[text](/path)',
  '[text](#anchor)',
  '[text](mailto:a@b.example)',
  '[text](mailto:a@b@c.example)',
  '[text](https://a.example/ space)',
  '[text](https://a.example/(x)(y))',
  '[text](https://a.example/((x)))',
  '[te\\]xt](/p)',
  '[a [nested] b](/p)',
  '[text] (/p)',
  '[text](/p',
  '[**bold** and *em* and `code`](/p)',
  '[[x]](https://a.example)',
  '[link](//evil.example)',
  'emoji 😀 **bold 👍** and *em 🎉*',
  'é **é** *é*',
  'a b *c d*',
  '[x y](/p)',
  '[x\\ y](/p)',
  '* x*',
  '**x **',
  'a\tb *c\td*',
];

const HREFS = [
  'https://atproto.com/specs/oauth',
  'HTTPS://ATPROTO.COM',
  'mailto:privacy@example.com',
  'MailTo:privacy@example.com',
  '/privacy',
  '/settings/account',
  '#contact',
  'PRIVACY_POLICY.md',
  'TERMS_OF_SERVICE.md#changes',
  '',
  null,
  'javascript:alert(1)',
  'JAVASCRIPT:alert(1)',
  'data:text/html,x',
  'http://example.com',
  '//evil.example',
  'https://',
  'https:///x',
  'mailto:nobody',
  'mailto:@example.com',
  'mailto:a@',
  'mailto:a@b@c',
  'notes.md',
  '../secrets.md',
  'https://a.example/"onclick',
  "https://a.example/'x",
  'https://a.example/`x',
  'https://a.example/<x>',
  'https://a.example/\\x',
  'https://a.example/ x',
  'https://a.example/ x',
  'vbscript:x',
  '#',
  '#a b',
  '#ok-1_2',
  '#é',
  'A.md',
  'A_B.md#x',
  'a.md',
  'AB.MD',
  'A.md#',
  '/',
];

const SLUGS = [
  'What Virga’s server keeps',
  "What Virga's server keeps",
  '  1. Who we are  ',
  'Price, limits and changes',
  'Café & résumé',
  'snake_case and kebab-case',
  '—',
  '',
  null,
  'ΟΔΟΣ Σ',
  'İstanbul',
  'Two  spaces\tand nbsp',
  '日本語の見出し',
  'Emoji 😀 heading',
  '½ and ² and Ⅻ',
  'á combining',
  'KELVIN K',
];

const DOCUMENTS = [
  '# Terms of Service\n\n## Using Virga\n\n### Your account ###\n',
  '## Contact\n\n## Contact\n\n## Contact',
  'First line\nsecond line.\n\nAnother paragraph.',
  '- one\n- **two**\n- three',
  '3. three\n4. four',
  '007. seven\n8) eight',
  [
    '- Kept on the server',
    '  for as long as it is needed:',
    '  - the session',
    '  - the schedule',
    '- Kept in the browser',
  ].join('\n'),
  '- one\n\n- two\n\nAfter the list.',
  '- one\n1. first',
  'Virga can:\n- read\n- write',
  [
    '| What | Where | How long |',
    '| --- | :--- | ---: |',
    '| Your session | Supabase | Until you sign out |',
    '| A `vg_` token \\| hashed | Supabase | 30 days |',
  ].join('\n'),
  '| a | b |\n| --- | --- |\n| only one |',
  'this | that\n\n---\n\nmore',
  'above\n\n---\n\nbelow',
  '# Title\r\n\r\nWords.\r\n',
  'one\rtwo\r\rthree',
  [
    '# Title',
    '',
    '> a quote',
    '',
    '#### too deep',
    '',
    '```',
    'code',
    '```',
  ].join('\n'),
  '# T\n\n## One\n\n### Inside\n\n## Two, with `code`',
  '',
  null,
  '   ',
  '#',
  '#   ',
  '# #',
  '# a ##',
  '# a#b',
  '####### seven',
  '#no space',
  '#  x',
  '# x ',
  '## heading ## with ## hashes ##',
  '#\tTabbed\t#\t',
  '***',
  '___',
  '- - -',
  '--',
  '  ---  ',
  '**bold paragraph**\n---',
  '* star item\n+ plus item\n- dash item',
  '1234567890. too long\n123456789. nine digits',
  '-no space',
  '- ',
  '-\titem',
  '- a\n    - deeper\n  - shallower',
  '- a\n  - one\n  - two\n- b\n  1. x\n  2. y',
  '- a\n\n  - sub after blank\n- b',
  '- a\n  - one\n\n  - two',
  '- a\n  continued\n  more\n- b',
  '- a\n  - s\n  carried after sub',
  '- a\n- b\n\n\n',
  '1. a\n\n- b',
  '- a\n\n1. b',
  '\t- tab indented\n\t\t- deeper',
  '  - indented list\n- outdented',
  '| a | b |\n|---|---|\n| 1 | 2 |\n\nafter',
  'a | b\n--- | ---\n1 | 2',
  '| a |\n| --- |',
  '| a | b |\n| --- |',
  '| a | b |\n| -- | -- |',
  '| a | b |\n| :---: | ---: |\n| 1 | 2 | 3 |\n| 4 |',
  '|a|b|\n|---|---|\n|x\\|y|z|',
  '| a \\|',
  'text\n| a | b |\n| --- | --- |\n| 1 | 2 |',
  '| a | b |\n| --- | --- |\nno bar ends it',
  '```\nnever closed\n**not bold**',
  '~~~js\nconst x = 1;\n~~~\nafter',
  '  ```\n  indented fence\n  ```',
  '> quote\n> more',
  'Para\n# Heading straight after',
  'Para\n---',
  'Para\n1. list',
  'Line one\n  indented two\nthree',
  'A [link](PRIVACY_POLICY.md#your-choices-and-rights) and [bad](ftp://x).',
  'emoji 😀\n\n## Héadings 😀',
  '- item with `code` and [link](/p)\n- **bold** item',
  ' \n\n# after',
  ' \t \n\t',
];

export default async function cases() {
  const documents = await each(
    'parseMarkdown',
    [
      { $id: 'terms', source: termsSource },
      { $id: 'privacy', source: privacySource },
      ...DOCUMENTS.map((source) => ({ source })),
    ],
    ({ source }) => parseMarkdown(source),
  );

  return [
    ...documents,

    ...(await each(
      'readDocument',
      [{ key: 'terms' }, { key: 'privacy' }, { key: 'nothing' }],
      ({ key }) => {
        const doc = readDocument(key);
        return (
          doc && {
            ...doc,
            outline: outlineOf(doc.blocks),
            outline3: outlineOf(doc.blocks, { level: 3 }),
          }
        );
      },
    )),

    ...(await each(
      'parseInline',
      INLINE.map((text) => ({ text })),
      ({ text }) => {
        const problems = [];
        const nodes = parseInline(text, (p) => problems.push(p));
        return { nodes, problems, text: inlineText(nodes) };
      },
    )),

    ...(await each(
      'isSafeHref',
      HREFS.map((href) => ({ href })),
      ({ href }) => isSafeHref(href),
    )),

    ...(await each(
      'slugify',
      SLUGS.map((text) => ({ text })),
      ({ text }) => slugify(text),
    )),

    ...(await each(
      'outlineOf',
      [
        {
          source: '# T\n\n## One\n\n### Inside\n\n## Two, with `code`',
          level: undefined,
        },
        {
          source: '# T\n\n## One\n\n### Inside\n\n## Two, with `code`',
          level: 3,
        },
        { source: '# T\n\n## One\n\n### Inside\n\n#### Deeper', level: 3 },
        { source: '', level: 2 },
      ],
      ({ source, level }) =>
        outlineOf(
          parseMarkdown(source).blocks,
          level === undefined ? undefined : { level },
        ),
    )),
  ];
}
