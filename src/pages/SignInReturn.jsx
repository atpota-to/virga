import { callbackErrorMessage } from '../lib/oauthClient.js';

/**
 * A sign-in that came back without a session: declined at the consent
 * screen, or the return couldn't be matched to the request that started it.
 * It says which, and the way out is back to the front page.
 */
export default function SignInReturn({ error }) {
  return (
    <main className="landing">
      <div className="landing-in">
        <h1 className="landing-heading">Sign-in didn’t complete</h1>
        <p className="landing-lede">{callbackErrorMessage(error)}</p>
        <p>
          <a className="btn btn--primary" href="/">
            Back to the start
          </a>
        </p>
        <details className="landing-details">
          <summary>Details</summary>
          <code>{String(error?.message || error)}</code>
        </details>
      </div>
    </main>
  );
}
