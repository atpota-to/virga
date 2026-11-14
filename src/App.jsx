// Four states: restoring a session, signed out (the front page), coming back
// from a sign-in that failed, and signed in (the shell around the archive).
// Nothing moves behind any of it unless the live sky has been asked for.
//
// Two things stand in front of those. The Terms of Service and the Privacy
// Policy are pages of their own (/terms, /privacy), read the same whatever
// the session is doing. And a signed-in account that hasn't agreed to the
// current ones gets the agreement screen in the shell's place: nothing of
// the app is mounted, and nothing read for the account, until it agrees.
//
// Switching accounts happens in place: the shell stays up while the next
// account's agent is built, then everything below the per-account key
// remounts for it. Only the app's start shows the loading line. Toasts, the
// session notices and the composer sit above that key, so a toast, a notice
// or a half-written post outlives a switch.

import { useEffect, useState } from 'react';
import { ArchiveProvider } from './archive/ArchiveContext.jsx';
import { DashboardsProvider } from './dashboards/DashboardsContext.jsx';
import SessionNotices from './accounts/SessionNotices.jsx';
import { documentFor } from './legal/documents.js';
import LegalPage from './legal/LegalPage.jsx';
import TermsGate from './legal/TermsGate.jsx';
import { useTermsAcceptance } from './legal/useTermsAcceptance.js';
import Landing from './pages/Landing.jsx';
import SignInReturn from './pages/SignInReturn.jsx';
import Shell from './shell/Shell.jsx';
import { ToastProvider } from './shell/bits.jsx';
import { ComposerProvider } from './posting/composer/ComposerContext.jsx';
import { PreferencesProvider } from './lib/preferences.jsx';
import { navigate, usePath } from './lib/router.jsx';
import { useAtprotoSession } from './session/useAtprotoSession.jsx';
import { getProfile } from './lib/atproto.js';
import { OAUTH_CALLBACK_PATH, OAUTH_RETURN_PATH } from './config.js';
import { isComposePath, rememberPendingCompose, takePendingCompose } from './lib/pendingCompose.js';

export default function App() {
  return (
    <PreferencesProvider>
      <ToastProvider>
        <AppInner />
      </ToastProvider>
    </PreferencesProvider>
  );
}

function AppInner() {
  const { session, agent, did, mode, loading, error, signOut, accounts, backendFor } = useAtprotoSession();
  const path = usePath();
  const remembered = accounts.find((a) => a.did === did) || null;
  const profile = useProfile(did, remembered);
  const legalDocument = documentFor(path);
  const terms = useTermsAcceptance({ did: session && agent ? did : null, mode, backendFor });

  const returning = path.startsWith(OAUTH_CALLBACK_PATH) || path.startsWith(OAUTH_RETURN_PATH);

  // The sign-in comes back to its own address. Once it has been dealt with,
  // the address is the app's again, so a reload doesn't replay it. A failure
  // stays put, to say what happened; a visit with nothing to finish (a
  // reload, the address typed in) is simply sent on, to a compose link kept
  // from before the sign-in if there is one.
  useEffect(() => {
    if (!returning || loading) return;
    if (session || !error) {
      const pending = session ? takePendingCompose() : null;
      if (pending) navigate(pending, { replace: true, keepQuery: false });
      else navigate('/', { replace: true });
    }
  }, [returning, loading, session, error]);

  // A sign-in that came back without a session says so, even with another
  // account already open behind it.
  const view = loading ? 'loading' : returning && error ? 'returned' : session && agent ? 'app' : 'landing';

  // A compose link opened while signed out: the sign-in redirect leaves the
  // page, so the link is kept to reopen once it comes back.
  const composeLink = view === 'landing' && isComposePath(path);
  useEffect(() => {
    if (composeLink) rememberPendingCompose(window.location.pathname, window.location.search);
  }, [composeLink]);

  if (legalDocument) return <LegalPage docKey={legalDocument} />;
  if (view === 'loading') {
    return (
      <p className="app-status" role="status">
        {returning ? 'Signing you in…' : 'Opening Virga…'}
      </p>
    );
  }
  if (view === 'landing') return <Landing composing={composeLink} />;
  if (view === 'returned') return <SignInReturn error={error} />;
  // Asking the server whether this account agreed somewhere else: the same
  // line as the app starting, so nothing flashes before the answer.
  if (terms.status === 'checking') {
    return (
      <p className="app-status" role="status">
        Opening Virga…
      </p>
    );
  }
  if (terms.status === 'needs') return <TermsGate did={did} profile={profile} mode={mode} onAccept={terms.accept} onSignOut={signOut} />;
  return (
    <ComposerProvider>
      <SessionNotices />
      <ArchiveProvider key={did} agent={agent} did={did} profile={profile}>
        <DashboardsProvider key={did} did={did}>
          <Shell profile={profile} did={did} onSignOut={signOut} />
        </DashboardsProvider>
      </ArchiveProvider>
    </ComposerProvider>
  );
}

/**
 * The signed-in account's public profile: its name, handle and avatar. What
 * the account list remembers stands in until the fresh read arrives, so a
 * switch doesn't flash a bare DID.
 */
function useProfile(did, remembered) {
  const [profile, setProfile] = useState(null);
  useEffect(() => {
    setProfile(
      remembered
        ? { handle: remembered.handle, displayName: remembered.displayName, avatar: remembered.avatar, followersCount: null, followsCount: null, postsCount: null, createdAt: null }
        : null,
    );
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
    // Only a change of account starts a fresh read; `remembered` is the
    // stand-in at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [did]);
  return profile;
}
