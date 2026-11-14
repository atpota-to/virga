import { useEffect, useRef, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import Dialog from '../components/Dialog.jsx';
import { DOCUMENTS, readDocument } from './documents.js';
import LegalDocument from './LegalDocument.jsx';
import './legal.css';

/**
 * A legal document in a dialog, for reading without leaving the screen that
 * asks about it. `docKey` is 'terms', 'privacy' or null (closed). A link from
 * one document to the other changes which is shown, in place.
 */
export default function LegalDialog({ docKey, onClose }) {
  const [shown, setShown] = useState(docKey);
  const body = useRef(null);
  useEffect(() => {
    if (docKey) setShown(docKey);
  }, [docKey]);
  // The other document starts at its top.
  useEffect(() => {
    body.current?.closest('.dialog-body')?.scrollTo?.(0, 0);
  }, [shown]);

  const key = shown || 'terms';
  const doc = readDocument(key);
  return (
    <Dialog open={Boolean(docKey)} onClose={onClose} title={doc.title} className="legal-dialog">
      <div ref={body} className="legal-doc legal-doc--dialog">
        <p className="legal-dialog-links">
          <a href={DOCUMENTS[key].path} target="_blank" rel="noopener noreferrer">
            Open as a page
            <ExternalLink size={13} aria-hidden="true" />
          </a>
        </p>
        <LegalDocument document={doc} skipTitle headingOffset={1} onOpenDocument={setShown} />
      </div>
    </Dialog>
  );
}
