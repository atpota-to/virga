import { describe, expect, it } from 'vitest';
import { OAUTH_SCOPE, POSTING_TOKENS } from '../config.js';
import { isMissingScopeError, isValidScopeToken, missingScopes, parseScopeToken } from './scopes.js';

describe('parseScopeToken', () => {
  it('reads each kind of token Virga asks for', () => {
    expect(parseScopeToken('atproto')).toEqual({ resource: 'atproto' });
    expect(parseScopeToken('repo:app.bsky.feed.post')).toEqual({ resource: 'repo', collection: 'app.bsky.feed.post', actions: ['create', 'delete', 'update'] });
    expect(parseScopeToken('repo:app.bsky.graph.follow?action=create&action=delete')).toEqual({
      resource: 'repo',
      collection: 'app.bsky.graph.follow',
      actions: ['create', 'delete'],
    });
    expect(parseScopeToken('rpc:app.bsky.actor.getPreferences?aud=did:web:api.bsky.app%23bsky_appview')).toEqual({
      resource: 'rpc',
      lxm: 'app.bsky.actor.getPreferences',
      aud: 'did:web:api.bsky.app#bsky_appview',
    });
    expect(parseScopeToken('rpc:com.atproto.repo.uploadBlob?aud=*')).toEqual({ resource: 'rpc', lxm: 'com.atproto.repo.uploadBlob', aud: '*' });
    expect(parseScopeToken('blob:image/*')).toEqual({ resource: 'blob', accept: ['image/*'] });
  });

  it('reads the parameter spelling an authorization server may hand back', () => {
    expect(parseScopeToken('repo?collection=app.bsky.feed.post&action=create')).toEqual({
      resource: 'repo',
      collection: 'app.bsky.feed.post',
      actions: ['create'],
    });
    expect(parseScopeToken('rpc?lxm=app.bsky.feed.searchPosts&aud=*')).toEqual({ resource: 'rpc', lxm: 'app.bsky.feed.searchPosts', aud: '*' });
    expect(parseScopeToken('blob?accept=image/png&accept=video/mp4')).toEqual({ resource: 'blob', accept: ['image/png', 'video/mp4'] });
  });

  it('refuses what the grammar doesn’t allow', () => {
    const bad = [
      '',
      'atproto?x=1',
      'repo:not-an-nsid',
      'repo:app.bsky.feed.post?action=edit',
      'repo:app.bsky.feed.post?collection=app.bsky.feed.like',
      'rpc:app.bsky.actor.getPreferences', // no audience
      'rpc:app.bsky.actor.getPreferences?aud=did:web:api.bsky.app', // a service is did#service
      'rpc:app.bsky.actor.getPreferences?aud=did:web:api.bsky.app#bsky_appview', // # unencoded
      'rpc:*?aud=*',
      'blob:image',
      'blob:image/*?size=1',
      'transition:everything',
      'identity:*', // not something Virga reads
      'repo:app.bsky.feed.post extra',
    ];
    for (const token of bad) expect(isValidScopeToken(token), token).toBe(false);
  });
});

describe('the tokens Virga asks for', () => {
  it('each parse under the permission grammar', () => {
    for (const token of OAUTH_SCOPE.split(' ')) expect(isValidScopeToken(token), token).toBe(true);
    for (const token of POSTING_TOKENS) expect(OAUTH_SCOPE.split(' ')).toContain(token);
  });

  it('give every service call a service audience or *, never a bare DID', () => {
    for (const token of OAUTH_SCOPE.split(' ').filter((t) => t.startsWith('rpc:'))) {
      expect(token).toMatch(/\?aud=(\*|did:[^#]+%23[a-z_]+)$/);
    }
  });
});

describe('missingScopes', () => {
  it('finds nothing missing when the grant is what was asked for, in any order', () => {
    const tokens = OAUTH_SCOPE.split(' ');
    expect(missingScopes([...tokens].reverse().join(' '), OAUTH_SCOPE)).toEqual([]);
  });

  it('lists the posting tokens a session from before posting lacks', () => {
    const old = [
      'atproto',
      'rpc:app.bsky.graph.getFollowers?aud=did:web:api.bsky.app%23bsky_appview',
      'rpc:app.bsky.notification.listNotifications?aud=did:web:api.bsky.app%23bsky_appview',
      'repo:app.bsky.graph.follow?action=create&action=delete',
    ].join(' ');
    expect(missingScopes(old, POSTING_TOKENS)).toEqual(POSTING_TOKENS);
    expect(missingScopes(old, OAUTH_SCOPE)).not.toContain('atproto');
  });

  it('counts a broader grant as covering a narrower ask', () => {
    expect(missingScopes('repo:*', ['repo:app.bsky.feed.post'])).toEqual([]);
    expect(missingScopes('repo:app.bsky.feed.post?action=create', ['repo:app.bsky.feed.post'])).toEqual(['repo:app.bsky.feed.post']);
    expect(missingScopes('blob:*/*', ['blob:image/*', 'blob:video/*'])).toEqual([]);
    expect(missingScopes('blob:image/png', ['blob:image/*'])).toEqual(['blob:image/*']);
    expect(missingScopes('rpc:app.bsky.feed.searchPosts?aud=*', ['rpc:app.bsky.feed.searchPosts?aud=did:web:api.bsky.app%23bsky_appview'])).toEqual([]);
    expect(missingScopes('transition:generic', ['repo:app.bsky.feed.post', 'blob:image/*'])).toEqual([]);
    expect(missingScopes('transition:generic', ['atproto'])).toEqual(['atproto']);
  });

  it('never reports a malformed ask as missing, and ignores a malformed grant', () => {
    expect(missingScopes('atproto', ['rpc:app.bsky.actor.getPreferences', 'atproto'])).toEqual([]);
    expect(missingScopes('repo:??? atproto', ['atproto'])).toEqual([]);
    expect(missingScopes(null, ['atproto'])).toEqual(['atproto']);
  });
});

describe('isMissingScopeError', () => {
  it('recognizes a write refused for want of a permission', () => {
    expect(isMissingScopeError({ error: 'ScopeMissingError', message: 'Missing required scope "repo:app.bsky.feed.post?action=create"' })).toBe(true);
    expect(isMissingScopeError(new Error('Missing required scope: blob:image/*'))).toBe(true);
    expect(isMissingScopeError(new Error('Record not found'))).toBe(false);
    expect(isMissingScopeError(null)).toBe(false);
  });
});
