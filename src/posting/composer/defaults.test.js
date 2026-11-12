import { describe, expect, it } from 'vitest';
import {
  defaultTimerFor,
  gatesSourceLine,
  gatesSummary,
  TIMER_NEEDS_SERVER,
  TIMER_LIMITS_UNKNOWN,
} from './defaults.js';
import { defaultPostingSettings } from '../settings.js';

const on = () => {
  const s = defaultPostingSettings({ language: 'en' });
  return {
    ...s,
    lifespan: { ...s.lifespan, enabled: true, lifespanSeconds: 3600 },
  };
};
const limits = (used, limit = 1) => ({
  policy: 'membership',
  features: {
    postTimers: { limit },
    conditionalTimers: { limit },
    scheduledPosts: { limit: 3 },
  },
  usage: { postTimers: used, conditionalTimers: 0, scheduledPosts: 0 },
});

describe('defaultTimerFor', () => {
  it('is off when the account’s default is off', () => {
    const r = defaultTimerFor(defaultPostingSettings({ language: 'en' }), {
      canSchedule: true,
      limitsStatus: 'ready',
      limits: limits(0),
    });
    expect(r.rule.enabled).toBe(false);
    expect(r.note).toBe('');
  });

  it('arms when there’s a free timer', () => {
    const r = defaultTimerFor(on(), {
      canSchedule: true,
      limitsStatus: 'ready',
      limits: limits(0),
    });
    expect(r.rule.enabled).toBe(true);
    expect(r.rule.lifespanSeconds).toBe(3600);
  });

  it('stays off, saying why, when the slot is taken', () => {
    const r = defaultTimerFor(on(), {
      canSchedule: true,
      limitsStatus: 'ready',
      limits: limits(1),
    });
    expect(r.rule.enabled).toBe(false);
    expect(r.note).toMatch(/one/i);
  });

  it('stays off while the limits are read, and when they can’t be', () => {
    expect(
      defaultTimerFor(on(), { canSchedule: true, limitsStatus: 'loading' }),
    ).toMatchObject({ pending: true, rule: { enabled: false } });
    expect(
      defaultTimerFor(on(), { canSchedule: true, limitsStatus: 'error' }).note,
    ).toBe(TIMER_LIMITS_UNKNOWN);
  });

  it('is off without a long session', () => {
    expect(
      defaultTimerFor(on(), {
        canSchedule: false,
        limitsStatus: 'ready',
        limits: limits(0),
      }).note,
    ).toBe(TIMER_NEEDS_SERVER);
  });

  it('arms with no limit at all', () => {
    const flat = {
      policy: 'flat',
      features: { postTimers: { limit: null } },
      usage: { postTimers: 5 },
    };
    expect(
      defaultTimerFor(on(), {
        canSchedule: true,
        limitsStatus: 'ready',
        limits: flat,
      }).rule.enabled,
    ).toBe(true);
  });
});

describe('gatesSourceLine', () => {
  it('says where the settings came from', () => {
    expect(gatesSourceLine({ source: 'bluesky' })).toBe(
      'From your Bluesky settings.',
    );
    expect(gatesSourceLine({ source: 'settings' })).toMatch(/Virga/);
    expect(gatesSourceLine({ source: 'everyone', notice: 'n' })).toBe('n');
    expect(gatesSourceLine({ custom: true })).toBe('Set for this post.');
    expect(gatesSourceLine({}, { reply: true })).toMatch(/thread/);
  });
});

describe('gatesSummary', () => {
  it('reads the gates as a short line', () => {
    expect(gatesSummary({ reply: null, quotes: true })).toBe(
      'Anyone can reply',
    );
    expect(gatesSummary({ reply: [], quotes: false })).toBe(
      'Nobody can reply · No quotes',
    );
    expect(
      gatesSummary({
        reply: [
          { type: 'following' },
          { type: 'mention' },
          { type: 'list', list: 'at://l' },
        ],
        quotes: true,
      }),
    ).toBe('Replies: people you follow, people you mention, one list');
  });
});
