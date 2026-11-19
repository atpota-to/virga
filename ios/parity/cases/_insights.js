// Helpers for the insights generators (ios/parity/cases/insights-*.js).
//
// The app's tables name lucide-react icons by component. A fixture can't
// hold a component, so each icon is recorded by its name: the component's
// displayName ("CalendarClock"; ImageIcon's is "Image"). The Swift tables
// carry the same names, and VirgaInsights' Icons.sfSymbol(lucide:) maps each
// to an SF Symbol.

/** An icon component's name, or the value itself when it isn't one. */
export function iconName(icon) {
  if (icon && typeof icon === 'object' && typeof icon.displayName === 'string')
    return icon.displayName;
  if (typeof icon === 'function' && typeof icon.displayName === 'string')
    return icon.displayName;
  return icon;
}

/** A copy of `value` with every `icon` member replaced by its name. */
export function withIconNames(value) {
  if (Array.isArray(value)) return value.map(withIconNames);
  if (value && typeof value === 'object' && !iconLike(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value))
      out[k] = k === 'icon' ? iconName(v) : withIconNames(v);
    return out;
  }
  return value;
}

function iconLike(value) {
  return typeof value.displayName === 'string' && '$$typeof' in value;
}
