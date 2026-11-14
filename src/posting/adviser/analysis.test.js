import { describe, it, expect } from 'vitest';
import {
  normalizeAdviserScope,
  adviserScopeAllowsDraft,
  adviserScenarioFor,
  enabledWritingChecks,
  fixableWritingIssues,
  applyWritingFixes,
  applyWritingFixesToThread,
} from './analysis.js';

// Fix application fails quietly when wrong (a "fixed" post still carrying the
// typo, or a fix applied to the wrong occurrence), so it gets the most cases.

describe('normalizeAdviserScope', () => {
  it('passes known scopes through and defaults everything else to all', () => {
    expect(normalizeAdviserScope('all')).toBe('all');
    expect(normalizeAdviserScope('topLevel')).toBe('topLevel');
    expect(normalizeAdviserScope('replies')).toBe('replies');
    expect(normalizeAdviserScope(undefined)).toBe('all');
    expect(normalizeAdviserScope('everything')).toBe('all');
  });
});

describe('adviserScopeAllowsDraft', () => {
  it('covers everything on all (and on unset legacy settings)', () => {
    expect(adviserScopeAllowsDraft('all', { repliesToOther: true })).toBe(true);
    expect(adviserScopeAllowsDraft('all', { repliesToOther: false })).toBe(
      true,
    );
    expect(adviserScopeAllowsDraft(undefined, { repliesToOther: true })).toBe(
      true,
    );
  });

  it('replies means replies to someone else, nothing more', () => {
    expect(adviserScopeAllowsDraft('replies', { repliesToOther: true })).toBe(
      true,
    );
    expect(adviserScopeAllowsDraft('replies', { repliesToOther: false })).toBe(
      false,
    );
  });

  // "Top-level" includes threads of your own: a reply to your own post is you
  // continuing your thread, not a reply in the scope's sense.
  it('topLevel is the complement — self-threads and quotes included', () => {
    expect(adviserScopeAllowsDraft('topLevel', { repliesToOther: false })).toBe(
      true,
    );
    expect(adviserScopeAllowsDraft('topLevel', { repliesToOther: true })).toBe(
      false,
    );
  });
});

describe('adviserScenarioFor', () => {
  it('ranks a conversation with someone else above everything', () => {
    expect(
      adviserScenarioFor({
        repliesToOther: true,
        quotesOther: false,
        repliesToSelf: false,
        isThread: true,
      }),
    ).toBe('reply');
    expect(
      adviserScenarioFor({
        repliesToOther: false,
        quotesOther: true,
        repliesToSelf: false,
        isThread: true,
      }),
    ).toBe('quote');
  });

  it('then a composed thread, then continuing your own thread, then a post', () => {
    expect(
      adviserScenarioFor({
        repliesToOther: false,
        quotesOther: false,
        repliesToSelf: false,
        isThread: true,
      }),
    ).toBe('thread');
    expect(
      adviserScenarioFor({
        repliesToOther: false,
        quotesOther: false,
        repliesToSelf: true,
        isThread: false,
      }),
    ).toBe('selfReply');
    expect(
      adviserScenarioFor({
        repliesToOther: false,
        quotesOther: false,
        repliesToSelf: false,
        isThread: false,
      }),
    ).toBe('post');
  });
});

describe('enabledWritingChecks', () => {
  it('returns only the checks strictly on, or null when none are', () => {
    expect(
      enabledWritingChecks({ typos: true, grammar: false, clarity: true }),
    ).toEqual({ typos: true, clarity: true });
    expect(enabledWritingChecks({ typos: false })).toBeNull();
    expect(enabledWritingChecks(undefined)).toBeNull();
    expect(enabledWritingChecks({ typos: 'yes' })).toBeNull();
  });

  it("carries the writer's notes and learned style while a check is on", () => {
    const checks = enabledWritingChecks({
      typos: true,
      customText: ' never flag "yall" ',
      styleProfile: {
        summary: ' writes all-lowercase on purpose ',
        analyzedCount: 96,
        updatedAt: '2026-08-25T00:00:00Z',
      },
    });
    expect(checks).toEqual({
      typos: true,
      customText: 'never flag "yall"',
      style: 'writes all-lowercase on purpose',
    });
    // Blank notes / no profile just stay out of the payload.
    expect(
      enabledWritingChecks({
        typos: true,
        customText: '  ',
        styleProfile: { summary: '' },
      }),
    ).toEqual({ typos: true });
  });

  // Notes and style only guide the proofread; with no check on, nothing is sent.
  it('is still null with notes or a profile but no check on', () => {
    expect(
      enabledWritingChecks({
        customText: 'be careful',
        styleProfile: { summary: 'lowercase' },
      }),
    ).toBeNull();
  });
});

describe('fixableWritingIssues', () => {
  it('keeps only issues with a real excerpt and a different correction', () => {
    const issues = [
      { found: 'out team', replacement: 'our team' }, // fixable
      { found: 'a phrase', replacement: null }, // observation only
      { found: 'same', replacement: 'same' }, // no-op
      { found: '', replacement: 'x' }, // nothing to find
      null,
    ];
    expect(fixableWritingIssues(issues)).toEqual([
      { found: 'out team', replacement: 'our team' },
    ]);
    expect(fixableWritingIssues(undefined)).toEqual([]);
  });
});

describe('applyWritingFixes', () => {
  it('fixes the motivating typo', () => {
    const { text, applied } = applyWritingFixes(
      'excited to share what out team has been working on',
      [{ found: 'what out team', replacement: 'what our team' }],
    );
    expect(text).toBe('excited to share what our team has been working on');
    expect(applied).toBe(1);
  });

  it('replaces only the first occurrence of an excerpt', () => {
    const { text, applied } = applyWritingFixes('so good, so good', [
      { found: 'so good', replacement: 'so very good' },
    ]);
    expect(text).toBe('so very good, so good');
    expect(applied).toBe(1);
  });

  it('skips an excerpt no longer present instead of guessing', () => {
    const { text, applied } = applyWritingFixes('already fixed here', [
      { found: 'not in the draft', replacement: 'anything' },
    ]);
    expect(text).toBe('already fixed here');
    expect(applied).toBe(0);
  });

  it('applies several fixes in order, including observations being skipped', () => {
    const { text, applied } = applyWritingFixes('teh cat sat sat down', [
      { found: 'teh', replacement: 'the' },
      { found: 'sat sat', replacement: 'sat' },
      { found: 'down', replacement: null }, // unfixable observation
    ]);
    expect(text).toBe('the cat sat down');
    expect(applied).toBe(2);
  });
});

describe('applyWritingFixesToThread', () => {
  const posts = [
    { id: 1, text: 'part one has teh typo' },
    { id: 2, text: 'part two is fine' },
  ];

  it('lands each fix in the first post containing its excerpt, keeping other fields', () => {
    const { posts: next, applied } = applyWritingFixesToThread(posts, [
      { found: 'teh typo', replacement: 'the typo' },
    ]);
    expect(applied).toBe(1);
    expect(next[0]).toEqual({ id: 1, text: 'part one has the typo' });
    // Untouched posts keep their identity, so React state diffs stay small.
    expect(next[1]).toBe(posts[1]);
  });

  it('returns the same array when nothing applies, so a state setter can no-op', () => {
    const { posts: next, applied } = applyWritingFixesToThread(posts, [
      // The adviser read the posts joined with a blank line; an excerpt spanning
      // the join exists in that joined text but in no single post.
      { found: 'typo\n\npart two', replacement: 'x' },
    ]);
    expect(applied).toBe(0);
    expect(next).toBe(posts);
  });
});
