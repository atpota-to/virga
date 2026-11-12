// The tools, grouped as the Tools page shows them. `access` says what each
// can touch: 'read' (only reads), 'follow' (uses the follow permission the
// sign-in already asks for), or 'ask' (would need a permission Virga doesn't
// ask for today, so it isn't built).

import { Archive, Clock, Fingerprint, List, Send, Shield, UserMinus, UserPlus, UserX, UsersRound } from 'lucide-react';

export const TOOL_SECTIONS = Object.freeze([
  { key: 'tidy', title: 'Tidy up', desc: 'Keep your follows and followers in order.' },
  { key: 'understand', title: 'Understand', desc: 'Answers to the questions the charts raise.' },
  { key: 'data', title: 'Your data', desc: 'What Virga keeps in this browser, and how to take it with you.' },
  { key: 'later', title: 'Later', desc: 'Ideas that need more than Virga asks for today. Each would ask you first.' },
]);

export const TOOLS = Object.freeze([
  { key: 'follow-cleanup', name: 'Follow cleanup', icon: UserMinus, section: 'tidy', access: 'follow', desc: 'Find accounts you follow that went quiet, are gone, or don’t follow back, and unfollow in bulk.' },
  { key: 'unfollow-tracker', name: 'Unfollow tracker', icon: UserX, section: 'tidy', access: 'read', desc: 'See who unfollowed you between two syncs, and who arrived.' },
  { key: 'follow-back', name: 'Follow-back queue', icon: UserPlus, section: 'tidy', access: 'follow', desc: 'People who follow you and engage with your posts, that you don’t follow yet.' },
  { key: 'best-time', name: 'Best time to post', icon: Clock, section: 'understand', access: 'read', desc: 'When your posts earn the most, by weekday and hour, from your own history.' },
  { key: 'lists', name: 'Lists you’re on', icon: Shield, section: 'understand', access: 'read', desc: 'Every list that includes you, with moderation lists and their subscribers flagged.' },
  { key: 'archive', name: 'Archive search and export', icon: Archive, section: 'data', access: 'read', desc: 'Search every post you’ve made and download it as JSON or CSV.' },
  { key: 'identity', name: 'Identity inspector', icon: Fingerprint, section: 'data', access: 'read', desc: 'Your DID, your PDS, your handle history and what each app writes to your repo.' },
  { key: 'interaction-lookup', name: 'Interaction lookup', icon: UsersRound, section: 'later', access: 'read', planned: true, desc: 'Your whole history with one account: likes, replies and follows, both ways.' },
  { key: 'list-manager', name: 'List manager', icon: List, section: 'later', access: 'ask', planned: true, desc: 'Keep a Bluesky list in step with a filter, such as mutuals you talk to every week.' },
  { key: 'scheduled-posts', name: 'Drafts and scheduled posts', icon: Send, section: 'later', access: 'ask', planned: true, desc: 'Write now and post later, from this browser.' },
]);

export const TOOL_BY_KEY = Object.freeze(Object.fromEntries(TOOLS.map((t) => [t.key, t])));

export const ACCESS = Object.freeze({
  read: { label: 'Read only', tone: '' },
  follow: { label: 'Can follow and unfollow', tone: 'accent' },
  ask: { label: 'Would ask for a new permission', tone: 'warn' },
});
