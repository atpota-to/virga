import { useCallback, useEffect, useRef, useState } from 'react';

// How long the "signing you in again" notice is up before the redirect, so
// it can be read (and cancelled) first. A redirect nobody announced reads as
// the app falling over.
export const REAUTH_REDIRECT_DELAY_MS = 2500;

/**
 * The hand-off for an account whose sign-in has ended: a short notice
 * ("Signing you in again as @x…", with Cancel), then the sign-in. Cancelling,
 * or the host unmounting, stops the redirect.
 *
 * @param {(account) => Promise<void>} onRelogin starts the sign-in (navigates away)
 * @param {(error: Error) => void} [onError] the sign-in couldn't start
 */
export function usePendingReauth(onRelogin, onError) {
  const [pendingReauthAccount, setPendingReauthAccount] = useState(null);
  const timerRef = useRef(null);
  // The latest callbacks, so a timer set before a re-render calls these.
  const handlers = useRef({ onRelogin, onError });
  handlers.current = { onRelogin, onError };

  const cancelPendingReauth = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setPendingReauthAccount(null);
  }, []);

  const beginPendingReauth = useCallback((account) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setPendingReauthAccount(account);
    timerRef.current = setTimeout(async () => {
      timerRef.current = null;
      try {
        await handlers.current.onRelogin(account);
        // The sign-in navigates away; nothing more to do here.
      } catch (error) {
        setPendingReauthAccount(null);
        handlers.current.onError?.(error);
      }
    }, REAUTH_REDIRECT_DELAY_MS);
  }, []);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return { pendingReauthAccount, beginPendingReauth, cancelPendingReauth };
}
