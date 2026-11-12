import { forwardRef } from 'react';

/**
 * The app's one button (styles/controls.css). Three tiers on one base:
 *   variant 'quiet' (default) · 'primary' (one per view) · 'text'
 * and two sizes, 'md' (default) and 'sm'. `on` gives it the pressed look, for
 * a button that is a state (Following). Renders a <button type="button">
 * unless `as` names something else, such as 'a', which then takes its own
 * props (`href`).
 *
 * The classes work without it too: <a className="btn btn--sm">.
 */
const Button = forwardRef(function Button(
  { as: Comp = 'button', variant = 'quiet', size = 'md', on = false, className = '', type, ...rest },
  ref,
) {
  const cls = buttonClass({ variant, size, on, className });
  const typeProp = Comp === 'button' ? { type: type || 'button' } : type ? { type } : null;
  return <Comp ref={ref} className={cls} {...typeProp} {...rest} />;
});

export default Button;

/** The class string for a tier, for markup that can't use the component. */
export function buttonClass({ variant = 'quiet', size = 'md', on = false, className = '' } = {}) {
  return [
    'btn',
    variant !== 'quiet' && `btn--${variant}`,
    size === 'sm' && 'btn--sm',
    on && 'is-on',
    className,
  ]
    .filter(Boolean)
    .join(' ');
}
