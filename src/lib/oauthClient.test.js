import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import handler from '../../api/client-metadata.js';
import { AUTH_MODE, COCOON_URL, OAUTH_SCOPE, PERMISSION_GROUPS } from '../config.js';
import { isValidScopeToken } from '../session/scopes.js';
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

  it('is the signed-in reads, follows, posting and its media, drafts and templates, and nothing broader', () => {
    const appview = 'did:web:api.bsky.app%23bsky_appview';
    expect(tokens).toEqual([
      'atproto',
      `rpc:app.bsky.graph.getFollowers?aud=${appview}`,
      `rpc:app.bsky.notification.listNotifications?aud=${appview}`,
      'repo:app.bsky.graph.follow?action=create&action=delete',
      'repo:app.bsky.feed.post',
      'repo:app.bsky.feed.threadgate',
      'repo:app.bsky.feed.postgate',
      'repo:net.anisota.feed.template',
      'blob:image/*',
      'blob:video/*',
      `rpc:app.bsky.draft.getDrafts?aud=${appview}`,
      `rpc:app.bsky.draft.createDraft?aud=${appview}`,
      `rpc:app.bsky.draft.updateDraft?aud=${appview}`,
      `rpc:app.bsky.draft.deleteDraft?aud=${appview}`,
      `rpc:app.bsky.actor.getPreferences?aud=${appview}`,
      `rpc:app.bsky.bookmark.getBookmarks?aud=${appview}`,
      `rpc:app.bsky.feed.searchPosts?aud=${appview}`,
      'rpc:com.atproto.repo.uploadBlob?aud=*',
      'rpc:app.bsky.video.getUploadLimits?aud=*',
      'rpc:app.bsky.video.getJobStatus?aud=*',
    ]);
  });

  it('never asks for the transitional scopes that reach the whole account', () => {
    for (const token of tokens) expect(token).not.toMatch(/^transition:/);
    expect(tokens).not.toContain('repo:*');
    for (const token of tokens) expect(token).not.toMatch(/^(repo|rpc|blob):\*/);
  });

  it('writes every token in the permission grammar', () => {
    // Read 2026-11-12 from https://atproto.com/specs/permission.
    for (const token of tokens) expect(isValidScopeToken(token), token).toBe(true);
  });

  it('asks once for each token', () => {
    expect(new Set(tokens).size).toBe(tokens.length);
  });

  it('explains every token it asks for, once', () => {
    // Settings › Permissions is written from PERMISSION_GROUPS.
    const explained = PERMISSION_GROUPS.flatMap((g) => g.tokens);
    expect([...explained].sort()).toEqual([...tokens].sort());
    for (const group of PERMISSION_GROUPS) {
      expect(group.title).toMatch(/\S/);
      expect(group.text).toMatch(/\S/);
    }
  });
});

describe('the build flags', () => {
  it('sign new accounts in through the browser unless told otherwise', () => {
    expect(['browser', 'backend']).toContain(AUTH_MODE);
    expect(COCOON_URL).toMatch(/^https?:\/\/[^/]+$/);
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

  it('words the errors Virga’s server answers a sign-in with', () => {
    const coded = (code, status = 400) => Object.assign(new Error('x'), { code, status });
    expect(signInErrorMessage(coded('HANDLE_NOT_FOUND'))).toMatch(/Couldn’t find that account/);
    expect(signInErrorMessage(coded('AUTHORIZE_FAILED', 502))).toMatch(/isn’t accepting sign-ins/);
    expect(signInErrorMessage(coded('VIRGA_CLIENT_UNAVAILABLE', 503))).toMatch(/Virga’s server isn’t taking sign-ins/);
    expect(signInErrorMessage(Object.assign(new TypeError('Failed to fetch'), { code: 'NETWORK_ERROR' }))).toMatch(/Couldn’t reach Virga’s server/);
    expect(signInErrorMessage(new Error('Invalid redirect_uri. Must be an allowed frontend URL.'))).toMatch(/doesn’t take sign-ins from this address/);
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

  it('words the returns from Virga’s server', () => {
    const back = (error) => Object.assign(new Error(error), { params: new URLSearchParams({ error }) });
    expect(callbackErrorMessage(back('unexpected_return'))).toMatch(/wasn’t started from this tab/);
    expect(callbackErrorMessage(back('invalid_scope'))).toMatch(/didn’t accept the permissions/);
    expect(callbackErrorMessage(back('VIRGA_CLIENT_UNAVAILABLE'))).toMatch(/isn’t taking sign-ins/);
    expect(callbackErrorMessage(back('callback_failed'))).toMatch(/didn’t finish/);
  });

  it('falls back to a general sentence', () => {
    expect(
      callbackErrorMessage(new Error('Unknown authorization session "x"')),
    ).toMatch(/didn’t finish/);
    expect(callbackErrorMessage(null)).toMatch(/didn’t finish/);
  });
});

describe('the deployment’s rewrites', () => {
  const { rewrites } = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));

  it('passes /backend to Virga’s server, ahead of the app’s catch-all', () => {
    const backend = rewrites.findIndex((r) => r.source === '/backend/:path*');
    const catchAll = rewrites.findIndex((r) => r.destination === '/index.html');
    expect(backend).toBeGreaterThanOrEqual(0);
    expect(rewrites[backend].destination).toBe('https://cocoon.anisota.net/virga/:path*');
    expect(backend).toBeLessThan(catchAll);
    // The authorization server reads the long-session client's metadata and
    // keys from /backend for as long as any session lasts.
    expect(new RegExp(`^${rewrites[catchAll].source}$`).test('/backend/jwks.json')).toBe(false);
    expect(new RegExp(`^${rewrites[catchAll].source}$`).test('/settings/account')).toBe(true);
  });
});
