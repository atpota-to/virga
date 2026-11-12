import Button from '../../components/Button.jsx';
import Dialog from '../../components/Dialog.jsx';

/**
 * What the adviser made of a post, with fixes to apply, and the way past it.
 * A placeholder until it is built.
 */
// eslint-disable-next-line no-unused-vars
export default function AdviserSheet({ open, onClose, read, state, onApplyFix, onPublishAnyway, onKeepEditing, busy }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Before this goes out"
      actions={
        <>
          {onKeepEditing && <Button onClick={onKeepEditing}>Keep editing</Button>}
          {onPublishAnyway && (
            <Button variant="primary" onClick={onPublishAnyway}>
              Publish anyway
            </Button>
          )}
        </>
      }
    >
      <p>{busy ? 'Reading the post…' : 'The adviser has nothing to say yet.'}</p>
    </Dialog>
  );
}
