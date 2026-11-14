// Suggested posting times for the weekly schedule, from the account's own
// best times to post (reports/models.js bestTimeModel: the hours its typical
// post did best, in this device's zone). Never applied without asking: a
// week still at the shipped default may be replaced by them, any other week
// only has them added. Pure.

import { WEEKDAYS, resolveTimezone } from './postingQueue.js';

const DAY_KEYS = WEEKDAYS.map((d) => d.key);

/**
 * bestTimeModel's `best` cells as schedule times: `[{ dayKey, time }]`, one
 * per cell, at the start of its block of hours. `day` is 0 for Monday.
 *
 * @param {Array<{ day: number, col: number }>} best
 * @param {number} block - hours per column, as the model was built
 */
export function suggestionsFromBestTimes(best = [], block = 1) {
  const out = [];
  const seen = new Set();
  for (const cell of best || []) {
    const dayKey = DAY_KEYS[cell?.day];
    const hour = Number(cell?.col) * Number(block);
    if (!dayKey || !Number.isInteger(hour) || hour < 0 || hour > 23) continue;
    const time = `${String(hour).padStart(2, '0')}:00`;
    const key = `${dayKey} ${time}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ dayKey, time });
  }
  return out;
}

/** The suggestions the week doesn't have yet. */
export function missingSuggestions(schedule, suggestions = []) {
  const slots = schedule?.slots || {};
  return (suggestions || []).filter(
    (s) => !(slots[s.dayKey] || []).includes(s.time),
  );
}

/** The week with the suggested times added; nothing already there moves. */
export function mergeSuggestionsIntoSchedule(schedule, suggestions = []) {
  const base = schedule && typeof schedule === 'object' ? schedule : {};
  const slots = { ...(base.slots || {}) };
  for (const s of suggestions || []) {
    const existing = slots[s.dayKey] || [];
    if (!existing.includes(s.time))
      slots[s.dayKey] = [...existing, s.time].sort();
  }
  return {
    ...base,
    timezone: typeof base.timezone === 'string' ? base.timezone : '',
    slots,
  };
}

/**
 * A week of the suggested times alone, set in this device's zone (the zone
 * the best times were read in).
 */
export function scheduleFromSuggestions(suggestions = [], timezone) {
  const empty = Object.fromEntries(DAY_KEYS.map((k) => [k, []]));
  return mergeSuggestionsIntoSchedule(
    { timezone: timezone || resolveTimezone(null), slots: empty },
    suggestions,
  );
}
