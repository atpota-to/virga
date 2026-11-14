// The network, answered from harness/world.js. Every host the app reads
// without a session (the public AppView, the PLC directory, the accounts' PDS,
// Constellation, Bluesky's card and video services) is routed here, and so is
// Virga's server (harness/fakeServer.js, at its SERVER_ORIGIN rather than this
// dev server's /api, which Vite would answer itself), so the harness needs no
// connection and touches no real account. Anything else that isn't this dev
// server is refused, loudly, so a new outside request can't slip in unnoticed.

import { buildRepoCar } from './buildCar.js';
import { SERVER_ORIGIN, createServerRouter } from './fakeServer.js';
import { readServiceToken } from './fakeXrpc.js';
import { cardImage } from './png.js';
import { listCollection, readBlob, readRecord, storeBlob } from './repo.js';
import { createViews, pageOf } from './views.js';
import { ME, PDS, activityOf, hashOf, repoRecords, tidAt } from './world.js';

export { pageOf };

const DAY = 86_400_000;
const PDS_HOST = new URL(PDS).hostname;
const VIDEO_DID = 'did:web:video.bsky.app';

const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const xrpcError = (status, error, message) => json({ error, message }, status);

/** Link previews the card service knows by address; anything else gets a generic one. */
const CARDS = {
  'example.com': { title: 'Example Domain', description: 'This domain is for use in documentation examples without needing permission.' },
  'www.example.org': { title: 'Repair cafés near you', description: 'Find a repair café, bring something broken, leave with it working.' },
};

function cardFor(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return { error: 'Unable to generate link preview' };
  }
  if (!/^https?:$/.test(url.protocol) || url.hostname.endsWith('.invalid')) return { error: 'Unable to generate link preview' };
  const known = CARDS[url.hostname];
  const words = decodeURIComponent(url.pathname)
    .split(/[/_-]+/)
    .filter((w) => w && !/\.\w+$/.test(w));
  const title = known?.title || (words.length ? words.join(' ').replace(/^./, (c) => c.toUpperCase()) : url.hostname);
  return {
    error: '',
    likely_type: 'html',
    url: url.href,
    title,
    description: known?.description || `A page on ${url.hostname}.`,
    // cardyb hands images back through its own proxy, as here.
    image: `https://cardyb.bsky.app/v1/image?url=${encodeURIComponent(`https://${url.hostname}/og/${hashOf(url.href)}.png`)}`,
  };
}

async function bodyBytes(body) {
  if (!body) return new Uint8Array(0);
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (typeof body.arrayBuffer === 'function') return new Uint8Array(await body.arrayBuffer());
  if (typeof body === 'string') return new TextEncoder().encode(body);
  return new Uint8Array(0);
}

/**
 * Build the router for the worlds (one, or every account's). `route(url, init)`
 * answers with a Response, or null for a URL that isn't one of the outside
 * hosts. `server` (createServer's) adds Virga's server; `videoProcessingMs` is
 * how long the video service takes to "process" an upload.
 */
export function createRouter(worlds, { server = null, now = () => Date.now(), videoProcessingMs = 4000 } = {}) {
  const list = Array.isArray(worlds) ? worlds : [worlds];
  const views = createViews(list);
  const worldOf = (actor) => views.byDid.get(actor) || views.byDid.get(views.resolveHandle(actor)) || null;
  const cars = new Map(); // did → { revision, car }
  const videoJobs = new Map();
  const cardImages = new Map();
  const serverRoute = server ? createServerRouter(server, SERVER_ORIGIN) : null;

  function carFor(world) {
    const cached = cars.get(world.me.did);
    if (cached && cached.revision === world.revision) return cached.car;
    const car = buildRepoCar(world.me.did, repoRecords(world));
    cars.set(world.me.did, { revision: world.revision, car });
    return car;
  }

  function auditLog(did) {
    const op = (handle, pds, at) => ({
      did,
      operation: {
        type: 'plc_operation',
        alsoKnownAs: [`at://${handle}`],
        services: { atproto_pds: { type: 'AtprotoPersonalDataServer', endpoint: pds } },
      },
      cid: 'bafyharness',
      nullified: false,
      createdAt: new Date(at).toISOString(),
    });
    const world = views.byDid.get(did);
    if (did === ME.did && world) {
      // Mira's history: made on Bluesky's own host under its first handle, a
      // handle of its own a year later, then a move to its own PDS.
      return [
        op('mira.bsky.social', 'https://bsky.social', world.start),
        op(ME.handle, 'https://bsky.social', world.start + 380 * DAY),
        op(ME.handle, PDS, world.now - 210 * DAY),
      ];
    }
    return world ? [op(world.me.handle, PDS, world.start)] : null;
  }

  function videoAnswer(url, init, method) {
    const token = readServiceToken(new Headers(init.headers || {}).get('authorization'));
    const nowSec = Math.floor(now() / 1000);
    const refuse = (message) => xrpcError(401, 'AuthRequired', message);
    if (!token || token.exp < nowSec) return refuse('A service-auth token is required');
    if (method === 'app.bsky.video.getUploadLimits') {
      if (token.aud !== VIDEO_DID || token.lxm !== method) return refuse('This token is not for the video service');
      return json({ canUpload: true, remainingDailyVideos: 24, remainingDailyBytes: 9_500_000_000 });
    }
    if (method === 'app.bsky.video.getJobStatus') {
      if (token.aud !== VIDEO_DID || token.lxm !== method) return refuse('This token is not for the video service');
      const job = videoJobs.get(url.searchParams.get('jobId'));
      if (!job) return xrpcError(400, 'InvalidRequest', 'Job not found');
      return job.status().then((jobStatus) => json({ jobStatus }));
    }
    if (method === 'app.bsky.video.uploadVideo') {
      // The service writes the blob to the account's PDS with this token.
      if (token.aud !== `did:web:${PDS_HOST}` || token.lxm !== 'com.atproto.repo.uploadBlob') {
        return refuse('The upload token has to be addressed to the account’s PDS for com.atproto.repo.uploadBlob');
      }
      const did = url.searchParams.get('did');
      const world = views.byDid.get(did);
      if (!world || token.iss !== did) return refuse('The upload token is for another account');
      if (!url.searchParams.get('name')) return xrpcError(400, 'InvalidRequest', 'name is required');
      const type = new Headers(init.headers || {}).get('content-type') || 'video/mp4';
      return bodyBytes(init.body).then(async (bytes) => {
        if (!bytes.length) return xrpcError(400, 'InvalidRequest', 'The upload was empty');
        const blob = await storeBlob(world, bytes, type);
        const jobId = `harness-${blob.ref.$link.slice(-16)}`;
        if (videoJobs.has(jobId)) {
          return json({ jobId, did, state: 'JOB_STATE_COMPLETED', error: 'already_exists', blob }, 409);
        }
        const started = now();
        videoJobs.set(jobId, {
          async status() {
            const progress = Math.min(100, Math.round(((now() - started) / videoProcessingMs) * 100));
            return progress >= 100
              ? { jobId, did, state: 'JOB_STATE_COMPLETED', progress: 100, blob }
              : { jobId, did, state: 'JOB_STATE_ENCODING', progress };
          },
        });
        return json({ jobStatus: { jobId, did, state: 'JOB_STATE_CREATED', progress: 0 } });
      });
    }
    return null;
  }

  return async function route(input, init = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url, 'http://harness.invalid');
    const q = url.searchParams;
    const method = url.pathname.split('/xrpc/')[1] || '';

    if (serverRoute) {
      const answer = await serverRoute(url, init);
      if (answer) return answer;
    }

    if (url.hostname === 'plc.directory') {
      const did = decodeURIComponent(url.pathname.slice(1)).split('/')[0];
      if (url.pathname.endsWith('/log/audit')) {
        const log = auditLog(did);
        return log ? json(log) : json({ message: 'DID not registered' }, 404);
      }
      const known = views.byDid.get(did)?.me || views.person(did);
      return json({
        id: did,
        alsoKnownAs: [`at://${known?.handle || 'handle.invalid'}`],
        service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: PDS }],
      });
    }

    if (url.hostname === 'public.api.bsky.app') {
      switch (method) {
        case 'app.bsky.actor.getProfile': {
          const p = views.person(q.get('actor'));
          return p ? json(p) : xrpcError(400, 'InvalidRequest', 'Profile not found');
        }
        case 'app.bsky.actor.getProfiles':
          // An account nobody can resolve is simply absent, as on the network.
          return json({ profiles: q.getAll('actors').map((a) => views.person(a)).filter(Boolean) });
        case 'app.bsky.actor.searchActorsTypeahead':
        case 'app.bsky.actor.searchActors':
          return json({ actors: views.searchActors(q.get('q') || q.get('term'), Math.min(100, Number(q.get('limit')) || 10)) });
        case 'com.atproto.identity.resolveHandle': {
          const did = views.resolveHandle(q.get('handle'));
          return did ? json({ did }) : xrpcError(400, 'InvalidRequest', 'Unable to resolve handle');
        }
        case 'app.bsky.feed.getAuthorFeed': {
          const actor = q.get('actor');
          const world = worldOf(actor);
          if (world) {
            let items = views.authorFeed(world, { now: now() });
            const filter = q.get('filter');
            if (filter === 'posts_no_replies') items = items.filter((i) => i.reason || !i.post.record?.reply);
            if (filter === 'posts_with_media') items = items.filter((i) => !i.reason && i.post.embed);
            const { rows, cursor } = pageOf(items, q.get('limit'), q.get('cursor'));
            return json({ feed: rows, cursor });
          }
          // Someone else's feed: one item, as old as their activity says.
          const person = views.person(actor);
          const activity = person ? activityOf(person.did) : 'gone';
          if (activity === 'gone') return xrpcError(400, 'InvalidRequest', 'Profile not found');
          if (activity === 'never') return json({ feed: [] });
          const at = new Date(now() - activity * DAY - 3_600_000).toISOString();
          return json({
            feed: [
              {
                post: {
                  uri: `at://${person.did}/app.bsky.feed.post/${tidAt(Date.parse(at))}`,
                  cid: 'bafyharness',
                  author: views.card(person.did),
                  record: { $type: 'app.bsky.feed.post', text: 'A post.', createdAt: at },
                  indexedAt: at,
                },
              },
            ],
          });
        }
        case 'app.bsky.feed.getPosts': {
          const uris = q.getAll('uris');
          if (uris.length > 25) return xrpcError(400, 'InvalidRequest', 'Too many URIs: at most 25');
          return json({ posts: uris.map((u) => views.postView(u)).filter(Boolean) });
        }
        case 'app.bsky.feed.getPostThread': {
          const thread = views.threadView(q.get('uri'), {
            depth: q.has('depth') ? Number(q.get('depth')) : 6,
            parentHeight: q.has('parentHeight') ? Number(q.get('parentHeight')) : 80,
          });
          return thread ? json({ thread }) : xrpcError(400, 'NotFound', `Post not found: ${q.get('uri')}`);
        }
        case 'app.bsky.feed.getFeedGenerator': {
          const view = views.generatorView(q.get('feed'));
          return view ? json({ view, isOnline: true, isValid: true }) : xrpcError(400, 'InvalidRequest', 'could not find feed');
        }
        case 'app.bsky.feed.getFeedGenerators':
          return json({ feeds: q.getAll('feeds').map((f) => views.generatorView(f)).filter(Boolean) });
        case 'app.bsky.feed.getActorFeeds': {
          const world = worldOf(q.get('actor'));
          const feeds = world ? world.feeds.map((f) => views.generatorView(f.uri)) : [];
          const { rows, cursor } = pageOf(feeds, q.get('limit'), q.get('cursor'));
          return json({ feeds: rows, cursor });
        }
        case 'app.bsky.graph.getList': {
          const view = views.listView(q.get('list'));
          if (!view) return xrpcError(400, 'InvalidRequest', 'List not found');
          const { rows, cursor } = pageOf(views.listMembers(q.get('list')), q.get('limit'), q.get('cursor'));
          return json({ list: view, items: rows, cursor });
        }
        case 'app.bsky.graph.getLists': {
          const world = worldOf(q.get('actor'));
          const lists = world ? world.ownLists.map((l) => views.listView(l.uri)) : [];
          const { rows, cursor } = pageOf(lists, q.get('limit'), q.get('cursor'));
          return json({ lists: rows, cursor });
        }
        case 'com.atproto.repo.getRecord': {
          const uri = `at://${q.get('repo')}/${q.get('collection')}/${q.get('rkey')}`;
          const world = worldOf(q.get('repo'));
          if (world) {
            const found = readRecord(world, q.get('collection'), q.get('rkey'));
            return found ? json(found) : xrpcError(400, 'RecordNotFound', `Could not locate record: ${uri}`);
          }
          const list = list0(uri);
          if (list) return json({ uri, cid: 'bafyharness', value: { $type: 'app.bsky.graph.list', name: list.name, purpose: list.purpose } });
          const post = views.postView(uri);
          if (post) return json({ uri, cid: post.cid, value: post.record });
          return xrpcError(400, 'RecordNotFound', `Could not locate record: ${uri}`);
        }
        default:
          break;
      }
    }

    if (url.origin === PDS) {
      if (method === 'com.atproto.sync.getRepo') {
        const world = views.byDid.get(q.get('did'));
        if (!world) return xrpcError(400, 'RepoNotFound', `Could not find repo for DID: ${q.get('did')}`);
        // No revision log here: asked for a diff, say the revision is gone, and
        // the dashboard pulls the whole repo again as it would from a real PDS.
        if (q.get('since')) return xrpcError(400, 'InvalidRequest', 'Unknown revision');
        const bytes = await carFor(world);
        return new Response(bytes, {
          headers: { 'Content-Type': 'application/vnd.ipld.car', 'Content-Length': String(bytes.byteLength) },
        });
      }
      if (method === 'com.atproto.repo.getRecord') {
        const world = worldOf(q.get('repo'));
        const found = world && readRecord(world, q.get('collection'), q.get('rkey'));
        return found ? json(found) : xrpcError(400, 'RecordNotFound', `Could not locate record: at://${q.get('repo')}/${q.get('collection')}/${q.get('rkey')}`);
      }
      if (method === 'com.atproto.repo.listRecords') {
        const world = worldOf(q.get('repo'));
        if (!world) return xrpcError(400, 'InvalidRequest', `Could not find repo: ${q.get('repo')}`);
        const { rows, cursor } = pageOf(listCollection(world, q.get('collection')), q.get('limit'), q.get('cursor'));
        return json({ records: rows, cursor });
      }
      if (method === 'com.atproto.sync.getBlob') {
        const blob = views.byDid.get(q.get('did')) && readBlob(views.byDid.get(q.get('did')), q.get('cid'));
        return blob ? new Response(blob.bytes, { headers: { 'Content-Type': blob.mimeType } }) : xrpcError(400, 'BlobNotFound', 'Blob not found');
      }
    }

    if (url.hostname === 'constellation.microcosm.blue') {
      const subject = q.get('subject');
      const source = q.get('source');
      const world = views.byDid.get(subject) || list.find((w) => w.lists.some((l) => l.uri === subject)) || list[0];
      const backlinks = () => {
        if (source === 'app.bsky.graph.block:subject') return views.byDid.get(subject)?.blockers || [];
        if (source === 'app.bsky.graph.listblock:subject') return world.lists.find((l) => l.uri === subject)?.subscribers || [];
        return [];
      };
      if (method === 'blue.microcosm.links.getBacklinks') {
        const all = backlinks();
        const { rows, cursor } = pageOf(all, q.get('limit'), q.get('cursor'));
        return json({ total: all.length, records: rows, cursor: cursor ?? null });
      }
      if (method === 'blue.microcosm.links.getBacklinksCount') return json({ total: backlinks().length });
      if (method === 'blue.microcosm.links.getManyToMany') {
        const all = (views.byDid.get(subject) || world).lists.map((l) => ({ linkRecord: l.item, otherSubject: l.uri }));
        const { rows, cursor } = pageOf(all, q.get('limit'), q.get('cursor'));
        return json({ items: rows, cursor: cursor ?? null });
      }
    }

    if (url.hostname === 'cardyb.bsky.app') {
      if (url.pathname === '/v1/extract') return json(cardFor(q.get('url') || ''));
      if (url.pathname === '/v1/image') {
        const key = q.get('url') || '';
        if (!cardImages.has(key)) cardImages.set(key, cardImage(hashOf(key)));
        return new Response(cardImages.get(key), { headers: { 'Content-Type': 'image/png' } });
      }
    }

    if (url.hostname === 'video.bsky.app' && method) {
      const answer = await videoAnswer(url, init, method);
      if (answer) return answer;
    }

    return null;
  };

  function list0(uri) {
    for (const w of list) {
      const found = w.lists.find((l) => l.uri === uri);
      if (found) return found;
    }
    return null;
  }
}

/**
 * Swap `window.fetch` for one that answers from the worlds. Requests to this
 * dev server pass through; requests to any other host are refused.
 */
export function installFakeNetwork(worlds, { latency = 60, server = null } = {}) {
  const real = window.fetch.bind(window);
  const route = createRouter(worlds, { server });
  window.fetch = async (input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.href);
    if (url.origin === window.location.origin) return real(input, init);
    const request = typeof input === 'object' && !(input instanceof URL) ? input : null;
    const options = { ...(request ? { method: request.method, headers: request.headers } : {}), ...init };
    if (request && !init?.body && request.method !== 'GET' && request.method !== 'HEAD') options.body = await request.clone().arrayBuffer();
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    await sleep(latency);
    const answer = await route(url.href, options);
    if (answer) return answer;
    console.warn('[harness] refused a request to an outside host:', url.href);
    throw new TypeError(`harness: no fixture for ${url.host}`);
  };
  return route;
}
