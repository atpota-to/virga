// The notices that sit over the app about the sign-in itself: an account
// that has to sign in again (with the short hand-off before the redirect),
// another tab that switched accounts, and a sign-in that couldn't start.
// Mounted once, above the per-account part of the app, so a switch doesn't
// take it away.

import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';
import Button from '../components/Button.jsx';
import { signInErrorMessage } from '../lib/oauthClient.js';
import { ACTIVE_KEY, SESSION_EXPIRED_EVENT, accountSignInId, reauthNoticeLabel } from '../session/accounts.js';
import { reauthLooping, recordReauthAttempt } from '../session/sessionHealth.js';
import { useAtprotoSession } from '../session/useAtprotoSession.jsx';
import { REAUTH_REQUEST_EVENT, SESSION_NOTICE_EVENT, reauthModeFor } from './accountCopy.js';
import { usePendingReauth } from './usePendingReauth.js';
import './accounts.css';

function perTab() {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

function labelOf(accounts, did) {
  return reauthNoticeLabel(accounts.find((a) => a.did === did) || { did });
}

export default function SessionNotices() {
  const { did, accounts, signIn, switchAccount, authMode } = useAtprotoSession();
  const [notice, setNotice] = useState(null); // { text, tone }
  const [stuck, setStuck] = useState(null); // an account to sign in again by hand, once the automatic redirects have run too often
  const [otherTab, setOtherTab] = useState(null); // the DID another tab opened

  const reauth = useCallback(
    async (account) => {
      const row = accounts.find((a) => a.did === account.did) || account;
      await signIn(accountSignInId(row), { mode: reauthModeFor(row, authMode), intent: 'reauth' });
    },
    [accounts, signIn, authMode],
  );
  const { pendingReauthAccount, beginPendingReauth, cancelPendingReauth } = usePendingReauth(reauth, (err) =>
    setNotice({ text: signInErrorMessage(err), tone: 'danger' }),
  );

  // Asked for by the account menu or Settings.
  useEffect(() => {
    const onRequest = (event) => {
      const target = accounts.find((a) => a.did === event.detail?.did);
      if (!target) return;
      setStuck(null);
      if (event.detail.immediate) {
        reauth(target).catch((err) => setNotice({ text: signInErrorMessage(err), tone: 'danger' }));
      } else beginPendingReauth(target);
    };
    window.addEventListener(REAUTH_REQUEST_EVENT, onRequest);
    return () => window.removeEventListener(REAUTH_REQUEST_EVENT, onRequest);
  }, [accounts, reauth, beginPendingReauth]);

  // The open account's sign-in turned out to have ended. Off it goes to sign
  // in again, unless that has happened too often lately, when a button is
  // the better offer.
  useEffect(() => {
    const onExpired = (event) => {
      const expired = event.detail?.did;
      if (!expired || expired !== did) return;
      const target = accounts.find((a) => a.did === expired) || { did: expired };
      if (reauthLooping(perTab())) {
        setStuck(target);
        return;
      }
      recordReauthAttempt(perTab());
      beginPendingReauth(target);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, [did, accounts, beginPendingReauth]);

  useEffect(() => {
    const onNotice = (event) => {
      if (event.detail?.text) setNotice({ text: event.detail.text, tone: event.detail.tone || 'danger' });
    };
    window.addEventListener(SESSION_NOTICE_EVENT, onNotice);
    return () => window.removeEventListener(SESSION_NOTICE_EVENT, onNotice);
  }, []);

  // Another tab opened a different account. This tab stays as it is (two
  // identities never mix in one tab) and says so.
  useEffect(() => {
    const onStorage = (event) => {
      if (event.key !== ACTIVE_KEY) return;
      setOtherTab(event.newValue && event.newValue !== did ? event.newValue : null);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [did]);

  useEffect(() => {
    if (otherTab && otherTab === did) setOtherTab(null);
  }, [otherTab, did]);

  if (!pendingReauthAccount && !stuck && !otherTab && !notice) return null;
  const otherKnown = otherTab && accounts.some((a) => a.did === otherTab && a.status !== 'needsSignIn');

  return (
    <div className="session-notices">
      {pendingReauthAccount && (
        <div className="session-notice" role="status">
          <span>Signing you in again as {reauthNoticeLabel(pendingReauthAccount)}…</span>
          <Button size="sm" onClick={cancelPendingReauth}>
            Cancel
          </Button>
        </div>
      )}
      {stuck && !pendingReauthAccount && (
        <div className="session-notice" role="status">
          <span>{reauthNoticeLabel(stuck)} needs to sign in again.</span>
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              setStuck(null);
              reauth(stuck).catch((err) => setNotice({ text: signInErrorMessage(err), tone: 'danger' }));
            }}
          >
            Sign in
          </Button>
          <Dismiss onClick={() => setStuck(null)} />
        </div>
      )}
      {otherTab && (
        <div className="session-notice" role="status">
          <span>
            This tab is still signed in as {labelOf(accounts, did)}. Another tab switched to {labelOf(accounts, otherTab)}.
          </span>
          {otherKnown && (
            <Button
              size="sm"
              onClick={() => {
                setOtherTab(null);
                switchAccount(otherTab).catch(() => setNotice({ text: 'Couldn’t switch accounts. Try again from the account menu.', tone: 'danger' }));
              }}
            >
              Switch
            </Button>
          )}
          <Dismiss onClick={() => setOtherTab(null)} />
        </div>
      )}
      {notice && (
        <div className="session-notice" data-tone={notice.tone} role="alert">
          <span>{notice.text}</span>
          <Dismiss onClick={() => setNotice(null)} />
        </div>
      )}
    </div>
  );
}

function Dismiss({ onClick }) {
  return (
    <Button size="sm" variant="ghost" icon aria-label="Dismiss" title="Dismiss" onClick={onClick}>
      <X size={14} aria-hidden="true" />
    </Button>
  );
}
