import { LogOut } from 'lucide-react';
import Menu from './Menu.jsx';
import { APP_NAME } from '../config.js';

/**
 * The bar across the top of the dashboard: the app's name, and whose numbers
 * these are. The account is a menu, because the one thing to do with it is
 * sign out.
 */
export default function TopBar({ did, profile, onSignOut }) {
  const handle = profile?.handle || null;
  const name = profile?.displayName || (handle ? `@${handle}` : shortDid(did));
  return (
    <header className="topbar">
      <div className="topbar-in">
        <span className="topbar-name">{APP_NAME}</span>
        <Menu
          className="topbar-account"
          label={`Account: ${handle ? `@${handle}` : did}`}
          variant="text"
          items={[
            {
              icon: LogOut,
              label: 'Sign out',
              hint: 'Your archive stays in this browser for next time.',
              onSelect: onSignOut,
            },
          ]}
        >
          {profile?.avatar ? (
            <img className="topbar-avatar" src={profile.avatar} alt="" />
          ) : (
            <span className="topbar-avatar topbar-avatar--empty" aria-hidden="true" />
          )}
          <span className="topbar-who">
            <span className="topbar-who-name">{name}</span>
            {handle && profile?.displayName && <span className="topbar-who-handle">@{handle}</span>}
          </span>
        </Menu>
      </div>
    </header>
  );
}

function shortDid(did) {
  if (!did) return '';
  return did.length <= 24 ? did : `${did.slice(0, 12)}…${did.slice(-6)}`;
}
