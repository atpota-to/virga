// Four states: restoring a session, signed out (the front page), coming back
// from a sign-in that failed, and signed in (the shell around the archive).
// Nothing moves behind any of it unless the live sky has been asked for.

import { useEffect, useState } from 'react';
import { ArchiveProvider } from './archive/ArchiveContext.jsx';
import { DashboardsProvider } from './dashboards/DashboardsContext.jsx';
import Landing from './pages/Landing.jsx';
import SignInReturn from './pages/SignInReturn.jsx';
import Shell from './shell/Shell.jsx';
import { PreferencesProvider } from './lib/preferences.jsx';
import { navigate, usePath } from './lib/router.jsx';
import { useAtprotoSession } from './session/useAtprotoSession.jsx';
import { getProfile } from './lib/atproto.js';
import { OAUTH_CALLBACK_PATH } from './config.js';

export default function App() {
  return (
    <PreferencesProvider>
      <AppInner />
    </PreferencesProvider>
  );
}

function AppInner() {
  const { session, agent, did, loading, error, signOut } = useAtprotoSession();
  const path = usePath();
  const profile = useProfile(did);

  const returning = path.startsWith(OAUTH_CALLBACK_PATH);

  // The sign-in comes back to its own address. Once it has been dealt with,
  // the address is the app's again, so a reload doesn't replay it. A failure
  // stays put, to say what happened; a visit with nothing to finish (a
  // reload, the address typed in) is simply sent on.
  useEffect(() => {
    if (!returning || loading) return;
    if (session || !error) navigate('/', { replace: true });
  }, [returning, loading, session, error]);

  const view = loading ? 'loading' : session && agent ? 'app' : returning && error ? 'returned' : 'landing';

  if (view === 'loading') {
    return (
      <p className="app-status" role="status">
        {returning ? 'Signing you in…' : 'Opening Virga…'}
      </p>
    );
  }
  if (view === 'landing') return <Landing />;
  if (view === 'returned') return <SignInReturn error={error} />;
  return (
    <ArchiveProvider key={did} agent={agent} did={did} profile={profile}>
      <DashboardsProvider key={did} did={did}>
        <Shell profile={profile} did={did} onSignOut={signOut} />
      </DashboardsProvider>
    </ArchiveProvider>
  );
}

/** The signed-in account's public profile: its name, handle and avatar. */
function useProfile(did) {
  const [profile, setProfile] = useState(null);
  useEffect(() => {
    setProfile(null);
    if (!did) return undefined;
    let cancelled = false;
    getProfile(did)
      .then((p) => {
        if (cancelled || !p) return;
        setProfile({
          // An account whose handle no longer points at it reads as
          // "handle.invalid", which is not something to print as a name.
          handle: p.handle && p.handle !== 'handle.invalid' ? p.handle : null,
          displayName: p.displayName?.trim() || null,
          avatar: p.avatar || null,
          followersCount: p.followersCount ?? null,
          followsCount: p.followsCount ?? null,
          postsCount: p.postsCount ?? null,
          createdAt: p.createdAt || null,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [did]);
  return profile;
}
