import { isValidElement } from 'react';
import './charts.css';
import { activeLocale } from '../lib/locale.js';

/** The label column: one width for words and one for NSIDs, the same in every list. */
const LABEL_WORDS = '136px';
const LABEL_NSID = '200px';

/**
 * Ranked rows, each a label, a bar and its value: the share of the biggest
 * row, read at a glance, with the exact number beside it. `rows` are
 * `{ key, label, value, icon?, display?, title? }`; `label` may be markup
 * (a <code> NSID, a link). The label column is the list's own choice, not
 * the caller's: every list of words starts its bars at the same place, and
 * a list of NSIDs (labels in <code>) a little further in.
 */
export default function BarList({ rows, format = (v) => v.toLocaleString(activeLocale()), max = null, ariaLabel }) {
  if (!rows?.length) return null;
  const top = max ?? Math.max(...rows.map((r) => r.value), 1);
  const nsids = rows.some((r) => isValidElement(r.label) && r.label.type === 'code');
  return (
    <ol className="barlist" aria-label={ariaLabel} style={{ '--barlist-label': nsids ? LABEL_NSID : LABEL_WORDS }}>
      {rows.map((r) => {
        const Icon = r.icon;
        return (
          <li key={r.key ?? r.label} className="barlist-row" title={r.title}>
            <span className="barlist-label">
              {Icon && <Icon aria-hidden="true" />}
              <span className="barlist-label-text" title={plainText(r.label)}>
                {r.label}
              </span>
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

/** A label's words, for its title when they are cut short; markup gives its own text if it is plain. */
function plainText(label) {
  if (typeof label === 'string' || typeof label === 'number') return String(label);
  if (isValidElement(label) && typeof label.props.children === 'string') return label.props.children;
  return undefined;
}
