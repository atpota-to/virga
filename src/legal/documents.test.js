// The two legal documents, held to four things: the site's reader
// understands all of both; they carry the date and version the gate and the
// ledger use; they link only to places that exist; and a change to either
// makes someone decide whether everyone has to agree again.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DOCUMENTS, documentFor, readDocument, resolveDocumentLink } from './documents.js';
import { inlineText, outlineOf } from './markdown.js';
import { PRIVACY_PATH, TERMS_EFFECTIVE_DATE, TERMS_PATH, TERMS_VERSION, formatLegalDate } from './version.js';

// The documents as they were when TERMS_VERSION was last decided. When this
// fails, the text has changed. If the change is one people should agree to
// again, raise TERMS_VERSION (and TERMS_EFFECTIVE_DATE, and the dates in the
// documents); if it is a typo or a clarification, leave the version alone.
// Either way, put the new fingerprint here.
const FINGERPRINTS = {
  version: 1,
  terms: '2669f3e5de8fa40ce4c1a416f373cbe194b9a862fd6e784f646a36d71c969a0b',
  privacy: '2f62aea65d052214763e41c27d68ebd3b8e5b5bef25ce2c984e066fd7f227238',
};

const fingerprint = (text) => createHash('sha256').update(text).digest('hex');
const keys = Object.keys(DOCUMENTS);

/** Every link in a document: `{ href, text }`. */
function linksOf(blocks) {
  const found = [];
  const walk = (nodes) => {
    for (const node of nodes || []) {
      if (node.type === 'link') found.push({ href: node.href, text: inlineText(node.children) });
      if (node.children) walk(node.children);
    }
  };
  const list = (block) => {
    for (const item of block.items) {
      walk(item.children);
      if (item.sub) list(item.sub);
    }
  };
  for (const block of blocks) {
    if (block.type === 'list') list(block);
    else if (block.type === 'table') [block.head, ...block.rows].forEach((row) => row.forEach(walk));
    else walk(block.children);
  }
  return found;
}

/** All the words of a document, as the page draws them. */
function wordsOf(blocks) {
  const out = [];
  const list = (block) => {
    for (const item of block.items) {
      out.push(inlineText(item.children));
      if (item.sub) list(item.sub);
    }
  };
  for (const block of blocks) {
    if (block.type === 'list') list(block);
    else if (block.type === 'table') [block.head, ...block.rows].forEach((row) => row.forEach((cell) => out.push(inlineText(cell))));
    else if (block.children) out.push(inlineText(block.children));
  }
  return out.join('\n');
}

describe('the version', () => {
  it('writes its date the way the documents do', () => {
    expect(formatLegalDate('2026-11-14')).toBe('November 14, 2026');
    expect(formatLegalDate('2027-01-05')).toBe('January 5, 2027');
    for (const bad of ['', '14/11/2026', '2026-13-01', '2026-00-10', '2026-02-00', 'November 14, 2026', null]) expect(formatLegalDate(bad), String(bad)).toBeNull();
  });

  it('is a whole number above zero, with a real date', () => {
    expect(Number.isInteger(TERMS_VERSION) && TERMS_VERSION > 0).toBe(true);
    expect(formatLegalDate(TERMS_EFFECTIVE_DATE)).not.toBeNull();
  });
});

describe('where the documents are', () => {
  it('each have a page', () => {
    expect(documentFor(TERMS_PATH)).toBe('terms');
    expect(documentFor(PRIVACY_PATH)).toBe('privacy');
    expect(documentFor('/terms/')).toBe('terms');
  });

  it('are no other page', () => {
    for (const path of ['/', '/terms/more', '/termsandconditions', '/settings/terms', '/privacy-policy', '', null]) expect(documentFor(path), String(path)).toBeNull();
  });

  it('turn a link to a document’s file into its page', () => {
    expect(resolveDocumentLink('PRIVACY_POLICY.md')).toMatchObject({ href: '/privacy', document: 'privacy', external: false });
    expect(resolveDocumentLink('TERMS_OF_SERVICE.md#disputes')).toMatchObject({ href: '/terms#disputes', document: 'terms' });
    expect(resolveDocumentLink('README.md')).toMatchObject({ href: null });
    expect(resolveDocumentLink('#contact')).toMatchObject({ href: '#contact', anchor: true });
    expect(resolveDocumentLink('/privacy#contact')).toMatchObject({ href: '/privacy#contact', document: 'privacy' });
    expect(resolveDocumentLink('/settings/account')).toMatchObject({ href: '/settings/account', document: null, external: false });
    expect(resolveDocumentLink('https://atproto.com')).toMatchObject({ external: true });
    expect(resolveDocumentLink('mailto:someone@example.com')).toMatchObject({ external: true });
  });
});

describe.each(keys)('the %s document', (key) => {
  const doc = readDocument(key);
  const source = DOCUMENTS[key].source;

  it('is written only in what the page can draw', () => {
    expect(doc.problems).toEqual([]);
  });

  it('opens with its title, and nothing else is a first-level heading', () => {
    const headings = doc.blocks.filter((b) => b.type === 'heading');
    expect(doc.blocks[0]).toMatchObject({ type: 'heading', level: 1 });
    expect(inlineText(doc.blocks[0].children)).toBe(DOCUMENTS[key].title);
    expect(headings.filter((h) => h.level === 1)).toHaveLength(1);
  });

  it('carries the date and version the gate and the ledger use', () => {
    const line = `**Last updated:** ${formatLegalDate(TERMS_EFFECTIVE_DATE)} (version ${TERMS_VERSION})`;
    expect(source.split('\n')).toContain(line);
    // Second thing on the page, straight under the title.
    expect(inlineText(doc.blocks[1].children)).toBe(`Last updated: ${formatLegalDate(TERMS_EFFECTIVE_DATE)} (version ${TERMS_VERSION})`);
  });

  it('has sections to list, each with an anchor of its own', () => {
    const outline = outlineOf(doc.blocks);
    expect(outline.length).toBeGreaterThan(5);
    expect(new Set(outline.map((entry) => entry.id)).size).toBe(outline.length);
    expect(outline.map((entry) => entry.id)).toContain('contact');
  });

  it('links only to sections and pages that exist', () => {
    const anchorsIn = (which) => new Set(readDocument(which).blocks.filter((b) => b.type === 'heading').map((b) => b.id));
    for (const { href, text } of linksOf(doc.blocks)) {
      const target = resolveDocumentLink(href);
      expect(target.href, `${text} → ${href}`).toBeTruthy();
      const [, hash] = String(target.href).split('#');
      if (target.anchor) expect(anchorsIn(key).has(hash), `${text} → ${href}`).toBe(true);
      else if (target.document && hash) expect(anchorsIn(target.document).has(hash), `${text} → ${href}`).toBe(true);
      else if (!target.document) expect(target.external, `${text} → ${href}`).toBe(true);
    }
  });

  it('names who operates Virga and how to reach them', () => {
    const words = wordsOf(doc.blocks);
    expect(words).toContain('atpotato, LLC');
    expect(linksOf(doc.blocks).some((link) => link.href.startsWith('mailto:'))).toBe(true);
  });

  it('leaves no markup showing', () => {
    const words = wordsOf(doc.blocks);
    for (const stray of ['**', '](', '`', '<br', '|']) expect(words.includes(stray), stray).toBe(false);
  });

  it('has not changed since the version was last decided', () => {
    expect(FINGERPRINTS.version).toBe(TERMS_VERSION);
    expect(fingerprint(source)).toBe(FINGERPRINTS[key]);
  });
});

describe('the two documents together', () => {
  it('point at each other', () => {
    const to = (key) => linksOf(readDocument(key).blocks).map((link) => resolveDocumentLink(link.href).document);
    expect(to('terms')).toContain('privacy');
    expect(to('privacy')).toContain('terms');
  });
});
