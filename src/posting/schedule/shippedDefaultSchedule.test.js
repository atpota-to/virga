import { describe, it, expect } from 'vitest';

// `isShippedDefaultSchedule`: is this posting week still the placeholder
// (Mon–Fri at 09:00 and 17:00, before anyone edits it)? Suggested times
// replace a placeholder but are only added to a chosen week.
//
// `isShippedDefaultSchedule({})` is false, so a caller reading
// `!isShippedDefaultSchedule(slots)` as "they set their own hours" must first
// check the settings record has loaded.

import {
  DEFAULT_POSTING_QUEUE,
  isShippedDefaultSchedule,
  WEEKDAYS,
} from './postingQueue.js';
import { defaultPostingSettings } from '../settings.js';

const SHIPPED = DEFAULT_POSTING_QUEUE.slots;

// A fresh deep copy each time, so a test can't mutate the defaults module.
const shippedCopy = () =>
  Object.fromEntries(
    WEEKDAYS.map(({ key }) => [key, [...(SHIPPED[key] || [])]]),
  );

describe('isShippedDefaultSchedule', () => {
  it('recognises the week as it ships', () => {
    expect(isShippedDefaultSchedule(shippedCopy())).toBe(true);
    // And the defaults object itself, not just a copy of it.
    expect(isShippedDefaultSchedule(SHIPPED)).toBe(true);
  });

  it('ignores the order times are stored in', () => {
    // An editor may append and suggestions merge, so a day's times are not
    // reliably sorted. Reordering is not a decision.
    const slots = shippedCopy();
    slots.mon = [...slots.mon].reverse();
    expect(slots.mon).not.toEqual(SHIPPED.mon);
    expect(isShippedDefaultSchedule(slots)).toBe(true);
  });

  it('sees a moved hour', () => {
    const slots = shippedCopy();
    slots.wed = ['08:30', '17:00'];
    expect(isShippedDefaultSchedule(slots)).toBe(false);
  });

  it('sees an added hour', () => {
    const slots = shippedCopy();
    slots.sat = ['11:00'];
    expect(isShippedDefaultSchedule(slots)).toBe(false);
  });

  it('sees a removed hour', () => {
    const slots = shippedCopy();
    slots.fri = ['09:00'];
    expect(isShippedDefaultSchedule(slots)).toBe(false);
  });

  it('sees a cleared week', () => {
    // Deliberately emptying the schedule is a decision too — the queue stops
    // placing posts. It must not read as untouched.
    const slots = Object.fromEntries(WEEKDAYS.map(({ key }) => [key, []]));
    expect(isShippedDefaultSchedule(slots)).toBe(false);
  });

  it('says no to an absent or empty slots object', () => {
    // Not "untouched"; see the note at the top of this file.
    expect(isShippedDefaultSchedule({})).toBe(false);
    expect(isShippedDefaultSchedule(undefined)).toBe(false);
    expect(isShippedDefaultSchedule(null)).toBe(false);
  });
});

describe('the shipped week', () => {
  it('is the week a new account’s posting settings start with', () => {
    expect(
      isShippedDefaultSchedule(
        defaultPostingSettings({ language: 'en' }).queue.slots,
      ),
    ).toBe(true);
  });
});
