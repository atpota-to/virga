// The signed-in app: sidebar (or, on a phone, an app bar and tabs), the page
// the address names, and the sync's state wherever there is room for it.
// The sky behind it is the page's own background (styles/base.css); the live
// one, only when it has been asked for, is drawn over the top of that.
// Toasts and the composer are mounted above it in App.jsx, so they outlive a
// switch of account, which remounts this.

import { useEffect, useRef, useState } from 'react';
import LiveSky from '../hillside/LiveSky.jsx';
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
import DefensePage from '../defense/DefensePage.jsx';
import { DEFENSE_PAGE_BY_KEY } from '../defense/routes.js';
import { DEFENSE_ENABLED } from '../config.js';
import { parseComposeIntent } from '../posting/lib/composeIntent.js';
import { takePendingCompose } from '../lib/pendingCompose.js';
import FirstRun from './FirstRun.jsx';
import Sidebar from './Sidebar.jsx';
import { AppBar, TabBar } from './MobileNav.jsx';
import { SyncBanner } from './SyncStatus.jsx';
import { PageHeader, useIsNarrow } from './bits.jsx';
import { needsArchive as routeNeedsArchive, opensBeforeArchive, parentOf, parseRoute, postingTitle, SECTION_TITLE } from './routes.js';
import { isNewPostShortcut, isPaletteShortcut } from './shortcuts.js';
import CommandPalette from './CommandPalette.jsx';
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
  const [searching, setSearching] = useState(false);
  // Counts the palette's "Customize this dashboard": the page reads ?edit=1
  // when it mounts, so the command sets the flag and mounts it again.
  const [customizing, setCustomizing] = useState(0);

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
  usePaletteShortcut(setSearching);

  const built = isBuilt(archive);
  const needsArchive = routeNeedsArchive(route);
  // The first build's own page shows every step of the sync, so the strip
  // and the sidebar's progress would only say it twice.
  const firstRun = archive.loaded && needsArchive && !built;

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
  else if (firstRun) page = <FirstRun archive={archive} />;
  else if (route.section === 'dashboard') page = dashboard ? <DashboardPage key={customizing} dashboard={dashboard} /> : null;
  else if (route.section === 'reports') page = route.page ? <ReportPage reportKey={route.page} /> : <ReportsIndex />;
  else if (route.section === 'tools') page = route.page ? <ToolPage toolKey={route.page} /> : <ToolsIndex />;
  else if (route.section === 'defense') page = DEFENSE_ENABLED ? <DefensePage pageKey={route.page || 'scan'} /> : <NotFound />;
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
            : route.section === 'defense' && route.page
              ? `${DEFENSE_PAGE_BY_KEY[route.page]?.title || 'Defense'} · Defense`
              : SECTION_TITLE[route.section];

  useEffect(() => {
    document.title = `${title} · Virga`;
  }, [title]);

  return (
    <div className="shell" data-sidebar={prefs.sidebar}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {prefs.liveSky && <LiveSky />}
      {!narrow && (
        <Sidebar
          archive={archive}
          route={{ ...route, dashboard: dashboard?.id || route.dashboard }}
          profile={profile}
          did={did}
          firstRun={firstRun}
          onSignOut={onSignOut}
          onNewDashboard={() => setCreating(true)}
          onNewPost={() => composer.open({})}
          onSearch={() => setSearching(true)}
        />
      )}
      <div className="shell-main">
        {narrow && <AppBar archive={archive} profile={profile} did={did} back={parentOf(route)} onSignOut={onSignOut} onSearch={() => setSearching(true)} />}
        {(narrow || prefs.sidebar === 'collapsed') && !firstRun && <SyncBanner archive={archive} />}
        <main id="main" className="shell-content" tabIndex={-1}>
          {page}
        </main>
      </div>
      {narrow && <TabBar route={route} dashboardId={dashboard?.id || lastDashboard || dashboards[0]?.id} onNewPost={() => composer.open({})} />}
      <NewDashboardDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreate={(name, template) => {
          const id = addDashboard({ name, template });
          setCreating(false);
          if (id) navigate(`/dashboard/${id}${template ? '' : '?edit=1'}`);
        }}
      />
      <CommandPalette
        open={searching}
        onClose={() => setSearching(false)}
        route={{ section: route.section, dashboard: dashboard?.id || null }}
        onNewDashboard={() => setCreating(true)}
        onCustomize={() => {
          const params = new URLSearchParams(window.location.search);
          params.set('edit', '1');
          window.history.replaceState(null, '', `${window.location.pathname}?${params}`);
          setCustomizing((n) => n + 1);
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
 * ⌘K, or Ctrl K off a Mac, opens the command palette and closes it again,
 * from anywhere, a text field included. It stays out of the way while any
 * other dialog is open (the composer is one).
 */
function usePaletteShortcut(setOpen) {
  useEffect(() => {
    const onKey = (event) => {
      const inDialog = Boolean(document.querySelector('dialog[open]:not(.palette-dialog)'));
      if (!isPaletteShortcut(event, { inDialog })) return;
      event.preventDefault();
      setOpen((open) => !open);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [setOpen]);
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

/** An address that names nothing: the usual header, and the one way on. */
function NotFound() {
  return (
    <>
      <PageHeader title="There’s nothing at this address" sub="It may have been a dashboard that was since deleted." />
      <div className="page-body">
        <div className="empty-block">
          <Button onClick={() => navigate('/')}>Go to your dashboard</Button>
        </div>
      </div>
    </>
  );
}
