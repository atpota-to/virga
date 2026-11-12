/*
 * The URL matcher and quote check that facet detection and the character
 * count share. Quote characters are written as \u escapes so an editor can't
 * flatten a curly quote into a straight one.
 */

import { describe, it, expect } from 'vitest';
import { createUrlRegex, isPrecededByQuote } from './urlMatching.js';
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
