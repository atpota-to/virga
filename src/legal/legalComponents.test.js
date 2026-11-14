// First-render checks for the legal pages and the agreement screen. The
// suite has no DOM, so these render to a string: they catch a component that
// throws, and pin the words and labels a reader depends on. Behaviour (the
// box, the button, the dialog) is checked in the harness with ?terms=ask.

import * as React from 'react';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../session/useAtprotoSession.jsx', () => ({
  useAtprotoSession: () => ({ did: 'did:plc:mira', session: null, accounts: [] }),
}));

// Without the React plugin, Vitest compiles JSX to React.createElement.
globalThis.React = React;

const { default: LegalDocument } = await import('./LegalDocument.jsx');
const { default: LegalPage } = await import('./LegalPage.jsx');
const { default: TermsGate } = await import('./TermsGate.jsx');
const { readDocument } = await import('./documents.js');
const { parseMarkdown } = await import('./markdown.js');
const { TERMS_VERSION, TERMS_EFFECTIVE_DATE, formatLegalDate } = await import('./version.js');

// React writes a few characters as entities in the markup it returns, and
// a comment between two pieces of text it joined.
const decode = (html) =>
  html
    .replace(/<!-- -->/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');

describe('a legal document on the page', () => {
  it.each(['terms', 'privacy'])('draws the whole of the %s document without tripping', (key) => {
    const doc = readDocument(key);
    const html = decode(renderToString(h(LegalDocument, { document: doc, contents: true })));
    expect(html).toContain(`<h1 id="${doc.blocks[0].id}" class="legal-h1">${doc.title}</h1>`);
    expect(html).toContain(`${formatLegalDate(TERMS_EFFECTIVE_DATE)} (version ${TERMS_VERSION})`);
    // Every section is there, with its anchor, and listed in the contents.
    const sections = doc.blocks.filter((b) => b.type === 'heading' && b.level === 2);
    for (const section of sections) {
      expect(html, section.id).toContain(`<h2 id="${section.id}" class="legal-h2">`);
      expect(html, section.id).toContain(`<a href="#${section.id}">`);
    }
    expect(html).toContain('aria-label="Contents"');
    expect(html).not.toContain('undefined');
  });

  it('sends a link between the documents to the other’s page, and one off the site to a new tab', () => {
    const terms = decode(renderToString(h(LegalDocument, { document: readDocument('terms') })));
    expect(terms).toContain('<a href="/privacy">Privacy Policy</a>');
    expect(terms).toMatch(/<a href="\/privacy#[a-z-]+">/);
    expect(terms).not.toContain('PRIVACY_POLICY.md');
    expect(terms).toContain('<a href="mailto:privacy@anisota.net" rel="noopener noreferrer">');

    const outside = parseMarkdown('See [the spec](https://atproto.com/specs/oauth).');
    expect(renderToString(h(LegalDocument, { document: outside }))).toContain('<a href="https://atproto.com/specs/oauth" target="_blank" rel="noopener noreferrer">');
  });

  it('labels every cell of a table with its column, for the narrow layout', () => {
    const html = decode(renderToString(h(LegalDocument, { document: readDocument('privacy') })));
    expect(html).toContain('role="table"');
    expect(html).toContain('<td role="cell" data-label="For how long">');
    expect(html).toContain('aria-label="Table: Feature, What is kept, For how long"');
  });

  it('leaves the title to the frame and moves the headings down a level, in a dialog', () => {
    const html = renderToString(h(LegalDocument, { document: readDocument('terms'), skipTitle: true, headingOffset: 1 }));
    expect(html).not.toContain('<h1');
    expect(html).not.toContain('<h2');
    expect(html).toContain('<h3 id="what-virga-is" class="legal-h2">');
  });

  it('draws the lists, emphasis and code a document can hold', () => {
    const doc = parseMarkdown('## A\n\n1. one\n2. **two** and *three*\n   - under, with `code`\n\n---\n\nEnd.');
    const html = renderToString(h(LegalDocument, { document: doc }));
    expect(html).toContain('<ol><li>one</li><li><strong>two</strong> and <em>three</em><ul><li>under, with <code>code</code></li></ul></li></ol>');
    expect(html).toContain('<hr/>');
  });
});

describe('the legal page', () => {
  it('is the document, with a way back and a way to the other one', () => {
    const html = decode(renderToString(h(LegalPage, { docKey: 'privacy' })));
    expect(html).toContain('<h1 id="privacy-policy" class="legal-h1">Privacy Policy</h1>');
    expect(html).toContain('aria-label="Virga, to the front page"');
    expect(html).toContain('<a href="/privacy" aria-current="page">Privacy</a>');
    expect(html).toContain('<a href="/terms">Terms</a>');
    expect(html).toContain('Back to Virga');
  });
});

describe('the agreement screen', () => {
  const props = { did: 'did:plc:mira', profile: { handle: 'mira.example.com', displayName: 'Mira Okafor', avatar: null }, mode: 'backend', onAccept: async () => {}, onSignOut: async () => {} };
  const draw = (extra = {}) => decode(renderToString(h(TermsGate, { ...props, ...extra })));

  it('says who is signed in, names both documents, and offers the two ways on', () => {
    const html = draw();
    expect(html).toContain('Before you start');
    expect(html).toContain('Mira Okafor');
    expect(html).toContain('@mira.example.com');
    expect(html).toMatch(/<button type="button" class="signin-link terms-doc-link">Terms of Service<\/button>/);
    expect(html).toMatch(/<button type="button" class="signin-link terms-doc-link">Privacy Policy<\/button>/);
    expect(html).toContain('Agree and continue');
    expect(html).toContain('Sign out');
  });

  it('starts with the box empty, named in full for a screen reader', () => {
    const html = draw();
    expect(html).toContain('aria-label="I’ve read the Terms of Service and the Privacy Policy, and I agree to them"');
    expect(html).toContain('I’ve read both, and I agree to them.');
    expect(html).not.toMatch(/checked=""/);
    // The button isn't greyed out: pressed early, it says what is missing.
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Agree and continue/);
  });

  it('says what is recorded, for the kind of session it is', () => {
    expect(draw()).toContain('Virga’s server keeps a record that this account agreed, and when');
    expect(draw({ mode: 'browser' })).toContain('Virga notes in this browser that this account agreed, and reports it to its server');
  });

  it('holds the account’s place until it has a name to show', () => {
    const html = draw({ profile: null });
    expect(html).toContain('signin-identity--bones');
    expect(html).not.toContain('did:plc:mira');
  });
});
