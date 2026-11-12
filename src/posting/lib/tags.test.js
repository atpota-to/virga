import { describe, it, expect } from 'vitest';
import { formatTags, normalizeTags, MAX_TAGS } from './tags.js';

describe('normalizeTags', () => {
  it('splits a comma list, trims, and strips leading #', () => {
    expect(normalizeTags(' one, #two ,##three,  , ＃four')).toEqual([
      'one',
      'two',
      'three',
      'four',
    ]);
  });

  it('takes an array too, skipping non-strings', () => {
    expect(normalizeTags(['#a', 'b', 3, null, ' c '])).toEqual(['a', 'b', 'c']);
  });

  it('dedupes without regard to case, keeping the first spelling', () => {
    expect(normalizeTags('Rust, rust, RUST, go')).toEqual(['Rust', 'go']);
  });

  it('keeps at most eight', () => {
    const many = Array.from({ length: 12 }, (_, i) => `t${i}`).join(',');
    expect(normalizeTags(many)).toHaveLength(MAX_TAGS);
    expect(normalizeTags(many).at(-1)).toBe('t7');
  });

  it('clamps each tag to 64 graphemes, counting an emoji as one', () => {
    expect(normalizeTags('a'.repeat(70))[0]).toHaveLength(64);
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}';
    const tags = normalizeTags(family.repeat(70));
    expect([...new Intl.Segmenter().segment(tags[0])]).toHaveLength(64);
  });

  it('keeps each tag within 640 bytes', () => {
    // 64 graphemes of an 18-byte ZWJ family is 1152 bytes.
    const family = '\u{1F468}‍\u{1F469}‍\u{1F467}';
    const [tag] = normalizeTags(family.repeat(64));
    expect(new TextEncoder().encode(tag).length).toBeLessThanOrEqual(640);
    expect(tag.length).toBeGreaterThan(0);
  });

  it('removes hidden characters before comparing', () => {
    expect(normalizeTags('tag​, tag')).toEqual(['tag']);
  });

  it('is empty for nothing', () => {
    expect(normalizeTags('')).toEqual([]);
    expect(normalizeTags(null)).toEqual([]);
    expect(normalizeTags(undefined)).toEqual([]);
  });
});

describe('formatTags', () => {
  it('joins for a text field', () => {
    expect(formatTags(['a', 'b'])).toBe('a, b');
    expect(formatTags(null)).toBe('');
  });
});
