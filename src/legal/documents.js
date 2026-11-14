// Virga's two legal documents, as the site shows them. The text is the
// Markdown at the repo's root (TERMS_OF_SERVICE.md, PRIVACY_POLICY.md),
// brought in whole at build time and read by markdown.js, so the pages and
// the files are one piece of writing. documents.test.js holds them to what
// the reader understands, to the date in version.js, and to a fingerprint
// that makes an edit decide whether TERMS_VERSION goes up.

import privacySource from '../../PRIVACY_POLICY.md?raw';
import termsSource from '../../TERMS_OF_SERVICE.md?raw';
import { parseMarkdown } from './markdown.js';
import { PRIVACY_PATH, TERMS_PATH } from './version.js';

export const DOCUMENTS = Object.freeze({
  terms: Object.freeze({ key: 'terms', title: 'Terms of Service', short: 'Terms', path: TERMS_PATH, file: 'TERMS_OF_SERVICE.md', source: termsSource }),
  privacy: Object.freeze({ key: 'privacy', title: 'Privacy Policy', short: 'Privacy', path: PRIVACY_PATH, file: 'PRIVACY_POLICY.md', source: privacySource }),
});

/** Which document an address is, or null: '/terms' → 'terms'. A trailing slash is the same page. */
export function documentFor(path) {
  const clean = String(path || '').replace(/\/+$/, '') || '/';
  const found = Object.values(DOCUMENTS).find((doc) => doc.path === clean);
  return found ? found.key : null;
}

const parsed = new Map();

/** A document read into blocks: `{ key, title, path, blocks, problems }`. Read once. */
export function readDocument(key) {
  const doc = DOCUMENTS[key];
  if (!doc) return null;
  if (!parsed.has(key)) {
    const { blocks, problems } = parseMarkdown(doc.source);
    parsed.set(key, { key, title: doc.title, path: doc.path, blocks, problems });
  }
  return parsed.get(key);
}

/**
 * Where a link in a document goes on the site. The documents name each other
 * by file (so the links work where the Markdown is read as a file too); here
 * a file becomes its page.
 *
 *   { href, document }  document is the key of the document it opens, or
 *                       null for a link that leaves the documents
 *   { external: true }  for an address on another site, or a mailto
 */
export function resolveDocumentLink(href) {
  const value = String(href || '');
  const file = /^([A-Z][A-Z_]*\.md)(#[\w-]+)?$/.exec(value);
  if (file) {
    const doc = Object.values(DOCUMENTS).find((d) => d.file === file[1]);
    if (doc) return { href: `${doc.path}${file[2] || ''}`, document: doc.key, external: false };
    return { href: null, document: null, external: false };
  }
  if (value.startsWith('#')) return { href: value, document: null, external: false, anchor: true };
  const path = value.split('#')[0];
  const own = documentFor(path);
  if (own) return { href: value, document: own, external: false };
  return { href: value, document: null, external: /^(https:|mailto:)/i.test(value) };
}
