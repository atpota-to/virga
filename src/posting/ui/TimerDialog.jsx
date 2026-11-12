import Button from '../../components/Button.jsx';
import Dialog from '../../components/Dialog.jsx';

/**
 * Put a post that's already out on a timer. `post` is
 * `{ uri, cid, extraUris?, text, postedAt }`. A placeholder until it is built.
 */
// eslint-disable-next-line no-unused-vars
export default function TimerDialog({ open, onClose, did, post, onArmed }) {
  return (
    <Dialog open={open} onClose={onClose} title="Put this post on a timer" actions={<Button onClick={onClose}>Close</Button>}>
      <p>Timers for posts that are already out aren’t ready yet.</p>
    </Dialog>
  );
}
