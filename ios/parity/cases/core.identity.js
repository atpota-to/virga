// DIDs, handles and AT-URIs, read as the web reads them. Swift:
// VirgaCore/Identity/AtUri.swift and Identifiers.swift. Each Swift reading
// is one of the web's own, so each is held to the web function that uses it.

import { isDid as accountsIsDid } from '../../../src/session/accounts.js';
import { isDid as harvestIsDid } from '../../../src/defense/harvest.js';
import { authorOf } from '../../../src/defense/command.js';
import { isDid as interactionIsDid } from '../../../src/tools/interactionModel.js';
import { isValidHandle } from '../../../src/posting/lib/mentions.js';
import { rkeyFromAtUri } from '../../../src/lib/atproto.js';
import { didFromAtUri } from '../../../src/lib/analytics.js';
import {
  parseRecordUri,
  recordUri,
} from '../../../src/posting/lib/postLink.js';
import { each } from './_helpers.js';

export const sources = [
  'src/session/accounts.js',
  'src/defense/harvest.js',
  'src/defense/command.js',
  'src/tools/interactionModel.js',
  'src/posting/lib/mentions.js',
  'src/lib/atproto.js',
  'src/lib/analytics.js',
  'src/posting/lib/postLink.js',
];

const DIDS = [
  'did:plc:z72i7hdynmk6r22z27h6tvur',
  'did:web:example.com',
  'did:web:localhost%3A8080',
  'did:key:zQ3shokFTS3brHcDQrn82RUDfCZESWL1ZdCEJwekUDPQiYBme',
  'did:plc:',
  'did:plc',
  'did:PLC:abc',
  'did:plc:abc:',
  'did:plc:abc%',
  'did:plc:abc%20',
  'did:plc:abc\n',
  'did:plc:a/b',
  'did:plc:a b',
  'did:plc:ab_c.d-e',
  'did:a1:x',
  'DID:plc:abc',
  'did::abc',
  'did:plc:abç',
  ' did:plc:abc',
  'did:web:example.com:path:to',
  'did:web::',
  '',
  'at://did:plc:abc',
  null,
  42,
];

const HANDLES = [
  'alice.bsky.social',
  'jo.example.com',
  'xn--ls8h.test',
  'a.b',
  'a.b.c.d.e',
  'Alice.Bsky.Social',
  'alice',
  '.alice.bsky.social',
  'alice.bsky.social.',
  'alice..social',
  '-alice.bsky.social',
  'alice-.bsky.social',
  'al-ice.bsky.social',
  'alice.123',
  'alice.1bc',
  'alice.b2c',
  '1alice.bsky.social',
  'alice_bob.bsky.social',
  'alïce.bsky.social',
  'alice.bsky.social\n',
  '@alice.bsky.social',
  `${'a'.repeat(63)}.com`,
  `${'a'.repeat(64)}.com`,
  `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(57)}.co`,
  `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(58)}.co`,
  'handle.invalid',
  '',
  null,
  7,
];

const URIS = [
  'at://did:plc:abc/app.bsky.feed.post/3kabc',
  'at://did:plc:abc/app.bsky.feed.post/3kabc/',
  'at://did:plc:abc/app.bsky.feed.post/3kabc//',
  'at://did:plc:abc/app.bsky.feed.post/3kabc?x=1',
  'at://did:plc:abc/app.bsky.feed.post/3kabc#frag',
  'at://did:plc:abc/app.bsky.feed.post/3kabc/extra',
  'at://did:plc:abc/app.bsky.feed.post/',
  'at://did:plc:abc/app.bsky.feed.post',
  'at://did:plc:abc/',
  'at://did:plc:abc',
  'at://did:plc:a?b/app.bsky.feed.post/3k',
  'at://did:plc:abc/app.bsky.feed.post?x/3k',
  'at://alice.bsky.social/app.bsky.feed.post/3kabc',
  'at://did:web:example.com/app.bsky.graph.list/3kx',
  'at://did:plc:abc/app.bsky.feed.generator/whats-hot',
  'at://did:plc:abc/app.bsky.graph.starterpack/3ky',
  'at://did:plc:abc/app.bsky.graph.follow/3kz',
  'at://did:plc:abc/net.anisota.feed.template/3kt',
  'at://did:plc:abc/app.bsky.feed.post/👍',
  'at:///app.bsky.feed.post/3k',
  'at://did:plc:abc//3k',
  'AT://did:plc:abc/app.bsky.feed.post/3k',
  'https://bsky.app/profile/alice/post/3k',
  'at://did:plc:/x/y',
  'at://did:/x/y',
  'at://did:plc:abc:/app.bsky.feed.post/3k',
  ' at://did:plc:abc/app.bsky.feed.post/3k',
  '',
  null,
];

export default async function cases() {
  const out = [];
  out.push(
    ...(await each(
      'accounts.isDid',
      DIDS.map((value) => ({ value })),
      ({ value }) => accountsIsDid(value),
    )),
    ...(await each(
      'harvest.isDid',
      DIDS.map((value) => ({ value })),
      ({ value }) => harvestIsDid(value),
    )),
    ...(await each(
      'interactionModel.isDid',
      DIDS.map((value) => ({ value })),
      ({ value }) => interactionIsDid(value),
    )),
    ...(await each(
      'isValidHandle',
      HANDLES.map((handle) => ({ handle })),
      ({ handle }) => isValidHandle(handle),
    )),
    ...(await each(
      'rkeyFromAtUri',
      URIS.map((uri) => ({ uri })),
      ({ uri }) => rkeyFromAtUri(uri),
    )),
    ...(await each(
      'didFromAtUri',
      URIS.map((uri) => ({ uri })),
      ({ uri }) => didFromAtUri(uri),
    )),
    ...(await each(
      'authorOf',
      URIS.map((uri) => ({ uri })),
      ({ uri }) => authorOf(uri),
    )),
    ...(await each(
      'parseRecordUri',
      URIS.map((uri) => ({ uri })),
      ({ uri }) => parseRecordUri(uri),
    )),
    ...(await each(
      'recordUri',
      [
        { did: 'did:plc:abc', kind: 'post', rkey: '3k' },
        { did: 'did:plc:abc', kind: 'list', rkey: 'x y' },
      ],
      ({ did, kind, rkey }) => recordUri(did, kind, rkey),
    )),
  );
  return out;
}
