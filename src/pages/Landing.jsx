import { useRef, useState } from 'react';
import { APP_NAME } from '../config.js';
import { signInErrorMessage } from '../lib/oauthClient.js';
import { useAtprotoSession } from '../session/useAtprotoSession.jsx';

/**
 * The front page, for someone who isn't signed in: what this is, and the one
 * field that starts a sign-in. All the copy here is a draft.
 */
export default function Landing() {
  const { signIn } = useAtprotoSession();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  async function handleSubmit(event) {
    event.preventDefault();
    const value = input.trim().replace(/^@/, '');
    // The button is never greyed out; pressed with nothing typed, it sends
    // you to the field.
    if (!value) {
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signIn(value);
      // Redirected away. Nothing below runs unless the redirect didn't happen.
    } catch (err) {
      console.warn('[sign-in] failed to start:', err);
      setBusy(false);
      setError(signInErrorMessage(err));
    }
  }

  return (
    <main className="landing">
      <div className="landing-in">
        <h1 className="landing-title">{APP_NAME}</h1>
        <p className="landing-lede">
          Analytics for your Bluesky account and the rest of your atproto repo: followers, blocks,
          posts, engagement and the people behind it. Worked out in your browser, from your own
          data.
        </p>

        <form className="signin" onSubmit={handleSubmit}>
          <label className="signin-label" htmlFor="signin-input">
            Your handle
          </label>
          <div className="signin-row">
            {/* A handle is not prose: iOS otherwise capitalizes the first
                letter and runs autocorrect over it. autoCorrect,
                autoCapitalize and spellCheck each have to be turned off by
                name. inputMode="url" puts the '.' on the primary key plane,
                and enterKeyHint labels the return key for what it does. */}
            <input
              ref={inputRef}
              id="signin-input"
              className="signin-input"
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
              aria-describedby={error ? 'signin-error' : 'signin-note'}
            />
            <button type="submit" className="btn btn--primary signin-button" disabled={busy}>
              {busy ? 'Redirecting…' : 'Sign in'}
            </button>
          </div>
          {error && (
            <p id="signin-error" className="signin-error" role="alert">
              {error}
            </p>
          )}
        </form>

        <p id="signin-note" className="landing-note">
          You sign in on your own account’s server, not here. Virga can then read your follower
          list and your notifications, and follow or unfollow someone when you press Follow. It
          can’t post, like or read your messages. Your archive is kept in this browser; Virga has
          no server to send it to.
        </p>
      </div>
    </main>
  );
}
