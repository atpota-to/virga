// The one time-series chart, and its plain-table twin.
//
// `mode: 'bars'` draws columns from a zero baseline, rounded at the top,
// with a 2px surface gap between neighbours; `mode: 'line'` draws a 2px line
// over a faint wash (the cumulative view). `trend` overlays a moving average,
// named in a legend over the plot. `secondary` overlays a second line for
// same-bucket comparisons; with `stacked`, that second series is an additive
// layer rather than another absolute line.
//
// Hover is a nearest-X crosshair with one readout, the same on both forms,
// and every value is also reachable without a pointer through ChartTable.
//
// Colours come from the theme's chart tokens (charts.css), so the light and
// dark steps are each their own, checked against their own surface.

import { useLayoutEffect, useRef, useState } from 'react';
import { bucketLabel } from '../lib/analytics.js';
import { axisStops, chartScale, fmtAverage, fmtCount, fmtTick, trendName } from './format.js';
import './charts.css';
import { activeLocale } from '../lib/locale.js';
import { markText } from '../reports/annotations.js';

/**
 * The plot's margins. The rules start at the column's left edge, which is
 * the section title's edge too, and each rule's number sits on it there;
 * the data starts past the widest number (labelColumn), so a bar or a line
 * never runs under one. The foot holds the dates; the top, the highest
 * rule's number.
 */
const PAD = { r: 12, t: 18, b: 22 };
/** Room between the widest of the rules' numbers and the first bar or point. */
const LABEL_GAP = 8;
/** More room at the top for the diamonds of marked days, clear of the top label. */
const MARKS_ROOM = 10;
/** Below this distance from either side, the readout hangs inward from its point. */
const TIP_EDGE = 120;
/**
 * Horizontal room for the ghost's reach past the last bucket. Narrow on
 * purpose: the reach must read as a step UP at the edge of now, not as a
 * projection ambling into future time — the dates stop under the real
 * curve's end, so the ghost visibly stands past the end of time rather than
 * extending it.
 */
const GHOST_GUTTER = 28;

/**
 * The one chart. `mode: 'bars'` draws columns from a zero baseline with a 2px
 * surface gap; `mode: 'line'` draws a 2px line over a 10%-opacity wash (the
 * cumulative view). `trend` overlays a moving average, with a legend entry
 * over the plot naming it ("7-day average"). `secondary` overlays a second
 * line for same-bucket comparisons. With `stacked`, that second series is
 * treated as an additive layer rather than another absolute line.
 * Hover is a nearest-X crosshair with one readout — the same
 * interaction on both forms — and the values are all reachable without it
 * through the ChartTable twin rendered alongside.
 *
 * `ghost` (line mode only) draws a dashed reach from the line's end up to a
 * reference value the line itself cannot arrive at — the followers chart
 * uses it for Bluesky's profile counter, which still includes deactivated
 * and suspended accounts the swept curve cannot see. Dashed and in faint
 * ink on purpose: it is a simulation, not a measurement, and it must never
 * dress like the data. `{ v, label?, readout? }`: `label` is written by its
 * open dot ("5,073 on profile"), and `readout` is the line the readout adds
 * on the last point ("Profile counter 5,073"); both default to the profile
 * counter's words, which is what it is used for.
 *
 * `marks` are the days worth pointing at (reports/annotations.js
 * marksOnSeries): a note someone wrote, a follower milestone. Each is a
 * dashed rule through its bucket with a small diamond at the top; the
 * readout names it on hover, and the list under the chart names them all,
 * so none is reachable only by pointer.
 *
 * `format` writes a value for the readout and the table — a rate wants a
 * decimal, and a bucket with no value (null: nothing posted that week) wants
 * words, not a zero. Null points draw no bar and break the trend line.
 */
export default function SeriesChart({
  series,
  seriesLabel = null,
  secondary = null,
  stacked = false,
  trend = null,
  mode = 'bars',
  unit = 'day',
  zeroBase = true,
  ghost = null,
  format = null,
  marks = null,
  height = 200,
  ariaLabel,
}) {
  const fmt = format || fmtCount;
  // An average of counts keeps its decimal while small: a week of two and
  // three posts a day averages 2.3, not 2.
  const fmtTrend = format || fmtAverage;
  const plotRef = useRef(null);
  const [w, setW] = useState(0);
  const [hover, setHover] = useState(null);

  // Real pixels (measured width, fixed height), exactly as StateStats draws:
  // uniform scaling keeps the dots circular and the hairlines hairlines.
  useLayoutEffect(() => {
    const el = plotRef.current;
    if (!el) return undefined;
    const measure = () => setW(el.clientWidth || 0);
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(el);
    return () => ro?.disconnect();
  }, []);

  if (!series || series.length === 0) {
    return <p className="an-empty">Nothing in this window.</p>;
  }

  const H = height;
  const ready = w > 0;
  const n = series.length;
  const secondarySeries = mode === 'line' && secondary?.series?.length === n ? secondary.series : null;
  const secondaryPlotSeries =
    stacked && secondarySeries
      ? secondarySeries.map((point, index) => ({ ...point, v: point.v + series[index].v }))
      : secondarySeries;
  const showGhost = Boolean(ghost) && mode === 'line' && n > 0;
  // The ghost reaches PAST the last bucket, so the real series cedes it a
  // fixed gutter on the right rather than being silently rescaled under it.
  const gutter = showGhost ? GHOST_GUTTER : 0;
  const shownMarks = marks?.length ? marks.filter((m) => m.i >= 0 && m.i < n) : [];
  const padT = PAD.t + (shownMarks.length ? MARKS_ROOM : 0);
  const values = series.map((p) => p.v);
  const secondaryValues = secondaryPlotSeries ? secondaryPlotSeries.map((p) => p.v) : [];
  const dataMax = Math.max(
    ...values,
    ...secondaryValues,
    trend ? Math.max(...trend.map((p) => p.v ?? 0)) : 0,
    showGhost ? ghost.v : 0,
  );
  const dataMin = Math.min(...values, ...secondaryValues);
  // Bars grow from zero, always. A line (the cumulative view) may sit on a
  // nearby floor instead — a follower count living between 5,500 and 5,935
  // pinned to a zero axis is a flat wire that says nothing.
  const scale = chartScale(dataMin, dataMax, { zeroBase, bars: mode === 'bars' });
  const ySpan = Math.max(1e-9, scale.max - scale.min);
  const padL = labelColumn(scale.labelled.map(fmtTick)) + LABEL_GAP;
  const plotW = Math.max(1, w - padL - PAD.r - gutter);
  const slot = plotW / n;
  const x = (i) => padL + slot * (i + 0.5);
  const y = (v) => H - PAD.b - ((v - scale.min) / ySpan) * (H - padT - PAD.b);
  const baseY = H - PAD.b;

  // Bars: ≤24px thick, 2px surface gap between neighbours, never negative.
  const barW = Math.max(1, Math.min(24, slot - 2));
  // Where the dates hang from: a bar's own edges at the ends, so the first
  // date starts with the first bar and the last ends with the last; a line's
  // ends are its points.
  const reach = mode === 'bars' ? barW / 2 : 0;
  const stops = axisStops(series, unit).map((s) => {
    if (s.anchor === 'start') return { ...s, at: Math.max(0, x(s.i) - reach) };
    if (s.anchor === 'end') return { ...s, at: Math.min(w - PAD.r, x(s.i) + reach) };
    return { ...s, at: x(s.i) };
  });
  // The middle date steps aside when a narrow chart would run it into an
  // end one (an estimate of the words' width at 12px is enough to tell).
  const dates = stops.filter((s, k) => {
    if (s.anchor !== 'middle') return true;
    const half = (s.text.length * 6.6) / 2;
    const first = stops[0];
    const last = stops[k + 1];
    return s.at - half > first.at + first.text.length * 6.6 + 12 && (!last || s.at + half < last.at - last.text.length * 6.6 - 12);
  });

  function onMove(e) {
    if (!ready || !plotRef.current) return;
    const rect = plotRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.min(n - 1, Math.max(0, Math.round((px - padL) / slot - 0.5)));
    setHover(i);
  }

  const hoverMark = hover != null ? shownMarks.find((m) => m.i === hover) : null;
  const hp = hover != null && series[hover] ? { ...series[hover], i: hover } : null;
  const secondaryHp = hover != null && secondarySeries?.[hover] ? secondarySeries[hover] : null;
  const secondaryPlotHp =
    hover != null && secondaryPlotSeries?.[hover] ? secondaryPlotSeries[hover] : null;
  const line = series.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const area = `M${x(0).toFixed(1)},${baseY} ${series.map((p, i) => `L${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')} L${x(n - 1).toFixed(1)},${baseY} Z`;
  const secondaryLine = secondaryPlotSeries
    ? secondaryPlotSeries.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
    : null;
  const stackedArea =
    stacked && secondaryPlotSeries
      ? `${secondaryPlotSeries
          .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`)
          .join(' ')} ${series
          .map((p, i) => ({ p, i }))
          .reverse()
          .map(({ p, i }) => `L${x(i).toFixed(1)},${y(p.v).toFixed(1)}`)
          .join(' ')} Z`
      : null;
  // A trend point with no value (a window with nothing in it) breaks the
  // line; the next real point starts a new run rather than diving to zero.
  const trendPath = trend
    ? trend
        .map((p, i) => {
          if (p.v == null) return '';
          const move = i === 0 || trend[i - 1].v == null ? 'M' : 'L';
          return `${move}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`;
        })
        .filter(Boolean)
        .join(' ')
    : null;
  const trendLabel = trendPath ? trendName(series, trend, unit) : null;
  const ghostWords = showGhost ? fmtCount(ghost.v) : null;
  // Where the reach ends: its open dot at the plot's right, with its words
  // riding above it, or below it when the dot is already brushing the top.
  const ghostY = showGhost ? y(ghost.v) : 0;
  const ghostAt = showGhost ? { x: w - PAD.r - 4, y: ghostY, labelY: ghostY - 8 < 12 ? ghostY + 16 : ghostY - 8 } : null;
  // The readout sits over its point, or hangs inward from it near either
  // side: on the last point that keeps it clear of the ghost's reach. A
  // hanging readout reaches 12px back past its point, so it is held that far
  // in from the column's edges.
  const tipSide = hp ? (x(hp.i) > w - TIP_EDGE ? 'left' : x(hp.i) < TIP_EDGE ? 'right' : null) : null;
  const tipX = hp ? (tipSide === 'right' ? Math.max(12, x(hp.i)) : tipSide === 'left' ? Math.min(w - 12, x(hp.i)) : x(hp.i)) : 0;

  return (
    <div className="an-chart">
      {(secondarySeries || trendLabel) && (
        <div className="an-chart-legend" aria-hidden="true">
          {secondarySeries && (
            <>
              <span><i className="an-chart-legend-primary" />{seriesLabel || 'Primary'}</span>
              <span><i className="an-chart-legend-secondary" />{secondary.label || 'Secondary'}</span>
            </>
          )}
          {trendLabel && <span><i className="an-chart-legend-trend" />{trendLabel}</span>}
        </div>
      )}
      <div className="an-chart-plot" ref={plotRef} style={{ height: H }}>
        {ready && (
          <svg
            className="an-chart-svg"
            width={w}
            height={H}
            viewBox={`0 0 ${w} ${H}`}
            role="img"
            aria-label={`${ariaLabel || 'Series'}: ${n} ${unit} buckets, peak ${fmt(dataMax)}${showGhost ? `; dashed reference reaching ${Math.round(ghost.v).toLocaleString(activeLocale())}` : ''}${shownMarks.length ? `; ${shownMarks.length} marked ${shownMarks.length === 1 ? 'day' : 'days'}, listed below` : ''}`}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          >
            {/* The rules run the column's full width, from the title's edge
                to the head's other end; a bar chart's baseline has no number. */}
            {scale.ticks.map((v) => (
              <line key={v} className="an-chart-grid" x1={0} x2={w} y1={y(v)} y2={y(v)} />
            ))}

            {/* Rounded at the data end only, anchored square to the baseline. */}
            {mode === 'bars' &&
              series.map((p, i) =>
                p.v != null && p.v > 0 ? (
                  <path
                    key={p.t}
                    className={`an-chart-bar${hover === i ? ' is-hover' : ''}`}
                    d={barPath(x(i) - barW / 2, y(p.v), barW, baseY - y(p.v))}
                  />
                ) : null,
              )}

            {mode === 'line' && (
              <>
                {(!secondarySeries || stacked) && <path className="an-chart-area" d={area} />}
                {stackedArea && <path className="an-chart-area-secondary" d={stackedArea} />}
                <path className="an-chart-line" d={line} />
                <circle className="an-chart-dot" cx={x(n - 1)} cy={y(series[n - 1].v)} r="3.4" />
                {secondaryLine && (
                  <>
                    <path className="an-chart-line-secondary" d={secondaryLine} />
                    <circle className="an-chart-dot-secondary" cx={x(n - 1)} cy={y(secondaryPlotSeries[n - 1].v)} r="3.4" />
                  </>
                )}
              </>
            )}

            {ghostAt &&
              (() => {
                const gx0 = x(n - 1);
                const gy0 = y(series[n - 1].v);
                const { x: gx1, y: gy1 } = ghostAt;
                return (
                  <g>
                    {/* The same wash the measured curve carries, continued
                        under the dashed cap — the reach completes the shape
                        instead of floating over blank ground; the dashed
                        edge and open dot are what keep saying "simulated". */}
                    <path
                      className="an-chart-area"
                      d={`M${gx0.toFixed(1)},${baseY} L${gx0.toFixed(1)},${gy0.toFixed(1)} L${gx1.toFixed(1)},${gy1.toFixed(1)} L${gx1.toFixed(1)},${baseY} Z`}
                    />
                    <path
                      className="an-chart-ghost"
                      d={`M${gx0.toFixed(1)},${gy0.toFixed(1)} L${gx1.toFixed(1)},${gy1.toFixed(1)}`}
                    />
                    <circle className="an-chart-ghost-dot" cx={gx1} cy={gy1} r="3.4" />
                  </g>
                );
              })()}

            {trendPath && <path className="an-chart-trend" d={trendPath} />}

            {shownMarks.map((m) => (
              <g key={`mark-${m.i}`} className={`an-chart-mark is-${m.kind}`}>
                <line x1={x(m.i)} x2={x(m.i)} y1={padT - 6} y2={baseY} />
                <path d={diamondPath(x(m.i), padT - 9, 4)} />
              </g>
            ))}

            {/* The reach's words, drawn over a marked day's rule that may
                pass behind them (a note from the last few days), and out of
                the way while a readout hangs over them from the right-hand
                points; on the last, the readout says it. */}
            {ghostAt && tipSide !== 'left' && (
              <text className="an-chart-ghost-label" x={ghostAt.x} y={ghostAt.labelY} textAnchor="end">
                {ghost.label || `${ghostWords} on profile`}
              </text>
            )}

            {/* Each rule's number, on the title's edge, in the column the
                data leaves for them. */}
            {scale.labelled.map((v) => (
              <text key={v} className="an-chart-ylabel" x={0} y={y(v) - 4}>
                {fmtTick(v)}
              </text>
            ))}

            {/* The dates, each under its own bucket. */}
            {dates.map((s) => (
              <text key={s.i} className="an-chart-xlabel" x={s.at} y={baseY + 16} textAnchor={s.anchor}>
                {s.text}
              </text>
            ))}

            {hp && (
              <g>
                <line className="an-chart-cross" x1={x(hp.i)} x2={x(hp.i)} y1={padT - 6} y2={baseY} />
                {mode === 'line' && <circle className="an-chart-marker" cx={x(hp.i)} cy={y(hp.v)} r="4" />}
                {secondaryPlotHp && <circle className="an-chart-marker-secondary" cx={x(hp.i)} cy={y(secondaryPlotHp.v)} r="4" />}
              </g>
            )}
          </svg>
        )}

        {hp && (
          <div className="an-chart-tip" data-side={tipSide || undefined} style={{ left: tipX, top: Math.max(padT, y(hp.v)) }}>
            <strong>{seriesLabel && `${seriesLabel} `}{fmt(hp.v)}</strong>
            {secondaryHp && (
              <strong className="an-chart-tip-secondary">
                {secondary.label} {Math.round(secondaryHp.v).toLocaleString(activeLocale())}
              </strong>
            )}
            {stacked && secondaryPlotHp && (
              <strong>
                Total {Math.round(secondaryPlotHp.v).toLocaleString(activeLocale())}
              </strong>
            )}
            <span className="an-chart-tip-when">{bucketLabel(hp.t, unit)}</span>
            {showGhost && hp.i === n - 1 && <span>{ghost.readout || `Profile counter ${ghostWords}`}</span>}
            {trendLabel && trend[hp.i]?.v != null && (
              <span className="an-chart-tip-trend">
                {trendLabel} {fmtTrend(trend[hp.i].v)}
              </span>
            )}
            {hoverMark?.items.map((item, k) => (
              <span key={k} className="an-chart-tip-mark">
                {item.label}
              </span>
            ))}
          </div>
        )}
      </div>
      {shownMarks.length > 0 && (
        <ul className="an-chart-marks" aria-label="Marked on this chart">
          {/* The newest few: a chart of three years would otherwise carry a
              paragraph of milestones under it. */}
          {shownMarks.slice(-MARKS_LISTED).map((m) => (
            <li key={m.i} className={`is-${m.kind}`}>
              {markText(m, unit)}
            </li>
          ))}
          {shownMarks.length > MARKS_LISTED && <li className="an-chart-marks-more">and {shownMarks.length - MARKS_LISTED} earlier</li>}
        </ul>
      )}
    </div>
  );
}

const MARKS_LISTED = 5;

/** A canvas to measure the rules' numbers with, made once; false where there is none. */
let measurer = null;

/**
 * How wide the rules' numbers are, the widest of them, at the 12px the chart
 * sets them in (.an-chart-ylabel). Measured in the page's own face; where
 * nothing can measure, a digit's width is near enough.
 */
function labelColumn(texts) {
  if (!texts.length) return 0;
  if (measurer === null) measurer = (typeof document !== 'undefined' && document.createElement('canvas').getContext?.('2d')) || false;
  if (!measurer) return Math.max(...texts.map((t) => t.length * 7));
  const face = getComputedStyle(document.documentElement).getPropertyValue('--sans').trim() || 'sans-serif';
  measurer.font = `400 12px ${face}`;
  return Math.ceil(Math.max(...texts.map((t) => measurer.measureText(t).width)));
}

/** A small diamond centred on (cx, cy), `r` from centre to point. */
function diamondPath(cx, cy, r) {
  return `M${cx.toFixed(1)},${(cy - r).toFixed(1)}L${(cx + r).toFixed(1)},${cy.toFixed(1)}L${cx.toFixed(1)},${(cy + r).toFixed(1)}L${(cx - r).toFixed(1)},${cy.toFixed(1)}Z`;
}

/** A bar with its top corners rounded (by up to 3px), its foot square. */
function barPath(x0, y0, w, h) {
  const r = Math.max(0, Math.min(3, w / 2, h));
  const x1 = x0 + w;
  const yb = y0 + h;
  return `M${x0.toFixed(1)},${yb.toFixed(1)}V${(y0 + r).toFixed(1)}Q${x0.toFixed(1)},${y0.toFixed(1)} ${(x0 + r).toFixed(1)},${y0.toFixed(1)}H${(x1 - r).toFixed(1)}Q${x1.toFixed(1)},${y0.toFixed(1)} ${x1.toFixed(1)},${(y0 + r).toFixed(1)}V${yb.toFixed(1)}Z`;
}
