/*
 * Reading a set of scheduled rows (shared by the posting hub and the queue
 * page). A post riding the weekly queue differs from one set
 * for its own time, a post mid-publish has already left the queue, and a failed
 * post is neither: it is something to tell the reader about.
 */

import { describe, it, expect } from 'vitest';
import {
  summarizeQueue,
  relativeWhen,
  postSnippet,
  enumerateSlots,
  recomputeQueueAssignment,
  nextOpenSlot,
  isScheduleEmpty,
  resolveTimezone,
  dateBucketLabel,
  groupByDateBucket,
  MIN_LEAD_MS,
  QUEUE_HORIZON_DAYS,
  zonedWallTime,
  zonedWallTimeToUtc,
} from './postingQueue.js';

const row = (over = {}) => ({
  id: 'r',
  queued: false,
  status: 'pending',
  scheduledFor: '2026-08-11T12:00:00Z',
  ...over,
});

describe('summarizeQueue', () => {
  it('separates queued posts from one-off scheduled ones', () => {
    const s = summarizeQueue([
      row({ id: 'a', queued: true }),
      row({ id: 'b', queued: true }),
      row({ id: 'c' }),
    ]);
    expect(s.queuedCount).toBe(2);
    expect(s.scheduledCount).toBe(1);
    expect(s.failedCount).toBe(0);
  });

  it('counts a one-off post mid-publish as scheduled', () => {
    const s = summarizeQueue([row({ id: 'a', status: 'publishing' })]);
    expect(s.scheduledCount).toBe(1);
  });

  it('drops a queued post mid-publish from both counts — it is going out, not waiting', () => {
    const s = summarizeQueue([
      row({ id: 'a', queued: true, status: 'publishing' }),
    ]);
    expect(s).toMatchObject({
      queuedCount: 0,
      scheduledCount: 0,
      failedCount: 0,
    });
  });

  it('counts failures on their own, in neither running total', () => {
    const s = summarizeQueue([
      row({ id: 'a', queued: true, status: 'failed' }),
      row({ id: 'b', status: 'failed' }),
      row({ id: 'c', queued: true }),
    ]);
    expect(s).toMatchObject({
      queuedCount: 1,
      scheduledCount: 0,
      failedCount: 2,
    });
  });

  it('hands back the queue soonest-first, so the next one out is the first', () => {
    const s = summarizeQueue([
      row({ id: 'later', queued: true, scheduledFor: '2026-08-13T09:00:00Z' }),
      row({ id: 'sooner', queued: true, scheduledFor: '2026-08-11T09:00:00Z' }),
      row({ id: 'middle', queued: true, scheduledFor: '2026-08-12T09:00:00Z' }),
    ]);
    expect(s.queued.map((r) => r.id)).toEqual(['sooner', 'middle', 'later']);
  });

  it('reads nothing, null entries and no argument at all as an empty queue', () => {
    expect(summarizeQueue([])).toMatchObject({
      queuedCount: 0,
      scheduledCount: 0,
      failedCount: 0,
    });
    expect(summarizeQueue([null, undefined])).toMatchObject({
      queuedCount: 0,
      failedCount: 0,
    });
    expect(summarizeQueue().queued).toEqual([]);
  });
});

describe('relativeWhen', () => {
  const now = new Date('2026-08-11T12:00:00Z').getTime();
  const inMs = (ms) => new Date(now + ms).toISOString();

  it('climbs to the roundest unit that still says something', () => {
    expect(relativeWhen(inMs(20 * 60000), now)).toBe('in 20 min');
    expect(relativeWhen(inMs(3 * 3600000), now)).toBe('in 3 hr');
    expect(relativeWhen(inMs(50 * 3600000), now)).toBe('in 2 days');
  });

  it('says "1 day", not "1 days"', () => {
    expect(relativeWhen(inMs(24 * 3600000), now)).toBe('in 1 day');
  });

  it('calls anything already past due now, rather than counting backwards', () => {
    expect(relativeWhen(inMs(-60000), now)).toBe('due now');
    expect(relativeWhen(inMs(0), now)).toBe('due now');
  });

  it('says nothing at all for a time it cannot read', () => {
    expect(relativeWhen('not a date', now)).toBe('');
    expect(relativeWhen(undefined, now)).toBe('');
  });
});

describe('postSnippet', () => {
  const withText = (text) => ({ payload: { posts: [{ record: { text } }] } });

  it('takes the first post of a thread', () => {
    const thread = {
      payload: {
        posts: [{ record: { text: 'first' } }, { record: { text: 'second' } }],
      },
    };
    expect(postSnippet(thread)).toBe('first');
  });

  it('ellipsizes past the limit and leaves shorter text alone', () => {
    expect(postSnippet(withText('a'.repeat(80)), 10)).toBe(`${'a'.repeat(9)}…`);
    expect(postSnippet(withText('short'), 10)).toBe('short');
  });

  it('names a post that is only media, rather than showing an empty line', () => {
    expect(postSnippet(withText('   '))).toBe('a post with media');
    expect(postSnippet({})).toBe('a post with media');
    expect(postSnippet(null)).toBe('a post with media');
  });
});

describe('enumerateSlots', () => {
  const take = (schedule, from, n) => {
    const out = [];
    for (const slot of enumerateSlots(schedule, new Date(from).getTime())) {
      out.push(slot.toISOString());
      if (out.length === n) break;
    }
    return out;
  };

  const sundays = (times) => ({
    timezone: 'America/New_York',
    slots: { sun: times },
  });

  // 2026-03-08 is the US spring-forward Sunday: 2:00am never happens in New
  // York, so a slot inside the gap has to move forward to the next real minute.
  it('resolves a wall time inside the spring-forward gap forward, not back', () => {
    expect(
      take(sundays(['01:45', '02:30', '04:00']), '2026-03-08T05:00:00Z', 3),
    ).toEqual([
      '2026-03-08T06:45:00.000Z',
      '2026-03-08T07:30:00.000Z',
      '2026-03-08T08:00:00.000Z',
    ]);
  });

  it('still yields that day ascending, though the gap slot now trails a later one', () => {
    // 02:30 comes out at 03:30 EDT, past the 03:00 slot: wall-clock order is not
    // instant order on this one day of the year.
    expect(
      take(sundays(['02:30', '03:00']), '2026-03-08T05:00:00Z', 2),
    ).toEqual(['2026-03-08T07:00:00.000Z', '2026-03-08T07:30:00.000Z']);
  });

  it('takes the first pass of an ambiguous time on the fall-back day', () => {
    expect(take(sundays(['01:30']), '2026-11-01T04:10:00Z', 1)).toEqual([
      '2026-11-01T05:30:00.000Z',
    ]);
  });
});

describe('recomputeQueueAssignment', () => {
  const schedule = {
    timezone: 'UTC',
    slots: { mon: ['09:00'], tue: ['09:00'], wed: ['09:00'] },
  };

  it('reports the old time in the same serialization as the new one', () => {
    // The caller compares the pair to decide whether a row needs a write;
    // '+00:00' and '.000Z' spellings of one instant must compare equal, or every
    // row is rewritten on every drag.
    const now = new Date('2026-08-16T12:00:00Z');
    const [a] = recomputeQueueAssignment(
      schedule,
      [{ id: 'a', scheduledFor: '2026-08-17T09:00:00+00:00' }],
      now,
    );
    expect(a.oldScheduledFor).toBe('2026-08-17T09:00:00.000Z');
    expect(a.newScheduledFor).toBe(a.oldScheduledFor);
  });

  it('leaves a row with no time at null rather than inventing one', () => {
    const now = new Date('2026-08-16T12:00:00Z');
    const [a] = recomputeQueueAssignment(schedule, [{ id: 'a' }], now);
    expect(a.oldScheduledFor).toBeNull();
  });

  it('hands back null once the rows outrun the slots inside the horizon', () => {
    // One weekly slot reaches about thirteen Mondays in ninety days; rows past
    // that come back null rather than landing on top of an earlier row.
    const now = new Date('2026-08-16T12:00:00Z');
    const weekly = { timezone: 'UTC', slots: { mon: ['09:00'] } };
    const rows = Array.from({ length: 20 }, (_, i) => ({ id: `r${i}` }));
    const out = recomputeQueueAssignment(weekly, rows, now);

    const placed = out.filter((r) => r.newScheduledFor !== null);
    expect(placed.length).toBeGreaterThan(0);
    expect(placed.length).toBeLessThan(rows.length);
    // The nulls are the tail, not holes in the middle.
    expect(
      out.slice(placed.length).every((r) => r.newScheduledFor === null),
    ).toBe(true);
    // And the times that were handed out ascend.
    const times = placed.map((r) => new Date(r.newScheduledFor).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });
});

describe('enumerateSlots stays inside the rolling horizon', () => {
  // The backend refuses anything past its own `now + 90 days` at request time,
  // a rolling line rather than a calendar one; slots on the 90th local day can
  // sit hours past it.
  it('never yields an instant the backend would refuse', () => {
    const fromMs = Date.UTC(2026, 7, 10, 9, 0); // Mon 10 Aug 2026, 09:00 UTC
    const schedule = {
      timezone: 'UTC',
      // A late slot every day, so the 90th calendar day would offer 22:00 —
      // 13 hours past the rolling line drawn from a 09:00 start.
      slots: {
        mon: ['22:00'],
        tue: ['22:00'],
        wed: ['22:00'],
        thu: ['22:00'],
        fri: ['22:00'],
        sat: ['22:00'],
        sun: ['22:00'],
      },
    };
    const horizon = fromMs + 90 * 24 * 60 * 60 * 1000;
    let count = 0;
    for (const slot of enumerateSlots(schedule, fromMs)) {
      expect(slot.getTime()).toBeLessThan(horizon);
      count += 1;
    }
    expect(count).toBeGreaterThan(85); // the horizon trim costs at most the last day
  });
});

describe('nextOpenSlot', () => {
  const schedule = {
    timezone: 'UTC',
    slots: { mon: ['09:00', '17:00'], tue: ['09:00'] },
  };
  // Sunday 16 Aug 2026, noon UTC.
  const now = new Date('2026-08-16T12:00:00Z');

  it('gives the first slot after now', () => {
    expect(nextOpenSlot(schedule, [], now).toISOString()).toBe(
      '2026-08-17T09:00:00.000Z',
    );
  });

  it('skips a slot a queued row already holds, matching by the minute', () => {
    const taken = [{ scheduledFor: '2026-08-17T09:00:30+00:00' }];
    expect(nextOpenSlot(schedule, taken, now).toISOString()).toBe(
      '2026-08-17T17:00:00.000Z',
    );
  });

  it('counts every queued row, whoever placed it', () => {
    const taken = [
      { scheduledFor: '2026-08-17T09:00:00.000Z', clientKey: 'anisota' },
      { scheduledFor: '2026-08-17T17:00:00.000Z', clientKey: 'virga' },
    ];
    expect(nextOpenSlot(schedule, taken, now).toISOString()).toBe(
      '2026-08-18T09:00:00.000Z',
    );
  });

  it('never places a post within the minimum lead of now', () => {
    const close = new Date(
      new Date('2026-08-17T09:00:00Z').getTime() - MIN_LEAD_MS / 2,
    );
    expect(nextOpenSlot(schedule, [], close).toISOString()).toBe(
      '2026-08-17T17:00:00.000Z',
    );
  });

  it('has nothing for an empty week, or a queue full to the horizon', () => {
    expect(nextOpenSlot({ timezone: 'UTC', slots: {} }, [], now)).toBeNull();
    expect(nextOpenSlot(null, [], now)).toBeNull();
    const weekly = { timezone: 'UTC', slots: { mon: ['09:00'] } };
    const all = [];
    for (const slot of enumerateSlots(weekly, now.getTime()))
      all.push({ scheduledFor: slot.toISOString() });
    expect(all.length).toBeGreaterThan(10);
    expect(nextOpenSlot(weekly, all, now)).toBeNull();
  });

  it('reads the week in its own zone', () => {
    const ny = { timezone: 'America/New_York', slots: { mon: ['09:00'] } };
    // 09:00 EDT is 13:00 UTC.
    expect(nextOpenSlot(ny, [], now).toISOString()).toBe(
      '2026-08-17T13:00:00.000Z',
    );
  });
});

describe('recomputeQueueAssignment around rows it may not move', () => {
  const schedule = {
    timezone: 'UTC',
    slots: { mon: ['09:00'], tue: ['09:00'], wed: ['09:00'], thu: ['09:00'] },
  };
  const now = new Date('2026-08-16T12:00:00Z');

  it('steps around minutes held by another client’s rows', () => {
    const occupied = [
      {
        id: 'theirs',
        scheduledFor: '2026-08-18T09:00:00+00:00',
        clientKey: 'anisota',
      },
    ];
    const out = recomputeQueueAssignment(
      schedule,
      [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
      now,
      { occupied },
    );
    expect(out.map((r) => r.newScheduledFor)).toEqual([
      '2026-08-17T09:00:00.000Z',
      '2026-08-19T09:00:00.000Z',
      '2026-08-20T09:00:00.000Z',
    ]);
  });

  it('steps around a thread part-way out, and ignores occupied rows with no time', () => {
    const occupied = [
      { id: 'partial', partial: true, scheduledFor: '2026-08-17T09:00:00Z' },
      { id: 'odd' },
    ];
    const out = recomputeQueueAssignment(schedule, [{ id: 'a' }], now, {
      occupied,
    });
    expect(out[0].newScheduledFor).toBe('2026-08-18T09:00:00.000Z');
  });

  it('is the old behaviour with nothing occupied', () => {
    const a = recomputeQueueAssignment(
      schedule,
      [{ id: 'a' }, { id: 'b' }],
      now,
    );
    const b = recomputeQueueAssignment(
      schedule,
      [{ id: 'a' }, { id: 'b' }],
      now,
      { occupied: [] },
    );
    expect(a).toEqual(b);
  });

  it('gives nothing to an empty order', () => {
    expect(recomputeQueueAssignment(schedule, [], now)).toEqual([]);
  });
});

describe('small readers', () => {
  it('knows an empty week', () => {
    expect(isScheduleEmpty({ slots: { mon: [] } })).toBe(true);
    expect(isScheduleEmpty(undefined)).toBe(true);
    expect(isScheduleEmpty({ slots: { fri: ['10:00'] } })).toBe(false);
  });

  it('uses the week’s own zone, else this device’s', () => {
    expect(resolveTimezone({ timezone: 'Europe/Paris' })).toBe('Europe/Paris');
    expect(resolveTimezone({ timezone: '' })).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    );
  });

  it('buckets rows by local day, consecutively', () => {
    const now = new Date(2026, 7, 12, 10);
    const at = (d, h = 9) => new Date(2026, 7, d, h).toISOString();
    expect(dateBucketLabel(at(11), now)).toBe('Overdue');
    expect(dateBucketLabel(at(12, 18), now)).toBe('Today');
    expect(dateBucketLabel(at(13), now)).toBe('Tomorrow');
    expect(dateBucketLabel(at(15), now)).toBe('In 3 days');
    const groups = groupByDateBucket(
      [
        { scheduledFor: at(12, 11) },
        { scheduledFor: at(12, 15) },
        { scheduledFor: at(13) },
      ],
      undefined,
      now,
    );
    expect(groups.map((g) => [g.label, g.rows.length])).toEqual([
      ['Today', 2],
      ['Tomorrow', 1],
    ]);
  });

  it('keeps the horizon in step with cocoon’s', () => {
    expect(QUEUE_HORIZON_DAYS).toBe(90);
  });
});

describe('zoned wall times (the time picker)', () => {
  it('turns a wall time in a zone into its instant, and back', () => {
    const at = zonedWallTimeToUtc('2026-11-13', '09:00', 'America/New_York');
    expect(at.toISOString()).toBe('2026-11-13T14:00:00.000Z');
    expect(zonedWallTime(at, 'America/New_York')).toEqual({
      date: '2026-11-13',
      time: '09:00',
      weekday: 'fri',
    });
    expect(zonedWallTime(at, 'Asia/Tokyo')).toEqual({
      date: '2026-11-13',
      time: '23:00',
      weekday: 'fri',
    });
  });

  it('follows the clock change on the date asked about', () => {
    expect(
      zonedWallTimeToUtc('2026-07-01', '09:00', 'Europe/London').toISOString(),
    ).toBe('2026-07-01T08:00:00.000Z');
    expect(
      zonedWallTimeToUtc('2026-12-01', '09:00', 'Europe/London').toISOString(),
    ).toBe('2026-12-01T09:00:00.000Z');
    // 02:30 doesn't exist on the spring-forward night: it moves past the gap.
    expect(
      zonedWallTimeToUtc(
        '2026-03-08',
        '02:30',
        'America/New_York',
      ).toISOString(),
    ).toBe('2026-03-08T07:30:00.000Z');
  });

  it('refuses what is not a date, a time or a zone', () => {
    expect(zonedWallTimeToUtc('2026-02-31', '09:00', 'UTC')).toBeNull();
    expect(zonedWallTimeToUtc('2026-02-10', '25:00', 'UTC')).toBeNull();
    expect(zonedWallTimeToUtc('', '09:00', 'UTC')).toBeNull();
    expect(zonedWallTimeToUtc('2026-02-10', '09:00', 'Not/AZone')).toBeNull();
    expect(zonedWallTime('nope', 'UTC')).toBeNull();
    expect(zonedWallTime(Date.now(), 'Not/AZone')).toBeNull();
  });
});
