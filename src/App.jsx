// The whole app is one screen with four states: restoring a session, signed
// out (the front page), coming back from a sign-in, and signed in (the
// dashboard). Behind all of them is the same hillside. It sits at dawn until
// there is an archive to chart, and the sun comes up when there is.

import { useCallback, useEffect, useState } from 'react';
import Hillside from './hillside/Hillside.jsx';
import Dashboard from './dashboard/Dashboard.jsx';
import Landing from './pages/Landing.jsx';
import SignInReturn from './pages/SignInReturn.jsx';
import TopBar from './components/TopBar.jsx';
import { useAtprotoSession } from './session/useAtprotoSession.jsx';
import { getProfile } from './lib/atproto.js';
import { OAUTH_CALLBACK_PATH } from './config.js';

export default function App() {
  const { session, agent, did, loading, error, signOut } = useAtprotoSession();
  const [path, setPath] = useState(() => window.location.pathname);
  const [built, setBuilt] = useState(false);
  const profile = useProfile(did);

  const returning = path.startsWith(OAUTH_CALLBACK_PATH);

  // The sign-in comes back to its own address. Once it has been dealt with,
  // the address is the app's again, so a reload doesn't replay it. A failure
  // stays put, to say what happened; a visit with nothing to finish (a
  // reload, the address typed in) is simply sent on.
  useEffect(() => {
    if (!returning || loading) return;
    if (session || !error) {
      window.history.replaceState(null, '', '/');
      setPath('/');
    }
  }, [returning, loading, session, error]);

  const onBuilt = useCallback((value) => setBuilt(Boolean(value)), []);

  const view = loading
    ? 'loading'
    : session && agent
      ? 'dashboard'
      : returning && error
        ? 'returned'
        : 'landing';
  const day = view === 'dashboard' && built ? 1 : 0;

  return (
    <div className="app" data-view={view}>
      <div className="sky">
        <Hillside day={day} depth={0.8} />
      </div>

      {view === 'loading' && (
        <p className="app-status" role="status">
          {returning ? 'Signing you in…' : 'Opening Virga…'}
        </p>
      )}

      {view === 'landing' && <Landing />}

      {view === 'returned' && <SignInReturn error={error} />}

      {view === 'dashboard' && (
        <>
          <TopBar did={did} profile={profile} onSignOut={signOut} />
          <main className="app-main">
            <Dashboard key={did} agent={agent} did={did} handle={profile?.handle || null} onBuilt={onBuilt} />
          </main>
        </>
      )}
    </div>
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
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [did]);
  return profile;
}
