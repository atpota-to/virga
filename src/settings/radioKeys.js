// The keys of a radio group, as the ARIA pattern has them: the arrows move
// to the next or the last choice and wrap at the ends, Home and End go to
// the first and the last. Moving chooses, as it does in a native group.

/**
 * The index a key moves to from `index` in a group of `count`, or null for
 * a key the group leaves alone.
 */
export function radioKeyTarget(key, index, count) {
  if (!(count > 0)) return null;
  const at = index >= 0 && index < count ? index : 0;
  if (key === 'ArrowRight' || key === 'ArrowDown') return (at + 1) % count;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (at - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}
