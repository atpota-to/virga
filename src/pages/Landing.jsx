import { LayoutDashboard, Lock, Wrench } from 'lucide-react';
import LiveSky from '../hillside/LiveSky.jsx';
import { APP_NAME } from '../config.js';
import { PRIVACY_PATH, TERMS_PATH } from '../legal/version.js';
import { usePreferences } from '../lib/preferences.jsx';
import { Link } from '../lib/router.jsx';
import { LogoMark, useSkyTaps } from '../shell/bits.jsx';
import SignInFlow from '../signin/SignInFlow.jsx';
import '../accounts/accounts.css';

/**
 * The front page, for someone who isn't signed in: what this is, and the
 * sign-in (src/signin/SignInFlow.jsx), which lists the accounts this browser
 * remembers above the one field that starts a new one. It sits on the sky
 * as the app does, with the mark where the app has it. All the copy here is
 * a draft.
 */
export default function Landing({ composing = false }) {
  const { liveSky } = usePreferences();
  // Five taps on the mark: the live sky, as anywhere else in Virga.
  const tapLogo = useSkyTaps();

  return (
    <div className="landing">
      {liveSky && <LiveSky />}
      <header className="landing-bar">
        <button type="button" className="brand" onClick={tapLogo} aria-label={APP_NAME}>
          <LogoMark />
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

            <SignInFlow variant="page" remembered composing={composing} />
            <p className="landing-note">
              You sign in on your own account’s host, not here, and Virga never sees your password. Before your account opens, Virga asks you
              to agree to its <Link to={TERMS_PATH}>Terms of Service</Link> and <Link to={PRIVACY_PATH}>Privacy Policy</Link>.
            </p>
          </div>

          <Sketch />
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
            <p>Your archive lives in this browser, and you can export it whenever you like. It’s never sent anywhere, not even to Virga’s server.</p>
          </div>
        </section>
      </main>

      <footer className="landing-foot">
        <span>
          Your archive is worked out and kept in this browser. Requests go to your account’s host, Bluesky’s public API, the PLC directory
          and Constellation, and, for long sessions, scheduled posts and your agreement to the terms, to Virga’s server. The{' '}
          <Link to={PRIVACY_PATH}>Privacy Policy</Link> has the whole list.
        </span>
        <nav className="landing-foot-links" aria-label="Legal">
          <Link to={TERMS_PATH}>Terms</Link>
          <Link to={PRIVACY_PATH}>Privacy</Link>
        </nav>
      </footer>
    </div>
  );
}

// How wide each bar of the sketch is, as a share of its column: a label, the
// figure under it, and the line under that.
const SKETCH_FIGURES = [
  [46, 72, 58],
  [62, 44, 76],
  [54, 66, 50],
  [34, 30, 64],
];
const SKETCH_POSTS = [88, 72, 80];
const SKETCH_PEOPLE = [58, 46, 66];
// A best-time grid: four days of fourteen hours, a step of heat in each.
const SKETCH_HEAT = [
  [0, 1, 1, 2, 3, 2, 1, 2, 4, 3, 2, 1, 1, 0],
  [1, 1, 2, 3, 5, 4, 2, 3, 6, 5, 3, 2, 1, 1],
  [0, 1, 2, 2, 4, 3, 2, 2, 5, 4, 2, 2, 1, 0],
  [0, 0, 1, 2, 2, 3, 1, 1, 3, 2, 2, 1, 0, 0],
].flat();

/**
 * What is inside, as a picture: a dashboard drawn in shapes, not numbers
 * (styles/app.css draws it from the theme's tokens). Decoration, so it is
 * hidden from a screen reader; the three points under it say the same in
 * words.
 */
function Sketch() {
  return (
    <div className="landing-sketch" aria-hidden="true">
      <div className="sketch-figures">
        {SKETCH_FIGURES.map(([label, number, note], i) => (
          <div key={i} className="sketch-figure" data-on={i === 0 || undefined}>
            <span className="sketch-word" style={{ width: `${label}%` }} />
            <span className="sketch-number" style={{ width: `${number}%` }} />
            <span className="sketch-word sketch-word--faint" style={{ width: `${note}%` }} />
          </div>
        ))}
      </div>

      <div className="sketch-chart">
        <div className="sketch-head">
          <span className="sketch-word sketch-word--strong" style={{ width: '32%' }} />
          <span className="sketch-tabs">
            <span className="sketch-word is-on" />
            <span className="sketch-word" />
          </span>
        </div>
        <svg viewBox="0 0 520 176">
          <path className="sketch-grid" d="M0 12H520M0 88H520M0 164H520" />
          <path className="sketch-line" d="M4 132L60 126L116 121L172 113L228 108L284 99L340 92L372 88L404 80L436 74L468 60L484 44" />
          <path className="sketch-line sketch-line--dashed" d="M484 44L512 22" />
          <circle className="sketch-dot sketch-dot--open" cx="484" cy="44" r="3.5" />
          <circle className="sketch-dot" cx="512" cy="22" r="4.5" />
        </svg>
      </div>

      <div className="sketch-lists">
        <div className="sketch-list">
          <span className="sketch-word sketch-word--strong" style={{ width: '38%' }} />
          {SKETCH_POSTS.map((width, i) => (
            <span key={i} className="sketch-row">
              <span className="sketch-word" style={{ width: `${width}%` }} />
              <span className="sketch-word" />
            </span>
          ))}
        </div>
        <div className="sketch-list">
          <span className="sketch-word sketch-word--strong" style={{ width: '46%' }} />
          {SKETCH_PEOPLE.map((width, i) => (
            <span key={i} className="sketch-row">
              <span className="sketch-face" />
              <span className="sketch-word" style={{ width: `${width}%` }} />
              <span className="sketch-word" />
            </span>
          ))}
        </div>
      </div>

      <div className="sketch-list sketch-times">
        <span className="sketch-word sketch-word--strong" style={{ width: '28%' }} />
        <div className="sketch-heat">
          {SKETCH_HEAT.map((step, i) => (
            <span key={i} data-step={step} />
          ))}
        </div>
      </div>
    </div>
  );
}
