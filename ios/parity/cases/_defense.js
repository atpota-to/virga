// Realistic Defense data for the defense-early generators: the harness's
// crowd on Mira's posts (harness/crowd.js), read the way a scan reads it.
//
// For each post: the real harvest (src/defense/harvest.js, over the fake
// network), the profiles the signed-in getProfiles gives as Mira or Field
// Lab sees them (counts and all), the public relationships, and the canary
// the real findCanary picks from the archive's follows. The generators then
// run score.js, radar.js and plan.js over these, so the fixtures hold real
// crowds rather than made-up rows.
//
// Deterministic: the worlds are built at a fixed `now`, and the harvest's
// one clock read (harvestedAt) is overwritten.

import { createRouter } from '../../../harness/fakeNetwork.js';
import { createFakeAgent } from '../../../harness/fakeXrpc.js';
import { LAB, ME, buildWorld } from '../../../harness/world.js';
import { DEFENSE_SCOPE } from '../../../src/config.js';
import { harvestPost } from '../../../src/defense/harvest.js';
import {
  canaryCandidates,
  signedInProfiles,
} from '../../../src/defense/scan.js';
import {
  createScorer,
  findCanary,
  summarise,
  withoutSelves,
} from '../../../src/defense/score.js';
import { chunks } from '../../../src/defense/limit.js';
import { followFromRecord } from '../../../src/lib/analyticsSync.js';

/** The worlds' clock: 2026-11-12T12:00:00Z. */
export const NOW = Date.parse('2026-11-12T12:00:00.000Z');
export const HARVESTED_AT = '2026-11-12T12:00:00.000Z';
export const NO_WAIT = [0, 0];

let cached = null;

/** The worlds, the fake network and each account's signed-in getProfiles. */
export function harness() {
  if (cached) return cached;
  const mira = buildWorld({ now: NOW });
  const lab = buildWorld({ now: NOW, account: LAB });
  const worlds = [mira, lab];
  const route = createRouter(worlds, { now: () => NOW });
  const agentOf = (world) =>
    signedInProfiles(
      createFakeAgent(world, {
        worlds,
        scope: DEFENSE_SCOPE,
        sweepCounter: { next: () => 0 },
      }),
    );
  cached = {
    mira,
    lab,
    worlds,
    route,
    getProfilesAs: { [ME.did]: agentOf(mira), [LAB.did]: agentOf(lab) },
  };
  return cached;
}

/**
 * Runs `fn` with `Date.now()` fixed at `ms` (score.js reads it for each
 * account's age), and puts it back.
 */
export async function withNow(ms, fn) {
  const real = Date.now;
  Date.now = () => ms;
  try {
    return await fn();
  } finally {
    Date.now = real;
  }
}

/** Runs `fn` with the fake network answering `fetch`. */
async function withRouter(route, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const answer = await route(
      typeof input === 'string' ? input : input.url,
      init,
    );
    if (!answer) throw new TypeError(`no fixture for ${input}`);
    return answer;
  };
  try {
    return await fn();
  } finally {
    globalThis.fetch = real;
  }
}

/**
 * A profile as score.js reads it: what it reads, as the AppView gave it,
 * with the known followers' cards cut to their DIDs (only their number is
 * read, and only when the count is missing).
 */
export function trimProfile(p) {
  const v = p.viewer || {};
  const viewer = {};
  if (v.following) viewer.following = v.following;
  if (v.followedBy) viewer.followedBy = v.followedBy;
  if (v.blockedBy) viewer.blockedBy = v.blockedBy;
  if (v.knownFollowers)
    viewer.knownFollowers = {
      count: v.knownFollowers.count,
      followers: (v.knownFollowers.followers || []).map((f) => ({
        did: f.did,
      })),
    };
  const out = { did: p.did, handle: p.handle };
  for (const k of [
    'displayName',
    'avatar',
    'followersCount',
    'followsCount',
    'postsCount',
    'createdAt',
  ])
    if (p[k] !== undefined) out[k] = p[k];
  out.viewer = viewer;
  return out;
}

/** The archive a scan takes the canary's candidates from. */
function archiveOf(world) {
  return {
    following: world.follows.map(followFromRecord),
    followers: world.followers.map((f) => ({ did: f.did })),
    inbound: world.notifications.map((n) => ({ did: n.author.did })),
  };
}

/** Mira's posts with between `lo` and `hi` engagements, by count. */
export function postsBetween(lo, hi) {
  const { mira } = harness();
  return mira.posts
    .map((p) => ({
      rkey: p.rkey,
      n: p.likes + p.reposts + p.replies + p.quotes,
    }))
    .filter((p) => p.n >= lo && p.n <= hi)
    .sort((a, b) => a.n - b.n || (a.rkey < b.rkey ? -1 : 1));
}

/**
 * Everything a scan of one of Mira's posts reads, as `viewerDid` (Mira or
 * Field Lab) asks: the harvest, the people in it, their profiles and
 * relationships, and the canary.
 */
export async function crowdScan(rkey, viewerDid = ME.did) {
  const h = harness();
  const world = viewerDid === ME.did ? h.mira : h.lab;
  const uri = `at://${ME.did}/app.bsky.feed.post/${rkey}`;
  const harvest = await withRouter(h.route, () => harvestPost(uri));
  harvest.harvestedAt = HARVESTED_AT;
  const people = withoutSelves(harvest, [viewerDid, ME.did]);
  const getProfiles = h.getProfilesAs[viewerDid];
  const candidates = canaryCandidates(archiveOf(world), {
    ownerDid: viewerDid,
  });
  const canary = await findCanary({
    ownerDid: viewerDid,
    candidates,
    getProfiles,
    retryDelaysMs: NO_WAIT,
  });
  const dids = people.participants.map((p) => p.did);
  const profiles = {};
  const asked = canary ? [...dids, canary] : dids;
  for (const batch of chunks([...new Set(asked)], 25))
    for (const p of await getProfiles(batch)) profiles[p.did] = trimProfile(p);
  const relationships = {};
  for (const batch of chunks(dids, 30)) {
    const params = new URLSearchParams({ actor: viewerDid });
    for (const d of batch) params.append('others', d);
    const res = await h.route(
      `https://public.api.bsky.app/xrpc/app.bsky.graph.getRelationships?${params}`,
    );
    for (const r of (await res.json()).relationships) {
      const rest = { ...r };
      delete rest.$type;
      relationships[r.did] = rest;
    }
  }
  return {
    uri,
    ownerDid: viewerDid,
    harvest,
    people,
    dids,
    profiles,
    relationships,
    canary,
  };
}

/**
 * A getProfiles and a getRelationships that answer from fixed tables, as the
 * Swift tests replay them (VirgaDefenseTests/ScriptedAppView.swift):
 *
 * - `profiles`: did → profile. A batch gets the profiles of the DIDs it
 *   names that the table has, in the order asked.
 * - `uncounted`: first DID of a batch → how many of its asks come back with
 *   every knownFollowers left off (the AppView failing open).
 * - `profileErrors` / `relationshipErrors`: first DID of a batch →
 *   `{ status, times }`: that many of its asks throw an error with that
 *   HTTP status (`times` -1: every ask; `status` null: no answer at all).
 * - `relationships`: did → `{ following?, followedBy? }`.
 *
 * Every ask of getProfiles is recorded in `asked`.
 */
export function scripted({
  profiles = {},
  uncounted = {},
  profileErrors = {},
  relationships = {},
  relationshipErrors = {},
} = {}) {
  const seen = new Map();
  const asked = [];
  const relAsked = [];
  const nth = (kind, key) => {
    const k = `${kind}:${key}`;
    const n = seen.get(k) || 0;
    seen.set(k, n + 1);
    return n;
  };
  const fail = (rule, n) => {
    if (!rule || !(rule.times === -1 || n < rule.times)) return;
    const err = new Error(
      rule.status == null ? 'no answer' : `HTTP ${rule.status}`,
    );
    if (rule.status != null) err.status = rule.status;
    throw err;
  };
  return {
    asked,
    relAsked,
    getProfiles: async (dids) => {
      asked.push([...dids]);
      const n = nth('p', dids[0]);
      fail(profileErrors[dids[0]], n);
      const drop = n < (uncounted[dids[0]] || 0);
      return dids
        .filter((d) => Object.hasOwn(profiles, d))
        .map((d) => {
          const p = structuredClone(profiles[d]);
          if (drop && p.viewer) delete p.viewer.knownFollowers;
          return p;
        });
    },
    getRelationships: async (_owner, dids) => {
      relAsked.push([...dids]);
      const n = nth('r', dids[0]);
      fail(relationshipErrors[dids[0]], n);
      return dids.map((did) => ({ did, ...(relationships[did] || {}) }));
    },
  };
}

/** What a scorer threw, as a case records it. */
export function thrown(err) {
  return {
    $error: { name: err?.name, code: err?.code ?? null, message: err?.message },
  };
}

/**
 * The real scorer over a scripted AppView. `spec` is the case's input; the
 * result is `{ scores, vouchCheck }` and, when it succeeded, every batch
 * asked of getProfiles (sorted: batches run side by side) and how many were
 * asked of getRelationships.
 */
export async function scoreScripted(spec) {
  const fake = scripted(spec);
  const scorer = createScorer({
    ownerDid: spec.ownerDid,
    getProfiles: fake.getProfiles,
    getRelationships: fake.getRelationships,
    canary: spec.canary ?? null,
    refindCanary:
      spec.refind === undefined
        ? null
        : async () => {
            if (spec.refind === '$throws') throw new Error('gone');
            return spec.refind;
          },
    protectedSet: new Map(spec.protectedSet || []),
    selves: spec.selves || [],
    alreadyListed: new Set(spec.alreadyListed || []),
    blockers: new Set(spec.blockers || []),
    thresholds: spec.thresholds,
    retryDelaysMs: spec.retryDelaysMs || NO_WAIT,
    concurrency: spec.concurrency,
  });
  try {
    const out = await withNow(spec.now, () => scorer.score(spec.dids));
    const sortedBatches = (list) =>
      list
        .map((b) => JSON.stringify(b))
        .sort()
        .map((b) => JSON.parse(b));
    return {
      ...out,
      asked: spec.recordAsks === false ? undefined : sortedBatches(fake.asked),
      relationshipCalls: fake.relAsked.length,
    };
  } catch (err) {
    return thrown(err);
  }
}

/** The summary of a crowd scan, scored for real. */
export async function crowdSummary(scan) {
  const fake = scripted({
    profiles: scan.profiles,
    relationships: scan.relationships,
  });
  const scorer = createScorer({
    ownerDid: scan.ownerDid,
    getProfiles: fake.getProfiles,
    getRelationships: fake.getRelationships,
    canary: scan.canary,
    selves: [scan.ownerDid, ME.did],
    retryDelaysMs: NO_WAIT,
  });
  const { scores, vouchCheck } = await withNow(NOW, () =>
    scorer.score(scan.dids),
  );
  return {
    scores,
    vouchCheck,
    summary: summarise(scan.people, scores, { vouchCheck }),
  };
}

/** A participant of a made-up harvest, in the shape harvest.js gives. */
export function participant(did, kinds) {
  const engagements = {};
  const records = [];
  kinds.forEach((kind, i) => {
    engagements[kind] = (engagements[kind] || 0) + 1;
    records.push({
      kind,
      rkey: `3k${i}${did.slice(-6)}`,
      collection: 'app.bsky.feed.post',
    });
  });
  const order = ['quote', 'reply', 'threadReply', 'repost', 'like', 'gate'];
  const primary =
    order.find((k) => engagements[k]) ?? Object.keys(engagements)[0] ?? null;
  return { did, engagements, records, total: records.length, primary };
}

/** A made-up harvest of `participants`, its totals counted. */
export function harvestOf(
  uri,
  participants,
  { truncated = false, unread = [] } = {},
) {
  const engagements = {};
  for (const p of participants)
    for (const [k, n] of Object.entries(p.engagements))
      engagements[k] = (engagements[k] || 0) + n;
  return {
    uri,
    harvestedAt: HARVESTED_AT,
    sources: [],
    participants,
    totals: {
      participants: participants.length,
      engagements,
      records: participants.reduce((n, p) => n + p.total, 0),
    },
    truncated,
    unread,
  };
}

/**
 * A score in every field createScorer gives one, for made-up summaries:
 * `band` and `trust` as given, the rest from `over` or their defaults.
 */
export function scoreOf(did, band, trust, over = {}) {
  return {
    did,
    handle: `${did.slice(8)}.test`,
    displayName: null,
    avatar: null,
    missing: false,
    band,
    trust,
    alreadyListed: false,
    blocksYou: false,
    vouches: 0,
    followers: 0,
    follows: 0,
    posts: 0,
    ageDays: null,
    postsPerDay: null,
    mutual: false,
    followsYou: false,
    youFollow: false,
    protectedReason: band === 'PROTECTED' ? 'you follow them' : null,
    ...over,
  };
}

/** A small deterministic generator, for made-up crowds (mulberry32). */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A made-up summary of `n` people, run through the real summarise: bands
 * drawn by `mix` (band → weight), kinds from `kinds`, deterministic by seed.
 */
export function madeUpSummary(
  n,
  { seed = 1, mix, kinds, vouchCheck = 'canary' } = {},
) {
  const rand = seeded(seed);
  const bandMix = Object.entries(
    mix || {
      PROTECTED: 1,
      CONNECTED: 2,
      PERIPHERAL: 3,
      NOTABLE: 2,
      UNKNOWN: 30,
    },
  );
  const kindPool = kinds || [
    'quote',
    'reply',
    'threadReply',
    'repost',
    'like',
    'other',
  ];
  const weight = bandMix.reduce((s, [, w]) => s + w, 0);
  const pick = () => {
    let r = rand() * weight;
    for (const [band, w] of bandMix) {
      r -= w;
      if (r < 0) return band;
    }
    return bandMix.at(-1)[0];
  };
  const participants = [];
  const scores = new Map();
  for (let i = 0; i < n; i += 1) {
    const did = `did:plc:madeup${seed}x${String(i).padStart(5, '0')}`;
    const k = kindPool[Math.floor(rand() * kindPool.length)];
    const extra =
      rand() < 0.2 ? [kindPool[Math.floor(rand() * kindPool.length)]] : [];
    participants.push(participant(did, [k, ...extra]));
    // Some are never scored: no profile came back.
    if (rand() < 0.05) continue;
    const band = pick();
    const trust = band === 'PROTECTED' ? 100 : Math.floor(rand() * 99);
    scores.set(
      did,
      scoreOf(did, band, trust, {
        followers: Math.floor(rand() * 20000),
        youFollow: band === 'PROTECTED' && rand() < 0.8,
        followsYou: rand() < 0.1,
        alreadyListed: rand() < 0.05,
        blocksYou: rand() < 0.03,
      }),
    );
  }
  const harvest = harvestOf(
    `at://did:plc:madeupowner/app.bsky.feed.post/3m${seed}`,
    participants,
  );
  return summarise(harvest, scores, { vouchCheck });
}
