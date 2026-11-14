// What the AppView says about posts, feeds, lists and people, built from the
// worlds (harness/world.js) and what has been written to them since
// (harness/repo.js). Shared by the public routes in fakeNetwork.js and the
// signed-in reads in fakeXrpc.js, so a post looks the same from both.
//
// Everyone in the cast has posts too, made up on demand: any
// `at://<someone in the cast>/app.bsky.feed.post/<tid>` is a post with a line
// of text, dated by its record key. That is what bookmarks, quotes and search
// results point at.

import { blobDataUrl, parseAtUri, readRecord } from './repo.js';
import { hashOf, postRecord, tidAt } from './world.js';

const MINUTE = 60_000;
const DAY = 86_400_000;
const B32 = '234567abcdefghijklmnopqrstuvwxyz';

const CAST_POSTS = [
  'Planted the last of the garlic before the frost. Fingers crossed.',
  'Our street finally got its second bench. People are already arguing about the view.',
  'Reading group meets Tuesday. We are halfway through and nobody has finished.',
  'The tool library now has a ladder tall enough for the gutters. Book early.',
  'Photographed a heron, which then stood very still for twenty minutes, mocking me.',
  'Question for gardeners: what do you do with forty green tomatoes in November?',
  'Wrote down every bus I missed this month. It was a short list, and a long one.',
  'New zine about local wildflowers is out. Free at the café while copies last.',
  'If anyone has a spare sourdough starter, I have jam to trade.',
  'Cycling club ride on Sunday, slow pace, cake at the end.',
  'The community fridge is full again. Thank you, whoever brought all the soup.',
  'Mapping the neighbourhood’s trees with the school. The kids are better at it than us.',
];

/** One page of a list, with the cursor for the next: `{ rows, cursor }`. */
export function pageOf(all, limit, cursor) {
  const from = Number(cursor) || 0;
  const size = Math.max(1, Math.min(100, Number(limit) || 50));
  const rows = all.slice(from, from + size);
  return {
    rows,
    cursor: from + size < all.length ? String(from + size) : undefined,
  };
}

/** When a TID record key was minted (ms), or null for a key that isn't one. */
export function tidTime(rkey) {
  if (typeof rkey !== 'string' || !/^[234567a-z]{13}$/.test(rkey)) return null;
  let n = 0n;
  for (const ch of rkey) n = (n << 5n) | BigInt(B32.indexOf(ch));
  return Number((n >> 10n) / 1000n);
}

/**
 * The counts a post written in the harness has picked up: a like every few
 * minutes, now and then a reply or a repost, so timers with conditions and
 * the Posted page have something to read.
 */
export function liveCounts(post, now = Date.now()) {
  if (!post.writtenAt)
    return {
      likes: post.likes || 0,
      reposts: post.reposts || 0,
      replies: post.replies || 0,
      quotes: post.quotes || 0,
    };
  const minutes = Math.max(
    0,
    (now - Date.parse(post.at || post.indexedAt)) / MINUTE,
  );
  return {
    likes: Math.min(60, Math.floor(minutes / 3)),
    reposts: Math.min(12, Math.floor(minutes / 20)),
    replies: Math.min(20, Math.floor(minutes / 15)),
    quotes: Math.min(4, Math.floor(minutes / 60)),
  };
}

function placeholderImage(seed) {
  const hue = hashOf(seed) % 360;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">` +
    `<rect width="400" height="300" fill="hsl(${hue} 45% 82%)"/>` +
    `<path d="M0 220 L120 140 L210 200 L290 120 L400 210 L400 300 L0 300 Z" fill="hsl(${hue} 35% 58%)"/>` +
    `<circle cx="320" cy="70" r="28" fill="hsl(${(hue + 40) % 360} 70% 90%)"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function createViews(worlds) {
  const list = Array.isArray(worlds) ? worlds : [worlds];
  const byDid = new Map(list.map((w) => [w.me.did, w]));
  const people = new Map();
  for (const w of list) {
    for (const p of [...w.cast, ...w.followedOnly])
      if (!people.has(p.did)) people.set(p.did, p);
  }
  for (const w of list) people.set(w.me.did, w.profile);
  const byHandle = new Map([...people.values()].map((p) => [p.handle, p]));

  const card = (did) => {
    const p = people.get(did);
    return p
      ? {
          did: p.did,
          handle: p.handle,
          displayName: p.displayName,
          avatar: p.avatar,
        }
      : { did, handle: 'handle.invalid', displayName: '' };
  };

  /** A person by DID or handle: the account's whole profile, or the cast's card. */
  function person(actor) {
    const p =
      people.get(actor) ||
      byHandle.get(
        String(actor || '')
          .replace(/^@/, '')
          .toLowerCase(),
      );
    if (!p) return null;
    return byDid.has(p.did) ? byDid.get(p.did).profile : card(p.did);
  }

  function resolveHandle(handle) {
    return (
      byHandle.get(
        String(handle || '')
          .replace(/^@/, '')
          .toLowerCase(),
      )?.did || null
    );
  }

  /* ---- posts ------------------------------------------------------- */

  function syntheticRecord(did, rkey) {
    const at = tidTime(rkey);
    if (at == null) return null;
    return {
      $type: 'app.bsky.feed.post',
      text: CAST_POSTS[hashOf(`${did}/${rkey}`) % CAST_POSTS.length],
      createdAt: new Date(at).toISOString(),
      langs: ['en'],
    };
  }

  function syntheticView(did, rkey) {
    const record = syntheticRecord(did, rkey);
    if (!record) return null;
    const h = hashOf(rkey);
    return {
      $type: 'app.bsky.feed.defs#postView',
      uri: `at://${did}/app.bsky.feed.post/${rkey}`,
      cid: 'bafyharness',
      author: card(did),
      record,
      likeCount: h % 90,
      repostCount: h % 13,
      replyCount: h % 7,
      quoteCount: h % 3,
      indexedAt: record.createdAt,
      labels: [],
      viewer: {},
    };
  }

  function gatesOf(world, rkey) {
    const threadgate = readRecord(world, 'app.bsky.feed.threadgate', rkey);
    return threadgate
      ? {
          uri: threadgate.uri,
          cid: threadgate.cid,
          record: threadgate.value,
          lists: [],
        }
      : null;
  }

  function ownView(world, p, { now = Date.now(), depth = 0 } = {}) {
    const record = postRecord(p);
    const counts = liveCounts(p, now);
    const view = {
      $type: 'app.bsky.feed.defs#postView',
      uri: `at://${world.me.did}/app.bsky.feed.post/${p.rkey}`,
      cid: p.cid || 'bafyharness',
      author: card(world.me.did),
      record,
      likeCount: counts.likes,
      repostCount: counts.reposts,
      replyCount: counts.replies,
      quoteCount: counts.quotes,
      indexedAt: p.indexedAt || p.at,
      labels: [],
      viewer: {},
    };
    if (record.embed && depth < 2)
      view.embed = embedView(record.embed, world.me.did, depth + 1);
    const gate = p.writtenAt ? gatesOf(world, p.rkey) : null;
    if (gate) view.threadgate = gate;
    return view;
  }

  /** A post as the AppView would show it, or null when there's no such post. */
  function postView(uri, options = {}) {
    const parsed = parseAtUri(uri);
    if (!parsed || parsed.collection !== 'app.bsky.feed.post') return null;
    const world = byDid.get(parsed.did);
    if (world) {
      const p = world.posts.find((x) => x.rkey === parsed.rkey);
      return p ? ownView(world, p, options) : null;
    }
    return people.has(parsed.did)
      ? syntheticView(parsed.did, parsed.rkey)
      : null;
  }

  function imageView(img, did, i) {
    const cid = img?.image?.ref?.$link;
    const world = byDid.get(did);
    const src =
      (cid && world && blobDataUrl(world, cid)) ||
      placeholderImage(`${did}${cid || i}`);
    return {
      thumb: src,
      fullsize: src,
      alt: img?.alt || '',
      ...(img?.aspectRatio ? { aspectRatio: img.aspectRatio } : {}),
    };
  }

  function recordView(ref, depth) {
    const uri = ref?.uri;
    const parsed = parseAtUri(uri);
    if (!parsed)
      return {
        $type: 'app.bsky.embed.record#viewNotFound',
        uri,
        notFound: true,
      };
    if (parsed.collection === 'app.bsky.feed.post') {
      const view = postView(uri, { depth });
      if (!view)
        return {
          $type: 'app.bsky.embed.record#viewNotFound',
          uri,
          notFound: true,
        };
      const out = {
        $type: 'app.bsky.embed.record#viewRecord',
        uri: view.uri,
        cid: view.cid,
        author: view.author,
        value: view.record,
        likeCount: view.likeCount,
        repostCount: view.repostCount,
        replyCount: view.replyCount,
        quoteCount: view.quoteCount,
        indexedAt: view.indexedAt,
        labels: [],
      };
      if (view.embed) out.embeds = [view.embed];
      return out;
    }
    if (parsed.collection === 'app.bsky.feed.generator') {
      const g = generatorView(uri);
      return g
        ? { $type: 'app.bsky.feed.defs#generatorView', ...g }
        : { $type: 'app.bsky.embed.record#viewNotFound', uri, notFound: true };
    }
    if (parsed.collection === 'app.bsky.graph.list') {
      const l = listView(uri);
      return l
        ? { $type: 'app.bsky.graph.defs#listView', ...l }
        : { $type: 'app.bsky.embed.record#viewNotFound', uri, notFound: true };
    }
    return { $type: 'app.bsky.embed.record#viewNotFound', uri, notFound: true };
  }

  /** A record's embed as its view, the shape getPosts hands back. */
  function embedView(embed, did, depth = 1) {
    if (!embed || typeof embed !== 'object') return undefined;
    switch (embed.$type) {
      case 'app.bsky.embed.images':
        return {
          $type: 'app.bsky.embed.images#view',
          images: (embed.images || []).map((img, i) => imageView(img, did, i)),
        };
      case 'app.bsky.embed.gallery':
        return {
          $type: 'app.bsky.embed.images#view',
          images: (embed.items || []).map((img, i) => imageView(img, did, i)),
        };
      case 'app.bsky.embed.video': {
        const cid = embed.video?.ref?.$link || 'bafyharness';
        return {
          $type: 'app.bsky.embed.video#view',
          cid,
          playlist: `https://video.bsky.app/watch/${encodeURIComponent(did)}/${cid}/playlist.m3u8`,
          thumbnail: placeholderImage(cid),
          alt: embed.alt || '',
          ...(embed.aspectRatio ? { aspectRatio: embed.aspectRatio } : {}),
        };
      }
      case 'app.bsky.embed.external': {
        const ext = embed.external || {};
        const cid = ext.thumb?.ref?.$link;
        const world = byDid.get(did);
        const thumb = cid
          ? (world && blobDataUrl(world, cid)) || placeholderImage(cid)
          : undefined;
        return {
          $type: 'app.bsky.embed.external#view',
          external: {
            uri: ext.uri,
            title: ext.title || '',
            description: ext.description || '',
            ...(thumb ? { thumb } : {}),
          },
        };
      }
      case 'app.bsky.embed.record':
        return {
          $type: 'app.bsky.embed.record#view',
          record: recordView(embed.record, depth),
        };
      case 'app.bsky.embed.recordWithMedia':
        return {
          $type: 'app.bsky.embed.recordWithMedia#view',
          record: {
            $type: 'app.bsky.embed.record#view',
            record: recordView(embed.record?.record, depth),
          },
          media: embedView(embed.media, did, depth),
        };
      default:
        return undefined;
    }
  }

  /** The account's author feed, newest first, with now and then someone else's post reposted into it. */
  function authorFeed(world, { now = Date.now() } = {}) {
    const author = card(world.me.did);
    return world.posts.flatMap((p, i) => {
      const item = { post: ownView(world, p, { now }) };
      if (i % 37 !== 5 || p.writtenAt) return [item];
      const other = world.cast[i % world.cast.length];
      return [
        item,
        {
          post: {
            uri: `at://${other.did}/app.bsky.feed.post/${p.rkey}`,
            cid: 'bafyharness',
            author: card(other.did),
            record: {
              $type: 'app.bsky.feed.post',
              text: 'Someone else’s post, reposted.',
              createdAt: p.at,
            },
            likeCount: 12,
            repostCount: 3,
            replyCount: 1,
            quoteCount: 0,
          },
          reason: {
            $type: 'app.bsky.feed.defs#reasonRepost',
            by: author,
            indexedAt: p.at,
          },
        },
      ];
    });
  }

  /** getPostThread's `thread`, or null for a post that isn't there. */
  function threadView(uri, { depth = 6, parentHeight = 80 } = {}) {
    const post = postView(uri);
    if (!post) return null;
    const node = {
      $type: 'app.bsky.feed.defs#threadViewPost',
      post,
      replies: [],
    };
    const parsed = parseAtUri(uri);
    const world = byDid.get(parsed.did);
    if (world && depth > 0) {
      node.replies = world.posts
        .filter((p) => postRecord(p).reply?.parent?.uri === uri)
        .map((p) =>
          threadView(`at://${world.me.did}/app.bsky.feed.post/${p.rkey}`, {
            depth: depth - 1,
            parentHeight: 0,
          }),
        )
        .filter(Boolean)
        .reverse();
    }
    const parentUri = post.record?.reply?.parent?.uri;
    if (parentUri && parentHeight > 0) {
      const parent = threadView(parentUri, {
        depth: 0,
        parentHeight: parentHeight - 1,
      });
      node.parent = parent || {
        $type: 'app.bsky.feed.defs#notFoundPost',
        uri: parentUri,
        notFound: true,
      };
    }
    return node;
  }

  /* ---- feeds and lists ---------------------------------------------- */

  function generatorView(uri) {
    for (const w of list) {
      const f = w.feeds.find((x) => x.uri === uri);
      if (f) {
        return {
          uri: f.uri,
          cid: 'bafyharness',
          did: 'did:web:feeds.harness.example',
          creator: card(w.me.did),
          displayName: f.name,
          description: f.description,
          likeCount: f.likeCount || 0,
          indexedAt: f.createdAt,
        };
      }
    }
    return null;
  }

  function listView(uri) {
    for (const w of list) {
      const own = w.ownLists.find((x) => x.uri === uri);
      if (own) {
        return {
          uri: own.uri,
          cid: 'bafyharness',
          creator: card(w.me.did),
          name: own.name,
          purpose: own.purpose,
          description: own.description || undefined,
          listItemCount: own.members.length,
          indexedAt: own.createdAt,
        };
      }
      const theirs = w.lists.find((x) => x.uri === uri);
      if (theirs) {
        const owner = parseAtUri(uri).did;
        return {
          uri,
          cid: 'bafyharness',
          creator: {
            did: owner,
            handle: `${owner.slice(-6)}.example.net`,
            displayName: '',
          },
          name: theirs.name,
          purpose: theirs.purpose,
          listItemCount: 40,
          indexedAt: new Date(
            tidTime(parseAtUri(uri).rkey) || Date.now(),
          ).toISOString(),
        };
      }
    }
    return null;
  }

  function listMembers(uri) {
    for (const w of list) {
      const own = w.ownLists.find((x) => x.uri === uri);
      if (own)
        return own.members.map((did, i) => ({
          uri: `${uri.replace('app.bsky.graph.list', 'app.bsky.graph.listitem')}${i}`,
          subject: card(did),
        }));
    }
    return [];
  }

  /* ---- search --------------------------------------------------------- */

  /**
   * Posts whose text has every word of `q`, newest first: the accounts'
   * own and two of each cast member's.
   */
  function searchPosts(q, { now = Date.now() } = {}) {
    const words = String(q || '')
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (!words.length) return [];
    const views = [];
    for (const w of list)
      for (const p of w.posts) views.push(ownView(w, p, { now }));
    for (const [i, p] of [...people.values()].entries()) {
      if (byDid.has(p.did) || !p.did.includes('cast')) continue;
      for (const k of [0, 1])
        views.push(
          syntheticView(
            p.did,
            tidAt(now - (i * 2 + k + 1) * DAY * 0.7, 300 + i * 2 + k),
          ),
        );
    }
    return views
      .filter((v) => {
        const text = String(v.record?.text || '').toLowerCase();
        return words.every((word) => text.includes(word));
      })
      .sort((a, b) => (a.indexedAt < b.indexedAt ? 1 : -1));
  }

  /** People whose handle or name starts with `q` (or has a word that does). */
  function searchActors(q, limit = 10) {
    const term = String(q || '')
      .replace(/^@/, '')
      .toLowerCase();
    if (!term) return [];
    return [...people.values()]
      .filter(
        (p) =>
          p.handle.startsWith(term) ||
          String(p.displayName || '')
            .toLowerCase()
            .split(/\s+/)
            .some((w) => w.startsWith(term)),
      )
      .slice(0, limit)
      .map((p) => card(p.did));
  }

  return {
    worlds: list,
    byDid,
    card,
    person,
    resolveHandle,
    postView,
    embedView,
    authorFeed,
    threadView,
    generatorView,
    listView,
    listMembers,
    searchPosts,
    searchActors,
  };
}
