// src/posting/schedule/queueCalendar.js: the days ahead as a calendar, one
// column a day on this device's clock and a cell per weekly slot, queued
// rows matched onto their minute (buildCalendarDays); a slot's short time
// (compactTime); the zones the footer names (calendarZones). Swift:
// VirgaPosting/Schedule/QueueCalendar.swift.
//
// The calendar buckets by this device's day, so every case runs in the zone
// it names (`tz`), across clock changes: New York's spring forward and fall
// back, London's, Lord Howe's half hour, Chatham's 2:45 and Havana's, whose
// midnight doesn't exist on the day it springs forward. Inputs from
// queueCalendar.test.js, plus rows on a taken minute, off the schedule,
// past, beyond the window or unreadable, and schedules set in another zone.

import {
  buildCalendarDays,
  calendarZones,
  compactTime,
} from '../../../src/posting/schedule/queueCalendar.js';
import { each, inZone } from './_helpers.js';

export const sources = ['src/posting/schedule/queueCalendar.js'];

const ZONES = [
  'UTC',
  'America/New_York',
  'Europe/London',
  'Asia/Kolkata',
  'Australia/Lord_Howe',
  'Pacific/Chatham',
  'America/Havana',
];

const WEEKDAY_9_5 = {
  timezone: '',
  slots: {
    mon: ['09:00', '17:00'],
    tue: ['09:00', '17:00'],
    wed: ['09:00', '17:00'],
    thu: ['09:00', '17:00'],
    fri: ['09:00', '17:00'],
    sat: [],
    sun: [],
  },
};
const EVERY_DAY = {
  slots: Object.fromEntries(
    ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((k) => [
      k,
      ['00:00', '02:30', '02:45', '23:45'],
    ]),
  ),
};
const TOKYO = {
  timezone: 'Asia/Tokyo',
  slots: { mon: ['08:00'], wed: ['20:00'], sat: ['06:30'] },
};

const SCHEDULES = [
  ['weekdays', WEEKDAY_9_5],
  ['every-day', EVERY_DAY],
  ['tokyo', TOKYO],
  ['empty', { slots: {} }],
  ['null', null],
];

// Moments: ordinary days, the eves and days of clock changes.
const NOWS = [
  ['mid-march', '2026-03-12T15:20:00Z'],
  ['ny-spring', '2026-03-07T20:00:00Z'],
  ['ny-fall', '2026-10-31T18:00:00Z'],
  ['london-spring', '2026-03-28T23:30:00Z'],
  ['lord-howe', '2026-10-03T13:00:00Z'],
  ['chatham', '2026-09-26T10:00:00Z'],
  ['havana', '2026-03-07T12:00:00Z'],
  ['late-evening', '2026-07-01T23:59:30Z'],
];

const at = (iso) => new Date(Date.parse(iso)).toISOString();

/** Queued rows around `now`: on slots, off them, doubled, past, far. */
function rowsAround(nowIso) {
  const now = Date.parse(nowIso);
  const h = 3_600_000;
  const day = 86_400_000;
  const iso = (ms) => new Date(ms).toISOString();
  return [
    { id: 'r1', queued: true, scheduledFor: iso(now + 2 * h) },
    { id: 'r2', queued: true, scheduledFor: iso(now + day + 30 * 60_000) },
    { id: 'r3', queued: true, scheduledFor: iso(now - h) },
    { id: 'r4', queued: true, scheduledFor: iso(now + 20 * day) },
    { id: 'r5', queued: true, scheduledFor: 'garbage' },
    { id: 'r6', queued: true, scheduledFor: null },
    { queued: true, scheduledFor: iso(now + 3 * day) },
    { queued: true, scheduledFor: iso(now + 3 * day + 7 * 60_000) },
  ];
}

/** Rows on the exact minutes a schedule's walk gives (and a twin on one). */
function rowsOnSlots(schedule, nowIso, tz) {
  const now = new Date(nowIso);
  const first = inZone(tz, () => buildCalendarDays(schedule, [], 7, now));
  const slots = first.days
    .flatMap((d) => d.slots)
    .map((s) => s.at.toISOString());
  const out = slots
    .slice(0, 5)
    .map((s, i) => ({ id: `s${i}`, queued: true, scheduledFor: s }));
  if (slots[1]) {
    out.push({ id: 'twin', queued: true, scheduledFor: slots[1] });
    out.push({
      id: 'seconds-in',
      queued: true,
      scheduledFor: new Date(
        Date.parse(slots[2] || slots[1]) + 42_000,
      ).toISOString(),
    });
  }
  out.push({ id: 'local', queued: true, scheduledFor: '2026-03-13T09:00' });
  return out;
}

// Each zone at its own clock changes, and on an ordinary day.
const MOMENTS = {
  UTC: ['mid-march', 'late-evening', 'ny-fall'],
  'America/New_York': ['mid-march', 'ny-spring', 'ny-fall', 'late-evening'],
  'Europe/London': ['london-spring', 'ny-fall'],
  'Asia/Kolkata': ['mid-march', 'late-evening'],
  'Australia/Lord_Howe': ['lord-howe', 'mid-march'],
  'Pacific/Chatham': ['chatham', 'late-evening'],
  'America/Havana': ['havana', 'ny-fall'],
};

const buildInputs = [];
for (const tz of ZONES) {
  for (const [nowName, now] of NOWS.filter(([n]) => MOMENTS[tz].includes(n))) {
    for (const [name, schedule] of SCHEDULES) {
      buildInputs.push({
        $id: `${tz} ${nowName} ${name}`,
        tz,
        schedule,
        rows:
          name === 'null' ? rowsAround(now) : rowsOnSlots(schedule, now, tz),
        dayCount: 7,
        now: at(now),
      });
    }
  }
}
for (const tz of ['UTC', 'America/New_York', 'America/Havana']) {
  const now = '2026-03-07T12:00:00Z';
  for (const dayCount of [0, 1, 3, 14, 2.5, -2]) {
    buildInputs.push({
      $id: `${tz} days ${dayCount}`,
      tz,
      schedule: WEEKDAY_9_5,
      rows: rowsAround(now),
      dayCount,
      now: at(now),
    });
  }
  buildInputs.push({
    $id: `${tz} no rows`,
    tz,
    schedule: EVERY_DAY,
    dayCount: 2,
    now: at(now),
  });
  buildInputs.push({
    $id: `${tz} bad slot`,
    tz,
    schedule: { slots: { sun: ['nine', '25:00', '10:5', '09:00'], mon: 'x' } },
    rows: [],
    dayCount: 3,
    now: at(now),
  });
  buildInputs.push({
    $id: `${tz} bad zone`,
    tz,
    schedule: { timezone: 'Nowhere/Land', slots: { mon: ['09:00'] } },
    rows: [],
    dayCount: 3,
    now: at(now),
  });
}

const compactInputs = [];
for (const tz of [
  'UTC',
  'America/New_York',
  'Asia/Kolkata',
  'Pacific/Chatham',
]) {
  for (const iso of [
    '2026-03-12T00:00:00Z',
    '2026-03-12T09:00:00Z',
    '2026-03-12T09:05:00Z',
    '2026-03-12T12:00:00Z',
    '2026-03-12T12:30:00Z',
    '2026-03-12T17:30:00Z',
    '2026-03-12T23:59:00Z',
    '2026-03-12T18:45:00Z',
    '2026-03-08T07:30:00Z',
  ])
    compactInputs.push({ tz, d: iso });
  compactInputs.push({ tz, d: 'not a date' });
  compactInputs.push({ tz, d: '2026-03-12T05:07' });
  compactInputs.push({ tz, d: Date.parse('2026-03-12T21:15:00Z') });
}

const zoneInputs = [];
for (const tz of ['UTC', 'America/New_York', 'Asia/Kolkata']) {
  for (const schedule of [
    null,
    {},
    { timezone: '' },
    { timezone: 'America/New_York' },
    { timezone: 'Asia/Calcutta' },
    { timezone: 'Asia/Kolkata' },
    { timezone: 'UTC' },
  ])
    zoneInputs.push({ tz, schedule });
}

export default async function cases() {
  return [
    ...(await each(
      'buildCalendarDays',
      buildInputs,
      ({ tz, schedule, rows, dayCount, now }) =>
        inZone(tz, () =>
          buildCalendarDays(schedule, rows, dayCount, new Date(now)),
        ),
    )),
    ...(await each('compactTime', compactInputs, ({ tz, d }) =>
      inZone(tz, () => compactTime(d)),
    )),
    ...(await each('calendarZones', zoneInputs, ({ tz, schedule }) =>
      inZone(tz, () => calendarZones(schedule)),
    )),
  ];
}
