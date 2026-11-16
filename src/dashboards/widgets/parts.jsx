// What every card file shares: the figure tile, how many rows a list of
// each size shows, and how tall a chart of each size is.

import Sparkline from '../../charts/Sparkline.jsx';
import { Link } from '../../lib/router.jsx';

export const ROWS = { xs: 3, s: 4, m: 5, l: 6, xl: 8 };
export const HEIGHT = { xs: 140, s: 150, m: 180, l: 220, xl: 240 };

/** How many rows a list shows: what the card was set to, else what fits its size. */
export function rowsFor(size, rows) {
  return rows || ROWS[size] || ROWS.m;
}

// A list of bars is shorter a row than a list of names, so it shows more.
const MORE_ROWS = { 'repo-collections': 3 };

/** How many rows a card of this type shows, as rowsFor, for a list that shows more. */
export function rowsShown(type, size, rows) {
  return rows || (ROWS[size] || ROWS.m) + (MORE_ROWS[type] || 0);
}

/**
 * A figure: its label, the number set large, and a line under it (the change
 * against the window before, and a note). A card wide enough to have the
 * room also draws its trend beside the number; a quarter of a row doesn't.
 */
export function Stat({ icon: Icon, label, window, value, delta, deltaTitle, sub, spark = null, to = null }) {
  return (
    <div className="stat">
      <div className="stat-head">
        <span className="stat-label">
          {Icon && <Icon size={14} aria-hidden="true" />}
          {to ? <Link to={to}>{label}</Link> : label}
        </span>
        {window && <span className="stat-window">{window}</span>}
      </div>
      <div className="stat-line">
        <span className="stat-value num">{value}</span>
        {spark && <Sparkline values={spark} />}
      </div>
      {(delta || sub) && (
        <div className="stat-note num">
          {delta}
          {deltaTitle && <span className="visually-hidden">{deltaTitle}</span>}
          {sub && <span className="stat-sub">{sub}</span>}
        </div>
      )}
    </div>
  );
}
