import { describe, expect, it } from 'vitest';
import handler from '../../api/client-metadata.js';
import { OAUTH_SCOPE } from '../config.js';
import {
  buildClientMetadata,
  buildLoopbackClientId,
  callbackErrorMessage,
  signInErrorMessage,
} from './oauthClient.js';

/** Call the serverless function the way the host would, and read its answer. */
function serve(host) {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
    json(body) {
      this.body = JSON.stringify(body);
      return this;
    },
  };
  handler({ headers: { host } }, res);
  return { status: res.statusCode, body: JSON.parse(res.body) };
}

describe('the scope a sign-in asks for', () => {
  const tokens = OAUTH_SCOPE.split(' ');

  it('is the two signed-in reads and the follow record, and nothing broader', () => {
    expect(tokens).toEqual([
      'atproto',
      'rpc:app.bsky.graph.getFollowers?aud=did:web:api.bsky.app%23bsky_appview',
      'rpc:app.bsky.notification.listNotifications?aud=did:web:api.bsky.app%23bsky_appview',
      'repo:app.bsky.graph.follow?action=create&action=delete',
    ]);
  });

  it('never asks for the transitional scopes that reach the whole account', () => {
    for (const token of tokens) expect(token).not.toMatch(/^transition:/);
    expect(tokens).not.toContain('repo:*');
  });
});

describe('buildLoopbackClientId', () => {
  it('names a 127.0.0.1 redirect even when the dev server was opened at localhost', () => {
    const id = new URL(
      buildLoopbackClientId('http://localhost:5206', '/oauth/callback'),
    );
    expect(id.origin).toBe('http://localhost');
    expect(id.searchParams.get('redirect_uri')).toBe(
      'http://127.0.0.1:5206/oauth/callback',
    );
  });

  it('declares the scope a sign-in asks for', () => {
    const id = new URL(
      buildLoopbackClientId('http://127.0.0.1:4173', '/oauth/callback'),
    );
    expect(id.searchParams.get('scope')).toBe(OAUTH_SCOPE);
  });
});

describe('the hosted client metadata', () => {
  it('is the same document the browser builds for itself', () => {
    // An authorization server fetches the served document and checks every
    // sign-in against it, so a copy that lagged behind would refuse the
    // request the browser makes.
    const served = serve('virga.example');
    expect(served.status).toBe(200);
    expect(served.body).toEqual(buildClientMetadata('https://virga.example'));
  });

  it('keeps the client id and the redirect on the origin it was asked at', () => {
    const { body } = serve('preview-abc.vercel.app');
    expect(body.client_id).toBe(
      'https://preview-abc.vercel.app/oauth-client-metadata.json',
    );
    expect(body.redirect_uris).toEqual([
      'https://preview-abc.vercel.app/oauth/callback',
    ]);
  });

  it('refuses a host header that is not a host name', () => {
    expect(serve('evil.example/path?x=1').status).toBe(400);
    expect(serve('').status).toBe(400);
  });
});

describe('signInErrorMessage', () => {
  it('turns an unresolvable handle into advice about the handle', () => {
    const err = new Error(
      'Failed to resolve identity: nobody-at-all.bsky.social',
    );
    expect(signInErrorMessage(err)).toMatch(/Couldn’t find that account/);
  });

  it('tells an unreachable server from a bad handle', () => {
    expect(signInErrorMessage(new TypeError('Failed to fetch'))).toMatch(
      /Couldn’t reach/,
    );
    expect(
      signInErrorMessage(
        new Error('Failed to resolve OAuth server metadata for issuer: x'),
      ),
    ).toMatch(/isn’t accepting sign-ins/);
  });

  it('says so when the server turned down the permissions', () => {
    expect(signInErrorMessage(new Error('invalid_scope'))).toMatch(
      /didn’t accept the permissions/,
    );
  });

  it('never shows the library’s own text for anything else', () => {
    const zod = new Error(
      '[{"code":"invalid_type","expected":"object","received":"string"}]',
    );
    expect(signInErrorMessage(zod)).toBe(
      'Sign-in couldn’t start. Check the handle and try again.',
    );
    expect(signInErrorMessage(undefined)).toBe(
      'Sign-in couldn’t start. Check the handle and try again.',
    );
  });
});

describe('callbackErrorMessage', () => {
  it('says plainly when access was declined', () => {
    const err = Object.assign(new Error('Access denied'), {
      params: new URLSearchParams({ error: 'access_denied' }),
    });
    expect(callbackErrorMessage(err)).toMatch(/Access wasn’t granted/);
  });

  it('falls back to a general sentence', () => {
    expect(
      callbackErrorMessage(new Error('Unknown authorization session "x"')),
    ).toMatch(/didn’t finish/);
    expect(callbackErrorMessage(null)).toMatch(/didn’t finish/);
  });
});
