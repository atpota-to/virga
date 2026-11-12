import Button from '../../components/Button.jsx';
import Dialog from '../../components/Dialog.jsx';

/**
 * Make or change a template. `seed` is `{ text, embed }` for "Save this as a
 * template". A placeholder until it is built.
 */
// eslint-disable-next-line no-unused-vars
export default function TemplateEditor({ open, onClose, did, template, seed }) {
  return (
    <Dialog open={open} onClose={onClose} title={template ? 'Edit the template' : 'New template'} actions={<Button onClick={onClose}>Close</Button>}>
      <p>Templates are saved in your repo, where anyone can read them.</p>
    </Dialog>
  );
}
