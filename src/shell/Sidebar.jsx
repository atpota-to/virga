// The sidebar: the account, New post, search, and the five parts of Virga as
// words down the side. Only the part you are in is opened out into its
// pages, so the list stays short; the rest are one word each. Under them,
// the archive's state. Folds to a rail of icons; on a phone it is replaced
// by the app bar and the tab bar (MobileNav.jsx).
//
// It has no ground and no edge of its own: it sits on the sky, and on the
// page once the sky has scrolled away. Only the middle part scrolls, so a
// menu hanging from the account button (at the top, or at the foot of the
// rail) is never clipped by the scroll.

import { BarChart3, LayoutDashboard, PanelLeftClose, PanelLeftOpen, Plus, Search, Send, Settings, SquarePen, Wrench } from 'lucide-react';
import { AccountMenu } from '../accounts/AccountMenu.jsx';
import Button from '../components/Button.jsx';
import { useDashboards } from '../dashboards/DashboardsContext.jsx';
import { usePreferences } from '../lib/preferences.jsx';
import { Link } from '../lib/router.jsx';
import { REPORTS } from '../reports/registry.js';
import { POSTING_PAGES } from '../posting/routes.js';
import { SECTIONS as SETTINGS_SECTIONS } from '../settings/sections.js';
import { TOOLS } from '../tools/registry.js';
import { LogoMark, useSkyTaps } from './bits.jsx';
import { SyncCard } from './SyncStatus.jsx';
import { paletteShortcutAria, paletteShortcutLabel } from './shortcuts.js';

/** The posting pages the sidebar lists: the overview, then the pinned ones. */
const POSTING_LINKS = POSTING_PAGES.filter((p) => p.key === 'hub' || p.pinned);
const TOOL_LINKS = TOOLS.filter((t) => !t.planned);

/**
 * One of the five parts: its word, and, while it is the part you are in,
 * its pages under it. `current` marks the word itself as the page (the
 * part's own front page); `open` is being anywhere inside it.
 */
function NavSection({ to, icon: Icon, label, open, current = false, collapsed = false, children = null }) {
  return (
    <li className="nav-section" data-open={open || undefined}>
      <Link
        to={to}
        className="nav-link"
        data-active={open || undefined}
        aria-current={current ? 'page' : undefined}
        title={collapsed ? label : undefined}
        aria-label={collapsed ? label : undefined}
      >
        <Icon className="nav-icon" size={collapsed ? 18 : 16} aria-hidden="true" />
        {!collapsed && <span className="nav-label">{label}</span>}
      </Link>
      {open && !collapsed && children && <ul className="nav-sub">{children}</ul>}
    </li>
  );
}

function NavSubLink({ to, label, current }) {
  return (
    <li>
      <Link to={to} className="nav-sub-link" aria-current={current ? 'page' : undefined}>
        <span className="nav-label">{label}</span>
      </Link>
    </li>
  );
}

export default function Sidebar({ archive, route, profile, did, onSignOut, onNewDashboard, onNewPost, onSearch }) {
  const { dashboards } = useDashboards();
  const { sidebar, setPref } = usePreferences();
  const tapLogo = useSkyTaps();
  const collapsed = sidebar === 'collapsed';
  const firstDashboard = dashboards[0]?.id;
  const { section, page } = route;

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
          aria-label={collapsed ? 'Open the sidebar' : 'Fold the sidebar'}
          title={collapsed ? 'Open the sidebar' : 'Fold the sidebar'}
          onClick={() => setPref('sidebar', collapsed ? 'expanded' : 'collapsed')}
        >
          {collapsed ? <PanelLeftOpen size={16} aria-hidden="true" /> : <PanelLeftClose size={16} aria-hidden="true" />}
        </Button>
      </div>

      {!collapsed && <AccountMenu profile={profile} did={did} onSignOut={onSignOut} />}

      <div className="sidebar-do">
        <Button
          variant="primary"
          icon={collapsed}
          className="sidebar-new-post"
          aria-label={collapsed ? 'New post' : undefined}
          title={collapsed ? 'New post (n)' : 'Shortcut: n'}
          aria-keyshortcuts="n"
          onClick={onNewPost}
        >
          <SquarePen size={collapsed ? 17 : 15} aria-hidden="true" />
          {!collapsed && 'New post'}
        </Button>

        {/* The command palette, and where its shortcut is written down. */}
        {collapsed ? (
          <Button
            variant="ghost"
            icon
            className="sidebar-search-icon"
            aria-label="Search or jump to"
            title={`Search or jump to (${paletteShortcutLabel()})`}
            aria-keyshortcuts={paletteShortcutAria()}
            onClick={onSearch}
          >
            <Search size={18} aria-hidden="true" />
          </Button>
        ) : (
          <button type="button" className="sidebar-search" aria-keyshortcuts={paletteShortcutAria()} onClick={onSearch}>
            <Search size={15} aria-hidden="true" />
            <span className="sidebar-search-label">Search or jump to…</span>
            <kbd className="kbd">{paletteShortcutLabel()}</kbd>
          </button>
        )}
      </div>

      <div className="sidebar-scroll">
        <ul className="nav">
          <NavSection
            collapsed={collapsed}
            to={`/dashboard/${route.dashboard || firstDashboard}`}
            icon={LayoutDashboard}
            label="Dashboards"
            open={section === 'dashboard'}
          >
            {dashboards.map((d) => (
              <NavSubLink key={d.id} to={`/dashboard/${d.id}`} label={d.name} current={route.dashboard === d.id} />
            ))}
            <li>
              <button type="button" className="nav-sub-link nav-sub-action" onClick={onNewDashboard}>
                <Plus size={14} aria-hidden="true" />
                <span className="nav-label">New dashboard</span>
              </button>
            </li>
          </NavSection>

          <NavSection collapsed={collapsed} to="/reports" icon={BarChart3} label="Reports" open={section === 'reports'} current={section === 'reports' && !page}>
            {REPORTS.map((r) => (
              <NavSubLink key={r.key} to={`/reports/${r.key}`} label={r.label} current={page === r.key} />
            ))}
          </NavSection>

          <NavSection collapsed={collapsed} to="/posting" icon={Send} label="Posting" open={section === 'posting'}>
            {POSTING_LINKS.map((p) => (
              <NavSubLink key={p.key} to={p.path} label={p.label} current={page === p.key} />
            ))}
          </NavSection>

          <NavSection collapsed={collapsed} to="/tools" icon={Wrench} label="Tools" open={section === 'tools'} current={section === 'tools' && !page}>
            {TOOL_LINKS.map((t) => (
              <NavSubLink key={t.key} to={`/tools/${t.key}`} label={t.name} current={page === t.key} />
            ))}
          </NavSection>

          <NavSection collapsed={collapsed} to="/settings" icon={Settings} label="Settings" open={section === 'settings'}>
            {SETTINGS_SECTIONS.map((s) => (
              <NavSubLink key={s.key} to={`/settings/${s.key}`} label={s.label} current={(page || 'account') === s.key} />
            ))}
          </NavSection>
        </ul>

        <div className="sidebar-spacer" />

        {!collapsed && <SyncCard archive={archive} />}
      </div>
      {collapsed && <AccountMenu compact profile={profile} did={did} onSignOut={onSignOut} placement="up" />}
    </nav>
  );
}
