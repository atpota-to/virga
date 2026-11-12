/**
 * A segmented control (styles/controls.css .segmented): a row of mutually
 * exclusive keys, one of them always pressed. A group of toggle buttons with
 * aria-pressed rather than a radio group, because each key acts the moment
 * it's pressed and the arrow keys are left to the page.
 *
 * `options` are `{ value, label, icon?, title?, ariaLabel? }`; `value` is the
 * pressed one. `icon` is a component (a lucide icon) drawn before the label.
 * The label is always in the markup, so a stylesheet that shows a key as its
 * icon alone (the kinds of engagement, on a phone) leaves it its name.
 * Pressing the pressed key calls `onChange` with it again, which a caller is
 * free to ignore.
 */
export default function Segmented({ options, value, onChange, label, className = '' }) {
  return (
    <div className={`segmented ${className}`.trim()} role="group" aria-label={label}>
      {options.map((o) => {
        const on = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={String(o.value)}
            type="button"
            className={`segmented-key${on ? ' is-on' : ''}${Icon ? ' has-icon' : ''}`}
            aria-pressed={on}
            aria-label={o.ariaLabel}
            title={o.title}
            onClick={() => onChange(o.value)}
          >
            {Icon && <Icon className="segmented-icon" size={18} aria-hidden="true" />}
            <span className="segmented-label">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
