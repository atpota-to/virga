// The pieces every report page is built from: a figure for the strip at the
// top, a titled card, the unit toggle a chart wears, the table a ranked
// group can be read as, and the "How this is counted" fold.

import { fmtFigure, unitLabel, unitNoun } from '../charts/format.js';
import Delta from '../components/Delta.jsx';
import Segmented from '../components/Segmented.jsx';

/** One figure for the strip: the label, the number, and a note under it. */
export function fig(label, value, { sub = null, delta, deltaTitle = null, decimals = false, unit = null } = {}) {
  const shown = typeof value === 'number' ? fmtFigure(value, { decimals }) : value;
  return {
    key: label,
    label,
    value: (
      <>
        {shown}
        {unit && <span className="fig-unit">{unit}</span>}
      </>
    ),
    note:
      sub || delta !== undefined ? (
        <span className="fig-note">
          {delta !== undefined && <Delta pct={delta} title={deltaTitle} />}
          {sub && <span>{sub}</span>}
        </span>
      ) : null,
  };
}

export function ModeToggle({ value, onChange, options, label = 'Chart' }) {
  return <Segmented size="sm" label={label} value={value} onChange={onChange} options={options.map((o) => ({ value: o.key, label: o.label, title: o.title }))} />;
}

export function unitOptions(units, noun) {
  return units.map((u) => ({ key: u, label: unitLabel(u), title: `${noun} per ${unitNoun(u)}` }));
}

export function Card({ title, sub = null, tools = null, children, className = '' }) {
  return (
    <section className={`card ${className}`.trim()} aria-label={typeof title === 'string' ? title : undefined}>
      <div className="card-head">
        <div>
          <h2 className="card-title">{title}</h2>
          {sub && <p className="card-sub">{sub}</p>}
        </div>
        {tools}
      </div>
      {children}
    </section>
  );
}

export function HowCounted({ children }) {
  return (
    <details className="card disclosure how-counted">
      <summary>How this is counted</summary>
      <div className="how-counted-body">{children}</div>
    </details>
  );
}

/**
 * A bar list's plain twin, as ChartTable is a chart's: the same rows as a
 * real table behind "Show as table". `columns` are `{ head, cell(row), num? }`;
 * the first is the row's heading.
 */
export function GroupTable({ rows, columns }) {
  if (!rows?.length) return null;
  const [first, ...rest] = columns;
  return (
    <details className="an-tableview disclosure">
      <summary>Show as table</summary>
      <div className="an-tableview-scroll">
        <table className="table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.head} scope="col" className={c.num ? 'is-num' : undefined}>
                  {c.head}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.key ?? i}>
                <th scope="row">{first.cell(row)}</th>
                {rest.map((c) => (
                  <td key={c.head} className={c.num ? 'is-num' : undefined}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
