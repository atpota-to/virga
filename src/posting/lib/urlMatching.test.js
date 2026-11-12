/*
 * The URL matcher and quote check that facet detection and the character
 * count share. Quote characters are written as \u escapes so an editor can't
 * flatten a curly quote into a straight one.
 */

import { describe, it, expect } from 'vitest';
import {
  createUrlRegex,
  findUrlsAndMentions,
  isPrecededByQuote,
  trimUrlMatch,
} from './urlMatching.js';
import { countPostGraphemes, shortenPostText } from './linkShortening.js';

const matches = (text) => [...text.matchAll(createUrlRegex())].map((m) => m[0]);

// U+201C/U+201D are the smart quotes an Apple keyboard produces.
const QUOTES = [
  ['straight', '"', '"'],
  ['curly', '\u201C', '\u201D'],
];

describe('createUrlRegex', () => {
  it.each(QUOTES)(
    'ends a URL or bare domain at a %s quote',
    (_kind, open, close) => {
      expect(matches(`${open}see https://example.com/x${close} ok`)).toEqual([
        'https://example.com/x',
      ]);
      expect(matches(`${open}visit example.com/path${close}`)).toEqual([
        'example.com/path',
      ]);
      expect(matches(`${open}example.com${close}`)).toEqual(['example.com']);
    },
  );

  it('still ends a URL at whitespace and trailing punctuation', () => {
    expect(matches('see https://example.com/x, then example.org.')).toEqual([
      'https://example.com/x',
      'example.org',
    ]);
  });
});

describe('trimUrlMatch', () => {
  it('takes off the punctuation that ends the sentence, as Bluesky does', () => {
    expect(trimUrlMatch('https://example.com/page?')).toBe(
      'https://example.com/page',
    );
    expect(trimUrlMatch('https://example.com:')).toBe('https://example.com');
    expect(trimUrlMatch('https://example.com/page.')).toBe(
      'https://example.com/page',
    );
    expect(trimUrlMatch('https://example.com/page...')).toBe(
      'https://example.com/page',
    );
    expect(trimUrlMatch('https://example.com/x>')).toBe(
      'https://example.com/x',
    );
    expect(trimUrlMatch('https://example.com/x**')).toBe(
      'https://example.com/x',
    );
    expect(trimUrlMatch('example.com/page).')).toBe('example.com/page');
  });

  it('keeps a closing bracket the URL opened, and everything inside', () => {
    expect(trimUrlMatch('https://en.wikipedia.org/wiki/Moth_(insect)')).toBe(
      'https://en.wikipedia.org/wiki/Moth_(insect)',
    );
    expect(trimUrlMatch('https://en.wikipedia.org/wiki/Moth_(insect))')).toBe(
      'https://en.wikipedia.org/wiki/Moth_(insect)',
    );
    expect(trimUrlMatch('https://example.com/a]')).toBe(
      'https://example.com/a',
    );
    expect(trimUrlMatch('https://example.com/?q=a.b&c=d')).toBe(
      'https://example.com/?q=a.b&c=d',
    );
  });
});

describe('findUrlsAndMentions', () => {
  it('gives an @ inside a URL to the URL', () => {
    const url =
      'https://example.com/subscribe?email=reader@example.org&u=@someone.example.com';
    const { urls, mentions } = findUrlsAndMentions(`sign up ${url} today`);
    expect(urls.map((u) => u.matchText)).toEqual([url]);
    expect(mentions).toEqual([]);
  });

  it('leaves mentions and addresses that stand on their own', () => {
    const text = 'hi @someone.example.com, mail reader@example.org';
    const { urls, mentions } = findUrlsAndMentions(text);
    expect(mentions.map((m) => [m.handle, m.email])).toEqual([
      ['someone.example.com', false],
      ['example.org', true],
    ]);
    // The address's domain half is a hit, but it starts after the '@', so
    // the address keeps it.
    expect(urls.map((u) => u.matchText)).toContain('example.org');
  });

  it('reports the trimmed range and where the raw hit ended', () => {
    const text = 'Did you see https://example.com/page?';
    const [url] = findUrlsAndMentions(text).urls;
    expect(url).toEqual({
      charStart: 12,
      charEnd: text.length - 1,
      matchText: 'https://example.com/page',
      rawEnd: text.length,
    });
  });
});

describe('isPrecededByQuote', () => {
  it.each(QUOTES)(
    'is true right after an opening %s quote',
    (_kind, open, close) => {
      expect(isPrecededByQuote(`${open}example.com${close}`, 1)).toBe(true);
    },
  );

  it('is false anywhere else', () => {
    expect(isPrecededByQuote('example.com', 0)).toBe(false);
    expect(isPrecededByQuote('see example.com', 4)).toBe(false);
    expect(isPrecededByQuote('\u201Dexample.com', 1)).toBe(false);
  });
});

// A quoted URL gets no facet, so the count must not shorten it either; a URL
// that merely ends a quotation is a link and keeps its closing quote.
describe('the character count', () => {
  it.each(QUOTES)('charges a %s-quoted URL in full', (_kind, open, close) => {
    const text = `the domain ${open}https://example.org/profile/testing/and/more${close} is taken`;
    expect(countPostGraphemes(text)).toBe(text.length);
  });

  it.each(QUOTES)(
    'shortens a URL that ends a %s quotation and keeps the quote',
    (_kind, open, close) => {
      const text = `${open}see https://example.com/another/quite/long/path${close}`;
      expect(shortenPostText(text)).toBe(
        `${open}see example.com/another/quit...${close}`,
      );
    },
  );
});
