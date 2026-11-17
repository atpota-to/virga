// Who piles onto a post, for Defense's scans. Everything here is derived,
// without the worlds' random number generators, from the worlds and a hash of
// each post's address, so the same post meets the same crowd every time and
// adding this moved nothing else the worlds draw.
//
// A post of Mira's is engaged with by as many accounts as its counts say (up
// to a cap per kind, which a real Constellation also pages through): a few of
// the cast she follows, a few she doesn't, some of her followers, and a crowd
// of strangers, more of them in the replies and quotes, where a pile-on
// happens. Among the strangers a few are widely followed, a few are followed
// by one or more of the people Mira follows, and a few block her.
//
// Vouches ("how many of the people you follow follow them") are worked out
// for whoever is asking: the cast follow one another along a fixed hash, and
// a stranger's count is set as seen by Mira, so Field Lab, who follows a dozen
// of the cast, sees smaller counts and no stranger counted at all.

import { ME, hashOf, mulberry } from './world.js';

const CROWD_SIZE = 1200;
/** The most records of one kind a post gives out: enough for the runaway post to page. */
const CAP = { like: 1800, repost: 400, reply: 320, threadReply: 60, quote: 160 };

const FIRST = ['Ash', 'Bree', 'Cole', 'Dara', 'Eli', 'Faye', 'Gus', 'Hollis', 'Ivo', 'Jem', 'Kit', 'Lark', 'Moss', 'Nell', 'Ode', 'Pip', 'Quill', 'Rue', 'Sol', 'Tam'];

/** The i-th stranger: a DID, a handle under example.net, counts drawn from a hash. */
function stranger(i) {
  const did = `did:plc:virgaharnesscrowd${String(i).padStart(5, '0')}`;
  const h = hashOf(did);
  const notable = i % 97 === 3 || i % 211 === 17;
  const reachy = i % 113 === 11;
  const followers = notable ? 12_000 + (h % 80_000) : reachy ? 6_000 + (h % 3_000) : h % 900;
  const ageDays = 20 + (h % 1400);
  const first = FIRST[h % FIRST.length];
  return {
    did,
    handle: `${first.toLowerCase()}${i}.crowd.example.net`,
    // Some never set a name, as everywhere.
    displayName: i % 5 === 2 ? '' : `${first} ${String.fromCharCode(65 + (h % 26))}.`,
    avatar: '',
    followersCount: followers,
    followsCount: 40 + (h % 700),
    // A handful post all day long.
    postsCount: i % 53 === 9 ? ageDays * 30 : Math.floor(ageDays * ((h % 40) / 10)),
    ageDays,
    // As Mira sees them: how many of the people she follows follow them.
    knownByMira: i % 89 === 7 ? 3 + (h % 4) : i % 41 === 5 || reachy ? 1 : i % 67 === 30 ? 2 : 0,
    blocksMira: i % 61 === 13,
  };
}

/** Whether one of the cast follows another account. Fixed, so vouches are the same every time. */
export function castFollows(fromDid, toDid) {
  return fromDid !== toDid && hashOf(`${fromDid}>${toDid}`) % 4 === 0;
}

export function createCrowd(worlds) {
  const list = Array.isArray(worlds) ? worlds : [worlds];
  const strangers = new Map();
  for (let i = 0; i < CROWD_SIZE; i += 1) {
    const s = stranger(i);
    strangers.set(s.did, s);
  }
  const strangerList = [...strangers.values()];
  const castDids = new Set(list.flatMap((w) => w.cast.map((p) => p.did)));
  const followerRows = new Map();
  for (const w of list) for (const f of w.followers) if (!followerRows.has(f.did)) followerRows.set(f.did, f);
  const engaged = new Map(); // post uri -> { kind: [did] }
  const followsOf = (world) => new Set(world.follows.map((r) => r.value.subject));
  const followersOf = (world) => new Set(world.followers.map((f) => f.did));
  const viewerCache = new WeakMap();

  function viewerOf(world) {
    if (!viewerCache.has(world)) {
      const follows = followsOf(world);
      viewerCache.set(world, { follows, followers: followersOf(world), castFollows: [...follows].filter((d) => castDids.has(d)) });
    }
    return viewerCache.get(world);
  }

  /** A stranger's or a follower's profile, as the public AppView gives it, or null. */
  function profile(did) {
    const s = strangers.get(did);
    if (s) return publicView(s);
    const f = followerRows.get(did);
    if (f && !castDids.has(did)) {
      const h = hashOf(did);
      return { did, handle: f.handle, displayName: f.displayName, avatar: f.avatar, followersCount: h % 400, followsCount: 50 + (h % 300), postsCount: h % 900, createdAt: new Date(Date.UTC(2023, 0, 1) + (h % 600) * 86_400_000).toISOString() };
    }
    return null;
  }

  function publicView(s) {
    return {
      did: s.did,
      handle: s.handle,
      displayName: s.displayName,
      avatar: s.avatar,
      followersCount: s.followersCount,
      followsCount: s.followsCount,
      postsCount: s.postsCount,
      createdAt: new Date(list[0].now - s.ageDays * 86_400_000).toISOString(),
    };
  }

  /**
   * How many of the accounts `viewer` follows follow `did`: the cast along
   * castFollows, a stranger as set for Mira (and nobody else), a follower of
   * Mira's now and then one.
   */
  function knownCount(viewer, did) {
    const s = strangers.get(did);
    if (s) return viewer.me.did === ME.did ? s.knownByMira : 0;
    const { castFollows: theirs } = viewerOf(viewer);
    if (castDids.has(did) || viewer.follows.some((r) => r.value.subject === did)) return theirs.filter((f) => castFollows(f, did)).length;
    if (followerRows.has(did)) return hashOf(did) % 13 === 0 ? 1 : 0;
    return 0;
  }

  /** Up to five of the people `viewer` follows who follow `did`, as cards. */
  function knownSample(viewer, did, n) {
    const { castFollows: theirs } = viewerOf(viewer);
    const cards = theirs.filter((f) => castFollows(f, did)).slice(0, 5);
    const pad = Array.from({ length: Math.max(0, Math.min(5, n) - cards.length) }, (_, i) => theirs[i]).filter(Boolean);
    return [...cards, ...pad].slice(0, Math.min(5, n)).map((d) => {
      const p = list[0].cast.find((c) => c.did === d);
      return { did: d, handle: p?.handle || 'handle.invalid', displayName: p?.displayName || '', avatar: p?.avatar || '' };
    });
  }

  /**
   * A profile as `viewer` sees it, signed in: the public view, a full one for
   * the cast, and `viewer` with following, followedBy, blockedBy and
   * knownFollowers. `card` is what the caller already has for the cast.
   */
  function profileAs(viewer, did, card = null) {
    const base = profile(did) || (card ? { ...card, followersCount: 60 + (hashOf(did) % 2400), followsCount: 80 + (hashOf(did) % 500), postsCount: 120 + (hashOf(did) % 4000), createdAt: new Date(viewer.start - (hashOf(did) % 700) * 86_400_000).toISOString() } : null);
    if (!base) return null;
    const { follows, followers } = viewerOf(viewer);
    const n = knownCount(viewer, did);
    const v = {};
    if (follows.has(did)) v.following = `at://${viewer.me.did}/app.bsky.graph.follow/${(hashOf(did) % 1e9).toString(36)}`;
    if (followers.has(did)) v.followedBy = `at://${did}/app.bsky.graph.follow/${(hashOf(`${did}!`) % 1e9).toString(36)}`;
    if (strangers.get(did)?.blocksMira && viewer.me.did === ME.did) v.blockedBy = true;
    if (n > 0) v.knownFollowers = { count: n, followers: knownSample(viewer, did, n) };
    return { ...base, viewer: v };
  }

  /** Who follows whom, for the public getRelationships. */
  function relationship(actorWorld, did) {
    const { follows, followers } = viewerOf(actorWorld);
    return {
      $type: 'app.bsky.graph.defs#relationship',
      did,
      ...(follows.has(did) ? { following: `at://${actorWorld.me.did}/app.bsky.graph.follow/${(hashOf(did) % 1e9).toString(36)}` } : {}),
      ...(followers.has(did) ? { followedBy: `at://${did}/app.bsky.graph.follow/${(hashOf(`${did}!`) % 1e9).toString(36)}` } : {}),
    };
  }

  /**
   * Everyone who engaged with one of a world's posts, by kind: `{ like,
   * repost, reply, threadReply, quote }`, each a list of DIDs. Empty for a
   * post that isn't one of a world's own.
   */
  function engagersOf(uri) {
    if (engaged.has(uri)) return engaged.get(uri);
    const [, , did, collection, rkey] = String(uri).split('/');
    const world = list.find((w) => w.me.did === did);
    const post = collection === 'app.bsky.feed.post' ? world?.posts.find((p) => p.rkey === rkey) : null;
    const out = { like: [], repost: [], reply: [], threadReply: [], quote: [] };
    if (!post) {
      engaged.set(uri, out);
      return out;
    }
    const rand = mulberry(hashOf(uri));
    const followed = world.cast.filter((p) => followsOf(world).has(p.did));
    const notFollowed = world.cast.filter((p) => !followsOf(world).has(p.did));
    const fans = world.followers.filter((f) => !castDids.has(f.did));
    const pickFrom = (pool) => pool[Math.floor(rand() * pool.length)]?.did;
    /** One engager: the loud kinds lean on strangers, as a pile-on does. */
    const someone = (loud) => {
      const r = rand();
      if (r < (loud ? 0.03 : 0.06) && followed.length) return pickFrom(followed);
      if (r < (loud ? 0.05 : 0.09) && notFollowed.length) return pickFrom(notFollowed);
      if (r < (loud ? 0.1 : 0.2) && fans.length) return pickFrom(fans);
      return pickFrom(strangerList);
    };
    const want = {
      like: Math.min(CAP.like, post.likes || 0),
      repost: Math.min(CAP.repost, post.reposts || 0),
      reply: Math.min(CAP.reply, post.replies || 0),
      quote: Math.min(CAP.quote, post.quotes || 0),
    };
    want.threadReply = Math.min(CAP.threadReply, Math.floor(want.reply / 5));
    for (const kind of ['like', 'repost', 'reply', 'threadReply', 'quote']) {
      const seen = new Set();
      for (let tries = 0; out[kind].length < want[kind] && tries < want[kind] * 4; tries += 1) {
        const d = someone(kind === 'reply' || kind === 'quote' || kind === 'threadReply');
        if (d && !seen.has(d) && d !== world.me.did) {
          seen.add(d);
          out[kind].push(d);
        }
      }
    }
    engaged.set(uri, out);
    return out;
  }

  return { profile, profileAs, relationship, knownCount, engagersOf, strangers };
}
