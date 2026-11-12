import { describe, expect, it, vi } from 'vitest';
import {
  COPY_TARGETS,
  addSlot,
  applyAssignment,
  clearDay,
  clientName,
  copyDay,
  deletedPostUris,
  formatInZone,
  friendlyTimerError,
  fullTimerBuckets,
  groupByZonedDay,
  isDefaultWeek,
  moveId,
  moveIdTo,
  moveToZone,
  movableIds,
  nextOpenSlots,
  offScheduleRows,
  postScheduledNow,
  previewOrder,
  quickPicks,
  removeSlot,
  POST_NOW_CUTOFF_MS,
  rowActions,
  rowIsDueSoon,
  rowFacts,
  rowStatus,
  rowTags,
  ruleOfTimerRow,
  scheduledLimitsLine,
  scheduledSections,
  slotLabel,
  timerLimitsLine,
  timerNoteActions,
  timerRowModel,
  timerSections,
  weekSummary,
  weeklyCount,
  whenProblem,
  zoneLabel,
} from './scheduleModel.js';
import { DEFAULT_POSTING_QUEUE } from '../schedule/postingQueue.js';
import { normalizeLimits } from '../schedule/scheduleService.js';

const NOW = Date.parse('2026-11-12T12:00:00Z'); // a Thursday
const week = (slots, timezone = 'UTC') => ({
  timezone,
  slots: {
    mon: [],
    tue: [],
    wed: [],
    thu: [],
    fri: [],
    sat: [],
    sun: [],
    ...slots,
  },
});
const row = (id, scheduledFor, extra = {}) => ({
  id,
  scheduledFor,
  status: 'pending',
  queued: true,
  clientKey: 'virga',
  payload: {
    posts: [{ record: { text: `Post ${id}` } }],
    gates: { threadgate: null, postgate: null },
  },
  ...extra,
});

describe('scheduled sections', () => {
  it('puts failed rows first, then the queue, then posts with a time of their own', () => {
    const rows = [
      row('b', '2026-11-14T09:00:00Z'),
      row('a', '2026-11-13T09:00:00Z'),
      row('t', '2026-11-13T10:00:00Z', { queued: false }),
      row('f', '2026-11-10T10:00:00Z', { status: 'failed', queued: false }),
      row('p', '2026-11-12T12:00:00Z', { status: 'publishing' }),
      row('x', '2026-11-12T12:00:00Z', { status: 'cancelled' }),
    ];
    const s = scheduledSections(rows);
    expect(s.attention.map((r) => r.id)).toEqual(['f']);
    expect(s.queue.map((r) => r.id)).toEqual(['p', 'a', 'b']);
    expect(s.timed.map((r) => r.id)).toEqual(['t']);
  });
});

describe('a row’s facts and state', () => {
  it('counts posts, images, quotes, links and gates', () => {
    const facts = rowFacts({
      payload: {
        posts: [
          {
            record: { text: '  Hello  ' },
            embed: { type: 'images', images: [{}, {}] },
          },
          {
            record: { text: 'Two' },
            embed: {
              type: 'recordWithMedia',
              uri: 'at://x',
              cid: 'c',
              media: { type: 'external', uri: 'https://e' },
            },
          },
        ],
        gates: { threadgate: [], postgate: null },
        selfDestruct: {
          lifespanSeconds: 3600,
          conditions: {},
          effects: [{ action: 'delete' }],
        },
      },
    });
    expect(facts).toMatchObject({
      text: 'Hello',
      posts: 2,
      images: 2,
      quote: true,
      link: true,
      limited: true,
    });
    expect(facts.timer).toBe('Deletes itself 1 hour after it goes up.');
    expect(rowTags(facts)).toEqual([
      'Thread of 2',
      '2 images',
      'Quote',
      'Link card',
      'Replies or quotes limited',
    ]);
  });

  it('reads an empty postgate as no gate, and a missing timer as none', () => {
    const facts = rowFacts({
      payload: {
        posts: [{ record: { text: 'x' } }],
        gates: { threadgate: null, postgate: [] },
      },
    });
    expect(facts.limited).toBe(false);
    expect(facts.timer).toBe('');
    expect(rowTags(facts)).toEqual([]);
  });

  it('says why a row failed, in Virga’s words', () => {
    expect(
      rowStatus({ status: 'failed', lastErrorCode: 'SESSION_UNAVAILABLE' }),
    ).toMatchObject({ tone: 'danger', label: 'Didn’t go out' });
    expect(
      rowStatus({ status: 'failed', partial: true, lastErrorCode: 'TIMED_OUT' })
        .detail,
    ).toMatch(/retrying posts the rest/);
    expect(rowStatus({ status: 'publishing' }).label).toBe('Going out now');
    expect(rowStatus({ status: 'pending', partial: true }).tone).toBe('warn');
    expect(
      rowStatus(
        { status: 'pending', scheduledFor: '2026-11-12T11:00:00Z' },
        NOW,
      ).label,
    ).toBe('Due now');
    expect(
      rowStatus(
        { status: 'pending', scheduledFor: '2026-11-13T11:00:00Z' },
        NOW,
      ).tone,
    ).toBe('wait');
  });

  it('lets another app’s row be cancelled and nothing else', () => {
    const theirs = rowActions(
      row('a', '2026-11-13T09:00:00Z', { clientKey: 'anisota' }),
    );
    expect(theirs).toMatchObject({
      edit: false,
      postNow: false,
      retry: false,
      cancel: true,
    });
    expect(theirs.note).toBe(
      'Scheduled in Anisota. You can cancel it here; to change it, open Anisota.',
    );
    expect(clientName({ clientKey: 'anisota' })).toBe('Anisota');
    expect(clientName({})).toBe('another app');
    expect(clientName({ clientKey: 'virga' })).toBeNull();
  });

  it('offers Virga’s own rows everything that fits their state', () => {
    expect(rowActions(row('a', 'x'))).toMatchObject({
      edit: true,
      postNow: true,
      retry: false,
      cancel: true,
      note: '',
    });
    expect(rowActions(row('a', 'x', { status: 'failed' }))).toMatchObject({
      edit: true,
      postNow: true,
      retry: true,
      cancel: true,
    });
    expect(
      rowActions(row('a', 'x', { status: 'failed', partial: true })),
    ).toMatchObject({ edit: false, postNow: false, retry: true });
    expect(rowActions(row('a', 'x', { status: 'publishing' }))).toMatchObject({
      edit: false,
      postNow: false,
      retry: false,
      cancel: false,
    });
  });
});

describe('Post now near a row’s time', () => {
  it('isn’t offered once the worker may already be taking the row', () => {
    const due = row('a', '2026-11-12T11:59:00Z');
    const soon = row('b', new Date(NOW + POST_NOW_CUTOFF_MS).toISOString());
    const later = row(
      'c',
      new Date(NOW + POST_NOW_CUTOFF_MS + 60_000).toISOString(),
    );
    expect(rowActions(due, NOW).postNow).toBe(false);
    expect(rowActions(soon, NOW).postNow).toBe(false);
    expect(rowActions(later, NOW).postNow).toBe(true);
    // Still editable and cancellable: only posting it twice is the risk.
    expect(rowActions(due, NOW)).toMatchObject({ edit: true, cancel: true });
    // A failed row isn't picked up by the worker, so it can still be posted.
    expect(
      rowActions(row('d', '2026-11-12T09:00:00Z', { status: 'failed' }), NOW)
        .postNow,
    ).toBe(true);
  });

  it('reads a retry time when the row carries one', () => {
    const waiting = row('a', '2026-11-12T11:00:00Z', {
      nextAttemptAt: '2026-11-12T12:30:00Z',
    });
    expect(rowIsDueSoon(waiting, NOW)).toBe(false);
    expect(
      rowIsDueSoon({ ...waiting, nextAttemptAt: '2026-11-12T12:01:00Z' }, NOW),
    ).toBe(true);
    expect(rowIsDueSoon(row('b', '2026-11-12T11:00:00Z'), NOW)).toBe(true);
    expect(
      rowIsDueSoon(
        { ...row('c', '2026-11-12T11:00:00Z'), status: 'publishing' },
        NOW,
      ),
    ).toBe(false);
  });
});

describe('a timer note from Virga or another app', () => {
  const note = (extra = {}) => ({
    id: 'n1',
    status: 'published',
    lastErrorCode: 'TIMER_NOT_ARMED',
    clientKey: 'virga',
    scheduledFor: '2026-11-11T09:00:00Z',
    resultUri: 'at://did:plc:me/app.bsky.feed.post/r1',
    payload: { posts: [{ record: { text: 'Hi' } }], rkeys: ['r1', 'r2'] },
    ...extra,
  });

  it('offers a timer on a Bluesky post, thread and all, and Dismiss on Virga’s own', () => {
    const out = timerNoteActions(note());
    expect(out.arm).toMatchObject({
      uri: 'at://did:plc:me/app.bsky.feed.post/r1',
      text: 'Hi',
      postedAt: '2026-11-11T09:00:00Z',
      extraUris: ['at://did:plc:me/app.bsky.feed.post/r2'],
    });
    expect(out).toMatchObject({ dismiss: true, note: '' });
  });

  it('sends an Anisota post’s timer back to Anisota', () => {
    const out = timerNoteActions(
      note({
        clientKey: 'anisota',
        resultUri: 'at://did:plc:me/net.anisota.feed.post/r1',
      }),
    );
    expect(out).toEqual({
      arm: null,
      dismiss: false,
      note: 'Set its timer in Anisota.',
    });
  });

  it('stops offering a timer on another app’s note once one is set', () => {
    const theirs = note({ clientKey: 'anisota' });
    expect(timerNoteActions(theirs).arm).not.toBeNull();
    expect(timerNoteActions(theirs).dismiss).toBe(false);
    expect(timerNoteActions(theirs, { armed: new Set(['n1']) })).toEqual({
      arm: null,
      dismiss: false,
      note: 'Timer set. Dismiss this note in Anisota.',
    });
  });
});

describe('times in the queue’s zone', () => {
  it('groups by the day in that zone', () => {
    const rows = [
      row('past', '2026-11-12T11:00:00Z'),
      row('a', '2026-11-12T23:30:00Z'),
      row('b', '2026-11-13T09:00:00Z'),
      row('c', '2026-11-25T09:00:00Z'),
    ];
    const utc = groupByZonedDay(rows, 'UTC', NOW);
    expect(utc.map((g) => [g.label, g.rows.map((r) => r.id)])).toEqual([
      ['Overdue', ['past']],
      ['Today', ['a']],
      ['Tomorrow', ['b']],
      [expect.stringMatching(/Wednesday/), ['c']],
    ]);
    // 23:30 UTC is already tomorrow in Tokyo.
    const tokyo = groupByZonedDay(rows, 'Asia/Tokyo', NOW);
    expect(tokyo[1]).toMatchObject({ label: 'Tomorrow' });
    expect(tokyo[1].rows.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('formats in the zone, and labels zones and slots', () => {
    expect(
      formatInZone('2026-11-13T14:00:00Z', 'America/New_York', NOW),
    ).toMatch(/9:00/);
    expect(formatInZone('2027-01-13T14:00:00Z', 'UTC', NOW)).toMatch(/2027/);
    expect(formatInZone('nope', 'UTC')).toBe('');
    expect(zoneLabel('America/New_York')).toBe('America/New York');
    expect(slotLabel('17:30')).toMatch(/5:30/);
    expect(slotLabel('bad')).toBe('bad');
  });
});

describe('reordering the queue', () => {
  const rows = [
    row('a', '2026-11-13T09:00:00Z'),
    row('x', '2026-11-13T17:00:00Z', { clientKey: 'anisota' }),
    row('b', '2026-11-16T09:00:00Z'),
    row('c', '2026-11-16T17:00:00Z'),
  ];

  it('moves only this app’s rows, and other rows keep their places', () => {
    expect(movableIds(rows, NOW)).toEqual(['a', 'b', 'c']);
    expect(previewOrder(rows, ['c', 'a', 'b']).map((r) => r.id)).toEqual([
      'c',
      'x',
      'a',
      'b',
    ]);
  });

  it('moves an id by a step, or to a place', () => {
    expect(moveId(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b']);
    expect(moveId(['a', 'b', 'c'], 'a', -1)).toEqual(['a', 'b', 'c']);
    expect(moveId(['a', 'b', 'c'], 'zz', 1)).toEqual(['a', 'b', 'c']);
    expect(moveIdTo(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a']);
  });

  it('redraws rows at their new times', () => {
    const next = applyAssignment(rows, [
      { id: 'a', newScheduledFor: '2026-11-20T09:00:00.000Z' },
      { id: 'b', newScheduledFor: null },
    ]);
    expect(next.find((r) => r.id === 'a').scheduledFor).toBe(
      '2026-11-20T09:00:00.000Z',
    );
    expect(next.find((r) => r.id === 'b').scheduledFor).toBe(
      '2026-11-16T09:00:00Z',
    );
  });
});

describe('limits lines', () => {
  const base = {
    policy: 'membership',
    features: {
      scheduledPosts: { limit: 3 },
      postTimers: { limit: 1 },
      conditionalTimers: { limit: 1 },
    },
    usage: { scheduledPosts: 2, postTimers: 0, conditionalTimers: 1 },
  };

  it('states a free account’s usage neutrally', () => {
    const limits = normalizeLimits(base);
    expect(scheduledLimitsLine(limits)).toBe(
      '2 of 3 scheduled posts in use. Limits are shared with Anisota.',
    );
    expect(timerLimitsLine(limits)).toBe(
      'In use: 0 of 1 plain timer and 1 of 1 conditional timer, counting scheduled posts with a timer. Limits are shared with Anisota.',
    );
    expect(fullTimerBuckets(limits)).toEqual([
      'This account can keep one conditional timer at a time, counting scheduled posts, and it’s in use. Limits are shared with Anisota.',
    ]);
  });

  it('fills a count cocoon didn’t send from what the page counted', () => {
    const limits = normalizeLimits({ ...base, usage: {} });
    expect(timerLimitsLine(limits, { plain: 1, conditional: 0 })).toMatch(
      /1 of 1 plain timer and 0 of 1 conditional timer/,
    );
    expect(scheduledLimitsLine(limits)).toBe(
      'This account can keep 3 scheduled posts at a time. Limits are shared with Anisota.',
    );
  });

  it('names the server’s ceiling when there is no limit', () => {
    const flat = normalizeLimits({
      policy: 'flat',
      features: {
        scheduledPosts: { isUnlimited: true },
        postTimers: { isUnlimited: true },
        conditionalTimers: { isUnlimited: true },
      },
      caps: { scheduledPosts: 50, timers: 200 },
    });
    expect(scheduledLimitsLine(flat)).toBe(
      'No limit on scheduled posts, beyond the 50 that can wait at a time.',
    );
    expect(timerLimitsLine(flat)).toBe(
      'No limit on timers, beyond the 200 that can count down at a time.',
    );
    const member = normalizeLimits({
      policy: 'membership',
      isMember: true,
      features: { scheduledPosts: { isUnlimited: true } },
    });
    expect(scheduledLimitsLine(member)).toBe('No limit on scheduled posts.');
    expect(timerLimitsLine(member)).toBe('No limit on timers.');
    expect(scheduledLimitsLine(null)).toBe('');
    expect(timerLimitsLine(normalizeLimits({}))).toBe('');
  });
});

describe('timer rows', () => {
  const live = {
    id: 't1',
    postUri: 'at://did:plc:me/app.bsky.feed.post/3abc',
    snippet: 'A post',
    status: 'armed',
    checkAt: '2026-11-12T16:00:00Z',
    lifespanSeconds: 3600,
    conditions: {
      clauses: [{ metric: 'likes', op: 'gte', value: 5 }],
      sense: 'unless',
    },
    effects: [{ action: 'delete' }],
    extensions: 2,
    clientKey: 'anisota',
  };

  it('describes a live timer', () => {
    const m = timerRowModel(live, NOW);
    expect(m).toMatchObject({
      live: true,
      when: 'Acts in 4 hours',
      extensions: 'Kept 2 times so far',
      bucket: 'conditional',
      client: 'Anisota',
      canCancel: true,
      cancelLabel: 'Call off',
    });
    expect(m.rule).toBe(
      'Deletes itself 1 hour after it goes up, unless it has 5 likes by then. If it does, it stays up for good.',
    );
    expect(timerRowModel({ ...live, status: 'checking' }, NOW).when).toBe(
      'Checking now',
    );
    expect(timerRowModel({ ...live, status: 'checking' }, NOW).canCancel).toBe(
      false,
    );
  });

  it('describes what a settled one did', () => {
    const m = timerRowModel(
      {
        ...live,
        status: 'acted',
        resolution: 'limited replies',
        acted: [
          {
            action: 'limitReplies',
            ok: false,
            detail: 'the rule would have opened them up',
          },
          { action: 'disableQuotes', ok: true, detail: '' },
        ],
      },
      NOW,
    );
    expect(m.when).toBe('Changed');
    expect(m.resolution).toBe('Limited replies.');
    expect(m.acted).toEqual([
      {
        ok: false,
        text: 'Left the reply settings alone: the rule would have opened them up.',
      },
      { ok: true, text: 'Turned off quotes.' },
    ]);
    expect(
      timerRowModel({
        ...live,
        status: 'deleted',
        acted: [{ action: 'delete', ok: true, detail: 'deleted' }],
      }).acted,
    ).toEqual([]);
    expect(
      timerRowModel({
        ...live,
        status: 'deleted',
        acted: [
          { action: 'disableQuotes', ok: true },
          { action: 'delete', ok: true, detail: 'deleted' },
        ],
      }).acted,
    ).toEqual([
      { ok: true, text: 'Turned off quotes.' },
      { ok: true, text: 'Deleted the post.' },
    ]);
  });

  it('says why one gave up', () => {
    const m = timerRowModel(
      { ...live, status: 'failed', lastErrorCode: 'ENGAGEMENT_UNAVAILABLE' },
      NOW,
    );
    expect(m.failure).toMatch(/counts were checked/);
    expect(m.cancelLabel).toBe('Dismiss');
    expect(friendlyTimerError(null, 'session expired')).toMatch(
      /session had ended/,
    );
    expect(friendlyTimerError(null, '')).toBe(
      'The timer gave up. The post is still up.',
    );
  });

  it('reads a row with no effects as a delete', () => {
    expect(
      ruleOfTimerRow({ lifespanSeconds: 600, effects: null }).effects,
    ).toEqual([{ action: 'delete' }]);
  });

  it('puts waiting posts after the live ones', () => {
    const groups = [
      { key: 'live', rows: [1] },
      { key: 'failed', rows: [2] },
    ];
    expect(timerSections(groups, [{ id: 'w' }]).map((g) => g.key)).toEqual([
      'live',
      'waiting',
      'failed',
    ]);
    expect(
      timerSections([{ key: 'settled', rows: [3] }], []).map((g) => g.key),
    ).toEqual(['settled']);
  });

  it('lists the posts timers deleted', () => {
    expect(
      deletedPostUris([
        { status: 'deleted', postUri: 'at://a' },
        { status: 'spared', postUri: 'at://b' },
      ]),
    ).toEqual(['at://a']);
  });
});

describe('the weekly schedule', () => {
  it('sums the week up', () => {
    expect(weekSummary(DEFAULT_POSTING_QUEUE)).toMatch(
      /^Weekdays at 9:00.*and 5:00/,
    );
    expect(weekSummary(week({ sat: ['10:00'], sun: ['10:00'] }))).toMatch(
      /^Weekends at 10:00/,
    );
    expect(
      weekSummary(week({ mon: ['09:00'], wed: ['09:00'], fri: ['18:00'] })),
    ).toMatch(/^Mon, Wed at 9:00.*; Fri at 6:00/);
    expect(
      weekSummary(week({ mon: ['09:00'], wed: ['09:00'], fri: ['09:00'] })),
    ).toMatch(/^Mon, Wed, Fri at 9:00/);
    expect(
      weekSummary(week({ tue: ['09:00'], wed: ['09:00'], thu: ['09:00'] })),
    ).toMatch(/^Tue to Thu at 9:00/);
    expect(weekSummary(week({}))).toBe('No posting times yet.');
    expect(weeklyCount(DEFAULT_POSTING_QUEUE)).toBe(10);
    expect(isDefaultWeek(DEFAULT_POSTING_QUEUE)).toBe(true);
  });

  it('adds, removes, clears and copies times', () => {
    const empty = { timezone: '', slots: week({}).slots };
    const one = addSlot(empty, 'mon', '17:00', 'Europe/London');
    expect(one.timezone).toBe('Europe/London');
    expect(addSlot(one, 'mon', '09:00').slots.mon).toEqual(['09:00', '17:00']);
    expect(addSlot(one, 'mon', '17:00')).toBe(one);
    expect(addSlot(one, 'mon', '9am')).toBe(one);
    expect(removeSlot(one, 'mon', '17:00').slots.mon).toEqual([]);
    expect(clearDay(addSlot(one, 'tue', '08:00'), 'tue').slots.tue).toEqual([]);
    const copied = copyDay(one, 'mon', COPY_TARGETS[0].days);
    expect(copied.slots.fri).toEqual(['17:00']);
    expect(copied.slots.sat).toEqual([]);
    expect(moveToZone(one, 'Asia/Tokyo')).toEqual({
      ...one,
      timezone: 'Asia/Tokyo',
    });
  });

  it('finds the next open times, stepping around queued posts of any app', () => {
    const schedule = week({ thu: ['09:00', '17:00'], fri: ['09:00'] });
    const slots = nextOpenSlots(
      schedule,
      [row('x', '2026-11-12T17:00:00Z', { clientKey: 'anisota' })],
      NOW,
      3,
    );
    expect(slots.map((d) => d.toISOString())).toEqual([
      '2026-11-13T09:00:00.000Z',
      '2026-11-19T09:00:00.000Z',
      '2026-11-19T17:00:00.000Z',
    ]);
    expect(nextOpenSlots(week({}), [], NOW)).toEqual([]);
  });

  it('finds this app’s queued posts that sit off the week’s times', () => {
    const schedule = week({ fri: ['09:00'] });
    const rows = [
      row('on', '2026-11-13T09:00:00Z'),
      row('off', '2026-11-13T10:00:00Z'),
      row('theirs', '2026-11-13T11:00:00Z', { clientKey: 'anisota' }),
    ];
    expect(offScheduleRows(schedule, rows, NOW).map((r) => r.id)).toEqual([
      'off',
    ]);
    expect(offScheduleRows(week({}), rows, NOW).map((r) => r.id)).toEqual([
      'on',
      'off',
    ]);
  });

  it('leaves out a row that’s due or waiting on a retry', () => {
    const schedule = week({ thu: ['09:00'], fri: ['09:00'] });
    const rows = [
      row('overdue', '2026-11-12T10:30:00Z'),
      row('on', '2026-11-13T09:00:00Z'),
    ];
    expect(offScheduleRows(schedule, rows, NOW)).toEqual([]);
  });
});

describe('the time picker', () => {
  it('offers quick picks inside the bounds, on the queue’s clock', () => {
    const picks = quickPicks(NOW, 'UTC');
    const by = Object.fromEntries(
      picks.map((p) => [p.key, p.at.toISOString()]),
    );
    expect(by.hour).toBe('2026-11-12T13:00:00.000Z');
    expect(by.evening).toBe('2026-11-12T18:00:00.000Z');
    expect(by.morning).toBe('2026-11-13T09:00:00.000Z');
    expect(by.weekend).toBe('2026-11-14T10:00:00.000Z');
    expect(by['next-week']).toBe('2026-11-16T09:00:00.000Z');
    const late = quickPicks(Date.parse('2026-11-12T19:00:00Z'), 'UTC');
    expect(late.some((p) => p.key === 'evening')).toBe(false);
    expect(
      quickPicks(NOW, 'UTC', { max: NOW + 3 * 3600_000 }).map((p) => p.key),
    ).toEqual(['hour']);
  });

  it('says what’s wrong with a time', () => {
    expect(whenProblem(null, NOW)).toBe('Choose a date and a time.');
    expect(whenProblem('2026-11-12T11:00:00Z', NOW)).toMatch(/has passed/);
    expect(whenProblem('2026-11-12T12:00:30Z', NOW)).toMatch(
      /at least a minute/,
    );
    expect(whenProblem('2027-06-01T00:00:00Z', NOW)).toMatch(/further ahead/);
    expect(whenProblem('2026-11-13T12:00:00Z', NOW)).toBe('');
  });
});

describe('posting a scheduled row now', () => {
  // On the test's clock, not the machine's: whether a row is about to go out
  // depends on it.
  const postNow = (r, opts) => postScheduledNow(r, { now: NOW, ...opts });
  const scheduled = row('r1', '2026-11-13T09:00:00Z', {
    payload: {
      posts: [{ record: { text: 'Hi' } }],
      gates: { threadgate: null, postgate: null },
      media: {},
      selfDestruct: {
        lifespanSeconds: 3600,
        conditions: {},
        effects: [{ action: 'delete' }],
      },
    },
  });
  const deps = (over = {}) => ({
    requester: { did: 'did:plc:me' },
    getScheduledMedia: vi.fn(async () => ({})),
    reconstructFromScheduled: vi.fn(() => ({
      posts: [{ text: 'Hi', images: [] }],
      schedule: { mode: 'at', at: 'x' },
      lifespan: { enabled: true },
    })),
    targetFor: vi.fn(async () => ({ did: 'did:plc:me' })),
    publish: vi.fn(async () => ({
      written: [{ uri: 'at://p' }],
      root: { uri: 'at://p' },
    })),
    cancelScheduled: vi.fn(async () => ({})),
    emitPostsChanged: vi.fn(),
    armTimer: vi.fn(async () => ({ status: 'armed' })),
    ...over,
  });

  it('posts, then cancels the row, then sets the timer', async () => {
    const d = deps();
    const out = await postNow(scheduled, {
      did: 'did:plc:me',
      deps: d,
    });
    expect(d.getScheduledMedia).not.toHaveBeenCalled();
    expect(d.publish.mock.calls[0][0].schedule).toBeNull();
    expect(d.emitPostsChanged).toHaveBeenCalledWith('did:plc:me', {
      added: [{ uri: 'at://p' }],
    });
    expect(d.cancelScheduled).toHaveBeenCalledWith(d.requester, 'r1');
    expect(d.cancelScheduled.mock.invocationCallOrder[0]).toBeLessThan(
      d.armTimer.mock.invocationCallOrder[0],
    );
    expect(out).toMatchObject({ cancelled: true, notes: [] });
  });

  it('retries the cancel once and says when the copy is still waiting', async () => {
    const cancel = vi
      .fn()
      .mockRejectedValueOnce(new Error('net'))
      .mockResolvedValueOnce({});
    expect(
      (
        await postNow(scheduled, {
          did: 'd',
          deps: deps({ cancelScheduled: cancel }),
        })
      ).cancelled,
    ).toBe(true);
    const never = vi.fn(async () => {
      throw Object.assign(new Error('x'), {
        status: 409,
        code: 'NOT_CANCELLABLE',
      });
    });
    const out = await postNow(scheduled, {
      did: 'd',
      deps: deps({ cancelScheduled: never }),
    });
    expect(never).toHaveBeenCalledTimes(1);
    expect(out.notes[0]).toMatch(/may go out again/);
  });

  it('reads the stored images first, and refuses when one is gone', async () => {
    const withMedia = {
      ...scheduled,
      payload: { ...scheduled.payload, media: { 'p0-img0': {} } },
    };
    const d = deps({
      reconstructFromScheduled: vi.fn(() => ({
        posts: [{ images: [{ id: 'i' }] }],
        lifespan: { enabled: false },
      })),
    });
    await expect(
      postNow(withMedia, { did: 'd', deps: d }),
    ).rejects.toMatchObject({ code: 'IMAGE_MISSING' });
    expect(d.getScheduledMedia).toHaveBeenCalledWith(d.requester, 'r1');
    expect(d.publish).not.toHaveBeenCalled();
  });

  it('refuses another app’s row and a thread part way out', async () => {
    await expect(
      postNow(
        { ...scheduled, clientKey: 'anisota' },
        { did: 'd', deps: deps() },
      ),
    ).rejects.toMatchObject({
      code: 'NOT_YOUR_CLIENT',
    });
    await expect(
      postNow({ ...scheduled, partial: true }, { did: 'd', deps: deps() }),
    ).rejects.toMatchObject({
      code: 'PARTIALLY_PUBLISHED',
    });
  });

  it('leaves the row alone when the post fails', async () => {
    const d = deps({ publish: vi.fn().mockRejectedValue(new Error('down')) });
    await expect(postNow(scheduled, { did: 'd', deps: d })).rejects.toThrow(
      'down',
    );
    expect(d.cancelScheduled).not.toHaveBeenCalled();
  });

  it('says when the timer didn’t take', async () => {
    const out = await postNow(scheduled, {
      did: 'd',
      deps: deps({
        armTimer: vi.fn(async () => ({
          status: 'failed',
          error: new Error('No room.'),
        })),
      }),
    });
    expect(out.notes).toEqual(['It went out without its timer: No room.']);
  });

  it('won’t post a row that’s due or about to be, which the worker may be taking', async () => {
    for (const at of ['2026-11-12T11:00:00Z', '2026-11-12T12:01:30Z']) {
      const d = deps();
      await expect(
        postNow({ ...scheduled, scheduledFor: at }, { did: 'd', deps: d }),
      ).rejects.toMatchObject({ code: 'ALREADY_DUE' });
      expect(d.publish).not.toHaveBeenCalled();
      expect(d.cancelScheduled).not.toHaveBeenCalled();
    }
  });
});
