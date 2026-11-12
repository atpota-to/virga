import './charts.css';

/**
 * A grid of cells shaded on one blue ramp, lightest for "nothing": weekdays
 * down the side, hours across. `rows` are `{ label, cells: [{ value, title,
 * best? }] }`, where a null value is a cell with too little to say (drawn as
 * an outline, not as zero). `columns` label the hours: `{ label, span }`.
 *
 * Every cell's number is in its tooltip, and `summary` (one sentence on
 * where it peaks) is what a screen reader hears for the whole grid.
 */
export default function Heatmap({ rows, columns, summary, cellHeight = 18, legend = true }) {
  if (!rows?.length) return null;
  const cols = rows[0].cells.length;
  const values = rows.flatMap((r) => r.cells.map((c) => c.value)).filter((v) => v != null);
  const max = Math.max(...values, 0);
  const step = (v) => (v == null ? null : v <= 0 || !max ? 0 : Math.min(6, 1 + Math.floor((v / max) * 5.999)));
  return (
    <div>
      <div className="heatmap" role="img" aria-label={summary} style={{ '--heat-cols': cols, '--heat-cell-h': `${cellHeight}px` }}>
        {rows.map((r) => (
          <div key={r.label} style={{ display: 'contents' }}>
            <span className="heatmap-day" aria-hidden="true">
              {r.label}
            </span>
            {r.cells.map((c, i) => {
              const s = step(c.value);
              return (
                <span
                  key={i}
                  className={`heatmap-cell${c.best ? ' is-best' : ''}`}
                  data-step={s ?? undefined}
                  data-empty={s == null ? '' : undefined}
                  title={c.title}
                />
              );
            })}
          </div>
        ))}
        <span aria-hidden="true" />
        {(columns || []).map((c, i) => (
          <span key={i} className="heatmap-hour" style={{ '--heat-span': c.span || 1 }} aria-hidden="true">
            {c.label}
          </span>
        ))}
      </div>
      {legend && (
        <div className="heatmap-legend" aria-hidden="true">
          <span>Less</span>
          {[0, 1, 2, 3, 4, 5, 6].map((s) => (
            <span key={s} className="heatmap-cell" data-step={s} />
          ))}
          <span>More</span>
        </div>
      )}
    </div>
  );
}
