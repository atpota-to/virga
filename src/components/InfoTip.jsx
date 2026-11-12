import { useId, useRef, useState } from 'react';
import { Info } from 'lucide-react';

/**
 * A small (i) that explains the number beside it. The explanation shows on
 * hover, on keyboard focus, and on a tap (for a phone, where there is no
 * hover); Escape or moving away hides it. The text is always in the markup,
 * tied to the button with aria-describedby, so a screen reader hears it.
 */
export default function InfoTip({ label = 'What this means', children }) {
  const id = useId();
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  // Hangs from the (i), moved sideways as far as it takes to stay 16px
  // inside both edges of the screen.
  const place = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const width = Math.min(280, window.innerWidth - 32);
    const left = Math.max(16 - r.left, Math.min(-10, window.innerWidth - 16 - width - r.left));
    setPos({ left, width });
  };
  return (
    <span className="info-tip" data-open={open || undefined} onMouseEnter={place} onMouseLeave={() => setOpen(false)}>
      <button
        ref={ref}
        type="button"
        className="info-tip-button"
        aria-label={label}
        aria-describedby={id}
        aria-expanded={open}
        onFocus={place}
        onClick={() => {
          place();
          setOpen((v) => !v);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
      >
        <Info size={13} aria-hidden="true" />
      </button>
      <span id={id} role="tooltip" className="info-tip-pop" style={pos ? { left: pos.left, width: pos.width } : undefined}>
        {children}
      </span>
    </span>
  );
}

/** Why the profile's follower counter and the listable count differ. */
export function FollowerCountTip({ profileCount, listed }) {
  return (
    <InfoTip label="Why there are two follower counts">
      {profileCount.toLocaleString('en-US')} is Bluesky’s own counter, the number on your profile. It still counts accounts
      that were deactivated, suspended or deleted, and it can lag. {listed.toLocaleString('en-US')} is everyone who can be
      listed right now, which is what the charts and reports count.
    </InfoTip>
  );
}
