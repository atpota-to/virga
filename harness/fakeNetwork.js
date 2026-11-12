// The network, answered from harness/world.js. Every host the dashboard
// reads without a session (the public AppView, the PLC directory, the
// account's PDS, Constellation) is routed here, so the harness needs no
// connection and touches no real account. Anything else that isn't this
// dev server is refused, loudly, so a new outside request can't slip in
// unnoticed.

import { buildRepoCar } from './buildCar.js';
import { ME, PDS, postRecord, repoRecords } from './world.js';

const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** One page of a list, with the cursor for the next: `{ rows, cursor }`. */
export function pageOf(all, limit, cursor) {
  const from = Number(cursor) || 0;
  const size = Math.max(1, Math.min(100, Number(limit) || 50));
  const rows = all.slice(from, from + size);
  return { rows, cursor: from + size < all.length ? String(from + size) : undefined };
}

function card(person) {
  return { did: person.did, handle: person.handle, displayName: person.displayName, avatar: person.avatar };
}

/** The author feed: the account's posts, with now and then someone else's reposted into it. */
function feedItems(world) {
  const author = card(world.profile);
  return world.posts.flatMap((p, i) => {
    const item = {
      post: {
        uri: `at://${ME.did}/app.bsky.feed.post/${p.rkey}`,
        cid: 'bafyharness',
        author,
        record: postRecord(p),
        likeCount: p.likes,
        repostCount: p.reposts,
        replyCount: p.replies,
        quoteCount: p.quotes,
        indexedAt: p.at,
      },
    };
    if (i % 37 !== 5) return [item];
    const other = world.cast[i % world.cast.length];
    return [
      item,
      {
        post: {
          uri: `at://${other.did}/app.bsky.feed.post/${p.rkey}`,
          cid: 'bafyharness',
          author: card(other),
          record: { $type: 'app.bsky.feed.post', text: 'Someone else’s post, reposted.', createdAt: p.at },
          likeCount: 12,
          repostCount: 3,
          replyCount: 1,
          quoteCount: 0,
        },
        reason: { $type: 'app.bsky.feed.defs#reasonRepost', by: author, indexedAt: p.at },
      },
    ];
  });
}

/**
 * Build the router for one world. `route(url)` answers with a Response, or
 * null for a URL that isn't one of the outside hosts.
 */
export function createRouter(world) {
  const feed = feedItems(world);
  const people = new Map([[ME.did, world.profile], ...world.cast.map((p) => [p.did, p])]);
  let car = null;

  return async function route(input) {
    const url = new URL(typeof input === 'string' ? input : input.url, 'http://harness.invalid');
    const q = url.searchParams;
    const method = url.pathname.split('/xrpc/')[1] || '';

    if (url.hostname === 'plc.directory') {
      return json({
        id: decodeURIComponent(url.pathname.slice(1)),
        alsoKnownAs: [`at://${ME.handle}`],
        service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS }],
      });
    }

    if (url.hostname === 'public.api.bsky.app') {
      if (method === 'app.bsky.actor.getProfile') {
        const actor = q.get('actor');
        if (actor === ME.did || actor === ME.handle) return json(world.profile);
        const person = people.get(actor);
        return person ? json(card(person)) : json({ error: 'InvalidRequest', message: 'Profile not found' }, 400);
      }
      if (method === 'app.bsky.actor.getProfiles') {
        // An account nobody can resolve is simply absent, as on the network.
        return json({ profiles: q.getAll('actors').map((did) => people.get(did)).filter(Boolean).map(card) });
      }
      if (method === 'app.bsky.feed.getAuthorFeed') {
        const { rows, cursor } = pageOf(feed, q.get('limit'), q.get('cursor'));
        return json({ feed: rows, cursor });
      }
      if (method === 'com.atproto.repo.getRecord') {
        const uri = `at://${q.get('repo')}/${q.get('collection')}/${q.get('rkey')}`;
        const list = world.lists.find((l) => l.uri === uri);
        if (!list) return json({ error: 'RecordNotFound' }, 400);
        return json({ uri, value: { $type: 'app.bsky.graph.list', name: 'A list', purpose: list.purpose } });
      }
    }

    if (url.origin === PDS && method === 'com.atproto.sync.getRepo') {
      // No revision log here: asked for a diff, say the revision is gone, and
      // the dashboard pulls the whole repo again as it would from a real PDS.
      if (q.get('since')) return json({ error: 'InvalidRequest', message: 'Unknown revision' }, 400);
      car ||= buildRepoCar(ME.did, repoRecords(world));
      const bytes = await car;
      return new Response(bytes, {
        headers: { 'Content-Type': 'application/vnd.ipld.car', 'Content-Length': String(bytes.byteLength) },
      });
    }

    if (url.hostname === 'constellation.microcosm.blue') {
      const subject = q.get('subject');
      const source = q.get('source');
      if (method === 'blue.microcosm.links.getBacklinks') {
        let all = [];
        if (subject === ME.did && source === 'app.bsky.graph.block:subject') all = world.blockers;
        else if (source === 'app.bsky.graph.listblock:subject') {
          all = world.lists.find((l) => l.uri === subject)?.subscribers || [];
        }
        const { rows, cursor } = pageOf(all, q.get('limit'), q.get('cursor'));
        return json({ total: all.length, records: rows, cursor: cursor ?? null });
      }
      if (method === 'blue.microcosm.links.getManyToMany') {
        const all = world.lists.map((l) => ({ linkRecord: l.item, otherSubject: l.uri }));
        const { rows, cursor } = pageOf(all, q.get('limit'), q.get('cursor'));
        return json({ items: rows, cursor: cursor ?? null });
      }
    }

    return null;
  };
}

/**
 * Swap `window.fetch` for one that answers from the world. Requests to this
 * dev server pass through; requests to any other host are refused.
 */
export function installFakeNetwork(world, { latency = 60 } = {}) {
  const real = window.fetch.bind(window);
  const route = createRouter(world);
  window.fetch = async (input, init) => {
    const href = typeof input === 'string' ? input : input.url;
    const url = new URL(href, window.location.href);
    if (url.origin === window.location.origin) return real(input, init);
    if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    await sleep(latency);
    const answer = await route(url.href);
    if (answer) return answer;
    console.warn('[harness] refused a request to an outside host:', url.href);
    throw new TypeError(`harness: no fixture for ${url.host}`);
  };
}
