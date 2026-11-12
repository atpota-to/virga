// The six reports, in the order the sidebar lists them.

import { Ban, Cloud, Heart, PenLine, UserPlus, UsersRound } from 'lucide-react';

export const REPORTS = Object.freeze([
  { key: 'followers', label: 'Followers', icon: UserPlus, desc: 'Growth over time, new followers, and who is newest.' },
  { key: 'blocks', label: 'Blocks', icon: Ban, desc: 'Who blocks you, directly or through moderation lists.' },
  { key: 'posts', label: 'Posts', icon: PenLine, desc: 'How often you post, and how much of it is replies and media.' },
  { key: 'engagement', label: 'Engagement', icon: Heart, desc: 'What your posts earn, the rate per post, and what you give.' },
  { key: 'people', label: 'People', icon: UsersRound, desc: 'Who engages with you, and who you engage with.' },
  { key: 'atmosphere', label: 'Atmosphere', icon: Cloud, desc: 'Every record every app has written to your repo.' },
]);

export const REPORT_BY_KEY = Object.freeze(Object.fromEntries(REPORTS.map((r) => [r.key, r])));
