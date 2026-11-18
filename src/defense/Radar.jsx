// The radar: who engaged with a post, drawn as rings round you.
//
// You are the dot at the centre. The rings, from the inside: the people
// nothing will ever add (protected, behind a dashed edge because nothing
// crosses it), then connected, then peripheral, and the wide outer ring of
// everyone with no connection to you, notable accounts among them. A slice is
// what they did to the post. The people near you are a mark each; the
// strangers are texture, with their count written in their slice.
//
// It sits on the page like any chart, in the page's own tokens: ink for the
// protected, the accent for the connected (the data that matters most), the
// second colour for the peripheral, ink again for the notable (a diamond, so
// shape tells them apart as well as colour), and the chart's ghost grey for
// the strangers.
//
// It can be pointed at, and walked with the arrow keys once focused; Enter
// picks the account under the callout. It is still a picture: the counts are
// in the table under it (Show as table), and every account near you is in
// the list on the page.
//
// After bluesky-mod's radar (src/panel/public/radar.js), drawn in SVG.

import { useId, useMemo, useRef, useState } from 'react';
import { fmtInt } from '../lib/locale.js';
import { BAND_WORD } from './bandWords.js';
import { EDGES, nearest, place, sectorAngles, texture, walkOrder } from './radar.js';

/** The drawing's own units: a square this many across. */
const SIZE = 1000;
const C = SIZE / 2;

/** How far a pointer may be from a mark and still be over it, in screen pixels. */
const HIT_PX = 12;


/** The circle's radius as a share of the square: room left round it for the slices' words. */
const reachFor = (count) => (count === 4 ? 0.43 : 0.38);

function Mark({ p, x, y, picked }) {
  const r = p.band === 'CONNECTED' ? 8 : 7;
  let shape;
  if (p.band === 'PROTECTED') shape = <circle cx={x} cy={y} r={r - 1} className="radar-mark" data-band="PROTECTED" />;
  else if (p.band === 'NOTABLE') {
    const d = r + 1.5;
    shape = <path d={`M${x} ${y - d}L${x + d} ${y}L${x} ${y + d}L${x - d} ${y}Z`} className="radar-mark" data-band="NOTABLE" />;
  } else shape = <circle cx={x} cy={y} r={r} className="radar-mark" data-band={p.band} />;
  return (
    <g>
      {shape}
      {picked && <circle cx={x} cy={y} r={r + 6} className="radar-picked" />}
    </g>
  );
}

/**
 * @param {object} props
 * @param {{ sectors: object[], points: object[], byBand: object, total: number }} props.model  scanRadar(summary)
 * @param {string} props.label             what the picture shows, for a screen reader
 * @param {(row: object) => { title: string, lines: string[] }} props.describe
 * @param {(row: object) => void} [props.onPick]
 * @param {string|null} [props.picked]      a DID to ring
 */
export default function Radar({ model, label, describe, onPick = null, picked = null }) {
  const stageRef = useRef(null);
  const [hover, setHover] = useState(null);
  const [said, setSaid] = useState('');
  const hintId = useId();
  const n = model.sectors.length;
  const reach = reachFor(n);
  const R = reach * SIZE;
  const slices = useMemo(() => sectorAngles(n), [n]);
  const placed = useMemo(() => place(model.points, n), [model.points, n]);
  const dust = useMemo(() => texture(model.sectors.map((s) => s.far || 0)), [model.sectors]);
  const order = useMemo(() => walkOrder(placed), [placed]);
  const px = (v) => C + v * R;

  /** Where a pointer is, in the layout's units, and how near counts as on a mark. */
  function at(event) {
    const rect = stageRef.current.getBoundingClientRect();
    const scale = rect.width / SIZE;
    return {
      x: (event.clientX - rect.left - rect.width / 2) / (R * scale),
      y: (event.clientY - rect.top - rect.height / 2) / (R * scale),
      within: HIT_PX / (R * scale),
    };
  }

  function point(p, { announce = false } = {}) {
    setHover(p);
    if (announce && p) {
      const { title, lines } = describe(p.row);
      setSaid([title, ...lines].join('. '));
    }
  }

  const onKeyDown = (event) => {
    if (event.target !== stageRef.current || !order.length) return;
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (step) {
      event.preventDefault();
      const i = hover ? order.indexOf(hover) : step > 0 ? -1 : 0;
      point(order[(i + step + order.length) % order.length], { announce: true });
    } else if ((event.key === 'Enter' || event.key === ' ') && hover && onPick) {
      event.preventDefault();
      onPick(hover.row);
    } else if (event.key === 'Escape') {
      point(null);
    }
  };

  const four = n === 4;
  const callout = hover ? describe(hover.row) : null;
  // The callout goes to the side of the mark with more room.
  const calloutAt = hover
    ? {
        right: hover.x < 0.12,
        left: `${(px(hover.x) / SIZE) * 100}%`,
        top: `${Math.max(2, Math.min(78, (px(hover.y) / SIZE) * 100 - 4))}%`,
      }
    : null;

  return (
    <div className="radar">
      <div
        ref={stageRef}
        className="radar-stage"
        tabIndex={0}
        role="group"
        aria-label={label}
        aria-describedby={order.length ? hintId : undefined}
        data-pointing={hover ? '' : undefined}
        onPointerMove={(event) => {
          const { x, y, within } = at(event);
          const hit = nearest(placed, x, y, within);
          if (hit !== hover) point(hit);
        }}
        onPointerLeave={() => {
          if (document.activeElement !== stageRef.current) point(null);
        }}
        onClick={(event) => {
          if (!onPick) return;
          const { x, y, within } = at(event);
          const hit = nearest(placed, x, y, within * 1.4);
          if (hit) onPick(hit.row);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => point(null)}
      >
        <svg className="radar-svg" viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true" focusable="false">
          {/* The outer ring, where the strangers are; the inner ones over it. */}
          <circle cx={C} cy={C} r={EDGES.OUTER * R} className="radar-ground radar-ground--far" />
          <circle cx={C} cy={C} r={EDGES.PERIPHERAL * R} className="radar-ground" />
          <circle cx={C} cy={C} r={EDGES.PERIPHERAL * R} className="radar-edge" />
          <circle cx={C} cy={C} r={EDGES.CONNECTED * R} className="radar-edge" />
          <circle cx={C} cy={C} r={EDGES.OUTER * R} className="radar-edge" />
          <circle cx={C} cy={C} r={EDGES.PROTECTED * R} className="radar-edge radar-edge--protected" />
          {slices.map((s, i) => (
            <line
              key={i}
              x1={C + Math.cos(s.start) * EDGES.PROTECTED * R}
              y1={C + Math.sin(s.start) * EDGES.PROTECTED * R}
              x2={C + Math.cos(s.start) * R}
              y2={C + Math.sin(s.start) * R}
              className="radar-axis"
            />
          ))}
          <g className="radar-dust">
            {dust.map((d, i) => (
              <rect key={i} x={px(d.x) - 2.5} y={px(d.y) - 2.5} width={5} height={5} />
            ))}
          </g>
          {/* Larger marks last, so the connected are drawn over the rest. */}
          {[...placed]
            .sort((a, b) => Number(a.band === 'CONNECTED') - Number(b.band === 'CONNECTED'))
            .map((p) => (
              <Mark key={p.id} p={p} x={px(p.x)} y={px(p.y)} picked={picked === p.id} />
            ))}
          {hover && <circle cx={px(hover.x)} cy={px(hover.y)} r={15} className="radar-hover" />}
          <circle cx={C} cy={C} r={7} className="radar-you-dot" />
        </svg>

        <div className="radar-labels" aria-hidden="true">
          {model.sectors.map((s, i) => {
            const style = four
              ? null
              : {
                  left: `${50 + Math.cos(slices[i].mid) * (reach + 0.065) * 100}%`,
                  top: `${50 + Math.sin(slices[i].mid) * (reach + 0.065) * 100}%`,
                };
            return (
              <span key={s.key} className={`radar-sector${four ? ` radar-corner-${i}` : ' radar-sector-free'}`} style={style || undefined}>
                <span className="radar-sector-name">{s.name}</span>
                <span className="radar-sector-total num">{fmtInt(s.total)}</span>
              </span>
            );
          })}
          {model.sectors.map((s, i) =>
            s.far ? (
              <span
                key={`far-${s.key}`}
                className="radar-far num"
                style={{
                  left: `${50 + Math.cos(slices[i].mid) * 0.8 * reach * 100}%`,
                  top: `${50 + Math.sin(slices[i].mid) * 0.8 * reach * 100}%`,
                }}
              >
                {fmtInt(s.far)} {s.far === 1 ? 'stranger' : 'strangers'}
              </span>
            ) : null,
          )}
          <span className="radar-you">You</span>
        </div>

        {callout && (
          <div className="radar-callout" data-side={calloutAt.right ? 'right' : 'left'} style={{ left: calloutAt.left, top: calloutAt.top }}>
            <strong>{callout.title}</strong>
            {callout.lines.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </div>
        )}
      </div>
      <p id={hintId} className="visually-hidden">
        Arrow keys move between the accounts near you{onPick ? '; Enter finds one in the list below' : ''}.
      </p>
      <p className="visually-hidden" aria-live="polite">
        {said}
      </p>
      <Legend byBand={model.byBand} />
    </div>
  );
}

/** What each mark means, with how many there are of each. */
export function Legend({ byBand }) {
  return (
    <ul className="radar-legend" aria-label="What the marks mean">
      {['PROTECTED', 'CONNECTED', 'PERIPHERAL', 'NOTABLE', 'UNKNOWN'].map((band) => (
        <li key={band}>
          <BandMark band={band} />
          <span>{BAND_WORD[band]}</span>
          <span className="num radar-legend-n">{fmtInt(byBand?.[band] || 0)}</span>
        </li>
      ))}
    </ul>
  );
}

/** A band's mark, for the legend and the list. */
export function BandMark({ band }) {
  return (
    <svg className="band-mark" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      {band === 'PROTECTED' ? (
        <circle cx="6" cy="6" r="4" className="radar-mark" data-band="PROTECTED" />
      ) : band === 'NOTABLE' ? (
        <path d="M6 1.5L10.5 6L6 10.5L1.5 6Z" className="radar-mark" data-band="NOTABLE" />
      ) : band === 'UNKNOWN' ? (
        <rect x="4" y="4" width="4" height="4" className="radar-dust-mark" />
      ) : (
        <circle cx="6" cy="6" r="4.5" className="radar-mark" data-band={band} />
      )}
    </svg>
  );
}

