// Where the callback sends the browser: the token in the fragment only, and a
// failure as ?error= with no token and no hash.

import { describe, expect, it } from 'vitest';
import {
  buildCodedErrorRedirectUrl,
  buildFragmentRedirectUrl,
  redirectFromAppState,
} from './callbackRedirect.js';

const PAGE = 'https://virga.example.com/oauth/return?n=nonce123';
const DEFAULT = 'https://virga.example.com/oauth/return';
const TOKEN = `vg_${'a'.repeat(64)}`;
const DID = 'did:plc:redirect000000000000000';
const allowed = (url) =>
  url.startsWith('https://virga.example.com/oauth/return');
const state = (redirect) =>
  JSON.stringify({ redirect_uri: redirect, timestamp: 1 });

describe('buildFragmentRedirectUrl', () => {
  it('puts the token and DID in the fragment and keeps the page query', () => {
    const url = buildFragmentRedirectUrl(PAGE, TOKEN, DID);
    expect(url.searchParams.get('n')).toBe('nonce123');
    expect([...url.searchParams.keys()]).toEqual(['n']);
    const fragment = new URLSearchParams(url.hash.slice(1));
    expect(fragment.get('session')).toBe(TOKEN);
    expect(fragment.get('did')).toBe(DID);
    expect(url.search).not.toContain(TOKEN);
  });
});

describe('redirectFromAppState', () => {
  it('names an allowed page only', () => {
    expect(redirectFromAppState(state(PAGE), allowed)).toBe(PAGE);
    expect(
      redirectFromAppState(state('https://evil.example/oauth/return'), allowed),
    ).toBeNull();
    expect(redirectFromAppState('not json', allowed)).toBeNull();
    expect(redirectFromAppState(undefined, allowed)).toBeNull();
    expect(redirectFromAppState(JSON.stringify({}), allowed)).toBeNull();
  });
});

describe('buildCodedErrorRedirectUrl', () => {
  it('goes back to the page with the code and description, hash cleared', () => {
    const url = buildCodedErrorRedirectUrl(
      state(`${PAGE}#leftover`),
      DEFAULT,
      { code: 'access_denied', description: 'Declined' },
      allowed,
    );
    expect(url.searchParams.get('n')).toBe('nonce123');
    expect(url.searchParams.get('error')).toBe('access_denied');
    expect(url.searchParams.get('error_description')).toBe('Declined');
    expect(url.hash).toBe('');
  });

  it('keeps the description to 300 characters and defaults the code', () => {
    const url = buildCodedErrorRedirectUrl(
      null,
      DEFAULT,
      { description: 'x'.repeat(400) },
      allowed,
    );
    expect(url.searchParams.get('error')).toBe('callback_failed');
    expect(url.searchParams.get('error_description')).toHaveLength(300);
  });

  it('uses the default page for a state it may not use, or one that is not JSON', () => {
    for (const appState of [state('https://evil.example/steal'), 'not json']) {
      const url = buildCodedErrorRedirectUrl(
        appState,
        DEFAULT,
        { code: 'callback_failed' },
        allowed,
      );
      expect(`${url.origin}${url.pathname}`).toBe(DEFAULT);
      expect(url.searchParams.get('n')).toBeNull();
    }
  });

  it('answers null with nowhere to go', () => {
    expect(
      buildCodedErrorRedirectUrl(
        null,
        null,
        { code: 'callback_failed' },
        allowed,
      ),
    ).toBeNull();
  });
});
