// The sidebar: the account, the dashboards, the reports, the tools, the
// archive's state, and Settings. Folds to a rail of icons; on a phone it is
// replaced by the app bar and the tab bar (MobileNav.jsx).

import {
  ExternalLink,
  LayoutDashboard,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  Wrench,
} from 'lucide-react';
import Avatar from '../components/Avatar.jsx';
import Button from '../components/Button.jsx';
import Menu from '../components/Menu.jsx';
import { useDashboards } from '../dashboards/DashboardsContext.jsx';
import { usePreferences } from '../lib/preferences.jsx';
import { Link, navigate } from '../lib/router.jsx';
import { REPORTS } from '../reports/registry.js';
import { TOOLS, TOOL_BY_KEY } from '../tools/registry.js';
import { LogoMark, useSkyTaps } from './bits.jsx';
import { SyncCard } from './SyncStatus.jsx';

const PINNED_TOOLS = ['follow-cleanup', 'unfollow-tracker', 'best-time'];

export function accountName(profile, did) {
  const handle = profile?.handle || null;
  return profile?.displayName || (handle ? `@${handle}` : shortDid(did));
}

export function shortDid(did) {
  if (!did) return '';
  return did.length <= 24 ? did : `${did.slice(0, 12)}…${did.slice(-6)}`;
}

export function AccountMenu({ profile, did, onSignOut, compact = false, placement = 'down' }) {
  const handle = profile?.handle || null;
  const name = accountName(profile, did);
  return (
    <Menu
      className={`account-menu${compact ? ' account-menu--compact' : ''}`}
      label={`Account: ${handle ? `@${handle}` : did}`}
      variant="ghost"
      placement={placement}
      align="start"
      items={[
        {
          icon: ExternalLink,
          label: 'Open your profile on Bluesky',
          onSelect: () => window.open(`https://bsky.app/profile/${encodeURIComponent(handle || did)}`, '_blank', 'noopener'),
        },
        { icon: Settings, label: 'Settings', onSelect: () => navigate('/settings/account') },
        { separator: true },
        { icon: LogOut, label: 'Sign out', hint: 'Your archive stays in this browser for next time.', onSelect: onSignOut },
      ]}
    >
      <Avatar src={profile?.avatar} name={name} size={compact ? 'sm' : 'md'} />
      {!compact && (
        <span className="account-who">
          <span className="account-name">{name}</span>
          {handle && <span className="account-handle">@{handle}</span>}
        </span>
      )}
    </Menu>
  );
}

function NavItem({ to, icon: Icon, label, count = null, current = false, collapsed = false }) {
  return (
    <Link
      to={to}
      className="nav-item"
      aria-current={current ? 'page' : undefined}
      title={collapsed ? label : undefined}
      aria-label={collapsed ? label : undefined}
    >
      <Icon className="nav-icon" size={16} aria-hidden="true" />
      {!collapsed && <span className="nav-label">{label}</span>}
      {!collapsed && count != null && <span className="nav-count num">{count}</span>}
    </Link>
  );
}

export default function Sidebar({ archive, route, profile, did, onSignOut, onNewDashboard }) {
  const { dashboards } = useDashboards();
  const { sidebar, setPref } = usePreferences();
  const tapLogo = useSkyTaps();
  const collapsed = sidebar === 'collapsed';
  const toolCount = TOOLS.filter((t) => !t.planned).length;
  const firstDashboard = dashboards[0]?.id;

  return (
    <nav className="sidebar" aria-label="Main" data-collapsed={collapsed || undefined}>
      <div className="sidebar-top">
        <button type="button" className="brand" onClick={tapLogo} aria-label="Virga">
          <LogoMark />
          {!collapsed && <span className="brand-name">Virga</span>}
        </button>
        <Button
          variant="ghost"
          size="sm"
          icon
          className="sidebar-fold"
          aria-label={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
          title={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
          onClick={() => setPref('sidebar', collapsed ? 'expanded' : 'collapsed')}
        >
          {collapsed ? <PanelLeftOpen size={16} aria-hidden="true" /> : <PanelLeftClose size={16} aria-hidden="true" />}
        </Button>
      </div>

      {!collapsed && <AccountMenu profile={profile} did={did} onSignOut={onSignOut} />}

      {collapsed ? (
        <div className="nav-group">
          <NavItem collapsed to={`/dashboard/${route.dashboard || firstDashboard}`} icon={LayoutDashboard} label="Dashboards" current={route.section === 'dashboard'} />
          {REPORTS.map((r) => (
            <NavItem key={r.key} collapsed to={`/reports/${r.key}`} icon={r.icon} label={r.label} current={route.section === 'reports' && route.page === r.key} />
          ))}
          <NavItem collapsed to="/tools" icon={Wrench} label="Tools" current={route.section === 'tools'} />
        </div>
      ) : (
        <>
          <div className="nav-group">
            <div className="nav-group-head">
              <span>Dashboards</span>
              <Button variant="ghost" size="sm" icon aria-label="New dashboard" title="New dashboard" onClick={onNewDashboard}>
                <Plus size={14} aria-hidden="true" />
              </Button>
            </div>
            {dashboards.map((d) => (
              <NavItem
                key={d.id}
                to={`/dashboard/${d.id}`}
                icon={LayoutDashboard}
                label={d.name}
                count={d.widgets.length}
                current={route.section === 'dashboard' && route.dashboard === d.id}
              />
            ))}
          </div>

          <div className="nav-group">
            <div className="nav-group-head">
              <Link to="/reports" className="nav-group-link">
                Reports
              </Link>
            </div>
            {REPORTS.map((r) => (
              <NavItem key={r.key} to={`/reports/${r.key}`} icon={r.icon} label={r.label} current={route.section === 'reports' && route.page === r.key} />
            ))}
          </div>

          <div className="nav-group">
            <div className="nav-group-head">
              <Link to="/tools" className="nav-group-link">
                Tools
              </Link>
            </div>
            {PINNED_TOOLS.map((key) => {
              const t = TOOL_BY_KEY[key];
              return <NavItem key={key} to={`/tools/${key}`} icon={t.icon} label={t.name} current={route.section === 'tools' && route.page === key} />;
            })}
            <NavItem to="/tools" icon={Wrench} label="All tools" count={toolCount} current={route.section === 'tools' && !route.page} />
          </div>
        </>
      )}

      <div className="sidebar-spacer" />

      {!collapsed && <SyncCard archive={archive} />}

      <div className="nav-group">
        <NavItem collapsed={collapsed} to="/settings" icon={Settings} label="Settings" current={route.section === 'settings'} />
      </div>
      {collapsed && <AccountMenu compact profile={profile} did={did} onSignOut={onSignOut} placement="up" />}
    </nav>
  );
}
