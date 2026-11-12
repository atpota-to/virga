// The signed-in app: sidebar (or, on a phone, an app bar and tabs), the page
// the address names, and the sync's state wherever there is room for it.
// Behind it all, only when it has been asked for, the live sky.

import { useEffect, useState } from 'react';
import Hillside from '../hillside/Hillside.jsx';
import Button from '../components/Button.jsx';
import { isBuilt, useArchive } from '../archive/ArchiveContext.jsx';
import { useDashboards } from '../dashboards/DashboardsContext.jsx';
import DashboardPage from '../dashboards/DashboardPage.jsx';
import NewDashboardDialog from '../dashboards/NewDashboardDialog.jsx';
import ReportPage, { ReportsIndex } from '../reports/ReportPage.jsx';
import { REPORT_BY_KEY } from '../reports/registry.js';
import ToolPage, { ToolsIndex } from '../tools/ToolPage.jsx';
import { TOOL_BY_KEY } from '../tools/registry.js';
import SettingsPage from '../settings/SettingsPage.jsx';
import { usePreferences } from '../lib/preferences.jsx';
import { navigate, pathParts, usePath } from '../lib/router.jsx';
import FirstRun from './FirstRun.jsx';
import Sidebar from './Sidebar.jsx';
import { AppBar, TabBar } from './MobileNav.jsx';
import { SyncBanner } from './SyncStatus.jsx';
import { ToastProvider, useIsNarrow } from './bits.jsx';
import './shell.css';

export function parseRoute(path) {
  const [section, page] = pathParts(path);
  if (!section) return { section: 'dashboard', dashboard: null };
  if (section === 'dashboard') return { section, dashboard: page || null };
  if (section === 'reports' || section === 'tools') return { section, page: page || null };
  if (section === 'settings') return { section, page: page || null };
  return { section: 'missing' };
}

const SECTION_TITLE = { dashboard: 'Dashboards', reports: 'Reports', tools: 'Tools', settings: 'Settings', missing: 'Not found' };

export default function Shell(props) {
  return (
    <ToastProvider>
      <ShellInner {...props} />
    </ToastProvider>
  );
}

function ShellInner({ profile, did, onSignOut }) {
  const archive = useArchive();
  const { dashboards, addDashboard } = useDashboards();
  const prefs = usePreferences();
  const path = usePath();
  const route = parseRoute(path);
  const narrow = useIsNarrow();
  const [creating, setCreating] = useState(false);

  // A dashboard address that names nothing (deleted, or never there) goes to
  // the first one, without leaving the dead address in history.
  const dashboard = route.section === 'dashboard' ? dashboards.find((d) => d.id === route.dashboard) || null : null;
  const lastDashboard = useLastDashboard(route, dashboards);
  useEffect(() => {
    if (route.section === 'dashboard' && !dashboard && dashboards[0]) {
      navigate(`/dashboard/${lastDashboard || dashboards[0].id}`, { replace: true });
    }
  }, [route.section, dashboard, dashboards, lastDashboard]);

  const built = isBuilt(archive);
  const needsArchive = route.section === 'dashboard' || route.section === 'reports' || (route.section === 'tools' && route.page);
  const dayFor = { archive: built ? 1 : 0, day: 1, dawn: 0 };
  const skyHere = prefs.sky && (prefs.skyScope === 'everywhere' || route.section === 'dashboard');

  let page;
  if (!archive.loaded) page = <p className="page-loading">Opening your archive…</p>;
  else if (needsArchive && !built) page = <FirstRun archive={archive} />;
  else if (route.section === 'dashboard') page = dashboard ? <DashboardPage dashboard={dashboard} /> : null;
  else if (route.section === 'reports') page = route.page ? <ReportPage reportKey={route.page} /> : <ReportsIndex />;
  else if (route.section === 'tools') page = route.page ? <ToolPage toolKey={route.page} /> : <ToolsIndex />;
  else if (route.section === 'settings') page = <SettingsPage section={route.page} profile={profile} onSignOut={onSignOut} />;
  else page = <NotFound />;

  const title =
    route.section === 'dashboard'
      ? dashboard?.name || 'Dashboard'
      : route.section === 'reports' && route.page
        ? REPORT_BY_KEY[route.page]?.label || 'Reports'
        : route.section === 'tools' && route.page
          ? TOOL_BY_KEY[route.page]?.name || 'Tools'
          : SECTION_TITLE[route.section];

  useEffect(() => {
    document.title = `${title} · Virga`;
  }, [title]);

  return (
    <div className="shell" data-sidebar={prefs.sidebar} data-sky={skyHere || undefined}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {skyHere && (
        <div className="shell-sky" aria-hidden="true">
          <Hillside day={dayFor[prefs.skyTime] ?? 1} depth={0.8} />
        </div>
      )}
      {!narrow && (
        <Sidebar
          archive={archive}
          route={{ ...route, dashboard: dashboard?.id || route.dashboard }}
          profile={profile}
          did={did}
          onSignOut={onSignOut}
          onNewDashboard={() => setCreating(true)}
        />
      )}
      <div className="shell-main">
        {narrow && <AppBar archive={archive} title={SECTION_TITLE[route.section]} profile={profile} did={did} onSignOut={onSignOut} />}
        {(narrow || prefs.sidebar === 'collapsed') && <SyncBanner archive={archive} />}
        <main id="main" className="shell-content" tabIndex={-1}>
          {page}
        </main>
      </div>
      {narrow && <TabBar route={route} dashboardId={dashboard?.id || lastDashboard || dashboards[0]?.id} />}
      <NewDashboardDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreate={(name, template) => {
          const id = addDashboard({ name, template });
          setCreating(false);
          if (id) navigate(`/dashboard/${id}${template ? '' : '?edit=1'}`);
        }}
      />
    </div>
  );
}

/** The dashboard last looked at, so the Dashboard tab goes back to it. */
function useLastDashboard(route, dashboards) {
  const [last, setLast] = useState(null);
  useEffect(() => {
    if (route.section === 'dashboard' && route.dashboard && dashboards.some((d) => d.id === route.dashboard)) {
      setLast(route.dashboard);
    }
  }, [route.section, route.dashboard, dashboards]);
  return last && dashboards.some((d) => d.id === last) ? last : null;
}

function NotFound() {
  return (
    <div className="page-body">
      <div className="card empty-page">
        <h1 className="card-title">There’s nothing at this address</h1>
        <p className="card-sub">It may have been a dashboard that was since deleted.</p>
        <div>
          <Button variant="primary" onClick={() => navigate('/')}>
            Go to your dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}
