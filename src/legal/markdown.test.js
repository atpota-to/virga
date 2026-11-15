import { describe, expect, it } from 'vitest';
import { inlineText, isSafeHref, outlineOf, parseInline, parseMarkdown, slugify } from './markdown.js';

const text = (value) => ({ type: 'text', value });

describe('inline markup', () => {
  it('leaves plain words alone', () => {
    expect(parseInline('Virga reads your follower list.')).toEqual([text('Virga reads your follower list.')]);
    expect(parseInline('')).toEqual([]);
  });

  it('reads bold, emphasis and code', () => {
    expect(parseInline('**Who we are.** Virga is *one* app, at `/api`.')).toEqual([
      { type: 'strong', children: [text('Who we are.')] },
      text(' Virga is '),
      { type: 'em', children: [text('one')] },
      text(' app, at '),
      { type: 'code', value: '/api' },
      text('.'),
    ]);
  });

  it('reads emphasis inside bold', () => {
    expect(parseInline('**not *ever* sold**')).toEqual([{ type: 'strong', children: [text('not '), { type: 'em', children: [text('ever')] }, text(' sold')] }]);
  });

  it('keeps markup inside code as it was typed', () => {
    expect(parseInline('`virga:terms-accepted:<did>` and `**`')).toEqual([{ type: 'code', value: 'virga:terms-accepted:<did>' }, text(' and '), { type: 'code', value: '**' }]);
  });

  it('reads a link, with markup in its words', () => {
    expect(parseInline('See the [**Privacy** Policy](PRIVACY_POLICY.md#what-we-keep).')).toEqual([
      text('See the '),
      { type: 'link', href: 'PRIVACY_POLICY.md#what-we-keep', children: [{ type: 'strong', children: [text('Privacy')] }, text(' Policy')] },
      text('.'),
    ]);
  });

  it('reads a link whose address holds brackets', () => {
    const [link] = parseInline('[a spec](https://example.com/a_(b)_c)');
    expect(link).toMatchObject({ type: 'link', href: 'https://example.com/a_(b)_c' });
  });

  it('draws a link it won’t follow as plain words, and says so', () => {
    const problems = [];
    const out = parseInline('[click](javascript:alert(1)) and [this](http://plain.example)', (p) => problems.push(p));
    expect(out).toEqual([text('click and this')]);
    expect(problems).toHaveLength(2);
  });

  it('takes a backslash as “the next character is only itself”', () => {
    expect(parseInline('2 \\* 3, a \\[bracket\\], a \\| bar')).toEqual([text('2 * 3, a [bracket], a | bar')]);
  });

  it('leaves underscores alone, since names hold them', () => {
    expect(parseInline('the _SESSION_KEY_ and snake_case')).toEqual([text('the _SESSION_KEY_ and snake_case')]);
  });

  it('reports what it had to leave as written', () => {
    const cases = ['an * alone', 'bold **that never closes', 'a ` alone', '![a picture](https://example.com/a.png)', 'some <b>html</b>'];
    for (const source of cases) {
      const problems = [];
      parseInline(source, (p) => problems.push(p));
      expect(problems.length, source).toBeGreaterThan(0);
    }
  });

  it('doesn’t mistake a comparison or an address for HTML', () => {
    const problems = [];
    parseInline('fewer than 13 (< 13), or you@example.com, or 3 > 2', (p) => problems.push(p));
    expect(problems).toEqual([]);
  });
});

describe('safe links', () => {
  it('follows https, mailto, this site’s paths, anchors and the documents', () => {
    for (const href of ['https://atproto.com/specs/oauth', 'mailto:privacy@example.com', '/privacy', '/settings/account', '#contact', 'PRIVACY_POLICY.md', 'TERMS_OF_SERVICE.md#changes'])
      expect(isSafeHref(href), href).toBe(true);
  });

  it('follows nothing else', () => {
    for (const href of ['', 'javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,x', 'http://example.com', '//evil.example', 'https://', 'mailto:nobody', 'notes.md', '../secrets.md', 'https://a.example/"onclick', 'vbscript:x'])
      expect(isSafeHref(href), href).toBe(false);
  });
});

describe('slugs', () => {
  it('are lower case, with hyphens for the spaces and the punctuation gone, as GitHub makes them', () => {
    expect(slugify('What Virga’s server keeps')).toBe('what-virgas-server-keeps');
    expect(slugify("What Virga's server keeps")).toBe('what-virgas-server-keeps');
    expect(slugify('  1. Who we are  ')).toBe('1-who-we-are');
    expect(slugify('Price, limits and changes')).toBe('price-limits-and-changes');
    expect(slugify('Café & résumé')).toBe('café--résumé');
    expect(slugify('snake_case and kebab-case')).toBe('snake_case-and-kebab-case');
    expect(slugify('—')).toBe('section');
  });
});

describe('a document', () => {
  it('reads headings, and takes its title from the first', () => {
    const doc = parseMarkdown('# Terms of Service\n\n## Using Virga\n\n### Your account ###\n');
    expect(doc.title).toBe('Terms of Service');
    expect(doc.blocks).toEqual([
      { type: 'heading', level: 1, id: 'terms-of-service', children: [text('Terms of Service')] },
      { type: 'heading', level: 2, id: 'using-virga', children: [text('Using Virga')] },
      { type: 'heading', level: 3, id: 'your-account', children: [text('Your account')] },
    ]);
    expect(doc.problems).toEqual([]);
  });

  it('gives two headings with the same words different anchors', () => {
    const doc = parseMarkdown('## Contact\n\n## Contact\n\n## Contact');
    expect(doc.blocks.map((b) => b.id)).toEqual(['contact', 'contact-1', 'contact-2']);
  });

  it('joins a paragraph’s lines, and ends it at a blank line', () => {
    const doc = parseMarkdown('First line\nsecond line.\n\nAnother paragraph.');
    expect(doc.blocks).toEqual([
      { type: 'paragraph', children: [text('First line second line.')] },
      { type: 'paragraph', children: [text('Another paragraph.')] },
    ]);
  });

  it('reads a list', () => {
    const doc = parseMarkdown('- one\n- **two**\n- three');
    expect(doc.blocks).toHaveLength(1);
    expect(doc.blocks[0]).toMatchObject({ type: 'list', ordered: false, start: null });
    expect(doc.blocks[0].items.map((item) => inlineText(item.children))).toEqual(['one', 'two', 'three']);
    expect(doc.blocks[0].items.every((item) => item.sub === null)).toBe(true);
  });

  it('reads a numbered list, from the number it starts at', () => {
    const doc = parseMarkdown('3. three\n4. four');
    expect(doc.blocks[0]).toMatchObject({ type: 'list', ordered: true, start: 3 });
    expect(doc.blocks[0].items).toHaveLength(2);
  });

  it('reads a list under an item, and words carried onto the next line', () => {
    const doc = parseMarkdown(['- Kept on the server', '  for as long as it is needed:', '  - the session', '  - the schedule', '- Kept in the browser'].join('\n'));
    const [list] = doc.blocks;
    expect(list.items.map((item) => inlineText(item.children))).toEqual(['Kept on the server for as long as it is needed:', 'Kept in the browser']);
    expect(list.items[0].sub.items.map((item) => inlineText(item.children))).toEqual(['the session', 'the schedule']);
    expect(list.items[1].sub).toBeNull();
    expect(doc.problems).toEqual([]);
  });

  it('keeps a list going across a blank line, and ends it at a paragraph', () => {
    const doc = parseMarkdown('- one\n\n- two\n\nAfter the list.');
    expect(doc.blocks.map((b) => b.type)).toEqual(['list', 'paragraph']);
    expect(doc.blocks[0].items).toHaveLength(2);
  });

  it('starts another list when bullets turn into numbers', () => {
    const doc = parseMarkdown('- one\n1. first');
    expect(doc.blocks.map((b) => [b.type, b.ordered])).toEqual([
      ['list', false],
      ['list', true],
    ]);
  });

  it('starts a list straight after a paragraph', () => {
    const doc = parseMarkdown('Virga can:\n- read\n- write');
    expect(doc.blocks.map((b) => b.type)).toEqual(['paragraph', 'list']);
  });

  it('reads a table', () => {
    const doc = parseMarkdown(['| What | Where | How long |', '| --- | :--- | ---: |', '| Your session | Supabase | Until you sign out |', '| A `vg_` token \\| hashed | Supabase | 30 days |'].join('\n'));
    const [table] = doc.blocks;
    expect(table.type).toBe('table');
    expect(table.head.map(inlineText)).toEqual(['What', 'Where', 'How long']);
    expect(table.rows.map((row) => row.map(inlineText))).toEqual([
      ['Your session', 'Supabase', 'Until you sign out'],
      ['A vg_ token | hashed', 'Supabase', '30 days'],
    ]);
    expect(doc.problems).toEqual([]);
  });

  it('says when a table row has the wrong number of cells', () => {
    const doc = parseMarkdown('| a | b |\n| --- | --- |\n| only one |');
    expect(doc.problems).toEqual([{ line: 3, problem: expect.stringContaining('1 cells under 2') }]);
  });

  it('doesn’t take a sentence with a bar in it, above a rule, for a table', () => {
    const doc = parseMarkdown('this | that\n\n---\n\nmore');
    expect(doc.blocks.map((b) => b.type)).toEqual(['paragraph', 'rule', 'paragraph']);
  });

  it('reads a rule', () => {
    expect(parseMarkdown('above\n\n---\n\nbelow').blocks.map((b) => b.type)).toEqual(['paragraph', 'rule', 'paragraph']);
  });

  it('reads Windows line endings', () => {
    const doc = parseMarkdown('# Title\r\n\r\nWords.\r\n');
    expect(doc.blocks.map((b) => b.type)).toEqual(['heading', 'paragraph']);
    expect(inlineText(doc.blocks[1].children)).toBe('Words.');
  });

  it('reports what it doesn’t read, with the line it is on', () => {
    const doc = parseMarkdown(['# Title', '', '> a quote', '', '#### too deep', '', '```', 'code', '```'].join('\n'));
    expect(doc.problems.map((p) => p.line)).toEqual([3, 5, 7]);
    // Still drawn, as the nearest thing it knows.
    expect(doc.blocks.find((b) => b.type === 'heading' && b.level === 3)).toBeTruthy();
    expect(doc.blocks.at(-1)).toEqual({ type: 'paragraph', children: [{ type: 'code', value: 'code' }] });
  });

  it('is empty for nothing', () => {
    expect(parseMarkdown('')).toEqual({ title: null, blocks: [], problems: [] });
    expect(parseMarkdown(null)).toEqual({ title: null, blocks: [], problems: [] });
  });
});

describe('a document’s contents', () => {
  it('lists the second-level headings', () => {
    const { blocks } = parseMarkdown('# T\n\n## One\n\n### Inside\n\n## Two, with `code`');
    expect(outlineOf(blocks)).toEqual([
      { id: 'one', text: 'One', level: 2 },
      { id: 'two-with-code', text: 'Two, with code', level: 2 },
    ]);
  });
});
