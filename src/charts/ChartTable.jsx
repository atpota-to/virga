import { bucketLabel } from '../lib/analytics.js';
import { fmtCount } from './format.js';

/**
 * Every chart's plain twin: the same buckets as a real table, behind a
 * disclosure, so no value is reachable only by pointer.
 */
export default function ChartTable({ series, secondary = null, trend = null, unit, valueHead, secondaryHead = null, format = fmtCount }) {
  if (!series || series.length === 0) return null;
  return (
    <details className="an-tableview disclosure">
      <summary>Show as table</summary>
      <div className="an-tableview-scroll">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">{unit === 'month' ? 'Month' : unit === 'week' ? 'Week' : 'Day'}</th>
              <th scope="col" className="is-num">{valueHead}</th>
              {secondary && <th scope="col" className="is-num">{secondaryHead || 'Compared series'}</th>}
              {trend && <th scope="col" className="is-num">Trend</th>}
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
    </details>
  );
}
