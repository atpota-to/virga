// The days ahead as a calendar: one column per day, one cell per weekly
// slot, with queued rows matched onto the minute they go out. Slots come from
// enumerateSlots, the same walk the queue packs with. Pure; the page draws it.

import {
  enumerateSlots,
  isScheduleEmpty,
  resolveTimezone,
} from './postingQueue.js';

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function dayKey(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
}

function minuteKey(value) {
  return Math.floor(new Date(value).getTime() / 60000);
}

/** '9a' / '5:30p': short enough to sit inside a slot cell on a phone. */
export function compactTime(d) {
  const date = new Date(d);
  const h = date.getHours();
  const m = date.getMinutes();
  const h12 = ((h + 11) % 12) + 1;
  const suffix = h < 12 ? 'a' : 'p';
  return m === 0
    ? `${h12}${suffix}`
    : `${h12}:${String(m).padStart(2, '0')}${suffix}`;
}

/**
 * `dayCount` days from today (this device's days) × the slots on each, with
 * queued rows matched onto their minute. A row whose time matches no slot
 * (the schedule changed under it) gets its own `offSchedule` cell on its day;
 * rows beyond the window are counted in `laterCount`.
 *
 * @returns {{ days: Array<{ date: Date, key: string, slots: Array<{ at: Date, minute: number, row: object|null, offSchedule?: true }> }>, laterCount: number, claimedCount: number }}
 */
export function buildCalendarDays(
  schedule,
  rows = [],
  dayCount = 7,
  now = new Date(),
) {
  const first = startOfDay(now);
  const days = [];
  for (let i = 0; i < dayCount; i++) {
    const date = new Date(first);
    date.setDate(first.getDate() + i);
    days.push({ date, key: dayKey(date), slots: [] });
  }
  const byKey = new Map(days.map((d) => [d.key, d]));
  const windowEnd = new Date(first);
  windowEnd.setDate(first.getDate() + dayCount);

  if (!isScheduleEmpty(schedule)) {
    // enumerateSlots yields ascending instants, so the first past the window
    // ends the walk.
    for (const slot of enumerateSlots(schedule, now.getTime())) {
      const t = slot.getTime();
      if (t >= windowEnd.getTime()) break;
      if (t <= now.getTime()) continue;
      const day = byKey.get(dayKey(slot));
      if (day) day.slots.push({ at: slot, minute: minuteKey(t), row: null });
    }
  }

  const claimed = new Set();
  const slotsByMinute = new Map();
  for (const day of days) {
    for (const slot of day.slots)
      if (!slotsByMinute.has(slot.minute)) slotsByMinute.set(slot.minute, slot);
  }
  let laterCount = 0;
  for (const row of rows || []) {
    const when = new Date(row.scheduledFor);
    const minute = minuteKey(when);
    const slot = slotsByMinute.get(minute);
    if (slot && !slot.row) {
      slot.row = row;
      claimed.add(row.id);
      continue;
    }
    const day = byKey.get(dayKey(when));
    if (day && when.getTime() > now.getTime()) {
      day.slots.push({ at: when, minute, row, offSchedule: true });
      claimed.add(row.id);
    } else {
      laterCount += 1;
    }
  }
  for (const day of days) day.slots.sort((a, b) => a.at - b.at);

  return { days, laterCount, claimedCount: claimed.size };
}

/**
 * The zones a calendar footer names: where the cells are drawn (this
 * device), and where the week was set when that differs.
 */
export function calendarZones(schedule) {
  const device = resolveTimezone(null);
  const set = resolveTimezone(schedule);
  return { device, set, differs: device !== set };
}
