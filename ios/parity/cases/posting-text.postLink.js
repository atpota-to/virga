// src/posting/lib/postLink.js: links to embeddable records (bsky.app,
// aturi.to and at:// forms), record URIs and their bsky.app pages. Swift:
// VirgaPosting/Lib/PostLink.swift.
//
// Inputs from src/posting/lib/postLink.test.js and facets.test.js, plus
// case, percent-encoding (good and malformed), whitespace, look-alike hosts
// and every kind through every form.

import {
  bskyUrlFor,
  detectPostLink,
  kindForCollection,
  parsePostLink,
  parseRecordLink,
  parseRecordUri,
  recordUri,
  RECORD_COLLECTIONS,
} from '../../../src/posting/lib/postLink.js';
import { each, value } from './_helpers.js';

export const sources = ['src/posting/lib/postLink.js'];

const LINKS = [
  'https://aturi.to/did:plc:mzqt/app.bsky.feed.post/3mcft',
  'https://www.aturi.to/alice.test/app.bsky.feed.generator/whats-hot',
  'https://aturi.to/alice.test/app.bsky.graph.list/3abc',
  'https://aturi.to/alice.test/app.bsky.graph.starterpack/3pack',
  'https://aturi.to/alice.test/app.bsky.feed.post/3mcft?ref=share',
  'https://aturi.to/alice.test/app.bsky.feed.post/3mcft#top',
  'https://aturi.to/alice.test/pub.leaflet.document/3abc',
  'https://aturi.to/alice.test/app.bsky.feed.post',
  'HTTPS://ATURI.TO/Alice.Test/app.bsky.feed.post/3X',
  'https://bsky.app/profile/alice.bsky.social/post/3lab2c',
  'http://bsky.app/profile/alice.bsky.social/post/3lab2c',
  'https://www.bsky.app/profile/alice.bsky.social/post/3lab2c',
  'https://bsky.app/profile/alice.bsky.social/post/3lab2c/',
  'https://bsky.app/profile/alice.bsky.social/post/3lab2c?ref=share',
  'https://bsky.app/profile/alice.bsky.social/post/3lab2c#top',
  'https://bsky.app/profile/alice.bsky.social/post/3lab2c/likes',
  'https://bsky.app/profile/alice/feed/whats-hot',
  'https://bsky.app/profile/alice/lists/3abc',
  'https://bsky.app/starter-pack/alice.test/3pack',
  'https://bsky.app/start/alice.test/3pack',
  'https://bsky.app/profile/alice.bsky.social/post/',
  'https://bsky.app/profile//post/3lab2c',
  'https://bsky.app/profile/alice.bsky.social',
  'https://notbsky.app/profile/alice/post/3lab2c',
  'https://bsky.app.evil.com/profile/alice/post/3lab2c',
  'https://evil.com/https://bsky.app/profile/alice/post/3lab2c',
  'https://staging.bsky.app/profile/alice/post/3lab2c',
  'https://example.com/blog/post/1',
  'not a url',
  '',
  '   ',
  'at://did:plc:abc/app.bsky.feed.post/3lab2c',
  'at://did:plc:abc/app.bsky.feed.post/3lab2c/',
  'at://did:plc:abc/app.bsky.feed.like/3x',
  'at://did:plc:abc/app.bsky.feed.post',
  'at://alice.test/app.bsky.graph.list/3l',
  'at://did:plc:abc/app.bsky.feed.generator/hot?x',
  'AT://did:plc:abc/app.bsky.feed.post/3x',
  'https://bsky.app/profile/Alice.Test/lists/3abc',
  'https://bsky.app/profile/did%3Aplc%3Aabc/post/3x',
  'https://bsky.app/profile/did%3aplc%3aabc/post/3x',
  'https://bsky.app/profile/%40Alice.Test/post/3x',
  'https://bsky.app/profile/@alice.test/post/3x',
  'https://bsky.app/profile/%E0%A4%A/post/%ZZ',
  'https://bsky.app/profile/caf%C3%A9.test/post/3%20x',
  '  https://bsky.app/profile/alice.test/post/3x \n',
  'HTTPS://BSKY.APP/PROFILE/ALICE.TEST/POST/3X',
  'https://bsky.app/PROFILE/a.test/LISTS/3l',
  'https://bsky.app/profile/a.test/post/3x/extra/segments',
  'https://bsky.app/profile/a.test/posts/3x',
  'https://bsky.app/profile/ΑΛΙΚΗ.test/post/3x',
  'https://bsky.app/profile/a.test/post/3x\nhttps://bsky.app/profile/b.test/post/3y',
  'https://bsky.app/starter-pack/did:plc:abc/3p',
  'ftp://bsky.app/profile/a.test/post/3x',
  'https:/bsky.app/profile/a.test/post/3x',
];

export default async function cases() {
  const out = [value('RECORD_COLLECTIONS', RECORD_COLLECTIONS)];
  out.push(
    ...(await each(
      'kindForCollection',
      [
        'app.bsky.feed.post',
        'app.bsky.feed.generator',
        'app.bsky.graph.list',
        'app.bsky.graph.starterpack',
        'app.bsky.feed.like',
        '',
        null,
      ].map((collection) => ({ collection })),
      ({ collection }) => kindForCollection(collection),
    )),
  );
  const inputs = [...LINKS.map((url) => ({ url })), { url: null }, { url: 42 }];
  out.push(
    ...(await each('parseRecordLink', inputs, ({ url }) =>
      parseRecordLink(url),
    )),
  );
  out.push(
    ...(await each('parsePostLink', inputs, ({ url }) => parsePostLink(url))),
  );
  out.push(
    ...(await each('detectPostLink', inputs, ({ url }) => detectPostLink(url))),
  );
  out.push(
    ...(await each(
      'recordUri',
      [
        ...['post', 'feed', 'list', 'starterpack'].map((kind) => ({
          did: 'did:plc:abc',
          kind,
          rkey: '3x',
        })),
        { did: 'did:plc:abc', kind: 'like', rkey: '3x' },
        { did: 'did:plc:abc', kind: '', rkey: '3x' },
      ],
      ({ did, kind, rkey }) => recordUri(did, kind, rkey),
    )),
  );
  const uris = [
    'at://did:plc:abc/app.bsky.feed.post/3x',
    'at://did:plc:abc/app.bsky.feed.generator/hot',
    'at://did:plc:abc/app.bsky.graph.list/3x',
    'at://did:plc:abc/app.bsky.graph.starterpack/3p',
    'at://did:plc:abc/app.bsky.feed.like/3x',
    'at://alice.test/app.bsky.feed.post/3x',
    'nope',
    '',
    null,
  ];
  out.push(
    ...(await each(
      'parseRecordUri',
      uris.map((uri) => ({ uri })),
      ({ uri }) => parseRecordUri(uri),
    )),
  );
  out.push(
    ...(await each(
      'bskyUrlFor',
      uris.flatMap((uri) =>
        [null, '', 'alice.test', 'Alice Test/é'].map((actor) => ({
          uri,
          actor,
        })),
      ),
      ({ uri, actor }) => bskyUrlFor(uri, actor ?? undefined),
    )),
  );
  return out;
}
