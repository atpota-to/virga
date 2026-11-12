// A signed-in agent for one of the harness's accounts. It stands where an
// @atproto/api Agent would: `agent.app.bsky.feed.searchPosts(params, opts)`
// and every other namespaced call resolves to `{ success, headers, data }`
// or throws an XRPC-shaped error (`status`, `error`, `message`). Any property
// chain builds an NSID, so the agent never has to be taught a method's shape
// before it can be called; the methods it answers are in `methods` below, and
// anything else fails loudly with MethodNotImplemented.
//
// It answers from the account's world (harness/world.js) and writes back to
// it (harness/repo.js), so what the page writes shows up in the public feed,
// the repo download and the next read. Inputs aren't checked against the
// lexicons, which keeps today's fixtures working; what is checked is what a
// real account would refuse: writing to another repo, a create over an
// existing record, a swap that doesn't match, and a call the account's
// granted scope doesn't cover (with the PDS's "Missing required scope"
// wording, so the app's re-consent path can be seen).

import { OAUTH_SCOPE } from '../src/config.js';
import { missingScopes } from '../src/session/scopes.js';
import { nextTid } from '../src/posting/lib/tid.js';
import {
  XrpcError,
  keyOf,
  listCollection,
  readRecord,
  removeRecord,
  storeBlob,
  writeRecord,
} from './repo.js';
import { createViews, pageOf } from './views.js';
import { ME, tidAt } from './world.js';

export { XrpcError };

const sleep = (ms) =>
  ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();

const APPVIEW_AUD = 'did:web:api.bsky.app%23bsky_appview';

/** How many drafts Bluesky keeps for an account here. */
export const DRAFT_LIMIT = 50;

/** Bluesky's own server, which keeps drafts and bookmarks whatever the agent was pointed at. */
const APPVIEW_ONLY = new Set([
  'app.bsky.draft.getDrafts',
  'app.bsky.draft.createDraft',
  'app.bsky.draft.updateDraft',
  'app.bsky.draft.deleteDraft',
  'app.bsky.bookmark.getBookmarks',
  'app.bsky.bookmark.createBookmark',
  'app.bsky.bookmark.deleteBookmark',
]);

const REPO_WRITES = new Set([
  'com.atproto.repo.createRecord',
  'com.atproto.repo.putRecord',
  'com.atproto.repo.deleteRecord',
  'com.atproto.repo.applyWrites',
]);

// Read without a session on any PDS, so a scope never covers them.
const PUBLIC_REPO_READS = new Set([
  'com.atproto.repo.getRecord',
  'com.atproto.repo.listRecords',
  'com.atproto.repo.describeRepo',
]);

// Keys that something other than a caller asks a value for.
const NOT_NSID = new Set([
  'then',
  'catch',
  'finally',
  'toJSON',
  'asymmetricMatch',
  '$$typeof',
  'nodeType',
  'nodeName',
  'hasAttribute',
  'getAttribute',
  'inspect',
]);

function abortError() {
  const err = new Error('The operation was aborted.');
  err.name = 'AbortError';
  return err;
}

/**
 * The scope tokens a call needs: one per record written for repo writes, the
 * blob's type for an upload, the minted method for a service-auth token, and
 * the method itself (addressed to Bluesky's AppView) for everything else.
 */
export function scopesFor(nsid, input, opts) {
  if (PUBLIC_REPO_READS.has(nsid)) return [];
  if (REPO_WRITES.has(nsid)) {
    const writes =
      nsid === 'com.atproto.repo.applyWrites'
        ? (input?.writes || []).map((w) => [
            w.collection,
            String(w.$type || '').split('#')[1],
          ])
        : [
            [
              input?.collection,
              {
                createRecord: 'create',
                putRecord: 'update',
                deleteRecord: 'delete',
              }[nsid.split('.').pop()],
            ],
          ];
    return writes.map(
      ([collection, action]) => `repo:${collection}?action=${action}`,
    );
  }
  // Without a type the upload is refused for that, before any scope is asked.
  if (nsid === 'com.atproto.repo.uploadBlob')
    return opts?.encoding ? [`blob:${opts.encoding}`] : [];
  if (nsid === 'com.atproto.server.getServiceAuth')
    return input?.lxm ? [`rpc:${input.lxm}?aud=*`] : [];
  return [`rpc:${nsid}?aud=${APPVIEW_AUD}`];
}

async function bytesOf(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data && typeof data.arrayBuffer === 'function')
    return new Uint8Array(await data.arrayBuffer());
  if (typeof data === 'string') return new TextEncoder().encode(data);
  throw new XrpcError(400, 'InvalidRequest', 'A blob upload needs a body');
}

/** A service-auth token anyone can read back: the fake video service checks what it names. */
export function mintServiceToken({ iss, aud, lxm, exp }) {
  const claims = { iss, aud, lxm: lxm || null, exp };
  return `harness.${btoa(JSON.stringify(claims))}.unsigned`;
}

export function readServiceToken(token) {
  const m = /^harness\.([^.]+)\.unsigned$/.exec(
    String(token || '').replace(/^Bearer\s+/i, ''),
  );
  if (!m) return null;
  try {
    return JSON.parse(atob(m[1]));
  } catch {
    return null;
  }
}

function localStorageCounter(key) {
  return {
    next() {
      try {
        const n = Number(globalThis.localStorage?.getItem(key) || 0) + 1;
        globalThis.localStorage?.setItem(key, String(n));
        return n;
      } catch {
        return 1;
      }
    },
  };
}

/**
 * Mira's followers change between syncs, as they do: from the second sweep on,
 * a dozen people have left and three have arrived, so the Unfollow tracker has
 * something to find. The sweep count outlives the page (it lives with the
 * archive); clear the site's data to start over.
 */
function followerChurn(world, counter) {
  const arrivals = [0, 1, 2].map((i) => {
    const at = world.now - (3 + i * 5) * 3_600_000;
    const did = `did:plc:virgaharnessnew${String(i).padStart(4, '0')}`;
    return {
      did,
      handle: ['tove.example.org', 'quentin.example.net', 'zadie.example.com'][
        i
      ],
      displayName: ['Tove Haddad', 'Quentin Abara', ''][i],
      avatar: '',
      viewer: {
        followedBy: `at://${did}/app.bsky.graph.follow/${tidAt(at, 900 + i)}`,
      },
    };
  });
  let current = world.followers;
  return {
    startSweep() {
      const n = counter.next();
      current =
        n < 2
          ? world.followers
          : [...arrivals, ...world.followers.filter((_, i) => i % 397 !== 11)];
    },
    get list() {
      return current;
    },
  };
}

/**
 * The methods one account's agent answers. `input` is the params of a query
 * or the body of a procedure, `opts` the call options (`encoding`, `signal`).
 */
function methodsFor(world, { views, did, churn }) {
  const ownRepo = (repo) => {
    if (repo && repo !== did && repo !== world.me.handle) {
      throw new XrpcError(
        403,
        'InvalidRequest',
        'This account can only write to its own repo',
      );
    }
  };
  const repoWorld = (repo) => {
    const other =
      views.byDid.get(repo) || views.byDid.get(views.resolveHandle(repo));
    if (!other)
      throw new XrpcError(
        400,
        'InvalidRequest',
        `Could not find repo: ${repo}`,
      );
    return other;
  };
  const notFound = (collection, rkey) =>
    new XrpcError(
      400,
      'RecordNotFound',
      `Could not locate record: at://${did}/${collection}/${rkey}`,
    );
  const checkSwap = (collection, rkey, swapRecord) => {
    if (swapRecord === undefined) return;
    const current = readRecord(world, collection, rkey);
    if (
      (swapRecord === null && current) ||
      (swapRecord !== null && current?.cid !== swapRecord)
    ) {
      throw new XrpcError(
        400,
        'InvalidSwap',
        `Record was at ${current?.cid ?? 'null'}`,
      );
    }
  };
  const commit = () => ({ cid: 'bafyharnesscommit', rev: tidAt(Date.now()) });
  const sortedDrafts = () =>
    [...world.drafts].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

  return {
    /* ---- the dashboard's reads ---------------------------------------- */
    'app.bsky.graph.getFollowers'({ limit, cursor }) {
      let all = world.followers;
      if (churn) {
        if (!cursor) churn.startSweep();
        all = churn.list;
      }
      const { rows, cursor: next } = pageOf(all, limit, cursor);
      return { subject: views.card(did), followers: rows, cursor: next };
    },
    'app.bsky.notification.listNotifications'({ limit, cursor }) {
      const { rows, cursor: next } = pageOf(world.notifications, limit, cursor);
      return { notifications: rows, cursor: next };
    },

    /* ---- the repo ------------------------------------------------------ */
    'com.atproto.repo.listRecords'({
      repo,
      collection,
      limit,
      cursor,
      reverse,
    }) {
      const source = repo && repo !== did ? repoWorld(repo) : world;
      let all = listCollection(source, collection);
      if (reverse) all = [...all].reverse();
      const { rows, cursor: next } = pageOf(all, limit, cursor);
      return { records: rows, cursor: next };
    },
    'com.atproto.repo.getRecord'({ repo, collection, rkey }) {
      const source = repo && repo !== did ? repoWorld(repo) : world;
      const found = readRecord(source, collection, rkey);
      if (!found) throw notFound(collection, rkey);
      return found;
    },
    'com.atproto.repo.describeRepo'() {
      const collections = new Set([
        'app.bsky.actor.profile',
        'app.bsky.feed.post',
        'app.bsky.graph.follow',
        'app.bsky.feed.like',
        'app.bsky.feed.repost',
      ]);
      for (const r of world.others) collections.add(r.collection);
      for (const key of world.written.keys())
        collections.add(key.split('/')[0]);
      return {
        did,
        handle: world.me.handle,
        handleIsCorrect: true,
        collections: [...collections].sort(),
        didDoc: {},
      };
    },
    async 'com.atproto.repo.createRecord'({ repo, collection, rkey, record }) {
      ownRepo(repo);
      const res = await writeRecord(world, {
        collection,
        rkey: rkey || nextTid(),
        record,
        createOnly: true,
      });
      return {
        uri: res.uri,
        cid: res.cid,
        commit: commit(),
        validationStatus: 'valid',
      };
    },
    async 'com.atproto.repo.putRecord'({
      repo,
      collection,
      rkey,
      record,
      swapRecord,
    }) {
      ownRepo(repo);
      checkSwap(collection, rkey, swapRecord);
      const res = await writeRecord(world, { collection, rkey, record });
      return {
        uri: res.uri,
        cid: res.cid,
        commit: commit(),
        validationStatus: 'valid',
      };
    },
    'com.atproto.repo.deleteRecord'({ repo, collection, rkey, swapRecord }) {
      ownRepo(repo);
      checkSwap(collection, rkey, swapRecord);
      removeRecord(world, collection, rkey);
      return { commit: commit() };
    },
    async 'com.atproto.repo.applyWrites'({ repo, writes }) {
      ownRepo(repo);
      if (!Array.isArray(writes) || writes.length === 0)
        throw new XrpcError(400, 'InvalidRequest', 'applyWrites needs writes');
      if (writes.length > 200)
        throw new XrpcError(400, 'InvalidRequest', 'Too many writes. Max: 200');
      // All or nothing: every create is checked before anything is written.
      const planned = writes.map((w) => ({
        ...w,
        kind: String(w.$type || '').split('#')[1],
        rkey: w.rkey || nextTid(),
      }));
      const seen = new Set();
      for (const w of planned) {
        if (!['create', 'update', 'delete'].includes(w.kind))
          throw new XrpcError(
            400,
            'InvalidRequest',
            `Unknown write: ${w.$type}`,
          );
        const key = keyOf(w.collection, w.rkey);
        if (seen.has(key))
          throw new XrpcError(400, 'InvalidRequest', `Two writes to ${key}`);
        seen.add(key);
        if (w.kind === 'create' && readRecord(world, w.collection, w.rkey)) {
          throw new XrpcError(
            400,
            'InvalidRequest',
            `Record already exists at ${key}`,
          );
        }
      }
      const results = [];
      for (const w of planned) {
        if (w.kind === 'delete') {
          removeRecord(world, w.collection, w.rkey);
          results.push({ $type: 'com.atproto.repo.applyWrites#deleteResult' });
        } else {
          const res = await writeRecord(world, {
            collection: w.collection,
            rkey: w.rkey,
            record: w.value,
          });
          results.push({
            $type: `com.atproto.repo.applyWrites#${w.kind}Result`,
            uri: res.uri,
            cid: res.cid,
            validationStatus: 'valid',
          });
        }
      }
      return { commit: commit(), results };
    },
    async 'com.atproto.repo.uploadBlob'(data, opts) {
      const encoding = opts?.encoding || opts?.headers?.['content-type'] || '';
      if (!encoding || encoding === 'application/octet-stream') {
        throw new XrpcError(
          400,
          'InvalidRequest',
          'A blob upload needs its media type',
        );
      }
      const bytes = await bytesOf(data);
      return { blob: await storeBlob(world, bytes, encoding) };
    },
    'com.atproto.server.getServiceAuth'({ aud, lxm, exp }) {
      if (!aud) throw new XrpcError(400, 'InvalidRequest', 'aud is required');
      const now = Math.floor(Date.now() / 1000);
      const expiry = exp ? Number(exp) : now + 60;
      if (!Number.isFinite(expiry) || expiry <= now)
        throw new XrpcError(400, 'BadExpiration', 'expiration is in the past');
      if (expiry - now > (lxm ? 3600 : 60))
        throw new XrpcError(
          400,
          'BadExpiration',
          'cannot request a token that long-lived',
        );
      return { token: mintServiceToken({ iss: did, aud, lxm, exp: expiry }) };
    },

    /* ---- Bluesky's AppView, signed in ------------------------------------ */
    'app.bsky.actor.getPreferences'() {
      return { preferences: world.preferences };
    },
    'app.bsky.actor.putPreferences'({ preferences }) {
      world.preferences = Array.isArray(preferences) ? preferences : [];
      return {};
    },
    'app.bsky.bookmark.getBookmarks'({ limit, cursor }) {
      const { rows, cursor: next } = pageOf(world.bookmarks, limit, cursor);
      return {
        bookmarks: rows.map((b) => {
          const view = views.postView(b.uri);
          return {
            subject: { uri: b.uri, cid: view?.cid || 'bafyharness' },
            createdAt: b.createdAt,
            item: view || {
              $type: 'app.bsky.feed.defs#notFoundPost',
              uri: b.uri,
              notFound: true,
            },
          };
        }),
        cursor: next,
      };
    },
    'app.bsky.bookmark.createBookmark'({ uri }) {
      if (!world.bookmarks.some((b) => b.uri === uri))
        world.bookmarks.unshift({ uri, createdAt: new Date().toISOString() });
      return {};
    },
    'app.bsky.bookmark.deleteBookmark'({ uri }) {
      world.bookmarks = world.bookmarks.filter((b) => b.uri !== uri);
      return {};
    },
    'app.bsky.feed.searchPosts'({ q, limit, cursor, author }) {
      if (!q) throw new XrpcError(400, 'InvalidRequest', 'q is required');
      let all = views.searchPosts(q);
      if (author) {
        const authorDid = author.startsWith('did:')
          ? author
          : views.resolveHandle(author);
        all = all.filter((v) => v.author.did === authorDid);
      }
      const { rows, cursor: next } = pageOf(all, limit ?? 25, cursor);
      return { posts: rows, cursor: next, hitsTotal: all.length };
    },

    /* ---- drafts (app.bsky.draft.*), kept for the account alone ---------- */
    'app.bsky.draft.getDrafts'({ limit, cursor }) {
      const { rows, cursor: next } = pageOf(sortedDrafts(), limit, cursor);
      return { drafts: rows, cursor: next };
    },
    'app.bsky.draft.createDraft'({ draft }) {
      if (!draft || !Array.isArray(draft.posts) || draft.posts.length === 0) {
        throw new XrpcError(
          400,
          'InvalidRequest',
          'A draft needs at least one post',
        );
      }
      if (world.drafts.length >= DRAFT_LIMIT) {
        throw new XrpcError(400, 'DraftLimitReached', 'Draft limit reached');
      }
      const stamp = new Date().toISOString();
      const id = nextTid();
      world.drafts.push({ id, draft, createdAt: stamp, updatedAt: stamp });
      return { id };
    },
    'app.bsky.draft.updateDraft'({ draft }) {
      // Bluesky answers an update to a draft that is gone with success, and
      // changes nothing; drafts.js looks first because of it.
      const found = world.drafts.find((d) => d.id === draft?.id);
      if (found) {
        found.draft = draft.draft;
        found.updatedAt = new Date().toISOString();
      }
      return {};
    },
    'app.bsky.draft.deleteDraft'({ id }) {
      world.drafts = world.drafts.filter((d) => d.id !== id);
      return {};
    },
  };
}

/**
 * An agent for `world`'s account.
 *
 * @param {object} world - from buildWorld()
 * @param {object} [options]
 * @param {string} [options.did] - the account (the world's, by default)
 * @param {number} [options.latency] - simulated delay per call, in ms (writes take four times as long)
 * @param {object[]} [options.worlds] - every account's world, so posts and people resolve across them
 * @param {string} [options.scope] - the scope the session was granted (OAUTH_SCOPE by default)
 * @param {{ next(): number }} [options.sweepCounter] - counts follower sweeps (Mira's churn); localStorage by default
 */
export function createFakeAgent(
  world,
  {
    did = world.me.did,
    latency = 0,
    worlds = [world],
    scope = OAUTH_SCOPE,
    sweepCounter,
  } = {},
) {
  const views = createViews(
    worlds.includes(world) ? worlds : [world, ...worlds],
  );
  const churn =
    did === ME.did
      ? followerChurn(
          world,
          sweepCounter || localStorageCounter('virga-harness:follower-sweeps'),
        )
      : null;
  const methods = methodsFor(world, { views, did, churn });

  async function handle(nsid, input, opts, proxy) {
    if (opts?.signal?.aborted) throw abortError();
    await sleep(
      REPO_WRITES.has(nsid) || nsid === 'com.atproto.repo.uploadBlob'
        ? latency * 4
        : latency,
    );
    if (opts?.signal?.aborted) throw abortError();
    const method = methods[nsid];
    if (!method) {
      console.warn('[harness] the fake agent has no answer for', nsid);
      throw new XrpcError(
        501,
        'MethodNotImplemented',
        `Method Not Implemented: ${nsid}`,
      );
    }
    if (
      APPVIEW_ONLY.has(nsid) &&
      proxy !== 'did:web:api.bsky.app#bsky_appview'
    ) {
      throw new XrpcError(
        501,
        'MethodNotImplemented',
        `${nsid} is only answered by Bluesky's AppView; call it through withProxy('bsky_appview', 'did:web:api.bsky.app')`,
      );
    }
    const missing = missingScopes(scope, scopesFor(nsid, input, opts));
    if (missing.length)
      throw new XrpcError(
        403,
        'ScopeMissingError',
        `Missing required scope "${missing[0]}"`,
      );
    const data = await method(input ?? {}, opts ?? {});
    return { success: true, headers: {}, data };
  }

  function namespace(path, proxy) {
    return new Proxy(function fakeXrpcMethod() {}, {
      get(target, key) {
        // Never a thenable, so `await` on a namespace doesn't try to call it;
        // and a function's own properties stay a function's, for whatever
        // inspects one (a console, a test's diff).
        if (typeof key !== 'string' || NOT_NSID.has(key)) return undefined;
        if (
          key in Function.prototype ||
          Object.prototype.hasOwnProperty.call(target, key)
        )
          return Reflect.get(target, key);
        return namespace([...path, key], proxy);
      },
      apply(_, __, args) {
        return handle(path.join('.'), args[0], args[1], proxy);
      },
    });
  }

  function make(proxy) {
    return {
      did,
      /** The service calls are proxied to (`did#service`), or null for the PDS's default. */
      proxy,
      withProxy(serviceType, aud) {
        return make(`${aud}#${serviceType}`);
      },
      /** `handle(nsid, input, opts)`: the same as calling the method by its path. */
      handle: (nsid, input, opts) => handle(nsid, input, opts, proxy),
      app: namespace(['app'], proxy),
      com: namespace(['com'], proxy),
      chat: namespace(['chat'], proxy),
      tools: namespace(['tools'], proxy),
    };
  }

  return make(null);
}
