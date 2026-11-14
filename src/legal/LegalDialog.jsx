import { useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import Dialog from '../components/Dialog.jsx';
import { DOCUMENTS, readDocument } from './documents.js';
import LegalDocument from './LegalDocument.jsx';
import './legal.css';

/**
 * A legal document in a dialog, for reading without leaving the screen that
 * asks about it. `docKey` is 'terms', 'privacy' or null (closed). A link from
 * one document to the other changes which is shown, in place, and goes to
 * the section it names.
 */
export default function LegalDialog({ docKey, onClose }) {
  const [shown, setShown] = useState({ key: docKey, anchor: null });
  const body = useRef(null);
  useEffect(() => {
    if (docKey) setShown({ key: docKey, anchor: null });
  }, [docKey]);
  // The other document starts at its top, or at the section the link named.
  // The link that was pressed has gone with the document it was in, so
  // focus goes to the new one, which is named for whoever can't see the
  // title change.
  const swapped = useRef(false);
  useEffect(() => {
    const scroller = body.current?.closest('.dialog-body');
    if (!scroller) return;
    if (swapped.current) body.current.focus({ preventScroll: true });
    swapped.current = false;
    const section = shown.anchor ? [...scroller.querySelectorAll('[id]')].find((el) => el.id === shown.anchor) : null;
    if (section) section.scrollIntoView();
    else scroller.scrollTo?.(0, 0);
  }, [shown]);

  const key = shown.key || 'terms';
  const doc = readDocument(key);
  return (
    <Dialog open={Boolean(docKey)} onClose={onClose} title={doc.title} className="legal-dialog">
      <div ref={body} className="legal-doc legal-doc--dialog" role="group" aria-label={doc.title} tabIndex={-1}>
        <p className="legal-dialog-links">
          <a href={DOCUMENTS[key].path} target="_blank" rel="noopener noreferrer">
            Open as a page
            <ExternalLink size={13} aria-hidden="true" />
          </a>
        </p>
        <LegalDocument
          document={doc}
          skipTitle
          headingOffset={1}
          onOpenDocument={(next, anchor) => {
            swapped.current = true;
            setShown({ key: next, anchor });
          }}
        />
      </div>
    </Dialog>
  );
}
