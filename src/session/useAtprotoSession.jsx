import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { getOauthClient, getOauthEvents } from '../lib/oauthClient.js';
import {
  clearSessionHint as clearStoredHint,
  readSessionHint,
  restoresAtStartup,
  writeSessionHint,
} from '../lib/sessionHint.js';
import { OAUTH_CALLBACK_PATH, OAUTH_SCOPE } from '../config.js';

const Ctx = createContext(null);

// The session hint (src/lib/sessionHint.js) is what keeps the OAuth stack out
// of a signed-out visit: it is set the moment a sign-in is started (before the
// redirect), confirmed once `init()` returns a real session, and cleared
// whenever the session is deleted or `init()` finds none.

function storage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function setSessionHint() {
  writeSessionHint(storage());
}

function clearSessionHint() {
  clearStoredHint(storage());
}

function onCallbackPath() {
  return (
    typeof window !== 'undefined' &&
    window.location.pathname.startsWith(OAUTH_CALLBACK_PATH)
  );
}

/**
 * Provides atproto OAuth session state.
 *
 *   const { session, agent, did, signIn, signOut, loading, error } =
 *     useAtprotoSession();
 *
 * `session` is an `OAuthSession` (or `null`). `agent` is an `@atproto/api`
 * Agent bound to that session, ready to use against the account's PDS.
 */
export function AtprotoSessionProvider({ children }) {
  const [session, setSession] = useState(null);
  const [error, setError] = useState(null);
  // Whether there is anything to restore. Decided once, as the app starts.
  const [restoreWanted] = useState(() =>
    restoresAtStartup({
      hint: readSessionHint(storage()),
      onCallback: onCallbackPath(),
    }),
  );
  const [loading, setLoading] = useState(restoreWanted);

  useEffect(() => {
    // A visitor who has not signed in never loads the OAuth stack.
    if (!restoreWanted) {
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    let detachEvents = null;
    setLoading(true);

    (async () => {
      let client;
      try {
        client = await getOauthClient();
      } catch (err) {
        if (!cancelled) {
          setError(err);
          setLoading(false);
        }
        return;
      }
      if (cancelled) return;

      const events = getOauthEvents();
      const onDeleted = (event) => {
        const sub = event?.detail?.sub;
        clearSessionHint();
        setSession((current) => (current && current.sub === sub ? null : current));
      };
      events.addEventListener('deleted', onDeleted);
      detachEvents = () => events.removeEventListener('deleted', onDeleted);

      try {
        const result = await client.init();
        if (cancelled) return;
        if (result?.session) {
          setSessionHint();
          setSession(result.session);
        } else {
          // No live session (never signed in, or it was revoked or expired):
          // drop the hint so the next visit skips the OAuth load entirely.
          clearSessionHint();
        }
      } catch (err) {
        // The hint is left alone: a restore that failed for want of a network
        // should be tried again next time, and a sign-in that was declined
        // clears it on the next load, when init() finds no session.
        if (!cancelled) setError(err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (detachEvents) detachEvents();
    };
  }, [restoreWanted]);

  const [agent, setAgent] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!session) {
      setAgent(null);
      return undefined;
    }
    import('@atproto/api').then(({ Agent }) => {
      if (cancelled) return;
      setAgent(new Agent(session));
    });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const signIn = useCallback(async (input) => {
    const client = await getOauthClient();
    // Optimistically mark that a session may exist, so the load after the
    // redirect runs the OAuth stack. init() clears this again if the flow
    // doesn't yield a session.
    setSessionHint();
    // Resolves to a redirect: the promise typically never resolves.
    await client.signIn(input, { scope: OAUTH_SCOPE });
  }, []);

  const signOut = useCallback(async () => {
    if (!session) return;
    try {
      await session.signOut();
    } catch {
      // ignore network errors on revoke; we still drop local state
    }
    clearSessionHint();
    setSession(null);
  }, [session]);

  const value = useMemo(
    () => ({
      session,
      agent,
      did: session?.sub || null,
      // True until init() resolves and (if signed in) the Agent module has loaded.
      loading: loading || Boolean(session && !agent),
      error,
      signIn,
      signOut,
    }),
    [session, agent, loading, error, signIn, signOut],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAtprotoSession() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAtprotoSession must be used inside <AtprotoSessionProvider>');
  return v;
}
