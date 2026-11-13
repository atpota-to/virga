import { describe, it, expect } from 'vitest';
import {
  MAX_WRITING_ISSUES,
  MIN_STYLE_POSTS,
  MAX_STYLE_POSTS,
  MAX_STYLE_TOTAL_CHARS,
  MAX_STYLE_GUIDANCE,
  SCENARIO_GUIDANCE,
  buildContextBlock,
  buildGoalsList,
  normalizeScenario,
  normalizeWritingChecks,
  buildAdviserPrompt,
  normalizeChecks,
  MAX_CHECKS,
  MAX_CHECK_EXCERPT,
  normalizeWritingIssues,
  normalizeStylePosts,
  normalizeStyleText,
  buildStylePrompt,
  normalizeStyleSummary,
} from './adviserPrompt.js';

// The adviser's failures are quiet: a scenario line that never reaches the
// prompt just makes the read generic, a writing category the user didn't ask
// for gets flagged anyway, and a "fix" whose `found` isn't verbatim from the
// draft makes the composer's one-tap apply silently do nothing. These tests
// pin the contract between the prompt builder, the response normalizer, and
// the frontend that acts on both.

const GOALS = { presets: { reduceNegativity: true } };

function promptFor(overrides = {}) {
  return buildAdviserPrompt({
    text: 'hello world',
    goalsList: buildGoalsList(GOALS),
    contextBlock: null,
    scenario: 'post',
    writingChecks: null,
    ...overrides,
  });
}

describe('normalizeScenario', () => {
  it('accepts each known scenario verbatim', () => {
    for (const s of ['post', 'thread', 'selfReply', 'reply', 'quote']) {
      expect(normalizeScenario(s, null)).toBe(s);
    }
  });

  it('derives the scenario from context for older clients that send none', () => {
    expect(
      normalizeScenario(undefined, { kind: 'reply', transcript: 'a: hi' }),
    ).toBe('reply');
    expect(
      normalizeScenario(undefined, { kind: 'quote', transcript: 'a: hi' }),
    ).toBe('quote');
  });

  it('falls back to a standalone post for junk input', () => {
    expect(normalizeScenario('broadcast', null)).toBe('post');
    expect(normalizeScenario(42, null)).toBe('post');
    expect(normalizeScenario(undefined, null)).toBe('post');
  });
});

describe('buildAdviserPrompt scenario framing', () => {
  it('includes exactly the guidance for the given scenario', () => {
    for (const [scenario, guidance] of Object.entries(SCENARIO_GUIDANCE)) {
      const { user } = promptFor({ scenario });
      expect(user).toContain(guidance);
      for (const [other, otherGuidance] of Object.entries(SCENARIO_GUIDANCE)) {
        if (other !== scenario) expect(user).not.toContain(otherGuidance);
      }
    }
  });

  it('asks for the "Reading the room" check only when someone else is in the conversation', () => {
    const reply = buildContextBlock({
      kind: 'reply',
      target: { author: 'ada', text: 'what about tests?' },
    });
    expect(
      promptFor({ scenario: 'reply', contextBlock: reply }).user,
    ).toContain('Reading the room');

    const quote = buildContextBlock({
      kind: 'quote',
      target: { author: 'ada', text: 'what about tests?' },
    });
    expect(
      promptFor({ scenario: 'quote', contextBlock: quote }).user,
    ).toContain('Reading the room');

    // A self-thread has context but nobody to misread.
    const selfThread = buildContextBlock({
      kind: 'selfReply',
      target: { author: 'me', text: 'part one' },
    });
    const { user } = promptFor({
      scenario: 'selfReply',
      contextBlock: selfThread,
    });
    expect(user).not.toContain('Reading the room');
    expect(user).toContain('own earlier posts');
    expect(user).toContain('me: part one');
  });
});

describe('buildContextBlock', () => {
  it('accepts selfReply alongside reply and quote', () => {
    for (const kind of ['reply', 'quote', 'selfReply']) {
      const block = buildContextBlock({
        kind,
        target: { author: 'a', text: 'hi' },
      });
      expect(block).toEqual({ kind, transcript: 'a: hi' });
    }
    expect(
      buildContextBlock({
        kind: 'broadcast',
        target: { author: 'a', text: 'hi' },
      }),
    ).toBeNull();
  });
});

describe('writing checks in the prompt', () => {
  it('is absent entirely when no checks were requested', () => {
    const { user } = promptFor({ writingChecks: null });
    expect(user).not.toContain('proofread');
    expect(user).not.toContain('"writing"');
  });

  it('lists only the categories the user turned on', () => {
    const { user } = promptFor({
      writingChecks: normalizeWritingChecks({ typos: true }),
    });
    expect(user).toContain('proofread');
    expect(user).toContain('typo:');
    expect(user).not.toContain('grammar:');
    expect(user).not.toContain('clarity:');
  });

  it('tells the model casual social-media style is never an issue', () => {
    const { user } = promptFor({
      writingChecks: normalizeWritingChecks({
        typos: true,
        grammar: true,
        clarity: true,
      }),
    });
    expect(user).toContain('casual style is a choice');
    expect(user).toContain('NEVER issues');
  });

  it('includes the learned style profile and marks it as never-a-slip', () => {
    const { user } = promptFor({
      writingChecks: normalizeWritingChecks({
        typos: true,
        style: 'writes all-lowercase; uses "gonna" and "yall" throughout',
      }),
    });
    expect(user).toContain(
      'writes all-lowercase; uses "gonna" and "yall" throughout',
    );
    expect(user).toContain('intentional style, never a slip');
    // Absent when no profile has been learned.
    expect(
      promptFor({ writingChecks: normalizeWritingChecks({ typos: true }) })
        .user,
    ).not.toContain('learned from their recent posts');
  });

  it("includes the writer's own notes with precedence over the defaults", () => {
    const { user } = promptFor({
      writingChecks: normalizeWritingChecks({
        typos: true,
        customText: 'i drop apostrophes on purpose; do flag misspelled names',
      }),
    });
    expect(user).toContain(
      'i drop apostrophes on purpose; do flag misspelled names',
    );
    expect(user).toContain('take precedence');
    expect(
      promptFor({ writingChecks: normalizeWritingChecks({ typos: true }) })
        .user,
    ).not.toContain('take precedence');
  });
});

describe('style synthesis', () => {
  it('normalizeStylePosts accepts strings or {text}, drops junk, caps count and length', () => {
    const posts = [
      'first post ',
      { text: 'second post' },
      '',
      { text: '   ' },
      null,
      42,
      { body: 'nope' },
    ];
    expect(normalizeStylePosts(posts)).toEqual(['first post', 'second post']);
    expect(normalizeStylePosts(Array(900).fill('hi'))).toHaveLength(
      MAX_STYLE_POSTS,
    );
    expect(normalizeStylePosts(['x'.repeat(2000)])[0]).toHaveLength(600);
    expect(normalizeStylePosts('not an array')).toEqual([]);
    expect(MIN_STYLE_POSTS).toBeGreaterThan(0);
  });

  // Deep sampling is bounded by characters, not just count — five hundred
  // long posts must not turn one synthesis into a giant request. Newest posts
  // come first, so the budget cuts the oldest.
  it('normalizeStylePosts stops at the total-character budget', () => {
    const longPost = 'x'.repeat(600);
    const texts = normalizeStylePosts(Array(400).fill(longPost));
    expect(texts.length).toBe(Math.ceil(MAX_STYLE_TOTAL_CHARS / 600));
    expect(texts.length).toBeLessThan(400);
  });

  it('buildStylePrompt includes every post and the consistency rule', () => {
    const texts = [
      'gonna head out',
      'yall seen this?',
      'love it here',
      'ok that was fun',
      'night everyone',
    ];
    const { system, user } = buildStylePrompt(texts);
    expect(system).toContain('STRICT JSON');
    for (const t of texts) expect(user).toContain(t);
    // The profile must not launder one-off slips into "style" — the proofread
    // exists to catch exactly those.
    expect(user).toContain('leave one-offs out of the profile');
    expect(user).toContain('NOT to flag as a mistake');
    // A plain synthesis carries no refinement blocks.
    expect(user).not.toContain('previous version of this profile');
    expect(user).not.toContain('THEY are the authority');
  });

  it("buildStylePrompt folds in the previous profile and the writer's guidance", () => {
    const texts = ['a', 'b', 'c', 'd', 'e'];
    const { user } = buildStylePrompt(texts, {
      previousSummary: 'writes lowercase; heavy emoji use',
      guidance: 'i actually never use emoji — that was a bot repost era',
    });
    expect(user).toContain('writes lowercase; heavy emoji use');
    expect(user).toContain('Keep whatever the posts above still support');
    expect(user).toContain(
      'i actually never use emoji — that was a bot repost era',
    );
    // On their own style, the writer outranks anything inferred from posts.
    expect(user).toContain('THEY are the authority');
    expect(user).toContain('the\nwriter wins');
  });

  it('normalizeStyleText trims, caps, and nulls junk', () => {
    expect(normalizeStyleText('  keep this  ', 100)).toBe('keep this');
    expect(
      normalizeStyleText('x'.repeat(900), MAX_STYLE_GUIDANCE),
    ).toHaveLength(MAX_STYLE_GUIDANCE);
    expect(normalizeStyleText('   ', 100)).toBeNull();
    expect(normalizeStyleText(42, 100)).toBeNull();
    expect(normalizeStyleText(undefined, 100)).toBeNull();
  });

  it('normalizeStyleSummary trims, caps, and returns empty for junk', () => {
    expect(normalizeStyleSummary({ summary: '  lowercase on purpose  ' })).toBe(
      'lowercase on purpose',
    );
    expect(normalizeStyleSummary({ summary: 'x'.repeat(5000) })).toHaveLength(
      1500,
    );
    expect(normalizeStyleSummary({ summary: 42 })).toBe('');
    expect(normalizeStyleSummary(undefined)).toBe('');
  });
});

describe('normalizeWritingChecks', () => {
  it('keeps only known checks set strictly true, or null when none are', () => {
    expect(
      normalizeWritingChecks({ typos: true, grammar: false, spelling: true }),
    ).toEqual({ categories: { typos: true }, customText: null, style: null });
    expect(normalizeWritingChecks({ typos: 'yes' })).toBeNull();
    expect(normalizeWritingChecks({})).toBeNull();
    expect(normalizeWritingChecks(null)).toBeNull();
    expect(normalizeWritingChecks('typos')).toBeNull();
  });

  it("carries the writer's notes and style profile, trimmed and capped", () => {
    const checks = normalizeWritingChecks({
      typos: true,
      customText: '  never flag "yall"  ',
      style: '  writes in lowercase on purpose  ',
    });
    expect(checks.customText).toBe('never flag "yall"');
    expect(checks.style).toBe('writes in lowercase on purpose');
    expect(
      normalizeWritingChecks({ typos: true, customText: 'x'.repeat(2000) })
        .customText,
    ).toHaveLength(500);
    expect(
      normalizeWritingChecks({ typos: true, style: 'x'.repeat(5000) }).style,
    ).toHaveLength(1500);
  });

  // Notes and style guide the proofread; with no category on there is no
  // proofread for them to guide.
  it('is still null with notes or style but no category on', () => {
    expect(
      normalizeWritingChecks({ customText: 'be careful', style: 'lowercase' }),
    ).toBeNull();
  });
});

describe('normalizeWritingIssues', () => {
  const draft = 'excited to share what out team has been working on';
  const requested = normalizeWritingChecks({ typos: true });

  it('is null when no checks were requested, empty when the model found nothing', () => {
    expect(normalizeWritingIssues({ issues: [] }, draft, null)).toBeNull();
    expect(normalizeWritingIssues({ issues: [] }, draft, requested)).toEqual({
      issues: [],
    });
    expect(normalizeWritingIssues(undefined, draft, requested)).toEqual({
      issues: [],
    });
  });

  it('keeps a real issue whose excerpt is verbatim from the draft', () => {
    const { issues } = normalizeWritingIssues(
      {
        issues: [
          {
            type: 'typo',
            found: 'what out team',
            replacement: 'what our team',
            note: '"out" for "our"',
          },
        ],
      },
      draft,
      requested,
    );
    expect(issues).toEqual([
      {
        type: 'typo',
        found: 'what out team',
        replacement: 'what our team',
        note: '"out" for "our"',
      },
    ]);
  });

  it('drops an excerpt that is not actually in the draft — the one-tap fix could never apply', () => {
    const { issues } = normalizeWritingIssues(
      {
        issues: [
          {
            type: 'typo',
            found: 'what our team',
            replacement: 'what our team!',
            note: 'n',
          },
        ],
      },
      draft,
      requested,
    );
    expect(issues).toEqual([]);
  });

  it('drops categories the user did not turn on', () => {
    const { issues } = normalizeWritingIssues(
      {
        issues: [
          {
            type: 'grammar',
            found: 'out team',
            replacement: 'our team',
            note: 'n',
          },
        ],
      },
      draft,
      requested,
    );
    expect(issues).toEqual([]);
  });

  it('keeps an unfixable observation but nulls its replacement', () => {
    const { issues } = normalizeWritingIssues(
      {
        issues: [
          {
            type: 'typo',
            found: 'out team',
            replacement: 'out team',
            note: 'no-op correction',
          },
          { type: 'typo', found: 'out team', note: 'no replacement offered' },
        ],
      },
      draft,
      requested,
    );
    expect(issues).toEqual([
      {
        type: 'typo',
        found: 'out team',
        replacement: null,
        note: 'no-op correction',
      },
      {
        type: 'typo',
        found: 'out team',
        replacement: null,
        note: 'no replacement offered',
      },
    ]);
  });

  it('caps the list and survives junk entries', () => {
    const flood = Array.from({ length: 20 }, (_, i) => ({
      type: 'typo',
      found: 'out',
      replacement: `our${i}`,
      note: '',
    }));
    const { issues } = normalizeWritingIssues(
      {
        issues: [null, 'nonsense', { type: 'typo' }, ...flood],
      },
      draft,
      requested,
    );
    expect(issues).toHaveLength(MAX_WRITING_ISSUES);
  });
});

describe('check excerpts in the prompt', () => {
  it('asks for a verbatim excerpt on every check, null when ok or whole-draft', () => {
    const { user } = promptFor();
    expect(user).toContain(
      '"excerpt": "<exact passage copied verbatim from the draft, or null>"',
    );
    expect(user).toMatch(/copied character-for-character from the draft/);
    expect(user).toMatch(/Use null when the status is\n?\s*"ok"/);
  });
});

describe('normalizeChecks', () => {
  const DRAFT =
    'Honestly exhausted by this. Anyone defending that take has not read past the headline. The sample was eleven people.';

  it('keeps a flagged check whose excerpt is verbatim from the draft', () => {
    const [check] = normalizeChecks(
      [
        {
          id: 'lessConfrontational',
          label: 'Less confrontational',
          status: 'conflict',
          note: 'Aimed at people.',
          excerpt: 'has not read past the headline',
        },
      ],
      DRAFT,
    );
    expect(check).toEqual({
      id: 'lessConfrontational',
      label: 'Less confrontational',
      status: 'conflict',
      note: 'Aimed at people.',
      excerpt: 'has not read past the headline',
    });
  });

  it('drops an excerpt the draft does not contain (the client could not mark it)', () => {
    const [check] = normalizeChecks(
      [
        {
          id: 'reduceNegativity',
          label: 'Reduce negativity',
          status: 'caution',
          excerpt: 'so exhausted',
        },
      ],
      DRAFT,
    );
    expect(check.excerpt).toBeNull();
    expect(check.status).toBe('caution');
  });

  it('drops an excerpt on a check that passes', () => {
    const [check] = normalizeChecks(
      [
        {
          id: 'limitTopic',
          label: 'Limit AI topic',
          status: 'ok',
          excerpt: 'The sample was eleven people.',
        },
      ],
      DRAFT,
    );
    expect(check.excerpt).toBeNull();
  });

  it('drops an excerpt that is the whole draft', () => {
    const [check] = normalizeChecks(
      [
        {
          id: 'reduceNegativity',
          label: 'Reduce negativity',
          status: 'caution',
          excerpt: DRAFT,
        },
      ],
      ` ${DRAFT} `,
    );
    expect(check.excerpt).toBeNull();
  });

  it('drops an overlong excerpt rather than marking part of it', () => {
    const long = 'x'.repeat(MAX_CHECK_EXCERPT + 1);
    const [check] = normalizeChecks(
      [
        {
          id: 'custom',
          label: 'Custom goals',
          status: 'conflict',
          excerpt: long,
        },
      ],
      `${long} and more`,
    );
    expect(check.excerpt).toBeNull();
  });

  it('reads an unknown status as ok and a missing excerpt as null', () => {
    const [check] = normalizeChecks(
      [{ id: 'custom', label: 'Custom goals', status: 'alarming' }],
      DRAFT,
    );
    expect(check).toMatchObject({ status: 'ok', excerpt: null, note: '' });
  });

  it('falls back to the id for a missing label and skips checks with neither', () => {
    const checks = normalizeChecks(
      [
        { id: 'understanding', status: 'caution' },
        { status: 'conflict' },
        null,
        'junk',
      ],
      DRAFT,
    );
    expect(checks).toHaveLength(1);
    expect(checks[0].label).toBe('understanding');
  });

  it('returns an empty list for a missing or malformed checks field', () => {
    expect(normalizeChecks(undefined, DRAFT)).toEqual([]);
    expect(normalizeChecks({ checks: [] }, DRAFT)).toEqual([]);
  });

  it(`caps the list at ${MAX_CHECKS}`, () => {
    const many = Array.from({ length: MAX_CHECKS + 5 }, (_, i) => ({
      id: `g${i}`,
      label: `Goal ${i}`,
      status: 'ok',
    }));
    expect(normalizeChecks(many, DRAFT)).toHaveLength(MAX_CHECKS);
  });
});
