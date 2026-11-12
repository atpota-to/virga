/*
 * The reply-settings side of the one-rule-per-post timer.
 *
 * The thread-restrictions modal schedules gate changes on the SAME timer the
 * Lifespan editor edits, but the gestures read differently from that side:
 * arming from the gates never means deleting, and clearing the last effect
 * disarms the rule instead of falling back to deletion.
 */

import { describe, it, expect } from 'vitest';
import {
  describeTimer,
  normalizeTimer,
  scheduledGateChange,
  withScheduledGateChange,
  withScheduledGateLifespan,
} from './selfDestruct.js';

const off = () => normalizeTimer({ enabled: false });

describe('withScheduledGateChange', () => {
  it('arms a gate-only change from nothing — never a delete', () => {
    const t = withScheduledGateChange(off(), 'limitReplies', true);
    expect(t.enabled).toBe(true);
    expect(t.effects).toEqual([
      { action: 'limitReplies', allow: ['follower'] },
    ]);
  });

  it('ignores the stale delete a disabled timer carries by default', () => {
    const t = withScheduledGateChange(
      normalizeTimer({ enabled: false, effects: [{ action: 'delete' }] }),
      'disableQuotes',
      true,
    );
    expect(t.effects.map((e) => e.action)).toEqual(['disableQuotes']);
  });

  it('arms from a disarmed timer without the conditions it was still carrying', () => {
    // A disarmed timer can still carry a rule (the posting default, or a
    // cleared lifespan). The reply-settings section shows none of it, so arming
    // a gate must not inherit its conditions or extension.
    const stale = normalizeTimer({
      enabled: false,
      lifespanSeconds: 3600,
      deleteAt: new Date(Date.now() + 3 * 3600 * 1000).toISOString(),
      conditions: {
        sense: 'onlyIf',
        clauses: [{ metric: 'replies', op: 'gt', value: 5 }],
        onSpare: 'extend',
        maxExtensions: 3,
      },
    });
    const t = withScheduledGateChange(stale, 'limitReplies', true);
    expect(t.enabled).toBe(true);
    expect(t.conditions.clauses).toEqual([]);
    expect(t.conditions.sense).toBe('unless');
    expect(t.conditions.onSpare).toBe('keep');
    expect(t.conditions.maxExtensions).toBe(0);
    // The section offers a length, and a pin left behind would win over it.
    expect(t.deleteAt).toBeNull();
    expect(t.lifespanSeconds).toBe(3600);
    expect(describeTimer(t)).toBe(
      'Limits replies to your followers 1 hour after it goes up.',
    );
  });

  it("leaves a live rule's conditions alone when a gate is added to it", () => {
    const live = normalizeTimer({
      enabled: true,
      conditions: { clauses: [{ metric: 'likes', value: 5 }] },
      effects: [{ action: 'delete' }],
    });
    const t = withScheduledGateChange(live, 'disableQuotes', true);
    expect(t.conditions.clauses).toEqual([
      { metric: 'likes', op: 'gte', value: 5 },
    ]);
  });

  it('adds a gate beside a live self-destruct without touching it', () => {
    const armed = normalizeTimer({
      enabled: true,
      effects: [{ action: 'delete' }],
    });
    const t = withScheduledGateChange(armed, 'limitReplies', true);
    expect(t.effects.map((e) => e.action)).toEqual(['limitReplies', 'delete']);
  });

  it('disarms the rule when the last effect goes, instead of falling back to delete', () => {
    const gated = normalizeTimer({
      enabled: true,
      effects: [{ action: 'disableQuotes' }],
    });
    const t = withScheduledGateChange(gated, 'disableQuotes', false);
    expect(t.enabled).toBe(false);
  });

  it('keeps a live delete when only the gate is removed', () => {
    const both = normalizeTimer({
      enabled: true,
      effects: [{ action: 'limitReplies' }, { action: 'delete' }],
    });
    const t = withScheduledGateChange(both, 'limitReplies', false);
    expect(t.enabled).toBe(true);
    expect(t.effects).toEqual([{ action: 'delete' }]);
  });

  it('refuses actions that are not gates', () => {
    const t = withScheduledGateChange(off(), 'delete', true);
    expect(t.enabled).toBe(false);
  });
});

describe('withScheduledGateLifespan', () => {
  it('sets the duration and drops a pinned instant that would quietly win over it', () => {
    const pinned = normalizeTimer({
      enabled: true,
      lifespanSeconds: 3600,
      deleteAt: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
      effects: [{ action: 'limitReplies' }],
    });
    const t = withScheduledGateLifespan(pinned, 6 * 3600);
    expect(t.lifespanSeconds).toBe(6 * 3600);
    expect(t.deleteAt).toBeNull();
  });
});

describe('scheduledGateChange', () => {
  it('reads nothing from a disarmed timer, whatever effects it stores', () => {
    expect(scheduledGateChange(off())).toEqual({
      limitReplies: null,
      disableQuotes: false,
    });
  });

  it('reads the gate half of a live rule', () => {
    const t = normalizeTimer({
      enabled: true,
      effects: [{ action: 'limitReplies', allow: [] }, { action: 'delete' }],
    });
    const read = scheduledGateChange(t);
    expect(read.limitReplies).toEqual({ action: 'limitReplies', allow: [] });
    expect(read.disableQuotes).toBe(false);
  });
});

// List allow entries

describe('allow entries with lists', () => {
  const moots = 'at://did:plc:someone/app.bsky.graph.list/3kmoots';

  it('normalizes list entries with their display names, deduped by URI', async () => {
    const { normalizeEffect } = await import('./selfDestruct.js');
    const effect = normalizeEffect({
      action: 'limitReplies',
      allow: [
        'follower',
        { list: moots, name: 'Moots' },
        { list: moots },
        { list: 'nope' },
        'strangers',
      ],
    });
    expect(effect.allow).toEqual(['follower', { list: moots, name: 'Moots' }]);
  });

  it('caps the allow list at what a threadgate can carry', async () => {
    const { normalizeEffect, MAX_ALLOW_RULES } =
      await import('./selfDestruct.js');
    const many = Array.from({ length: 8 }, (_, i) => ({
      list: `at://did:plc:x/app.bsky.graph.list/3k${i}`,
    }));
    const effect = normalizeEffect({ action: 'limitReplies', allow: many });
    expect(effect.allow).toHaveLength(MAX_ALLOW_RULES);
  });

  it('describes lists by name, or honestly when the name is gone', async () => {
    const { describeAllow } = await import('./selfDestruct.js');
    expect(describeAllow(['follower', { list: moots, name: 'Moots' }])).toBe(
      'your followers and people in Moots',
    );
    expect(describeAllow([{ list: moots }])).toBe('people in a list you chose');
  });

  it('toWireSpec sends the URI and keeps the display name to itself', async () => {
    const { toWireSpec } = await import('./selfDestruct.js');
    const spec = toWireSpec({
      enabled: true,
      lifespanSeconds: 3600,
      effects: [
        { action: 'limitReplies', allow: [{ list: moots, name: 'Moots' }] },
      ],
    });
    expect(spec.effects).toEqual([
      { action: 'limitReplies', allow: [{ list: moots }] },
    ]);
  });
});
