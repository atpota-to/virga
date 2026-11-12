// The account button at the top of the sidebar (and in the phone's app bar):
// every account signed in here, to switch between in place, and the ways to
// add, lengthen, end or recover a sign-in.

import { useMemo, useState } from 'react';
import { ExternalLink, LogIn, LogOut, Settings, Timer, UserPlus, Users } from 'lucide-react';
import Avatar from '../components/Avatar.jsx';
import Button from '../components/Button.jsx';
import Dialog from '../components/Dialog.jsx';
import Menu from '../components/Menu.jsx';
import { signInErrorMessage } from '../lib/oauthClient.js';
import { navigate } from '../lib/router.jsx';
import { accountSignInId, isReauthRequiredError, shortDid as shortAccountDid } from '../session/accounts.js';
import { useAtprotoSession } from '../session/useAtprotoSession.jsx';
import { offersLongerSession, requestReauth, showSessionNotice, statusLabel } from './accountCopy.js';
import AddAccountDialog from './AddAccountDialog.jsx';
import './accounts.css';

/** The name for the open account's profile: display name, else @handle, else a short DID. */
export function accountName(profile, did) {
  const handle = profile?.handle || null;
  return profile?.displayName || (handle ? `@${handle}` : shortDid(did));
}

export function shortDid(did) {
  return shortAccountDid(did);
}

/** A row's name, from the remembered account. */
function rowName(account) {
  return accountName({ displayName: account.displayName, handle: account.handle }, account.did);
}

/** The menu draws an item's icon as a component; this one is the account's picture. */
function avatarIcon(account) {
  const name = rowName(account);
  return function AccountAvatar() {
    return (
      <span className="menu-item-icon account-row-avatar" aria-hidden="true">
        <Avatar src={account.avatar} name={name} size="sm" />
      </span>
    );
  };
}

/**
 * Switch in place; an account whose sign-in has ended goes to the hand-off
 * that signs it in again (SessionNotices).
 */
export function useAccountActions() {
  const session = useAtprotoSession();
  const { switchAccount } = session;
  return {
    async open(account) {
      if (account.status === 'needsSignIn') {
        requestReauth(account.did, { immediate: true });
        return;
      }
      try {
        await switchAccount(account.did);
      } catch (err) {
        if (isReauthRequiredError(err)) requestReauth(account.did);
        else showSessionNotice(`Couldn’t open ${rowName(account)}. Check your connection and try again.`);
      }
    },
    async lengthen(account) {
      try {
        await session.signIn(accountSignInId(account), { mode: 'backend', intent: 'reauth' });
      } catch (err) {
        showSessionNotice(signInErrorMessage(err));
      }
    },
  };
}

/** Confirm, then sign every account here out, the open one last. */
export function SignOutAllDialog({ open, onClose }) {
  const { accounts, did, signOutAccount } = useAtprotoSession();
  const [busy, setBusy] = useState(false);
  const signedIn = accounts.filter((a) => a.status !== 'needsSignIn');
  async function confirm() {
    setBusy(true);
    const order = [...signedIn.filter((a) => a.did !== did), ...signedIn.filter((a) => a.did === did)];
    for (const account of order) {
      await signOutAccount(account.did).catch(() => {});
    }
    setBusy(false);
    onClose();
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Sign out of all ${signedIn.length} accounts`}
      tone="danger"
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={confirm} disabled={busy}>
            {busy ? 'Signing out…' : 'Sign out of all'}
          </Button>
        </>
      }
    >
      <p>
        Each account’s session in this browser ends. Their archives and dashboards stay here, and each can sign back in from the front page.
      </p>
    </Dialog>
  );
}

export function AccountMenu({ profile, did, onSignOut, compact = false, placement = 'down' }) {
  const { accounts, switching, mode, authMode } = useAtprotoSession();
  const actions = useAccountActions();
  const [adding, setAdding] = useState(false);
  const [signingOutAll, setSigningOutAll] = useState(false);
  const handle = profile?.handle || null;
  const name = accountName(profile, did);
  const activeRow = accounts.find((a) => a.did === did) || null;
  const signedIn = accounts.filter((a) => a.status !== 'needsSignIn');

  // The open account first, then the rest by when they were last used.
  const ordered = useMemo(() => [...accounts].sort((a, b) => (a.did === did ? -1 : b.did === did ? 1 : 0)), [accounts, did]);
  const icons = useMemo(() => new Map(accounts.map((a) => [a.did, avatarIcon(a)])), [accounts]);

  const accountItems =
    ordered.length > 1 || activeRow?.status === 'needsSignIn'
      ? ordered.map((a) => {
          const isActive = a.did === did;
          const words = [a.handle ? `@${a.handle}` : null, statusLabel(a.status, { active: isActive, switching: switching === a.did })];
          if (a.status === 'needsSignIn') words.push('Sign back in');
          return {
            key: `account:${a.did}`,
            icon: icons.get(a.did),
            label: rowName(a),
            hint: words.filter(Boolean).join(' · '),
            className: isActive ? 'account-row is-active' : 'account-row',
            onSelect: isActive && a.status !== 'needsSignIn' ? undefined : () => actions.open(a),
          };
        })
      : [];

  const items = [
    ...accountItems,
    accountItems.length > 0 && { separator: true },
    { key: 'add', icon: UserPlus, label: 'Add an account', onSelect: () => setAdding(true) },
    activeRow &&
      offersLongerSession(activeRow, authMode) && {
        key: 'lengthen',
        icon: Timer,
        label: 'Reconnect for a longer session',
        hint: 'Sign in again through Virga’s server, so you stay signed in and can schedule posts.',
        onSelect: () => actions.lengthen(activeRow),
      },
    activeRow?.status === 'needsSignIn' && {
      key: 'sign-back-in',
      icon: LogIn,
      label: `Sign back in as ${name}`,
      onSelect: () => requestReauth(did, { immediate: true }),
    },
    { separator: true },
    {
      key: 'profile',
      icon: ExternalLink,
      label: 'Open your profile on Bluesky',
      onSelect: () => window.open(`https://bsky.app/profile/${encodeURIComponent(handle || did)}`, '_blank', 'noopener'),
    },
    { key: 'settings', icon: Settings, label: 'Accounts and settings', onSelect: () => navigate('/settings/account') },
    { separator: true },
    {
      key: 'sign-out',
      icon: LogOut,
      label: signedIn.length > 1 ? `Sign out of ${name}` : 'Sign out',
      hint:
        mode === 'backend'
          ? 'Ends the long session in this browser. Your archive stays here for next time.'
          : 'Your archive stays in this browser for next time.',
      onSelect: onSignOut,
    },
    signedIn.length > 1 && {
      key: 'sign-out-all',
      icon: Users,
      label: `Sign out of all ${signedIn.length} accounts`,
      tone: 'danger',
      onSelect: () => setSigningOutAll(true),
    },
  ];

  return (
    <>
      <Menu
        className={`account-menu${compact ? ' account-menu--compact' : ''}`}
        label={`Account: ${handle ? `@${handle}` : did}${switching ? '. Switching accounts…' : ''}`}
        variant="ghost"
        placement={placement}
        // In the phone's app bar the button sits at the right edge, so the
        // list hangs leftward from it; in the sidebar and its rail, rightward.
        align={compact && placement === 'down' ? 'end' : 'start'}
        items={items}
      >
        <Avatar src={profile?.avatar} name={name} size={compact ? 'sm' : 'md'} />
        {!compact && (
          <span className="account-who">
            <span className="account-name">{name}</span>
            {switching ? <span className="account-handle">Switching…</span> : handle && <span className="account-handle">@{handle}</span>}
          </span>
        )}
      </Menu>
      <AddAccountDialog open={adding} onClose={() => setAdding(false)} />
      <SignOutAllDialog open={signingOutAll} onClose={() => setSigningOutAll(false)} />
    </>
  );
}

export default AccountMenu;
