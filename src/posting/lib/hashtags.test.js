import { describe, it, expect } from 'vitest';
import { findHashtags, isValidHashtag } from './hashtags.js';

const tags = (text) => findHashtags(text).map((t) => t.tag);

describe('findHashtags', () => {
  it('finds tags at the start and after whitespace, with their ranges', () => {
    expect(findHashtags('#owl and #cats')).toEqual([
      { start: 0, end: 4, tag: 'owl' },
      { start: 9, end: 14, tag: 'cats' },
    ]);
    expect(tags('line\n#one\t#two')).toEqual(['one', 'two']);
  });

  it('takes Unicode tags whole, which an ASCII-only rule would cut short', () => {
    expect(tags('#café time')).toEqual(['café']);
    expect(tags('#日本 #Ünïcödé')).toEqual(['日本', 'Ünïcödé']);
    expect(findHashtags('hi #café')[0]).toEqual({
      start: 3,
      end: 8,
      tag: 'café',
    });
  });

  it('does not tag numbers alone, but does tag numbers with letters', () => {
    expect(tags('#123 #1st #2024')).toEqual(['1st']);
  });

  it('drops trailing punctuation from the tag and its range', () => {
    expect(findHashtags('so #good!')).toEqual([
      { start: 3, end: 8, tag: 'good' },
    ]);
    expect(tags('#one, #two. #three?!')).toEqual(['one', 'two', 'three']);
  });

  it('keeps punctuation inside a tag', () => {
    expect(tags('#a.b #x-y #under_score')).toEqual([
      'a.b',
      'x-y',
      'under_score',
    ]);
  });

  it('ignores a # in the middle of a word or a URL fragment', () => {
    expect(tags('C#sharp https://example.com/#anchor a#b')).toEqual([]);
  });

  it('accepts the full-width ＃', () => {
    expect(tags('＃tag')).toEqual(['tag']);
  });

  it('refuses a keycap and a lone #', () => {
    expect(tags('#\uFE0F\u20E3 # alone')).toEqual([]);
  });

  it('caps a tag at 64 graphemes', () => {
    expect(tags(`#${'a'.repeat(64)}`)).toHaveLength(1);
    expect(tags(`#${'a'.repeat(65)}`)).toEqual([]);
  });

  it('ends a tag at a zero-width space', () => {
    expect(tags('#one\u200Btwo')).toEqual(['one']);
  });

  it('is empty for empty text', () => {
    expect(findHashtags('')).toEqual([]);
    expect(findHashtags(null)).toEqual([]);
  });
});

describe('isValidHashtag', () => {
  it('follows the same rule as detection', () => {
    expect(isValidHashtag('café')).toBe(true);
    expect(isValidHashtag('123')).toBe(false);
    expect(isValidHashtag('')).toBe(false);
    expect(isValidHashtag('two words')).toBe(false);
    expect(isValidHashtag(7)).toBe(false);
  });
});
