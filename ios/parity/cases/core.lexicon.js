// The atproto JSON the web app reads and writes, for the Swift lexicon
// models to round-trip exactly (VirgaCore/Lexicon/): decoded into the typed
// model and encoded again, each must give back the same JSON.
//
// Most of it is what the harness's fake AppView and PDS answer (harness/,
// the web app's own stand-in for the network, which its tests and demo
// run on), so the shapes are the ones the web is written against. The rest
// are written out here for what the harness doesn't make: every embed and
// its view, every rule, the stand-ins for missing and blocked posts,
// preferences of other kinds, fields a newer lexicon adds, and a field of
// the wrong type, which a record must keep as it came.

import { createRouter } from '../../../harness/fakeNetwork.js';
import { createFakeAgent } from '../../../harness/fakeXrpc.js';
import { LAB, ME, PDS, buildWorld } from '../../../harness/world.js';
import { lexicons } from '@atproto/api';
import { LISTS_SCOPE } from '../../../src/config.js';
import { each } from './_helpers.js';

export const sources = [
  'harness/fakeNetwork.js',
  'harness/fakeXrpc.js',
  'harness/views.js',
  'harness/world.js',
];

const NOW = Date.parse('2026-11-12T12:00:00.000Z');

/** Up to `n` of a list, so the fixture stays readable. */
const few = (list, n = 2) => (Array.isArray(list) ? list.slice(0, n) : list);

async function harness() {
  const mira = buildWorld({ now: NOW });
  const lab = buildWorld({ now: NOW, account: LAB });
  const worlds = [mira, lab];
  const route = createRouter(worlds, { now: () => NOW });
  const get = async (url) => {
    const answer = await route(url, {});
    if (!answer || !answer.ok) throw new Error(`harness refused ${url}`);
    return answer.json();
  };
  const appview = (nsid, params = {}) =>
    get(
      `https://public.api.bsky.app/xrpc/${nsid}?${new URLSearchParams(params)}`,
    );
  const pds = (nsid, params = {}) =>
    get(`${PDS}/xrpc/${nsid}?${new URLSearchParams(params)}`);
  const agent = createFakeAgent(mira, {
    worlds,
    scope: LISTS_SCOPE,
    sweepCounter: { next: () => 1 },
  });
  const signedIn = agent.withProxy('bsky_appview', 'did:web:api.bsky.app');
  const call = async (target, nsid, input = {}) =>
    (await target.handle(nsid, input)).data;

  const out = [];
  const add = (type, from, json) => out.push({ type, from, json });

  const profile = await appview('app.bsky.actor.getProfile', { actor: ME.did });
  add('ProfileViewDetailed', 'getProfile', profile);
  const feed = await appview('app.bsky.feed.getAuthorFeed', {
    actor: ME.did,
    limit: 4,
  });
  add('GetAuthorFeedOutput', 'getAuthorFeed', feed);
  const uris = feed.feed.map((f) => f.post.uri);
  add(
    'GetPostsOutput',
    'getPosts',
    await get(
      `https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?${uris
        .slice(0, 2)
        .map((u) => `uris=${encodeURIComponent(u)}`)
        .join('&')}`,
    ),
  );
  const loud = [...mira.posts].sort(
    (a, b) => b.replies + b.quotes - (a.replies + a.quotes),
  )[0];
  const thread = await appview('app.bsky.feed.getPostThread', {
    uri: `at://${ME.did}/app.bsky.feed.post/${loud.rkey}`,
    depth: 1,
  });
  if (thread.thread?.replies)
    thread.thread.replies = few(thread.thread.replies);
  add('GetPostThreadOutput', 'getPostThread', thread);
  const feeds = await appview('app.bsky.feed.getActorFeeds', { actor: ME.did });
  add('GetFeedGeneratorsOutput', 'getActorFeeds', feeds);
  if (feeds.feeds?.[0]) {
    add(
      'GetFeedGeneratorOutput',
      'getFeedGenerator',
      await appview('app.bsky.feed.getFeedGenerator', {
        feed: feeds.feeds[0].uri,
      }),
    );
  }
  const lists = await appview('app.bsky.graph.getLists', { actor: ME.did });
  add('GetListsOutput', 'getLists', lists);
  if (lists.lists?.[0]) {
    const list = await appview('app.bsky.graph.getList', {
      list: lists.lists[0].uri,
      limit: 2,
    });
    add('GetListOutput', 'getList', list);
  }
  const relationships = new URLSearchParams({ actor: ME.did });
  relationships.append('others', mira.follows[0].value.subject);
  relationships.append('others', 'did:plc:virgaharnessnobody0001');
  add(
    'GetRelationshipsOutput',
    'getRelationships',
    await get(
      `https://public.api.bsky.app/xrpc/app.bsky.graph.getRelationships?${relationships}`,
    ),
  );
  add(
    'ResolveHandleOutput',
    'resolveHandle',
    await appview('com.atproto.identity.resolveHandle', { handle: ME.handle }),
  );
  add(
    'DIDDocument',
    'plc.directory',
    await get(`https://plc.directory/${ME.did}`),
  );

  const collections = {
    'app.bsky.feed.post': 'PostRecord',
    'app.bsky.feed.like': 'LikeRecord',
    'app.bsky.feed.repost': 'RepostRecord',
    'app.bsky.graph.follow': 'FollowRecord',
    'app.bsky.graph.block': 'BlockRecord',
    'app.bsky.graph.list': 'ListRecord',
    'app.bsky.graph.listitem': 'ListItemRecord',
    'app.bsky.graph.listblock': 'ListBlockRecord',
    'app.bsky.feed.threadgate': 'ThreadgateRecord',
    'app.bsky.feed.postgate': 'PostgateRecord',
    'app.bsky.feed.generator': 'GeneratorRecord',
    'app.bsky.actor.profile': 'ProfileRecord',
    'net.anisota.feed.template': 'TemplateRecord',
  };
  for (const [collection, type] of Object.entries(collections)) {
    const page = await pds('com.atproto.repo.listRecords', {
      repo: ME.did,
      collection,
      limit: 2,
    });
    add('ListRecordsOutput', `listRecords ${collection}`, page);
    for (const record of page.records)
      add(type, `listRecords ${collection}`, record.value);
  }

  add(
    'ListNotificationsOutput',
    'listNotifications',
    await call(signedIn, 'app.bsky.notification.listNotifications', {
      limit: 4,
    }),
  );
  const followers = await call(signedIn, 'app.bsky.graph.getFollowers', {
    actor: ME.did,
    limit: 3,
  });
  add('GetFollowersOutput', 'getFollowers', followers);
  add(
    'GetProfilesOutput',
    'getProfiles (signed in)',
    await call(signedIn, 'app.bsky.actor.getProfiles', {
      actors: [mira.follows[0].value.subject, followers.followers[0].did],
    }),
  );
  add(
    'GetPreferencesOutput',
    'getPreferences',
    await call(signedIn, 'app.bsky.actor.getPreferences'),
  );
  add(
    'GetBookmarksOutput',
    'getBookmarks',
    await call(signedIn, 'app.bsky.bookmark.getBookmarks', { limit: 3 }),
  );
  add(
    'GetDraftsOutput',
    'getDrafts',
    await call(signedIn, 'app.bsky.draft.getDrafts', { limit: 3 }),
  );
  add(
    'DescribeRepoOutput',
    'describeRepo',
    await call(agent, 'com.atproto.repo.describeRepo', { repo: ME.did }),
  );
  return out;
}

/** The fields a record's lexicon requires that it doesn't have. */
function missingRequired(json) {
  const nsid = json?.$type;
  if (typeof nsid !== 'string' || nsid.includes('#')) return [];
  let def;
  try {
    def = lexicons.getDef(nsid);
  } catch {
    return [];
  }
  if (def?.type !== 'record') return [];
  return (def.record.required || []).filter((key) => !(key in json));
}

// What the harness doesn't make.
const BLOB = (cid, mimeType, size) => ({
  $type: 'blob',
  ref: { $link: cid },
  mimeType,
  size,
});
const IMG = 'bafkreibme22gw2h7y2h7tg2fhqotaqjucnbc24deqo72b6mkl2egezxhvy';
const VID = 'bafkreiexample7videoblobcid7xyzzyxyzzyxyzzyxyzzyxyzzyxyzz';
const AUTHOR = {
  did: 'did:plc:z72i7hdynmk6r22z27h6tvur',
  handle: 'bsky.app',
  displayName: 'Bluesky',
  avatar:
    'https://cdn.bsky.app/img/avatar/plain/did:plc:z72i7hdynmk6r22z27h6tvur/bafkreihagr2cmvl2jt4mgx3sppwe2it3fwolkrbtjrhcnwjk4jdijhsoze@jpeg',
  associated: {
    chat: { allowIncoming: 'none' },
    activitySubscription: { allowSubscriptions: 'followers' },
  },
  viewer: {
    muted: false,
    blockedBy: false,
    following: 'at://did:plc:me/app.bsky.graph.follow/3kxyz',
    knownFollowers: {
      count: 12,
      followers: [{ did: 'did:plc:friend', handle: 'friend.test' }],
    },
  },
  labels: [],
  createdAt: '2023-04-12T04:53:57.057Z',
  verification: {
    verifications: [],
    verifiedStatus: 'none',
    trustedVerifierStatus: 'valid',
  },
};
const POST_URI =
  'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.post/3l3qo2vutsw2b';
const POST_CID = 'bafyreih2qbmidzbwmvdxdbfhlo3zilmqgbwj7nqmcumqvwnmrqj6dskbpe';
const REF = { uri: POST_URI, cid: POST_CID };
const IMAGES = {
  $type: 'app.bsky.embed.images',
  images: [
    {
      alt: 'A heron',
      image: BLOB(IMG, 'image/jpeg', 341000),
      aspectRatio: { width: 1200, height: 800 },
    },
    { alt: '', image: BLOB(IMG, 'image/png', 12) },
  ],
};
const VIDEO = {
  $type: 'app.bsky.embed.video',
  video: BLOB(VID, 'video/mp4', 4800000),
  alt: 'The heron, moving',
  aspectRatio: { width: 1080, height: 1920 },
  captions: [{ lang: 'en', file: BLOB(IMG, 'text/vtt', 900) }],
  presentation: 'gif',
};
const EXTERNAL = {
  $type: 'app.bsky.embed.external',
  external: {
    uri: 'https://example.com/herons',
    title: 'Herons of the estuary',
    description: 'A field guide.',
    thumb: BLOB(IMG, 'image/jpeg', 44000),
    associatedRefs: [{ $type: 'com.atproto.repo.strongRef', ...REF }],
  },
};
const RECORD = { $type: 'app.bsky.embed.record', record: REF };
const GALLERY = {
  $type: 'app.bsky.embed.gallery',
  items: [
    {
      image: BLOB(IMG, 'image/webp', 2000),
      alt: 'one',
      aspectRatio: { width: 1, height: 1 },
    },
  ],
};
const VIEW_RECORD = {
  $type: 'app.bsky.embed.record#viewRecord',
  uri: POST_URI,
  cid: POST_CID,
  author: AUTHOR,
  value: {
    $type: 'app.bsky.feed.post',
    text: 'Quoted.',
    createdAt: '2024-09-01T10:00:00.000Z',
    langs: ['en'],
  },
  labels: [],
  likeCount: 3,
  replyCount: 0,
  repostCount: 1,
  quoteCount: 0,
  indexedAt: '2024-09-01T10:00:01.000Z',
  embeds: [
    {
      $type: 'app.bsky.embed.images#view',
      images: [
        {
          thumb: 'https://cdn.bsky.app/img/feed_thumbnail/plain/x@jpeg',
          fullsize: 'https://cdn.bsky.app/img/feed_fullsize/plain/x@jpeg',
          alt: '',
          aspectRatio: { width: 4, height: 3 },
        },
      ],
    },
  ],
};
const IMAGES_VIEW = {
  $type: 'app.bsky.embed.images#view',
  images: VIEW_RECORD.embeds[0].images,
};
const CREATOR = {
  did: 'did:plc:creator',
  handle: 'maker.test',
  displayName: 'Maker',
  indexedAt: '2024-01-01T00:00:00.000Z',
};
const GENERATOR_VIEW = {
  $type: 'app.bsky.feed.defs#generatorView',
  uri: 'at://did:plc:creator/app.bsky.feed.generator/herons',
  cid: 'bafyreigen',
  did: 'did:web:feeds.example.com',
  creator: CREATOR,
  displayName: 'Herons',
  description: 'Only herons. #birds',
  descriptionFacets: [
    {
      index: { byteStart: 12, byteEnd: 18 },
      features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'birds' }],
    },
  ],
  likeCount: 40,
  acceptsInteractions: true,
  labels: [],
  viewer: { like: 'at://did:plc:me/app.bsky.feed.like/3k' },
  contentMode: 'app.bsky.feed.defs#contentModeVideo',
  indexedAt: '2024-02-02T00:00:00.000Z',
};
const LIST_VIEW = {
  $type: 'app.bsky.graph.defs#listView',
  uri: 'at://did:plc:creator/app.bsky.graph.list/3kl',
  cid: 'bafyreilist',
  creator: CREATOR,
  name: 'Spam',
  purpose: 'app.bsky.graph.defs#modlist',
  description: 'Accounts that post spam.',
  listItemCount: 17,
  labels: [],
  viewer: {
    muted: false,
    blocked: 'at://did:plc:me/app.bsky.graph.listblock/3kb',
  },
  indexedAt: '2024-03-03T00:00:00.000Z',
};
const POST_VIEW = (embed) => ({
  uri: POST_URI,
  cid: POST_CID,
  author: AUTHOR,
  record: {
    $type: 'app.bsky.feed.post',
    text: 'Hello',
    createdAt: '2024-09-01T10:00:00.000Z',
  },
  ...(embed ? { embed } : {}),
  bookmarkCount: 1,
  replyCount: 2,
  repostCount: 3,
  likeCount: 4,
  quoteCount: 5,
  indexedAt: '2024-09-01T10:00:01.000Z',
  viewer: {
    like: 'at://did:plc:me/app.bsky.feed.like/3kl',
    bookmarked: true,
    threadMuted: false,
    embeddingDisabled: false,
  },
  labels: [
    {
      src: 'did:plc:labeler',
      uri: POST_URI,
      val: 'nudity',
      cts: '2024-09-01T10:00:02.000Z',
      ver: 1,
      neg: false,
    },
  ],
  threadgate: {
    uri: 'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.threadgate/3l3qo2vutsw2b',
    cid: 'bafyreigate',
    record: {
      $type: 'app.bsky.feed.threadgate',
      post: POST_URI,
      allow: [],
      createdAt: '2024-09-01T10:00:00.000Z',
    },
    lists: [],
  },
});

const SAMPLES = [
  [
    'PostRecord',
    'every field',
    {
      $type: 'app.bsky.feed.post',
      text: 'Herons 🪶 at @jo.test, see https://example.com #birds',
      facets: [
        {
          $type: 'app.bsky.richtext.facet',
          index: { byteStart: 15, byteEnd: 23 },
          features: [
            { $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:jo' },
          ],
        },
        {
          index: { byteStart: 29, byteEnd: 48 },
          features: [
            {
              $type: 'app.bsky.richtext.facet#link',
              uri: 'https://example.com',
            },
          ],
        },
        {
          index: { byteStart: 49, byteEnd: 55 },
          features: [
            { $type: 'app.bsky.richtext.facet#tag', tag: 'birds' },
            { $type: 'blue.moji.facet', name: 'heron' },
          ],
        },
      ],
      reply: { root: REF, parent: { uri: `${POST_URI}x`, cid: POST_CID } },
      embed: {
        $type: 'app.bsky.embed.recordWithMedia',
        record: RECORD,
        media: IMAGES,
      },
      langs: ['en', 'fr'],
      labels: {
        $type: 'com.atproto.label.defs#selfLabels',
        values: [{ val: 'graphic-media' }],
      },
      tags: ['birds', 'estuary'],
      createdAt: '2026-11-12T09:30:00.000Z',
    },
  ],
  [
    'PostRecord',
    'images',
    {
      $type: 'app.bsky.feed.post',
      text: '',
      embed: IMAGES,
      createdAt: '2026-11-12T09:30:00.000Z',
    },
  ],
  [
    'PostRecord',
    'video',
    {
      $type: 'app.bsky.feed.post',
      text: 'clip',
      embed: VIDEO,
      createdAt: '2026-11-12T09:30:00.000Z',
    },
  ],
  [
    'PostRecord',
    'external',
    {
      $type: 'app.bsky.feed.post',
      text: 'link',
      embed: EXTERNAL,
      createdAt: '2026-11-12T09:30:00.000Z',
    },
  ],
  [
    'PostRecord',
    'record',
    {
      $type: 'app.bsky.feed.post',
      text: 'quote',
      embed: RECORD,
      createdAt: '2026-11-12T09:30:00.000Z',
    },
  ],
  [
    'PostRecord',
    'gallery',
    {
      $type: 'app.bsky.feed.post',
      text: 'gallery',
      embed: GALLERY,
      createdAt: '2026-11-12T09:30:00.000Z',
    },
  ],
  [
    'PostRecord',
    'recordWithMedia video',
    {
      $type: 'app.bsky.feed.post',
      text: 'quote with clip',
      embed: {
        $type: 'app.bsky.embed.recordWithMedia',
        record: RECORD,
        media: VIDEO,
      },
      createdAt: '2026-11-12T09:30:00.000Z',
    },
  ],
  [
    'PostRecord',
    'an embed this version does not know',
    {
      $type: 'app.bsky.feed.post',
      text: 'poll',
      embed: { $type: 'com.example.poll', options: ['a', 'b'] },
      createdAt: '2026-11-12T09:30:00.000Z',
    },
  ],
  [
    'PostRecord',
    'a known embed that is malformed',
    {
      $type: 'app.bsky.feed.post',
      text: 'broken',
      embed: { $type: 'app.bsky.embed.images', images: 'not a list' },
      createdAt: '2026-11-12T09:30:00.000Z',
    },
  ],
  [
    'PostRecord',
    'fields a newer lexicon adds, and one of the wrong type',
    {
      $type: 'app.bsky.feed.post',
      text: 'future',
      langs: 'en',
      createdAt: '2026-11-12T09:30:00.000Z',
      via: 'some-client',
      bridgyOriginalUrl: 'https://mastodon.example/@a/1',
      nested: { deep: [1, 2, { x: null }] },
    },
  ],
  [
    'ThreadgateRecord',
    'every rule',
    {
      $type: 'app.bsky.feed.threadgate',
      post: POST_URI,
      allow: [
        { $type: 'app.bsky.feed.threadgate#mentionRule' },
        { $type: 'app.bsky.feed.threadgate#followerRule' },
        { $type: 'app.bsky.feed.threadgate#followingRule' },
        {
          $type: 'app.bsky.feed.threadgate#listRule',
          list: 'at://did:plc:me/app.bsky.graph.list/3kl',
        },
        { $type: 'app.bsky.feed.threadgate#verifiedRule' },
        { $type: 'app.bsky.feed.threadgate#mentionRule', note: 'extra' },
      ],
      createdAt: '2026-11-12T09:30:00.000Z',
      hiddenReplies: [`${POST_URI}r`],
    },
  ],
  [
    'ThreadgateRecord',
    'nobody',
    {
      $type: 'app.bsky.feed.threadgate',
      post: POST_URI,
      allow: [],
      createdAt: '2026-11-12T09:30:00.000Z',
      hiddenReplies: [],
    },
  ],
  [
    'ThreadgateRecord',
    'everybody',
    {
      $type: 'app.bsky.feed.threadgate',
      post: POST_URI,
      createdAt: '2026-11-12T09:30:00.000Z',
    },
  ],
  [
    'PostgateRecord',
    'no quotes',
    {
      $type: 'app.bsky.feed.postgate',
      post: POST_URI,
      createdAt: '2026-11-12T09:30:00.000Z',
      detachedEmbeddingUris: [`${POST_URI}q`],
      embeddingRules: [
        { $type: 'app.bsky.feed.postgate#disableRule' },
        { $type: 'app.bsky.feed.postgate#futureRule' },
      ],
    },
  ],
  [
    'LikeRecord',
    'via a repost',
    {
      $type: 'app.bsky.feed.like',
      subject: REF,
      createdAt: '2026-11-12T09:30:00.000Z',
      via: {
        uri: 'at://did:plc:x/app.bsky.feed.repost/3k',
        cid: 'bafyreirepost',
      },
    },
  ],
  [
    'RepostRecord',
    'plain',
    {
      $type: 'app.bsky.feed.repost',
      subject: REF,
      createdAt: '2026-11-12T09:30:00.000Z',
    },
  ],
  [
    'FollowRecord',
    'plain',
    {
      $type: 'app.bsky.graph.follow',
      subject: 'did:plc:jo',
      createdAt: '2026-11-12T09:30:00.000Z',
    },
  ],
  [
    'BlockRecord',
    'plain',
    {
      $type: 'app.bsky.graph.block',
      subject: 'did:plc:spam',
      createdAt: '2026-11-12T09:30:00.000Z',
    },
  ],
  [
    'ListRecord',
    'every field',
    {
      $type: 'app.bsky.graph.list',
      purpose: 'app.bsky.graph.defs#curatelist',
      name: 'Birders',
      description: 'People who #bird',
      descriptionFacets: [
        {
          index: { byteStart: 11, byteEnd: 16 },
          features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'bird' }],
        },
      ],
      avatar: BLOB(IMG, 'image/png', 100),
      labels: { $type: 'com.atproto.label.defs#selfLabels', values: [] },
      createdAt: '2026-11-12T09:30:00.000Z',
    },
  ],
  [
    'ListItemRecord',
    'plain',
    {
      $type: 'app.bsky.graph.listitem',
      subject: 'did:plc:jo',
      list: 'at://did:plc:me/app.bsky.graph.list/3kl',
      createdAt: '2026-11-12T09:30:00.000Z',
    },
  ],
  [
    'ListBlockRecord',
    'plain',
    {
      $type: 'app.bsky.graph.listblock',
      subject: 'at://did:plc:x/app.bsky.graph.list/3kl',
      createdAt: '2026-11-12T09:30:00.000Z',
    },
  ],
  [
    'StarterPackRecord',
    'plain',
    {
      $type: 'app.bsky.graph.starterpack',
      name: 'Birds',
      description: 'Start here',
      list: 'at://did:plc:me/app.bsky.graph.list/3kl',
      feeds: [{ uri: GENERATOR_VIEW.uri }],
      createdAt: '2026-11-12T09:30:00.000Z',
    },
  ],
  [
    'ProfileRecord',
    'every field',
    {
      $type: 'app.bsky.actor.profile',
      displayName: 'Mira',
      description: 'Herons.',
      pronouns: 'she/her',
      website: 'https://mira.example',
      avatar: BLOB(IMG, 'image/jpeg', 9000),
      banner: BLOB(IMG, 'image/jpeg', 90000),
      labels: {
        $type: 'com.atproto.label.defs#selfLabels',
        values: [{ val: '!no-unauthenticated' }],
      },
      joinedViaStarterPack: REF,
      pinnedPost: REF,
      createdAt: '2023-01-01T00:00:00.000Z',
    },
  ],
  [
    'GeneratorRecord',
    'plain',
    {
      $type: 'app.bsky.feed.generator',
      did: 'did:web:feeds.example.com',
      displayName: 'Herons',
      description: 'Only herons',
      avatar: BLOB(IMG, 'image/png', 1),
      acceptsInteractions: false,
      contentMode: 'app.bsky.feed.defs#contentModeUnspecified',
      createdAt: '2024-01-01T00:00:00.000Z',
    },
  ],
  [
    'TemplateRecord',
    'with blanks',
    {
      $type: 'net.anisota.feed.template',
      name: 'Thanks',
      text: 'Thanks {{their.firstName}}! {{ thing }}',
      variables: [
        {
          key: 'thing',
          label: 'What for',
          kind: 'choice',
          choices: ['the photo', 'the tip'],
          default: 'the photo',
          optional: true,
        },
      ],
      embed: RECORD,
      use: 'reply',
      group: 'Replies',
      shortcut: 'thx',
      keywords: ['thanks'],
      langs: ['en'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
    },
  ],
  [
    'Draft',
    'every embed, and the web own fields',
    {
      $type: 'app.bsky.draft.defs#draft',
      deviceName: 'Virga',
      deviceId: '6f1d1c7e-1111-4222-8333-944444444444',
      posts: [
        {
          $type: 'app.bsky.draft.defs#draftPost',
          text: 'First',
          labels: {
            $type: 'com.atproto.label.defs#selfLabels',
            values: [{ val: 'sexual' }],
          },
          embedImages: [
            {
              $type: 'app.bsky.draft.defs#draftEmbedImage',
              localRef: { path: 'img-1' },
              alt: 'one',
            },
          ],
          embedVideos: [
            {
              $type: 'app.bsky.draft.defs#draftEmbedVideo',
              localRef: { path: 'vid-1' },
              captions: [{ lang: 'en', content: 'WEBVTT' }],
            },
          ],
          embedExternals: [
            {
              $type: 'app.bsky.draft.defs#draftEmbedExternal',
              uri: 'https://example.com',
            },
          ],
          embedRecords: [
            { $type: 'app.bsky.draft.defs#draftEmbedRecord', record: REF },
          ],
          facets: [
            {
              index: { byteStart: 0, byteEnd: 5 },
              features: [
                {
                  $type: 'app.bsky.richtext.facet#link',
                  uri: 'https://example.com',
                },
              ],
            },
          ],
          tags: ['birds'],
          embed: IMAGES,
          reply: { root: REF, parent: REF },
          virgaCard: {
            thumb: 'https://cardyb.bsky.app/v1/image?url=x',
            edited: true,
          },
        },
        { text: 'Second, written by another app', someOtherAppField: 1 },
      ],
      langs: ['en'],
      threadgateAllow: [{ $type: 'app.bsky.feed.threadgate#followingRule' }],
      postgateEmbeddingRules: [],
    },
  ],
  [
    'PostView',
    'images',
    POST_VIEW({
      $type: 'app.bsky.embed.images#view',
      images: VIEW_RECORD.embeds[0].images,
    }),
  ],
  [
    'PostView',
    'video',
    POST_VIEW({
      $type: 'app.bsky.embed.video#view',
      cid: 'bafkreivid',
      playlist: 'https://video.bsky.app/watch/x/playlist.m3u8',
      thumbnail: 'https://video.bsky.app/watch/x/thumbnail.jpg',
      alt: 'clip',
      aspectRatio: { width: 9, height: 16 },
      presentation: 'default',
    }),
  ],
  [
    'PostView',
    'external',
    POST_VIEW({
      $type: 'app.bsky.embed.external#view',
      external: {
        uri: 'https://example.com',
        title: 'Example',
        description: '',
        thumb: 'https://cdn.bsky.app/img/feed_thumbnail/plain/y@jpeg',
      },
    }),
  ],
  [
    'PostView',
    'a quoted post',
    POST_VIEW({ $type: 'app.bsky.embed.record#view', record: VIEW_RECORD }),
  ],
  [
    'PostView',
    'a quote gone',
    POST_VIEW({
      $type: 'app.bsky.embed.record#view',
      record: {
        $type: 'app.bsky.embed.record#viewNotFound',
        uri: POST_URI,
        notFound: true,
      },
    }),
  ],
  [
    'PostView',
    'a quote blocked',
    POST_VIEW({
      $type: 'app.bsky.embed.record#view',
      record: {
        $type: 'app.bsky.embed.record#viewBlocked',
        uri: POST_URI,
        blocked: true,
        author: { did: AUTHOR.did, viewer: { blockedBy: true } },
      },
    }),
  ],
  [
    'PostView',
    'a quote detached',
    POST_VIEW({
      $type: 'app.bsky.embed.record#view',
      record: {
        $type: 'app.bsky.embed.record#viewDetached',
        uri: POST_URI,
        detached: true,
      },
    }),
  ],
  [
    'PostView',
    'a feed',
    POST_VIEW({ $type: 'app.bsky.embed.record#view', record: GENERATOR_VIEW }),
  ],
  [
    'PostView',
    'a list',
    POST_VIEW({ $type: 'app.bsky.embed.record#view', record: LIST_VIEW }),
  ],
  [
    'PostView',
    'a labeler',
    POST_VIEW({
      $type: 'app.bsky.embed.record#view',
      record: {
        $type: 'app.bsky.labeler.defs#labelerView',
        uri: 'at://did:plc:labeler/app.bsky.labeler.service/self',
        cid: 'bafyreilab',
        creator: CREATOR,
        likeCount: 2,
        viewer: {},
        indexedAt: '2024-01-01T00:00:00.000Z',
        labels: [],
      },
    }),
  ],
  [
    'PostView',
    'a starter pack',
    POST_VIEW({
      $type: 'app.bsky.embed.record#view',
      record: {
        $type: 'app.bsky.graph.defs#starterPackViewBasic',
        uri: 'at://did:plc:creator/app.bsky.graph.starterpack/3ks',
        cid: 'bafyreisp',
        record: {
          $type: 'app.bsky.graph.starterpack',
          name: 'Birds',
          list: LIST_VIEW.uri,
          createdAt: '2024-01-01T00:00:00.000Z',
        },
        creator: { did: CREATOR.did, handle: CREATOR.handle },
        listItemCount: 20,
        joinedWeekCount: 1,
        joinedAllTimeCount: 9,
        labels: [],
        indexedAt: '2024-01-01T00:00:00.000Z',
      },
    }),
  ],
  [
    'PostView',
    'a quote with media',
    POST_VIEW({
      $type: 'app.bsky.embed.recordWithMedia#view',
      record: { record: VIEW_RECORD },
      media: {
        $type: 'app.bsky.embed.gallery#view',
        items: [
          {
            thumbnail: 'https://t/1',
            fullsize: 'https://f/1',
            alt: 'g',
            aspectRatio: { width: 2, height: 1 },
          },
        ],
      },
    }),
  ],
  [
    'PostView',
    'an embed view this version does not know',
    POST_VIEW({ $type: 'com.example.embed#view', x: 1 }),
  ],
  [
    'FeedViewPost',
    'a repost of a reply in a broken thread',
    {
      post: POST_VIEW(null),
      reply: {
        root: {
          $type: 'app.bsky.feed.defs#blockedPost',
          uri: `${POST_URI}root`,
          blocked: true,
          author: { did: 'did:plc:blocker' },
        },
        parent: {
          $type: 'app.bsky.feed.defs#notFoundPost',
          uri: `${POST_URI}parent`,
          notFound: true,
        },
        grandparentAuthor: { did: 'did:plc:gp', handle: 'gp.test' },
      },
      reason: {
        $type: 'app.bsky.feed.defs#reasonRepost',
        by: { did: 'did:plc:fan', handle: 'fan.test' },
        uri: 'at://did:plc:fan/app.bsky.feed.repost/3kr',
        cid: 'bafyreirp',
        indexedAt: '2026-11-12T09:31:00.000Z',
      },
      feedContext: 'ctx',
      reqId: 'req-1',
    },
  ],
  [
    'FeedViewPost',
    'a pinned post replying in a thread',
    {
      post: POST_VIEW(null),
      reply: {
        root: { $type: 'app.bsky.feed.defs#postView', ...POST_VIEW(null) },
        parent: { $type: 'app.bsky.feed.defs#postView', ...POST_VIEW(null) },
      },
      reason: { $type: 'app.bsky.feed.defs#reasonPin' },
    },
  ],
  [
    'GetPostThreadOutput',
    'a thread with gaps',
    {
      thread: {
        $type: 'app.bsky.feed.defs#threadViewPost',
        post: POST_VIEW(null),
        parent: {
          $type: 'app.bsky.feed.defs#threadViewPost',
          post: POST_VIEW(null),
          parent: {
            $type: 'app.bsky.feed.defs#notFoundPost',
            uri: `${POST_URI}gone`,
            notFound: true,
          },
        },
        replies: [
          {
            $type: 'app.bsky.feed.defs#threadViewPost',
            post: POST_VIEW(null),
            replies: [],
          },
          {
            $type: 'app.bsky.feed.defs#blockedPost',
            uri: `${POST_URI}b`,
            blocked: true,
            author: {
              did: 'did:plc:b',
              viewer: { blocking: 'at://did:plc:me/app.bsky.graph.block/3k' },
            },
          },
        ],
        threadContext: {
          rootAuthorLike:
            'at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.like/3k',
        },
      },
      threadgate: POST_VIEW(null).threadgate,
    },
  ],
  [
    'GetPostThreadOutput',
    'a post that is gone',
    {
      thread: {
        $type: 'app.bsky.feed.defs#notFoundPost',
        uri: POST_URI,
        notFound: true,
      },
    },
  ],
  [
    'GetRelationshipsOutput',
    'both kinds',
    {
      actor: 'did:plc:me',
      relationships: [
        {
          $type: 'app.bsky.graph.defs#relationship',
          did: 'did:plc:jo',
          following: 'at://did:plc:me/app.bsky.graph.follow/3k',
          followedBy: 'at://did:plc:jo/app.bsky.graph.follow/3j',
          blocking: 'at://did:plc:me/app.bsky.graph.block/3b',
          blockedBy: 'at://did:plc:jo/app.bsky.graph.block/3c',
          blockingByList: 'at://did:plc:me/app.bsky.graph.listblock/3d',
          blockedByList: 'at://did:plc:jo/app.bsky.graph.listblock/3e',
        },
        {
          $type: 'app.bsky.graph.defs#notFoundActor',
          actor: 'did:plc:gone',
          notFound: true,
        },
      ],
    },
  ],
  [
    'GetPreferencesOutput',
    'kinds Virga reads, and one it does not',
    {
      preferences: [
        {
          $type: 'app.bsky.actor.defs#postInteractionSettingsPref',
          threadgateAllowRules: [
            { $type: 'app.bsky.feed.threadgate#mentionRule' },
          ],
          postgateEmbeddingRules: [
            { $type: 'app.bsky.feed.postgate#disableRule' },
          ],
        },
        {
          $type: 'app.bsky.actor.defs#savedFeedsPrefV2',
          items: [
            {
              type: 'timeline',
              value: 'following',
              pinned: true,
              id: '3l6ovcmm2vd2j',
            },
            {
              type: 'feed',
              value: GENERATOR_VIEW.uri,
              pinned: false,
              id: '3l6ovcmm2vd2k',
            },
          ],
        },
        {
          $type: 'app.bsky.actor.defs#savedFeedsPref',
          pinned: [GENERATOR_VIEW.uri],
          saved: [GENERATOR_VIEW.uri],
          timelineIndex: 0,
        },
        { $type: 'app.bsky.actor.defs#adultContentPref', enabled: false },
        {
          $type: 'app.bsky.actor.defs#postInteractionSettingsPref',
          newField: 'kept',
        },
      ],
    },
  ],
  [
    'ListNotificationsOutput',
    'a reply',
    {
      cursor: 'c1',
      notifications: [
        {
          uri: `${POST_URI}r`,
          cid: POST_CID,
          author: CREATOR,
          reason: 'reply',
          reasonSubject: POST_URI,
          record: {
            $type: 'app.bsky.feed.post',
            text: 'Nice',
            reply: { root: REF, parent: REF },
            createdAt: '2026-11-12T09:30:00.000Z',
          },
          isRead: false,
          indexedAt: '2026-11-12T09:30:01.000Z',
          labels: [],
        },
      ],
      priority: false,
      seenAt: '2026-11-12T09:00:00.000Z',
    },
  ],
  [
    'ProfileViewDetailed',
    'every field',
    {
      ...AUTHOR,
      description: 'Official',
      pronouns: 'it/its',
      website: 'https://bsky.app',
      banner: 'https://cdn.bsky.app/img/banner/plain/x@jpeg',
      followersCount: 30000000,
      followsCount: 5,
      postsCount: 700,
      indexedAt: '2024-01-01T00:00:00.000Z',
      pinnedPost: REF,
      associated: {
        lists: 2,
        feedgens: 1,
        starterPacks: 3,
        labeler: false,
        chat: { allowIncoming: 'following', allowGroupInvites: 'none' },
      },
      viewer: {
        ...AUTHOR.viewer,
        mutedByList: {
          uri: LIST_VIEW.uri,
          cid: LIST_VIEW.cid,
          name: 'Mutes',
          purpose: 'app.bsky.graph.defs#modlist',
        },
        activitySubscription: { post: true, reply: false },
      },
      joinedViaStarterPack: {
        uri: 'at://did:plc:creator/app.bsky.graph.starterpack/3ks',
        cid: 'bafyreisp',
        record: {},
        creator: { did: CREATOR.did, handle: CREATOR.handle },
        indexedAt: '2024-01-01T00:00:00.000Z',
      },
      status: {
        status: 'app.bsky.actor.status#live',
        record: {
          $type: 'app.bsky.actor.status',
          status: 'app.bsky.actor.status#live',
        },
        embed: {
          $type: 'app.bsky.embed.external#view',
          external: {
            uri: 'https://stream.example',
            title: 'Live',
            description: '',
          },
        },
        expiresAt: '2026-11-12T10:00:00.000Z',
        isActive: true,
      },
    },
  ],
  [
    'DIDDocument',
    'a did:plc with its key',
    {
      '@context': [
        'https://www.w3.org/ns/did/v1',
        'https://w3id.org/security/multikey/v1',
        'https://w3id.org/security/suites/secp256k1-2019/v1',
      ],
      id: 'did:plc:z72i7hdynmk6r22z27h6tvur',
      alsoKnownAs: ['at://bsky.app'],
      verificationMethod: [
        {
          id: 'did:plc:z72i7hdynmk6r22z27h6tvur#atproto',
          type: 'Multikey',
          controller: 'did:plc:z72i7hdynmk6r22z27h6tvur',
          publicKeyMultibase:
            'zQ3shQo6TF2moaqMTrUZEM1jeuYRQXeHEx4evX9751y2qPqRA',
        },
      ],
      service: [
        {
          id: '#atproto_pds',
          type: 'AtprotoPersonalDataServer',
          serviceEndpoint: 'https://puffball.us-east.host.bsky.network',
        },
        {
          id: '#other',
          type: 'Other',
          serviceEndpoint: { origins: ['https://a'] },
        },
      ],
    },
  ],
  [
    'VideoJobStatusOutput',
    'complete',
    {
      jobStatus: {
        jobId: 'job-1',
        did: 'did:plc:me',
        state: 'JOB_STATE_COMPLETED',
        progress: 100,
        blob: BLOB(VID, 'video/mp4', 4800000),
      },
    },
  ],
  [
    'VideoJobStatusOutput',
    'failed',
    {
      jobStatus: {
        jobId: 'job-2',
        did: 'did:plc:me',
        state: 'JOB_STATE_FAILED',
        error: 'Video too long',
        message: 'Videos can be up to 3 minutes',
      },
    },
  ],
  [
    'VideoUploadLimits',
    'can upload',
    {
      canUpload: true,
      remainingDailyVideos: 24,
      remainingDailyBytes: 9500000000,
    },
  ],
  [
    'ApplyWritesInput',
    'a post with its gates',
    {
      repo: 'did:plc:me',
      writes: [
        {
          $type: 'com.atproto.repo.applyWrites#create',
          collection: 'app.bsky.feed.post',
          rkey: '3kabc',
          value: {
            $type: 'app.bsky.feed.post',
            text: 'hi',
            createdAt: '2026-11-12T09:30:00.000Z',
          },
        },
        {
          $type: 'com.atproto.repo.applyWrites#update',
          collection: 'app.bsky.feed.threadgate',
          rkey: '3kabc',
          value: {
            $type: 'app.bsky.feed.threadgate',
            post: POST_URI,
            createdAt: '2026-11-12T09:30:00.000Z',
            allow: [],
          },
        },
        {
          $type: 'com.atproto.repo.applyWrites#delete',
          collection: 'app.bsky.feed.postgate',
          rkey: '3kabc',
        },
      ],
    },
  ],
  [
    'ApplyWritesOutput',
    'results',
    {
      commit: { cid: 'bafyreicommit', rev: '3kabcrev22222' },
      results: [
        {
          $type: 'com.atproto.repo.applyWrites#createResult',
          uri: `${POST_URI}`,
          cid: POST_CID,
          validationStatus: 'valid',
        },
        {
          $type: 'com.atproto.repo.applyWrites#updateResult',
          uri: POST_URI,
          cid: POST_CID,
        },
        { $type: 'com.atproto.repo.applyWrites#deleteResult' },
      ],
    },
  ],
  [
    'WriteRecordOutput',
    'createRecord',
    {
      uri: POST_URI,
      cid: POST_CID,
      commit: { cid: 'bafyreicommit', rev: '3kabcrev22222' },
      validationStatus: 'valid',
    },
  ],
  [
    'GetRecordOutput',
    'getRecord',
    {
      uri: POST_URI,
      cid: POST_CID,
      value: {
        $type: 'app.bsky.feed.post',
        text: 'hi',
        createdAt: '2026-11-12T09:30:00.000Z',
      },
    },
  ],
  // The harness's searchPosts mints its results' keys from the clock.
  [
    'SearchPostsOutput',
    'searchPosts',
    { cursor: '25', hitsTotal: 3, posts: [POST_VIEW(IMAGES_VIEW)] },
  ],
  ['UploadBlobOutput', 'uploadBlob', { blob: BLOB(IMG, 'image/jpeg', 341000) }],
  [
    'GetStarterPackOutput',
    'getStarterPack',
    {
      starterPack: {
        uri: 'at://did:plc:creator/app.bsky.graph.starterpack/3ks',
        cid: 'bafyreisp',
        record: {
          $type: 'app.bsky.graph.starterpack',
          name: 'Birds',
          list: LIST_VIEW.uri,
          createdAt: '2024-01-01T00:00:00.000Z',
        },
        creator: { did: CREATOR.did, handle: CREATOR.handle },
        list: {
          uri: LIST_VIEW.uri,
          cid: LIST_VIEW.cid,
          name: 'Birds',
          purpose: 'app.bsky.graph.defs#referencelist',
          listItemCount: 2,
        },
        listItemsSample: [
          {
            uri: 'at://did:plc:creator/app.bsky.graph.listitem/3ki',
            subject: CREATOR,
          },
        ],
        feeds: [GENERATOR_VIEW],
        joinedWeekCount: 1,
        joinedAllTimeCount: 2,
        labels: [],
        indexedAt: '2024-01-01T00:00:00.000Z',
      },
    },
  ],
];

export default async function cases() {
  const fromHarness = await harness();
  const samples = SAMPLES.map(([type, from, json]) => ({ type, from, json }));
  const all = [...fromHarness, ...samples];
  // The JSON is the case's output (once, not in the input too): the Swift
  // test decodes it as `type` and must encode it back the same, unless it
  // lacks a field its lexicon requires (`missing`, from @atproto/api's own
  // lexicons): the harness keeps some records to the fields the web reads,
  // and a record without its required fields must not read as one.
  return each(
    'roundTrip',
    all.map(({ type, from, json }, index) => ({
      $id: `${index + 1} ${type} ${from}`,
      type,
      from,
      index,
      missing: missingRequired(json),
    })),
    ({ index }) => all[index].json,
  );
}
