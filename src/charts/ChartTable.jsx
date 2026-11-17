import { useId, useState } from 'react';
import { Table2 } from 'lucide-react';
import { bucketLabel } from '../lib/analytics.js';
import { fmtCount, trendName } from './format.js';

/**
 * The line under a chart (.chart-foot): "Show as table" first, a link
 * action that opens the chart's table under the line, then `actions`, the
 * other things to do with the chart (Export, Post this chart, Add to
 * dashboard), as link actions. `children` is the table; it stays in the
 * markup while closed, hidden, so it is there the moment it is asked for.
 */
export function ShowAsTable({ actions = null, children }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <>
      <div className="chart-foot">
        <button type="button" className="link-action" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
          <Table2 size={14} aria-hidden="true" />
          Show as table
        </button>
        {actions}
      </div>
      <div id={id} className="an-tableview" hidden={!open}>
        {children}
      </div>
    </>
  );
}

/**
 * Every chart's plain twin: the same buckets as a real table, opened from
 * the line under the chart (ShowAsTable), so no value is reachable only by
 * pointer. `actions` go on that line after "Show as table". The trend's
 * column takes the name the chart's legend gives it ("7-day average").
 */
export default function ChartTable({
  series,
  secondary = null,
  trend = null,
  unit,
  valueHead,
  secondaryHead = null,
  format = fmtCount,
  actions = null,
}) {
  if (!series || series.length === 0) return null;
  return (
    <ShowAsTable actions={actions}>
      <div className="an-tableview-scroll">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{unit === 'month' ? 'Month' : unit === 'week' ? 'Week' : 'Day'}</th>
              <th scope="col" className="is-num">{valueHead}</th>
              {secondary && <th scope="col" className="is-num">{secondaryHead || 'Compared series'}</th>}
              {trend && <th scope="col" className="is-num">{trendName(series, trend, unit)}</th>}
            </tr>
          </thead>
          <tbody>
            {[...series].reverse().map((p) => {
              const i = series.indexOf(p);
              return (
                <tr key={p.t}>
                  <th scope="row">{bucketLabel(p.t, unit)}</th>
                  <td className="is-num">{format(p.v)}</td>
                  {secondary && <td className="is-num">{fmtCount(secondary[i]?.v ?? 0)}</td>}
                  {trend && <td className="is-num">{trend[i]?.v == null ? '—' : format(trend[i].v)}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </ShowAsTable>
  );
}
