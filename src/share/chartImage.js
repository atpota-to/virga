// A card as a picture: the title, whose numbers they are, the headline
// figure and the chart, drawn on a canvas at a size Bluesky shows whole
// (16:9), in the colours of the theme on screen.
//
// The layout is worked out by pure functions (tested); the drawing itself
// needs a real canvas and is looked at in the browser.

import { bucketLabel } from '../lib/analytics.js';
import { fmtTick, niceScale, uniqueTicks } from '../charts/format.js';

export const SHARE_WIDTH = 1200;
export const SHARE_HEIGHT = 675;

const PAD = 56;
const PLOT = { left: PAD, right: SHARE_WIDTH - PAD, top: 236, bottom: SHARE_HEIGHT - 118 };
/** Room at the right for the dashed reach to a reference the line can't arrive at. */
const GHOST_GUTTER = 70;
const FONT = '"Mona Sans Variable", "Mona Sans", system-ui, -apple-system, "Segoe UI", sans-serif';

/** The theme's colours, read off the page so the picture matches the screen. */
export function readShareTheme(root = document.documentElement) {
  const css = getComputedStyle(root);
  const v = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  return {
    surface: v('--surface', '#ffffff'),
    ink: v('--ink', '#101828'),
    ink2: v('--ink-2', '#344054'),
    muted: v('--muted', '#667085'),
    line: v('--line', '#e4e7ec'),
    grid: v('--chart-grid', '#eaecf0'),
    chart1: v('--chart-1', '#2563eb'),
    chart2: v('--chart-2', '#e8590c'),
    area: v('--chart-area', 'rgba(37, 99, 235, 0.10)'),
    track: v('--surface-3', '#f2f4f7'),
    accent: v('--accent', '#2563eb'),
  };
}

/**
 * Where a series sits in the plot: the y scale, each point's x and y, the
 * bar width, the ticks. `box` is `{ left, right, top, bottom }` in pixels.
 */
export function seriesLayout(spec, box = PLOT) {
  const { series, trend, zeroBase, ghost } = spec;
  const n = series.length;
  const values = series.map((p) => p.v ?? 0);
  const dataMax = Math.max(...values, ...(trend ? trend.map((p) => p.v ?? 0) : [0]), ghost ? ghost.v : 0);
  // The ghost reaches past the last bucket, so the series cedes it a gutter.
  if (ghost) box = { ...box, right: box.right - GHOST_GUTTER };
  const dataMin = Math.min(...values);
  const { min, max } = niceScale(zeroBase ? 0 : Math.max(0, dataMin), Math.max(dataMax, zeroBase ? 1 : dataMax));
  const span = Math.max(1e-9, max - min);
  const slot = (box.right - box.left) / n;
  const x = (i) => box.left + slot * (i + 0.5);
  const y = (v) => box.bottom - ((v - min) / span) * (box.bottom - box.top);
  return {
    n,
    min,
    max,
    slot,
    x,
    y,
    barWidth: Math.max(1, Math.min(40, slot - Math.max(2, slot * 0.22))),
    ticks: uniqueTicks([max, (max + min) / 2, min]),
  };
}

/** The three dates under a chart: first, middle (once there's room for one), last. */
export function axisLabels(series, unit) {
  const n = series.length;
  const out = [{ at: 0, text: bucketLabel(series[0].t, unit), align: 'left' }];
  if (n >= 5) out.push({ at: Math.floor((n - 1) / 2), text: bucketLabel(series[Math.floor((n - 1) / 2)].t, unit), align: 'center' });
  if (n > 1) out.push({ at: n - 1, text: bucketLabel(series[n - 1].t, unit), align: 'right' });
  return out;
}

/** Text cut to fit `width`, with an ellipsis, measured with the context's current font. */
export function fitText(ctx, text, width) {
  if (ctx.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawHead(ctx, spec, theme) {
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.fillStyle = theme.ink;
  ctx.font = `650 40px ${FONT}`;
  ctx.fillText(fitText(ctx, spec.title, SHARE_WIDTH - PAD * 2), PAD, PAD + 36);
  ctx.fillStyle = theme.muted;
  ctx.font = `450 22px ${FONT}`;
  ctx.fillText(fitText(ctx, spec.subtitle || '', SHARE_WIDTH - PAD * 2), PAD, PAD + 72);
  if (spec.figure) {
    ctx.fillStyle = theme.ink;
    ctx.font = `680 60px ${FONT}`;
    const value = String(spec.figure.value);
    ctx.fillText(value, PAD, PAD + 150);
    const after = PAD + ctx.measureText(value).width + 16;
    ctx.fillStyle = theme.ink2;
    ctx.font = `450 24px ${FONT}`;
    ctx.fillText(fitText(ctx, spec.figure.label, SHARE_WIDTH - PAD - after), after, PAD + 148);
  }
}

function drawFoot(ctx, theme) {
  // The mark: the cloud's arc with rain that never lands, as in the app.
  const s = 30;
  const x = PAD;
  const y = SHARE_HEIGHT - PAD - s + 6;
  ctx.fillStyle = theme.accent;
  roundRect(ctx, x, y, s, s, 7.5);
  ctx.fill();
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s / 24, s / 24);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(12, 11, 6, Math.PI, 0);
  ctx.moveTo(9, 14);
  ctx.lineTo(8, 18.5);
  ctx.moveTo(12.5, 14);
  ctx.lineTo(11.5, 20);
  ctx.moveTo(16, 14);
  ctx.lineTo(15, 17.5);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = theme.ink2;
  ctx.font = `600 22px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.fillText('Virga', x + s + 10, y + 22);
}

function drawSeries(ctx, spec, theme) {
  const L = seriesLayout(spec);
  const { series, unit, mode, trend, marks } = spec;

  ctx.lineWidth = 1;
  ctx.font = `450 18px ${FONT}`;
  ctx.textAlign = 'left';
  for (const tick of L.ticks) {
    const ty = Math.round(L.y(tick)) + 0.5;
    ctx.strokeStyle = theme.grid;
    ctx.beginPath();
    ctx.moveTo(PLOT.left, ty);
    ctx.lineTo(PLOT.right, ty);
    ctx.stroke();
    ctx.fillStyle = theme.muted;
    ctx.fillText(fmtTick(tick), PLOT.left + 2, ty - 6);
  }

  if (mode === 'line') {
    ctx.beginPath();
    ctx.moveTo(L.x(0), PLOT.bottom);
    series.forEach((p, i) => ctx.lineTo(L.x(i), L.y(p.v ?? 0)));
    ctx.lineTo(L.x(L.n - 1), PLOT.bottom);
    ctx.closePath();
    ctx.fillStyle = theme.area;
    ctx.fill();
    ctx.beginPath();
    series.forEach((p, i) => (i === 0 ? ctx.moveTo(L.x(i), L.y(p.v ?? 0)) : ctx.lineTo(L.x(i), L.y(p.v ?? 0))));
    ctx.strokeStyle = theme.chart1;
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.stroke();
    const endX = L.x(L.n - 1);
    const endY = L.y(series[L.n - 1].v ?? 0);
    if (spec.ghost) {
      // Dashed and open, as on the card: a reference, not a measurement.
      const gx = PLOT.right - 10;
      const gy = L.y(spec.ghost.v);
      ctx.beginPath();
      ctx.moveTo(endX, PLOT.bottom);
      ctx.lineTo(endX, endY);
      ctx.lineTo(gx, gy);
      ctx.lineTo(gx, PLOT.bottom);
      ctx.closePath();
      ctx.fillStyle = theme.area;
      ctx.fill();
      ctx.setLineDash([8, 8]);
      ctx.strokeStyle = theme.muted;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(endX, endY);
      ctx.lineTo(gx, gy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(gx, gy, 7, 0, Math.PI * 2);
      ctx.fillStyle = theme.surface;
      ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(endX, endY, 7, 0, Math.PI * 2);
    ctx.fillStyle = theme.chart1;
    ctx.fill();
  } else {
    ctx.fillStyle = theme.chart1;
    series.forEach((p, i) => {
      if (!(p.v > 0)) return;
      const top = L.y(p.v);
      const h = Math.max(1, PLOT.bottom - top);
      ctx.save();
      // Rounded at the data end only: the foot is clipped square to the baseline.
      ctx.beginPath();
      ctx.rect(PLOT.left, PLOT.top - 20, PLOT.right - PLOT.left, PLOT.bottom - PLOT.top + 20);
      ctx.clip();
      roundRect(ctx, L.x(i) - L.barWidth / 2, top, L.barWidth, h + 6, Math.min(6, L.barWidth / 2));
      ctx.fill();
      ctx.restore();
    });
  }

  if (trend?.some((p) => p.v != null)) {
    ctx.beginPath();
    let pen = false;
    trend.forEach((p, i) => {
      if (p.v == null) {
        pen = false;
        return;
      }
      if (pen) ctx.lineTo(L.x(i), L.y(p.v));
      else ctx.moveTo(L.x(i), L.y(p.v));
      pen = true;
    });
    ctx.strokeStyle = theme.chart2;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }

  for (const m of marks || []) {
    const mx = Math.round(L.x(m.i)) + 0.5;
    ctx.strokeStyle = theme.muted;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(mx, PLOT.top - 8);
    ctx.lineTo(mx, PLOT.bottom);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = m.kind === 'milestone' ? theme.chart1 : theme.ink2;
    ctx.beginPath();
    ctx.moveTo(mx, PLOT.top - 22);
    ctx.lineTo(mx + 8, PLOT.top - 14);
    ctx.lineTo(mx, PLOT.top - 6);
    ctx.lineTo(mx - 8, PLOT.top - 14);
    ctx.closePath();
    ctx.fill();
  }

  ctx.fillStyle = theme.muted;
  ctx.font = `450 18px ${FONT}`;
  for (const label of axisLabels(series, unit)) {
    ctx.textAlign = label.align;
    // Under the measured curve: the axis stops where the buckets do, short of a ghost's gutter.
    const lx = label.align === 'left' ? PLOT.left : label.align === 'right' ? L.x(L.n - 1) + L.slot / 2 : (PLOT.left + L.x(L.n - 1) + L.slot / 2) / 2;
    ctx.fillText(label.text, lx, PLOT.bottom + 30);
  }
}

function drawBars(ctx, spec, theme) {
  const rows = spec.rows.slice(0, 8);
  const top = Math.max(...rows.map((r) => r.value), 1);
  const rowH = Math.min(52, (SHARE_HEIGHT - 110 - PLOT.top + 20) / rows.length);
  const labelW = 300;
  const valueW = 110;
  const trackX = PAD + labelW;
  const trackW = SHARE_WIDTH - PAD - valueW - trackX;
  ctx.textBaseline = 'middle';
  rows.forEach((r, i) => {
    const cy = PLOT.top - 6 + rowH * (i + 0.5);
    ctx.textAlign = 'left';
    ctx.fillStyle = theme.ink2;
    ctx.font = `500 24px ${FONT}`;
    ctx.fillText(fitText(ctx, String(r.label), labelW - 20), PAD, cy);
    ctx.fillStyle = theme.track;
    roundRect(ctx, trackX, cy - 8, trackW, 16, 8);
    ctx.fill();
    ctx.fillStyle = theme.chart1;
    roundRect(ctx, trackX, cy - 8, Math.max(16, (r.value / top) * trackW), 16, 8);
    ctx.fill();
    ctx.textAlign = 'right';
    ctx.fillStyle = theme.ink;
    ctx.font = `650 24px ${FONT}`;
    ctx.fillText(String(r.display), SHARE_WIDTH - PAD, cy);
  });
  ctx.textBaseline = 'alphabetic';
}

/** Draw `spec` on a 2D context sized SHARE_WIDTH by SHARE_HEIGHT. */
export function drawShareImage(ctx, spec, theme) {
  ctx.fillStyle = theme.surface;
  ctx.fillRect(0, 0, SHARE_WIDTH, SHARE_HEIGHT);
  drawHead(ctx, spec, theme);
  if (spec.kind === 'bars') drawBars(ctx, spec, theme);
  else drawSeries(ctx, spec, theme);
  drawFoot(ctx, theme);
}

/**
 * The picture as a PNG file. Waits for the typeface first, so the first
 * picture of a session isn't drawn in the fallback.
 */
export async function renderShareImage(spec, { theme = readShareTheme() } = {}) {
  try {
    await Promise.all([document.fonts?.load(`650 40px ${FONT}`), document.fonts?.load(`450 22px ${FONT}`)]);
  } catch {
    // The fallback face draws the same picture.
  }
  const canvas = document.createElement('canvas');
  canvas.width = SHARE_WIDTH;
  canvas.height = SHARE_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser can’t draw the picture.');
  drawShareImage(ctx, spec, theme);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The picture couldn’t be made.');
  return new File([blob], 'virga-chart.png', { type: 'image/png' });
}
