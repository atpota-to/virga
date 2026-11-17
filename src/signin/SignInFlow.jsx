import { useCallback, useEffect, useId, useReducer, useRef, useState } from 'react';
import { ChevronRight, ExternalLink, X } from 'lucide-react';
import { reauthModeFor } from '../accounts/accountCopy.js';
import Avatar from '../components/Avatar.jsx';
import Button from '../components/Button.jsx';
import { APP_NAME } from '../config.js';
import { signInErrorMessage } from '../lib/oauthClient.js';
import { accountHandle, accountName, accountSignInId, lastOpenedLabel } from '../session/accounts.js';
import { useAtprotoSession } from '../session/useAtprotoSession.jsx';
import HandleField from './HandleField.jsx';
import HowSigningInWorks from './HowSigningInWorks.jsx';
import {
  FINDING_MIN_MS,
  LEAVE_DELAY_MS,
  STALL_MS,
  STEP,
  continueLabel,
  flowReducer,
  identityMeta,
  identityName,
  initialFlow,
  leavingDetail,
  leavingTitle,
  lookupFailedNotice,
  notFoundNotice,
  stallLabel,
  tripFailureNotice,
} from './flow.js';
import { SIGNUP_HOSTS, signUpAt } from './hosts.js';
import { IdentityNotFoundError, classifySignInInput, hostnameOf, normalizeSignInInput, resolveSignInHost, resolveSignInIdentity } from './identity.js';
import { IdentityBones, IdentityRow } from './parts.jsx';
// The remembered accounts are drawn with the account list's own classes.
import '../accounts/accounts.css';
import './signin.css';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The accounts this browser remembers, to come back to without typing a
 * handle. One whose sign-in still holds opens at once; the rest sign in again.
 */
function RememberedAccounts({ accounts, opening, disabled, onOpen, onForget }) {
  const titleId = useId();
  return (
    <div className="remembered">
      <h2 className="field-label" id={titleId}>
        Continue as
      </h2>
      <ul className="remembered-list" aria-labelledby={titleId}>
        {accounts.map((a) => {
          const name = accountName(a);
          const handle = accountHandle(a);
          const opened = lastOpenedLabel(a.lastUsed);
          return (
            <li key={a.did} className="remembered-row">
              <button type="button" className="remembered-open" disabled={disabled} onClick={() => onOpen(a)} aria-label={`Continue as ${name}`}>
                <Avatar src={a.avatar} name={name} size="lg" />
                <span className="remembered-text">
                  <span className="remembered-name">{opening === a.did ? 'Opening…' : name}</span>
                  {(handle || opened) && (
                    <span className="meta remembered-meta">
                      {handle && <span className="remembered-handle">{handle}</span>}
                      {opened && <span className="remembered-opened">{opened}</span>}
                    </span>
                  )}
                </span>
                <ChevronRight className="remembered-chevron" size={16} aria-hidden="true" />
              </button>
              <Button
                variant="ghost"
                size="sm"
                icon
                aria-label={`Forget ${name} on this browser`}
                title="Forget on this browser (its archive stays)"
                disabled={disabled}
                onClick={() => onForget(a)}
              >
                <X size={15} aria-hidden="true" />
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Signing in, a step at a time: type a handle, see the account it belongs to
 * and where that account signs in, then go there. Or make an account, on a
 * host chosen from a short list. The steps and their words are in flow.js;
 * this holds the timers, the lookups and the page.
 *
 * `variant` is 'page' (the front page, straight on the sky under the lede)
 * or 'dialog' (inside Add an account, which brings its own title and frame).
 * `remembered` lists the accounts this browser knows above the field.
 */
export default function SignInFlow({ variant = 'page', remembered = false, composing = false }) {
  const { signIn, switchAccount, removeAccount, accounts, authMode } = useAtprotoSession();
  const [flow, dispatch] = useReducer(flowReducer, undefined, initialFlow);
  const [handle, setHandle] = useState('');
  const [opening, setOpening] = useState(null);
  const [howOpen, setHowOpen] = useState(false);

  const base = useId();
  const fieldId = `${base}-handle`;
  const noticeId = `${base}-notice`;
  const titleId = `${base}-title`;
  const detailId = `${base}-detail`;

  const inputRef = useRef(null);
  const headingRef = useRef(null);
  const actionRef = useRef(null);
  const lookup = useRef(null);
  // What sends the browser on, for the trip the leaving card is showing, and
  // what calls that trip off: its requests are dropped, and an address that
  // arrives late isn't gone to.
  const run = useRef(null);
  const tripAbort = useRef(null);
  const stallTimer = useRef(null);
  const flowRef = useRef(flow);
  flowRef.current = flow;

  const inDialog = variant === 'dialog';
  // The dialog's own title is the h2 above these.
  const Heading = inDialog ? 'h3' : 'h2';
  const { step, identity, notice, leaving } = flow;
  const showRemembered = remembered && accounts.length > 0;

  useEffect(
    () => () => {
      lookup.current?.abort();
      tripAbort.current?.abort();
      clearTimeout(stallTimer.current);
    },
    [],
  );

  /* ---- leaving ------------------------------------------------------ */

  const depart = useCallback(async (trip) => {
    const go = run.current;
    const signal = tripAbort.current?.signal;
    if (!go || signal?.aborted) return;
    dispatch({ type: 'sent', trip });
    clearTimeout(stallTimer.current);
    stallTimer.current = setTimeout(() => dispatch({ type: 'stalled', trip }), STALL_MS);
    try {
      await go(signal);
    } catch (error) {
      // Called off: the card has already gone back, and there is nothing to say.
      if (signal?.aborted) return;
      console.warn('[sign-in] failed to start:', error);
      clearTimeout(stallTimer.current);
      dispatch({ type: 'trip-failed', trip, notice: tripFailureNotice(error, flowRef.current.leaving) });
    }
  }, []);

  // The card is on view for a moment before the browser goes: long enough to
  // read where it is going, and to turn back. Reduced motion keeps the wait
  // (it is for reading); only the line that fills is left out, in CSS.
  const trip = step === STEP.LEAVING ? leaving.trip : null;
  useEffect(() => {
    if (trip == null) return undefined;
    const timer = setTimeout(() => depart(trip), LEAVE_DELAY_MS);
    return () => {
      clearTimeout(timer);
      clearTimeout(stallTimer.current);
    };
  }, [trip, depart]);

  // Back from the host with the browser's Back button: the page is restored
  // as it was left, mid-departure. Put the reader back on the card they left.
  useEffect(() => {
    const onPageShow = (event) => {
      if (!event.persisted || flowRef.current.step !== STEP.LEAVING) return;
      run.current = null;
      tripAbort.current?.abort();
      dispatch({ type: 'cancel' });
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  // `go(signal)` starts the sign-in; the signal is this trip's, and Cancel
  // fires it.
  function leave({ host, purpose, go }) {
    tripAbort.current?.abort();
    tripAbort.current = new AbortController();
    run.current = go;
    dispatch({ type: 'leave', host, purpose });
  }

  function cancelLeaving() {
    const sent = flowRef.current.leaving?.phase !== 'waiting';
    run.current = null;
    tripAbort.current?.abort();
    clearTimeout(stallTimer.current);
    // Once the sign-in has been sent, the browser may already be on its way
    // to the host: this stops that. Not before then, because it stops every
    // request the page has in flight, and inside the app (Add an account)
    // those are the archive's and the composer's.
    if (sent) {
      try {
        window.stop();
      } catch {
        // Nothing to stop.
      }
    }
    dispatch({ type: 'cancel' });
  }

  /* ---- the steps ---------------------------------------------------- */

  // `picked` is a suggestion taken from under the field: looked up at once,
  // rather than waiting for the field's own state to catch up with it.
  async function find(picked) {
    if (flowRef.current.step !== STEP.ENTRY || opening) return;
    const value = normalizeSignInInput(picked ?? handle);
    const kind = classifySignInInput(value);
    // The button is never greyed out; pressed with nothing typed, it sends
    // the reader to the field.
    if (kind === 'empty') {
      inputRef.current?.focus();
      return;
    }
    if (value !== handle) setHandle(value);
    if (kind === 'url') {
      const host = hostnameOf(value);
      if (!host) {
        // Raised without the card changing, so nothing moves focus: an alert.
        dispatch({ type: 'notice', notice: { about: 'address', text: 'That address isn’t one Virga can read. Type your handle (it looks like you.bsky.social).' } });
        return;
      }
      leave({ host, purpose: 'signin', go: (signal) => signIn(value, { mode: authMode, intent: 'add', signal }) });
      return;
    }

    lookup.current?.abort();
    const controller = new AbortController();
    lookup.current = controller;
    dispatch({ type: 'find' });
    const started = Date.now();
    const settle = () => wait(Math.max(0, FINDING_MIN_MS - (Date.now() - started)));
    try {
      const found = await resolveSignInIdentity(value, { signal: controller.signal });
      await settle();
      if (!controller.signal.aborted) dispatch({ type: 'found', identity: found });
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') return;
      await settle();
      if (controller.signal.aborted) return;
      dispatch({ type: 'lookup-failed', notice: error instanceof IdentityNotFoundError ? notFoundNotice(value) : lookupFailedNotice(value) });
    }
  }

  function notMe() {
    lookup.current?.abort();
    dispatch({ type: 'not-me' });
  }

  function continueAs(who) {
    const id = who.handle || who.did;
    leave({ host: who.host || null, purpose: 'signin', go: (signal) => signIn(id, { mode: authMode, intent: 'add', signal }) });
  }

  function chooseHost(host) {
    leave({ host: host.domain, purpose: 'signup', go: (signal) => signUpAt(signIn, host.url, { mode: authMode, signal }) });
  }

  async function openRemembered(account) {
    if (opening || flowRef.current.step !== STEP.ENTRY) return;
    dispatch({ type: 'notice', notice: null });
    const again = (signal) => signIn(accountSignInId(account), { mode: reauthModeFor(account, authMode), intent: 'reauth', signal });
    const stepOut = () => {
      setOpening(null);
      const next = flowRef.current.trips + 1;
      leave({ host: null, purpose: 'signin', go: again });
      // The card comes up at once; the host's name joins it when it's known.
      resolveSignInHost(account.did)
        .then(({ host }) => dispatch({ type: 'host-known', trip: next, host }))
        .catch(() => {});
    };
    if (account.status === 'needsSignIn') {
      stepOut();
      return;
    }
    setOpening(account.did);
    try {
      // An account whose session holds opens in place; one that turns out to
      // have ended signs in again.
      await switchAccount(account.did);
    } catch (error) {
      if (error?.code === 'REAUTH_REQUIRED') {
        stepOut();
        return;
      }
      console.warn('[sign-in] failed to open:', error);
      setOpening(null);
      dispatch({ type: 'notice', notice: { about: 'trip', text: signInErrorMessage(error) } });
    }
  }

  // Focus goes with the card, so a keyboard and a screen reader follow it.
  // Not on the first card: the page shouldn't take focus (or raise a phone's
  // keyboard) just by loading.
  const firstStep = useRef(true);
  const lastStep = useRef(step);
  useEffect(() => {
    const from = lastStep.current;
    lastStep.current = step;
    if (firstStep.current) {
      firstStep.current = false;
      return undefined;
    }
    // The account arriving on the card that was waiting for it isn't a new
    // card. Focus is on the button unless the reader has moved it (to "Not
    // you?", say), and it is left where they put it.
    if (from === STEP.FINDING && step === STEP.FOUND) return undefined;
    const frame = requestAnimationFrame(() => {
      if (step === STEP.ENTRY) {
        inputRef.current?.focus({ preventScroll: true });
        inputRef.current?.select();
      } else if (step === STEP.FINDING || step === STEP.FOUND) actionRef.current?.focus({ preventScroll: true });
      else headingRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [step]);

  /* ---- the cards ---------------------------------------------------- */

  // A notice about the handle (not found, or not an address Virga can read)
  // is the field's own hint, in words under it, and the field is marked.
  // It is the field's description too: for a handle that wasn't found the
  // focus goes back to the field, so it is read once that way, and as an
  // alert as well it would be read twice. An address that can't be read
  // leaves the focus where it is, so that one is an alert. Any other notice
  // (a lookup or a trip that failed) isn't about what was typed: it has no
  // control to hang on, and is an alert in a box of its own.
  const fieldNotice = notice?.about === 'field' || notice?.about === 'address' ? notice : null;
  const noticeLine = notice && !fieldNotice && (
    <p id={noticeId} className="callout callout--danger" role="alert">
      <span>
        {notice.text}
        {notice.anyway && (
          <>
            {' '}
            <button
              type="button"
              className="signin-link"
              onClick={() => leave({ host: null, purpose: 'signin', go: (signal) => signIn(notice.anyway, { mode: authMode, intent: 'add', signal }) })}
            >
              Continue anyway
            </button>
          </>
        )}
      </span>
    </p>
  );

  let card;
  if (step === STEP.ENTRY) {
    card = (
      <form
        className="signin-step"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          find();
        }}
      >
        {composing && (
          <p className="callout" role="status">
            Sign in to finish your post. What you were sharing opens in the composer once you’re in.
          </p>
        )}
        {showRemembered && (
          <RememberedAccounts
            accounts={accounts}
            opening={opening}
            disabled={Boolean(opening)}
            onOpen={openRemembered}
            onForget={(account) => removeAccount(account.did, { deleteData: false })}
          />
        )}
        <label className="field-label" htmlFor={fieldId}>
          {showRemembered ? 'Or sign in with another handle' : inDialog ? 'Handle' : 'Your handle'}
        </label>
        <div className="signin-row">
          <div className="signin-field">
            <HandleField
              id={fieldId}
              inputRef={inputRef}
              value={handle}
              size={inDialog ? 'md' : 'lg'}
              autoFocus={inDialog}
              disabled={Boolean(opening)}
              invalid={Boolean(fieldNotice)}
              describedBy={fieldNotice ? noticeId : undefined}
              onChange={(value) => {
                setHandle(value);
                dispatch({ type: 'typed' });
              }}
              onPick={(picked) => {
                setHandle(picked);
                find(picked);
              }}
            />
            {fieldNotice && (
              <p id={noticeId} className="field-hint signin-field-error" role={fieldNotice.about === 'field' ? undefined : 'alert'}>
                {fieldNotice.text}
              </p>
            )}
          </div>
          <button type="submit" className={`btn btn--primary${inDialog ? '' : ' btn--lg'}`} disabled={Boolean(opening)}>
            Sign in
          </button>
        </div>
        {noticeLine}
        <div className="signin-links">
          <button type="button" className="signin-link" onClick={() => dispatch({ type: 'hosts' })}>
            Make an account
          </button>
          <button type="button" className="signin-link" onClick={() => setHowOpen(true)}>
            How signing in works
          </button>
        </div>
      </form>
    );
  } else if (step === STEP.FINDING || step === STEP.FOUND) {
    const found = step === STEP.FOUND && identity;
    const name = found ? identityName(identity) : '';
    const meta = found ? identityMeta(identity) : '';
    card = (
      <section className="signin-step" aria-labelledby={titleId}>
        <Heading id={titleId} className="signin-title" tabIndex={-1} ref={headingRef}>
          Is this you?
        </Heading>
        <div className="signin-identity-slot" aria-busy={!found}>
          {found ? <IdentityRow identity={identity} /> : <IdentityBones />}
        </div>
        <p className="visually-hidden" role="status">
          {found ? `Found ${[name, meta].filter(Boolean).join(', ')}.` : 'Looking you up…'}
        </p>
        {found && (
          <p className="signin-detail">
            {identity.host ? (
              <>
                Your account lives at <strong>{identity.host}</strong>, so that’s where you sign in.
              </>
            ) : (
              'Virga couldn’t tell where this account lives. Its host is found when you continue.'
            )}
          </p>
        )}
        {noticeLine}
        {/* Focusable while it waits, so focus has somewhere to be and Enter
            works the moment the account is found. */}
        <button
          ref={actionRef}
          type="button"
          className="btn btn--primary btn--lg signin-action"
          aria-disabled={!found || undefined}
          aria-busy={!found || undefined}
          onClick={() => found && continueAs(identity)}
        >
          {found ? continueLabel(identity) : 'Looking you up…'}
          {found && <ExternalLink size={15} aria-hidden="true" />}
        </button>
        <div className="signin-links">
          <button type="button" className="signin-link" onClick={notMe}>
            Not you?
          </button>
          {inDialog && <span className="signin-aside">{APP_NAME} never sees your password.</span>}
        </div>
      </section>
    );
  } else if (step === STEP.LEAVING) {
    card = (
      <section className="signin-step" aria-labelledby={titleId}>
        <Heading id={titleId} className="signin-title" tabIndex={-1} ref={headingRef} aria-describedby={detailId}>
          {/* Keyed, so a host learned a moment later fades in rather than
              replacing the words under the reader. */}
          <span key={leaving.host || 'unknown'} className="signin-arriving">
            {leavingTitle(leaving)}…
          </span>
        </Heading>
        <p id={detailId} className="signin-detail">
          {leavingDetail(leaving)}
        </p>
        <div className="signin-wick" data-phase={leaving.phase} style={{ '--signin-wick-ms': `${LEAVE_DELAY_MS}ms` }} aria-hidden="true">
          <span />
        </div>
        {leaving.phase === 'stalled' && (
          <p className="signin-detail" role="status">
            Still here?{' '}
            <button type="button" className="signin-link" onClick={() => depart(leaving.trip)}>
              {stallLabel(leaving)}
            </button>
          </p>
        )}
        <div className="signin-links">
          <button type="button" className="signin-link" onClick={cancelLeaving}>
            Cancel
          </button>
          {inDialog && <span className="signin-aside">{APP_NAME} never sees your password.</span>}
        </div>
      </section>
    );
  } else {
    card = (
      <section className="signin-step" aria-labelledby={titleId}>
        <Heading id={titleId} className="signin-title" tabIndex={-1} ref={headingRef}>
          Where should your account live?
        </Heading>
        <p className="signin-detail">
          Your handle and your posts live with a host you choose. You make the account on their page, then come straight back here, signed in.
        </p>
        {noticeLine}
        <ul className="signin-hosts" aria-label="Hosts">
          {SIGNUP_HOSTS.map((host) => (
            <li key={host.id}>
              <button type="button" className="signin-host" onClick={() => chooseHost(host)}>
                <span className="signin-host-text">
                  <span className="signin-host-name">
                    {host.name}
                    {/* The space stands outside the note, which is a box of its own (so the
                        line that underlines the name on hover stops at the name). */}
                    {host.recommended && ' '}
                    {host.recommended && <span className="signin-host-note">· most people start here</span>}
                  </span>
                  <span className="signin-host-meta">
                    {host.domain} · {host.region}
                  </span>
                </span>
                <ExternalLink size={15} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        <div className="signin-links">
          <button type="button" className="signin-link" onClick={() => dispatch({ type: 'hosts-back' })}>
            I already have an account
          </button>
          <span className="signin-aside">You can move to another host later.</span>
        </div>
      </section>
    );
  }

  // FINDING and FOUND are one card: the account takes the bones' place
  // rather than the whole card changing.
  const cardKey = step === STEP.FINDING ? STEP.FOUND : step;
  return (
    <div className={`signin-flow signin-flow--${variant}`} data-step={step}>
      <div key={cardKey} className="signin-card">
        {card}
      </div>
      <HowSigningInWorks open={howOpen} onClose={() => setHowOpen(false)} longSession={authMode === 'backend'} />
    </div>
  );
}
