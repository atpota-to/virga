// Archives for the report generators (insights.models*.js, insights.share
// .js, insights.interaction.js): the made-up accounts of the harness
// (harness/world.js) as the sync would have archived them, through the web's
// own shapers, cut down so a fixture can hold them; and small hand-made ones
// for the edges. A fixture holds each archive once (`archive` value cases);
// the cases name it. Swift: ios/VirgaKit/Tests/VirgaInsightsTests/
// ReportsTestSupport.swift reads them back into a ReportArchive.

import { LAB, ME, buildWorld, postRecord } from '../../../harness/world.js';
import {
  POST_ROW_VERSION,
  compactPostFromRecord,
  inboundFromNotification,
  outboundFromRecord,
} from '../../../src/lib/analytics.js';
import { followFromRecord } from '../../../src/lib/analyticsSync.js';
import { rkeyFromAtUri, tidToTimestamp } from '../../../src/lib/atproto.js';
import {
  followerChanges,
  mergeFollowerLog,
} from '../../../src/lib/followerLog.js';
import { each, toJSON, value } from './_helpers.js';
import { under } from './_archive.js';
import { ANALYTICS_PERIODS } from '../../../src/lib/analytics.js';
import { customPeriod } from '../../../src/lib/periods.js';
import {
  atmosphereModel,
  bestTimeModel,
  blocksModel,
  contentModel,
  engagementModel,
  followBackModel,
  followerLogModel,
  followersModel,
  givenModel,
  listsModel,
  peopleModel,
  postsModel,
  relationSets,
} from '../../../src/reports/models.js';

/** Where the harness worlds are built: a Saturday afternoon in November. */
export const NOW = Date.UTC(2026, 10, 14, 15, 0, 0);
export const DAY = 86_400_000;

const every = (list, n, offset = 0) =>
  list.filter((_, i) => i % n === offset % n);

const LIST_PURPOSE = {
  'app.bsky.graph.defs#modlist': 'moderation',
  'app.bsky.graph.defs#referencelist': 'reference',
};

/**
 * A harness world as the archive holds it after a full sync, with every
 * store thinned (`thin` is how many of each to keep one of), so the numbers
 * still have the world's shape: a curve of followers, bursts, a quiet
 * month, threads, replies to other people, tags, links and pictures.
 */
export function worldArchive({ account = ME, now = NOW, thin = {} } = {}) {
  const world = buildWorld({ now, account });
  const did = world.me.did;
  const t = {
    posts: 4,
    followers: 25,
    notifications: 14,
    likes: 50,
    reposts: 8,
    blocks: 3,
    subscribers: 8,
    others: 40,
    ...thin,
  };

  const posts = every(world.posts, t.posts).map((p) => {
    const uri = `at://${did}/app.bsky.feed.post/${p.rkey}`;
    const row = compactPostFromRecord(uri, postRecord(p));
    return {
      ...row,
      // The words only matter to the Interaction lookup; a few of them do.
      text: [...row.text].slice(0, 24).join(''),
      likes: p.likes,
      reposts: p.reposts,
      replies: p.replies,
      quotes: p.quotes,
    };
  });

  const followerRow = (f) => ({
    did: f.did,
    handle: f.handle || '',
    displayName: f.displayName || '',
    avatar: f.avatar || '',
    followedAt: tidToTimestamp(rkeyFromAtUri(f.viewer?.followedBy)),
  });
  const allFollowers = world.followers.map(followerRow);
  const followers = every(allFollowers, t.followers);
  // The last sync saw a few more, and a few fewer: the follower log.
  const before = [
    ...every(allFollowers, t.followers, 7).slice(0, 4),
    ...followers.slice(3),
  ];
  const at1 = now - 9 * DAY;
  const at2 = now - 2 * DAY;
  const log1 = mergeFollowerLog(
    null,
    followerChanges(before.slice(2), before, { at: at1, since: at1 - DAY }),
    at1,
  );
  const followerLog = mergeFollowerLog(
    log1,
    followerChanges(before, followers, { at: at2, since: at1 }),
    at2,
  );

  const following = world.follows.map(followFromRecord).filter(Boolean);
  const inbound = every(world.notifications, t.notifications)
    .map(inboundFromNotification)
    .filter(Boolean);
  const outbound = [
    ...every(world.likes, t.likes).map((r) => outboundFromRecord('like', r)),
    ...every(world.reposts, t.reposts).map((r) =>
      outboundFromRecord('repost', r),
    ),
  ].filter(Boolean);

  const blocks = every(world.blockers, t.blocks).map((b) => ({
    uri: `at://${b.did}/${b.collection}/${b.rkey}`,
    did: b.did,
    source: 'direct',
    blockedAt: tidToTimestamp(b.rkey),
  }));
  const lists = [];
  for (const list of world.lists) {
    const purpose = LIST_PURPOSE[list.purpose] || 'curation';
    const memberAt = tidToTimestamp(list.item.rkey);
    const subs = every(list.subscribers, t.subscribers);
    lists.push({
      uri: list.uri,
      owner: list.item.did,
      name: list.name,
      purpose,
      memberAt,
      subscribers: purpose === 'moderation' ? list.subscribers.length : null,
    });
    for (const s of subs) {
      const subscribed = tidToTimestamp(s.rkey);
      blocks.push({
        uri: `list:${list.uri}:at://${s.did}/${s.collection}/${s.rkey}`,
        did: s.did,
        source: 'list',
        listUri: list.uri,
        blockedAt: memberAt > subscribed ? memberAt : subscribed,
      });
    }
  }

  const atmosphere = every(world.others, t.others).map((r) => ({
    uri: `at://${did}/${r.collection}/${r.rkey}`,
    collection: r.collection,
    at: Date.parse(r.value.createdAt),
  }));

  const syncedAt = now - 2 * DAY;
  return {
    did,
    handle: world.me.handle,
    posts,
    followers,
    following,
    blocks,
    inbound,
    outbound,
    atmosphere,
    meta: {
      posts: { shape: POST_ROW_VERSION, complete: true, syncedAt },
      followers: {
        count: followers.length,
        profileCount: followers.length + 13,
        complete: true,
        syncedAt,
      },
      following: { count: following.length, complete: true, syncedAt },
      blocks: { count: 0, pathCount: blocks.length, version: 2, syncedAt },
      inbound: {
        coverageMs: now - 150 * DAY,
        truncated: false,
        syncedAt,
      },
      outbound: { coverageMs: 0, syncedAt },
      lists: { lists, syncedAt },
      followerLog,
    },
  };
}

/** The two harness accounts, thinned, as their JSON reads back. */
export function harnessArchives() {
  return roundTrip({
    mira: worldArchive({ account: ME }),
    lab: worldArchive({
      account: LAB,
      thin: { posts: 1, followers: 1, notifications: 2, likes: 3, reposts: 1 },
    }),
  });
}

/** A value as its JSON text reads back: what a fixture holds of it. */
export function roundTrip(value) {
  return JSON.parse(JSON.stringify(value));
}

/** An archive with nothing in it, as a fresh account's is. */
export function emptyArchive(did = 'did:plc:empty') {
  return {
    did,
    handle: null,
    posts: [],
    followers: [],
    following: [],
    blocks: [],
    inbound: [],
    outbound: [],
    atmosphere: [],
    meta: {},
  };
}

/**
 * Archives as value cases, so a fixture holds each once; `name` is the
 * case's id, and the value is the archive's JSON text (one line, not the
 * fixture's indented form). Cases name the archive and give the revision,
 * "now" and the formats they run in.
 */
export function archiveCases(archives) {
  return Object.entries(archives).map(([name, archive]) =>
    value('archive', JSON.stringify(archive), name),
  );
}

/**
 * The archive as the report models read it (`useArchive()`): the rows, the
 * context's now, and a revision of its own for each case, so the models'
 * cache (keyed by revision and the locale, not the zone) never serves one
 * case another's numbers. `contexts(base)` numbers them from `base` afresh
 * on every run, so a fixture written twice is the same.
 */
export function contexts(base) {
  let rev = base;
  return (archive, nowMs) => {
    rev += 1;
    return { ...archive, rev, followRev: 0, nowMs };
  };
}

/* ------------------------------------------------------------------ */
/* Hand-made archives for the edges                                     */
/* ------------------------------------------------------------------ */

const ME_DID = 'did:plc:me';
// Built in UTC (the runner's zone), at a fixed noon.
const EDGE_NOW = Date.UTC(2026, 10, 12, 12);

/** A post on the given day offset and hour (UTC), with `likes` likes. */
function timedPost(daysAgo, hour, likes, extra = {}) {
  const d = new Date(EDGE_NOW - daysAgo * DAY);
  d.setUTCHours(hour, 15, 0, 0);
  return {
    uri: `at://${ME_DID}/app.bsky.feed.post/${daysAgo}-${hour}-${likes}`,
    rkey: `${daysAgo}-${hour}-${likes}`,
    at: d.toISOString(),
    likes,
    reposts: 0,
    replies: 0,
    quotes: 0,
    ...extra,
  };
}

/** The models' own tests' archives, and a few more edges. */
export function edgeArchives() {
  const base = (parts) => ({ ...emptyArchive(ME_DID), ...parts });

  // Five weeks of Tuesday-evening posts that earn steadily, one Monday
  // morning post that went round, replies to other people, posts still
  // collecting, and a spread over the week.
  const best = [];
  for (let w = 1; w <= 5; w++)
    best.push(
      timedPost(w * 7 + ((new Date(EDGE_NOW).getUTCDay() + 5) % 7), 19, 40),
    );
  best.push(timedPost(8, 9, 5000));
  best.push(timedPost(10, 9, 10), timedPost(10, 9, 12), timedPost(10, 9, 7));
  best.push(timedPost(10, 9, 99, { replyTo: 'did:plc:someone' }));
  best.push(timedPost(1, 9, 99), timedPost(0, 23, 5));
  for (let i = 0; i < 40; i++)
    best.push(
      timedPost(
        12 + i * 3,
        (i * 5) % 24,
        (i * 7) % 23,
        i % 9 === 0 ? { replyTo: ME_DID } : {},
      ),
    );

  let n = 0;
  const p = (likes, extra = {}) => {
    const rkey = `k${n++}`;
    return {
      ...timedPost(10, 9, likes),
      uri: `at://${ME_DID}/app.bsky.feed.post/${rkey}`,
      rkey,
      len: 40,
      media: null,
      mediaCount: 0,
      altCount: 0,
      tags: [],
      links: [],
      mentions: [],
      langs: ['en'],
      threadOf: null,
      threadKey: null,
      ...extra,
    };
  };
  const opener = p(40);
  const content = [
    p(2),
    p(4),
    p(6),
    p(50, { media: 'image', mediaCount: 1, altCount: 1, hasMedia: true }),
    p(60, { media: 'image', mediaCount: 2, altCount: 1, hasMedia: true }),
    p(70, { media: 'image', mediaCount: 1, hasMedia: true }),
    p(9, { media: 'link', links: ['example.com'] }),
    p(1, { media: 'video', mediaCount: 1, altCount: 0, hasMedia: true }),
    p(3, { media: 'gif', links: ['tenor.com'] }),
    p(5, { quoteOf: 'did:plc:x' }),
    p(8, { quoteOf: 'did:plc:x', media: 'image', mediaCount: 4, altCount: 4 }),
    p(1, { media: 'sticker' }),
    p(1, { len: 0 }),
    p(1, { len: 80 }),
    p(1, { len: 81 }),
    p(1, { len: 160 }),
    p(1, { len: 161 }),
    p(1, { len: 240 }),
    p(1, { len: 241 }),
    p(1, { len: 300 }),
    p(1, { len: 512 }),
    p(10, { tags: ['Gardens', 'bees'] }),
    p(20, { tags: ['gardens'] }),
    p(30, { tags: ['GARDENS'], links: ['example.com'] }),
    p(5, { links: ['example.com', 'other.org'] }),
    p(7, { tags: ['café', 'CAFÉ', 'café', 'Zine', 'zine', 'ΟΔΟΣ', 'οδος'] }),
    p(7, { tags: ['zebra', 'apple', 'Äpfel', 'banana', '日本', '👍'] }),
    p(7, { links: ['b.example', 'a.example', 'A.example'] }),
    p(7, { langs: ['fr', 'en', 'de', 'pt-BR', 'pt-br', 'ja'] }),
    p(7, { langs: [] }),
    opener,
    p(3, { replyTo: ME_DID, threadOf: ME_DID, threadKey: opener.rkey }),
    p(2, { replyTo: ME_DID, threadOf: ME_DID, threadKey: opener.rkey }),
    p(1, { replyTo: ME_DID, threadOf: 'did:plc:someone', threadKey: 'zzz' }),
    p(500, { replyTo: 'did:plc:someone' }),
    { ...p(900), at: new Date(EDGE_NOW - 3_600_000).toISOString() },
    { ...p(99), at: new Date(EDGE_NOW - 40 * DAY).toISOString() },
    // Archived before rows kept what a post is made of.
    {
      ...timedPost(12, 9, 300),
      uri: `at://${ME_DID}/app.bsky.feed.post/old`,
      rkey: 'old',
    },
    {
      ...timedPost(13, 9, 30),
      uri: `at://${ME_DID}/app.bsky.feed.post/old2`,
      rkey: 'old2',
      at: 'not a date',
    },
  ];

  const follower = (did, followedAt, extra = {}) => ({
    did,
    handle: `${did.slice(8)}.example.com`,
    displayName: '',
    avatar: '',
    followedAt,
    ...extra,
  });
  const iso = (daysAgo) => new Date(EDGE_NOW - daysAgo * DAY).toISOString();
  const followers = [
    follower('did:plc:a', iso(1)),
    follower('did:plc:b', iso(1)),
    follower('did:plc:c', iso(3)),
    follower('did:plc:d', iso(40)),
    follower('did:plc:e', iso(400)),
    follower('did:plc:f', null),
    follower('did:plc:g', 'not a date'),
    follower('did:plc:h', ''),
    follower('did:plc:café', iso(2)),
    follower('did:plc:café', iso(2)),
    follower('did:plc:a', iso(5), { handle: 'again.example.com' }),
    follower('did:plc:i', '2026-11-10'),
    follower('did:plc:j', '2026-11-10T08:00:00'),
  ];
  const blocks = [
    {
      uri: 'at://did:plc:x1/app.bsky.graph.block/1',
      did: 'did:plc:x1',
      source: 'direct',
      blockedAt: iso(2),
    },
    {
      uri: 'list:at://l/1:at://did:plc:x1/app.bsky.graph.listblock/1',
      did: 'did:plc:x1',
      source: 'list',
      listUri: 'at://l/1',
      blockedAt: iso(30),
    },
    {
      uri: 'list:at://l/1:at://did:plc:x2/app.bsky.graph.listblock/2',
      did: 'did:plc:x2',
      source: 'list',
      listUri: 'at://l/1',
      blockedAt: iso(6),
    },
    {
      uri: 'at://did:plc:x3/app.bsky.graph.block/1',
      did: 'did:plc:x3',
      source: 'direct',
      blockedAt: null,
    },
    {
      uri: 'at://did:plc:x4/app.bsky.graph.block/1',
      did: 'did:plc:x4',
      source: 'direct',
      blockedAt: iso(500),
    },
  ];
  const list = (name, purpose, subscribers, i) => ({
    uri: `at://did:plc:owner${i}/app.bsky.graph.list/${i}`,
    owner: `did:plc:owner${i}`,
    name,
    purpose,
    memberAt: iso(20 + i),
    subscribers,
  });
  const lists = [
    list('Bookish', 'curation', null, 1),
    list('Muted for now', 'moderation', 12, 2),
    list('art people', 'curation', 3, 3),
    list('Art people', 'curation', 3, 4),
    list('Ärzte', 'reference', null, 5),
    list('Arzte', 'reference', null, 6),
    list('Reply guys', 'moderation', 200, 7),
    list('Too many takes', 'moderation', 12, 8),
    list('Odd one', 'something-else', 5, 9),
    list('', 'moderation', 0, 10),
  ];
  const log = {
    entries: [
      {
        did: 'did:plc:gone',
        handle: 'gone.example.com',
        displayName: 'Gone',
        avatar: '',
        followedAt: iso(90),
        kind: 'lost',
        at: EDGE_NOW - DAY,
        since: EDGE_NOW - 8 * DAY,
      },
      {
        did: 'did:plc:new',
        handle: 'new.example.com',
        displayName: '',
        avatar: '',
        followedAt: iso(2),
        kind: 'gained',
        at: EDGE_NOW - DAY,
        since: EDGE_NOW - 8 * DAY,
      },
      {
        did: 'did:plc:old',
        handle: 'old.example.com',
        displayName: '',
        avatar: '',
        followedAt: null,
        kind: 'lost',
        at: EDGE_NOW - 8 * DAY,
        since: null,
      },
    ],
    lastSyncAt: EDGE_NOW - DAY,
    firstSyncAt: EDGE_NOW - 30 * DAY,
  };

  return roundTrip({
    empty: emptyArchive(),
    bestTime: base({ posts: best, meta: { posts: { shape: 2 } } }),
    content: base({ posts: content, meta: { posts: { shape: 2 } } }),
    contentOld: base({ posts: content, meta: { posts: {} } }),
    contentShapeless: base({ posts: content, meta: {} }),
    people: base({
      followers,
      blocks,
      following: [
        {
          uri: `at://${ME_DID}/app.bsky.graph.follow/1`,
          did: 'did:plc:a',
          followedAt: iso(9),
        },
        {
          uri: `at://${ME_DID}/app.bsky.graph.follow/2`,
          did: 'did:plc:z',
          followedAt: null,
        },
        {
          uri: `at://${ME_DID}/app.bsky.graph.follow/3`,
          did: 'did:plc:z',
          followedAt: iso(3),
        },
      ],
      inbound: [
        {
          uri: 'at://did:plc:a/app.bsky.feed.like/1',
          did: 'did:plc:a',
          kind: 'like',
          at: iso(1),
        },
        {
          uri: 'at://did:plc:a/app.bsky.feed.post/2',
          did: 'did:plc:a',
          kind: 'reply',
          at: iso(2),
        },
        {
          uri: 'at://did:plc:b/app.bsky.feed.post/3',
          did: 'did:plc:b',
          kind: 'mention',
          at: iso(4),
        },
        {
          uri: 'at://did:plc:z/app.bsky.feed.like/4',
          did: 'did:plc:z',
          kind: 'like',
          at: iso(50),
        },
        {
          uri: 'at://did:plc:me/app.bsky.feed.like/5',
          did: ME_DID,
          kind: 'like',
          at: iso(3),
        },
        {
          uri: 'at://did:plc:c/app.bsky.feed.like/6',
          did: 'did:plc:c',
          kind: 'like',
          at: 'whenever',
        },
        {
          uri: 'at://did:plc:café/app.bsky.feed.like/7',
          did: 'did:plc:café',
          kind: 'like',
          at: iso(2),
        },
        {
          uri: 'at://did:plc:café/app.bsky.feed.like/8',
          did: 'did:plc:café',
          kind: 'quote',
          at: iso(2),
        },
      ],
      outbound: [
        {
          uri: `at://${ME_DID}/app.bsky.feed.like/1`,
          did: 'did:plc:a',
          kind: 'like',
          at: iso(1),
        },
        {
          uri: `at://${ME_DID}/app.bsky.feed.repost/2`,
          did: 'did:plc:z',
          kind: 'repost',
          at: iso(20),
        },
        {
          uri: `at://${ME_DID}/app.bsky.feed.like/3`,
          did: ME_DID,
          kind: 'like',
          at: iso(2),
        },
        {
          uri: `at://${ME_DID}/app.bsky.feed.like/4`,
          did: 'did:plc:q',
          kind: 'like',
          at: 1762900000000,
        },
      ],
      posts: [
        timedPost(2, 10, 3, { replyTo: 'did:plc:a' }),
        timedPost(3, 10, 3, { quoteOf: 'did:plc:b', replyTo: 'did:plc:b' }),
        timedPost(4, 10, 3, { replyTo: ME_DID }),
        timedPost(5, 10, 3, { quoteOf: 'did:plc:z' }),
      ],
      atmosphere: [
        {
          uri: 'at://me/fm.teal.alpha.feed.play/1',
          collection: 'fm.teal.alpha.feed.play',
          at: EDGE_NOW - DAY,
        },
        {
          uri: 'at://me/fm.teal.alpha.feed.play/2',
          collection: 'fm.teal.alpha.feed.play',
          at: EDGE_NOW - 2 * DAY,
        },
        {
          uri: 'at://me/b.collection/1',
          collection: 'b.collection',
          at: EDGE_NOW - 3 * DAY,
        },
        {
          uri: 'at://me/a.collection/1',
          collection: 'a.collection',
          at: EDGE_NOW - 3 * DAY,
        },
        {
          uri: 'at://me/B.collection/1',
          collection: 'B.collection',
          at: EDGE_NOW - 3 * DAY,
        },
        {
          uri: 'at://me/old/1',
          collection: 'old.collection',
          at: EDGE_NOW - 400 * DAY,
        },
      ],
      meta: {
        followers: { profileCount: 9 },
        following: {},
        lists: { lists },
        followerLog: log,
      },
    }),
    noLog: base({
      meta: { followerLog: { entries: [], lastSyncAt: 0, firstSyncAt: 0 } },
    }),
  });
}

export { EDGE_NOW };

/* ------------------------------------------------------------------ */
/* Running the models                                                   */
/* ------------------------------------------------------------------ */

export const MODELS = {
  followersModel,
  blocksModel,
  postsModel,
  engagementModel,
  givenModel,
  peopleModel,
  followBackModel,
  atmosphereModel,
  bestTimeModel,
  contentModel,
};

const WHOLE = { listsModel, followerLogModel, relationSets };

/** A preset by key. */
export const preset = (key) => ANALYTICS_PERIODS.find((p) => p.key === key);

/** The presets, and two ranges picked by hand (one running past today). */
export function periodsAt(nowMs) {
  return [
    ...ANALYTICS_PERIODS,
    customPeriod('2026-10-01', '2026-10-31', nowMs),
    customPeriod('2026-11-01', '2026-11-30', nowMs),
  ];
}

/**
 * A value as a fixture holds a big result: its JSON text on one line (the
 * fixture's indented form of a report's series is several times larger).
 * The Swift side parses it back.
 */
export function compact(result) {
  const json = toJSON(result);
  return json === undefined ? null : JSON.stringify(json);
}

/**
 * Cases of one model: each input names an archive, "now", the period, the
 * options and the formats (`zone`, `locale`, `weekStart`); the model runs on
 * the archive as `useArchive()` gives it, with a revision of its own, which
 * the case records (`rev`). The output is the result's JSON text.
 */
export function modelCases(fnName, inputs, archives, context) {
  return each(fnName, inputs, (input) =>
    under(input, () => {
      const archive = context(archives[input.archive], input.nowMs);
      input.rev = archive.rev;
      const out = MODELS[fnName]
        ? MODELS[fnName](archive, input.period, input.nowMs, input.options)
        : WHOLE[fnName](archive);
      return compact(out);
    }),
  );
}
