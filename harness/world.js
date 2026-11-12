// A made-up account and everything the dashboard reads about it: posts with
// their counts, followers, follows, notifications, likes and reposts, the
// rest of a repo, and the blocks pointing at it. Deterministic (a seeded
// PRNG), and dated back from "now", so the charts always have a recent week
// to draw.
//
// Nobody here is real. Handles are under example.com, which nobody can own.
// It is stand-in content shaped like the real thing: long names and missing
// ones, accounts with no avatar, a post that took off, a quiet month.

const DAY = 86_400_000;

export const ME = {
  did: 'did:plc:virgaharnessmira2zq4x',
  handle: 'mira.example.com',
  displayName: 'Mira Okafor',
};

export const PDS = 'https://pds.harness.example';

/** Tiny deterministic RNG, so two runs draw the same account. */
export function mulberry(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const B32 = '234567abcdefghijklmnopqrstuvwxyz';

/** A real TID for a timestamp: the encoding tidToTimestamp reads back. */
export function tidAt(ms, clock = 0) {
  let n = ((BigInt(Math.floor(ms)) * 1000n) << 10n) | BigInt(clock & 1023);
  let out = '';
  for (let i = 0; i < 13; i++) {
    out = B32[Number(n & 31n)] + out;
    n >>= 5n;
  }
  return out;
}

const FIRST = [
  'Ana', 'Bo', 'Cyrus', 'Dee', 'Edna', 'Fio', 'Gideon', 'Hana', 'Ines', 'Jun', 'Kofi', 'Lior',
  'Maren', 'Nadia', 'Oskar', 'Priya', 'Quentin', 'Rosa', 'Sami', 'Tove', 'Uma', 'Viktor',
  'Wren', 'Xiomara', 'Yusuf', 'Zadie', 'Alasdair', 'Bettina', 'Caetano', 'Dorothea',
];
const LAST = [
  'Abara', 'Lindqvist', 'Moreau', 'Nakamura', 'Oyelaran', 'Pereira', 'Quispe', 'Rahman',
  'Sokolova', 'Tanaka', 'Underhill', 'Vasquez', 'Whitcombe', 'Yilmaz', 'Zielinski',
  'Featherstonehaugh-Barrington', 'de la Cruz', 'van der Berg', 'Okonkwo', 'Haddad',
];
const HUES = [212, 28, 146, 268, 338, 48, 188, 12, 96, 300];

/** The lists the account is on, by position: even ones below 8 are moderation lists. */
const LIST_NAMES = [
  'Muted for now',
  'Gardening people',
  'Too many takes',
  'Urbanists I read',
  'Reply guys',
  'Bookish',
  'Low-effort replies',
  'Cycling',
  'Mutuals',
];

/**
 * A few dozen more accounts the account follows, outside the cast: people it
 * followed once and rarely hears from. Some have gone quiet, a few are gone
 * altogether, which is what Follow cleanup is for. Built without the RNG, so
 * the rest of the world draws the same as before they were added.
 */
function followedOnlyPeople() {
  return Array.from({ length: 36 }, (_, i) => {
    const first = FIRST[(i * 5 + 2) % FIRST.length];
    const last = LAST[(i * 3 + 1) % LAST.length];
    return {
      did: `did:plc:virgaharnessfol${String(i).padStart(4, '0')}`,
      handle: `${first.toLowerCase()}.${last.toLowerCase().replace(/[^a-z]/g, '')}.example.net`,
      displayName: i % 7 === 3 ? '' : `${first} ${last}`,
      avatar: i % 4 === 1 ? '' : avatarFor(first[0], HUES[(i + 3) % HUES.length]),
    };
  });
}

/** A number from a string, for deterministic per-account facts. */
export function hashOf(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * When an account outside the main account was last active, as days ago, or
 * 'gone' (deleted or deactivated) or 'never' (has never posted). The cast is
 * mostly active; the follows outside it are mostly quiet.
 */
export function activityOf(did) {
  const h = hashOf(did);
  if (did.includes('fol')) {
    if (h % 9 === 0) return 'gone';
    if (h % 13 === 0) return 'never';
    return h % 420;
  }
  return h % 28;
}

/** A round avatar with an initial on it, as a data URI. No image host needed. */
function avatarFor(letter, hue) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" fill="hsl(${hue} 70% 78%)"/>` +
    `<text x="32" y="42" font-family="system-ui,sans-serif" font-size="30" font-weight="700" ` +
    `text-anchor="middle" fill="hsl(${hue} 60% 24%)">${letter}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const POST_TEXT = [
  'Spent the morning relabelling the seed jars. Found three kinds of bean I have no memory of buying.',
  'The library is doing a repair café on Saturday. Bring a lamp, a zip, a toaster, anything with one thing wrong with it.',
  'New essay is up: what a street tree costs a city, and what it gives back over forty years.',
  'Does anyone have a sourdough starter that survived a house move? Mine did not.',
  'Field notes, week 31. The swifts have gone, a full week earlier than last year.',
  'Finally read the book everyone told me to read in 2019. They were right, annoyingly.',
  'Rewrote the same paragraph six times and it is now the one I started with.',
  'A map of every public bench in the neighbourhood, with how long each one gets the afternoon sun.',
  'Hot take: the best feature of any app is an export button.',
  'Thread on what I learned running a community garden waiting list for four years. It is mostly about spreadsheets.',
  'The bus was on time and I do not know what to do with myself.',
  'Slides from last night are here, along with the three questions I could not answer.',
  'Looking for someone who can identify a moth from a very bad photo.',
  'Made the thing. It is small and it works. That is the whole post.',
  'I counted: 41 tabs open, 11 of them the same page.',
  'This is the clearest explanation of how handles and DIDs fit together that I have come across.',
  'Reminder that the allotment society AGM is on the 14th, and that there will be cake as a deliberate tactic.',
  'Three weeks of rain and the shed roof has finally told us where it leaks.',
  'Small request: if you make a chart, label the axes. Both of them.',
  'What I got wrong about composting, a list in nine parts.',
  '',
  'Good morning to the heron on the canal and to nobody else.',
  'We are hiring a part-time coordinator for the tool library. Details in the reply.',
  'Tried the new route to the market. Eleven minutes longer and much better.',
  'An appreciation post for people who write alt text.',
  'The data says Tuesday is when people read. The data did not say why.',
  'Somebody has been leaving tiny knitted hats on the bollards again and I would like to thank them.',
  'Notes from the atproto meetup: groups, permissions, and a very long conversation about moderation lists.',
  'Printed the zine. Folded 200 copies. My thumbs have opinions.',
  'A question for people who keep bees in a city: how do your neighbours feel about it now, a few years in?',
];

/** Other apps writing to the same repo, for the Atmosphere tab. */
const OTHER_COLLECTIONS = [
  ['fm.teal.alpha.feed.play', 2600],
  ['site.standard.document', 44],
  ['community.lexicon.calendar.rsvp', 58],
  ['sh.tangled.graph.follow', 23],
  ['app.bsky.graph.listitem', 131],
  ['app.bsky.graph.block', 17],
  ['social.popfeed.feed.review', 72],
  ['app.bsky.feed.threadgate', 9],
  ['blue.flashes.feed.post', 36],
];

/**
 * Build the account. `now` anchors every date; the same `now` and seed give
 * the same world.
 */
export function buildWorld({ now = Date.now(), seed = 20261112 } = {}) {
  const rand = mulberry(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  // A long tail: mostly small, now and then large.
  const tail = (scale) => Math.floor(scale * (1 / (1 - rand() * 0.985) - 1));

  /* ---- the people around the account ---------------------------- */
  const cast = Array.from({ length: 64 }, (_, i) => {
    const first = FIRST[i % FIRST.length];
    const last = LAST[(i * 7 + 3) % LAST.length];
    const hue = HUES[i % HUES.length];
    const handle = `${first}${i > FIRST.length ? i : ''}.example.com`.toLowerCase();
    return {
      did: `did:plc:virgaharnesscast${String(i).padStart(4, '0')}`,
      handle,
      // Some people never set a name, and some never set a picture.
      displayName: i % 9 === 4 ? '' : `${first} ${last}`,
      avatar: i % 6 === 5 ? '' : avatarFor(first[0], hue),
    };
  });
  // A few people do most of the engaging: weight toward the front of the cast.
  const castPick = () => cast[Math.min(cast.length - 1, Math.floor(cast.length * rand() ** 2.4))];

  /* ---- posts ---------------------------------------------------- */
  const span = 3.1 * 365 * DAY;
  const start = now - span;
  const posts = [];
  for (let t = start; t < now; ) {
    // Busier lately, with one month off in the middle of last year.
    const age = (now - t) / span;
    const quiet = age > 0.36 && age < 0.39;
    const gap = (quiet ? 9 : 0.35 + age * 1.9) * DAY * (0.25 + rand() * 1.6);
    t += gap;
    if (t >= now) break;
    const reply = rand() < 0.38;
    const self = reply && rand() < 0.2;
    const quote = !reply && rand() < 0.08;
    const media = rand() < 0.22;
    const text = pick(POST_TEXT);
    // Engagement grows with the account, and one post in a few hundred runs away.
    const reach = (1.2 - age) * (reply ? 0.25 : 1) * (rand() < 0.006 ? 40 : 1);
    const likes = tail(9 * reach);
    posts.push({
      rkey: tidAt(t, posts.length),
      at: new Date(t).toISOString(),
      text: text || (media ? '' : 'Morning.'),
      replyTo: reply ? (self ? ME.did : castPick().did) : null,
      quoteOf: quote ? castPick().did : null,
      media,
      likes,
      reposts: Math.floor(likes * (0.08 + rand() * 0.2)),
      replies: Math.floor(likes * (0.04 + rand() * 0.12)),
      quotes: Math.floor(likes * rand() * 0.04),
    });
  }
  posts.reverse(); // newest first, as the author feed pages

  /* ---- followers ------------------------------------------------ */
  // An accelerating curve with two bursts, the newest first as getFollowers
  // pages. A handful carry a follow record with a hand-written key, so they
  // count toward the total and not toward the curve.
  const FOLLOWERS = 4810;
  const followers = Array.from({ length: FOLLOWERS }, (_, i) => {
    let frac = 1 - (1 - i / FOLLOWERS) ** 2.2;
    if (i > 2900 && i < 3500) frac = 0.705 + (i - 2900) / 600 / 60; // a post went round
    if (i > 4300 && i < 4560) frac = 0.948 + (i - 4300) / 260 / 120;
    const at = start + frac * span - rand() * DAY * 0.5;
    // Some of the people who engage are followers too; each of them once.
    const known = i % 61 === 0 && i / 61 < cast.length ? cast[i / 61] : null;
    const did = known?.did || `did:plc:virgaharnessfan${String(i).padStart(5, '0')}`;
    return {
      did,
      handle: known?.handle || `reader${i}.example.com`,
      displayName: known?.displayName || (i % 4 === 0 ? '' : `${pick(FIRST)} ${pick(LAST)}`),
      avatar: known?.avatar || '',
      viewer: {
        followedBy: `at://${did}/app.bsky.graph.follow/${i % 400 === 7 ? 'self' : tidAt(at, i)}`,
      },
    };
  }).reverse();

  /* ---- who the account follows ---------------------------------- */
  const followedOnly = followedOnlyPeople();
  const follows = cast
    .filter((_, i) => i % 3 !== 2)
    .map((person, i) => {
      const at = now - (2 + i * 19 + rand() * 9) * DAY;
      return {
        uri: `at://${ME.did}/app.bsky.graph.follow/${tidAt(at, i)}`,
        value: { $type: 'app.bsky.graph.follow', subject: person.did, createdAt: new Date(at).toISOString() },
      };
    });
  // The ones outside the cast were followed a while ago, without the RNG.
  followedOnly.forEach((person, i) => {
    const at = now - (60 + i * 23) * DAY;
    follows.push({
      uri: `at://${ME.did}/app.bsky.graph.follow/${tidAt(at, 500 + i)}`,
      value: { $type: 'app.bsky.graph.follow', subject: person.did, createdAt: new Date(at).toISOString() },
    });
  });

  /* ---- notifications -------------------------------------------- */
  const REASONS = ['like', 'like', 'like', 'like', 'repost', 'reply', 'reply', 'quote', 'mention', 'follow'];
  const notifications = Array.from({ length: 3400 }, (_, i) => {
    const at = now - rand() ** 1.6 * 150 * DAY;
    const who = castPick();
    const reason = pick(REASONS);
    return {
      uri: `at://${who.did}/app.bsky.harness.${reason}/${tidAt(at, i)}`,
      reason,
      author: { did: who.did, handle: who.handle, displayName: who.displayName, avatar: who.avatar },
      record: { createdAt: new Date(at).toISOString() },
      indexedAt: new Date(at + 900).toISOString(),
    };
  }).sort((a, b) => (a.indexedAt < b.indexedAt ? 1 : -1));

  /* ---- likes and reposts given ---------------------------------- */
  const given = (collection, count) =>
    Array.from({ length: count }, (_, i) => {
      const at = now - rand() ** 1.3 * span;
      const who = castPick();
      return {
        uri: `at://${ME.did}/${collection}/${tidAt(at, i)}`,
        value: {
          $type: collection,
          subject: { uri: `at://${who.did}/app.bsky.feed.post/${tidAt(at - 3_600_000, i)}`, cid: 'bafyharness' },
          createdAt: new Date(at).toISOString(),
        },
      };
    }).sort((a, b) => (a.uri < b.uri ? 1 : -1));
  const likes = given('app.bsky.feed.like', 5200);
  const reposts = given('app.bsky.feed.repost', 430);

  /* ---- blocks --------------------------------------------------- */
  const blockers = Array.from({ length: 148 }, (_, i) => {
    const at = now - rand() ** 0.8 * span * 0.8;
    return { did: `did:plc:virgaharnessblk${String(i).padStart(4, '0')}`, collection: 'app.bsky.graph.block', rkey: tidAt(at, i) };
  });
  // Nine lists hold the account. Four are moderation lists with subscribers;
  // the rest are ordinary curation lists and block nobody.
  const lists = Array.from({ length: 9 }, (_, i) => {
    const owner = `did:plc:virgaharnesslst${String(i).padStart(4, '0')}`;
    const memberAt = now - (40 + i * 97 + rand() * 30) * DAY;
    const mod = i % 2 === 0 && i < 8;
    return {
      name: LIST_NAMES[i],
      uri: `at://${owner}/app.bsky.graph.list/${tidAt(memberAt - 30 * DAY, i)}`,
      purpose: mod ? 'app.bsky.graph.defs#modlist' : 'app.bsky.graph.defs#curatelist',
      item: { did: owner, collection: 'app.bsky.graph.listitem', rkey: tidAt(memberAt, i) },
      subscribers: mod
        ? Array.from({ length: 30 + Math.floor(rand() * 260) }, (_, j) => {
            // Subscribed any time from a while before the account was added
            // to the list up to yesterday.
            const from = memberAt - 120 * DAY;
            const at = from + rand() * (now - DAY - from);
            return {
              // A few subscribers also block directly: one person, two paths.
              did: j % 23 === 0 ? blockers[(i * 5 + j) % blockers.length].did : `did:plc:virgaharnesssub${i}x${String(j).padStart(4, '0')}`,
              collection: 'app.bsky.graph.listblock',
              rkey: tidAt(at, j),
            };
          })
        : [],
    };
  });

  /* ---- the rest of the repo ------------------------------------- */
  const others = [];
  for (const [collection, count] of OTHER_COLLECTIONS) {
    for (let i = 0; i < count; i++) {
      const at = now - rand() ** 1.2 * span * (collection.startsWith('fm.') ? 0.6 : 1);
      others.push({ collection, rkey: tidAt(at, i), value: { $type: collection, createdAt: new Date(at).toISOString() } });
    }
  }

  const profile = {
    did: ME.did,
    handle: ME.handle,
    displayName: ME.displayName,
    avatar: avatarFor('M', 212),
    // The profile counter runs ahead of what can be listed, as it does for
    // real accounts: it still counts the deactivated and the deleted.
    followersCount: FOLLOWERS + 263,
    followsCount: follows.length,
    postsCount: posts.length,
    createdAt: new Date(start).toISOString(),
  };

  return { now, start, profile, cast, followedOnly, posts, followers, follows, notifications, likes, reposts, blockers, lists, others };
}

/** One post as its repo record, the shape both the feed and the CAR carry. */
export function postRecord(post) {
  const record = { $type: 'app.bsky.feed.post', text: post.text, createdAt: post.at };
  if (post.replyTo) {
    const parent = { uri: `at://${post.replyTo}/app.bsky.feed.post/${post.rkey}`, cid: 'bafyharness' };
    record.reply = { parent, root: parent };
  }
  const quoted = post.quoteOf
    ? { $type: 'app.bsky.embed.record', record: { uri: `at://${post.quoteOf}/app.bsky.feed.post/${post.rkey}`, cid: 'bafyharness' } }
    : null;
  const images = post.media ? { $type: 'app.bsky.embed.images', images: [{ alt: 'A photo', image: {} }] } : null;
  if (quoted && images) record.embed = { $type: 'app.bsky.embed.recordWithMedia', record: quoted, media: images };
  else if (quoted) record.embed = quoted;
  else if (images) record.embed = images;
  return record;
}

/**
 * Every record in the repo as `[key, value]`, key-sorted, which is the order
 * a repo's tree holds them in.
 */
export function repoRecords(world) {
  const rows = [
    ['app.bsky.actor.profile/self', { $type: 'app.bsky.actor.profile', displayName: world.profile.displayName }],
    ...world.posts.map((p) => [`app.bsky.feed.post/${p.rkey}`, postRecord(p)]),
    ...[...world.likes, ...world.reposts, ...world.follows].map((r) => [r.uri.split('/').slice(3).join('/'), r.value]),
    ...world.others.map((r) => [`${r.collection}/${r.rkey}`, r.value]),
  ];
  const seen = new Set();
  return rows
    .filter(([key]) => (seen.has(key) ? false : seen.add(key)))
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}
