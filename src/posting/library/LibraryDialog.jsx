import Button from '../../components/Button.jsx';
import Dialog from '../../components/Dialog.jsx';

/**
 * Pick something to quote, attach or start from: `onPick(plan, item)` with
 * a LibraryPlan (library/model.js), templates' questions already answered.
 * A placeholder until it is built.
 */
// eslint-disable-next-line no-unused-vars
export default function LibraryDialog({ open, onClose, did, context, onPick }) {
  return (
    <Dialog open={open} onClose={onClose} title="Library" actions={<Button onClick={onClose}>Close</Button>}>
      <p>Your posts, saved posts, links, feeds and lists will be here to pick from.</p>
    </Dialog>
  );
}
