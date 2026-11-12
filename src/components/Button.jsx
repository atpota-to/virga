import { forwardRef } from 'react';

/**
 * The app's one button (styles/controls.css). Tiers on one base:
 *   variant 'quiet' (default, outlined) · 'primary' (one per view) ·
 *   'ghost' (no box until pointed at) · 'danger' · 'text' (an alias of ghost)
 * and three sizes, 'sm', 'md' (default) and 'lg'. `icon` makes it square, for
 * a button holding a glyph alone (give it an aria-label). `on` gives it the
 * pressed look, for a button that is a state (Following). Renders a
 * <button type="button"> unless `as` names something else, such as 'a',
 * which then takes its own props (`href`).
 *
 * The classes work without it too: <a className="btn btn--sm">.
 */
const Button = forwardRef(function Button(
  { as: Comp = 'button', variant = 'quiet', size = 'md', on = false, icon = false, className = '', type, ...rest },
  ref,
) {
  const cls = buttonClass({ variant, size, on, icon, className });
  const typeProp = Comp === 'button' ? { type: type || 'button' } : type ? { type } : null;
  return <Comp ref={ref} className={cls} {...typeProp} {...rest} />;
});

export default Button;

/** The class string for a tier, for markup that can't use the component. */
export function buttonClass({ variant = 'quiet', size = 'md', on = false, icon = false, className = '' } = {}) {
  return [
    'btn',
    variant !== 'quiet' && `btn--${variant}`,
    size !== 'md' && `btn--${size}`,
    icon && 'btn--icon',
    on && 'is-on',
    className,
  ]
    .filter(Boolean)
    .join(' ');
}
