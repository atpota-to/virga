import { useEffect, useId, useRef, useState } from 'react';
import Button from '../components/Button.jsx';
import { APP_NAME } from '../config.js';
import { LogoMark } from '../shell/bits.jsx';
import { IdentityBones, IdentityRow } from '../signin/parts.jsx';
import { acceptFailure } from './acceptance.js';
import LegalDialog from './LegalDialog.jsx';
import '../signin/signin.css';
import './legal.css';

// How long to wait for the account's name before showing it by its DID.
const NAME_WAIT_MS = 2_500;

/**
 * The agreement screen: shown in the app's place to a signed-in account that
 * hasn't agreed to the current Terms of Service and Privacy Policy. Nothing
 * of the app is drawn behind it and nothing is read for the account until it
 * agrees. The two ways on are agreeing and signing out.
 *
 * `onAccept` records the agreement and resolves when the screen may go; if it
 * throws, the screen stays and says why.
 */
export default function TermsGate({ did, profile, mode, onAccept, onSignOut }) {
  const [agreed, setAgreed] = useState(false);
  const [nudge, setNudge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  const [reading, setReading] = useState(null);
  const [waited, setWaited] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const check = useRef(null);
  const titleId = useId();
  const hintId = useId();

  useEffect(() => {
    setWaited(false);
    const timer = setTimeout(() => setWaited(true), NAME_WAIT_MS);
    return () => clearTimeout(timer);
  }, [did]);

  const identity = { did, handle: profile?.handle || null, displayName: profile?.displayName || null, avatar: profile?.avatar || null };
  const named = Boolean(identity.handle || identity.displayName);

  async function agree() {
    if (busy) return;
    // The button is never greyed out; pressed before the box is ticked, it
    // says what is missing and sends the reader to the box.
    if (!agreed) {
      setNudge(true);
      check.current?.focus();
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      await onAccept();
    } catch (error) {
      console.warn('[terms] the agreement wasn’t recorded:', error);
      setFailure(acceptFailure(error));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setLeaving(true);
    try {
      await onSignOut();
    } finally {
      setLeaving(false);
    }
  }

  return (
    <div className="landing landing--center terms-gate">
      <main className="card return-card terms-card" aria-labelledby={titleId}>
        <div className="terms-brand" aria-hidden="true">
          <LogoMark size={28} />
          <span className="brand-name">{APP_NAME}</span>
        </div>
        <h1 id={titleId} className="return-title">
          Before you start
        </h1>
        <div className="signin-identity-slot">
          {named || waited ? (
            <IdentityRow
              identity={identity}
              action={
                <Button variant="ghost" size="sm" onClick={signOut} disabled={busy || leaving}>
                  {leaving ? 'Signing out…' : 'Sign out'}
                </Button>
              }
            />
          ) : (
            <IdentityBones />
          )}
        </div>
        <p className="signin-detail">
          Have a look at the{' '}
          <button type="button" className="signin-link terms-doc-link" onClick={() => setReading('terms')}>
            Terms of Service
          </button>{' '}
          and the{' '}
          <button type="button" className="signin-link terms-doc-link" onClick={() => setReading('privacy')}>
            Privacy Policy
          </button>
          . They say what {APP_NAME} does, what it keeps about your account, and what you agree to by using it.
        </p>
        {/* The box's words say in full what is agreed to, and they are its
            name as well: what is read out, and what someone using their
            voice says to tick it, are what is on the screen. */}
        <label className="check terms-check">
          <input
            ref={check}
            type="checkbox"
            checked={agreed}
            aria-describedby={nudge && !agreed ? hintId : undefined}
            onChange={(event) => {
              setAgreed(event.target.checked);
              if (event.target.checked) setNudge(false);
            }}
          />
          <span>I’ve read the Terms of Service and the Privacy Policy, and I agree to them.</span>
        </label>
        {/* Read as the box's description when focus lands on it, which the
            press that raised it does; an alert as well would say it twice. */}
        {nudge && !agreed && (
          <p id={hintId} className="callout callout--warn">
            Tick the box to say you agree, then carry on.
          </p>
        )}
        {failure && (
          <p className="callout callout--danger" role="alert">
            <span>
              {failure.text}
              {failure.reload && (
                <>
                  {' '}
                  <button type="button" className="signin-link" onClick={() => window.location.reload()}>
                    Reload
                  </button>
                </>
              )}
            </span>
          </p>
        )}
        <Button variant="primary" size="lg" onClick={agree} aria-busy={busy || undefined} disabled={leaving}>
          {busy ? 'Recording…' : 'Agree and continue'}
        </Button>
        <p className="note">
          {mode === 'backend'
            ? `${APP_NAME}’s server keeps a record that this account agreed, and when, with the IP address and browser the agreement came from.`
            : `${APP_NAME} notes in this browser that this account agreed, and sends its server a report of it, with the IP address and browser the agreement came from.`}
        </p>
      </main>
      <LegalDialog docKey={reading} onClose={() => setReading(null)} />
    </div>
  );
}
