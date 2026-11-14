// The sidebar: the account, New post, the dashboards, the reports, posting,
// the tools, the archive's state, and Settings. Folds to a rail of icons; on
// a phone it is replaced by the app bar and the tab bar (MobileNav.jsx).
//
// Only the middle part scrolls, so a menu hanging from the account button
// (at the top, or at the foot of the rail) is never clipped by the scroll.

import { LayoutDashboard, PanelLeftClose, PanelLeftOpen, Plus, Settings, SquarePen, Wrench } from 'lucide-react';
import { AccountMenu } from '../accounts/AccountMenu.jsx';
import Button from '../components/Button.jsx';
import { useDashboards } from '../dashboards/DashboardsContext.jsx';
import { usePreferences } from '../lib/preferences.jsx';
import { Link } from '../lib/router.jsx';
import { REPORTS } from '../reports/registry.js';
import { POSTING_PAGES } from '../posting/routes.js';
import { TOOLS, TOOL_BY_KEY } from '../tools/registry.js';
import { LogoMark, useSkyTaps } from './bits.jsx';
import { SyncCard } from './SyncStatus.jsx';

const PINNED_TOOLS = ['follow-cleanup', 'unfollow-tracker', 'best-time'];

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

const PINNED_POSTING = POSTING_PAGES.filter((p) => p.pinned);

export default function Sidebar({ archive, route, profile, did, onSignOut, onNewDashboard, onNewPost }) {
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

      <Button
        variant="primary"
        icon={collapsed}
        className="sidebar-new-post"
        aria-label={collapsed ? 'New post' : undefined}
        title={collapsed ? 'New post (n)' : 'Shortcut: n'}
        aria-keyshortcuts="n"
        onClick={onNewPost}
      >
        <SquarePen size={16} aria-hidden="true" />
        {!collapsed && 'New post'}
      </Button>

      <div className="sidebar-scroll">
        {collapsed ? (
          <div className="nav-group">
            <NavItem collapsed to={`/dashboard/${route.dashboard || firstDashboard}`} icon={LayoutDashboard} label="Dashboards" current={route.section === 'dashboard'} />
            {REPORTS.map((r) => (
              <NavItem key={r.key} collapsed to={`/reports/${r.key}`} icon={r.icon} label={r.label} current={route.section === 'reports' && route.page === r.key} />
            ))}
            <NavItem collapsed to="/posting" icon={SquarePen} label="Posting" current={route.section === 'posting'} />
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
                <Link to="/posting" className="nav-group-link" aria-current={route.section === 'posting' && route.page === 'hub' ? 'page' : undefined}>
                  Posting
                </Link>
              </div>
              {PINNED_POSTING.map((p) => (
                <NavItem key={p.key} to={p.path} icon={p.icon} label={p.label} current={route.section === 'posting' && route.page === p.key} />
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
      </div>
      {collapsed && <AccountMenu compact profile={profile} did={did} onSignOut={onSignOut} placement="up" />}
    </nav>
  );
}
