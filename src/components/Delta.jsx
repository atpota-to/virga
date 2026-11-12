import { deltaText } from '../charts/format.js';

/**
 * A change against the window before, as a small chip: which way it went,
 * not whether that is good (more blocks is "up" too). `title` names what it
 * was compared with. Nothing at all when there is no comparison.
 */
export default function Delta({ pct, title, plain = false }) {
  if (pct === undefined) return null;
  const dir = pct == null ? '' : pct > 0 ? ' is-up' : pct < 0 ? ' is-down' : '';
  return (
    <span className={`delta${dir}${plain ? ' delta--plain' : ''}`} title={title || undefined}>
      {deltaText(pct)}
    </span>
  );
}
