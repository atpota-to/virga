import { describe, it, expect } from 'vitest';
import {
  parseComposeIntent,
  buildComposeIntentUrl,
  INTENT_COMPOSE_PATH,
  MAX_POST_GRAPHEMES,
} from './composeIntent.js';
import { countGraphemes } from './graphemes.js';

describe('parseComposeIntent — Bluesky compatibility', () => {
  it('reads the documented `text` parameter', () => {
    const intent = parseComposeIntent('?text=hello');
    expect(intent.hasIntent).toBe(true);
    expect(intent.text).toBe('hello');
  });

  it('accepts the same query a bsky.app intent link carries, verbatim', () => {
    // The example from docs.bsky.app, host swapped.
    const query =
      '?text=I%27m%20reading%20through%20the%20Bluesky%20API%20docs%21%20%F0%9F%A6%8B%0Ahttps%3A//docs.bsky.app';
    expect(parseComposeIntent(query).text).toBe(
      "I'm reading through the Bluesky API docs! 🦋\nhttps://docs.bsky.app",
    );
  });
});

describe('parseComposeIntent — absent or unusable intents', () => {
  it('reports no intent for an empty query', () => {
    expect(parseComposeIntent('').hasIntent).toBe(false);
    expect(parseComposeIntent(null).hasIntent).toBe(false);
  });

  it('reports no intent when only unrecognized parameters are present', () => {
    expect(parseComposeIntent('?utm_source=newsletter&ref=x').hasIntent).toBe(
      false,
    );
  });

  it('reports no intent when every recognized parameter is empty', () => {
    expect(parseComposeIntent('?text=&tags=').hasIntent).toBe(false);
  });

  it('reports no intent when text is only whitespace', () => {
    expect(parseComposeIntent('?text=%20%20%20').hasIntent).toBe(false);
  });
});

describe('parseComposeIntent — input shapes', () => {
  const expected = 'hi';

  it('accepts a URLSearchParams', () => {
    expect(
      parseComposeIntent(new URLSearchParams({ text: expected })).text,
    ).toBe(expected);
  });

  it('accepts a bare query string without the leading ?', () => {
    expect(parseComposeIntent('text=hi').text).toBe(expected);
  });

  it('accepts a full URL', () => {
    expect(
      parseComposeIntent('https://virga.example/intent/compose?text=hi').text,
    ).toBe(expected);
  });

  it('accepts a plain object', () => {
    expect(parseComposeIntent({ text: expected }).text).toBe(expected);
  });
});

describe('parseComposeIntent — title as a fallback for text', () => {
  it('uses title when there is no text', () => {
    expect(parseComposeIntent({ title: 'A page worth reading' }).text).toBe(
      'A page worth reading',
    );
  });

  it('prefers text and ignores a duplicate title', () => {
    // The share sheet commonly sends the same words in both fields.
    const intent = parseComposeIntent({
      title: 'A page',
      text: 'A page, with my note',
    });
    expect(intent.text).toBe('A page, with my note');
  });

  it('still appends the url when only title came through', () => {
    const intent = parseComposeIntent({
      title: 'A page',
      url: 'https://example.com/a',
    });
    expect(intent.text).toBe('A page\n\nhttps://example.com/a');
  });
});

describe('parseComposeIntent — the url parameter', () => {
  it('appends the link below the prose', () => {
    const intent = parseComposeIntent({
      text: 'A good read',
      url: 'https://example.com/a',
    });
    expect(intent.text).toBe('A good read\n\nhttps://example.com/a');
  });

  it('uses the link alone when there is no prose', () => {
    expect(parseComposeIntent({ url: 'https://example.com/a' }).text).toBe(
      'https://example.com/a',
    );
  });

  it('does not repeat a link the prose already cites', () => {
    const intent = parseComposeIntent({
      text: 'see https://example.com/a for more',
      url: 'https://example.com/a',
    });
    expect(intent.text).toBe('see https://example.com/a for more');
  });

  it.each([
    ['javascript:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['vbscript:msgbox(1)'],
    ['file:///etc/passwd'],
  ])('drops the non-http(s) url %s entirely', (hostile) => {
    const intent = parseComposeIntent({ text: 'look', url: hostile });
    expect(intent.text).toBe('look');
  });

  it('drops an unparseable url rather than pasting it in', () => {
    expect(parseComposeIntent({ text: 'look', url: 'not a url' }).text).toBe(
      'look',
    );
  });
});

describe('parseComposeIntent — the post limit', () => {
  it('leaves text that already fits untouched and unflagged', () => {
    const intent = parseComposeIntent({ text: 'short' });
    expect(intent.text).toBe('short');
    expect(intent.truncated).toBe(false);
  });

  it('clamps over-long text to the limit and says it did', () => {
    const intent = parseComposeIntent({ text: 'a'.repeat(400) });
    expect(countGraphemes(intent.text)).toBe(MAX_POST_GRAPHEMES);
    expect(intent.truncated).toBe(true);
  });

  it('counts grapheme clusters, not code units', () => {
    // One cluster, two code points, four UTF-16 code units. Deliberately not a
    // ZWJ sequence: sanitizeText strips U+200D along with the zero-width range,
    // so a family emoji arrives here already split into its members.
    const intent = parseComposeIntent({ text: '👍🏽'.repeat(400) });
    expect(intent.text.length).toBeGreaterThan(MAX_POST_GRAPHEMES);
    expect(countGraphemes(intent.text)).toBe(MAX_POST_GRAPHEMES);
  });

  it('never splits a grapheme cluster when it cuts', () => {
    const intent = parseComposeIntent({ text: '👍🏽'.repeat(400) });
    expect(intent.text.endsWith('👍🏽')).toBe(true);
  });

  it('sacrifices prose to keep the link whole', () => {
    const url = 'https://example.com/an-article-worth-reading';
    const intent = parseComposeIntent({ text: 'a'.repeat(400), url });
    expect(intent.text.endsWith(url)).toBe(true);
    expect(countGraphemes(intent.text)).toBeLessThanOrEqual(MAX_POST_GRAPHEMES);
    expect(intent.truncated).toBe(true);
  });

  it('keeps the link and drops the prose when the link alone fills the post', () => {
    const url = `https://example.com/${'p'.repeat(320)}`;
    const intent = parseComposeIntent({ text: 'context', url });
    expect(intent.text.startsWith('https://example.com/')).toBe(true);
    expect(countGraphemes(intent.text)).toBe(MAX_POST_GRAPHEMES);
    expect(intent.truncated).toBe(true);
  });
});

describe('parseComposeIntent — tags', () => {
  it('normalizes a comma-separated list', () => {
    const intent = parseComposeIntent({ tags: 'birds, night ,lamp' });
    expect(intent.tags).toEqual(['birds', 'night', 'lamp']);
    expect(intent.hasIntent).toBe(true);
  });

  it('tolerates a leading hash', () => {
    expect(parseComposeIntent({ tags: '#birds, ##night' }).tags).toEqual([
      'birds',
      'night',
    ]);
  });

  it('drops duplicates case-insensitively, keeping the first spelling', () => {
    expect(parseComposeIntent({ tags: 'Birds, birds, BIRDS' }).tags).toEqual([
      'Birds',
    ]);
  });

  it('caps the count at the lexicon limit of eight', () => {
    const intent = parseComposeIntent({
      tags: Array.from({ length: 30 }, (_, i) => `t${i}`).join(','),
    });
    expect(intent.tags).toHaveLength(8);
  });

  it('caps the length of any single tag', () => {
    const intent = parseComposeIntent({ tags: 'x'.repeat(200) });
    expect(countGraphemes(intent.tags[0])).toBe(64);
  });

  it('ignores empty entries', () => {
    expect(parseComposeIntent({ tags: 'birds,,, ,night' }).tags).toEqual([
      'birds',
      'night',
    ]);
  });
});

describe('parseComposeIntent — sanitizing', () => {
  it('strips zero-width characters that would break link detection', () => {
    expect(parseComposeIntent({ text: 'https://exa​mple.com' }).text).toBe(
      'https://example.com',
    );
  });

  it('replaces non-breaking spaces with ordinary ones', () => {
    expect(parseComposeIntent({ text: 'a b' }).text).toBe('a b');
  });
});

describe('buildComposeIntentUrl', () => {
  it('builds a URL on the canonical path', () => {
    const url = new URL(
      buildComposeIntentUrl({ text: 'hi' }, 'https://virga.example'),
    );
    expect(url.pathname).toBe(INTENT_COMPOSE_PATH);
    expect(url.searchParams.get('text')).toBe('hi');
  });

  it('omits parameters that were not supplied', () => {
    const url = buildComposeIntentUrl({ text: 'hi' }, 'https://virga.example');
    expect(url).not.toContain('url=');
    expect(url).not.toContain('tags=');
  });

  it('accepts tags as an array or a string', () => {
    const fromArray = buildComposeIntentUrl(
      { tags: ['birds', 'night'] },
      'https://virga.example',
    );
    const fromString = buildComposeIntentUrl(
      { tags: 'birds, night' },
      'https://virga.example',
    );
    expect(fromArray).toBe(fromString);
  });

  it('round-trips through the parser', () => {
    const intent = {
      text: "I'm reading this 🦋",
      url: 'https://docs.bsky.app/',
      tags: 'birds, night',
    };
    const parsed = parseComposeIntent(
      buildComposeIntentUrl(intent, 'https://virga.example'),
    );
    expect(parsed.text).toBe("I'm reading this 🦋\n\nhttps://docs.bsky.app/");
    expect(parsed.tags).toEqual(['birds', 'night']);
    expect(parsed.url).toBe('https://docs.bsky.app/');
    expect(parsed.truncated).toBe(false);
  });
});

describe('parseComposeIntent — the url on its own', () => {
  it('hands back the normalized link beside the joined text', () => {
    const intent = parseComposeIntent({
      text: 'look',
      url: 'https://example.com',
    });
    expect(intent.url).toBe('https://example.com/');
    expect(intent.text).toBe('look\n\nhttps://example.com/');
  });

  it('is empty when there is none, or it was refused', () => {
    expect(parseComposeIntent({ text: 'look' }).url).toBe('');
    expect(parseComposeIntent({ text: 'look', url: 'javascript:x' }).url).toBe(
      '',
    );
  });
});
