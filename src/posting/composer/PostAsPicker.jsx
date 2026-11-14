import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, LogIn } from 'lucide-react';
import Avatar from '../../components/Avatar.jsx';
import Button from '../../components/Button.jsx';
import { accountName } from '../../session/accounts.js';
import { requestReauth } from '../../accounts/accountCopy.js';

/**
 * "Posting as": which account the post goes out from, chosen from every
 * account in this browser without switching the app to it. A signed-out
 * account can't be picked; it offers Sign back in. When `locked` (a
 * scheduled post stays with the account that scheduled it) the line says so
 * and doesn't open.
 */
export default function PostAsPicker({ asDid, activeDid, accounts, onChange, checkAccount, locked = false, lockedReason = '', disabled = false }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState({});
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const current = accounts.find((a) => a.did === asDid) || null;
  const many = accounts.length > 1;

  // Opening checks the other accounts' sessions (cached for a minute), so a
  // dead one shows as signed out before anyone picks it.
  useEffect(() => {
    if (!open || !checkAccount) return;
    for (const a of accounts) {
      if (a.did === activeDid || a.status === 'needsSignIn') continue;
      Promise.resolve(checkAccount(a.did))
        .then((verdict) => setChecked((c) => ({ ...c, [a.did]: verdict })))
        .catch(() => {});
    }
  }, [open, accounts, activeDid, checkAccount]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      // Close the list, not the composer.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const name = current ? accountName(current) : asDid;
  const handle = current?.handle ? `@${current.handle}` : '';
  const byline = (
    <>
      <Avatar src={current?.avatar} name={name} size="sm" />
      <span className="post-as-text">
        <span className="post-as-label">Posting as</span>
        <span className="post-as-name">{name}</span>
        {handle && name !== handle && <span className="post-as-handle">{handle}</span>}
      </span>
    </>
  );

  if (!many || locked) {
    return (
      <div className="post-as" data-static>
        <div className="post-as-button post-as-button--static">{byline}</div>
        {locked && lockedReason && <p className="field-hint post-as-note">{lockedReason}</p>}
      </div>
    );
  }

  const statusOf = (a) => (a.status === 'needsSignIn' || checked[a.did] === 'expired' ? 'needsSignIn' : a.status);

  return (
    <div
      className="post-as"
      ref={rootRef}
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className="post-as-button"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-label={`Posting as ${name}${handle ? ` (${handle})` : ''}. Change the account`}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        {byline}
        <ChevronDown size={15} aria-hidden="true" className="post-as-caret" />
      </button>
      {open && (
        <div id={`${id}-list`} className="post-as-list">
          <p className="post-as-hint">The post, its draft or its schedule goes to the account you choose. The rest of Virga stays as it is.</p>
          <ul>
            {accounts.map((a) => {
              const status = statusOf(a);
              const out = status === 'needsSignIn';
              const selected = a.did === asDid;
              const label = accountName(a);
              return (
                <li key={a.did} className="post-as-row">
                  <button
                    type="button"
                    className="post-as-option"
                    aria-pressed={selected}
                    disabled={out}
                    onClick={() => {
                      setOpen(false);
                      if (!selected) onChange?.(a.did);
                      buttonRef.current?.focus();
                    }}
                  >
                    <Avatar src={a.avatar} name={label} size="sm" />
                    <span className="post-as-text">
                      <span className="post-as-name">{label}</span>
                      <span className="post-as-handle">
                        {a.handle ? `@${a.handle}` : a.did}
                        {a.did === activeDid ? ' · open in Virga' : ''}
                        {out ? ' · signed out' : status === 'unknown' || checked[a.did] === 'unknown' ? ' · couldn’t check' : ''}
                      </span>
                    </span>
                    {selected && <Check size={16} aria-hidden="true" className="post-as-check" />}
                  </button>
                  {out && (
                    <Button size="sm" onClick={() => requestReauth(a.did, { immediate: true })} aria-label={`Sign back in as ${label}`}>
                      <LogIn size={14} aria-hidden="true" />
                      Sign back in
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
