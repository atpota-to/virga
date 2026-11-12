import { describe, it, expect } from 'vitest';
import {
  waitingTimerRows,
  timerBucket,
  timerUsage,
  timerSlotProblem,
  timerSlotSentence,
  timerSlotRefusal,
  compareTimers,
  describeDeleteAt,
  describeWhen,
  normalizeDeleteAt,
  LIFESPAN_PRESETS,
  describeClauses,
  clauseFor,
  withClause,
  hasClauses,
  describeTimer,
  evaluateConditions,
  extendWindowSeconds,
  formatLifespan,
  isPresetLifespan,
  lifespanFromParts,
  maxAmountForUnit,
  normalizeConditions,
  splitLifespan,
  normalizeLifespan,
  normalizeTimer,
  timeUntil,
  timerChipLabel,
  toWireSpec,
  pinnedDeadlineStatus,
  scheduledTimerProblem,
  settleForPublish,
  timerAdjustmentNote,
  immediateTimerProblem,
  immediateTimerToSend,
  scheduledTimerToSend,
  scheduledRowTimerProblem,
  keepHiddenRuleParts,
  describeFitChange,
  sameTimer,
  draftTimerNote,
  defaultRuleFromSettings,
  composerTimerFit,
  timerRoomProblem,
  TIMER_BUCKET_FEATURE,
  MAX_EXTENSIONS_CAP,
  MAX_LIFESPAN_SECONDS,
  MIN_LIFESPAN_SECONDS,
  clauseCountKey,
  describeAllow,
  describeEffects,
  describeFrom,
  effectFor,
  effectsDelete,
  normalizeActorFilter,
  normalizeEffects,
  withEffect,
  withoutGateEffects,
  withoutConditions,
  fitTimerToPost,
  readStoredTimer,
  unreadableRuleParts,
} from './selfDestruct.js';

// Cocoon evaluates the rule composed here, and the sentence the writer agreed
// to is written here too; a rule that reads one way and behaves another costs
// someone a post they meant to keep.

const HOUR = 3600;
const DAY_SECONDS = 24 * HOUR;

describe('normalizeLifespan', () => {
  it('clamps to the range cocoon will accept', () => {
    expect(normalizeLifespan(1)).toBe(MIN_LIFESPAN_SECONDS);
    expect(normalizeLifespan(MAX_LIFESPAN_SECONDS * 4)).toBe(
      MAX_LIFESPAN_SECONDS,
    );
    expect(normalizeLifespan(HOUR)).toBe(HOUR);
  });

  it('falls back to the default rather than NaN', () => {
    expect(normalizeLifespan(undefined)).toBe(24 * HOUR);
    expect(normalizeLifespan('nonsense')).toBe(24 * HOUR);
  });
});

describe('normalizeConditions', () => {
  it('drops a clause that says nothing', () => {
    // "Keep it if it reaches zero likes" is true of every post; an empty box
    // means no clause.
    const c = normalizeConditions({
      clauses: [{ metric: 'likes', value: 0 }, { metric: 'replies' }],
    });
    expect(c.clauses).toEqual([]);
    expect(hasClauses(c)).toBe(false);
  });

  it('reads the pre-clause shape that is already on people’s PDSes', () => {
    // Posting settings records written before clauses existed are in the wild.
    const c = normalizeConditions({
      mode: 'all',
      minLikes: 5,
      minReplies: 2,
      onSpare: 'extend',
      maxExtensions: 3,
    });
    expect(c.logic).toBe('all');
    expect(c.sense).toBe('unless');
    expect(c.clauses).toEqual([
      { metric: 'likes', op: 'gte', value: 5 },
      { metric: 'replies', op: 'gte', value: 2 },
    ]);
    expect(c.maxExtensions).toBe(3);
  });

  it('keeps one clause per metric', () => {
    const c = normalizeConditions({
      clauses: [
        { metric: 'quotes', op: 'gt', value: 5 },
        { metric: 'quotes', op: 'gte', value: 99 },
      ],
    });
    expect(c.clauses).toHaveLength(1);
    expect(c.clauses[0].value).toBe(5);
  });

  it('defaults to the forgiving reading, sparing, and keeping', () => {
    const c = normalizeConditions({});
    expect(c.logic).toBe('any');
    expect(c.sense).toBe('unless');
    expect(c.onSpare).toBe('keep');
    expect(c.maxExtensions).toBe(0);
  });

  it('bounds extensions so an extend rule cannot cycle forever', () => {
    expect(normalizeConditions({ onSpare: 'extend' }).maxExtensions).toBe(1);
    expect(
      normalizeConditions({ onSpare: 'extend', maxExtensions: 500 })
        .maxExtensions,
    ).toBe(MAX_EXTENSIONS_CAP);
    // 'keep' has nothing to extend, so the count is meaningless there.
    expect(
      normalizeConditions({ onSpare: 'keep', maxExtensions: 5 }).maxExtensions,
    ).toBe(0);
  });

  it('rejects a sense, logic, metric or operator it does not know', () => {
    expect(normalizeConditions({ logic: 'sometimes' }).logic).toBe('any');
    expect(normalizeConditions({ sense: 'perhaps' }).sense).toBe('unless');
    expect(
      normalizeConditions({ clauses: [{ metric: 'vibes', value: 3 }] }).clauses,
    ).toEqual([]);
    expect(
      normalizeConditions({
        clauses: [{ metric: 'likes', op: 'lt', value: 3 }],
      }).clauses[0].op,
    ).toBe('gte');
  });
});
describe('clauseFor and withClause', () => {
  it('sets, changes and clears one metric without touching the rest', () => {
    let c = normalizeConditions({ clauses: [{ metric: 'likes', value: 5 }] });
    c = withClause(c, 'replies', { op: 'gt', value: 2 });
    expect(clauseFor(c, 'replies')).toEqual({
      metric: 'replies',
      op: 'gt',
      value: 2,
    });
    expect(clauseFor(c, 'likes').value).toBe(5);

    // Emptying the box removes the clause; a stale number left armed would mean
    // the post never gets deleted.
    c = withClause(c, 'replies', { op: 'gt', value: '' });
    expect(clauseFor(c, 'replies')).toBeNull();
    expect(clauseFor(c, 'likes').value).toBe(5);
  });

  it('keeps the clauses in the order the editor lists the metrics', () => {
    let c = normalizeConditions({});
    c = withClause(c, 'quotes', { value: 5 });
    c = withClause(c, 'likes', { value: 1 });
    expect(c.clauses.map((x) => x.metric)).toEqual(['likes', 'quotes']);
  });
});

describe('evaluateConditions', () => {
  const counts = {
    likes: 5,
    replies: 2,
    reposts: 1,
    quotes: 6,
    selfReplies: 0,
  };

  it('never spares a post with no conditions', () => {
    expect(evaluateConditions({}, { likes: 999 }).spare).toBe(false);
  });

  it('honours the operator', () => {
    expect(
      evaluateConditions(
        { clauses: [{ metric: 'likes', op: 'gte', value: 5 }] },
        counts,
      ).matched,
    ).toBe(true);
    // Five likes is not more than five.
    expect(
      evaluateConditions(
        { clauses: [{ metric: 'likes', op: 'gt', value: 5 }] },
        counts,
      ).matched,
    ).toBe(false);
  });

  it("'any' takes one, 'all' takes every one", () => {
    const clauses = [
      { metric: 'likes', value: 5 },
      { metric: 'replies', value: 9 },
    ];
    expect(evaluateConditions({ logic: 'any', clauses }, counts).matched).toBe(
      true,
    );
    expect(evaluateConditions({ logic: 'all', clauses }, counts).matched).toBe(
      false,
    );
  });

  it('the sense decides what a match costs the post', () => {
    const clauses = [{ metric: 'replies', op: 'gt', value: 5 }];
    expect(
      evaluateConditions({ sense: 'onlyIf', clauses }, { replies: 9 }).spare,
    ).toBe(false);
    expect(
      evaluateConditions({ sense: 'onlyIf', clauses }, { replies: 1 }).spare,
    ).toBe(true);
    expect(
      evaluateConditions({ sense: 'unless', clauses }, { replies: 9 }).spare,
    ).toBe(true);
    expect(
      evaluateConditions({ sense: 'unless', clauses }, { replies: 1 }).spare,
    ).toBe(false);
  });

  it('reads quotes on their own, not as reposts', () => {
    expect(
      evaluateConditions({ clauses: [{ metric: 'reposts', value: 5 }] }, counts)
        .matched,
    ).toBe(false);
    expect(
      evaluateConditions({ clauses: [{ metric: 'quotes', value: 5 }] }, counts)
        .matched,
    ).toBe(true);
  });

  it('reads missing counts as zero rather than as unknown', () => {
    expect(
      evaluateConditions({ clauses: [{ metric: 'selfReplies', value: 1 }] }, {})
        .spare,
    ).toBe(false);
    expect(
      evaluateConditions(
        { clauses: [{ metric: 'likes', value: 1 }] },
        undefined,
      ).spare,
    ).toBe(false);
  });
});

describe('toWireSpec', () => {
  it('sends nothing for a timer that was not asked for', () => {
    expect(toWireSpec({ enabled: false, lifespanSeconds: HOUR })).toBeNull();
    expect(toWireSpec(null)).toBeNull();
  });

  it('sends the normalized rule, without the composer-only enabled flag', () => {
    const spec = toWireSpec({
      enabled: true,
      lifespanSeconds: HOUR,
      conditions: {
        sense: 'onlyIf',
        clauses: [{ metric: 'replies', op: 'gt', value: '5' }],
      },
    });
    expect(spec).toEqual({
      lifespanSeconds: HOUR,
      conditions: {
        logic: 'any',
        clauses: [{ metric: 'replies', op: 'gt', value: 5 }],
        sense: 'onlyIf',
        onSpare: 'keep',
        maxExtensions: 0,
      },
      // Always name an action; cocoon reads an absent list as delete, but
      // saying so is clearer than relying on it.
      effects: [{ action: 'delete' }],
    });
    expect(spec).not.toHaveProperty('enabled');
  });
});

describe('normalizeTimer', () => {
  it('gives back a whole timer from a partial one', () => {
    const t = normalizeTimer({ enabled: true });
    expect(t.enabled).toBe(true);
    expect(t.lifespanSeconds).toBe(24 * HOUR);
    expect(t.conditions.logic).toBe('any');
  });
});

describe('formatLifespan', () => {
  it('uses the preset wording where there is one', () => {
    expect(formatLifespan(HOUR)).toBe('1 hour');
    expect(formatLifespan(30 * 60)).toBe('30 minutes');
    expect(formatLifespan(7 * 24 * HOUR)).toBe('1 week');
  });

  it('falls back to whole units for a custom number', () => {
    expect(formatLifespan(2 * HOUR)).toBe('2 hours');
    expect(formatLifespan(2 * 24 * HOUR)).toBe('2 days');
    expect(formatLifespan(45 * 60)).toBe('45 minutes');
  });

  it('rounds a derived window to a length a person could picture', () => {
    // A window derived from a pinned instant is rarely whole; don't say
    // "1195 minutes".
    expect(formatLifespan(1195 * 60)).toBe('20 hours');
    expect(formatLifespan(100 * 60)).toBe('2 hours');
    expect(formatLifespan(80 * 60)).toBe('80 minutes');
    expect(formatLifespan(5 * 24 * HOUR + 3 * HOUR)).toBe('5 days');
  });
});

describe('describeClauses', () => {
  const of = (...clauses) => ({ clauses });

  it('joins with the word the logic actually means', () => {
    const clauses = [
      { metric: 'likes', value: 5 },
      { metric: 'replies', value: 2 },
    ];
    expect(describeClauses({ logic: 'any', clauses })).toBe(
      '5 likes or 2 replies',
    );
    expect(describeClauses({ logic: 'all', clauses })).toBe(
      '5 likes and 2 replies',
    );
  });

  it('says the operator out loud when it is not "at least"', () => {
    expect(describeClauses(of({ metric: 'replies', op: 'gt', value: 5 }))).toBe(
      'more than 5 replies',
    );
    expect(
      describeClauses(of({ metric: 'replies', op: 'gte', value: 5 })),
    ).toBe('5 replies');
  });

  it('pluralizes each metric correctly', () => {
    expect(describeClauses(of({ metric: 'replies', value: 1 }))).toBe(
      '1 reply',
    );
    expect(describeClauses(of({ metric: 'quotes', value: 3 }))).toBe(
      '3 quotes',
    );
    expect(describeClauses(of({ metric: 'selfReplies', value: 1 }))).toBe(
      '1 reply of your own',
    );
    expect(describeClauses(of({ metric: 'selfReplies', value: 2 }))).toBe(
      '2 replies of your own',
    );
  });

  it('is empty when nothing would change the outcome', () => {
    expect(describeClauses({})).toBe('');
  });
});

describe('describeTimer', () => {
  it('says the plain thing for an unconditional timer', () => {
    expect(describeTimer({ enabled: true, lifespanSeconds: HOUR })).toBe(
      'Deletes itself 1 hour after it goes up.',
    );
  });

  it('says what would keep it, and what keeping means', () => {
    expect(
      describeTimer({
        enabled: true,
        lifespanSeconds: HOUR,
        conditions: { minLikes: 5 },
      }),
    ).toBe(
      'Deletes itself 1 hour after it goes up, unless it has 5 likes by then. If it does, it stays up for good.',
    );
  });

  it('spells out an extend rule, including how many times', () => {
    const sentence = describeTimer({
      enabled: true,
      lifespanSeconds: HOUR,
      conditions: { minReplies: 1, onSpare: 'extend', maxExtensions: 3 },
    });
    expect(sentence).toContain('unless it has 1 reply by then');
    expect(sentence).toContain(
      'If it does, it gets another 1 hour, up to 3 times.',
    );
  });
});

describe('timerChipLabel', () => {
  it('is just the window when nothing would call it off', () => {
    expect(timerChipLabel({ enabled: true, lifespanSeconds: 30 * 60 })).toBe(
      '30 minutes',
    );
  });

  it('carries the rule when there is one', () => {
    expect(
      timerChipLabel({
        enabled: true,
        lifespanSeconds: HOUR,
        conditions: { minLikes: 5 },
      }),
    ).toBe('1 hour · unless 5 likes');
  });
});

describe('timeUntil', () => {
  const now = Date.parse('2026-08-27T12:00:00Z');

  it('reads a due timer as imminent, never as elapsed', () => {
    // Past due means the worker has it; "8 minutes ago" would describe the
    // check, not the post.
    expect(timeUntil('2026-08-27T11:52:00Z', now)).toBe('any moment now');
    expect(timeUntil('2026-08-27T12:00:10Z', now)).toBe('any moment now');
  });

  it('scales the unit to the distance', () => {
    expect(timeUntil('2026-08-27T12:20:00Z', now)).toBe('in 20 minutes');
    expect(timeUntil('2026-08-27T15:00:00Z', now)).toBe('in 3 hours');
    expect(timeUntil('2026-08-29T12:00:00Z', now)).toBe('in 2 days');
  });

  it('says nothing for an unreadable time', () => {
    expect(timeUntil('not a date', now)).toBe('');
  });
});

describe('compareTimers', () => {
  it('puts live timers first, soonest first, and settled ones newest first', () => {
    const rows = [
      {
        id: 'settled-old',
        status: 'deleted',
        resolvedAt: '2026-08-20T00:00:00Z',
        checkAt: '2026-08-20T00:00:00Z',
      },
      { id: 'live-later', status: 'armed', checkAt: '2026-08-28T00:00:00Z' },
      {
        id: 'settled-new',
        status: 'spared',
        resolvedAt: '2026-08-26T00:00:00Z',
        checkAt: '2026-08-26T00:00:00Z',
      },
      { id: 'live-soon', status: 'checking', checkAt: '2026-08-27T13:00:00Z' },
    ];
    expect([...rows].sort(compareTimers).map((r) => r.id)).toEqual([
      'live-soon',
      'live-later',
      'settled-new',
      'settled-old',
    ]);
  });
});

// A pinned deadline: an instant rather than a length. It must reach cocoon
// without ever producing a post that is due the moment it exists.

describe('the preset list', () => {
  it('stops at a week — longer than that is what the custom time is for', () => {
    expect(LIFESPAN_PRESETS.map((p) => p.label)).toEqual([
      '5 minutes',
      '30 minutes',
      '1 hour',
      '6 hours',
      '12 hours',
      '24 hours',
      '3 days',
      '1 week',
    ]);
  });
});

describe('normalizeDeleteAt', () => {
  const now = Date.parse('2026-08-27T12:00:00Z');
  const at = (ms) => new Date(now + ms).toISOString();

  it('takes a moment inside the window', () => {
    expect(normalizeDeleteAt(at(HOUR * 1000), now)).toBe(
      new Date(now + HOUR * 1000).toISOString(),
    );
  });

  it('refuses one that is past, too soon, or beyond the ceiling', () => {
    expect(normalizeDeleteAt(at(-HOUR * 1000), now)).toBeNull();
    expect(normalizeDeleteAt(at(60 * 1000), now)).toBeNull(); // inside the 5-minute floor
    expect(normalizeDeleteAt(at(31 * 24 * HOUR * 1000), now)).toBeNull();
  });

  it('refuses what it cannot read', () => {
    expect(normalizeDeleteAt('sometime next week', now)).toBeNull();
    expect(normalizeDeleteAt(null, now)).toBeNull();
    expect(normalizeDeleteAt('', now)).toBeNull();
  });
});

describe('custom durations', () => {
  // Any length the preset buttons don't cover goes through here. Pinning a
  // clock time instead is a different rule (it stores a window shortened by the
  // publish).

  it('knows which durations a preset button already covers', () => {
    expect(isPresetLifespan(HOUR)).toBe(true);
    expect(isPresetLifespan(10 * 60)).toBe(false);
  });

  it('splits a duration into the largest unit that divides it evenly', () => {
    expect(splitLifespan(10 * 60)).toEqual({ amount: 10, unit: 'minutes' });
    expect(splitLifespan(2 * HOUR)).toEqual({ amount: 2, unit: 'hours' });
    expect(splitLifespan(3 * 24 * HOUR)).toEqual({ amount: 3, unit: 'days' });
    // Stays in minutes rather than "1.5 hours", which would lose the half.
    expect(splitLifespan(90 * 60)).toEqual({ amount: 90, unit: 'minutes' });
  });

  it('round-trips a duration through the box unchanged', () => {
    for (const seconds of [10 * 60, 45 * 60, 2 * HOUR, 5 * 24 * HOUR]) {
      const { amount, unit } = splitLifespan(seconds);
      expect(lifespanFromParts(amount, unit)).toBe(seconds);
    }
  });

  it('refuses what is not yet a duration rather than clamping it', () => {
    // Clamping a half-typed "1" would fight someone on their way to "15".
    expect(lifespanFromParts('', 'minutes')).toBeNull();
    expect(lifespanFromParts('1', 'minutes')).toBeNull();
    expect(lifespanFromParts('0', 'hours')).toBeNull();
    expect(lifespanFromParts('-3', 'hours')).toBeNull();
    expect(lifespanFromParts('900', 'days')).toBeNull();
    expect(lifespanFromParts('5', 'minutes')).toBe(MIN_LIFESPAN_SECONDS);
  });

  it('bounds each unit by what a timer may actually run for', () => {
    expect(maxAmountForUnit('days')).toBe(30);
    expect(maxAmountForUnit('hours')).toBe(720);
    expect(lifespanFromParts(maxAmountForUnit('days'), 'days')).toBe(
      MAX_LIFESPAN_SECONDS,
    );
  });

  it('says a custom duration in the summary the way a preset is said', () => {
    expect(describeTimer({ enabled: true, lifespanSeconds: 10 * 60 })).toBe(
      'Deletes itself 10 minutes after it goes up.',
    );
  });
});

describe('normalizeTimer with a deadline', () => {
  const now = Date.parse('2026-08-27T12:00:00Z');

  it('keeps the chosen duration beside the deadline rather than replacing it', () => {
    const t = normalizeTimer(
      {
        enabled: true,
        lifespanSeconds: 9999,
        deleteAt: new Date(now + 2 * HOUR * 1000).toISOString(),
      },
      now,
    );
    expect(t.deleteAt).toBeTruthy();
    // Separate answers to "when"; folding the duration into the deadline would
    // lose "10 minutes" behind a shorter window.
    expect(t.lifespanSeconds).toBe(9999);
  });

  it('reads the extend window out of the deadline, not the duration behind it', () => {
    const timer = {
      enabled: true,
      lifespanSeconds: 9999,
      deleteAt: new Date(now + 2 * HOUR * 1000).toISOString(),
    };
    // A pinned instant has no duration of its own, so an extend can only hand
    // back the window the author was shown: from now until the instant.
    expect(extendWindowSeconds(timer, now)).toBe(2 * HOUR);
    // Without one, it is exactly the duration they chose.
    expect(
      extendWindowSeconds({ enabled: true, lifespanSeconds: 9999 }, now),
    ).toBe(9999);
  });

  it('gives the duration back when the deadline is dropped', () => {
    const chosen = { enabled: true, lifespanSeconds: 30 * 60 };
    const pinned = normalizeTimer(
      { ...chosen, deleteAt: new Date(now + 6 * HOUR * 1000).toISOString() },
      now,
    );
    const unpinned = normalizeTimer({ ...pinned, deleteAt: null }, now);
    expect(unpinned.lifespanSeconds).toBe(30 * 60);
  });

  it('keeps a stale deadline as picked, beside the duration', () => {
    // Dropping the pin here would make toWireSpec send the duration behind it
    // (often the 24-hour default). What a pin means is decided against the
    // publish (settleForPublish), not whenever the timer is read.
    const at = new Date(now - HOUR * 1000).toISOString();
    const t = normalizeTimer({
      enabled: true,
      lifespanSeconds: HOUR,
      deleteAt: at,
    });
    expect(t.deleteAt).toBe(at);
    expect(t.lifespanSeconds).toBe(HOUR);
  });

  it('still refuses an unreadable deadline', () => {
    expect(
      normalizeTimer({ enabled: true, deleteAt: 'not a date' }).deleteAt,
    ).toBeNull();
  });
});

describe('a picked time that goes stale before the post goes out', () => {
  // Pick 11:00pm at 10:50pm, publish at 10:56pm.
  const picked = Date.parse('2026-08-27T22:50:00Z');
  const elevenPm = new Date(Date.parse('2026-08-27T23:00:00Z')).toISOString();
  const published = Date.parse('2026-08-27T22:56:00Z');
  const timer = {
    enabled: true,
    lifespanSeconds: 24 * HOUR,
    deleteAt: elevenPm,
  };

  it('was a perfectly good pick when it was made', () => {
    expect(normalizeDeleteAt(elevenPm, picked)).toBe(elevenPm);
    expect(pinnedDeadlineStatus(timer, picked)).toBe('ok');
  });

  it('goes out as the five-minute floor, never the 24-hour default behind it', () => {
    const spec = toWireSpec(timer, published);
    expect(spec.lifespanSeconds).toBe(MIN_LIFESPAN_SECONDS);
    // Never a deadline in the past — cocoon refuses those.
    expect(spec).not.toHaveProperty('deleteAt');
  });

  it('says it was moved, so the confirmation can tell the writer', () => {
    const settled = settleForPublish(timer, published);
    expect(settled.adjusted).toBe('floor');
    expect(settled.timer.deleteAt).toBeNull();
    expect(settled.timer.lifespanSeconds).toBe(MIN_LIFESPAN_SECONDS);
    expect(timerAdjustmentNote(settled.adjusted, settled.timer.effects)).toBe(
      'The time you picked had passed, so it comes down in 5 minutes.',
    );
  });

  it('hands a spared post the same five minutes, not the old duration', () => {
    const settled = settleForPublish(
      {
        ...timer,
        conditions: { minLikes: 5, onSpare: 'extend', maxExtensions: 1 },
      },
      published,
    );
    expect(extendWindowSeconds(settled.timer, published)).toBe(
      MIN_LIFESPAN_SECONDS,
    );
  });

  it('leaves a pin that still has room exactly as it was', () => {
    const early = Date.parse('2026-08-27T22:40:00Z');
    const settled = settleForPublish(timer, early);
    expect(settled.adjusted).toBeNull();
    expect(settled.timer.deleteAt).toBe(elevenPm);
    // The extend window is still the one the writer was shown: until the pin.
    expect(toWireSpec(timer, early).lifespanSeconds).toBe(20 * 60);
    expect(toWireSpec(timer, early).deleteAt).toBe(elevenPm);
  });

  it('refuses a pin past the thirty-day ceiling before posting, rather than shortening it', () => {
    const far = {
      enabled: true,
      lifespanSeconds: HOUR,
      deleteAt: new Date(published + 40 * 24 * HOUR * 1000).toISOString(),
    };
    expect(pinnedDeadlineStatus(far, published)).toBe('tooLate');
    expect(immediateTimerProblem(far, published)).toMatch(
      /more than 30 days away\. Pick an earlier time or a length/,
    );
    // Nothing after the post is out shortens it into a timer nobody picked.
    const settled = settleForPublish(far, published);
    expect(settled.adjusted).toBeNull();
    expect(settled.timer.deleteAt).toBe(far.deleteAt);
    expect(toWireSpec(far, published).deleteAt).toBe(far.deleteAt);
  });

  it('says nothing about a timer that was never moved', () => {
    expect(timerAdjustmentNote(null, [{ action: 'delete' }])).toBe('');
    expect(timerAdjustmentNote('floor', [{ action: 'disableQuotes' }])).toBe(
      'The time you picked had passed, so its timer runs in 5 minutes.',
    );
  });
});

describe('a pinned delete time on a scheduled post', () => {
  const scheduledFor = Date.parse('2026-08-28T18:00:00Z');
  const pin = (offsetSeconds) => ({
    enabled: true,
    lifespanSeconds: 24 * HOUR,
    deleteAt: new Date(scheduledFor + offsetSeconds * 1000).toISOString(),
  });

  it('is kept when it lands at least five minutes after the post goes out', () => {
    const timer = pin(5 * HOUR);
    expect(pinnedDeadlineStatus(timer, scheduledFor)).toBe('ok');
    expect(scheduledTimerProblem(timer, scheduledFor)).toBe('');
    const spec = toWireSpec(timer, scheduledFor);
    expect(spec.deleteAt).toBe(timer.deleteAt);
    // The window from the post going up to the pin: not from now, and not the
    // 24-hour duration behind the pin.
    expect(spec.lifespanSeconds).toBe(5 * HOUR);
  });

  it('is refused, with a sentence, when it lands before or too soon after', () => {
    expect(pinnedDeadlineStatus(pin(-HOUR), scheduledFor)).toBe('passed');
    expect(pinnedDeadlineStatus(pin(4 * 60), scheduledFor)).toBe('tooSoon');
    expect(scheduledTimerProblem(pin(4 * 60), scheduledFor)).toMatch(
      /less than 5 minutes after it would go out/,
    );
    const problem = scheduledTimerProblem(pin(-HOUR), scheduledFor);
    expect(problem).toMatch(/less than 5 minutes after it would go out/);
    expect(problem).toMatch(/Pick a later delete time/);
    expect(problem).toMatch(/give it a length instead/);
  });

  it('is refused when it lands more than thirty days after', () => {
    const timer = pin(31 * 24 * HOUR);
    expect(pinnedDeadlineStatus(timer, scheduledFor)).toBe('tooLate');
    expect(scheduledTimerProblem(timer, scheduledFor)).toMatch(
      /more than 30 days after it would go out/,
    );
  });

  it('is no problem at all without a pin, or without a timer', () => {
    expect(
      scheduledTimerProblem(
        { enabled: true, lifespanSeconds: HOUR },
        scheduledFor,
      ),
    ).toBe('');
    expect(
      scheduledTimerProblem({ ...pin(-HOUR), enabled: false }, scheduledFor),
    ).toBe('');
    expect(
      pinnedDeadlineStatus(
        { enabled: true, lifespanSeconds: HOUR },
        scheduledFor,
      ),
    ).toBe('none');
  });
});

describe('toWireSpec with a deadline', () => {
  const now = Date.parse('2026-08-27T12:00:00Z');

  it('sends the deadline alongside the window an extend would grant', () => {
    const spec = toWireSpec(
      {
        enabled: true,
        lifespanSeconds: 9999,
        deleteAt: new Date(now + 3 * HOUR * 1000).toISOString(),
      },
      now,
    );
    expect(spec.deleteAt).toBe(new Date(now + 3 * HOUR * 1000).toISOString());
    // Measured here, while the author is looking; cocoon stores it as given
    // rather than re-deriving it after publishing took its time.
    expect(spec.lifespanSeconds).toBe(3 * HOUR);
  });

  it('sends a chosen duration exactly, with no deadline in the way', () => {
    const spec = toWireSpec({ enabled: true, lifespanSeconds: 10 * 60 }, now);
    expect(spec.lifespanSeconds).toBe(10 * 60);
  });

  it('omits it entirely for an ordinary duration timer', () => {
    expect(
      toWireSpec({ enabled: true, lifespanSeconds: HOUR }, now),
    ).not.toHaveProperty('deleteAt');
  });
});

describe('describeDeleteAt', () => {
  // Built in local time and asserted by shape, so the phrasing is pinned without
  // the test depending on the runner's timezone.
  const base = new Date(2026, 7, 27, 12, 0, 0);
  const at = (days, hour) => new Date(2026, 7, 27 + days, hour, 30, 0);

  it('places the day before the clock', () => {
    expect(describeDeleteAt(at(0, 23), base)).toMatch(/^today at /);
    expect(describeDeleteAt(at(1, 9), base)).toMatch(/^tomorrow at /);
    // Within the week it is a weekday name; past it, a date.
    expect(describeDeleteAt(at(3, 18), base)).toMatch(/^[A-Z][a-z]+day at /);
    expect(describeDeleteAt(at(20, 18), base)).not.toMatch(/day at /);
  });

  it('says nothing for an unreadable moment', () => {
    expect(describeDeleteAt('not a date', base)).toBe('');
  });
});

describe('describeWhen and the sentences, with a deadline', () => {
  const now = Date.parse('2026-08-27T12:00:00Z');
  const tomorrow = new Date(now + 20 * HOUR * 1000).toISOString();

  it('describes the instant rather than a length', () => {
    expect(describeWhen({ enabled: true, deleteAt: tomorrow }, now)).toMatch(
      / at /,
    );
    expect(describeWhen({ enabled: true, lifespanSeconds: HOUR }, now)).toBe(
      '1 hour',
    );
  });

  it('drops "after it goes up", which is only true of a duration', () => {
    const sentence = describeTimer({ enabled: true, deleteAt: tomorrow }, now);
    expect(sentence).toMatch(/^Deletes itself /);
    expect(sentence).not.toContain('after it goes up');
  });

  it('still names the window an extend spare would hand back', () => {
    const sentence = describeTimer(
      {
        enabled: true,
        deleteAt: tomorrow,
        conditions: { minLikes: 5, onSpare: 'extend', maxExtensions: 2 },
      },
      now,
    );
    expect(sentence).toContain('unless it has 5 likes by then');
    expect(sentence).toContain(
      'If it does, it gets another 20 hours, up to 2 times.',
    );
  });

  it('carries the instant into the chip', () => {
    expect(
      timerChipLabel(
        { enabled: true, deleteAt: tomorrow, conditions: { minLikes: 5 } },
        now,
      ),
    ).toMatch(/ at .+ · unless 5 likes$/);
  });
});

describe('normalizeEffects', () => {
  it('reads an absent list as delete', () => {
    // cocoon's fallback, and what older timers meant.
    expect(normalizeEffects(undefined)).toEqual([{ action: 'delete' }]);
    expect(normalizeEffects([])).toEqual([{ action: 'delete' }]);
    expect(normalizeEffects([{ action: 'somethingElse' }])).toEqual([
      { action: 'delete' },
    ]);
  });

  it('defaults a reply limit to followers, and keeps an empty list as nobody', () => {
    expect(normalizeEffects([{ action: 'limitReplies' }])).toEqual([
      { action: 'limitReplies', allow: ['follower'] },
    ]);
    expect(normalizeEffects([{ action: 'limitReplies', allow: [] }])).toEqual([
      { action: 'limitReplies', allow: [] },
    ]);
  });

  it('puts deletion last however it was written', () => {
    const effects = normalizeEffects([
      { action: 'delete' },
      { action: 'disableQuotes' },
    ]);
    expect(effects.map((e) => e.action)).toEqual(['disableQuotes', 'delete']);
  });
});

describe('withEffect', () => {
  it('turns one on without touching the others', () => {
    const next = withEffect([{ action: 'delete' }], 'disableQuotes', true);
    expect(next.map((e) => e.action)).toEqual(['disableQuotes', 'delete']);
  });

  it('turns one off', () => {
    const next = withEffect(
      [{ action: 'disableQuotes' }, { action: 'delete' }],
      'delete',
      false,
    );
    expect(next).toEqual([{ action: 'disableQuotes' }]);
    expect(effectsDelete(next)).toBe(false);
  });

  it('carries what an effect was configured with', () => {
    const next = withEffect([], 'limitReplies', true, {
      allow: ['follower', 'mention'],
    });
    expect(effectFor(next, 'limitReplies').allow).toEqual([
      'follower',
      'mention',
    ]);
  });
});

describe('describeEffects', () => {
  it('says what the rule does, in the composer’s voice', () => {
    expect(describeEffects([])).toBe('Deletes itself');
    expect(
      describeEffects([{ action: 'limitReplies', allow: ['follower'] }]),
    ).toBe('Limits replies to your followers');
    expect(describeEffects([{ action: 'limitReplies', allow: [] }])).toBe(
      'Limits replies to nobody',
    );
  });

  it('reads several as one sentence rather than a list', () => {
    expect(
      describeEffects([{ action: 'disableQuotes' }, { action: 'delete' }]),
    ).toBe('Turns off quotes and deletes itself');
  });

  it('joins the allow rules the way a person would say them', () => {
    expect(describeAllow(['follower', 'following', 'mention'])).toBe(
      'your followers, people you follow and people you mentioned',
    );
  });
});

describe('describeTimer with an effect other than delete', () => {
  it('promises what it will actually do', () => {
    const sentence = describeTimer({
      enabled: true,
      lifespanSeconds: 3600,
      effects: [{ action: 'limitReplies', allow: ['follower'] }],
      conditions: {
        sense: 'onlyIf',
        clauses: [{ metric: 'quotes', op: 'gte', value: 10 }],
      },
    });
    expect(sentence).toBe(
      'Limits replies to your followers 1 hour after it goes up, but only if it has 10 quotes by then. Otherwise nothing happens.',
    );
  });

  it('says nothing happens rather than that the post is kept', () => {
    // "It stays up for good" is only news when something was going to take it
    // down. A gate that does not fire simply does not fire.
    const sentence = describeTimer({
      enabled: true,
      lifespanSeconds: 3600,
      effects: [{ action: 'disableQuotes' }],
      conditions: {
        sense: 'unless',
        clauses: [{ metric: 'likes', op: 'gte', value: 5 }],
      },
    });
    expect(sentence).toMatch(/nothing happens\.$/);
  });
});

describe('actor filters', () => {
  it('reads a filter that tests nothing as no filter', () => {
    expect(normalizeActorFilter({})).toBeNull();
    expect(
      normalizeActorFilter({ notFollowed: false, followersOver: 0 }),
    ).toBeNull();
  });

  it('keeps a filter on quotes and drops it anywhere else', () => {
    // cocoon reads the quoting posts with their authors. A like count is a
    // number with nobody attached, so "likes from strangers" would be a promise
    // the app could not keep.
    const quotes = normalizeConditions({
      clauses: [{ metric: 'quotes', value: 10, from: { notFollowed: true } }],
    });
    expect(quotes.clauses[0].from.notFollowed).toBe(true);
    const likes = normalizeConditions({
      clauses: [{ metric: 'likes', value: 10, from: { notFollowed: true } }],
    });
    expect(likes.clauses[0].from).toBeUndefined();
  });

  it('keeps two quote clauses that ask about different people', () => {
    const c = normalizeConditions({
      clauses: [
        { metric: 'quotes', value: 10, from: { notFollowed: true } },
        { metric: 'quotes', value: 3, from: { followersOver: 10000 } },
      ],
    });
    expect(c.clauses).toHaveLength(2);
    expect(clauseCountKey(c.clauses[0])).not.toBe(clauseCountKey(c.clauses[1]));
  });

  it('still collapses two clauses that ask the same thing', () => {
    const c = normalizeConditions({
      clauses: [
        { metric: 'quotes', value: 10, from: { notFollowed: true } },
        { metric: 'quotes', value: 3, from: { notFollowed: true } },
      ],
    });
    expect(c.clauses).toHaveLength(1);
    expect(c.clauses[0].value).toBe(10);
  });

  it('names who the clause is about in the sentence', () => {
    const c = normalizeConditions({
      clauses: [
        {
          metric: 'quotes',
          value: 10,
          from: { notFollowed: true, followersOver: 10000 },
        },
      ],
    });
    expect(describeFrom(c.clauses[0])).toBe(
      " from people you don't follow or with over 10,000 followers",
    );
    expect(describeClauses(c)).toBe(
      "10 quotes from people you don't follow or with over 10,000 followers",
    );
  });

  it('joins the two tests with "and" under all', () => {
    const c = normalizeConditions({
      clauses: [
        {
          metric: 'quotes',
          value: 10,
          from: { notFollowed: true, followersOver: 10000, match: 'all' },
        },
      ],
    });
    expect(describeFrom(c.clauses[0])).toBe(
      " from people you don't follow and with over 10,000 followers",
    );
  });
});

describe('toWireSpec with effects', () => {
  it('sends what the rule does alongside when and whether', () => {
    const spec = toWireSpec({
      enabled: true,
      lifespanSeconds: 3600,
      effects: [{ action: 'limitReplies', allow: ['follower'] }],
    });
    expect(spec.effects).toEqual([
      { action: 'limitReplies', allow: ['follower'] },
    ]);
  });

  it('always names an action, even when nobody chose one', () => {
    expect(
      toWireSpec({ enabled: true, lifespanSeconds: 3600 }).effects,
    ).toEqual([{ action: 'delete' }]);
  });
});

/*
 * Only an app.bsky.feed.post carries a threadgate and postgate, so a rule that
 * only limits replies or turns off quotes can do nothing to a record without
 * them. Stripping those effects keeps the chip, the summary and what cocoon is
 * sent in agreement.
 */
describe('withoutGateEffects', () => {
  const timer = (effects) =>
    normalizeTimer({ enabled: true, lifespanSeconds: 3600, effects });

  it('disarms a gate-only rule rather than leaving a delete behind', () => {
    // Someone who asked to narrow replies did not ask to lose the post: the
    // fallback is "no timer", never "delete".
    const out = withoutGateEffects(
      timer([{ action: 'limitReplies', allow: ['follower'] }]),
    );
    expect(out.enabled).toBe(false);
    expect(effectsDelete(out.effects) && out.enabled).toBe(false);
  });

  it('disarms a quotes-off rule too', () => {
    expect(
      withoutGateEffects(timer([{ action: 'disableQuotes' }])).enabled,
    ).toBe(false);
  });

  it('keeps a delete the writer did ask for', () => {
    const out = withoutGateEffects(
      timer([
        { action: 'limitReplies', allow: ['follower'] },
        { action: 'delete' },
      ]),
    );
    expect(out.enabled).toBe(true);
    expect(out.effects).toEqual([{ action: 'delete' }]);
  });

  it('leaves a plain timer alone', () => {
    const out = withoutGateEffects(timer([{ action: 'delete' }]));
    expect(out.enabled).toBe(true);
    expect(out.effects).toEqual([{ action: 'delete' }]);
  });

  it('leaves a disarmed timer disarmed', () => {
    expect(withoutGateEffects(normalizeTimer({ enabled: false })).enabled).toBe(
      false,
    );
  });

  it('keeps the conditions and the deadline it was given', () => {
    const src = normalizeTimer({
      enabled: true,
      lifespanSeconds: 7200,
      conditions: {
        mode: 'any',
        sense: 'unless',
        clauses: [{ metric: 'likes', value: 5 }],
      },
      effects: [
        { action: 'limitReplies', allow: ['follower'] },
        { action: 'delete' },
      ],
    });
    const out = withoutGateEffects(src);
    expect(out.lifespanSeconds).toBe(7200);
    expect(out.conditions.clauses).toEqual(src.conditions.clauses);
  });
});

/*
 * A rule this build cannot read must never become a harsher rule. The
 * normalizers are lenient so display paths keep rendering legacy records, but
 * an unrecognised clause is dropped ("delete in an hour unless five likes"
 * becomes "delete in an hour") and an unrecognised effect falls through to
 * delete. cocoon's validateArm guard can't catch it, since the client flattens
 * the rule first. A cached older PWA build meeting newer posting defaults (from
 * the author's PDS) is ordinary.
 */
describe('unreadableRuleParts', () => {
  it('spots a condition about a metric this build does not have', () => {
    const parts = unreadableRuleParts({
      conditions: {
        sense: 'unless',
        clauses: [{ metric: 'bookmarks', op: 'gte', value: 5 }],
      },
    });
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatch(/bookmarks/);
  });

  it('spots an effect this build does not know how to do', () => {
    const parts = unreadableRuleParts({ effects: [{ action: 'archive' }] });
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatch(/archive/);
  });

  it('spots a sense or a logic it cannot read', () => {
    // A silent fallback turns "only if" into "unless", the opposite rule.
    expect(
      unreadableRuleParts({ conditions: { sense: 'whenever', clauses: [] } }),
    ).toHaveLength(1);
    expect(
      unreadableRuleParts({ conditions: { logic: 'most', clauses: [] } }),
    ).toHaveLength(1);
  });

  it('spots a comparison it cannot read', () => {
    expect(
      unreadableRuleParts({
        conditions: { clauses: [{ metric: 'likes', op: 'roughly', value: 5 }] },
      }),
    ).toHaveLength(1);
  });

  it('spots a who-filter it cannot read, which would widen the clause', () => {
    expect(
      unreadableRuleParts({
        conditions: {
          clauses: [
            { metric: 'quotes', op: 'gte', value: 5, from: { match: 'any' } },
          ],
        },
      }),
    ).toHaveLength(1);
  });

  it('says nothing about a rule it understands completely', () => {
    expect(
      unreadableRuleParts({
        conditions: {
          logic: 'any',
          sense: 'unless',
          clauses: [
            { metric: 'likes', op: 'gte', value: 5 },
            {
              metric: 'quotes',
              op: 'gt',
              value: 2,
              from: { match: 'any', notFollowed: true, followersOver: null },
            },
          ],
        },
        effects: [
          { action: 'limitReplies', allow: ['follower'] },
          { action: 'delete' },
        ],
      }),
    ).toEqual([]);
  });

  it('says nothing about a threshold of zero', () => {
    // 0 encodes "not part of the test". cocoon would reject it but never sees
    // one: toWireSpec drops those clauses.
    expect(
      unreadableRuleParts({
        conditions: { clauses: [{ metric: 'likes', op: 'gte', value: 0 }] },
      }),
    ).toEqual([]);
  });

  it('says nothing about the legacy threshold shape, or an absent rule', () => {
    expect(unreadableRuleParts({ conditions: { minLikes: 5 } })).toEqual([]);
    expect(unreadableRuleParts(null)).toEqual([]);
    expect(unreadableRuleParts({})).toEqual([]);
  });
});

describe('readStoredTimer', () => {
  it('disarms rather than seeding an unconditional delete', () => {
    // Lenient normalization drops the clause and leaves an armed timer with
    // nothing to spare the post.
    const stored = {
      enabled: true,
      lifespanSeconds: 3600,
      conditions: {
        sense: 'unless',
        clauses: [{ metric: 'bookmarks', op: 'gte', value: 5 }],
      },
    };
    expect(normalizeTimer(stored).enabled).toBe(true);
    expect(normalizeTimer(stored).conditions.clauses).toEqual([]);
    expect(effectsDelete(normalizeTimer(stored).effects)).toBe(true);

    const { timer, unreadable } = readStoredTimer(stored);
    expect(unreadable).toHaveLength(1);
    expect(timer.enabled).toBe(false);
  });

  it('disarms rather than seeding a delete for an effect it cannot read', () => {
    const stored = {
      enabled: true,
      lifespanSeconds: 3600,
      effects: [{ action: 'archive' }],
    };
    expect(effectsDelete(normalizeTimer(stored).effects)).toBe(true);
    expect(readStoredTimer(stored).timer.enabled).toBe(false);
  });

  it('leaves a rule it understands exactly as it was', () => {
    const stored = {
      enabled: true,
      lifespanSeconds: 3600,
      conditions: {
        sense: 'unless',
        logic: 'any',
        clauses: [{ metric: 'likes', op: 'gte', value: 5 }],
      },
      effects: [{ action: 'delete' }],
    };
    const { timer, unreadable } = readStoredTimer(stored);
    expect(unreadable).toEqual([]);
    expect(timer).toEqual(normalizeTimer(stored));
    expect(timer.enabled).toBe(true);
    expect(timer.conditions.clauses).toHaveLength(1);
  });

  it('leaves a disarmed rule disarmed either way', () => {
    expect(readStoredTimer({ enabled: false }).timer.enabled).toBe(false);
  });
});

describe('withClause and who the count is about', () => {
  const filtered = normalizeConditions({
    clauses: [{ metric: 'quotes', value: 10, from: { notFollowed: true } }],
  });

  it('carries the filter over when only the number or the operator changes', () => {
    const next = withClause(filtered, 'quotes', { op: 'gt', value: 12 });
    expect(next.clauses).toEqual([
      {
        metric: 'quotes',
        op: 'gt',
        value: 12,
        from: { match: 'any', notFollowed: true, followersOver: null },
      },
    ]);
  });

  it('changes it only when the patch names it, and null clears it', () => {
    expect(
      withClause(filtered, 'quotes', { value: 10, from: null }).clauses[0].from,
    ).toBeUndefined();
    expect(
      withClause(filtered, 'quotes', {
        value: 10,
        from: { followersOver: 1000 },
      }).clauses[0].from,
    ).toEqual({ match: 'any', notFollowed: false, followersOver: 1000 });
  });

  it('drops the filter with the clause when the box is emptied', () => {
    expect(withClause(filtered, 'quotes', { value: '' }).clauses).toEqual([]);
  });
});

describe('fitting a timer to the post it is on', () => {
  const onlyIf = {
    enabled: true,
    lifespanSeconds: HOUR,
    conditions: {
      sense: 'onlyIf',
      clauses: [{ metric: 'replies', op: 'gt', value: 5 }],
    },
  };
  const unless = {
    enabled: true,
    lifespanSeconds: HOUR,
    conditions: {
      sense: 'unless',
      clauses: [{ metric: 'likes', value: 5 }],
      onSpare: 'extend',
      maxExtensions: 2,
    },
  };

  it('takes "unless" conditions off a record without counts, leaving the plain timer cocoon would run', () => {
    const t = withoutConditions(unless);
    expect(t.enabled).toBe(true);
    expect(t.conditions.clauses).toEqual([]);
    expect(t.conditions.onSpare).toBe('keep');
    expect(describeTimer(t)).toBe('Deletes itself 1 hour after it goes up.');
    expect(toWireSpec(t).conditions.clauses).toEqual([]);
  });

  it('disarms an "only if" rule rather than turning it into an unconditional delete', () => {
    // "Delete only if five replies" minus its clause would read "delete it",
    // harsher than written. Same call as withoutGateEffects.
    const t = withoutConditions(onlyIf);
    expect(t.enabled).toBe(false);
    expect(toWireSpec(t)).toBeNull();
  });

  it('leaves a timer with no conditions, or no timer, alone', () => {
    expect(
      withoutConditions({ enabled: true, lifespanSeconds: HOUR }).enabled,
    ).toBe(true);
    expect(withoutConditions({ ...onlyIf, enabled: false }).enabled).toBe(
      false,
    );
  });

  it('fits a record without gates or counts', () => {
    const t = fitTimerToPost(
      {
        ...unless,
        effects: [{ action: 'disableQuotes' }, { action: 'delete' }],
      },
      { gatesSupported: false, conditionsSupported: false },
    );
    expect(t.effects).toEqual([{ action: 'delete' }]);
    expect(t.conditions.clauses).toEqual([]);
  });

  it('fits a reply: "limit replies" goes, "turn off quotes" stays', () => {
    const t = fitTimerToPost(
      {
        enabled: true,
        lifespanSeconds: HOUR,
        effects: [
          { action: 'limitReplies', allow: ['follower'] },
          { action: 'disableQuotes' },
        ],
      },
      { replyLimitSupported: false },
    );
    expect(t.enabled).toBe(true);
    expect(t.effects).toEqual([{ action: 'disableQuotes' }]);
    expect(toWireSpec(t).effects).toEqual([{ action: 'disableQuotes' }]);
  });

  it('disarms a reply whose only rule was to limit replies, rather than deleting it', () => {
    const t = fitTimerToPost(
      {
        enabled: true,
        lifespanSeconds: HOUR,
        effects: [{ action: 'limitReplies', allow: ['follower'] }],
      },
      { replyLimitSupported: false },
    );
    expect(t.enabled).toBe(false);
    expect(toWireSpec(t)).toBeNull();
  });

  it('keeps the delete beside a dropped reply limit', () => {
    const t = fitTimerToPost(
      {
        enabled: true,
        effects: [{ action: 'limitReplies' }, { action: 'delete' }],
      },
      { replyLimitSupported: false },
    );
    expect(t.effects).toEqual([{ action: 'delete' }]);
  });

  it('sends no conditions for a record without counts from a default that has them and is on', () => {
    // A stored posting default, read the way the composer seeds every post.
    const stored = {
      defaultOn: true,
      lifespanSeconds: 6 * HOUR,
      conditions: { minLikes: 5 },
      effects: [],
    };
    const { timer } = readStoredTimer({
      ...stored,
      enabled: !!stored.defaultOn,
    });
    const fitted = fitTimerToPost(timer, {
      gatesSupported: false,
      conditionsSupported: false,
    });
    const spec = toWireSpec(fitted);
    expect(spec.conditions.clauses).toEqual([]);
    expect(spec.lifespanSeconds).toBe(6 * HOUR);
  });

  it('changes nothing on an ordinary Bluesky post', () => {
    const t = fitTimerToPost({
      ...onlyIf,
      effects: [{ action: 'limitReplies' }],
    });
    expect(t.enabled).toBe(true);
    expect(t.conditions.clauses).toHaveLength(1);
    expect(t.effects.map((e) => e.action)).toEqual(['limitReplies']);
  });
});

describe('the timer and the session draft', () => {
  it('keeps a timer the writer chose, including one they turned off', async () => {
    const { sessionDraftTimer, restoreSessionDraftTimer } =
      await import('./selfDestruct.js');
    // "No lifespan", then close, then reopen: the choice must come back, not
    // the default it replaced.
    const cleared = sessionDraftTimer(
      { enabled: false, lifespanSeconds: DAY_SECONDS },
      true,
    );
    const back = restoreSessionDraftTimer(cleared);
    expect(back).not.toBeNull();
    expect(back.timer.enabled).toBe(false);
    expect(back.expired).toBe(false);

    const set = sessionDraftTimer(
      { enabled: true, lifespanSeconds: HOUR, conditions: { minLikes: 3 } },
      true,
    );
    expect(restoreSessionDraftTimer(set)).toEqual({
      timer: normalizeTimer({
        enabled: true,
        lifespanSeconds: HOUR,
        conditions: { minLikes: 3 },
      }),
      expired: false,
    });
  });

  it('leaves an untouched timer to the default, and ignores a draft without one', async () => {
    const { sessionDraftTimer, restoreSessionDraftTimer } =
      await import('./selfDestruct.js');
    expect(
      restoreSessionDraftTimer(sessionDraftTimer({ enabled: true }, false)),
    ).toBeNull();
    expect(restoreSessionDraftTimer(undefined)).toBeNull();
    expect(restoreSessionDraftTimer('nonsense')).toBeNull();
  });

  it('survives the trip through a plain object, as the session store holds it', async () => {
    const { sessionDraftTimer, restoreSessionDraftTimer } =
      await import('./selfDestruct.js');
    const at = new Date(Date.now() + 2 * HOUR * 1000).toISOString();
    const saved = JSON.parse(
      JSON.stringify(sessionDraftTimer({ enabled: true, deleteAt: at }, true)),
    );
    expect(restoreSessionDraftTimer(saved).timer.deleteAt).toBe(at);
  });

  it('comes back off, and says so, when its picked time went by while the composer was closed', async () => {
    const {
      sessionDraftTimer,
      restoreSessionDraftTimer,
      EXPIRED_DRAFT_TIMER_NOTE,
    } = await import('./selfDestruct.js');
    const evening = Date.parse('2026-08-27T23:00:00Z');
    const morning = Date.parse('2026-08-28T08:00:00Z');
    const saved = sessionDraftTimer(
      {
        enabled: true,
        lifespanSeconds: DAY_SECONDS,
        deleteAt: new Date(evening).toISOString(),
      },
      true,
    );
    const back = restoreSessionDraftTimer(saved, morning);
    expect(back.expired).toBe(true);
    // Off, and with the pin gone — not a five-minute timer for last night.
    expect(back.timer.enabled).toBe(false);
    expect(back.timer.deleteAt).toBeNull();
    expect(immediateTimerProblem(back.timer, morning)).toBe('');
    expect(EXPIRED_DRAFT_TIMER_NOTE).toMatch(
      /passed while it was closed, so its lifespan is off/,
    );

    // A pin still ahead, or gone by within the minute, comes back as it was.
    expect(restoreSessionDraftTimer(saved, evening - 3600e3).expired).toBe(
      false,
    );
    expect(restoreSessionDraftTimer(saved, evening + 30e3).timer.enabled).toBe(
      true,
    );
  });
});

describe('groupTimers', () => {
  it('splits the list into what is counting down, what gave up, and what has settled', async () => {
    const { groupTimers } = await import('./selfDestruct.js');
    const now = Date.parse('2026-08-27T12:00:00Z');
    const at = (minutes) => new Date(now + minutes * 60 * 1000).toISOString();
    const rows = [
      { id: 'acted', status: 'acted', resolvedAt: at(-60) },
      { id: 'b', status: 'armed', checkAt: at(30) },
      { id: 'failed', status: 'failed', checkAt: at(-5) },
      { id: 'a', status: 'checking', checkAt: at(-1) },
    ];
    const groups = groupTimers(rows);
    expect(
      groups.map((g) => [g.key, g.title, g.rows.map((r) => r.id)]),
    ).toEqual([
      ['live', 'Counting down', ['a', 'b']],
      ['failed', 'Gave up, post still up', ['failed']],
      ['settled', 'Changed this week', ['acted']],
    ]);
    expect(groupTimers(rows, { history: true }).at(-1).title).toBe('Settled');
  });

  it('drops empty groups', async () => {
    const { groupTimers } = await import('./selfDestruct.js');
    expect(groupTimers([])).toEqual([]);
    expect(
      groupTimers([
        { id: 'x', status: 'armed', checkAt: '2026-08-27T12:00:00Z' },
      ]).map((g) => g.key),
    ).toEqual(['live']);
  });
});

describe('a picked time that has long passed', () => {
  const now = Date.parse('2026-08-28T08:00:00Z');
  const at = (secondsFromNow) => ({
    enabled: true,
    lifespanSeconds: 24 * HOUR,
    deleteAt: new Date(now + secondsFromNow * 1000).toISOString(),
  });

  it('refuses the post before it is written, rather than arming a five-minute timer', () => {
    // Ten hours ago: a composer left open overnight, or a session draft.
    expect(pinnedDeadlineStatus(at(-10 * HOUR), now)).toBe('passed');
    expect(immediateTimerProblem(at(-10 * HOUR), now)).toBe(
      'The delete time you picked for this post has already passed. Pick a new time or a length in its lifespan, then post again.',
    );
  });

  it('reads one that passed within the minute as "as soon as allowed", like cocoon does', () => {
    expect(pinnedDeadlineStatus(at(-30), now)).toBe('tooSoon');
    expect(immediateTimerProblem(at(-30), now)).toBe('');
    expect(immediateTimerToSend(at(-30), {}, now)).toEqual(
      expect.objectContaining({ adjusted: 'floor' }),
    );
    expect(immediateTimerToSend(at(-30), {}, now).spec).not.toHaveProperty(
      'deleteAt',
    );
    expect(immediateTimerToSend(at(-30), {}, now).spec.lifespanSeconds).toBe(
      MIN_LIFESPAN_SECONDS,
    );
  });

  it('has no problem with a pin still ahead, a plain length, or no timer', () => {
    expect(immediateTimerProblem(at(HOUR), now)).toBe('');
    expect(
      immediateTimerProblem({ enabled: true, lifespanSeconds: HOUR }, now),
    ).toBe('');
    expect(
      immediateTimerProblem({ ...at(-10 * HOUR), enabled: false }, now),
    ).toBe('');
  });
});

describe('what each publish path sends', () => {
  const BLUESKY = {
    gatesSupported: true,
    conditionsSupported: true,
    replyLimitSupported: true,
  };
  const NO_GATES = {
    gatesSupported: false,
    conditionsSupported: false,
    replyLimitSupported: true,
  };
  const rule = {
    enabled: true,
    lifespanSeconds: HOUR,
    conditions: { sense: 'unless', clauses: [{ metric: 'likes', value: 5 }] },
    effects: [{ action: 'disableQuotes' }, { action: 'delete' }],
  };

  it('fits an immediate publish to the post it is on', () => {
    expect(immediateTimerToSend(rule, BLUESKY).spec).toEqual(
      expect.objectContaining({
        conditions: expect.objectContaining({
          clauses: [{ metric: 'likes', op: 'gte', value: 5 }],
        }),
        effects: [{ action: 'disableQuotes' }, { action: 'delete' }],
      }),
    );
    const bare = immediateTimerToSend(rule, NO_GATES).spec;
    expect(bare.conditions.clauses).toEqual([]);
    expect(bare.effects).toEqual([{ action: 'delete' }]);
  });

  it('sends nothing where cocoon cannot hold a timer', () => {
    expect(
      immediateTimerToSend(rule, { ...BLUESKY, available: false }).spec,
    ).toBeNull();
    expect(
      scheduledTimerToSend(
        rule,
        { fit: { available: false }, bluesky: true },
        Date.now() + DAY_SECONDS * 1000,
      ).spec,
    ).toBeNull();
  });

  it('keeps a pin on a scheduled post that lands after it, measured from the publish', () => {
    const when = Date.parse('2026-09-03T18:00:00Z');
    const pinned = {
      ...rule,
      deleteAt: new Date(when + 5 * HOUR * 1000).toISOString(),
    };
    const { problem, spec } = scheduledTimerToSend(
      pinned,
      { bluesky: true },
      when,
    );
    expect(problem).toBe('');
    expect(spec.deleteAt).toBe(pinned.deleteAt);
    expect(spec.lifespanSeconds).toBe(5 * HOUR);
  });

  it('refuses a scheduled pin that lands before the post, and sends nothing', () => {
    const when = Date.parse('2026-09-03T18:00:00Z');
    const early = {
      ...rule,
      deleteAt: new Date(when - HOUR * 1000).toISOString(),
    };
    const { problem, spec } = scheduledTimerToSend(
      early,
      { bluesky: true },
      when,
    );
    expect(problem).toMatch(/Pick a later delete time/);
    expect(spec).toBeNull();
  });

  it('is never broader than the screen: a scheduled post sends what the composer shows', () => {
    const when = Date.parse('2026-09-03T18:00:00Z');
    const { spec } = scheduledTimerToSend(rule, { fit: NO_GATES }, when);
    expect(spec.conditions.clauses).toEqual([]);
    expect(spec.effects).toEqual([{ action: 'delete' }]);
    expect(spec).toEqual(immediateTimerToSend(rule, NO_GATES, when).spec);
  });

  it('sends the whole rule for a scheduled post with nothing fitted away', () => {
    const when = Date.parse('2026-09-03T18:00:00Z');
    const fit = composerTimerFit({});
    const { spec } = scheduledTimerToSend(rule, { fit }, when);
    expect(spec.conditions.clauses).toEqual([
      { metric: 'likes', op: 'gte', value: 5 },
    ]);
    expect(spec.effects).toEqual([
      { action: 'disableQuotes' },
      { action: 'delete' },
    ]);
  });
});

describe('moving a scheduled row past its pinned delete time', () => {
  const row = (deleteAt) => ({
    id: 'r',
    payload: {
      selfDestruct: {
        lifespanSeconds: HOUR,
        deleteAt,
        conditions: {},
        effects: [],
      },
    },
  });

  it('is a problem only for a row with a pin it would pass', () => {
    const pin = '2026-09-03T22:00:00.000Z';
    expect(scheduledRowTimerProblem(row(pin), '2026-09-03T18:00:00.000Z')).toBe(
      '',
    );
    expect(
      scheduledRowTimerProblem(row(pin), '2026-09-03T21:58:00.000Z'),
    ).toMatch(/less than 5 minutes after it would go out/);
    expect(
      scheduledRowTimerProblem(row(null), '2026-09-09T18:00:00.000Z'),
    ).toBe('');
    expect(
      scheduledRowTimerProblem(
        { id: 'plain', payload: {} },
        '2026-09-09T18:00:00.000Z',
      ),
    ).toBe('');
  });
});

describe('keeping the parts of a rule a post could not show', () => {
  const NO_GATES = {
    gatesSupported: false,
    conditionsSupported: false,
    replyLimitSupported: true,
  };
  const REPLY = {
    gatesSupported: true,
    conditionsSupported: true,
    replyLimitSupported: false,
  };

  it('carries hidden conditions and gates over an edit that never saw them', () => {
    const stored = normalizeTimer({
      enabled: true,
      lifespanSeconds: HOUR,
      conditions: { clauses: [{ metric: 'likes', value: 5 }] },
      effects: [{ action: 'disableQuotes' }, { action: 'delete' }],
    });
    const edited = {
      ...fitTimerToPost(stored, NO_GATES),
      lifespanSeconds: 6 * HOUR,
    };
    const kept = keepHiddenRuleParts(edited, stored, NO_GATES);
    expect(kept.lifespanSeconds).toBe(6 * HOUR);
    expect(kept.conditions.clauses).toHaveLength(1);
    expect(kept.effects.map((e) => e.action)).toEqual([
      'disableQuotes',
      'delete',
    ]);
    // And this post still gets exactly what was confirmed on it.
    expect(
      sameTimer(
        fitTimerToPost(kept, NO_GATES),
        fitTimerToPost(edited, NO_GATES),
      ),
    ).toBe(true);
  });

  it('drops what would change the timer confirmed here', () => {
    const stored = normalizeTimer({
      enabled: true,
      conditions: {
        sense: 'onlyIf',
        clauses: [{ metric: 'replies', value: 5 }],
      },
    });
    const edited = { enabled: true, lifespanSeconds: 2 * HOUR };
    expect(
      keepHiddenRuleParts(edited, stored, NO_GATES).conditions.clauses,
    ).toEqual([]);
  });

  it('carries nothing from a rule that was never armed', () => {
    const stored = normalizeTimer({
      enabled: false,
      conditions: { clauses: [{ metric: 'likes', value: 5 }] },
    });
    expect(
      keepHiddenRuleParts({ enabled: true }, stored, NO_GATES).conditions
        .clauses,
    ).toEqual([]);
  });

  it('keeps a reply limit across an edit made on a reply', () => {
    const stored = normalizeTimer({
      enabled: true,
      effects: [
        { action: 'limitReplies', allow: ['follower'] },
        { action: 'delete' },
      ],
    });
    const kept = keepHiddenRuleParts(
      {
        enabled: true,
        lifespanSeconds: 3 * HOUR,
        effects: [{ action: 'delete' }],
      },
      stored,
      REPLY,
    );
    expect(kept.effects.map((e) => e.action)).toEqual([
      'limitReplies',
      'delete',
    ]);
  });
});

describe('saying what a post took out of the rule', () => {
  it('says nothing when the rule applies as written', () => {
    expect(
      describeFitChange(
        {
          enabled: true,
          conditions: { clauses: [{ metric: 'likes', value: 5 }] },
        },
        {},
      ),
    ).toBe('');
    expect(
      describeFitChange(
        {
          enabled: false,
          conditions: { clauses: [{ metric: 'likes', value: 5 }] },
        },
        { conditionsSupported: false },
      ),
    ).toBe('');
  });

  it('says why a rule has no lifespan here, and that it is kept', () => {
    const note = describeFitChange(
      { enabled: true, effects: [{ action: 'limitReplies' }] },
      { gatesSupported: false, conditionsSupported: false },
    );
    expect(note).toMatch(
      /only changes reply and quote settings, which this post can’t have/,
    );
    expect(note).toMatch(/Your rule is kept as you set it/);
    expect(
      describeFitChange(
        { enabled: true, effects: [{ action: 'limitReplies' }] },
        { replyLimitSupported: false },
      ),
    ).toMatch(/only limits replies, which a reply can’t do/);
  });
});

describe('the timer on a draft save', () => {
  const DEFAULT_ON = normalizeTimer({
    enabled: true,
    lifespanSeconds: DAY_SECONDS,
  });
  const DEFAULT_OFF = normalizeTimer({
    enabled: false,
    lifespanSeconds: DAY_SECONDS,
  });

  it('says the default applies when "No lifespan" was chosen over a default that is on', () => {
    expect(
      draftTimerNote({ ...DEFAULT_ON, enabled: false }, true, DEFAULT_ON),
    ).toBe(
      'Lifespan settings aren’t kept with drafts, so the default applies when you open it.',
    );
  });

  it("says a lifespan of the writer's own is not kept", () => {
    expect(
      draftTimerNote(
        { enabled: true, lifespanSeconds: HOUR },
        true,
        DEFAULT_OFF,
      ),
    ).toBe('Its lifespan isn’t kept with drafts.');
    expect(
      draftTimerNote(
        { enabled: true, lifespanSeconds: HOUR },
        true,
        DEFAULT_ON,
      ),
    ).toBe(
      'Lifespan settings aren’t kept with drafts, so the default applies when you open it.',
    );
  });

  it('says nothing when the writer left the default alone, or chose what it already is', () => {
    expect(draftTimerNote(DEFAULT_ON, false, DEFAULT_ON)).toBe('');
    expect(draftTimerNote(DEFAULT_ON, true, DEFAULT_ON)).toBe('');
    expect(draftTimerNote({ ...DEFAULT_OFF }, true, DEFAULT_OFF)).toBe('');
  });
});

describe('the posting default as a rule', () => {
  it('is a length, armed only when asked, and never a pinned instant', () => {
    const rule = defaultRuleFromSettings({
      defaultOn: true,
      lifespanSeconds: HOUR,
      deleteAt: '2026-09-01T00:00:00Z',
    });
    expect(rule.enabled).toBe(true);
    expect(rule.deleteAt).toBeNull();
    expect(defaultRuleFromSettings({ lifespanSeconds: HOUR }).enabled).toBe(
      false,
    );
    expect(defaultRuleFromSettings(null).enabled).toBe(false);
  });

  it('reads the posting settings’ lifespan, whose `enabled` is the default switch', () => {
    const on = defaultRuleFromSettings({
      enabled: true,
      lifespanSeconds: 6 * HOUR,
      deleteAt: null,
    });
    expect(on.enabled).toBe(true);
    expect(on.lifespanSeconds).toBe(6 * HOUR);
    expect(
      defaultRuleFromSettings({ enabled: false, lifespanSeconds: HOUR })
        .enabled,
    ).toBe(false);
    // `enabled` wins over the other name when both are present.
    expect(
      defaultRuleFromSettings({ enabled: false, defaultOn: true }).enabled,
    ).toBe(false);
  });

  it('disarms a stored default with a part this build can’t read', () => {
    const rule = defaultRuleFromSettings({
      enabled: true,
      lifespanSeconds: HOUR,
      conditions: { clauses: [{ metric: 'bookmarks', value: 3 }] },
    });
    expect(rule.enabled).toBe(false);
  });
});

describe('what a post in the composer can carry', () => {
  it('can carry nothing on an edit, or where cocoon cannot hold a timer', () => {
    expect(composerTimerFit({}).available).toBe(true);
    expect(composerTimerFit({ editingExisting: true }).available).toBe(false);
    expect(composerTimerFit({ unavailable: true }).available).toBe(false);
  });

  it('so a stale time picked earlier asks nothing of a post that can’t carry a timer, and sends nothing', () => {
    const stale = {
      enabled: true,
      deleteAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    };
    const off = composerTimerFit({ unavailable: true });
    expect(immediateTimerProblem(fitTimerToPost(stale, off))).toBe('');
    expect(immediateTimerToSend(stale, off).spec).toBeNull();
    expect(
      immediateTimerProblem(fitTimerToPost(stale, composerTimerFit({}))),
    ).toMatch(/already passed/);
  });

  it('keeps gates and conditions on every post, and drops the reply limit for a reply', () => {
    expect(composerTimerFit({})).toEqual({
      gatesSupported: true,
      conditionsSupported: true,
      replyLimitSupported: true,
      available: true,
    });
    expect(composerTimerFit({ reply: true }).replyLimitSupported).toBe(false);
  });
});

describe('posts waiting to go out with a timer', () => {
  const row = (
    id,
    status,
    scheduledFor,
    selfDestruct = { lifespanSeconds: 3600 },
  ) => ({
    id,
    status,
    scheduledFor,
    payload: { posts: [], ...(selfDestruct ? { selfDestruct } : {}) },
  });

  it('keeps pending and publishing posts that carry a lifespan, soonest first', () => {
    const rows = [
      row('later', 'pending', '2026-10-10T12:00:00Z'),
      row('none', 'pending', '2026-10-09T12:00:00Z', null),
      row('failed', 'failed', '2026-10-09T13:00:00Z'),
      row('out', 'publishing', '2026-10-09T09:00:00Z'),
      row('sooner', 'pending', '2026-10-09T10:00:00Z'),
    ];
    expect(waitingTimerRows(rows).map((r) => r.id)).toEqual([
      'out',
      'sooner',
      'later',
    ]);
  });

  it('takes nothing for nothing', () => {
    expect(waitingTimerRows(null)).toEqual([]);
    expect(waitingTimerRows(undefined)).toEqual([]);
  });
});

describe("an account's timer slots", () => {
  const PLAIN = { lifespanSeconds: 3600 };
  const CONDITIONAL = {
    lifespanSeconds: 3600,
    conditions: {
      sense: 'unless',
      clauses: [{ metric: 'replies', op: 'gte', value: 1 }],
    },
  };
  const GATE_ONLY = {
    lifespanSeconds: 3600,
    effects: [{ action: 'disableQuotes' }],
  };

  it('sorts a timer the way cocoon does: reading counts, or doing anything but delete, is conditional', () => {
    expect(timerBucket(PLAIN)).toBe('plain');
    expect(timerBucket({ ...PLAIN, effects: [{ action: 'delete' }] })).toBe(
      'plain',
    );
    expect(timerBucket(CONDITIONAL)).toBe('conditional');
    expect(timerBucket(GATE_ONLY)).toBe('conditional');
    // Gating as well as deleting is still more than a plain delete.
    expect(
      timerBucket({
        ...PLAIN,
        effects: [{ action: 'delete' }, { action: 'disableQuotes' }],
      }),
    ).toBe('conditional');
  });

  it('counts live timers and scheduled posts waiting with one, and nothing settled', () => {
    const usage = timerUsage({
      liveRows: [
        { status: 'armed', ...PLAIN },
        { status: 'checking', ...GATE_ONLY },
        { status: 'deleted', ...PLAIN },
        { status: 'acted', ...CONDITIONAL },
      ],
      scheduledRows: [
        { id: 's1', status: 'pending', payload: { selfDestruct: CONDITIONAL } },
        { id: 's2', status: 'failed', payload: { selfDestruct: PLAIN } },
        { id: 's3', status: 'pending', payload: {} },
      ],
    });
    expect(usage).toEqual({ plain: 1, conditional: 2 });
    expect(
      timerUsage({
        scheduledRows: [
          { id: 's1', status: 'pending', payload: { selfDestruct: PLAIN } },
        ],
        exceptScheduledId: 's1',
      }),
    ).toEqual({ plain: 0, conditional: 0 });
  });

  it('says so only when the slot is taken, and not where there is no limit', () => {
    expect(
      timerSlotProblem({
        bucket: 'plain',
        limit: 1,
        usage: { plain: 0, conditional: 1 },
      }),
    ).toBe('');
    expect(
      timerSlotProblem({
        bucket: 'plain',
        limit: 1,
        usage: { plain: 1, conditional: 0 },
      }),
    ).toBe(
      'This account can keep one plain timer at a time, counting scheduled posts, and it’s in use. Limits are shared with Anisota.',
    );
    expect(
      timerSlotProblem({
        bucket: 'conditional',
        limit: null,
        usage: { plain: 9, conditional: 9 },
      }),
    ).toBe('');
    // An unread count lets cocoon decide.
    expect(timerSlotProblem({ bucket: 'plain', limit: 1, usage: null })).toBe(
      '',
    );
    expect(timerSlotSentence('conditional', 1)).toMatch(
      /^This account can keep one conditional timer at a time/,
    );
    expect(timerSlotSentence('plain', 3)).toMatch(
      /^This account can keep 3 plain timers at a time, .* all of them are in use\./,
    );
  });

  it('names no offer: the limit is stated, never sold', () => {
    const sentence = timerSlotSentence('plain', 1);
    expect(sentence).not.toMatch(/member|upgrade|free account/i);
  });

  it('reads a cocoon refusal naming a timer slot, and nothing else', () => {
    expect(
      timerSlotRefusal({
        code: 'QUOTA_EXCEEDED',
        feature: 'conditionalTimers',
        limit: 1,
      }),
    ).toMatch(/^This account can keep one conditional timer at a time/);
    // The schedule endpoints don't send `limit`; the smallest cap is one.
    expect(
      timerSlotRefusal({ code: 'QUOTA_EXCEEDED', feature: 'postTimers' }),
    ).toMatch(/^This account can keep one plain timer at a time/);
    expect(
      timerSlotRefusal({ code: 'QUOTA_EXCEEDED', feature: 'scheduledPosts' }),
    ).toBe('');
    expect(timerSlotRefusal(null)).toBe('');
  });
});

describe('room for a timer under the account limits', () => {
  const PLAIN_RULE = { enabled: true, lifespanSeconds: 3600 };
  const CONDITIONAL_RULE = {
    enabled: true,
    lifespanSeconds: 3600,
    conditions: { clauses: [{ metric: 'likes', value: 3 }] },
  };
  const limits = (usage, limit = 1) => ({
    features: {
      postTimers: { limit },
      conditionalTimers: { limit },
      scheduledPosts: { limit: 3 },
    },
    usage,
  });

  it('maps each bucket to the feature cocoon counts', () => {
    expect(TIMER_BUCKET_FEATURE).toEqual({
      plain: 'postTimers',
      conditional: 'conditionalTimers',
    });
  });

  it('finds room when the matching bucket has some', () => {
    expect(
      timerRoomProblem(
        PLAIN_RULE,
        limits({ postTimers: 0, conditionalTimers: 1 }),
      ),
    ).toBe('');
    expect(
      timerRoomProblem(
        CONDITIONAL_RULE,
        limits({ postTimers: 1, conditionalTimers: 0 }),
      ),
    ).toBe('');
  });

  it('says why when the matching bucket is full', () => {
    expect(
      timerRoomProblem(
        PLAIN_RULE,
        limits({ postTimers: 1, conditionalTimers: 0 }),
      ),
    ).toMatch(/one plain timer/);
    expect(
      timerRoomProblem(
        CONDITIONAL_RULE,
        limits({ postTimers: 0, conditionalTimers: 1 }),
      ),
    ).toMatch(/one conditional timer/);
  });

  it('lets a rewrite keep the slot its row already holds', () => {
    const held = {
      lifespanSeconds: 3600,
      conditions: {},
      effects: [{ action: 'delete' }],
    };
    expect(
      timerRoomProblem(
        PLAIN_RULE,
        limits({ postTimers: 1, conditionalTimers: 0 }),
        { holds: held },
      ),
    ).toBe('');
    // A held slot in the other bucket frees nothing here.
    expect(
      timerRoomProblem(
        CONDITIONAL_RULE,
        limits({ postTimers: 1, conditionalTimers: 1 }),
        { holds: held },
      ),
    ).toMatch(/conditional/);
  });

  it('leaves it to cocoon when the limits are unknown, unlimited or unread', () => {
    expect(timerRoomProblem(PLAIN_RULE, null)).toBe('');
    expect(timerRoomProblem(PLAIN_RULE, limits({ postTimers: 5 }, null))).toBe(
      '',
    );
    expect(timerRoomProblem(PLAIN_RULE, limits({}))).toBe('');
  });

  it('asks nothing of a timer that is off', () => {
    expect(
      timerRoomProblem(
        { ...PLAIN_RULE, enabled: false },
        limits({ postTimers: 9 }),
      ),
    ).toBe('');
  });
});
