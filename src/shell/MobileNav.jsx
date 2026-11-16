// On a phone: the mark, Search, Sync and the account across the top of the
// page, and the parts of Virga along the bottom edge where a thumb reaches
// them. The top row is part of the page and scrolls away with it; the bottom
// one stays. Search opens the command palette, which has no keyboard
// shortcut to be found by here.
//
// The bottom bar is icons. The part you are in is the one that also says its
// name, so the bar reads as "you are here" at a glance, and New post is the
// round button at its end. Settings is behind the account, in its menu.

import { BarChart3, LayoutDashboard, RefreshCw, Search, Send, SquarePen, Wrench } from 'lucide-react';
import Button from '../components/Button.jsx';
import { Link } from '../lib/router.jsx';
import { LogoMark, useSkyTaps } from './bits.jsx';
import { AccountMenu } from '../accounts/AccountMenu.jsx';
import { syncWhen } from './SyncStatus.jsx';

export function AppBar({ archive, profile, did, onSignOut, onSearch }) {
  const tapLogo = useSkyTaps();
  const pm = archive.meta.posts;
  const syncing = Boolean(archive.sync);
  return (
    <header className="appbar">
      <button type="button" className="brand" onClick={tapLogo} aria-label="Virga">
        <LogoMark />
        <span className="brand-name">Virga</span>
      </button>
      <div className="appbar-actions">
        <Button variant="ghost" icon aria-label="Search or jump to" title="Search or jump to" onClick={onSearch}>
          <Search size={20} aria-hidden="true" />
        </Button>
        {pm && (
          <Button
            variant="ghost"
            icon
            className={syncing ? 'is-spinning' : ''}
            aria-label={syncing ? 'Syncing' : `Sync now. ${syncWhen(archive)}`}
            title={syncWhen(archive)}
            disabled={syncing}
            onClick={() => archive.runSync(pm.complete ? 'incremental' : 'resume')}
          >
            <RefreshCw size={19} aria-hidden="true" />
          </Button>
        )}
        <AccountMenu compact profile={profile} did={did} onSignOut={onSignOut} />
      </div>
    </header>
  );
}

export function TabBar({ route, dashboardId, onNewPost }) {
  const tabs = [
    { key: 'dashboard', label: 'Dashboards', icon: LayoutDashboard, to: `/dashboard/${dashboardId}` },
    { key: 'reports', label: 'Reports', icon: BarChart3, to: '/reports' },
    { key: 'posting', label: 'Posting', icon: Send, to: '/posting' },
    { key: 'tools', label: 'Tools', icon: Wrench, to: '/tools' },
  ];
  return (
    <nav className="tabbar" aria-label="Main">
      <div className="tabbar-tabs">
        {tabs.map((t) => {
          const Icon = t.icon;
          const current = route.section === t.key;
          return (
            <Link key={t.key} to={t.to} className="tabbar-item" aria-current={current ? 'page' : undefined} aria-label={current ? undefined : t.label} title={current ? undefined : t.label}>
              <Icon size={current ? 18 : 20} aria-hidden="true" />
              {current && <span className="tabbar-label">{t.label}</span>}
            </Link>
          );
        })}
      </div>
      <button type="button" className="tabbar-new-post" aria-label="New post" title="New post" onClick={onNewPost}>
        <SquarePen size={20} aria-hidden="true" />
      </button>
    </nav>
  );
}
