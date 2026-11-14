import { describe, expect, it } from 'vitest';
import { matchesWords } from './ArchiveSearch.jsx';

describe('matchesWords', () => {
  const post = { text: 'Field notes on the Canal heron, part two #FieldNotes', tags: ['FieldNotes', 'bees'], links: ['streettrees.example'] };

  it('finds every word, wherever it sits in the text', () => {
    expect(matchesWords(post, ['heron', 'canal'])).toBe(true);
    expect(matchesWords(post, ['heron', 'swift'])).toBe(false);
    expect(matchesWords(post, [])).toBe(true);
  });

  it('finds a site the post links to', () => {
    expect(matchesWords(post, ['streettrees'])).toBe(true);
    expect(matchesWords({ text: 'no links here' }, ['streettrees'])).toBe(false);
  });

  it('takes a # word as a whole tag, whatever its capitals', () => {
    expect(matchesWords(post, ['#fieldnotes'])).toBe(true);
    // A tag added beside the text, not written in it.
    expect(matchesWords(post, ['#bees'])).toBe(true);
    expect(matchesWords(post, ['#bee'])).toBe(false);
    expect(matchesWords(post, ['#field'])).toBe(false);
  });

  it('still finds a written tag on a row from before tags were kept', () => {
    expect(matchesWords({ text: 'old row #zines' }, ['#zines'])).toBe(true);
    expect(matchesWords({ text: 'old row #zines' }, ['#zine'])).toBe(false);
  });
});
