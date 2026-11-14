// Notes on the charts: a day and a few words ("Changed my handle", "The
// zine went out"), kept per account in this browser and drawn on every
// time-series chart at the bucket holding that day. And the milestones the
// follower curve passes on its own (1,000, 5,000, …), which nobody has to
// write down.
//
// Pure, apart from the two functions that touch localStorage.

import { bucketLabel, bucketStartMs } from '../lib/analytics.js';
import { fmtInt } from '../lib/locale.js';
import { dayKey, dayStartMs } from '../lib/periods.js';

export const ANNOTATION_LABEL_MAX = 80;
export const ANNOTATIONS_MAX = 200;

export function annotationsKey(did) {
  return `virga:annotations:${did}`;
}

function storage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Stored notes, checked: `[{ id, day, label }]`, oldest day first. */
export function cleanAnnotations(raw) {
  const seen = new Set();
  const out = [];
  for (const a of Array.isArray(raw) ? raw : []) {
    const label = typeof a?.label === 'string' ? a.label.trim().slice(0, ANNOTATION_LABEL_MAX) : '';
    if (!label || typeof a.id !== 'string' || seen.has(a.id) || !Number.isFinite(dayStartMs(a.day))) continue;
    seen.add(a.id);
    out.push({ id: a.id, day: a.day, label });
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0)).slice(-ANNOTATIONS_MAX);
}

export function readAnnotations(did, store = storage()) {
  try {
    return cleanAnnotations(JSON.parse(store?.getItem(annotationsKey(did)) || '[]'));
  } catch {
    return [];
  }
}

export function writeAnnotations(did, list, store = storage()) {
  try {
    store?.setItem(annotationsKey(did), JSON.stringify(cleanAnnotations(list)));
  } catch {
    // A full or refused localStorage costs the note on reload, nothing else.
  }
}

/** The list with a note added. An empty label or a day that isn't one changes nothing. */
export function addAnnotation(list, { day, label, id = `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}` }) {
  const next = cleanAnnotations([...(list || []), { id, day, label }]);
  return next.some((a) => a.id === id) ? next : list || [];
}

export function removeAnnotation(list, id) {
  return (list || []).filter((a) => a.id !== id);
}

/* ------------------------------------------------------------------ */
/* Milestones                                                           */
/* ------------------------------------------------------------------ */

/** 100, 250, 500, 1,000, 2,500, 5,000, … up to `max`. */
export function milestoneSteps(max) {
  const out = [];
  for (let base = 100; base <= max; base *= 10) {
    for (const k of [1, 2.5, 5]) {
      if (base * k <= max) out.push(base * k);
    }
  }
  return out;
}

/**
 * The day the follower count reached each round number, from the followers
 * the account has today, each dated by their follow record: the Nth of them
 * to arrive marks N. People who followed and have since left aren't in the
 * list, so the real count got there on that day or before it; the reports
 * say so. Followers with no readable date are counted from the start.
 *
 * @returns {Array<{ t: number, count: number, label: string, kind: 'milestone' }>}
 */
export function followerMilestones(followers) {
  const times = [];
  let undated = 0;
  for (const f of followers || []) {
    const t = Date.parse(f?.followedAt || '');
    if (Number.isFinite(t)) times.push(t);
    else undated += 1;
  }
  times.sort((a, b) => a - b);
  const out = [];
  for (const count of milestoneSteps(times.length + undated)) {
    const index = count - undated - 1;
    if (index < 0) continue; // reached before anything that can be dated
    out.push({ t: times[index], count, label: `${fmtInt(count)} followers`, kind: 'milestone' });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Onto a chart                                                         */
/* ------------------------------------------------------------------ */

/** A note as a mark: the middle of its day, so no time zone edge moves it. */
export function noteMark(annotation) {
  return { t: dayStartMs(annotation.day) + 43_200_000, label: annotation.label, kind: 'note', id: annotation.id };
}

/**
 * Where marks land on a series: for each bucket that holds any, its index
 * and what to say there. `series` is `[{ t }]` (bucket starts), `unit` its
 * bucket size. Marks outside the series are left out.
 *
 * @returns {Array<{ i: number, t: number, kind: 'milestone'|'note', items: Array<{ label, kind }> }>}
 */
export function marksOnSeries(series, unit, marks) {
  if (!series?.length || !marks?.length) return [];
  const index = new Map(series.map((p, i) => [p.t, i]));
  const byBucket = new Map();
  for (const mark of marks) {
    if (!Number.isFinite(mark?.t)) continue;
    const i = index.get(bucketStartMs(mark.t, unit));
    if (i == null) continue;
    if (!byBucket.has(i)) byBucket.set(i, { i, t: series[i].t, kind: mark.kind, items: [] });
    const bucket = byBucket.get(i);
    bucket.items.push({ label: mark.label, kind: mark.kind });
    // A bucket holding a note reads as a note: that one was put there by hand.
    if (mark.kind === 'note') bucket.kind = 'note';
  }
  return [...byBucket.values()].sort((a, b) => a.i - b.i);
}

/** "Oct 3: 5,000 followers; Changed my handle": a bucket's marks in words. */
export function markText(mark, unit) {
  return `${bucketLabel(mark.t, unit)}: ${mark.items.map((m) => m.label).join('; ')}`;
}

/** Today as a 'YYYY-MM-DD' day, for a date field's default and its max. */
export function todayKey(now = Date.now()) {
  return dayKey(now);
}
