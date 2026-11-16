import { useEffect } from 'react';
import { APP_NAME } from '../config.js';
import { Link } from '../lib/router.jsx';
import { LogoMark } from '../shell/bits.jsx';
import { DOCUMENTS, readDocument } from './documents.js';
import LegalDocument from './LegalDocument.jsx';
import './legal.css';

/**
 * A legal document as a page of its own (/terms, /privacy). It stands
 * outside the app and outside the sign-in, so it reads the same signed in,
 * signed out, or while the agreement screen is waiting, and never waits on a
 * session to open.
 */
export default function LegalPage({ docKey }) {
  const doc = readDocument(docKey);

  useEffect(() => {
    const before = document.title;
    document.title = `${doc.title} · ${APP_NAME}`;
    return () => {
      document.title = before;
    };
  }, [doc.title]);

  // A link to a section (/privacy#what-virgas-server-keeps) arrives before
  // the section is drawn, so the browser has nowhere to scroll to by itself.
  useEffect(() => {
    const raw = window.location.hash.slice(1);
    let id = raw;
    try {
      id = decodeURIComponent(raw);
    } catch {
      // Not valid percent-encoding (a link cut short): take it as written.
    }
    if (id) document.getElementById(id)?.scrollIntoView();
  }, [docKey]);

  return (
    <div className="landing legal">
      <header className="landing-bar">
        <Link to="/" className="brand" aria-label={`${APP_NAME}, to the front page`}>
          <LogoMark />
          <span className="brand-name">{APP_NAME}</span>
        </Link>
        <nav className="legal-nav" aria-label="Legal documents">
          {Object.values(DOCUMENTS).map((entry) => (
            <Link key={entry.key} to={entry.path} aria-current={entry.key === docKey ? 'page' : undefined}>
              {entry.short}
            </Link>
          ))}
        </nav>
      </header>
      <main className="legal-main">
        <article className="legal-doc">
          <LegalDocument document={doc} contents />
        </article>
      </main>
      <footer className="landing-foot">
        <Link to="/">Back to {APP_NAME}</Link>
        <nav className="landing-foot-links" aria-label="Legal">
          {Object.values(DOCUMENTS).map((entry) => (
            <Link key={entry.key} to={entry.path}>
              {entry.title}
            </Link>
          ))}
        </nav>
      </footer>
    </div>
  );
}
