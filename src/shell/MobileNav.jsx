// On a phone: the mark (or the way back up), Search and the account across
// the top of the page, and the parts of Virga along the bottom edge where a
// thumb reaches them. The top row is part of the page and scrolls away with
// it; the bottom one stays. Search opens the command palette, which has no
// keyboard shortcut to be found by here. Sync now is in the account's menu.
//
// On a page inside a part (a report, a tool, a setting, a posting page) the
// mark gives way to a back link to the part's front page (routes.js
// parentOf), since the page header has no crumbs on a phone.
//
// The bottom bar is icons. The part you are in is the one that also says its
// name where there is room (a tinted disc on a narrower phone, shell.css),
// so the bar reads as "you are here" at a glance, and New post is the round
// button at its end. Settings is behind the account, in its menu.

import { BarChart3, ChevronLeft, LayoutDashboard, Search, Send, SquarePen, Wrench } from 'lucide-react';
import Button from '../components/Button.jsx';
import { Link } from '../lib/router.jsx';
import { DEFENSE_BASE, DEFENSE_ICON } from '../defense/routes.js';
import { DEFENSE_ENABLED } from '../config.js';
import { LogoMark, useSkyTaps } from './bits.jsx';
import { AccountMenu } from '../accounts/AccountMenu.jsx';

/** `back` is `{ label, to }` from parentOf, or null on a part's front page. */
export function AppBar({ archive, profile, did, back = null, onSignOut, onSearch }) {
  const tapLogo = useSkyTaps();
  return (
    <header className="appbar">
      {back ? (
        <Link to={back.to} className="appbar-back">
          <ChevronLeft size={18} aria-hidden="true" />
          <span className="appbar-back-label">{back.label}</span>
        </Link>
      ) : (
        <button type="button" className="brand" onClick={tapLogo} aria-label="Virga">
          <LogoMark />
          <span className="brand-name">Virga</span>
        </button>
      )}
      <div className="appbar-actions">
        <Button variant="ghost" icon aria-label="Search or jump to" title="Search or jump to" onClick={onSearch}>
          <Search size={20} aria-hidden="true" />
        </Button>
        <AccountMenu compact archive={archive} profile={profile} did={did} onSignOut={onSignOut} />
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
    ...(DEFENSE_ENABLED ? [{ key: 'defense', label: 'Defense', icon: DEFENSE_ICON, to: DEFENSE_BASE }] : []),
  ];
  return (
    <nav className="tabbar" aria-label="Main">
      <div className="tabbar-tabs">
        {tabs.map((t) => {
          const Icon = t.icon;
          const current = route.section === t.key;
          return (
            <Link key={t.key} to={t.to} className="tabbar-item" aria-current={current ? 'page' : undefined} aria-label={current ? undefined : t.label} title={current ? undefined : t.label}>
              <Icon size={20} aria-hidden="true" />
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
