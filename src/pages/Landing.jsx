import { useRef, useState } from 'react';
import { LayoutDashboard, Lock, Wrench } from 'lucide-react';
import Hillside from '../hillside/Hillside.jsx';
import { APP_NAME } from '../config.js';
import { signInErrorMessage } from '../lib/oauthClient.js';
import { usePreferences } from '../lib/preferences.jsx';
import { useAtprotoSession } from '../session/useAtprotoSession.jsx';

/**
 * The front page, for someone who isn't signed in: what this is, and the one
 * field that starts a sign-in. All the copy here is a draft.
 */
export default function Landing() {
  const { signIn } = useAtprotoSession();
  const { sky, setPref } = usePreferences();
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);
  const taps = useRef({ n: 0, at: 0 });

  // Five taps on the mark: the live sky, as anywhere else in Virga.
  function tapLogo() {
    const now = Date.now();
    const t = taps.current;
    t.n = now - t.at < 1500 ? t.n + 1 : 1;
    t.at = now;
    if (t.n >= 5) {
      t.n = 0;
      setPref('sky', !sky);
    }
  }

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
    <div className="landing" data-sky={sky || undefined}>
      {sky && (
        <div className="landing-sky" aria-hidden="true">
          <Hillside day={0} depth={0.8} intro />
        </div>
      )}
      <header className="landing-bar">
        <button type="button" className="brand" onClick={tapLogo} aria-label={APP_NAME}>
          <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true">
            <rect width="24" height="24" rx="6" fill="var(--accent)" />
            <path d="M6 11a6 6 0 0 1 12 0M9 14l-1 4.5M12.5 14l-1 6M16 14l-1 3.5" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          <span className="brand-name">{APP_NAME}</span>
        </button>
      </header>

      <main className="landing-main">
        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-copy">
            <p className="landing-eyebrow">Analytics for Bluesky and the rest of your atproto repo</p>
            <h1 id="landing-title" className="landing-title">
              Your account, in figures.
            </h1>
            <p className="landing-lede">
              Followers, blocks, posts, engagement and the people behind them, on dashboards you arrange yourself, with a few small tools
              for looking after your account. Worked out in your browser, from your own data.
            </p>

            <form className="signin" onSubmit={handleSubmit}>
              <label className="field-label" htmlFor="signin-input">
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
                  className="input input--lg"
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
                <button type="submit" className="btn btn--primary btn--lg" disabled={busy}>
                  {busy ? 'Redirecting…' : 'Sign in'}
                </button>
              </div>
              {error && (
                <p id="signin-error" className="callout callout--danger" role="alert">
                  {error}
                </p>
              )}
              <p id="signin-note" className="landing-note">
                You sign in on your own account’s server, not here. Virga can then read your follower list and your notifications, and
                follow or unfollow someone when you press Follow. It can’t post, like or read your messages.
              </p>
            </form>
          </div>

          <div className="landing-preview" aria-hidden="true">
            <div className="preview-window">
              <div className="preview-side">
                <span className="preview-logo" />
                <span />
                <span />
                <span />
                <span className="is-on" />
                <span />
                <span />
              </div>
              <div className="preview-main">
                <div className="preview-tiles">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="preview-tile">
                      <span className="preview-line short" />
                      <span className="preview-line big" />
                      <svg viewBox="0 0 100 24" preserveAspectRatio="none">
                        <path d={['M0 20L20 18L40 16L60 12L80 9L100 4', 'M0 14L20 17L40 10L60 13L80 7L100 9', 'M0 18L20 15L40 17L60 11L80 12L100 6', 'M0 12L20 14L40 9L60 15L80 10L100 11'][i]} />
                      </svg>
                    </div>
                  ))}
                </div>
                <div className="preview-row">
                  <div className="preview-card wide">
                    <span className="preview-line short" />
                    <svg viewBox="0 0 300 110" preserveAspectRatio="none" className="preview-chart">
                      <path className="area" d="M0 96L25 92L50 90L75 86L100 84L125 79L150 76L175 70L200 62L225 50L250 40L275 32L300 26V110H0Z" />
                      <path d="M0 96L25 92L50 90L75 86L100 84L125 79L150 76L175 70L200 62L225 50L250 40L275 32L300 26" />
                    </svg>
                  </div>
                  <div className="preview-card">
                    <span className="preview-line short" />
                    {[92, 40, 30, 12].map((w, i) => (
                      <span key={i} className="preview-bar">
                        <span style={{ width: `${w}%` }} />
                      </span>
                    ))}
                  </div>
                </div>
                <div className="preview-row">
                  <div className="preview-card">
                    {[0, 1, 2].map((i) => (
                      <span key={i} className="preview-person">
                        <span className="preview-dot" />
                        <span className="preview-line" />
                      </span>
                    ))}
                  </div>
                  <div className="preview-card">
                    <span className="preview-heat">
                      {Array.from({ length: 36 }, (_, i) => (
                        <span key={i} data-step={[1, 2, 1, 3, 2, 1, 2, 3, 4, 3, 2, 1, 1, 2, 3, 5, 4, 2, 1, 3, 4, 6, 5, 3, 1, 2, 3, 4, 3, 2, 1, 1, 2, 2, 1, 1][i]} />
                      ))}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-points" aria-label="What you get">
          <div>
            <LayoutDashboard size={18} aria-hidden="true" />
            <h2>Reports you arrange</h2>
            <p>Pick the reports you care about, size them, and keep a few dashboards: one for growth, one for what you post.</p>
          </div>
          <div>
            <Wrench size={18} aria-hidden="true" />
            <h2>Tools that ask first</h2>
            <p>Tidy up who you follow, see who left, find your best time to post. Each tool says what it can touch before it touches it.</p>
          </div>
          <div>
            <Lock size={18} aria-hidden="true" />
            <h2>Kept in your browser</h2>
            <p>Your archive lives in this browser, and you can export it whenever you like. Virga has no server to send it to.</p>
          </div>
        </section>
      </main>

      <footer className="landing-foot">
        <span>
          No Virga server, no database. Requests go to your PDS, Bluesky’s public API, plc.directory and Constellation.
        </span>
        <span>Draft copy</span>
      </footer>
    </div>
  );
}
