import { describe, it, expect } from 'vitest';
import {
  DEFAULT_ADVISER_SETTINGS,
  isPostingAdviserPristine,
  nextPostingAdviserState,
  normalizeAdviserSettings,
  normalizeStyleSampleSize,
} from './setup.js';

// The adviser's on/off switch appears in Settings › Posting and on the posting
// hub; both must be the same switch. One shared helper decides the next state,
// a first turn-on seeds a working setup, and a configured adviser is never
// reseeded.

describe('isPostingAdviserPristine', () => {
  it('treats an unset or default adviser as untouched', () => {
    expect(isPostingAdviserPristine(undefined)).toBe(true);
    expect(isPostingAdviserPristine({})).toBe(true);
    expect(
      isPostingAdviserPristine({ enabled: false, goals: { presets: {} } }),
    ).toBe(true);
  });

  it('treats any configured check or goal as touched', () => {
    expect(isPostingAdviserPristine({ checkBeforePublish: true })).toBe(false);
    expect(isPostingAdviserPristine({ checkReplyContext: true })).toBe(false);
    expect(
      isPostingAdviserPristine({
        goals: { presets: { reduceNegativity: true } },
      }),
    ).toBe(false);
    expect(
      isPostingAdviserPristine({
        goals: { presets: { lessConfrontational: true } },
      }),
    ).toBe(false);
    expect(
      isPostingAdviserPristine({
        goals: {
          presets: { limitTopic: { enabled: true, topic: 'politics' } },
        },
      }),
    ).toBe(false);
    expect(
      isPostingAdviserPristine({ goals: { customText: 'be kinder' } }),
    ).toBe(false);
  });

  it('treats any writing check as touched too', () => {
    expect(isPostingAdviserPristine({ writingChecks: { typos: true } })).toBe(
      false,
    );
    expect(isPostingAdviserPristine({ writingChecks: { grammar: true } })).toBe(
      false,
    );
    expect(isPostingAdviserPristine({ writingChecks: { clarity: true } })).toBe(
      false,
    );
    expect(
      isPostingAdviserPristine({
        writingChecks: { typos: false, grammar: false, clarity: false },
      }),
    ).toBe(true);
  });

  it('treats proofread notes and a learned style profile as touched', () => {
    expect(
      isPostingAdviserPristine({
        writingChecks: { customText: 'never flag yall' },
      }),
    ).toBe(false);
    expect(
      isPostingAdviserPristine({
        writingChecks: { styleProfile: { summary: 'writes lowercase' } },
      }),
    ).toBe(false);
    expect(
      isPostingAdviserPristine({
        writingChecks: { styleProfile: { guidance: 'i mean the lowercase' } },
      }),
    ).toBe(false);
    expect(
      isPostingAdviserPristine({
        writingChecks: {
          customText: '   ',
          styleProfile: { summary: '', guidance: '' },
        },
      }),
    ).toBe(true);
  });

  it('ignores whitespace-only custom goals', () => {
    expect(isPostingAdviserPristine({ goals: { customText: '   ' } })).toBe(
      true,
    );
  });

  // `enabled` is the switch itself, not configuration: an adviser turned on and
  // back off is still pristine and gets seeded next time.
  it('ignores the enabled flag itself', () => {
    expect(isPostingAdviserPristine({ enabled: true })).toBe(true);
  });
});

describe('nextPostingAdviserState', () => {
  it('seeds every check the first time it is turned on', () => {
    const next = nextPostingAdviserState({ enabled: false });
    expect(next.enabled).toBe(true);
    // `enabled` alone would only add a composer button the writer has to
    // remember to press.
    expect(next.checkBeforePublish).toBe(true);
    expect(next.checkReplyContext).toBe(true);
    // Only interrupt on real drift or a caught slip, so a clean draft still
    // publishes in one tap.
    expect(next.reviewMode).toBe('significant');
    expect(next.checkScope).toBe('all');
    expect(next.goals.presets.reduceNegativity).toBe(true);
    expect(next.goals.presets.lessConfrontational).toBe(true);
    // The whole proofread comes on too; each piece is a switch the writer can
    // flip back off in settings.
    expect(next.writingChecks.typos).toBe(true);
    expect(next.writingChecks.grammar).toBe(true);
    expect(next.writingChecks.clarity).toBe(true);
    // Everything needing the writer's own input stays untouched: limitTopic
    // needs a topic, the text fields need words, and the style profile needs
    // an explicit learn (it spends a style refresh).
    expect(next.goals.presets.limitTopic?.enabled).toBeFalsy();
    expect(next.writingChecks.customText).toBeFalsy();
    expect(next.writingChecks.styleProfile?.summary).toBeFalsy();
  });

  it('never reseeds over choices the writer has made', () => {
    const configured = {
      enabled: false,
      checkBeforePublish: false,
      checkReplyContext: false,
      reviewMode: 'always',
      goals: {
        presets: { reduceNegativity: false },
        customText: 'stay curious',
      },
    };
    const next = nextPostingAdviserState(configured);
    expect(next.enabled).toBe(true);
    expect(next.checkBeforePublish).toBe(false);
    expect(next.reviewMode).toBe('always');
    expect(next.goals.customText).toBe('stay curious');
  });

  it('turning it off leaves everything else alone', () => {
    const on = {
      enabled: true,
      checkBeforePublish: true,
      checkReplyContext: true,
      reviewMode: 'significant',
      goals: { presets: { reduceNegativity: true }, customText: 'be kinder' },
    };
    const off = nextPostingAdviserState(on);
    expect(off.enabled).toBe(false);
    expect(off.checkBeforePublish).toBe(true);
    expect(off.goals).toEqual(on.goals);
    // Off then on again must not reseed a configured adviser.
    expect(nextPostingAdviserState(off)).toMatchObject({
      enabled: true,
      reviewMode: 'significant',
    });
  });

  it('does not mutate the settings object handed to it', () => {
    const current = { enabled: false, goals: { presets: {} } };
    const snapshot = JSON.parse(JSON.stringify(current));
    nextPostingAdviserState(current);
    expect(current).toEqual(snapshot);
  });
});

describe('the default setup', () => {
  it('is off, with nothing chosen, and reads as untouched', () => {
    expect(DEFAULT_ADVISER_SETTINGS.enabled).toBe(false);
    expect(DEFAULT_ADVISER_SETTINGS.checkBeforePublish).toBe(false);
    expect(isPostingAdviserPristine(DEFAULT_ADVISER_SETTINGS)).toBe(true);
  });

  it('cannot be changed by a reader that forgets to copy it', () => {
    expect(Object.isFrozen(DEFAULT_ADVISER_SETTINGS)).toBe(true);
    expect(
      Object.isFrozen(DEFAULT_ADVISER_SETTINGS.goals.presets.limitTopic),
    ).toBe(true);
    // nextPostingAdviserState builds a new object over it.
    const on = nextPostingAdviserState(DEFAULT_ADVISER_SETTINGS);
    expect(on.enabled).toBe(true);
    expect(DEFAULT_ADVISER_SETTINGS.enabled).toBe(false);
  });
});

describe('normalizeAdviserSettings', () => {
  it('fills every field of nothing with its default', () => {
    expect(normalizeAdviserSettings(undefined)).toEqual(
      DEFAULT_ADVISER_SETTINGS,
    );
    expect(normalizeAdviserSettings('on')).toEqual(DEFAULT_ADVISER_SETTINGS);
    expect(normalizeAdviserSettings({ goals: 'x', writingChecks: [] })).toEqual(
      DEFAULT_ADVISER_SETTINGS,
    );
  });

  it('round-trips a full setup unchanged', () => {
    const seeded = normalizeAdviserSettings(
      nextPostingAdviserState(DEFAULT_ADVISER_SETTINGS),
    );
    expect(normalizeAdviserSettings(seeded)).toEqual(seeded);
    expect(seeded.writingChecks.typos).toBe(true);
  });

  it('takes only true as on, and known words for the two choices', () => {
    const out = normalizeAdviserSettings({
      enabled: 'yes',
      checkBeforePublish: 1,
      reviewMode: 'sometimes',
      checkScope: 'everything',
      checkReplyContext: true,
    });
    expect(out.enabled).toBe(false);
    expect(out.checkBeforePublish).toBe(false);
    expect(out.reviewMode).toBe('significant');
    expect(out.checkScope).toBe('all');
    expect(out.checkReplyContext).toBe(true);
    expect(
      normalizeAdviserSettings({ reviewMode: 'always', checkScope: 'replies' }),
    ).toMatchObject({
      reviewMode: 'always',
      checkScope: 'replies',
    });
  });

  it('clips the writer’s words to the settings’ limits', () => {
    const out = normalizeAdviserSettings({
      goals: {
        customText: 'g'.repeat(900),
        presets: { limitTopic: { enabled: true, topic: 't'.repeat(400) } },
      },
      writingChecks: {
        customText: 'n'.repeat(900),
        styleProfile: {
          summary: 's'.repeat(3000),
          guidance: 'u'.repeat(900),
          analyzedCount: '42.7',
          updatedAt: 7,
        },
      },
    });
    expect(out.goals.customText).toHaveLength(500);
    expect(out.goals.presets.limitTopic).toEqual({
      enabled: true,
      topic: 't'.repeat(200),
    });
    expect(out.writingChecks.customText).toHaveLength(500);
    expect(out.writingChecks.styleProfile.summary).toHaveLength(1500);
    expect(out.writingChecks.styleProfile.guidance).toHaveLength(500);
    expect(out.writingChecks.styleProfile.analyzedCount).toBe(42);
    expect(out.writingChecks.styleProfile.updatedAt).toBe('');
  });

  it('keeps a sample size from the allowed few', () => {
    expect(normalizeStyleSampleSize(250)).toBe(250);
    expect(normalizeStyleSampleSize('500')).toBe(500);
    expect(normalizeStyleSampleSize(1000)).toBe(100);
    expect(
      normalizeAdviserSettings({ writingChecks: { styleSampleSize: 7 } })
        .writingChecks.styleSampleSize,
    ).toBe(100);
  });
});
