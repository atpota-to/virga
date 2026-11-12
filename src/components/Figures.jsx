/**
 * A row of figures: each a large numeral with its label under it, and an
 * optional note under that (a qualifier, or the change against the previous
 * window). The label sits below the number, not over it, so the number is
 * what the eye lands on. Rendered as a <dl>.
 *
 * `items` are `{ key, value, label, note? }`. Numbers get thousands
 * separators, anything else prints as given, and a missing value is skipped.
 * Four or five to a row on a wide screen, two on a phone.
 */
export default function Figures({ items, label, className = '' }) {
  const shown = (items || []).filter((f) => f && f.value != null && f.value !== '');
  if (!shown.length) return null;
  return (
    <dl className={`figures ${className}`.trim()} aria-label={label} style={{ '--figures-count': shown.length }}>
      {shown.map((f) => (
        <div key={f.key || f.label} className="figures-cell">
          {/* The term comes first in the markup, as a <dl> wants; the
              stylesheet sets the numeral above it. */}
          <dt className="figures-label">{f.label}</dt>
          <dd className="figures-value">
            {typeof f.value === 'number' ? f.value.toLocaleString('en-US') : f.value}
          </dd>
          {f.note && <dd className="figures-note">{f.note}</dd>}
        </div>
      ))}
    </dl>
  );
}
