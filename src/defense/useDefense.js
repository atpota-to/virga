// What every Defense page needs about the open account: its session, what its
// grant lets Defense do, the sign-in that asks for more (or less), and its
// lists, kept fresh while something is being written to them.

import { useCallback, useEffect, useRef, useState } from 'react';
import { reauthModeFor } from '../accounts/accountCopy.js';
import { signInErrorMessage } from '../lib/oauthClient.js';
import { accountSignInId } from '../session/accounts.js';
import { useAtprotoSession } from '../session/useAtprotoSession.jsx';
import { defenseErrorMessage, fetchLists } from './defenseService.js';

/** How often the lists are read again while something waits to be written. */
const POLL_MS = 15_000;

/**
 * The open account and its Defense permissions: `{ session, did, account,
 * caps, asking, askFor }`. `askFor(level)` signs in again with that much of
 * Defense: 'scan', 'lists' or false.
 */
export function useDefenseAccount() {
  const session = useAtprotoSession();
  const { did } = session;
  const account = session.accounts.find((a) => a.did === did) || null;
  const caps = session.capabilitiesFor(did);
  const [asking, setAsking] = useState(null); // { busy } | { error }

  const askFor = useCallback(
    async (level) => {
      if (!account) return;
      setAsking({ busy: true });
      try {
        await session.signIn(accountSignInId(account), {
          mode: account.mode || reauthModeFor(account, session.authMode),
          intent: 'reauth',
          defense: level,
          did: account.did,
        });
        setAsking(null);
      } catch (error) {
        console.warn('[defense] the sign-in didn’t start:', error);
        setAsking({ error: signInErrorMessage(error) });
      }
    },
    [account, session],
  );

  return { session, did, account, caps, asking, askFor };
}

/**
 * The account's lists, the people it keeps by hand and whether the server
 * writes lists: `{ data, error, loading, refresh }`. Read again every few
 * seconds while anything waits, so a page shows the writing as it goes.
 * `data` is null for an account without a long session.
 */
export function useDefenseLists(did) {
  const { backendFor } = useAtprotoSession();
  const req = did ? backendFor(did) : null;
  const [state, setState] = useState({ data: null, error: null, loading: Boolean(req) });
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    if (!req) {
      setState({ data: null, error: null, loading: false });
      return null;
    }
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await fetchLists(req);
      if (mine === seq.current) setState({ data, error: null, loading: false });
      return data;
    } catch (err) {
      if (mine === seq.current) setState((s) => ({ ...s, error: defenseErrorMessage(err), loading: false }));
      return null;
    }
  }, [req]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const waiting = (state.data?.lists || []).some((l) => l.waiting > 0);
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, refresh]);

  return { ...state, refresh, req };
}
