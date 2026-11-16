import { Eye, Lock, PenLine, Server, UserCheck } from 'lucide-react';

/**
 * What a feature can touch, in a word or two, for the header of a tool or a
 * posting page. 'read' only reads; 'follow' uses the follow permission;
 * 'post' writes and deletes posts; 'server' runs on Virga's server (a long
 * session); 'ask' would need a permission Virga doesn't ask for today, the
 * one that is a warning. How loud each is said is the stylesheet's
 * (.access-item in controls.css): writing a little louder than reading.
 */
export const ACCESS = Object.freeze({
  read: { label: 'Read only', icon: Eye },
  follow: { label: 'Can follow and unfollow', icon: UserCheck },
  post: { label: 'Can post and delete posts', icon: PenLine },
  server: { label: 'Uses Virga’s server', icon: Server },
  ask: { label: 'Would ask for a new permission', tone: 'warn', icon: Lock },
});

/**
 * The access line: what a page or a tool can touch, as muted words with
 * an icon each, one after another ("✎ Can post and delete posts · ⛁ Uses
 * Virga’s server"). PageHeader draws it under a page's sub with
 * className="page-access meta"; the Tools index draws it in each row.
 * `kinds` are keys of ACCESS; one it doesn't know is skipped. `prefix`
 * goes before the first item's words ("Not built yet.").
 */
export function AccessLine({ kinds, className = '', prefix = null }) {
  const shown = (kinds || []).filter((kind) => ACCESS[kind]);
  if (!shown.length) return null;
  return (
    <span className={className || undefined}>
      {shown.map((kind, index) => {
        const { label, icon: Icon } = ACCESS[kind];
        return (
          <span key={kind} className="access-item" data-access={kind}>
            <Icon size={13} aria-hidden="true" />
            {index === 0 && prefix ? `${prefix} ${label}` : label}
          </span>
        );
      })}
    </span>
  );
}
