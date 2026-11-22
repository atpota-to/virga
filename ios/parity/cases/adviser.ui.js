// src/posting/ui/{backendAccess,postPreview}.js: what the "needs a long
// session" panel offers an account, and what a post preview shows from a
// view, a bare record or only a URI (the embed's line in every locale the app
// offers). Swift: VirgaPosting/UI/{BackendAccess,PostPreview}.swift.
//
// Inputs from the composer's and the library's uses of them, plus every kind
// of embed, handles that aren't usable, long and unicode text, and loose
// views and records.

import { backendAccess } from '../../../src/posting/ui/backendAccess.js';
import {
  embedSummary,
  postPreviewModel,
} from '../../../src/posting/ui/postPreview.js';
import {
  DEFAULT_LOCALE,
  LOCALE_CHOICES,
  setActiveLocale,
} from '../../../src/lib/locale.js';
import { each, grid } from './_helpers.js';

export const sources = [
  'src/posting/ui/backendAccess.js',
  'src/posting/ui/postPreview.js',
];

const DID = 'did:plc:writer';
const URI = `at://${DID}/app.bsky.feed.post/3kpost`;

const inLocale = (locale, fn) => {
  setActiveLocale(locale);
  try {
    return fn();
  } finally {
    setActiveLocale(DEFAULT_LOCALE);
  }
};

const EMBEDS = [
  { $type: 'app.bsky.embed.images', images: [{}, {}] },
  { $type: 'app.bsky.embed.images#view', images: [{}] },
  { $type: 'app.bsky.embed.images', images: [] },
  { $type: 'app.bsky.embed.images' },
  { $type: 'app.bsky.embed.images', images: 'abc' },
  { $type: 'app.bsky.embed.images', images: { length: 3 } },
  {
    $type: 'app.bsky.embed.images',
    images: Array.from({ length: 1234 }, () => 0),
  },
  { $type: 'app.bsky.embed.video' },
  { $type: 'app.bsky.embed.video#view' },
  {
    $type: 'app.bsky.embed.external',
    external: { title: 'A page', uri: 'https://x.example' },
  },
  {
    $type: 'app.bsky.embed.external#view',
    external: { uri: 'https://www.example.com/a?b' },
  },
  {
    $type: 'app.bsky.embed.external',
    external: { uri: 'https://www.example.com:8443/' },
  },
  {
    $type: 'app.bsky.embed.external',
    external: { uri: 'https://wwwx.example.com/' },
  },
  { $type: 'app.bsky.embed.external', external: { uri: 'not a url' } },
  { $type: 'app.bsky.embed.external', external: { uri: 'file:///etc/hosts' } },
  {
    $type: 'app.bsky.embed.external',
    external: { uri: 'https://BÜCHER.example/' },
  },
  { $type: 'app.bsky.embed.external', external: {} },
  { $type: 'app.bsky.embed.external' },
  { $type: 'app.bsky.embed.external', external: { title: 42 } },
  {
    $type: 'app.bsky.embed.external',
    external: { title: '', uri: 'https://e.example' },
  },
  { $type: 'app.bsky.embed.record', record: { uri: URI } },
  {
    $type: 'app.bsky.embed.record#view',
    record: { uri: `at://${DID}/app.bsky.feed.generator/f` },
  },
  {
    $type: 'app.bsky.embed.record',
    record: { uri: `at://${DID}/app.bsky.graph.list/l` },
  },
  {
    $type: 'app.bsky.embed.record',
    record: { uri: `at://${DID}/app.bsky.graph.starterpack/s` },
  },
  { $type: 'app.bsky.embed.record', record: { uri: 'https://not.at/all' } },
  { $type: 'app.bsky.embed.record', record: {} },
  { $type: 'app.bsky.embed.record' },
  {
    $type: 'app.bsky.embed.recordWithMedia',
    media: { $type: 'app.bsky.embed.images', images: [{}] },
    record: { record: { uri: URI } },
  },
  {
    $type: 'app.bsky.embed.recordWithMedia#view',
    media: { $type: 'app.bsky.embed.video#view' },
    record: { record: { uri: `at://${DID}/app.bsky.graph.list/l` } },
  },
  {
    $type: 'app.bsky.embed.recordWithMedia',
    media: { $type: 'app.bsky.embed.images', images: [] },
    record: { uri: URI },
  },
  { $type: 'app.bsky.embed.recordWithMedia' },
  { $type: 'app.bsky.embed.gallery' },
  { $type: 'app.bsky.embed.images#viewx', images: [{}] },
  { $type: 5 },
  {},
  [],
  'app.bsky.embed.video',
  null,
];

const VIEW = {
  uri: URI,
  cid: 'bafy',
  author: {
    did: DID,
    handle: 'writer.example.com',
    displayName: ' Writer ',
    avatar: 'https://cdn.example/a.jpg',
  },
  record: { text: 'Hello there', createdAt: '2026-11-01T10:00:00.000Z' },
  replyCount: 2,
  repostCount: 3,
  likeCount: 40,
  quoteCount: 1,
  indexedAt: '2026-11-01T10:00:05.000Z',
  embed: { $type: 'app.bsky.embed.images#view', images: [{}, {}] },
};

const LONG = 'word '.repeat(80);
const EMOJI = '👩‍👩‍👧😀'.repeat(150);

const PREVIEWS = [
  { $id: 'a-view', view: VIEW },
  { $id: 'compact-view', view: VIEW, compact: true },
  {
    $id: 'record-only',
    record: {
      text: 'Bare',
      createdAt: '2026-01-01T00:00:00Z',
      reply: { root: {} },
    },
    uri: URI,
  },
  { $id: 'uri-only', uri: URI },
  { $id: 'nothing' },
  {
    $id: 'record-beats-the-views',
    view: VIEW,
    record: { text: 'From the repo', embed: { $type: 'app.bsky.embed.video' } },
  },
  {
    $id: 'invalid-handle',
    view: { ...VIEW, author: { did: DID, handle: 'handle.invalid' } },
  },
  {
    $id: 'blank-name',
    view: {
      ...VIEW,
      author: { did: DID, handle: 'w.example', displayName: '   ' },
    },
  },
  { $id: 'no-did', view: { ...VIEW, author: { handle: 'w.example' } } },
  { $id: 'no-author', view: { ...VIEW, author: null } },
  { $id: 'long-text', record: { text: LONG } },
  { $id: 'long-text-compact', record: { text: LONG }, compact: true },
  { $id: 'exactly-280', record: { text: 'x'.repeat(280) } },
  { $id: 'exactly-281', record: { text: 'x'.repeat(281) } },
  { $id: 'emoji-text', record: { text: EMOJI } },
  { $id: 'emoji-text-compact', record: { text: EMOJI }, compact: true },
  { $id: 'text-not-a-string', record: { text: 5 } },
  {
    $id: 'counts-loose',
    view: { uri: URI, replyCount: null, likeCount: '7', quoteCount: 0 },
  },
  {
    $id: 'embed-from-the-record',
    view: {
      uri: URI,
      record: { text: 't', embed: { $type: 'app.bsky.embed.video' } },
    },
  },
  {
    $id: 'indexed-at',
    view: {
      uri: URI,
      indexedAt: '2026-02-02T00:00:00Z',
      record: { text: 'x' },
    },
  },
  { $id: 'uri-not-a-record', uri: 'https://bsky.app/profile/x' },
  {
    $id: 'feed-uri',
    uri: `at://${DID}/app.bsky.feed.generator/hot`,
    view: { author: { handle: 'f.example' } },
  },
  { $id: 'starter-pack', uri: `at://${DID}/app.bsky.graph.starterpack/sp` },
  {
    $id: 'handle-to-encode',
    view: { uri: URI, author: { did: DID, handle: 'a b' } },
  },
  { $id: 'view-not-an-object', view: 'x', uri: URI },
];

const ACCOUNTS = [
  { mode: 'backend' },
  { mode: 'browser' },
  { mode: 'Backend' },
  {},
  null,
  'did:plc:x',
];

export default async function cases() {
  const all = [];
  all.push(
    ...(await each(
      'backendAccess',
      grid({
        account: ACCOUNTS,
        authMode: ['backend', 'browser', undefined],
        canSchedule: [true, false, undefined, 1],
      }),
      ({ account, authMode, canSchedule }) =>
        backendAccess(account, { authMode, canSchedule }),
    )),
  );
  all.push(
    ...(await each('backendAccessNoOptions', [{}], () =>
      backendAccess({ mode: 'backend' }),
    )),
  );
  const summaries = [];
  for (const locale of LOCALE_CHOICES)
    for (const embed of EMBEDS) summaries.push({ locale, embed });
  all.push(
    ...(await each('embedSummary', summaries, ({ locale, embed }) =>
      inLocale(locale, () => embedSummary(embed)),
    )),
  );
  const previews = [];
  for (const locale of ['en-US', 'en-IN'])
    for (const p of PREVIEWS)
      previews.push({ ...p, $id: `${p.$id}/${locale}`, locale });
  all.push(
    ...(await each(
      'postPreviewModel',
      previews,
      ({ locale, compact, ...input }) =>
        inLocale(locale, () => postPreviewModel(input, { compact })),
    )),
  );
  return all;
}
