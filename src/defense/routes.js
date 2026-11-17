// Defense's pages. One for now: scanning a post (docs/DEFENSE.md, phase 2).
// Lists, the moderator and the shield come later, each a page of its own
// here, and the sidebar, the phone's tab bar and the command palette pick
// them up from this list.

import { ShieldHalf } from 'lucide-react';

export const DEFENSE_BASE = '/defense';

/** The part's icon, wherever the part is named. */
export const DEFENSE_ICON = ShieldHalf;

export const DEFENSE_PAGES = Object.freeze([
  {
    key: 'scan',
    path: DEFENSE_BASE,
    label: 'Scan a post',
    title: 'Defense',
    icon: ShieldHalf,
    desc: 'Everyone who engaged with a post, sorted by how close each of them is to you.',
  },
]);

/** The page an address inside /defense names, or null for one it doesn't. */
export function parseDefenseRoute(parts) {
  if (parts[0] !== 'defense') return null;
  if (parts.length === 1) return { key: 'scan' };
  return null;
}
