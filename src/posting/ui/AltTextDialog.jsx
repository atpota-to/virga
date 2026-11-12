import { useId, useState } from 'react';
import Button from '../../components/Button.jsx';
import Dialog from '../../components/Dialog.jsx';

/**
 * Describe an image for people who can't see it. `requester` is the posting
 * account's server requester; without one there's no Generate button. A
 * placeholder with a plain text field until it is built.
 */
// eslint-disable-next-line no-unused-vars
export default function AltTextDialog({ open, onClose, image, onSave, did, requester }) {
  const id = useId();
  const [alt, setAlt] = useState(image?.alt || '');
  const [seen, setSeen] = useState(image);
  if (seen !== image) {
    setSeen(image);
    setAlt(image?.alt || '');
  }
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Alt text"
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              onSave?.(alt);
              onClose?.();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      {image?.previewUrl && <img className="alt-text-preview" src={image.previewUrl} alt="" />}
      <label className="field" htmlFor={id}>
        <span className="field-label">What’s in the image</span>
        <textarea id={id} className="input textarea" rows={4} value={alt} onChange={(e) => setAlt(e.target.value)} data-autofocus />
      </label>
    </Dialog>
  );
}
