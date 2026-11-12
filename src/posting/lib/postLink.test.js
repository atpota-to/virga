import { describe, it, expect } from 'vitest';
import {
  bskyUrlFor,
  detectPostLink,
  kindForCollection,
  parsePostLink,
  parseRecordLink,
  parseRecordUri,
  recordUri,
} from './postLink.js';

// detectPostLink decides whether a URL becomes a record embed or stays a link
// card. A loose host match swallows look-alike domains; a loose path match
// mistakes one record for another. Hence most tests here are near-misses.

describe('detectPostLink waypoint (aturi.to) links', () => {
  it('maps the known collections onto post, feed, list and starter pack', () => {
    expect(
      detectPostLink('https://aturi.to/did:plc:mzqt/app.bsky.feed.post/3mcft'),
    ).toEqual({
      type: 'bluesky',
      linkType: 'post',
      // A DID is carried in the `handle` field; the caller resolves either form.
      handle: 'did:plc:mzqt',
      postId: '3mcft',
      url: 'https://aturi.to/did:plc:mzqt/app.bsky.feed.post/3mcft',
    });
    expect(
      detectPostLink(
        'https://www.aturi.to/alice.test/app.bsky.feed.generator/whats-hot',
      ),
    ).toEqual({
      type: 'bluesky',
      linkType: 'feed',
      handle: 'alice.test',
      feedId: 'whats-hot',
      url: 'https://www.aturi.to/alice.test/app.bsky.feed.generator/whats-hot',
    });
    expect(
      detectPostLink('https://aturi.to/alice.test/app.bsky.graph.list/3abc'),
    ).toEqual({
      type: 'bluesky',
      linkType: 'list',
      handle: 'alice.test',
      listId: '3abc',
      url: 'https://aturi.to/alice.test/app.bsky.graph.list/3abc',
    });
    expect(
      detectPostLink(
        'https://aturi.to/alice.test/app.bsky.graph.starterpack/3pack',
      ),
    ).toMatchObject({ linkType: 'starterpack', packId: '3pack' });
  });

  it('stops the rkey at ? and #', () => {
    expect(
      detectPostLink(
        'https://aturi.to/alice.test/app.bsky.feed.post/3mcft?ref=share',
      ).postId,
    ).toBe('3mcft');
    expect(
      detectPostLink('https://aturi.to/alice.test/app.bsky.feed.post/3mcft#top')
        .postId,
    ).toBe('3mcft');
  });

  it('falls through to no embed for a collection it has no branch for', () => {
    expect(
      detectPostLink('https://aturi.to/alice.test/pub.leaflet.document/3abc'),
    ).toBeNull();
    // Two segments is a profile link, not a record.
    expect(
      detectPostLink('https://aturi.to/alice.test/app.bsky.feed.post'),
    ).toBeNull();
  });
});

describe('detectPostLink bluesky links', () => {
  it('pulls handle and rkey out of a post URL however it is decorated', () => {
    const expected = (url) => ({
      type: 'bluesky',
      linkType: 'post',
      handle: 'alice.bsky.social',
      postId: '3lab2c',
      url,
    });
    for (const url of [
      'https://bsky.app/profile/alice.bsky.social/post/3lab2c',
      'http://bsky.app/profile/alice.bsky.social/post/3lab2c',
      'https://www.bsky.app/profile/alice.bsky.social/post/3lab2c',
      'https://bsky.app/profile/alice.bsky.social/post/3lab2c/',
      'https://bsky.app/profile/alice.bsky.social/post/3lab2c?ref=share',
      'https://bsky.app/profile/alice.bsky.social/post/3lab2c#top',
      'https://bsky.app/profile/alice.bsky.social/post/3lab2c/likes',
    ]) {
      expect(detectPostLink(url)).toEqual(expected(url));
    }
  });

  it('reads feed and list links off the same profile path', () => {
    expect(
      detectPostLink('https://bsky.app/profile/alice/feed/whats-hot'),
    ).toEqual({
      type: 'bluesky',
      linkType: 'feed',
      handle: 'alice',
      feedId: 'whats-hot',
      url: 'https://bsky.app/profile/alice/feed/whats-hot',
    });
    expect(detectPostLink('https://bsky.app/profile/alice/lists/3abc')).toEqual(
      {
        type: 'bluesky',
        linkType: 'list',
        handle: 'alice',
        listId: '3abc',
        url: 'https://bsky.app/profile/alice/lists/3abc',
      },
    );
  });

  it('reads starter pack links, in both of their path forms', () => {
    expect(
      detectPostLink('https://bsky.app/starter-pack/alice.test/3pack'),
    ).toMatchObject({
      linkType: 'starterpack',
      handle: 'alice.test',
      packId: '3pack',
    });
    expect(
      detectPostLink('https://bsky.app/start/alice.test/3pack'),
    ).toMatchObject({
      linkType: 'starterpack',
      packId: '3pack',
    });
  });

  it('needs both segments present before it claims a post', () => {
    expect(
      detectPostLink('https://bsky.app/profile/alice.bsky.social/post/'),
    ).toBeNull();
    expect(detectPostLink('https://bsky.app/profile//post/3lab2c')).toBeNull();
    expect(
      detectPostLink('https://bsky.app/profile/alice.bsky.social'),
    ).toBeNull();
  });

  it('leaves look-alike hosts as external links', () => {
    expect(
      detectPostLink('https://notbsky.app/profile/alice/post/3lab2c'),
    ).toBeNull();
    expect(
      detectPostLink('https://bsky.app.evil.com/profile/alice/post/3lab2c'),
    ).toBeNull();
    expect(
      detectPostLink(
        'https://evil.com/https://bsky.app/profile/alice/post/3lab2c',
      ),
    ).toBeNull();
    expect(
      detectPostLink('https://staging.bsky.app/profile/alice/post/3lab2c'),
    ).toBeNull();
  });

  it('returns null for anything that is not a record link, non-strings included', () => {
    expect(detectPostLink('https://example.com/blog/post/1')).toBeNull();
    expect(detectPostLink('not a url')).toBeNull();
    expect(detectPostLink('')).toBeNull();
    expect(detectPostLink(null)).toBeNull();
    expect(detectPostLink(undefined)).toBeNull();
    expect(detectPostLink(42)).toBeNull();
  });

  it('leaves at:// URIs to parseRecordLink: they are not links in post text', () => {
    expect(
      detectPostLink('at://did:plc:abc/app.bsky.feed.post/3lab2c'),
    ).toBeNull();
  });
});

describe('parseRecordLink', () => {
  it('reads at:// URIs and gives the URI back when the actor is a DID', () => {
    expect(
      parseRecordLink('at://did:plc:abc/app.bsky.feed.post/3lab2c'),
    ).toEqual({
      kind: 'post',
      collection: 'app.bsky.feed.post',
      actor: 'did:plc:abc',
      did: 'did:plc:abc',
      rkey: '3lab2c',
      url: 'at://did:plc:abc/app.bsky.feed.post/3lab2c',
      uri: 'at://did:plc:abc/app.bsky.feed.post/3lab2c',
    });
  });

  it('gives a handle (lowercased, no @) instead of a URI when it has to be resolved', () => {
    const parsed = parseRecordLink(
      'https://bsky.app/profile/Alice.Test/lists/3abc',
    );
    expect(parsed).toMatchObject({
      kind: 'list',
      handle: 'alice.test',
      rkey: '3abc',
    });
    expect(parsed.uri).toBeUndefined();
    expect(parsed.did).toBeUndefined();
  });

  it('decodes a percent-encoded DID in the path', () => {
    expect(
      parseRecordLink('https://bsky.app/profile/did%3Aplc%3Aabc/post/3x').uri,
    ).toBe('at://did:plc:abc/app.bsky.feed.post/3x');
  });

  it('refuses at:// URIs to collections that cannot be embedded', () => {
    expect(
      parseRecordLink('at://did:plc:abc/app.bsky.feed.like/3x'),
    ).toBeNull();
    expect(parseRecordLink('at://did:plc:abc/app.bsky.feed.post')).toBeNull();
  });

  it('trims surrounding whitespace', () => {
    expect(
      parseRecordLink('  https://bsky.app/profile/alice.test/post/3x \n').rkey,
    ).toBe('3x');
  });
});

describe('parsePostLink', () => {
  it('answers posts only', () => {
    expect(
      parsePostLink('https://bsky.app/profile/alice.test/post/3x'),
    ).toEqual({
      actor: 'alice.test',
      handle: 'alice.test',
      rkey: '3x',
    });
    expect(parsePostLink('at://did:plc:abc/app.bsky.feed.post/3x')).toEqual({
      actor: 'did:plc:abc',
      did: 'did:plc:abc',
      rkey: '3x',
    });
    expect(
      parsePostLink('https://bsky.app/profile/alice.test/feed/x'),
    ).toBeNull();
    expect(parsePostLink(null)).toBeNull();
  });
});

describe('record URIs and bsky.app pages', () => {
  it('builds and reads URIs for each kind', () => {
    for (const kind of ['post', 'feed', 'list', 'starterpack']) {
      const uri = recordUri('did:plc:abc', kind, '3x');
      expect(parseRecordUri(uri)).toMatchObject({
        kind,
        did: 'did:plc:abc',
        rkey: '3x',
      });
      expect(kindForCollection(parseRecordUri(uri).collection)).toBe(kind);
    }
    expect(() => recordUri('did:plc:abc', 'like', '3x')).toThrow();
    expect(parseRecordUri('at://did:plc:abc/app.bsky.feed.like/3x')).toBeNull();
  });

  it('links each kind to its bsky.app page, preferring a handle', () => {
    expect(
      bskyUrlFor('at://did:plc:abc/app.bsky.feed.post/3x', 'alice.test'),
    ).toBe('https://bsky.app/profile/alice.test/post/3x');
    expect(bskyUrlFor('at://did:plc:abc/app.bsky.graph.list/3x')).toBe(
      'https://bsky.app/profile/did%3Aplc%3Aabc/lists/3x',
    );
    expect(bskyUrlFor('at://did:plc:abc/app.bsky.feed.generator/hot')).toBe(
      'https://bsky.app/profile/did%3Aplc%3Aabc/feed/hot',
    );
    expect(
      bskyUrlFor('at://did:plc:abc/app.bsky.graph.starterpack/3p', 'a.test'),
    ).toBe('https://bsky.app/starter-pack/a.test/3p');
    expect(bskyUrlFor('nope')).toBeNull();
  });

  it('round-trips a bsky.app link through its URI', () => {
    const uri = 'at://did:plc:abc/app.bsky.feed.post/3x';
    expect(parseRecordLink(bskyUrlFor(uri)).uri).toBe(uri);
  });
});
