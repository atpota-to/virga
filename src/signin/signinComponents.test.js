// First-render checks for the sign-in's components. The suite has no DOM, so
// these render to a string: they catch a component that throws, and pin the
// labels a reader depends on. The steps themselves are flow.test.js's, and
// the whole of it is walked through in the harness with ?signedout.

import * as React from 'react';
import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const session = vi.hoisted(() => ({
  value: {
    signIn: async () => {},
    switchAccount: async () => {},
    removeAccount: async () => {},
    accounts: [],
    authMode: 'backend',
  },
}));
vi.mock('../session/useAtprotoSession.jsx', () => ({ useAtprotoSession: () => session.value }));

// Without the React plugin, Vitest compiles JSX to React.createElement.
globalThis.React = React;

const { default: SignInFlow } = await import('./SignInFlow.jsx');
const { default: HandleField } = await import('./HandleField.jsx');
const { IdentityBones, IdentityRow } = await import('./parts.jsx');

// React's own marks taken out: entities, and the comment between joined text.
const decode = (html) =>
  html
    .replace(/<!-- -->/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
const REMEMBERED = [
  { did: 'did:plc:mira', handle: 'mira.example.com', displayName: 'Mira Okafor', avatar: null, mode: 'backend', lastUsed: Date.now(), status: 'ready' },
  { did: 'did:plc:lab', handle: 'lab.example.org', displayName: null, avatar: null, mode: 'backend', lastUsed: null, status: 'needsSignIn' },
];

describe('the sign-in, as it first appears', () => {
  it('is one labelled field, a button that is never greyed out, and the two ways aside', () => {
    session.value.accounts = [];
    const html = decode(renderToString(h(SignInFlow, { variant: 'page', remembered: true })));
    expect(html).toMatch(/<label class="field-label" for="[^"]+">Your handle<\/label>/);
    expect(html).toContain('placeholder="you.bsky.social"');
    expect(html).toMatch(/<button type="submit" class="btn btn--primary btn--lg">Sign in<\/button>/);
    expect(html).toContain('Make an account');
    expect(html).toContain('How signing in works');
    expect(html).not.toContain('Continue as');
    expect(html).toContain('data-step="entry"');
  });

  it('lists the accounts this browser remembers above the field', () => {
    session.value.accounts = REMEMBERED;
    const html = decode(renderToString(h(SignInFlow, { variant: 'page', remembered: true })));
    expect(html).toContain('Continue as');
    expect(html).toContain('aria-label="Continue as Mira Okafor"');
    expect(html).toContain('aria-label="Continue as @lab.example.org"');
    expect(html).toContain('aria-label="Forget Mira Okafor on this browser"');
    expect(html).toContain('Or sign in with another handle');
    session.value.accounts = [];
  });

  it('leaves the remembered accounts out of Add an account, and focuses the field there', () => {
    session.value.accounts = REMEMBERED;
    const html = decode(renderToString(h(SignInFlow, { variant: 'dialog' })));
    expect(html).not.toContain('Continue as');
    expect(html).toMatch(/<label class="field-label" for="[^"]+">Handle<\/label>/);
    expect(html).toContain('data-autofocus="true"');
    expect(html).toMatch(/<button type="submit" class="btn btn--primary">Sign in<\/button>/);
    session.value.accounts = [];
  });

  it('says so when a post is waiting on the sign-in', () => {
    const html = decode(renderToString(h(SignInFlow, { variant: 'page', composing: true })));
    expect(html).toContain('Sign in to finish your post.');
  });
});

describe('the handle field', () => {
  const draw = (extra = {}) => decode(renderToString(h(HandleField, { id: 'h', value: '', onChange: () => {}, ...extra })));

  it('is a combobox whose list is closed until there is something to suggest', () => {
    const html = draw();
    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-autocomplete="list"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('role="listbox"');
    expect(html).not.toContain('aria-controls');
  });

  it('keeps a handle from being corrected, capitalised or spell-checked', () => {
    const html = draw();
    for (const attribute of ['autoComplete="username"', 'autoCorrect="off"', 'autoCapitalize="none"', 'spellCheck="false"', 'inputMode="url"', 'enterKeyHint="go"', 'name="handle"']) {
      expect(html.toLowerCase(), attribute).toContain(attribute.toLowerCase());
    }
  });

  it('marks itself and points at the notice when the handle is the trouble', () => {
    const html = draw({ invalid: true, describedBy: 'notice-1', value: 'nobody.example.com' });
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('aria-describedby="notice-1"');
    expect(html).toContain('value="nobody.example.com"');
  });
});

describe('an account in the sign-in', () => {
  it('shows the name, then the handle', () => {
    const html = decode(renderToString(h(IdentityRow, { identity: { did: 'did:plc:mira', handle: 'mira.example.com', displayName: 'Mira Okafor', avatar: null } })));
    expect(html).toContain('<span class="signin-identity-name">Mira Okafor</span>');
    expect(html).toContain('<span class="signin-identity-meta">@mira.example.com</span>');
  });

  it('never shows the same thing twice, or an empty line', () => {
    const html = decode(renderToString(h(IdentityRow, { identity: { did: 'did:plc:bare', handle: null, displayName: null, avatar: null } })));
    expect(html.match(/did:plc:bare/g)).toHaveLength(1);
    expect(html).not.toContain('signin-identity-meta');
  });

  it('has bones the reader isn’t told about', () => {
    expect(renderToString(h(IdentityBones))).toContain('aria-hidden="true"');
  });
});
