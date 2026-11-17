// The sidebar: the account, New post, search, and the six parts of Virga as
// words down the side. Only the part you are in is opened out into its
// pages, so the list stays short; the rest are one word each. At its foot,
// the archive's state. On a screen too short for the whole list, the list
// scrolls and fades at the edge that has more behind it. Folds to a rail of icons, with the button that opens
// it again at the foot over the account; on a phone it is replaced by the
// app bar and the tab bar (MobileNav.jsx).
//
// It has no ground and no edge of its own: it sits on the sky, and on the
// page once the sky has scrolled away. Only the middle part scrolls, so a
// menu hanging from the account button (at the top, or at the foot of the
// rail) is never clipped by the scroll, and the archive's lines stay put.

import { useRef } from 'react';
import { BarChart3, LayoutDashboard, PanelLeftClose, PanelLeftOpen, Search, Send, Settings, SquarePen, Wrench } from 'lucide-react';
import { AccountMenu } from '../accounts/AccountMenu.jsx';
import Button from '../components/Button.jsx';
import { useOverflowEdge } from '../components/Segmented.jsx';
import { useDashboards } from '../dashboards/DashboardsContext.jsx';
import { usePreferences } from '../lib/preferences.jsx';
import { Link } from '../lib/router.jsx';
import { REPORTS } from '../reports/registry.js';
import { POSTING_PAGES } from '../posting/routes.js';
import { DEFENSE_BASE, DEFENSE_ICON } from '../defense/routes.js';
import { SECTIONS as SETTINGS_SECTIONS } from '../settings/sections.js';
import { TOOLS } from '../tools/registry.js';
import { LogoMark, useSkyTaps } from './bits.jsx';
import { SyncCard } from './SyncStatus.jsx';
import { paletteShortcutAria, paletteShortcutLabel } from './shortcuts.js';

/** The posting pages the sidebar lists: the overview, then the pinned ones. */
const POSTING_LINKS = POSTING_PAGES.filter((p) => p.key === 'hub' || p.pinned);
const TOOL_LINKS = TOOLS.filter((t) => !t.planned);

/**
 * One of the six parts: its word, and, while it is the part you are in,
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

/**
 * `firstRun` is true while the page is the first build's (FirstRun.jsx),
 * which shows the sync's every step itself: the archive's lines at the foot
 * are then only their first.
 */
export default function Sidebar({ archive, route, profile, did, firstRun = false, onSignOut, onNewDashboard, onNewPost, onSearch }) {
  const { dashboards } = useDashboards();
  const { sidebar, setPref } = usePreferences();
  const tapLogo = useSkyTaps();
  const scrollRef = useRef(null);
  useOverflowEdge(scrollRef, 'y');
  const collapsed = sidebar === 'collapsed';
  const firstDashboard = dashboards[0]?.id;
  const { section, page } = route;
  const fold = (
    <Button
      variant="ghost"
      size={collapsed ? 'md' : 'sm'}
      icon
      className="sidebar-fold"
      aria-label={collapsed ? 'Open the sidebar' : 'Fold the sidebar'}
      title={collapsed ? 'Open the sidebar' : 'Fold the sidebar'}
      onClick={() => setPref('sidebar', collapsed ? 'expanded' : 'collapsed')}
    >
      {collapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={16} aria-hidden="true" />}
    </Button>
  );

  return (
    <nav className="sidebar" aria-label="Main" data-collapsed={collapsed || undefined}>
      <div className="sidebar-top">
        <button type="button" className="brand" onClick={tapLogo} aria-label="Virga">
          <LogoMark />
          {!collapsed && <span className="brand-name">Virga</span>}
        </button>
        {!collapsed && fold}
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

      <div ref={scrollRef} className="sidebar-scroll">
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

          {/* One page so far, so the word is the page, with nothing under it. */}
          <NavSection collapsed={collapsed} to={DEFENSE_BASE} icon={DEFENSE_ICON} label="Defense" open={section === 'defense'} current={section === 'defense'} />

          <NavSection collapsed={collapsed} to="/settings" icon={Settings} label="Settings" open={section === 'settings'}>
            {SETTINGS_SECTIONS.map((s) => (
              <NavSubLink key={s.key} to={`/settings/${s.key}`} label={s.label} current={(page || 'account') === s.key} />
            ))}
          </NavSection>
        </ul>
      </div>

      {collapsed ? (
        <div className="sidebar-foot">
          {fold}
          <AccountMenu compact archive={archive} profile={profile} did={did} onSignOut={onSignOut} placement="up" />
        </div>
      ) : (
        <SyncCard archive={archive} brief={firstRun} />
      )}
    </nav>
  );
}
