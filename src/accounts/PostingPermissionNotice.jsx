import { LogIn } from 'lucide-react';
import Button from '../components/Button.jsx';
import { useAtprotoSession } from '../session/useAtprotoSession.jsx';
import { POSTING_REGRANT_MESSAGE, requestReauth } from './accountCopy.js';
import './accounts.css';

/**
 * Shown where an account is about to post when its session was granted
 * before Virga asked for posting (capabilitiesFor(did).canPost is false while
 * the account is still signed in), or when a write came back refused for want
 * of the permission (pass `force`). Signing in again asks for it.
 */
export default function PostingPermissionNotice({ did, force = false }) {
  const { capabilitiesFor, accounts } = useAtprotoSession();
  const account = accounts.find((a) => a.did === did);
  if (!account || account.status === 'needsSignIn') return null;
  if (!force && capabilitiesFor(did).canPost) return null;
  return (
    <div className="callout callout--warn posting-permission" role="status">
      <span>{POSTING_REGRANT_MESSAGE}</span>
      <Button size="sm" variant="primary" onClick={() => requestReauth(did, { immediate: true })}>
        <LogIn size={15} aria-hidden="true" />
        Sign in again
      </Button>
    </div>
  );
}
