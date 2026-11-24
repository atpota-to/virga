// Settings › Account: every account signed in here, how each is signed in,
// and the ways to switch, lengthen, end or forget it.

import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, LogOut, Timer, Trash2, UserPlus } from 'lucide-react';
import Avatar from '../components/Avatar.jsx';
import Button from '../components/Button.jsx';
import Dialog from '../components/Dialog.jsx';
import { MoreMenu } from '../components/Menu.jsx';
import { backendHost } from '../config.js';
import { Link } from '../lib/router.jsx';
import { useAtprotoSession } from '../session/useAtprotoSession.jsx';
import { modeLabel, offersLongerSession, requestReauth, statusLabel } from './accountCopy.js';
import { PendingWorkWarnings, SignOutAllDialog, accountName, useAccountActions, useSignOutGuard } from './AccountMenu.jsx';
import { usePendingWork } from './pendingWork.js';
import AddAccountDialog from './AddAccountDialog.jsx';
import './accounts.css';

function rowName(account) {
  return accountName({ displayName: account.displayName, handle: account.handle }, account.did);
}

function profileUrl(account) {
  return `https://bsky.app/profile/${encodeURIComponent(account.handle || account.did)}`;
}

function RemoveAccountDialog({ account, onClose, onRemoved }) {
  const { removeAccount, backendFor } = useAtprotoSession();
  const [deleteData, setDeleteData] = useState(false);
  const [busy, setBusy] = useState(false);
  const name = account ? rowName(account) : '';
  const listed = useMemo(() => (account ? [account] : []), [account]);
  const work = usePendingWork(listed, backendFor, Boolean(account));
  async function confirm() {
    setBusy(true);
    let removed = false;
    try {
      await removeAccount(account.did, { deleteData });
      removed = true;
    } finally {
      setBusy(false);
      setDeleteData(false);
      if (removed) onRemoved?.(account);
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
        <p>It signs out and leaves this list. Sign in to add it back.</p>
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

/**
 * One account: who it is, how it's signed in, then at most one thing to do
 * in words (sign back in, sign in again, or switch to it) and a ⋯ for the
 * rest, with removing it from this browser last.
 */
function AccountRow({ account, active, onRemove, signOutGuard }) {
  const { switching, signOutAccount, authMode } = useAtprotoSession();
  const actions = useAccountActions();
  const [busy, setBusy] = useState(false);
  const checking = signOutGuard.checking === account.did;
  const name = rowName(account);
  const needsSignIn = account.status === 'needsSignIn';
  const label = statusLabel(account.status, { active, switching: switching === account.did });
  // The open account is marked after its name, as in the account menu: the
  // accent's dot and quiet words.
  const current = active && !needsSignIn && account.status !== 'unknown' && switching !== account.did;
  // Any other state is the first fact about the sign-in, on the line under
  // the name, as the account menu has it: signed out is a problem to find,
  // so a badge; the rest are quiet words. A menu item can't show that it's
  // working, so a sign-out under way says so there too.
  const working = busy ? 'Signing out…' : checking ? 'Checking…' : null;
  const state = working || (current ? null : label);
  // The name is the handle when there's no display name; it isn't said twice.
  const handle = account.displayName && account.handle ? account.handle : null;

  function signOut() {
    if (busy || checking) return;
    signOutGuard.guard(account, async () => {
      setBusy(true);
      try {
        await signOutAccount(account.did);
      } finally {
        setBusy(false);
      }
    });
  }

  let action = null;
  if (needsSignIn) {
    action = (
      <Button size="sm" onClick={() => requestReauth(account.did, { immediate: true })} aria-label={`Sign back in as ${name}`}>
        Sign back in
      </Button>
    );
  } else if (account.status === 'unknown') {
    action = (
      <Button
        size="sm"
        onClick={() => requestReauth(account.did, { immediate: true })}
        aria-label={`Sign in again as ${name}`}
        title="Virga couldn’t confirm this sign-in; signing in again settles it"
      >
        Sign in again
      </Button>
    );
  } else if (!active) {
    action = (
      <Button size="sm" disabled={Boolean(switching)} onClick={() => actions.open(account)} aria-label={`Switch to ${name}`}>
        Switch
      </Button>
    );
  }

  const items = [
    !needsSignIn &&
      offersLongerSession(account, authMode) && {
        key: 'lengthen',
        icon: Timer,
        label: 'Reconnect for a longer session',
        hint: 'Sign in again through Virga’s server',
        onSelect: () => actions.lengthen(account),
      },
    { key: 'bluesky', icon: ExternalLink, label: 'Open on Bluesky', onSelect: () => window.open(profileUrl(account), '_blank', 'noopener') },
    !needsSignIn && { key: 'sign-out', icon: LogOut, label: 'Sign out', onSelect: signOut },
    { separator: true },
    { key: 'remove', icon: Trash2, label: 'Remove from this browser', tone: 'danger', onSelect: () => onRemove(account) },
  ];

  return (
    <li className="accounts-row" data-did={account.did} aria-current={active ? 'true' : undefined}>
      <Avatar src={account.avatar} name={name} size="lg" />
      <div className="accounts-row-text">
        <span className="accounts-row-name">
          <span className="accounts-row-who">{name}</span>
          {current && label && (
            <span className="accounts-row-current">
              <span className="dot dot--current" aria-hidden="true" />
              {label}
            </span>
          )}
        </span>
        <span className="meta accounts-row-meta">
          {state && <span>{needsSignIn && !working ? <span className="badge badge--warn">{state}</span> : state}</span>}
          {handle && (
            <span>
              <a className="accounts-row-handle" href={profileUrl(account)} target="_blank" rel="noopener noreferrer" title="Open on Bluesky">
                @{handle}
                <ExternalLink size={12} aria-hidden="true" />
              </a>
            </span>
          )}
          <span>{modeLabel(account.mode)}</span>
        </span>
      </div>
      <div className="row-actions">
        {action}
        <MoreMenu className="row-menu" label={`More for ${name}`} items={items} />
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

  // A removed account's ⋯ had the focus, and goes with its row: the focus
  // moves to the ⋯ of the row that takes its place, or of the new last row.
  const listRef = useRef(null);
  const [refocus, setRefocus] = useState(null);
  useEffect(() => {
    if (refocus == null) return;
    const rows = [...(listRef.current?.children || [])];
    rows[Math.min(refocus, rows.length - 1)]?.querySelector('.row-menu .menu-button')?.focus();
    setRefocus(null);
  }, [accounts, refocus]);

  // The sections are Settings' own (src/settings/settings.css): a heading,
  // a rule in ink, then rows between hairlines.
  return (
    <>
      <section className="settings-section">
        <div className="settings-section-head card-head accounts-head">
          <div>
            <h2 className="card-title">Accounts</h2>
            <p className="card-sub">
              Each account has its own archive and dashboards. Switching doesn’t sign anyone out. Your DID, PDS and past handles are in the <Link to="/tools/identity">Identity inspector</Link>.
            </p>
          </div>
          <button type="button" className="link-action" onClick={() => setAdding(true)}>
            <UserPlus size={14} aria-hidden="true" />
            Add an account
          </button>
        </div>
        <div className="settings-section-body">
          <ul className="accounts-list" ref={listRef}>
            {ordered.map((a) => (
              <AccountRow key={a.did} account={a} active={a.did === did} onRemove={setRemoving} signOutGuard={signOutGuard} />
            ))}
          </ul>
          {signedIn.length > 1 && (
            <div className="card-foot">
              <button type="button" className="link-action" onClick={() => setSigningOutAll(true)}>
                <LogOut size={14} aria-hidden="true" />
                Sign out of all {signedIn.length} accounts
              </button>
            </div>
          )}
        </div>
      </section>

      {/* What the two kinds of sign-in mean, for whoever wants to know:
          closed until it's opened, so the page is the accounts first. */}
      <section className="settings-section">
        <details className="disclosure accounts-how">
          <summary>How long a sign-in lasts</summary>
          <p className="accounts-how-intro">There are two kinds. Each account above says which it has.</p>
          <div className="settings-section-body">
            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-row-label">Browser session</div>
              </div>
              <div className="settings-row-control">
                <p className="accounts-note">
                  The sign-in is kept by the browser, which talks to your account’s server directly. It usually lasts up to two weeks.
                </p>
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-row-label">Long session through Virga’s server</div>
              </div>
              <div className="settings-row-control">
                <p className="accounts-note">
                  The sign-in is held by Virga’s server ({backendHost()}), which passes your requests on and stays signed in while you keep using it. Scheduled posts, timers and the post adviser need one.
                </p>
              </div>
            </div>
            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-row-label">Signing out</div>
              </div>
              <div className="settings-row-control">
                <p className="accounts-note">
                  Signing out ends the session here only: your other browsers and devices stay signed in. Scheduled posts and timers keep running while any browser or device is signed in with a long session; signing out of the last one stops them.
                  {authMode !== 'backend' && ' This copy of Virga signs new accounts in through the browser.'}
                </p>
              </div>
            </div>
          </div>
        </details>
      </section>

      <AddAccountDialog open={adding} onClose={() => setAdding(false)} />
      <SignOutAllDialog open={signingOutAll} onClose={() => setSigningOutAll(false)} />
      <RemoveAccountDialog
        account={removing}
        onClose={() => setRemoving(null)}
        onRemoved={(gone) => setRefocus(Math.max(0, ordered.findIndex((a) => a.did === gone.did)))}
      />
      {signOutGuard.dialog}
    </>
  );
}
