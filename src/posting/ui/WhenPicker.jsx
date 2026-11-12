import { useId } from 'react';

function toLocalInput(iso) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * When a post goes out: a date and time, or (with `queue`) the next open
 * slot in the weekly queue. `value` is an ISO string or null. A placeholder
 * with a plain date and time field until the full picker is built.
 */
// eslint-disable-next-line no-unused-vars
export default function WhenPicker({ did, value, onChange, queue = false, onQueue, min, max }) {
  const id = useId();
  return (
    <div className="when-picker">
      <label className="field" htmlFor={id}>
        <span className="field-label">Date and time</span>
        <input
          id={id}
          type="datetime-local"
          className="input"
          value={toLocalInput(value)}
          min={toLocalInput(min) || undefined}
          max={toLocalInput(max) || undefined}
          onChange={(e) => {
            const t = Date.parse(e.target.value);
            onChange?.(Number.isFinite(t) ? new Date(t).toISOString() : null);
          }}
        />
      </label>
      {queue && onQueue && (
        <button type="button" className="btn btn--sm" onClick={onQueue}>
          Next open slot in the queue
        </button>
      )}
    </div>
  );
}
