import { LogIn, Server, Timer } from 'lucide-react';
import Button from '../../components/Button.jsx';
import { useAccountActions } from '../../accounts/AccountMenu.jsx';
import { requestReauth } from '../../accounts/accountCopy.js';
import { COCOON_URL } from '../../config.js';
import { accountName } from '../../session/accounts.js';
import { useAtprotoSession } from '../../session/useAtprotoSession.jsx';
import { backendAccess } from './backendAccess.js';
import '../posting.css';

const SERVER_HOST = (() => {
  try {
    return new URL(COCOON_URL).host;
  } catch {
    return COCOON_URL;
  }
})();

/**
 * Where a page or setting needs Virga's server and `did` isn't signed in
 * through it: what's missing, why, and the way to get it. Renders nothing for
 * an account that already has a long session.
 */
export default function NeedsBackend({ did }) {
  const { accounts, authMode, capabilitiesFor } = useAtprotoSession();
  const actions = useAccountActions();
  const account = accounts.find((a) => a.did === did) || null;
  const { ready, action } = backendAccess(account, { authMode, canSchedule: Boolean(did && capabilitiesFor(did).canSchedule) });
  if (ready || action === 'none') return null;
  const name = accountName(account);

  return (
    <section className="card needs-backend" aria-labelledby={`needs-backend-${did}`}>
      <span className="needs-backend-icon" aria-hidden="true">
        <Server size={18} />
      </span>
      <div className="needs-backend-text">
        <h2 id={`needs-backend-${did}`} className="card-title">
          {action === 'signBackIn' ? 'The long session has ended' : 'Needs a long session'}
        </h2>
        {action === 'signBackIn' ? (
          <p className="card-sub">
            Scheduled posts, timers and the post adviser run on Virga’s server ({SERVER_HOST}). Sign {name} back in to see and change them.
            Anything already scheduled still goes out.
          </p>
        ) : (
          <p className="card-sub">
            Scheduled posts, timers and the post adviser run on Virga’s server ({SERVER_HOST}), so they keep working while this browser is
            closed. {name} is signed in with a browser session, which only lasts while Virga is open here.
          </p>
        )}
        {action === 'unavailable' && (
          <p className="card-sub">This copy of Virga doesn’t offer long sessions, so these features aren’t available here.</p>
        )}
        {action === 'reconnect' && (
          <div>
            <Button variant="primary" onClick={() => actions.lengthen(account)}>
              <Timer size={15} aria-hidden="true" />
              Reconnect for a longer session
            </Button>
          </div>
        )}
        {action === 'signBackIn' && (
          <div>
            <Button variant="primary" onClick={() => requestReauth(did, { immediate: true })}>
              <LogIn size={15} aria-hidden="true" />
              Sign back in
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
