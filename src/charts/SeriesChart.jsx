// The one time-series chart, and its plain-table twin.
//
// `mode: 'bars'` draws columns from a zero baseline, rounded at the top,
// with a 2px surface gap between neighbours; `mode: 'line'` draws a 2px line
// over a faint wash (the cumulative view). `trend` overlays a moving average
// with a direct end label. `secondary` overlays a second line for
// same-bucket comparisons; with `stacked`, that second series is an additive
// layer rather than another absolute line.
//
// Hover is a nearest-X crosshair with one readout, the same on both forms,
// and every value is also reachable without a pointer through ChartTable.
//
// Colours come from the theme's chart tokens (charts.css), so the light and
// dark steps are each their own, checked against their own surface.

import { useLayoutEffect, useRef, useState } from 'react';
import { bucketLabel, fmtCompact } from '../lib/analytics.js';
import { clamp, fmtCount, fmtTick, niceScale, uniqueTicks } from './format.js';
import './charts.css';

const PAD = { l: 8, r: 12, t: 18, b: 20 };
/**
 * Horizontal room for the ghost's reach past the last bucket. Narrow on
 * purpose: the reach must read as a step UP at the edge of now, not as a
 * projection ambling into future time — the time axis itself stops under the
 * real curve's end (the x-axis row is padded by this same amount), so the
 * ghost visibly stands past the end of time rather than extending it.
 */
const GHOST_GUTTER = 28;

/**
 * The one chart. `mode: 'bars'` draws columns from a zero baseline with a 2px
 * surface gap; `mode: 'line'` draws a 2px line over a 10%-opacity wash (the
 * cumulative view). `trend` overlays a moving average with a direct end
 * label. `secondary` overlays a second line for same-bucket comparisons.
 * With `stacked`, that second series is treated as an additive layer rather
 * than another absolute line.
 * Hover is a nearest-X crosshair with one readout — the same
 * interaction on both forms — and the values are all reachable without it
 * through the ChartTable twin rendered alongside.
 *
 * `ghost` (line mode only) draws a dashed reach from the line's end up to a
 * reference value the line itself cannot arrive at — the followers chart
 * uses it for Bluesky's profile counter, which still includes deactivated
 * and suspended accounts the swept curve cannot see. Dashed and in faint
 * ink on purpose: it is a simulation, not a measurement, and it must never
 * dress like the data. `{ v, label }`.
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
  height = 200,
  ariaLabel,
}) {
  const fmt = format || fmtCount;
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
  const { min: yMin, max: yMax } = niceScale(zeroBase ? 0 : Math.max(0, dataMin), Math.max(dataMax, zeroBase ? 1 : dataMax));
  const ySpan = Math.max(1e-9, yMax - yMin);
  const plotW = Math.max(1, w - PAD.l - PAD.r - gutter);
  const slot = plotW / n;
  const x = (i) => PAD.l + slot * (i + 0.5);
  const y = (v) => H - PAD.b - ((v - yMin) / ySpan) * (H - PAD.t - PAD.b);
  const baseY = H - PAD.b;

  // Bars: ≤24px thick, 2px surface gap between neighbours, never negative.
  const barW = Math.max(1, Math.min(24, slot - 2));
  const ticks = uniqueTicks([yMax, (yMax + yMin) / 2, yMin]);

  function onMove(e) {
    if (!ready || !plotRef.current) return;
    const rect = plotRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.min(n - 1, Math.max(0, Math.round((px - PAD.l) / slot - 0.5)));
    setHover(i);
  }

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
  const trendEnd = trend ? trend.findLastIndex((p) => p.v != null) : -1;

  return (
    <div className="an-chart">
      {secondarySeries && (
        <div className="an-chart-legend" aria-hidden="true">
          <span><i className="an-chart-legend-primary" />{seriesLabel || 'Primary'}</span>
          <span><i className="an-chart-legend-secondary" />{secondary.label || 'Secondary'}</span>
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
            aria-label={`${ariaLabel || 'Series'}: ${n} ${unit} buckets, peak ${fmt(dataMax)}${showGhost ? `; dashed reference reaching ${Math.round(ghost.v).toLocaleString('en-US')}` : ''}`}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          >
            {ticks.map((v) => (
              <g key={v}>
                <line className="an-chart-grid" x1={PAD.l} x2={w - PAD.r} y1={y(v)} y2={y(v)} />
                <text className="an-chart-ylabel" x={PAD.l + 1} y={y(v) - 3}>
                  {fmtTick(v)}
                </text>
              </g>
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

            {showGhost &&
              (() => {
                const gx0 = x(n - 1);
                const gy0 = y(series[n - 1].v);
                const gx1 = w - PAD.r - 4;
                const gy1 = y(ghost.v);
                // The label rides above the open dot, or below it when the
                // dot is already brushing the top of the plot.
                const labelY = gy1 - 8 < 12 ? gy1 + 16 : gy1 - 8;
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
                    <text className="an-chart-ghost-label" x={gx1} y={labelY} textAnchor="end">
                      {ghost.label || fmtCompact(ghost.v)}
                    </text>
                  </g>
                );
              })()}

            {trendPath && trendEnd >= 0 && (
              <>
                <path className="an-chart-trend" d={trendPath} />
                <text
                  className="an-chart-trendlabel"
                  x={Math.min(x(trendEnd) + 4, w - PAD.r)}
                  y={y(trend[trendEnd].v) - 4}
                  textAnchor="end"
                >
                  trend
                </text>
              </>
            )}

            {hp && (
              <g>
                <line className="an-chart-cross" x1={x(hp.i)} x2={x(hp.i)} y1={PAD.t - 6} y2={baseY} />
                {mode === 'line' && <circle className="an-chart-marker" cx={x(hp.i)} cy={y(hp.v)} r="4" />}
                {secondaryPlotHp && <circle className="an-chart-marker-secondary" cx={x(hp.i)} cy={y(secondaryPlotHp.v)} r="4" />}
              </g>
            )}
          </svg>
        )}

        {hp && (
          <div
            className="an-chart-tip"
            style={{ left: clamp(x(hp.i), 40, w - 40), top: Math.max(PAD.t, y(hp.v)) }}
          >
            <strong>{seriesLabel && `${seriesLabel} `}{fmt(hp.v)}</strong>
            {secondaryHp && (
              <strong className="an-chart-tip-secondary">
                {secondary.label} {Math.round(secondaryHp.v).toLocaleString('en-US')}
              </strong>
            )}
            {stacked && secondaryPlotHp && (
              <strong>
                Total {Math.round(secondaryPlotHp.v).toLocaleString('en-US')}
              </strong>
            )}
            <span className="an-chart-tip-when">{bucketLabel(hp.t, unit)}</span>
            {trend && trend[hp.i]?.v != null && (
              <span className="an-chart-tip-trend">trend {fmt(trend[hp.i].v)}</span>
            )}
          </div>
        )}
      </div>
      {/* Padded by the ghost's gutter so the last date sits under the real
          curve's end — the axis stops where measured time stops, and the
          ghost visibly stands past it. */}
      <div className="an-chart-xaxis" aria-hidden="true" style={gutter ? { paddingRight: gutter } : undefined}>
        <span>{bucketLabel(series[0].t, unit)}</span>
        {/* A midpoint stop, once there are enough buckets that three labels
            read as an axis rather than a crowd. */}
        {n >= 5 && <span>{bucketLabel(series[Math.floor((n - 1) / 2)].t, unit)}</span>}
        <span>{bucketLabel(series[n - 1].t, unit)}</span>
      </div>
    </div>
  );
}

/** A bar with its top corners rounded (by up to 3px), its foot square. */
function barPath(x0, y0, w, h) {
  const r = Math.max(0, Math.min(3, w / 2, h));
  const x1 = x0 + w;
  const yb = y0 + h;
  return `M${x0.toFixed(1)},${yb.toFixed(1)}V${(y0 + r).toFixed(1)}Q${x0.toFixed(1)},${y0.toFixed(1)} ${(x0 + r).toFixed(1)},${y0.toFixed(1)}H${(x1 - r).toFixed(1)}Q${x1.toFixed(1)},${y0.toFixed(1)} ${x1.toFixed(1)},${(y0 + r).toFixed(1)}V${yb.toFixed(1)}Z`;
}
