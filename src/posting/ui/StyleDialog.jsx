import Button from '../../components/Button.jsx';
import Dialog from '../../components/Dialog.jsx';

/** The adviser's read of how this account writes. A placeholder until it is built. */
// eslint-disable-next-line no-unused-vars
export default function StyleDialog({ open = false, onClose, did }) {
  return (
    <Dialog open={open} onClose={onClose} title="Your writing style" actions={<Button onClick={onClose}>Close</Button>}>
      <p>Not ready yet.</p>
    </Dialog>
  );
}
