// Number and axis formatting shared by every chart, figure and table.

import { fmtCompact } from '../lib/analytics.js';

/**
 * A clean axis around [min, max]: pick a 1/2/2.5/5×10ⁿ step near a quarter of
 * the span, then floor/ceil the bounds onto it. Bars pass min=0 and keep it
 * (0 floors to 0); lines get a floor near their data instead of a flat wire
 * pinned to zero.
 */
export function niceScale(min, max) {
  if (max <= min) max = min + 1;
  const rawStep = (max - min) / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= rawStep) || 10 * mag;
  return { min: Math.floor(min / step) * step, max: Math.ceil(max / step) * step, step };
}

export function uniqueTicks(list) {
  const out = [];
  for (const v of list) {
    const r = Math.round(v * 100) / 100;
    if (!out.includes(r)) out.push(r);
  }
  // Counts are integers; a fractional midpoint (0.5 on a 0–1 axis) would
  // round to a duplicate of a neighbour and read as a doubled label.
  return out.filter((v) => Number.isInteger(v) || v >= 10);
}

/** Axis-tick formatting: compact like the figures, but honest about halves. */
export function fmtTick(v) {
  return Number.isInteger(v) ? fmtCompact(v) : String(Math.round(v * 10) / 10);
}

export function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/** A count as the charts write it: whole, with thousands separators. */
export function fmtCount(v) {
  return v == null ? '—' : Math.round(v).toLocaleString('en-US');
}

/** A rate (engagement per post): one decimal while small; words for none. */
export function fmtRate(v) {
  if (v == null) return 'no posts';
  return v < 10 ? (Math.round(v * 10) / 10).toLocaleString('en-US') : Math.round(v).toLocaleString('en-US');
}

/** A number for a figure: whole with separators, or one decimal while small. */
export function fmtFigure(v, { decimals = false } = {}) {
  if (v == null || Number.isNaN(v)) return '—';
  if (decimals && Math.abs(v) < 10) return (Math.round(v * 10) / 10).toLocaleString('en-US');
  return Math.round(v).toLocaleString('en-US');
}

/** "Daily", "Weekly", "Monthly", for a unit key. */
export function unitLabel(unit) {
  return unit === 'month' ? 'Monthly' : unit === 'week' ? 'Weekly' : 'Daily';
}

/** The noun form, for titles: "Posts per day", never "per daily". */
export function unitNoun(unit) {
  return unit === 'month' ? 'month' : unit === 'week' ? 'week' : 'day';
}

/** A change in percent, as a delta chip reads it: "+12%", "−4%", "new". */
export function deltaText(pct) {
  if (pct == null) return 'new';
  if (pct === 0) return '0%';
  const v = Math.abs(pct) >= 10 ? Math.round(Math.abs(pct)) : Math.round(Math.abs(pct) * 10) / 10;
  return `${pct > 0 ? '+' : '−'}${v.toLocaleString('en-US')}%`;
}
