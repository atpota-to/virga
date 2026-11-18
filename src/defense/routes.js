// Defense's pages: scanning a post (phase 2), and the lists it fills and their
// history (phase 3). The moderator and the shield come later, each a page of
// its own here; the sidebar and the command palette pick them up from this
// list.

import { History, List, ShieldHalf } from 'lucide-react';

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
  {
    key: 'lists',
    path: `${DEFENSE_BASE}/lists`,
    label: 'Lists',
    title: 'Lists',
    icon: List,
    desc: 'The block and mute lists Defense keeps for you, what is being written to them, and who you keep off them.',
  },
  {
    key: 'history',
    path: `${DEFENSE_BASE}/history`,
    label: 'History',
    title: 'History',
    icon: History,
    desc: 'Everyone added to or taken off your lists, when and why, and the way to undo it.',
  },
]);

export const DEFENSE_PAGE_BY_KEY = Object.freeze(Object.fromEntries(DEFENSE_PAGES.map((p) => [p.key, p])));

/** The page an address inside /defense names, or null for one it doesn't. */
export function parseDefenseRoute(parts) {
  if (parts[0] !== 'defense') return null;
  if (parts.length === 1) return { key: 'scan' };
  if (parts.length === 2 && (parts[1] === 'lists' || parts[1] === 'history')) return { key: parts[1] };
  return null;
}
