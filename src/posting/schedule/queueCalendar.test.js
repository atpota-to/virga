import { describe, it, expect } from 'vitest';
import { buildCalendarDays, compactTime } from './queueCalendar.js';

// Times are built in the schedule's timezone but bucketed by local day, which
// is where an off-by-one would hide.

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

// A Wednesday, mid-morning.
const NOW = new Date(2026, 7, 12, 10, 0, 0);

const schedule = (slots) => ({ timezone: TZ, slots });

const rowAt = (id, date) => ({
  id,
  scheduledFor: date.toISOString(),
  queued: true,
  status: 'pending',
  payload: { posts: [{ record: { text: `post ${id}` } }] },
});

describe('buildCalendarDays', () => {
  it('returns one column per day, starting today', () => {
    const { days } = buildCalendarDays(schedule({}), [], 7, NOW);
    expect(days).toHaveLength(7);
    expect(days[0].date.getDate()).toBe(12);
    expect(days[6].date.getDate()).toBe(18);
  });

  it('has no slots at all when the weekly schedule is empty', () => {
    const { days } = buildCalendarDays(schedule({}), [], 7, NOW);
    expect(days.every((d) => d.slots.length === 0)).toBe(true);
  });

  it('lays the weekly times onto the days they fall on', () => {
    // Wednesday 09:00 + 17:00, Friday 12:00.
    const { days } = buildCalendarDays(
      schedule({ wed: ['09:00', '17:00'], fri: ['12:00'] }),
      [],
      7,
      NOW,
    );
    const today = days[0];
    // 09:00 today has already passed at 10:00 — only the 17:00 slot is left.
    expect(today.slots.map((s) => compactTime(s.at))).toEqual(['5p']);
    expect(days[2].slots.map((s) => compactTime(s.at))).toEqual(['12p']);
    // The window is Wed→Tue, so this Wednesday is the only one in it.
    const laterWed = days.find((d, i) => i > 0 && d.date.getDay() === 3);
    expect(laterWed).toBeUndefined();
  });

  it('marks the slot a queued post occupies and leaves the rest open', () => {
    const wed5pm = new Date(2026, 7, 12, 17, 0, 0);
    const { days } = buildCalendarDays(
      schedule({ wed: ['17:00'], thu: ['09:00'] }),
      [rowAt('a', wed5pm)],
      7,
      NOW,
    );
    expect(days[0].slots[0].row?.id).toBe('a');
    expect(days[1].slots[0].row).toBeNull();
  });

  it('still shows a queued post whose time no longer matches a slot', () => {
    const oddTime = new Date(2026, 7, 13, 6, 30, 0);
    const { days } = buildCalendarDays(
      schedule({ thu: ['09:00'] }),
      [rowAt('b', oddTime)],
      7,
      NOW,
    );
    const thursday = days[1];
    expect(thursday.slots).toHaveLength(2);
    // Sorted by time, so the 6:30 stray lands before the 9:00 slot.
    expect(thursday.slots[0].row?.id).toBe('b');
    expect(thursday.slots[0].offSchedule).toBe(true);
    expect(thursday.slots[1].row).toBeNull();
  });

  it('keeps every slot on the spring-forward day, in order', () => {
    // 2026-03-08 is the US spring-forward Sunday. The 02:30 slot resolves to
    // 03:30 EDT, behind the 03:00 one — the calendar clips on the first slot
    // past its window, so a pair out of order would drop one of them.
    const springForward = new Date('2026-03-08T05:00:00Z');
    const { days } = buildCalendarDays(
      {
        timezone: 'America/New_York',
        slots: { sun: ['01:45', '02:30', '03:00', '04:00'] },
      },
      [],
      7,
      springForward,
    );
    const all = days.flatMap((d) => d.slots.map((s) => s.at.toISOString()));
    expect(all).toEqual([
      '2026-03-08T06:45:00.000Z',
      '2026-03-08T07:00:00.000Z',
      '2026-03-08T07:30:00.000Z',
      '2026-03-08T08:00:00.000Z',
    ]);
  });

  it('counts posts past the window rather than dropping them silently', () => {
    const farOut = new Date(2026, 7, 30, 9, 0, 0);
    const { days, laterCount } = buildCalendarDays(
      schedule({ wed: ['09:00'] }),
      [rowAt('c', farOut)],
      7,
      NOW,
    );
    expect(laterCount).toBe(1);
    expect(days.every((d) => d.slots.every((s) => !s.row))).toBe(true);
  });
});

describe('compactTime', () => {
  it('drops :00 and uses a single-letter meridiem', () => {
    expect(compactTime(new Date(2026, 7, 12, 9, 0))).toBe('9a');
    expect(compactTime(new Date(2026, 7, 12, 17, 30))).toBe('5:30p');
    expect(compactTime(new Date(2026, 7, 12, 0, 0))).toBe('12a');
    expect(compactTime(new Date(2026, 7, 12, 12, 5))).toBe('12:05p');
  });
});
