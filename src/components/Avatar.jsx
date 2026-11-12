/**
 * Someone's picture, or the first letter of their name on a plain disc when
 * they have none. Always decorative: the name is beside it.
 */
export default function Avatar({ src, name, size = 'md' }) {
  const cls = `avatar${size === 'md' ? '' : ` avatar--${size}`}`;
  if (src) return <img className={cls} src={src} alt="" loading="lazy" />;
  const letter = String(name || '?').replace(/^@/, '').trim().charAt(0).toUpperCase() || '?';
  return (
    <span className={cls} aria-hidden="true">
      {letter}
    </span>
  );
}
