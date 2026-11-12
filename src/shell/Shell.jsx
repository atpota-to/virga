// The signed-in app: sidebar (or, on a phone, an app bar and tabs), the page
// the address names, and the sync's state wherever there is room for it.
// Behind it all, only when it has been asked for, the live sky. Toasts and
// the composer are mounted above it in App.jsx, so they outlive a switch of
// account, which remounts this.

import { useEffect, useRef, useState } from 'react';
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
import { navigate, usePath } from '../lib/router.jsx';
import { useComposer } from '../posting/composer/ComposerContext.jsx';
import PostingPage from '../posting/PostingPage.jsx';
import { parseComposeIntent } from '../posting/lib/composeIntent.js';
import { takePendingCompose } from '../lib/pendingCompose.js';
import FirstRun from './FirstRun.jsx';
import Sidebar from './Sidebar.jsx';
import { AppBar, TabBar } from './MobileNav.jsx';
import { SyncBanner } from './SyncStatus.jsx';
import { useIsNarrow } from './bits.jsx';
import { needsArchive as routeNeedsArchive, opensBeforeArchive, parseRoute, postingTitle, SECTION_TITLE } from './routes.js';
import { isNewPostShortcut } from './shortcuts.js';
import './shell.css';

export { parseRoute };

export default function Shell({ profile, did, onSignOut }) {
  const archive = useArchive();
  const composer = useComposer();
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

  useNewPostShortcut(composer);

  const built = isBuilt(archive);
  const needsArchive = routeNeedsArchive(route);
  const dayFor = { archive: built ? 1 : 0, day: 1, dawn: 0 };
  const skyHere = prefs.sky && (prefs.skyScope === 'everywhere' || route.section === 'dashboard');

  let page;
  if (opensBeforeArchive(route)) {
    page =
      route.section === 'intent' ? (
        <OpenComposer key="intent" fromLink />
      ) : route.page === 'compose' ? (
        <OpenComposer key="compose" />
      ) : (
        <PostingPage pageKey={route.page} id={route.id} did={did} />
      );
  } else if (!archive.loaded) page = <p className="page-loading">Opening your archive…</p>;
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
          : route.section === 'posting'
            ? postingTitle(route)
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
          onNewPost={() => composer.open({})}
        />
      )}
      <div className="shell-main">
        {narrow && (
          <AppBar
            archive={archive}
            title={route.section === 'posting' ? postingTitle(route) : SECTION_TITLE[route.section]}
            profile={profile}
            did={did}
            onSignOut={onSignOut}
            onNewPost={() => composer.open({})}
          />
        )}
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

/**
 * "n" opens the composer, unless focus is in a field or a dialog is open
 * (the composer is one).
 */
function useNewPostShortcut(composer) {
  const ref = useRef(composer);
  ref.current = composer;
  useEffect(() => {
    const onKey = (event) => {
      const inDialog = Boolean(document.querySelector('dialog[open]')) || Boolean(event.target?.closest?.('dialog'));
      if (ref.current.isOpen || !isNewPostShortcut(event, { inDialog })) return;
      event.preventDefault();
      ref.current.open({});
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}

/**
 * /posting/compose and /intent/compose: open the composer with what the
 * address carries (text, a link, tags), then move to the posting overview
 * and drop the query, so the words don't follow the reader around and a
 * reload doesn't open the composer again.
 */
function OpenComposer({ fromLink = false }) {
  const composer = useComposer();
  const opened = useRef(false);
  useEffect(() => {
    // StrictMode runs this twice on mount; the ref keeps it to one open.
    if (opened.current) return;
    opened.current = true;
    // Opened here, so a link kept from the front page is spent: it mustn't
    // reopen on some later sign-in in this tab.
    takePendingCompose();
    const intent = parseComposeIntent(window.location.search);
    composer.open(
      intent.hasIntent
        ? { text: intent.text, ...(intent.tags.length ? { tags: intent.tags } : null), ...(fromLink ? { fromLink: true, url: intent.url || undefined } : null) }
        : {},
    );
    navigate('/posting', { replace: true, keepQuery: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <p className="page-loading">Opening the composer…</p>;
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
