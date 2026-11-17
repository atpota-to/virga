import { describe, expect, it } from 'vitest';
import { axisStops, chartScale, fmtAverage, heatSteps, trendName } from './format.js';
import { movingAverage } from '../lib/analytics.js';

const DAY = 86_400_000;
const T0 = new Date(2026, 10, 1).getTime();
const series = (values) => values.map((v, i) => ({ t: T0 + i * DAY, v }));

describe('chartScale', () => {
  it('rules round steps, at most four, and leaves zero unnumbered under bars', () => {
    const s = chartScale(0, 760, { bars: true });
    expect(s.ticks).toEqual([0, 400, 800]);
    expect(s.labelled).toEqual([400, 800]);
    expect(s.max).toBeCloseTo(760 * 1.08);
  });

  it('keeps 8% over the tallest bar rather than stretching to the next round number', () => {
    const s = chartScale(0, 105, { bars: true });
    expect(s.max).toBeCloseTo(113.4);
    expect(s.ticks).toEqual([0, 50, 100]);
  });

  it('lets a line sit near its own floor and numbers its baseline', () => {
    const s = chartScale(4181, 5073, { zeroBase: false });
    expect(s.min).toBe(4000);
    expect(s.ticks).toEqual([4000, 4500, 5000]);
    expect(s.labelled).toEqual(s.ticks);
    expect(s.max).toBeGreaterThan(5073);
    expect(s.max).toBeLessThan(5250);
  });

  it('never rules half a count', () => {
    expect(chartScale(0, 1, { bars: true }).ticks).toEqual([0, 1]);
    expect(chartScale(0, 0, { bars: true }).ticks).toEqual([0, 1]);
    for (const top of [2, 3, 4, 7, 13, 99, 1234]) expect(chartScale(0, top, { bars: true }).ticks.length).toBeLessThanOrEqual(4);
  });
});

describe('axisStops', () => {
  it('names the ends, hanging inward, and the middle once there is room', () => {
    expect(axisStops(series([1, 2, 3]), 'day').map((s) => [s.i, s.anchor])).toEqual([[0, 'start'], [2, 'end']]);
    expect(axisStops(series([1, 2, 3, 4, 5, 6, 7]), 'day').map((s) => [s.text, s.anchor])).toEqual([['Nov 1', 'start'], ['Nov 4', 'middle'], ['Nov 7', 'end']]);
    expect(axisStops(series([1]), 'day')).toHaveLength(1);
    expect(axisStops([], 'day')).toEqual([]);
  });
});

describe('trendName', () => {
  it('names a seven-bucket moving average for its window, and anything else plainly', () => {
    const s = series([1, 4, 2, 8, 5, 7, 3, 9, 2]);
    expect(trendName(s, movingAverage(s, 7), 'day')).toBe('7-day average');
    expect(trendName(s, movingAverage(s, 7), 'week')).toBe('7-week average');
    expect(trendName(s, movingAverage(s, 5), 'day')).toBe('Moving average');
  });
});

describe('heatSteps', () => {
  it('shades by rank, so one outlier doesn’t wash the rest out', () => {
    const steps = heatSteps([0, null, 1, 2, 3, 4, 5, 1000]);
    expect(steps.get(0)).toBe(0);
    expect(steps.get(null)).toBeUndefined();
    expect(steps.get(1)).toBe(1);
    expect(steps.get(1000)).toBe(6);
    // By share of the largest, 2 to 5 would all have been step 1.
    expect(new Set([2, 3, 4, 5].map((v) => steps.get(v))).size).toBeGreaterThan(2);
  });

  it('gives equal values one step', () => {
    const steps = heatSteps([3, 3, 3, 9]);
    expect(steps.get(3)).toBe(1);
    expect(steps.get(9)).toBeGreaterThan(1);
  });
});

describe('fmtAverage', () => {
  it('keeps one decimal while small, even a nought, and is whole above ten', () => {
    expect(fmtAverage(2)).toBe('2.0');
    expect(fmtAverage(2.29)).toBe('2.3');
    expect(fmtAverage(0.8)).toBe('0.8');
    expect(fmtAverage(12.6)).toBe('13');
    expect(fmtAverage(null)).toBe('—');
  });
});
