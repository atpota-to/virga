// Number and axis formatting shared by every chart, figure and table.

import { bucketLabel, fmtCompact, movingAverage } from '../lib/analytics.js';
import { activeLocale } from '../lib/locale.js';

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

/** The most rules a chart draws across its plot, the baseline included. */
const MAX_TICKS = 4;

/**
 * A chart's y scale and the values it rules a line at, shared by the chart
 * on the page and the picture of it, so the two read the same.
 *
 * The scale runs from niceScale's floor (zero, for bars) to 8% over the
 * data: for bars that is the tallest × 1.08 (or the trend, if it rides
 * higher), so no bar meets the top rule's number; for a line, 8% of its
 * span. The data fills the plot rather than a round number above it.
 *
 * The rules sit on niceScale's own steps (min + k·step) inside that, so
 * every number is a round one; where that would be more than four rules,
 * every other step. A fractional rule under 10 is left out: half a post
 * isn't a place on a count's axis.
 *
 * `labelled` are the rules that carry a number. A zero-based bar chart's
 * baseline carries none: the bars standing on it say where zero is.
 */
export function chartScale(dataMin, dataMax, { zeroBase = true, bars = false } = {}) {
  const top = Math.max(dataMax, zeroBase ? 1 : dataMax);
  const { min, step } = niceScale(zeroBase ? 0 : Math.max(0, dataMin), top);
  const max = top + (top - min) * 0.08;
  const steps = Math.floor((max - min) / step + 1e-9);
  let every = 1;
  while (Math.floor(steps / every) + 1 > MAX_TICKS) every += 1;
  const ticks = [];
  for (let k = 0; k <= steps; k += every) {
    const v = Math.round((min + k * step) * 1e6) / 1e6;
    if (Number.isInteger(v) || v >= 10) ticks.push(v);
  }
  return { min, max, ticks, labelled: bars && zeroBase ? ticks.filter((v) => v !== min) : ticks };
}

/**
 * Which buckets get a date under the chart: the first, the last, and the
 * middle once there are enough buckets that three read as an axis rather
 * than a crowd. `anchor` is where the words hang from the bucket: the ends
 * hang inward, so they never run past the plot.
 */
export function axisStops(series, unit) {
  const n = series.length;
  if (!n) return [];
  const stop = (i, anchor) => ({ i, text: bucketLabel(series[i].t, unit), anchor });
  const out = [stop(0, 'start')];
  if (n >= 5) out.push(stop(Math.floor((n - 1) / 2), 'middle'));
  if (n > 1) out.push(stop(n - 1, 'end'));
  return out;
}

/**
 * What a chart's trend line is called in its legend and readout. Most are
 * the centred seven-bucket moving average (lib/analytics.js), which is named
 * for its window: "7-day average", "7-week average". Any other trend (the
 * engagement rate's rolling rate over five) is just a "Moving average",
 * rather than a window it doesn't have.
 */
export function trendName(series, trend, unit) {
  const seven = movingAverage(series, 7);
  const same = trend.length === seven.length && trend.every((p, i) => p.v != null && Math.abs(p.v - seven[i].v) < 1e-9);
  return same ? `7-${unitNoun(unit)} average` : 'Moving average';
}

/**
 * The step on the ramp for each value, by its rank among the values that
 * aren't zero, spread from the first step to the sixth: the smallest takes
 * step 1 and the largest step 6, however few there are. Shading by rank,
 * not by the share of the largest, keeps one outlier from washing every
 * other cell out to the same pale step; the ramp's legend has no numbers,
 * so it reads the same. Ties share the lower step. Zero is step 0; a null
 * value (too little to say) has none and is drawn as an outline.
 */
export function heatSteps(values) {
  const ranked = values.filter((v) => v != null && v > 0).sort((a, b) => a - b);
  const last = ranked.length - 1;
  const steps = new Map([[0, 0]]);
  ranked.forEach((v, rank) => {
    if (!steps.has(v)) steps.set(v, 1 + Math.floor((last ? rank / last : 1) * 5.999));
  });
  for (const v of values) if (v != null && v < 0) steps.set(v, 0);
  return steps;
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
  return v == null ? '—' : Math.round(v).toLocaleString(activeLocale());
}

/** A rate (engagement per post): one decimal while small; words for none. */
export function fmtRate(v) {
  if (v == null) return 'no posts';
  return v < 10 ? (Math.round(v * 10) / 10).toLocaleString(activeLocale()) : Math.round(v).toLocaleString(activeLocale());
}

/**
 * A share already in percent (3.4 for 3.4%): one decimal while small,
 * whole from ten. A dash where there is nothing to divide by.
 */
export function fmtPercent(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  const n = v < 10 ? Math.round(v * 10) / 10 : Math.round(v);
  return `${n.toLocaleString(activeLocale())}%`;
}

/**
 * An average of counts (a trend's value): one decimal while small, written
 * even when it is nought ("2.0"), so a column of them lines up; whole above ten.
 */
export function fmtAverage(v) {
  if (v == null) return '—';
  if (v < 10) return v.toLocaleString(activeLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return Math.round(v).toLocaleString(activeLocale());
}

/** A number for a figure: whole with separators, or one decimal while small. */
export function fmtFigure(v, { decimals = false } = {}) {
  if (v == null || Number.isNaN(v)) return '—';
  if (decimals && Math.abs(v) < 10) return (Math.round(v * 10) / 10).toLocaleString(activeLocale());
  return Math.round(v).toLocaleString(activeLocale());
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
  return `${pct > 0 ? '+' : '−'}${v.toLocaleString(activeLocale())}%`;
}
