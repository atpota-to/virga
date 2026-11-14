// On a phone: a bar across the top (the mark, the page you're on, Sync, New
// post, the account) and five tabs along the bottom edge where a thumb
// reaches them.

import { BarChart3, LayoutDashboard, RefreshCw, Settings, SquarePen, Wrench } from 'lucide-react';
import Button from '../components/Button.jsx';
import { Link } from '../lib/router.jsx';
import { LogoMark, useSkyTaps } from './bits.jsx';
import { AccountMenu } from '../accounts/AccountMenu.jsx';
import { syncWhen } from './SyncStatus.jsx';

export function AppBar({ archive, title, profile, did, onSignOut, onNewPost }) {
  const tapLogo = useSkyTaps();
  const pm = archive.meta.posts;
  const syncing = Boolean(archive.sync);
  return (
    <header className="appbar">
      <button type="button" className="brand" onClick={tapLogo} aria-label="Virga">
        <LogoMark size={26} />
      </button>
      <span className="appbar-title">{title}</span>
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
          <RefreshCw size={18} aria-hidden="true" />
        </Button>
      )}
      <Button variant="ghost" icon className="appbar-new-post" aria-label="New post" title="New post" onClick={onNewPost}>
        <SquarePen size={18} aria-hidden="true" />
      </Button>
      <AccountMenu compact profile={profile} did={did} onSignOut={onSignOut} />
    </header>
  );
}

export function TabBar({ route, dashboardId }) {
  const tabs = [
    { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, to: `/dashboard/${dashboardId}` },
    { key: 'reports', label: 'Reports', icon: BarChart3, to: '/reports' },
    { key: 'posting', label: 'Posting', icon: SquarePen, to: '/posting' },
    { key: 'tools', label: 'Tools', icon: Wrench, to: '/tools' },
    { key: 'settings', label: 'Settings', icon: Settings, to: '/settings' },
  ];
  return (
    <nav className="tabbar" aria-label="Main">
      {tabs.map((t) => {
        const Icon = t.icon;
        const current = route.section === t.key;
        return (
          <Link key={t.key} to={t.to} className="tabbar-item" aria-current={current ? 'page' : undefined}>
            <Icon size={21} aria-hidden="true" />
            <span>{t.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
