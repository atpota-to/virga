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

export function Stat({ icon: Icon, label, window, value, delta, deltaTitle, sub, spark = null, to = null }) {
  return (
    <div className="stat">
      <div className="stat-head">
        <span className="stat-label">
          {Icon && <Icon size={15} aria-hidden="true" />}
          {to ? <Link to={to}>{label}</Link> : label}
        </span>
        {window && <span className="stat-window">{window}</span>}
      </div>
      <div className="stat-line">
        <span className="stat-value num">{value}</span>
        {delta}
        {deltaTitle && <span className="visually-hidden">{deltaTitle}</span>}
      </div>
      {sub && <div className="stat-sub num">{sub}</div>}
      {spark && <Sparkline values={spark} />}
    </div>
  );
}
