import { callbackErrorMessage } from '../lib/oauthClient.js';
import { useAtprotoSession } from '../session/useAtprotoSession.jsx';

/**
 * A sign-in that came back without a session: declined at the consent
 * screen, or the return couldn't be matched to the request that started it.
 * Either kind of sign-in lands here (the browser's callback, or a return
 * from Virga's server). It says which, and the way out is back into the app,
 * where any account already signed in is still open.
 */
export default function SignInReturn({ error }) {
  const { session } = useAtprotoSession();
  const detail = error?.params?.get?.('error_description') || error?.message || String(error);
  return (
    <div className="landing landing--center">
      <main className="card return-card">
        <h1 className="return-title">Sign-in didn’t complete</h1>
        <p className="landing-lede">{callbackErrorMessage(error)}</p>
        <p>
          <a className="btn btn--primary btn--lg" href="/">
            {session ? 'Back to Virga' : 'Back to the start'}
          </a>
        </p>
        <details className="disclosure">
          <summary>Details</summary>
          <code className="return-code">{detail}</code>
        </details>
      </main>
    </div>
  );
}
