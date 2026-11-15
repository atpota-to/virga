import Dialog from '../components/Dialog.jsx';
import SignInFlow from '../signin/SignInFlow.jsx';
import { useAtprotoSession } from '../session/useAtprotoSession.jsx';

/**
 * Sign another account in, or make one. The browser leaves for that
 * account's host and comes back with it open; the accounts already here
 * stay signed in. The steps are the front page's (src/signin/SignInFlow.jsx),
 * started afresh each time the dialog opens.
 */
export default function AddAccountDialog({ open, onClose }) {
  const { authMode } = useAtprotoSession();
  return (
    <Dialog open={open} onClose={onClose} title="Add an account" className="add-account-dialog">
      <div className="dialog-form">
        <SignInFlow variant="dialog" />
        <p className="note">
          You sign in on the account’s own host, then come back here with it open. The accounts already signed in stay signed in, and each
          keeps its own archive.
          {authMode === 'backend' && ' It will be a long session, kept by Virga’s server.'}
        </p>
      </div>
    </Dialog>
  );
}
