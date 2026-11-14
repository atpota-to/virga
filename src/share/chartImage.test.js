import { describe, expect, it } from 'vitest';
import { SHARE_HEIGHT, SHARE_WIDTH, axisLabels, drawShareImage, fitText, seriesLayout } from './chartImage.js';
import { fmtCount } from '../charts/format.js';

const DAY = 86_400_000;
const T0 = new Date(2026, 10, 1).getTime();
const series = (values) => values.map((v, i) => ({ t: T0 + i * DAY, v }));
const BOX = { left: 0, right: 100, top: 0, bottom: 50 };

/** A stand-in 2D context that takes every call and remembers the text. */
function fakeContext() {
  const texts = [];
  const ctx = new Proxy(
    { texts },
    {
      get(target, key) {
        if (key === 'texts') return texts;
        if (key === 'measureText') return (t) => ({ width: String(t).length * 10 });
        if (key === 'fillText') return (t) => texts.push(String(t));
        if (key in target) return target[key];
        return () => {};
      },
      set(target, key, value) {
        target[key] = value;
        return true;
      },
    },
  );
  return ctx;
}

const THEME = { surface: '#fff', ink: '#000', ink2: '#333', muted: '#666', line: '#ddd', grid: '#eee', chart1: '#00f', chart2: '#f60', area: '#eef', track: '#eee', accent: '#00f' };

describe('seriesLayout', () => {
  it('stands bars on zero and spreads them across the plot', () => {
    const L = seriesLayout({ series: series([0, 5, 10, 20]), zeroBase: true }, BOX);
    expect(L.min).toBe(0);
    expect(L.max).toBe(20);
    expect(L.x(0)).toBe(12.5);
    expect(L.x(3)).toBe(87.5);
    expect(L.y(0)).toBe(50);
    expect(L.y(20)).toBe(0);
    expect(L.barWidth).toBeLessThan(L.slot);
  });

  it('lets a line sit near its own floor, and makes room for the trend', () => {
    const L = seriesLayout({ series: series([5000, 5040, 5073]), zeroBase: false, trend: series([5000, 5100, 5200]) }, BOX);
    expect(L.min).toBeGreaterThan(0);
    expect(L.max).toBeGreaterThanOrEqual(5200);
  });

  it('makes room for a reference the line reaches up to', () => {
    const plain = seriesLayout({ series: series([10, 20]), zeroBase: false }, BOX);
    const reach = seriesLayout({ series: series([10, 20]), zeroBase: false, ghost: { v: 90 } }, BOX);
    expect(reach.max).toBeGreaterThanOrEqual(90);
    expect(reach.x(1)).toBeLessThan(plain.x(1));
  });

  it('copes with nothing but zeros and gaps', () => {
    const L = seriesLayout({ series: series([0, null, 0]), zeroBase: true }, BOX);
    expect(Number.isFinite(L.y(0))).toBe(true);
    expect(L.max).toBeGreaterThan(L.min);
  });
});

describe('axisLabels', () => {
  it('names the ends, and the middle once there is room', () => {
    expect(axisLabels(series([1, 2, 3]), 'day').map((l) => l.text)).toEqual(['Nov 1', 'Nov 3']);
    expect(axisLabels(series([1, 2, 3, 4, 5, 6, 7]), 'day').map((l) => [l.text, l.align])).toEqual([['Nov 1', 'left'], ['Nov 4', 'center'], ['Nov 7', 'right']]);
    expect(axisLabels(series([1]), 'day')).toHaveLength(1);
  });
});

describe('fitText', () => {
  it('leaves what fits and cuts what doesn’t', () => {
    const ctx = fakeContext();
    expect(fitText(ctx, 'Short', 100)).toBe('Short');
    expect(fitText(ctx, 'A title far too long for the picture', 120)).toBe('A title far…');
  });
});

describe('drawShareImage', () => {
  it('writes the title, whose it is, the headline and the dates for a series', () => {
    const ctx = fakeContext();
    drawShareImage(ctx, { kind: 'series', title: 'Follower growth', subtitle: '@mira.example.com, the last 7 days', figure: { value: '5,073', label: 'followers' }, series: series([1, 2, 3, 4, 5, 6, 7]), unit: 'day', mode: 'line', zeroBase: false, format: fmtCount, marks: [{ i: 2, t: T0 + 2 * DAY, kind: 'note', items: [] }] }, THEME);
    for (const text of ['Follower growth', '@mira.example.com, the last 7 days', '5,073', 'followers', 'Nov 1', 'Nov 7', 'Virga']) expect(ctx.texts).toContain(text);
  });

  it('writes each row of a bar card', () => {
    const ctx = fakeContext();
    drawShareImage(ctx, { kind: 'bars', title: 'Formats', subtitle: '', figure: null, rows: [{ label: 'Text only', value: 5, display: '5' }, { label: 'Images', value: 60, display: '60' }] }, THEME);
    for (const text of ['Formats', 'Text only', 'Images', '60', 'Virga']) expect(ctx.texts).toContain(text);
  });

  it('is sized for a post', () => {
    expect(SHARE_WIDTH / SHARE_HEIGHT).toBeCloseTo(16 / 9);
  });
});
