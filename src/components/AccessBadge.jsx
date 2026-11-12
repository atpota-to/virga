import { Eye, Lock, PenLine, Server, UserCheck } from 'lucide-react';

/**
 * What a feature can touch, in a word or two, for the header of a tool or a
 * posting page. 'read' only reads; 'follow' uses the follow permission;
 * 'post' writes and deletes posts; 'server' runs on Virga's server (a long
 * session); 'ask' would need a permission Virga doesn't ask for today.
 */
export const ACCESS = Object.freeze({
  read: { label: 'Read only', tone: '', icon: Eye },
  follow: { label: 'Can follow and unfollow', tone: 'accent', icon: UserCheck },
  post: { label: 'Can post and delete posts', tone: 'accent', icon: PenLine },
  server: { label: 'Uses Virga’s server', tone: 'outline', icon: Server },
  ask: { label: 'Would ask for a new permission', tone: 'warn', icon: Lock },
});

export default function AccessBadge({ kind }) {
  const a = ACCESS[kind];
  if (!a) return null;
  const Icon = a.icon;
  return (
    <span className={`badge${a.tone ? ` badge--${a.tone}` : ''}`}>
      <Icon aria-hidden="true" />
      {a.label}
    </span>
  );
}
