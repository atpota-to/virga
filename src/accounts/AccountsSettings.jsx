// Settings › Account: every account signed in here, how each is signed in,
// and the ways to switch, lengthen, end or forget it.

import { useMemo, useState } from 'react';
import { ExternalLink, LogIn, LogOut, Timer, Trash2, UserPlus } from 'lucide-react';
import Avatar from '../components/Avatar.jsx';
import Button from '../components/Button.jsx';
import Dialog from '../components/Dialog.jsx';
import { COCOON_URL } from '../config.js';
import { Link } from '../lib/router.jsx';
import { useAtprotoSession } from '../session/useAtprotoSession.jsx';
import { modeLabel, offersLongerSession, requestReauth, statusLabel } from './accountCopy.js';
import { PendingWorkWarnings, SignOutAllDialog, accountName, useAccountActions, useSignOutGuard } from './AccountMenu.jsx';
import { usePendingWork } from './pendingWork.js';
import AddAccountDialog from './AddAccountDialog.jsx';
import './accounts.css';

const COCOON_HOST = (() => {
  try {
    return new URL(COCOON_URL).host;
  } catch {
    return COCOON_URL;
  }
})();

function rowName(account) {
  return accountName({ displayName: account.displayName, handle: account.handle }, account.did);
}

function RemoveAccountDialog({ account, onClose }) {
  const { removeAccount, backendFor } = useAtprotoSession();
  const [deleteData, setDeleteData] = useState(false);
  const [busy, setBusy] = useState(false);
  const name = account ? rowName(account) : '';
  const listed = useMemo(() => (account ? [account] : []), [account]);
  const work = usePendingWork(listed, backendFor, Boolean(account));
  async function confirm() {
    setBusy(true);
    try {
      await removeAccount(account.did, { deleteData });
    } finally {
      setBusy(false);
      setDeleteData(false);
      onClose();
    }
  }
  return (
    <Dialog
      open={Boolean(account)}
      onClose={onClose}
      title={`Remove ${name} from this browser`}
      tone="danger"
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={confirm} disabled={busy || work.checking}>
            {busy ? 'Removing…' : 'Remove'}
          </Button>
        </>
      }
    >
      <div className="dialog-form">
        <p>It signs out and stops being listed here. You can add it again any time by signing in.</p>
        <PendingWorkWarnings accounts={listed} work={work} />
        <label className="choice" data-on={deleteData || undefined}>
          <input type="checkbox" checked={deleteData} onChange={(e) => setDeleteData(e.target.checked)} />
          <span>
            <span className="choice-label">Also delete what it keeps in this browser</span>
            <span className="choice-desc">
              Its archive, dashboards, tool lists, posting settings and unsent drafts’ pictures. Nothing in the account itself is touched.
            </span>
          </span>
        </label>
      </div>
    </Dialog>
  );
}

function AccountRow({ account, active, onRemove, signOutGuard }) {
  const { switching, signOutAccount, authMode } = useAtprotoSession();
  const actions = useAccountActions();
  const [busy, setBusy] = useState(false);
  const checking = signOutGuard.checking === account.did;
  const name = rowName(account);
  const status = statusLabel(account.status, { active, switching: switching === account.did });
  const needsSignIn = account.status === 'needsSignIn';
  const tone = needsSignIn ? 'badge--warn' : active ? 'badge--accent' : 'badge--outline';

  return (
    <li className="accounts-row" aria-current={active ? 'true' : undefined}>
      <Avatar src={account.avatar} name={name} size="lg" />
      <div className="accounts-row-text">
        <span className="accounts-row-name">
          {name}
          {status && <span className={`badge ${tone}`}>{status}</span>}
        </span>
        {account.handle && <span className="muted">@{account.handle}</span>}
        <span className="accounts-row-meta">{modeLabel(account.mode)}</span>
      </div>
      <div className="accounts-row-actions">
        {needsSignIn ? (
          <Button variant="primary" size="sm" onClick={() => requestReauth(account.did, { immediate: true })}>
            <LogIn size={15} aria-hidden="true" />
            Sign back in
          </Button>
        ) : (
          !active && (
            <Button size="sm" disabled={Boolean(switching)} onClick={() => actions.open(account)} aria-label={`Switch to ${name}`}>
              Switch
            </Button>
          )
        )}
        {account.status === 'unknown' && (
          <Button size="sm" onClick={() => requestReauth(account.did, { immediate: true })} title="Virga couldn’t confirm this sign-in; signing in again settles it">
            <LogIn size={15} aria-hidden="true" />
            Sign in again
          </Button>
        )}
        {!needsSignIn && offersLongerSession(account, authMode) && (
          <Button size="sm" onClick={() => actions.lengthen(account)} title="Sign in again through Virga’s server">
            <Timer size={15} aria-hidden="true" />
            Reconnect for a longer session
          </Button>
        )}
        <Button as="a" size="sm" href={`https://bsky.app/profile/${encodeURIComponent(account.handle || account.did)}`} target="_blank" rel="noopener noreferrer" aria-label={`Open ${name} on Bluesky`}>
          <ExternalLink size={15} aria-hidden="true" />
          Bluesky
        </Button>
        {!needsSignIn && (
          <Button
            size="sm"
            disabled={busy || checking}
            aria-label={`Sign out of ${name}`}
            onClick={() =>
              signOutGuard.guard(account, async () => {
                setBusy(true);
                try {
                  await signOutAccount(account.did);
                } finally {
                  setBusy(false);
                }
              })
            }
          >
            <LogOut size={15} aria-hidden="true" />
            {busy ? 'Signing out…' : checking ? 'Checking…' : 'Sign out'}
          </Button>
        )}
        <Button size="sm" variant="ghost" icon aria-label={`Remove ${name} from this browser`} title="Remove from this browser" onClick={() => onRemove(account)}>
          <Trash2 size={15} aria-hidden="true" />
        </Button>
      </div>
    </li>
  );
}

/** The body of Settings › Account. */
export default function AccountsSettings() {
  const { accounts, did, authMode } = useAtprotoSession();
  const [adding, setAdding] = useState(false);
  const [signingOutAll, setSigningOutAll] = useState(false);
  const [removing, setRemoving] = useState(null);
  const signOutGuard = useSignOutGuard();
  const signedIn = accounts.filter((a) => a.status !== 'needsSignIn');
  const ordered = [...accounts].sort((a, b) => (a.did === did ? -1 : b.did === did ? 1 : 0));

  return (
    <>
      <section className="card settings-section">
        <div className="settings-section-head">
          <h2 className="card-title">Accounts</h2>
          <p className="card-sub">Each account keeps its own archive and its own dashboards in this browser. Switching doesn’t sign anyone out.</p>
        </div>
        <ul className="accounts-list">
          {ordered.map((a) => (
            <AccountRow key={a.did} account={a} active={a.did === did} onRemove={setRemoving} signOutGuard={signOutGuard} />
          ))}
        </ul>
        <div className="settings-actions">
          <Button onClick={() => setAdding(true)}>
            <UserPlus size={15} aria-hidden="true" />
            Add an account
          </Button>
          {signedIn.length > 1 && (
            <Button variant="danger" onClick={() => setSigningOutAll(true)}>
              Sign out of all {signedIn.length} accounts
            </Button>
          )}
        </div>
      </section>

      <section className="card settings-section">
        <div className="settings-section-head">
          <h2 className="card-title">How long a sign-in lasts</h2>
        </div>
        <ul className="perm-list">
          <li>
            <strong>Browser session.</strong> The sign-in is kept by this browser, which talks to your account’s server directly. It lasts as
            long as that server allows an app that runs only in a browser, which is usually up to two weeks.
          </li>
          <li>
            <strong>Long session through Virga’s server.</strong> The sign-in is held by Virga’s server ({COCOON_HOST}), which passes your
            requests on to your account and stays signed in for as long as you keep using it. Scheduled posts, post timers and the post
            adviser need one, because they run while this browser is closed.
          </li>
        </ul>
        <p className="settings-text">
          Signing out ends the session in this browser only: your other browsers and devices stay signed in. Scheduled posts and post
          timers keep running while any browser or device is signed in to Virga with a long session for the account; signing out of the
          last one stops them until you sign in that way again. Your archive is never sent to Virga’s server.
          {authMode !== 'backend' && ' This copy of Virga signs new accounts in through the browser.'}
        </p>
      </section>

      <section className="card settings-section">
        <div className="settings-section-head">
          <h2 className="card-title">Identity</h2>
        </div>
        <p className="settings-text">
          Your DID, your PDS and every handle you’ve had are in the <Link to="/tools/identity">Identity inspector</Link>.
        </p>
      </section>

      <AddAccountDialog open={adding} onClose={() => setAdding(false)} />
      <SignOutAllDialog open={signingOutAll} onClose={() => setSigningOutAll(false)} />
      <RemoveAccountDialog account={removing} onClose={() => setRemoving(null)} />
      {signOutGuard.dialog}
    </>
  );
}
