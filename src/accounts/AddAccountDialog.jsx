import { useEffect, useRef, useState } from 'react';
import Button from '../components/Button.jsx';
import Dialog from '../components/Dialog.jsx';
import { signInErrorMessage } from '../lib/oauthClient.js';
import { useAtprotoSession } from '../session/useAtprotoSession.jsx';

/**
 * Sign another account in. The browser leaves for that account's server and
 * comes back with it open; the accounts already here stay signed in.
 */
export default function AddAccountDialog({ open, onClose }) {
  const { signIn, authMode } = useAtprotoSession();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setInput('');
      setBusy(false);
      setError(null);
    }
  }, [open]);

  async function submit(event) {
    event.preventDefault();
    const value = input.trim().replace(/^@/, '');
    if (!value) {
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signIn(value, { mode: authMode, intent: 'add' });
    } catch (err) {
      console.warn('[sign-in] failed to start:', err);
      setBusy(false);
      setError(signInErrorMessage(err));
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add an account"
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="add-account-form" disabled={busy}>
            {busy ? 'Redirecting…' : 'Sign in'}
          </Button>
        </>
      }
    >
      <form id="add-account-form" className="dialog-form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">Handle</span>
          {/* As on the front page: a handle isn't prose, so nothing should
              capitalize or correct it. */}
          <input
            ref={inputRef}
            className="input"
            type="text"
            name="handle"
            autoComplete="username"
            autoCorrect="off"
            autoCapitalize="none"
            inputMode="url"
            enterKeyHint="go"
            spellCheck={false}
            placeholder="you.bsky.social"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={busy}
            autoFocus
            aria-describedby={error ? 'add-account-error' : 'add-account-note'}
          />
        </label>
        {error && (
          <p id="add-account-error" className="callout callout--danger" role="alert">
            {error}
          </p>
        )}
        <p id="add-account-note" className="note">
          You sign in on the account’s own server, then come back here with it open. The accounts already signed in stay signed in, and each
          keeps its own archive.
          {authMode === 'backend' && ' It will be a long session, kept by Virga’s server.'}
        </p>
      </form>
    </Dialog>
  );
}
