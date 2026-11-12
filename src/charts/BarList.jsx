import './charts.css';

/**
 * Ranked rows, each a label, a bar and its value: the share of the biggest
 * row, read at a glance, with the exact number beside it. `rows` are
 * `{ key, label, value, icon?, display?, title? }`; `label` may be markup
 * (a <code> NSID, a link).
 */
export default function BarList({ rows, labelWidth = '1.2fr', format = (v) => v.toLocaleString('en-US'), max = null, ariaLabel }) {
  if (!rows?.length) return null;
  const top = max ?? Math.max(...rows.map((r) => r.value), 1);
  return (
    <ol className="barlist" aria-label={ariaLabel} style={{ '--barlist-label': labelWidth }}>
      {rows.map((r) => {
        const Icon = r.icon;
        return (
          <li key={r.key ?? r.label} className="barlist-row" title={r.title}>
            <span className="barlist-label">
              {Icon && <Icon aria-hidden="true" />}
              {r.label}
            </span>
            <span className="barlist-track" aria-hidden="true">
              <span className="barlist-fill" style={{ width: `${top ? (r.value / top) * 100 : 0}%` }} />
            </span>
            <span className="barlist-value">{r.display ?? format(r.value)}</span>
          </li>
        );
      })}
    </ol>
  );
}
