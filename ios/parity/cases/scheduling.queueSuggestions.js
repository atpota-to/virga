// src/posting/schedule/queueSuggestions.js: the account's best times to post
// as weekly slots, and placing them in a week (what it lacks, added in
// order, a week of them alone). Swift:
// VirgaPosting/Schedule/QueueSuggestions.swift.
//
// Inputs from queueSuggestions.test.js, plus cells the web reads by property
// key ('1', [1], -0), columns and blocks through Number(), hours off the
// clock, repeats, loose weeks (no slots, an array, unsorted and non-string
// times, a substring match on a string day, days whose times have no
// `includes`, suggestions without a time) and the device's zone where the
// week names none.

import {
  mergeSuggestionsIntoSchedule,
  missingSuggestions,
  scheduleFromSuggestions,
  suggestionsFromBestTimes,
} from '../../../src/posting/schedule/queueSuggestions.js';
import { each, inZone } from './_helpers.js';

export const sources = ['src/posting/schedule/queueSuggestions.js'];

const bestInputs = [
  {
    best: [
      { day: 0, col: 9, avg: 12, posts: 4 },
      { day: 6, col: 20, avg: 9, posts: 3 },
    ],
    block: 1,
  },
  { best: [{ day: 2, col: 9 }], block: 2 },
  { best: [{ day: 2, col: 9 }], block: 3 },
  { best: [{ day: 2, col: 9 }], block: 4 },
  {
    best: [
      { day: 9, col: 1 },
      { day: 1, col: 30 },
      null,
      { day: 1, col: 3 },
      { day: 1, col: 3 },
    ],
    block: 1,
  },
  {},
  { best: null },
  { best: [] },
  { best: [{ day: '1', col: '7' }] },
  { best: [{ day: [3], col: [8] }] },
  { best: [{ day: -0, col: 0 }] },
  { best: [{ day: 1.5, col: 3 }] },
  { best: [{ day: '01', col: 3 }] },
  { best: [{ day: true, col: 3 }] },
  { best: [{ day: null, col: 3 }] },
  { best: [{ day: 4, col: 23 }] },
  { best: [{ day: 4, col: 24 }] },
  { best: [{ day: 4, col: -1 }] },
  { best: [{ day: 4, col: 2.5 }] },
  { best: [{ day: 4, col: 2.5 }], block: 2 },
  { best: [{ day: 4, col: 'x' }] },
  { best: [{ day: 4, col: null }] },
  { best: [{ day: 4 }] },
  { best: [{ day: 5, col: 6 }], block: '2' },
  { best: [{ day: 5, col: 6 }], block: null },
  { best: [{ day: 5, col: 6 }], block: 0 },
  { best: [{ day: 5, col: 6 }], block: -1 },
  { best: [{ day: 5, col: 6 }], block: 0.5 },
  {
    best: [
      { day: 0, col: 1 },
      { day: 0, col: 1.0 },
      { day: '0', col: '1' },
      { day: 0, col: 2 },
    ],
  },
  { best: 'mon' },
  { best: 5 },
  { best: { day: 0, col: 9 } },
  {
    best: Array.from({ length: 30 }, (_, i) => ({
      day: i % 7,
      col: (i * 5) % 26,
    })),
  },
];

const WEEK = {
  timezone: 'Europe/Paris',
  slots: { mon: ['09:00'], fri: ['17:00'] },
};
const PICKS = [
  { dayKey: 'mon', time: '09:00' },
  { dayKey: 'mon', time: '07:00' },
  { dayKey: 'sat', time: '11:00' },
];

const weeks = [
  WEEK,
  null,
  undefined,
  {},
  { slots: null },
  { timezone: 'Asia/Kolkata', slots: { mon: [], tue: ['09:00', '07:00'] } },
  { timezone: 5, slots: { mon: ['09:00'] } },
  { slots: { mon: 'x09:00y' } },
  { slots: { mon: ['23:00', 9, '08:00', null] } },
  { slots: ['a', 'b'] },
  [1, 2],
  'week',
  { timezone: '', slots: { sun: ['12:00'] }, extra: true },
  // Days whose times have no `includes`: the web throws a TypeError, or
  // reads a falsy day as none.
  { slots: { mon: 5 } },
  { slots: { mon: { a: 1 } } },
  { slots: { mon: true } },
  { slots: { mon: false, tue: 0 } },
];

const pickSets = [
  PICKS,
  [],
  null,
  [
    { dayKey: 'sun', time: '23:59' },
    { dayKey: 'sun', time: '00:00' },
    { dayKey: 'sun', time: '00:00' },
  ],
  [{ dayKey: 'tue', time: '07:00' }],
  [{ dayKey: 'mon', time: '09:00' }],
  [{ dayKey: 'holiday', time: '10:00' }],
  [{ dayKey: 'mon', time: 9 }],
  [{ dayKey: 'mon' }],
  [{ time: '10:00' }],
  [null],
  [{ dayKey: '0', time: '10:00' }],
  // Times left out: one `undefined` a day, sorted last.
  [{ dayKey: 'mon' }, { dayKey: 'mon' }],
  [{ dayKey: 'mon' }, { dayKey: 'mon', time: '08:00' }, { dayKey: 'mon' }],
  [5, 'ab'],
];

const missingInputs = [];
const mergeInputs = [];
for (const schedule of weeks) {
  for (const suggestions of pickSets) {
    missingInputs.push({ schedule, suggestions });
    mergeInputs.push({ schedule, suggestions });
  }
}
missingInputs.push({ schedule: WEEK, suggestions: 'mon' });
missingInputs.push({ schedule: WEEK, suggestions: { 0: PICKS[0] } });
mergeInputs.push({ schedule: WEEK, suggestions: 5 });
mergeInputs.push({ schedule: WEEK, suggestions: { 0: PICKS[0] } });
mergeInputs.push({ schedule: WEEK, suggestions: 'ab' });

const ZONES = ['UTC', 'America/Chicago', 'Asia/Kolkata', 'Pacific/Chatham'];

const freshInputs = [];
for (const tz of ZONES) {
  freshInputs.push({ tz, suggestions: PICKS, timezone: 'America/Chicago' });
  freshInputs.push({ tz, suggestions: PICKS });
  freshInputs.push({ tz, suggestions: [] });
  freshInputs.push({ tz });
}
freshInputs.push({ tz: 'UTC', suggestions: PICKS, timezone: '' });
freshInputs.push({ tz: 'UTC', suggestions: PICKS, timezone: 7 });
freshInputs.push({
  tz: 'UTC',
  suggestions: [{ dayKey: 'funday', time: '10:00' }],
  timezone: 'UTC',
});

export default async function cases() {
  return [
    ...(await each('suggestionsFromBestTimes', bestInputs, (input) =>
      'block' in input
        ? suggestionsFromBestTimes(input.best, input.block)
        : suggestionsFromBestTimes(input.best),
    )),
    ...(await each('missingSuggestions', missingInputs, (input) =>
      missingSuggestions(input.schedule, input.suggestions),
    )),
    ...(await each('mergeSuggestionsIntoSchedule', mergeInputs, (input) =>
      mergeSuggestionsIntoSchedule(input.schedule, input.suggestions),
    )),
    ...(await each('scheduleFromSuggestions', freshInputs, (input) =>
      inZone(input.tz, () =>
        scheduleFromSuggestions(input.suggestions, input.timezone),
      ),
    )),
  ];
}
