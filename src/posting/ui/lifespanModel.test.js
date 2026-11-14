import { describe, expect, it } from 'vitest';
import {
  curateLists,
  editorNotes,
  firstActAt,
  lengthChoice,
  pinBounds,
  timerStart,
  toggleAllow,
  toggleEffect,
  withAllow,
  withConditions,
  withLength,
  withMetric,
  withPin,
  withQuoteFilter,
} from './lifespanModel.js';
import { normalizeLimits } from '../schedule/scheduleService.js';
import { normalizeTimer } from '../timers/selfDestruct.js';

const NOW = Date.parse('2026-11-12T12:00:00Z');
const on = (extra = {}) =>
  normalizeTimer({ enabled: true, lifespanSeconds: 3600, ...extra });

describe('lengths', () => {
  it('names the pressed length', () => {
    expect(lengthChoice(on())).toBe('3600');
    expect(lengthChoice(on({ lifespanSeconds: 5400 }))).toBe('custom');
    expect(lengthChoice(on({ deleteAt: '2026-11-13T12:00:00Z' }))).toBe(
      'exact',
    );
  });

  it('keeps the length behind a pin, and a length drops the pin', () => {
    const pinned = withPin(
      on({ lifespanSeconds: 7200 }),
      '2026-11-13T12:00:00Z',
    );
    expect(pinned).toMatchObject({
      deleteAt: '2026-11-13T12:00:00.000Z',
      lifespanSeconds: 7200,
    });
    expect(withLength(pinned, 300)).toMatchObject({
      deleteAt: null,
      lifespanSeconds: 300,
    });
    expect(withPin(pinned, null).lifespanSeconds).toBe(7200);
  });

  it('gives the exact-time bounds', () => {
    const b = pinBounds(NOW);
    expect(Date.parse(b.min) - NOW).toBe(6 * 60_000);
    expect(Date.parse(b.max) - NOW).toBe(30 * 86_400_000);
  });
});

describe('what happens', () => {
  it('replaces a lone delete with a gate, and falls back to delete when the last effect goes', () => {
    const gated = toggleEffect(on(), 'disableQuotes');
    expect(gated.effects).toEqual([{ action: 'disableQuotes' }]);
    const both = toggleEffect(gated, 'delete');
    expect(both.effects).toEqual([
      { action: 'disableQuotes' },
      { action: 'delete' },
    ]);
    expect(toggleEffect(gated, 'disableQuotes').effects).toEqual([
      { action: 'delete' },
    ]);
    expect(toggleEffect(on(), 'limitReplies').effects).toEqual([
      { action: 'limitReplies', allow: ['follower'] },
    ]);
  });

  it('sets who may reply, with nobody as an empty list', () => {
    const limited = toggleEffect(on(), 'limitReplies');
    expect(withAllow(limited, []).effects[0]).toEqual({
      action: 'limitReplies',
      allow: [],
    });
    expect(withAllow(on(), ['mention']).effects).toEqual([
      { action: 'delete' },
    ]);
    const list = 'at://did:plc:me/app.bsky.graph.list/abc';
    expect(toggleAllow(['follower'], { list, name: 'Friends' })).toEqual([
      'follower',
      { list, name: 'Friends' },
    ]);
    expect(toggleAllow(['follower', 'mention'], 'follower')).toEqual([
      'mention',
    ]);
    expect(
      toggleAllow(
        ['follower', 'following', 'mention', { list }, { list: `${list}2` }],
        { list: `${list}3` },
      ),
    ).toHaveLength(5);
    expect(toggleAllow(['follower'], 'everyone')).toEqual(['follower']);
  });
});

describe('conditions', () => {
  it('sets and clears a metric', () => {
    const r = withMetric(on(), 'likes', { op: 'gt', value: '5' });
    expect(r.conditions.clauses).toEqual([
      { metric: 'likes', op: 'gt', value: 5 },
    ]);
    expect(
      withMetric(r, 'likes', { op: 'gt', value: '' }).conditions.clauses,
    ).toEqual([]);
  });

  it('starts extending at once when the spare action is extend', () => {
    const r = withConditions(withMetric(on(), 'likes', { value: 3 }), {
      onSpare: 'extend',
    });
    expect(r.conditions).toMatchObject({ onSpare: 'extend', maxExtensions: 1 });
    expect(
      withConditions(r, { maxExtensions: 5 }).conditions.maxExtensions,
    ).toBe(5);
    expect(
      withConditions(r, { sense: 'onlyIf', logic: 'all' }).conditions,
    ).toMatchObject({ sense: 'onlyIf', logic: 'all' });
  });

  it('filters quotes by who quoted', () => {
    const r = withMetric(on(), 'quotes', { value: 2 });
    const filtered = withQuoteFilter(r, { notFollowed: true });
    expect(filtered.conditions.clauses[0].from).toEqual({
      match: 'any',
      notFollowed: true,
      followersOver: null,
    });
    const both = withQuoteFilter(filtered, {
      followersOver: 10000,
      match: 'all',
    });
    expect(both.conditions.clauses[0].from).toEqual({
      match: 'all',
      notFollowed: true,
      followersOver: 10000,
    });
    expect(
      withQuoteFilter(both, null).conditions.clauses[0].from,
    ).toBeUndefined();
    expect(withQuoteFilter(on(), { notFollowed: true })).toEqual(on());
  });
});

describe('the notes under the rule', () => {
  it('summarises the rule and what fitting does to it', () => {
    const rule = toggleEffect(on(), 'limitReplies');
    const notes = editorNotes(rule, { fit: { reply: true }, now: NOW });
    expect(notes.fitted.enabled).toBe(false);
    expect(notes.summary).toBe('');
    expect(notes.fitNote).toMatch(/only limits replies/);
    const root = editorNotes(rule, { fit: {}, now: NOW });
    expect(root.summary).toBe(
      'Limits replies to your followers 1 hour after it goes up.',
    );
  });

  it('says a thread goes with its first post', () => {
    expect(editorNotes(on(), { fit: { thread: true } }).thread).toMatch(
      /whole thread/,
    );
    expect(
      editorNotes(toggleEffect(on(), 'disableQuotes'), {
        fit: { thread: true },
      }).thread,
    ).toBe('');
  });

  it('checks a pinned time against when the post goes out', () => {
    const pinned = on({ deleteAt: '2026-11-13T12:00:00Z' });
    expect(
      editorNotes(pinned, { publishAt: '2026-11-13T11:58:00Z', now: NOW }).pin,
    ).toMatch(/less than 5 minutes/);
    expect(
      editorNotes(pinned, { publishAt: '2026-11-12T13:00:00Z', now: NOW }).pin,
    ).toBe('');
    expect(
      editorNotes(on({ deleteAt: '2026-11-12T11:00:00Z' }), { now: NOW }).pin,
    ).toMatch(/already passed/);
    expect(
      editorNotes(on({ deleteAt: '2026-11-12T11:00:00Z' }), { now: NOW })
        .pinBlocks,
    ).toBe(true);
    const near = editorNotes(on({ deleteAt: '2026-11-12T12:02:00Z' }), {
      now: NOW,
    });
    expect(near.pin).toMatch(/acts 5 minutes after/);
    expect(near.pinBlocks).toBe(false);
  });

  it('says when there is no free timer, unless this post already holds one', () => {
    const limits = normalizeLimits({
      features: { postTimers: { limit: 1 }, conditionalTimers: { limit: 1 } },
      usage: { postTimers: 1, conditionalTimers: 0 },
    });
    expect(editorNotes(on(), { limits }).room).toMatch(/one plain timer/);
    expect(editorNotes(on(), { limits, holds: on() }).room).toBe('');
    expect(
      editorNotes(withMetric(on(), 'likes', { value: 1 }), { limits }).room,
    ).toBe('');
    expect(
      editorNotes(normalizeTimer({ enabled: false }), { limits }).room,
    ).toBe('');
  });

  it('says an existing post can’t take a timer from the editor', () => {
    expect(
      editorNotes(on(), { fit: { editingExisting: true } }).unavailable,
    ).toMatch(/already out/);
  });
});

describe('putting a post that’s out on a timer', () => {
  it('works out when it first acts, never sooner than five minutes', () => {
    expect(firstActAt(on(), { startedAt: NOW, now: NOW }).toISOString()).toBe(
      '2026-11-12T13:00:00.000Z',
    );
    expect(
      firstActAt(on(), { startedAt: NOW - 86_400_000, now: NOW }).toISOString(),
    ).toBe('2026-11-12T12:05:00.000Z');
    expect(
      firstActAt(on({ deleteAt: '2026-11-20T00:00:00Z' }), {
        now: NOW,
      }).toISOString(),
    ).toBe('2026-11-20T00:00:00.000Z');
    expect(firstActAt(normalizeTimer({}), { now: NOW })).toBeNull();
  });

  it('counts from the post only while the server would, and says when it can’t', () => {
    // on() is a one-hour delete; the server (validateArm) keeps a postedAt only
    // while it's inside that hour, and otherwise counts from now.
    expect(
      timerStart(on(), {
        start: 'now',
        postedAt: '2026-11-12T11:30:00Z',
        now: NOW,
      }),
    ).toEqual({
      startedAt: NOW,
      from: 'now',
      passed: '',
    });
    const inside = timerStart(on(), {
      start: 'posted',
      postedAt: '2026-11-12T11:30:00Z',
      now: NOW,
    });
    expect(inside).toEqual({
      startedAt: Date.parse('2026-11-12T11:30:00Z'),
      from: 'wentUp',
      passed: '',
    });
    expect(
      firstActAt(on(), { startedAt: inside.startedAt, now: NOW }).toISOString(),
    ).toBe('2026-11-12T12:30:00.000Z');
    // Inside the hour but within the five-minute floor.
    expect(
      timerStart(on(), {
        start: 'posted',
        postedAt: '2026-11-12T11:02:00Z',
        now: NOW,
      }),
    ).toMatchObject({ from: 'wentUp', passed: 'floor' });
    // The whole hour has gone by: the full hour again from now, not five minutes.
    const elapsed = timerStart(on(), {
      start: 'posted',
      postedAt: '2026-11-11T00:00:00Z',
      now: NOW,
    });
    expect(elapsed).toEqual({ startedAt: NOW, from: 'now', passed: 'elapsed' });
    expect(
      firstActAt(on(), {
        startedAt: elapsed.startedAt,
        now: NOW,
      }).toISOString(),
    ).toBe('2026-11-12T13:00:00.000Z');
    // Exactly the length ago is out of the server's window too.
    expect(
      timerStart(on(), {
        start: 'posted',
        postedAt: '2026-11-12T11:00:00Z',
        now: NOW,
      }).passed,
    ).toBe('elapsed');
    // A start in the future, or one that can't be read, counts from now.
    expect(
      timerStart(on(), {
        start: 'posted',
        postedAt: '2026-11-12T12:30:00Z',
        now: NOW,
      }),
    ).toEqual({
      startedAt: NOW,
      from: 'now',
      passed: '',
    });
    expect(
      timerStart(on(), { start: 'posted', postedAt: null, now: NOW }).from,
    ).toBe('now');
    // A pinned time doesn't depend on the start.
    expect(
      timerStart(on({ deleteAt: '2026-11-13T00:00:00Z' }), {
        start: 'posted',
        postedAt: '2026-11-01T00:00:00Z',
        now: NOW,
      }),
    ).toEqual({ startedAt: NOW, from: 'now', passed: '' });
  });

  it('says where the length counts from for a post that’s already out', () => {
    expect(editorNotes(on(), { now: NOW }).summary).toMatch(
      /1 hour after it goes up\./,
    );
    expect(editorNotes(on(), { countFrom: 'now', now: NOW }).summary).toMatch(
      /1 hour from now\./,
    );
    expect(
      editorNotes(on(), { countFrom: 'wentUp', now: NOW }).summary,
    ).toMatch(/1 hour after it went up\./);
  });

  it('keeps only curate lists', () => {
    expect(
      curateLists([
        {
          uri: 'at://a/app.bsky.graph.list/1',
          name: 'Friends',
          purpose: 'app.bsky.graph.defs#curatelist',
        },
        {
          uri: 'at://a/app.bsky.graph.list/2',
          name: 'Mutes',
          purpose: 'app.bsky.graph.defs#modlist',
        },
      ]),
    ).toEqual([{ list: 'at://a/app.bsky.graph.list/1', name: 'Friends' }]);
  });
});
