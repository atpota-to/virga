// The one scope string the client asks for and declares (OAUTH_SCOPE in
// src/config.js).
//
// The authorization server drops a token it can't parse and grants the rest,
// so a typo is not an error at sign-in: it is a button that later fails with
// `Missing required scope`. Each token is read under the permission grammar
// (testing/permissionScope.js), and the scope is held to its rules: granular
// tokens only, every rpc audience a wildcard or a DID with a service
// fragment, and what login requests is what the metadata declares.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OAUTH_SCOPE } from '../../src/config.js';
import { SCOPE, clientMetadata } from './config.js';
import { parsePermission } from './testing/permissionScope.js';
import { installOAuthEnv } from './testing/env.js';

const tokens = (scope) => scope.split(/\s+/).filter(Boolean);

let env;
beforeAll(async () => {
  env = await installOAuthEnv();
});
afterAll(() => env.restore());

describe('the permission grammar reader', () => {
  it.each([
    'atproto',
    'repo:app.bsky.feed.post',
    'repo:app.bsky.graph.follow?action=create&action=delete',
    'rpc:app.bsky.feed.getTimeline?aud=did:web:api.bsky.app%23bsky_appview',
    'rpc:com.atproto.repo.uploadBlob?aud=*',
    'blob:image/*',
    'blob:*/*',
    'include:app.bsky.authFullApp?aud=did:web:api.bsky.app%23bsky_appview',
  ])('accepts %s', (token) => {
    expect(() => parsePermission(token)).not.toThrow();
  });

  it.each([
    'repo:not an nsid',
    'repo:app.bsky.feed.post?action=edit',
    'rpc:app.bsky.feed.getTimeline',
    'rpc:app.bsky.feed.getTimeline?aud=did:web:api.bsky.app',
    'rpc:app.bsky.feed.getTimeline?aud=did:web:api.bsky.app#bsky_appview',
    'rpc:*?aud=*',
    'blob:image',
    'chat:anything',
  ])('refuses %s', (token) => {
    expect(() => parsePermission(token)).toThrow();
  });
});

describe('the scope', () => {
  const list = tokens(SCOPE);

  it('is the app scope, token for token', () => {
    expect(SCOPE).toBe(OAUTH_SCOPE);
    expect(list).toHaveLength(20);
  });

  it('parses, token by token', () => {
    for (const token of list)
      expect(() => parsePermission(token), token).not.toThrow();
  });

  it('starts with atproto and lists each token once', () => {
    expect(list[0]).toBe('atproto');
    expect([...new Set(list)]).toEqual(list);
  });

  it('is granular only', () => {
    for (const token of list) {
      expect(token.startsWith('transition:'), token).toBe(false);
      expect(token.startsWith('include:'), token).toBe(false);
      expect(token, token).not.toMatch(/^repo:\*/);
      expect(token, token).not.toBe('blob:*/*');
    }
  });

  it('gives every rpc a wildcard audience or a DID with a service fragment', () => {
    for (const token of list.filter((t) => t.startsWith('rpc:'))) {
      const { params } = parsePermission(token);
      const aud = params.aud[0];
      if (aud === '*') continue;
      expect(aud, token).toMatch(/^did:web:[^#]+#[a-z_]+$/);
      expect(token, token).toContain('%23');
    }
  });

  it('grants what posting and scheduling need', () => {
    for (const token of [
      'repo:app.bsky.feed.post',
      'repo:app.bsky.feed.threadgate',
      'repo:app.bsky.feed.postgate',
      'repo:net.anisota.feed.template',
      'blob:image/*',
      'blob:video/*',
      'rpc:com.atproto.repo.uploadBlob?aud=*',
      'rpc:app.bsky.video.getUploadLimits?aud=*',
      'rpc:app.bsky.video.getJobStatus?aud=*',
    ]) {
      expect(list, token).toContain(token);
    }
    // Bare repo:<nsid> is create, update and delete: the scheduler publishes
    // with putRecord.
    expect(
      parsePermission('repo:app.bsky.feed.post').params.action,
    ).toBeUndefined();
    for (const method of [
      'getDrafts',
      'createDraft',
      'updateDraft',
      'deleteDraft',
    ]) {
      expect(list).toContain(
        `rpc:app.bsky.draft.${method}?aud=did:web:api.bsky.app%23bsky_appview`,
      );
    }
  });

  it('is exactly what the metadata declares, so declared ⊇ requested', () => {
    const declared = new Set(tokens(clientMetadata().scope));
    for (const token of list) expect(declared.has(token), token).toBe(true);
    expect(clientMetadata().scope).toBe(SCOPE);
  });
});
