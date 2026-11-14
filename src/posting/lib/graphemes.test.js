import { describe, it, expect } from 'vitest';
import { countGraphemes, truncateGraphemes } from './graphemes.js';

describe('countGraphemes', () => {
  it('counts plain ASCII', () => {
    expect(countGraphemes('hello')).toBe(5);
  });

  it('treats empty and nullish input as zero', () => {
    expect(countGraphemes('')).toBe(0);
    expect(countGraphemes(null)).toBe(0);
    expect(countGraphemes(undefined)).toBe(0);
  });

  it('counts an astral-plane emoji as one, not two', () => {
    expect('👍'.length).toBe(2);
    expect(countGraphemes('👍')).toBe(1);
  });

  it('counts an emoji plus its skin-tone modifier as one cluster', () => {
    expect('👍🏽'.length).toBe(4);
    expect(countGraphemes('👍🏽')).toBe(1);
  });

  it('counts a combining accent with its base letter as one', () => {
    expect(countGraphemes('é')).toBe(1);
  });
});

describe('truncateGraphemes', () => {
  it('returns short-enough text unchanged, identity included', () => {
    const text = 'hello';
    expect(truncateGraphemes(text, 10)).toBe(text);
    expect(truncateGraphemes(text, 5)).toBe(text);
  });

  it('cuts to the requested number of clusters', () => {
    expect(truncateGraphemes('hello world', 5)).toBe('hello');
  });

  it('handles empty and nullish input', () => {
    expect(truncateGraphemes('', 5)).toBe('');
    expect(truncateGraphemes(null, 5)).toBe('');
  });

  it('returns nothing when the budget is zero', () => {
    expect(truncateGraphemes('hello', 0)).toBe('');
  });

  it('never splits a cluster in half', () => {
    const text = '👍🏽'.repeat(5);
    const cut = truncateGraphemes(text, 2);
    expect(cut).toBe('👍🏽👍🏽');
    expect(countGraphemes(cut)).toBe(2);
  });

  it('keeps a combining mark with its base letter', () => {
    expect(truncateGraphemes('éabc', 1)).toBe('é');
  });
});
