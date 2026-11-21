// The archive hook end to end: useAnalyticsArchive run as a component would
// run it (a small stand-in for React's useState, useRef and useEffect, so
// state updates, effects and stale closures behave as they do in the app),
// against a made-up small account whose AppView, PDS, repo CAR, PLC entry
// and Constellation answers are faked. Each scenario is a sequence of steps
// (mounts and the actions a page takes); each step records every request,
// wait, every state of the sync bar, and the archive as it stands after.
// The store is the session-only fallback (no IndexedDB in Node), shared by
// the steps of a scenario as one account's database is.
//
//   first-build-then-sync   the Build button, then an automatic top-up two
//                           hours later (a repo diff, a follower lost and
//                           one gained), then the People tab's actions
//   interrupted-build       a build called off partway, resumed on the
//                           next mount from its checkpointed cursor
//   repo-unavailable        no CAR: likes and reposts walked instead
//   old-archive             rows of the older shape brought up from the
//                           repo, and a diff the PDS refuses
//
// Swift: VirgaArchive/Archive/ArchiveModel*.swift, replayed through
// MockTransport (ArchiveModelParityTests).

import { vi } from 'vitest';
import { Agent } from '@atproto/api';
import { buildRepoCar } from '../../../harness/buildCar.js';
import {
  resetAnalyticsStore,
  openAnalyticsStore,
} from '../../../src/lib/analyticsStore.js';
import { getDidDocument } from '../../../src/lib/atproto.js';
import { each } from './_helpers.js';
import { recordFetch, json } from './_fetch.js';

export const sources = ['src/archive/useAnalyticsArchive.js'];

const PDS = 'https://pds.example';
const CID = 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku';
const NOW = Date.UTC(2026, 10, 14, 12);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (ms) => new Date(ms).toISOString();

const B32 = '234567abcdefghijklmnopqrstuvwxyz';
function tid(ms, clock = 0) {
  let n = (BigInt(ms) * 1000n) << 10n;
  n |= BigInt(clock);
  let s = '';
  for (let i = 0; i < 13; i++) {
    s = B32[Number(n & 31n)] + s;
    n >>= 5n;
  }
  return s;
}

/* ------------------------------------------------------------------ */
/* A stand-in for React's hooks                                          */
/* ------------------------------------------------------------------ */

let current = null;

const fakeReact = {
  useState(initial) {
    const c = current;
    const i = c.index++;
    if (!(i in c.state)) {
      c.state[i] = typeof initial === 'function' ? initial() : initial;
      c.setters[i] = (value) => {
        const old = c.state[i];
        const next = typeof value === 'function' ? value(old) : value;
        if (Object.is(next, old)) return;
        c.state[i] = next;
        c.onState?.(i, next);
        c.render();
      };
    }
    return [c.state[i], c.setters[i]];
  },
  useRef(initial) {
    const c = current;
    const i = c.index++;
    if (!(i in c.refs)) c.refs[i] = { current: initial };
    return c.refs[i];
  },
  useEffect(fn, deps) {
    const c = current;
    const i = c.index++;
    const prev = c.effects[i];
    const changed =
      !prev ||
      !deps ||
      deps.length !== prev.deps.length ||
      deps.some((d, k) => !Object.is(d, prev.deps[k]));
    if (changed) c.pending.push({ i, fn, deps });
    else c.pending.push(null);
  },
  useMemo(fn) {
    return fn();
  },
};

/** Mounts `hook(...args)`; `api()` is the latest render's answer. */
function mount(hook, args, { onSync } = {}) {
  const c = {
    state: {},
    setters: {},
    refs: {},
    effects: {},
    pending: [],
    index: 0,
    rendering: false,
    dirty: false,
    value: null,
  };
  c.onState = (i, value) => {
    // useAnalyticsArchive's third useState is the sync bar.
    if (i === 2) onSync?.(value);
  };
  c.render = () => {
    if (c.rendering) {
      c.dirty = true;
      return;
    }
    c.rendering = true;
    try {
      do {
        c.dirty = false;
        current = c;
        c.index = 0;
        c.pending = [];
        c.value = hook(...args);
        current = null;
        for (const effect of c.pending) {
          if (!effect) continue;
          c.effects[effect.i]?.cleanup?.();
          const cleanup = effect.fn();
          c.effects[effect.i] = {
            deps: effect.deps,
            cleanup: typeof cleanup === 'function' ? cleanup : null,
          };
        }
      } while (c.dirty);
    } finally {
      c.rendering = false;
    }
  };
  c.render();
  return {
    api: () => c.value,
    unmount: () => {
      for (const effect of Object.values(c.effects)) effect?.cleanup?.();
    },
  };
}

/** Lets every queued promise and timer run (recordFetch's timers run at once). */
async function settle(rounds = 200) {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}

/** The archive as it stands, as the hook returns it. */
function snapshot(api) {
  const a = api();
  return {
    loaded: a.loaded,
    persistent: a.persistent,
    blocked: a.blocked,
    posts: a.posts,
    followers: a.followers,
    following: a.following,
    blocks: a.blocks,
    inbound: a.inbound,
    outbound: a.outbound,
    atmosphere: a.atmosphere,
    meta: a.meta,
    rev: a.rev,
    followRev: a.followRev,
    actors: [...a.actors.values()],
    sync: a.sync,
    syncError: a.syncError,
  };
}

/* ------------------------------------------------------------------ */
/* A small made-up account                                                */
/* ------------------------------------------------------------------ */

const profileView = (did, handle, over = {}) => ({ did, handle, ...over });

function account(did) {
  const post = (rkey, at, text, extra = {}) => [
    `app.bsky.feed.post/${rkey}`,
    { $type: 'app.bsky.feed.post', text, createdAt: iso(at), ...extra },
  ];
  const like = (rkey, subjectDid, at) => [
    `app.bsky.feed.like/${rkey}`,
    {
      $type: 'app.bsky.feed.like',
      subject: { uri: `at://${subjectDid}/app.bsky.feed.post/x`, cid: CID },
      createdAt: iso(at),
    },
  ];
  const repost = (rkey, subjectDid, at) => [
    `app.bsky.feed.repost/${rkey}`,
    {
      $type: 'app.bsky.feed.repost',
      subject: { uri: `at://${subjectDid}/app.bsky.feed.post/y`, cid: CID },
      createdAt: iso(at),
    },
  ];
  const follow = (rkey, subject, at) => [
    `app.bsky.graph.follow/${rkey}`,
    { $type: 'app.bsky.graph.follow', subject, createdAt: iso(at) },
  ];
  const records = [
    post(tid(NOW - 100 * DAY), NOW - 100 * DAY, 'the first post #hello'),
    post(tid(NOW - 40 * DAY), NOW - 40 * DAY, 'a reply', {
      reply: {
        root: { uri: 'at://did:plc:friend/app.bsky.feed.post/r', cid: CID },
        parent: { uri: 'at://did:plc:friend/app.bsky.feed.post/r', cid: CID },
      },
    }),
    post(tid(NOW - 10 * DAY), NOW - 10 * DAY, 'pictures', {
      embed: {
        $type: 'app.bsky.embed.images',
        images: [
          {
            alt: 'a heron',
            image: {
              $type: 'blob',
              ref: { $link: CID },
              mimeType: 'image/jpeg',
              size: 3,
            },
          },
        ],
      },
    }),
    post(tid(NOW - 2 * DAY), NOW - 2 * DAY, 'recent'),
    like(tid(NOW - 5 * DAY), 'did:plc:liked', NOW - 5 * DAY),
    like(tid(NOW - 400 * DAY), 'did:plc:old', NOW - 400 * DAY),
    repost(tid(NOW - 3 * DAY), 'did:plc:reposted', NOW - 3 * DAY),
    follow(tid(NOW - 50 * DAY), 'did:plc:ana', NOW - 50 * DAY),
    [
      'app.bsky.actor.profile/self',
      { $type: 'app.bsky.actor.profile', displayName: 'Owner' },
    ],
  ].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return { did, records };
}

function feedItem(did, key, record, counts = {}) {
  return {
    post: {
      uri: `at://${did}/${key}`,
      cid: CID,
      author: profileView(did, 'owner.test'),
      record,
      likeCount: counts.likes ?? 1,
      repostCount: counts.reposts ?? 0,
      replyCount: counts.replies ?? 0,
      quoteCount: counts.quotes ?? 0,
      indexedAt: record.createdAt,
    },
  };
}

/** Answers for an account's world, by what each request asks for. */
function world(did, overrides = {}) {
  const acct = account(did);
  const posts = acct.records
    .filter(([k]) => k.startsWith('app.bsky.feed.post/'))
    .reverse();
  const items = posts.map(([key, record], n) =>
    feedItem(did, key, record, { likes: n + 1, replies: n }),
  );
  const car = overrides.car;
  return (request) => {
    const url = new URL(request.url);
    const method = url.pathname.split('/').pop();
    const pick = overrides[method];
    if (typeof pick === 'function') {
      const out = pick(request, url);
      if (out !== undefined) return out;
    }
    if (url.origin === 'https://plc.directory') {
      return json({
        id: did,
        service: [
          {
            id: '#atproto_pds',
            type: 'AtprotoPersonalDataServer',
            serviceEndpoint: `${PDS}/`,
          },
        ],
      });
    }
    switch (method) {
      case 'app.bsky.actor.getProfile':
        return json(
          profileView(did, 'owner.test', {
            followersCount: 5,
            followsCount: 1,
            postsCount: 4,
          }),
        );
      case 'app.bsky.graph.getFollowers':
        return json({
          subject: profileView(did, 'owner.test'),
          followers: [
            profileView('did:plc:ana', 'ana.test', {
              viewer: {
                followedBy: `at://did:plc:ana/app.bsky.graph.follow/${tid(NOW - 60 * DAY)}`,
              },
            }),
            profileView('did:plc:bo', 'bo.test', {
              displayName: 'Bo',
              viewer: {
                followedBy: `at://did:plc:bo/app.bsky.graph.follow/${tid(NOW - 20 * DAY)}`,
              },
            }),
          ],
        });
      case 'com.atproto.repo.listRecords':
        return json({ records: [] });
      case 'blue.microcosm.links.getBacklinks':
        return json({ total: 0, records: [] });
      case 'blue.microcosm.links.getManyToMany':
        return json({ items: [] });
      case 'com.atproto.sync.getRepo':
        return car
          ? { status: 200, bytes: car, contentType: 'application/vnd.ipld.car' }
          : json({ error: 'RepoNotFound' }, 400);
      case 'app.bsky.feed.getAuthorFeed':
        if (url.searchParams.get('limit') === '1')
          return json({ feed: items.slice(0, 1) });
        return url.searchParams.get('cursor') === 'feed2'
          ? json({ feed: items.slice(2) })
          : json({ feed: items.slice(0, 2), cursor: 'feed2' });
      case 'app.bsky.notification.listNotifications':
        return json({
          notifications: [
            {
              uri: 'at://did:plc:fan/app.bsky.feed.like/1',
              cid: CID,
              author: profileView('did:plc:fan', 'fan.test'),
              reason: 'like',
              reasonSubject: `at://${did}/${posts[0][0]}`,
              record: {
                $type: 'app.bsky.feed.like',
                createdAt: iso(NOW - DAY),
              },
              isRead: false,
              indexedAt: iso(NOW - DAY),
            },
          ],
        });
      case 'app.bsky.actor.getProfiles':
        return json({
          profiles: url.searchParams
            .getAll('actors')
            .map((a) =>
              profileView(a, `${a.slice(8)}.test`, { displayName: a.slice(8) }),
            ),
        });
      case 'com.atproto.repo.createRecord':
        return json({
          uri: `at://${did}/app.bsky.graph.follow/${tid(NOW)}`,
          cid: CID,
        });
      case 'com.atproto.repo.deleteRecord':
        return json({});
      default:
        throw new Error(`no answer for ${request.url}`);
    }
  };
}

/* ------------------------------------------------------------------ */
/* Scenarios                                                              */
/* ------------------------------------------------------------------ */

let useAnalyticsArchive;

async function loadHook() {
  if (useAnalyticsArchive) return;
  vi.doMock('react', () => fakeReact);
  ({ useAnalyticsArchive } =
    await import('../../../src/archive/useAnalyticsArchive.js'));
  vi.doUnmock('react');
}

/**
 * One step: mount (or use the mounted hook) and act, with fetch faked by
 * `answer`, at `now`. `abortAt` cancels the sync when that request's answer
 * arrives.
 */
/**
 * `new Date()` with no arguments reads the machine's clock, not Date.now;
 * while a step runs it reads Date.now (recordFetch's fixed time).
 */
async function withFixedDate(fn) {
  const RealDate = globalThis.Date;
  class FixedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(globalThis.Date.now());
      else super(...args);
    }
  }
  globalThis.Date = FixedDate;
  try {
    return await fn();
  } finally {
    globalThis.Date = RealDate;
  }
}

async function step(state, { now, answer, abortAt = null, act }) {
  const history = [];
  const out = await withFixedDate(() =>
    recordFetch(
      (request, index) => {
        if (index === abortAt) state.hook?.api().cancelSync();
        return answer(request);
      },
      async () => {
        if (!state.hook) {
          state.hook = mount(
            useAnalyticsArchive,
            [
              new Agent({
                service: PDS,
                fetch: (input, init) => globalThis.fetch(input, init),
              }),
              state.did,
              'owner.test',
            ],
            { onSync: (s) => state.onSync?.(s) },
          );
        }
        state.onSync = (s) => history.push(s);
        for (let i = 0; i < 2000 && !state.hook.api().loaded; i++)
          await settle(1);
        const result = act ? await act(state.hook.api) : undefined;
        // An automatic sync runs on its own: wait for the bar to go.
        await settle();
        for (
          let i = 0;
          i < 20000 && history.length && history.at(-1) !== null;
          i++
        )
          await settle(1);
        await settle();
        return {
          ...(result === undefined ? {} : { result }),
          archive: snapshot(state.hook.api),
        };
      },
      { now },
    ),
  );
  return { ...out, history };
}

/**
 * atproto.js keeps DID documents ten minutes in module state; the runner
 * builds every fixture twice, so a scenario starts by evicting its own
 * (a read that fails, at a time past the entry's life, drops it).
 */
async function forgetDidDocument(did) {
  const realNow = Date.now;
  const realFetch = globalThis.fetch;
  Date.now = () => 8.64e15;
  globalThis.fetch = async () => {
    throw new TypeError('evicting');
  };
  try {
    await getDidDocument(did).catch(() => {});
  } finally {
    Date.now = realNow;
    globalThis.fetch = realFetch;
  }
}

async function scenario(did, steps) {
  resetAnalyticsStore();
  await forgetDidDocument(did);
  const state = { did, hook: null };
  const out = [];
  for (const s of steps) {
    if (s.remount) {
      state.hook?.unmount();
      state.hook = null;
    }
    const { name, remount, ...rest } = s;
    out.push({
      name,
      remount: Boolean(remount),
      ...(rest.abortAt != null ? { abortAt: rest.abortAt } : {}),
      now: rest.now,
      ...(await step(state, rest)),
    });
  }
  state.hook?.unmount();
  return out;
}

export default async function cases() {
  await loadHook();
  const out = [];

  // 1. The Build button, a top-up two hours later, and the People tab.
  const A = 'did:plc:archiveaaaaaaaaaaaaaaaaaa';
  const carA = await buildRepoCar(A, account(A).records, {
    rev: '3mrevaaaaaa22',
  });
  const diffRecords = [
    [
      `app.bsky.feed.post/${tid(NOW + HOUR)}`,
      {
        $type: 'app.bsky.feed.post',
        text: 'new since',
        createdAt: iso(NOW + HOUR),
      },
    ],
  ];
  const diffA = await buildRepoCar(A, diffRecords, { rev: '3mrevbbbbbb22' });
  const laterFollowers = () =>
    json({
      subject: profileView(A, 'owner.test'),
      followers: [
        profileView('did:plc:bo', 'bo.test', {
          displayName: 'Bo',
          viewer: {
            followedBy: `at://did:plc:bo/app.bsky.graph.follow/${tid(NOW - 20 * DAY)}`,
          },
        }),
        profileView('did:plc:cy', 'cy.test', {
          viewer: {
            followedBy: `at://did:plc:cy/app.bsky.graph.follow/${tid(NOW + HOUR)}`,
          },
        }),
      ],
    });
  const followsA = (request, url) =>
    url.searchParams.get('collection') === 'app.bsky.graph.follow'
      ? json({
          records: [
            {
              uri: `at://${A}/app.bsky.graph.follow/${tid(NOW - 50 * DAY)}`,
              cid: CID,
              value: {
                $type: 'app.bsky.graph.follow',
                subject: 'did:plc:ana',
                createdAt: iso(NOW - 50 * DAY),
              },
            },
          ],
        })
      : undefined;
  const blocksA = {
    'blue.microcosm.links.getBacklinks': (request, url) =>
      url.searchParams.get('source') === 'app.bsky.graph.block:subject'
        ? json({
            total: 1,
            records: [
              {
                did: 'did:plc:blocker',
                collection: 'app.bsky.graph.block',
                rkey: tid(NOW - 7 * DAY),
              },
            ],
          })
        : json({
            total: 1,
            records: [
              {
                did: 'did:plc:sub',
                collection: 'app.bsky.graph.listblock',
                rkey: tid(NOW - 6 * DAY),
              },
            ],
          }),
    'blue.microcosm.links.getManyToMany': () =>
      json({
        items: [
          {
            linkRecord: {
              did: 'did:plc:mod',
              collection: 'app.bsky.graph.listitem',
              rkey: tid(NOW - 8 * DAY),
            },
            otherSubject: 'at://did:plc:mod/app.bsky.graph.list/m',
          },
        ],
      }),
    'com.atproto.repo.getRecord': () =>
      json({
        uri: 'at://did:plc:mod/app.bsky.graph.list/m',
        cid: CID,
        value: {
          $type: 'app.bsky.graph.list',
          purpose: 'app.bsky.graph.defs#modlist',
          name: 'Mods',
          createdAt: iso(NOW),
        },
      }),
  };
  out.push(
    ...(await each(
      'scenario',
      [{ $id: 'first-build-then-sync', did: A }],
      ({ did }) =>
        scenario(did, [
          {
            name: 'mount',
            now: NOW,
            answer: world(did, {
              car: carA,
              'com.atproto.repo.listRecords': followsA,
              ...blocksA,
            }),
          },
          {
            name: 'build',
            now: NOW,
            answer: world(did, {
              car: carA,
              'com.atproto.repo.listRecords': followsA,
              ...blocksA,
            }),
            act: (api) => api().runSync(),
          },
          {
            name: 'later-sync',
            remount: true,
            now: NOW + 2 * HOUR,
            answer: world(did, {
              car: diffA,
              'app.bsky.graph.getFollowers': laterFollowers,
              'com.atproto.repo.listRecords': followsA,
              ...blocksA,
            }),
          },
          {
            name: 'people',
            now: NOW + 3 * HOUR,
            answer: world(did, {}),
            act: async (api) => {
              await api().setFollow('did:plc:cy', true);
              await api().setFollow('did:plc:ana', false);
              await api().wantActors([
                'did:plc:cy',
                'did:plc:fan',
                null,
                'did:plc:cy',
              ]);
              await api().wantActors(['did:plc:cy']);
              const read = await api().checkActivity([
                'did:plc:cy',
                'did:plc:fan',
              ]);
              await api().notePosted({
                uri: `at://${did}/app.bsky.feed.post/${tid(NOW + 3 * HOUR)}`,
                cid: CID,
                record: {
                  $type: 'app.bsky.feed.post',
                  text: 'just posted',
                  createdAt: iso(NOW + 3 * HOUR),
                },
              });
              await api().noteDeleted([
                `at://${did}/app.bsky.feed.post/${tid(NOW - 2 * DAY)}`,
                'at://did:plc:other/app.bsky.feed.post/x',
              ]);
              return { activityRead: read };
            },
          },
          {
            name: 'delete',
            now: NOW + 4 * HOUR,
            answer: world(did, {}),
            act: async (api) => {
              await api().deleteArchive();
            },
          },
        ]),
    )),
  );

  // 2. A build called off partway, resumed on the next mount.
  const B = 'did:plc:archivebbbbbbbbbbbbbbbbbb';
  const carB = await buildRepoCar(B, account(B).records, {
    rev: '3mrevcccccc22',
  });
  out.push(
    ...(await each(
      'scenario',
      [{ $id: 'interrupted-build', did: B }],
      ({ did }) =>
        scenario(did, [
          { name: 'mount', now: NOW, answer: world(did, { car: carB }) },
          // Requests: profile, followers, follows, direct blocks, list
          // memberships, PLC, the repo, then the author feed's first page:
          // called off as it lands.
          {
            name: 'build-called-off',
            now: NOW,
            answer: world(did, { car: carB }),
            abortAt: 7,
            act: (api) => api().runSync(),
          },
          {
            name: 'resumed',
            remount: true,
            now: NOW + 10 * 60_000,
            answer: world(did, { car: carB }),
          },
        ]),
    )),
  );

  // 3. No CAR: likes and reposts are walked instead.
  const C = 'did:plc:archivecccccccccccccccccc';
  const likesC = (request, url) => {
    const collection = url.searchParams.get('collection');
    if (collection === 'app.bsky.feed.like') {
      return json({
        records: [
          {
            uri: `at://${C}/app.bsky.feed.like/${tid(NOW - 4 * DAY)}`,
            cid: CID,
            value: {
              $type: 'app.bsky.feed.like',
              subject: {
                uri: 'at://did:plc:liked/app.bsky.feed.post/1',
                cid: CID,
              },
              createdAt: iso(NOW - 4 * DAY),
            },
          },
        ],
      });
    }
    if (collection === 'app.bsky.feed.repost')
      return json(
        { error: 'InvalidRequest', message: 'Could not locate record' },
        400,
      );
    return undefined;
  };
  out.push(
    ...(await each(
      'scenario',
      [{ $id: 'repo-unavailable', did: C }],
      ({ did }) =>
        scenario(did, [
          {
            name: 'mount',
            now: NOW,
            answer: world(did, { 'com.atproto.repo.listRecords': likesC }),
          },
          {
            name: 'build',
            now: NOW,
            answer: world(did, { 'com.atproto.repo.listRecords': likesC }),
            act: (api) => api().runSync('full'),
          },
        ]),
    )),
  );

  // 4. An archive from before post rows kept what a post is made of, and a
  // diff the PDS no longer holds.
  const D = 'did:plc:archivedddddddddddddddddd';
  const carD = await buildRepoCar(D, account(D).records, {
    rev: '3mrevdddddd22',
  });
  const oldShape = async () => {
    const store = await openAnalyticsStore(D);
    const recs = account(D).records.filter(([k]) =>
      k.startsWith('app.bsky.feed.post/'),
    );
    await store.putAll(
      'posts',
      recs.map(([key, record]) => ({
        uri: `at://${D}/${key}`,
        rkey: key.split('/').pop(),
        at: record.createdAt,
        text: record.text.slice(0, 5),
        replyTo: null,
        quoteOf: null,
        hasMedia: false,
        likes: 9,
        reposts: 1,
        replies: 0,
        quotes: 0,
      })),
    );
    await store.setMeta('posts', {
      syncedAt: NOW - 30 * DAY,
      complete: true,
      cursor: null,
      shape: 1,
    });
    await store.setMeta('repo', {
      syncedAt: NOW - 30 * DAY,
      rev: '3mrevold0022',
      bytes: 2048,
    });
    await store.setMeta('followers', {
      syncedAt: NOW - 30 * DAY,
      count: 2,
      complete: true,
      profileCount: 5,
    });
  };
  out.push(
    ...(await each(
      'scenario',
      [{ $id: 'old-archive', did: D }],
      async ({ did }) => {
        resetAnalyticsStore();
        await forgetDidDocument(did);
        await oldShape();
        const seeded = await openAnalyticsStore(D);
        // What the store holds before the first step, for the Swift test
        // to hold too.
        const seed = {
          posts: await seeded.all('posts'),
          posts_meta: await seeded.getMeta('posts'),
          repo_meta: await seeded.getMeta('repo'),
          followers_meta: await seeded.getMeta('followers'),
        };
        const steps = await (async () => {
          const state = { did, hook: null };
          const outSteps = [];
          const diffRefused = (request, url) =>
            url.searchParams.get('since')
              ? json({ error: 'InvalidRequest', message: 'unknown rev' }, 400)
              : undefined;
          for (const s of [
            {
              name: 'mount-upgrades',
              now: NOW,
              answer: world(did, {
                car: carD,
                'com.atproto.sync.getRepo': diffRefused,
              }),
            },
            {
              name: 'rebuild-diff-refused',
              now: NOW + HOUR,
              answer: world(did, {
                car: carD,
                'com.atproto.sync.getRepo': diffRefused,
              }),
              act: (api) => api().runSync('incremental'),
            },
          ]) {
            const { name, ...rest } = s;
            outSteps.push({
              name,
              remount: false,
              now: rest.now,
              ...(await step(state, rest)),
            });
          }
          state.hook?.unmount();
          return outSteps;
        })();
        return {
          seed,
          steps,
        };
      },
    )),
  );

  return out;
}
