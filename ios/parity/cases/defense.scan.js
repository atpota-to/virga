// src/defense/scan.js: a scan of one post, from the link to the sorted
// crowd. Swift: VirgaDefense/Scan.swift.
//
// The pure pieces over adversarial input (readPostInput, canaryCandidates in
// several zones, scanErrorFrom), resolvePost over a scripted resolveHandle,
// signedInProfiles as recorded exchanges through a real Agent, and runScan
// two ways: over scripted reads (_defense.js `scripted`, which the Swift
// ScriptedAppView mirrors), the scan.test.js scenarios and more, recording
// every stage it reported; and once over the harness's network with the
// web's own reads (resolveHandle, harvestPost, publicRelationships, the
// curation lists), as recorded exchanges, only getProfiles scripted.

import { Agent } from '@atproto/api';
import {
  CANARY_CANDIDATES,
  CANARY_REQUIRED_AT,
  STAGES,
  ScanError,
  canaryCandidates,
  readPostInput,
  resolvePost,
  runScan,
  scanErrorFrom,
  signedInProfiles,
} from '../../../src/defense/scan.js';
import { harvestPost } from '../../../src/defense/harvest.js';
import { ScoreError } from '../../../src/defense/score.js';
import { followFromRecord } from '../../../src/lib/analyticsSync.js';
import { ME } from '../../../harness/world.js';
import { ZONES, each, value } from './_helpers.js';
import { inTurn, json, recordFetch } from './_fetch.js';
import {
  NO_WAIT,
  NOW,
  harness,
  postsBetween,
  scripted,
  trimProfile,
  withNow,
  withZone,
} from './_defense.js';

export const sources = ['src/defense/scan.js'];

const OWNER = 'did:plc:owner';
const AUTHOR = 'did:plc:author';
const CANARY = 'did:plc:canary';
const POST = `at://${AUTHOR}/app.bsky.feed.post/3abc`;

/** Runs `fn` with `new Date()` (no arguments) reading `ms`, as harvestedAt does. */
async function atFixedDate(ms, fn) {
  const RealDate = globalThis.Date;
  class FixedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(ms);
      else super(...args);
    }

    static now() {
      return ms;
    }
  }
  globalThis.Date = FixedDate;
  try {
    return await fn();
  } finally {
    globalThis.Date = RealDate;
  }
}

/** An error as a case describes it, made for real. */
function errorOf(spec) {
  if (!spec) return spec;
  if (spec.kind === 'ScoreError')
    return new ScoreError(spec.message, {
      code: spec.code,
      cause: errorOf(spec.cause),
    });
  if (spec.kind === 'ScanError')
    return new ScanError(spec.message, { code: spec.code });
  if (spec.kind === 'DOMException')
    return new DOMException(spec.message, spec.name);
  const err = new Error(spec.message);
  if (spec.name) err.name = spec.name;
  if (spec.status !== undefined) err.status = spec.status;
  if (spec.error !== undefined) err.error = spec.error;
  return err;
}

/** What a scan threw, as a case records it. */
function thrown(err) {
  return {
    $error: { name: err?.name, code: err?.code ?? null, message: err?.message },
  };
}

/**
 * A harvest of `dids` (with the owner and the author among them), each with
 * one like, as scan.test.js's fakeHarvest gives.
 */
function harvestOf(dids, { owner = OWNER, author = AUTHOR, uri = POST } = {}) {
  const participants = [...dids, owner, author].map((did, i) => ({
    did,
    engagements: { like: 1 },
    records: [
      { kind: 'like', rkey: `r${i}`, collection: 'app.bsky.feed.like' },
    ],
    total: 1,
    primary: 'like',
  }));
  return {
    uri,
    harvestedAt: '2026-11-17T00:00:00.000Z',
    sources: [],
    participants,
    totals: {
      participants: participants.length,
      engagements: { like: participants.length },
      records: participants.length,
    },
    truncated: false,
    unread: [],
  };
}

/** A profile as the AppView gives it to the owner: `known` people they follow follow it. */
function profile(did, { known = 0, followers = 10, createdAt } = {}) {
  return {
    did,
    handle: `${did.slice(8)}.test`,
    followersCount: followers,
    ...(createdAt ? { createdAt } : {}),
    viewer: known ? { knownFollowers: { count: known, followers: [] } } : {},
  };
}

/**
 * A runScan over scripted reads. `appview` is _defense.js's scripted spec;
 * `harvest` a harvest to hand back (with `harvestProgress` reported first);
 * `resolve` a handle → DID table; `curated` and `kept` did → reason.
 */
async function scanScripted(spec) {
  const fake = scripted(spec.appview || {});
  const stages = [];
  const getProfiles = spec.scopeError
    ? async () => {
        throw errorOf(spec.scopeError);
      }
    : fake.getProfiles;
  let result;
  try {
    result = await withNow(spec.now, () =>
      runScan({
        input: spec.input,
        ownerDid: spec.ownerDid,
        getProfiles,
        getRelationships: fake.getRelationships,
        candidates: spec.candidates,
        onStage: (s) => stages.push({ ...s }),
        resolveHandle: async (handle) => {
          if (spec.resolveThrows) throw new Error(spec.resolveThrows);
          return spec.resolve?.[handle] ?? null;
        },
        harvest: async (uri, { onProgress }) => {
          for (const p of spec.harvestProgress || []) onProgress?.(p);
          if (spec.harvestThrows !== undefined)
            throw new Error(spec.harvestThrows);
          return structuredClone({ ...spec.harvest, uri });
        },
        readCurated: async () => {
          if (spec.curatedThrows) throw new Error(spec.curatedThrows);
          return new Map(Object.entries(spec.curated || {}));
        },
        kept: spec.kept ? new Map(Object.entries(spec.kept)) : null,
        retryDelaysMs: spec.retryDelaysMs,
        now: () => spec.now,
      }),
    );
  } catch (err) {
    result = thrown(err);
  }
  const sortedBatches = (list) =>
    list
      .map((b) => JSON.stringify(b))
      .sort()
      .map((b) => JSON.parse(b));
  return {
    result,
    stages,
    asked: sortedBatches(fake.asked),
    relationshipCalls: fake.relAsked.length,
  };
}

const everyone = (dids, over = {}) =>
  Object.fromEntries(dids.map((d) => [d, profile(d, over[d])]));
const allUncounted = (dids) => Object.fromEntries(dids.map((d) => [d, 99]));

const BASE = {
  input: POST,
  ownerDid: OWNER,
  candidates: [CANARY],
  retryDelaysMs: NO_WAIT,
  now: Date.parse('2026-11-17T01:00:00Z'),
};

const scans = [
  {
    // scan.test.js: goes through each stage and sorts everyone but you and the author.
    $id: 'sorts-everyone-but-you',
    harvestDids: [
      'did:plc:close',
      'did:plc:near',
      'did:plc:friend',
      'did:plc:far',
    ],
    harvestProgress: [{ done: 1, total: 1 }],
    known: { 'did:plc:close': 5, 'did:plc:near': 1, [CANARY]: 4 },
    relationships: { 'did:plc:friend': { following: 'at://f' } },
    curated: { 'did:plc:near': 'on your list “Neighbours”' },
    kept: { 'did:plc:far': 'my sister' },
  },
  {
    // ...and scores nothing when the AppView leaves every count off after
    // the canary was found.
    $id: 'canary-found-then-uncounted',
    harvestDids: ['did:plc:close'],
    known: { [CANARY]: 4 },
    uncounted: { 'did:plc:close': 99 },
  },
  {
    $id: 'canary-found-then-uncounted-with-a-second-canary',
    harvestDids: ['did:plc:close'],
    candidates: [CANARY, 'did:plc:canary2'],
    known: { [CANARY]: 4, 'did:plc:canary2': 2, 'did:plc:close': 3 },
    uncounted: { 'did:plc:close': 3 },
  },
  {
    // ...looks for a canary a second time before scoring without one.
    $id: 'second-look',
    harvestDids: ['did:plc:far'],
    known: { [CANARY]: 4 },
    uncounted: { [CANARY]: 1 },
  },
  {
    // ...says when vouches couldn't be checked at all, and leans on who follows you.
    $id: 'vouches-unavailable',
    harvestDids: ['did:plc:fan', 'did:plc:far'],
    known: { [CANARY]: 4 },
    failOpen: true,
    relationships: { 'did:plc:fan': { followedBy: 'at://x' } },
  },
  {
    // ...stops rather than scoring without vouches when you follow plenty of people.
    $id: 'plenty-of-follows',
    harvestDids: ['did:plc:far'],
    candidates: Array.from(
      { length: CANARY_REQUIRED_AT },
      (_, i) => `did:plc:follow${i}`,
    ),
    failOpen: true,
  },
  {
    $id: 'one-short-of-plenty',
    harvestDids: ['did:plc:far'],
    candidates: Array.from(
      { length: CANARY_REQUIRED_AT - 1 },
      (_, i) => `did:plc:follow${i}`,
    ),
    failOpen: true,
  },
  {
    $id: 'no-candidates',
    harvestDids: ['did:plc:a', 'did:plc:b'],
    candidates: [],
  },
  // ...turns down a link that isn't a post before reading anything.
  { $id: 'not-a-link', input: 'https://example.com', harvestDids: [] },
  { $id: 'no-input', input: null, harvestDids: [] },
  {
    $id: 'handle',
    input: ' https://bsky.app/profile/Mira.Example.com/post/3abc?x=1 ',
    resolve: { 'mira.example.com': AUTHOR },
    harvestDids: ['did:plc:a'],
    known: { [CANARY]: 4 },
  },
  {
    $id: 'unknown-handle',
    input: 'https://bsky.app/profile/nobody.example.com/post/3abc',
    harvestDids: [],
  },
  {
    $id: 'resolve-throws',
    input: 'https://bsky.app/profile/nobody.example.com/post/3abc',
    resolveThrows: 'lookup down',
    harvestDids: [],
  },
  {
    $id: 'harvest-throws',
    harvestDids: [],
    harvestProgress: [{ done: 0, total: 2 }],
    harvestThrows:
      "Constellation didn't answer. It's the only complete record of who engaged with a post, so there's nothing to scan without it. Try again in a minute.",
  },
  { $id: 'harvest-throws-empty', harvestDids: [], harvestThrows: '' },
  {
    $id: 'curated-throws',
    harvestDids: ['did:plc:a'],
    curatedThrows: 'lists down',
  },
  {
    $id: 'missing-scope',
    harvestDids: ['did:plc:a'],
    scopeError: {
      message: 'Missing required scope "rpc:app.bsky.actor.getProfiles"',
      status: 403,
    },
  },
  {
    $id: 'scope-error-name',
    harvestDids: ['did:plc:a'],
    scopeError: {
      message: 'Bad token scope',
      status: 400,
      error: 'ScopeMissingError',
    },
  },
  {
    $id: 'profiles-unauthorised',
    harvestDids: ['did:plc:a'],
    scopeError: { message: 'nope', status: 401 },
  },
  {
    $id: 'relationships-fail',
    harvestDids: ['did:plc:a'],
    known: { [CANARY]: 4 },
    relationshipErrors: { 'did:plc:a': { status: 400, times: -1 } },
  },
  {
    $id: 'relationships-retried',
    harvestDids: ['did:plc:a'],
    known: { [CANARY]: 4 },
    relationshipErrors: { 'did:plc:a': { status: 503, times: 2 } },
  },
  {
    $id: 'profiles-retried-past-the-delays',
    harvestDids: ['did:plc:a'],
    known: { [CANARY]: 4 },
    profileErrors: { 'did:plc:a': { status: 429, times: 3 } },
  },
  {
    $id: 'retry-delays-empty',
    harvestDids: ['did:plc:a'],
    known: { [CANARY]: 4 },
    retryDelaysMs: [],
  },
  {
    $id: 'retry-delays-empty-and-failing',
    harvestDids: ['did:plc:a'],
    known: { [CANARY]: 4 },
    retryDelaysMs: [],
    profileErrors: { 'did:plc:a': { status: 500, times: 1 } },
  },
  { $id: 'empty-harvest', harvestDids: [], known: { [CANARY]: 4 } },
  {
    $id: 'kept-over-curated',
    harvestDids: ['did:plc:both', 'did:plc:curated'],
    known: { [CANARY]: 4 },
    curated: {
      'did:plc:both': 'on your list “A”',
      'did:plc:curated': 'on your list “B”',
    },
    kept: { 'did:plc:both': 'my neighbour' },
  },
  {
    $id: 'owner-and-canary-among-the-crowd',
    harvestDids: [CANARY, 'did:plc:x', 'did:plc:x'],
    candidates: [OWNER, CANARY, CANARY],
    known: { [CANARY]: 4, 'did:plc:x': 2 },
  },
  {
    $id: 'no-owner',
    ownerDid: '',
    harvestDids: ['did:plc:a'],
    known: { [CANARY]: 4 },
  },
  {
    $id: 'bands-and-ages',
    harvestDids: ['did:plc:big', 'did:plc:busy', 'did:plc:new', 'did:plc:one'],
    known: { [CANARY]: 4, 'did:plc:one': 1 },
    over: {
      'did:plc:big': {
        followers: 50_000,
        createdAt: '2020-01-01T00:00:00.000Z',
      },
      'did:plc:busy': { followers: 3000, createdAt: '2026-11-16T00:00:00Z' },
      'did:plc:new': { followers: 2, createdAt: '2026-11-15' },
    },
  },
];

function scanInput(c) {
  const ownerDid = c.ownerDid ?? BASE.ownerDid;
  const candidates = c.candidates ?? BASE.candidates;
  const dids = [
    ...new Set([...(c.harvestDids || []), ...candidates, OWNER, AUTHOR]),
  ];
  const over = Object.fromEntries(
    dids.map((d) => [d, { known: c.known?.[d] || 0, ...(c.over?.[d] || {}) }]),
  );
  return {
    ...BASE,
    $id: c.$id,
    ...(c.input !== undefined ? { input: c.input } : {}),
    ownerDid,
    candidates,
    ...(c.retryDelaysMs ? { retryDelaysMs: c.retryDelaysMs } : {}),
    appview: {
      profiles: everyone(dids, over),
      uncounted: c.failOpen ? allUncounted(dids) : c.uncounted || {},
      profileErrors: c.profileErrors || {},
      relationships: c.relationships || {},
      relationshipErrors: c.relationshipErrors || {},
    },
    harvest: harvestOf(c.harvestDids || [], { owner: ownerDid || OWNER }),
    ...(c.harvestProgress ? { harvestProgress: c.harvestProgress } : {}),
    ...(c.harvestThrows !== undefined
      ? { harvestThrows: c.harvestThrows }
      : {}),
    ...(c.resolve ? { resolve: c.resolve } : {}),
    ...(c.resolveThrows ? { resolveThrows: c.resolveThrows } : {}),
    ...(c.curated ? { curated: c.curated } : {}),
    ...(c.curatedThrows ? { curatedThrows: c.curatedThrows } : {}),
    ...(c.kept ? { kept: c.kept } : {}),
    ...(c.scopeError ? { scopeError: c.scopeError } : {}),
  };
}

/** The archive a scan takes the canary's candidates from (as _defense.js reads it). */
function archiveOf(world) {
  return {
    following: world.follows.map(followFromRecord),
    followers: world.followers.map((f) => ({ did: f.did })),
    inbound: world.notifications.map((n) => ({ did: n.author.did })),
  };
}

/**
 * A scan of one of Mira's posts, pasted as its bsky.app link, with the web's
 * own reads over the harness network: recorded exchanges. getProfiles is
 * the harness's signed-in read, as a table.
 */
async function networkScan(rkey) {
  const h = harness();
  const ownerDid = ME.did;
  const input = `https://bsky.app/profile/${ME.handle}/post/${rkey}`;
  const candidates = canaryCandidates(archiveOf(h.mira), { ownerDid }).slice(
    0,
    50,
  );
  // Everything the scan will ask the AppView about, read first.
  const real = globalThis.fetch;
  const table = new Map();
  globalThis.fetch = async (url, init) => {
    const href = typeof url === 'string' ? url : url.url;
    const answer = await h.route(href, init);
    const text = await answer.clone().text();
    table.set(href, { status: answer.status, json: JSON.parse(text) });
    return answer;
  };
  let dids;
  try {
    const harvest = await harvestPost(
      `at://${ownerDid}/app.bsky.feed.post/${rkey}`,
    );
    dids = harvest.participants.map((p) => p.did);
  } finally {
    globalThis.fetch = real;
  }
  const profiles = {};
  for (const did of [...new Set([...dids, ...candidates])]) {
    for (const p of await h.getProfilesAs[ownerDid]([did]))
      profiles[p.did] = trimProfile(p);
  }
  const fakeAppview = { profiles };
  const run = (stages, fake) =>
    atFixedDate(NOW, () =>
      withNow(NOW, () =>
        runScan({
          input,
          ownerDid,
          getProfiles: fake.getProfiles,
          candidates,
          onStage: (s) => stages.push({ ...s }),
          retryDelaysMs: NO_WAIT,
          now: () => NOW,
        }),
      ),
    );
  // A first run through the router, so the table holds every answer.
  globalThis.fetch = async (url, init) => {
    const href = typeof url === 'string' ? url : url.url;
    const answer = await h.route(href, init);
    const text = await answer.clone().text();
    table.set(href, { status: answer.status, json: JSON.parse(text) });
    return answer;
  };
  try {
    await run([], scripted(fakeAppview));
  } finally {
    globalThis.fetch = real;
  }
  const stages = [];
  const fake = scripted(fakeAppview);
  const out = await recordFetch(
    (request) =>
      table.get(request.url) ?? { status: 404, json: { error: 'NotFound' } },
    async () => {
      try {
        return { result: await run(stages, fake), stages };
      } catch (err) {
        return { result: thrown(err), stages };
      }
    },
    { now: NOW },
  );
  return {
    id: `network-${rkey}`,
    fn: 'runScanOverTheNetwork',
    input: { input, ownerDid, candidates, appview: fakeAppview, now: NOW },
    output: out,
  };
}

export default async function cases() {
  const network = [];
  const posts = postsBetween(20, 60);
  if (posts[0]) network.push(await networkScan(posts[0].rkey));

  return [
    value('constants', { STAGES, CANARY_CANDIDATES, CANARY_REQUIRED_AT }),

    ...(await each(
      'readPostInput',
      [
        'https://bsky.app/profile/mira.example.com/post/3abc',
        ' https://bsky.app/profile/did:plc:abc/post/3abc?x=1 ',
        'at://did:plc:abc/app.bsky.feed.post/3abc',
        'https://aturi.to/did:plc:abc/app.bsky.feed.post/3abc',
        '',
        '   ',
        'hello',
        'https://bsky.app/profile/mira.example.com',
        'https://bsky.app/profile/mira.example.com/lists/3abc',
        'at://did:plc:abc/app.bsky.feed.like/3abc',
        'https://staging.bsky.app/profile/a/post/b',
        null,
        42,
        'HTTPS://WWW.BSKY.APP/PROFILE/Mira.Example.COM/POST/3ABC',
        'http://bsky.app/profile/@mira.example.com/post/3abc',
        'https://bsky.app/profile/did%3Aplc%3Aabc/post/3abc',
        'https://bsky.app/profile/mira.example.com/post/',
        'https://bsky.app/profile/mira.example.com/post/3abc/',
        'https://bsky.app/profile/mira.example.com/post/3abc#frag',
        ' ﻿at://did:plc:abc/app.bsky.feed.post/3abc ',
        'at://did:plc:abc/app.bsky.feed.post/3abc/',
        'at://mira.example.com/app.bsky.feed.post/3abc',
        'at://did:plc:abc/app.bsky.feed.post/',
        'https://aturi.to/mira.example.com/app.bsky.feed.post/3abc',
        'https://aturi.to/did:plc:abc/app.bsky.feed.generator/3abc',
        'https://bsky.app/profile/m%C3%AFra.example.com/post/3%20abc',
        'https://bsky.app/profile/%E0%A4%A/post/3abc',
        'https://bsky.app/profile/did:/post/3abc',
        'https://bsky.app/starter-pack/mira.example.com/3abc',
        'https://bsky.app/profile/mira.example.com/post/3abc https://bsky.app/profile/other/post/x',
      ].map((input) => ({ input })),
      ({ input }) => readPostInput(input),
    )),

    ...(await each(
      'resolvePost',
      [
        {
          input: 'https://bsky.app/profile/mira.example.com/post/3abc',
          handles: { 'mira.example.com': 'did:plc:mira' },
        },
        {
          input: 'https://bsky.app/profile/nobody.example.com/post/3abc',
          handles: { 'mira.example.com': 'did:plc:mira' },
        },
        { input: 'not a link', handles: {} },
        { input: 'at://did:plc:abc/app.bsky.feed.post/3abc', handles: {} },
        {
          input: 'https://bsky.app/profile/mira.example.com/post/3abc',
          handles: { 'mira.example.com': '' },
        },
        {
          input: 'https://bsky.app/profile/mira.example.com/post/3abc',
          throws: 'lookup down',
        },
        {
          input: 'https://bsky.app/profile/@Mira.example.com/post/3%2Fabc',
          handles: { 'mira.example.com': 'did:web:mira.example.com' },
        },
      ],
      async ({ input, handles, throws }) => {
        const asked = [];
        try {
          const post = await resolvePost(input, {
            resolveHandle: async (handle) => {
              asked.push(handle);
              if (throws) throw new Error(throws);
              return handles[handle] ?? null;
            },
          });
          return { post, asked };
        } catch (err) {
          return { ...thrown(err), asked };
        }
      },
    )),

    ...(await each(
      'canaryCandidates',
      [
        // scan.test.js: the people who follow you back first, those who
        // talk to you most leading.
        {
          $id: 'follow-back-first',
          archive: {
            following: [
              { did: 'did:plc:old', followedAt: '2020-01-01T00:00:00Z' },
              { did: 'did:plc:new', followedAt: '2026-01-01T00:00:00Z' },
              {
                did: 'did:plc:mutual-quiet',
                followedAt: '2025-01-01T00:00:00Z',
              },
              {
                did: 'did:plc:mutual-chatty',
                followedAt: '2021-01-01T00:00:00Z',
              },
              {
                did: 'did:plc:mutual-quiet',
                followedAt: '2025-01-01T00:00:00Z',
              },
              { did: OWNER },
            ],
            followers: [
              { did: 'did:plc:mutual-quiet' },
              { did: 'did:plc:mutual-chatty' },
              { did: 'did:plc:stranger' },
            ],
            inbound: [
              { did: 'did:plc:mutual-chatty' },
              { did: 'did:plc:mutual-chatty' },
              { did: 'did:plc:old' },
              { did: 'did:plc:stranger' },
            ],
          },
          ownerDid: OWNER,
        },
        {
          $id: 'not-too-many',
          archive: {
            following: Array.from(
              { length: CANARY_CANDIDATES + 40 },
              (_, i) => ({ did: `did:plc:f${i}` }),
            ),
          },
        },
        {
          $id: 'only-follows',
          archive: {
            followers: [{ did: 'did:plc:a' }],
            inbound: [{ did: 'did:plc:a' }],
          },
        },
        { $id: 'nothing' },
        { $id: 'empty-archive', archive: {} },
        {
          $id: 'ties-by-did',
          archive: {
            following: [
              { did: 'did:plc:b' },
              { did: 'did:plc:B' },
              { did: 'did:plc:a' },
              { did: 'did:plc:é' },
              { did: 'did:plc:é' },
              { did: 'did:plc:😀' },
              { did: 'did:plc:￿' },
            ],
          },
        },
        {
          $id: 'odd-entries',
          archive: {
            following: [
              null,
              {},
              { did: '' },
              { did: 'did:plc:a', followedAt: 'not a date' },
              { did: 'did:plc:b', followedAt: '' },
              { did: 'did:plc:c', followedAt: '1970-01-01T00:00:00Z' },
              { did: 'did:plc:d', followedAt: '1969-12-31T23:59:59Z' },
            ],
            followers: [{}, { did: 'did:plc:c' }],
            inbound: [null, {}, { did: '' }, { did: 'did:plc:d' }],
          },
        },
        {
          $id: 'limits',
          archive: {
            following: [
              { did: 'did:plc:a' },
              { did: 'did:plc:b' },
              { did: 'did:plc:c' },
            ],
          },
          limit: 2,
        },
        {
          $id: 'limit-zero',
          archive: { following: [{ did: 'did:plc:a' }] },
          limit: 0,
        },
        {
          $id: 'limit-negative',
          archive: {
            following: [
              { did: 'did:plc:a' },
              { did: 'did:plc:b' },
              { did: 'did:plc:c' },
            ],
          },
          limit: -1,
        },
        {
          $id: 'owner-look-alike',
          archive: { following: [{ did: 'did:plc:K' }, { did: 'did:plc:K' }] },
          ownerDid: 'did:plc:K',
        },
        // A followedAt without an offset is local time.
        ...ZONES.map((zone) => ({
          $id: `local-times-${zone}`,
          zone,
          archive: {
            following: [
              { did: 'did:plc:utc', followedAt: '2026-03-08T10:00:00Z' },
              { did: 'did:plc:local', followedAt: '2026-03-08T10:00:00' },
              { did: 'did:plc:date', followedAt: '2026-03-08' },
              { did: 'did:plc:legacy', followedAt: 'Sun Mar 08 2026 06:00:00' },
              {
                did: 'did:plc:offset',
                followedAt: '2026-03-08T05:00:00-05:00',
              },
            ],
          },
        })),
      ],
      ({ archive, ownerDid, limit, zone }) =>
        withZone(zone, () =>
          canaryCandidates(archive, {
            ...(ownerDid ? { ownerDid } : {}),
            ...(limit !== undefined ? { limit } : {}),
          }),
        ),
    )),

    ...(await each(
      'signedInProfiles',
      [
        {
          $id: 'profiles',
          dids: ['did:plc:a', 'did:plc:b'],
          answers: [
            json({
              profiles: [
                { did: 'did:plc:a', handle: 'a.test' },
                { did: 'did:plc:b', handle: 'b.test' },
              ],
            }),
          ],
        },
        // An answer without a list never reaches signedInProfiles' own
        // fallback here: the SDK's lexicon check refuses it first
        // (InvalidResponse), which VirgaNetwork's Agent doesn't port, so
        // the Swift read gives the fallback's []. A behaviour test holds it.
        { $id: 'one', dids: ['did:plc:é'], answers: [json({ profiles: [] })] },
        {
          $id: 'refused',
          dids: ['did:plc:a'],
          answers: [
            {
              status: 403,
              json: {
                error: 'ScopeMissingError',
                message:
                  'Missing required scope "rpc:app.bsky.actor.getProfiles"',
              },
            },
          ],
        },
        {
          $id: 'down',
          dids: ['did:plc:a'],
          answers: [
            {
              status: 502,
              json: { error: 'UpstreamFailure', message: 'down' },
            },
          ],
        },
      ],
      ({ dids, answers }) =>
        recordFetch(inTurn(...answers), async () => {
          try {
            return await signedInProfiles(new Agent('https://pds.example.com'))(
              dids,
              { signal: new AbortController().signal },
            );
          } catch (e) {
            return {
              $error: { status: e.status, error: e.error, message: e.message },
            };
          }
        }),
    )),

    ...(await each(
      'scanErrorFrom',
      [
        {
          $id: 'scope-in-cause',
          error: {
            kind: 'ScoreError',
            message: 'x',
            code: 'read',
            cause: {
              message:
                'Missing required scope "rpc:app.bsky.actor.getProfiles"',
              status: 403,
            },
          },
        },
        {
          $id: 'scope',
          error: {
            message: 'Missing required scope "rpc:app.bsky.actor.getProfiles"',
            status: 403,
          },
        },
        {
          $id: 'scope-by-name',
          error: { message: 'no', error: 'ScopeMissingError' },
        },
        {
          $id: 'insufficient-scope',
          error: { message: 'Insufficient scope for this call' },
        },
        { $id: 'insufficient_scope', error: { message: 'insufficient_scope' } },
        {
          $id: 'vouches',
          error: { kind: 'ScoreError', message: 'no counts', code: 'vouches' },
        },
        {
          $id: 'read',
          error: { kind: 'ScoreError', message: 'down', code: 'read' },
        },
        {
          $id: 'read-with-a-cause',
          error: {
            kind: 'ScoreError',
            message: 'down',
            code: 'read',
            cause: { message: 'HTTP 502', status: 502 },
          },
        },
        { $id: 'stopped', error: { message: 'anything' }, aborted: true },
        {
          $id: 'stopped-scan-error',
          error: { kind: 'ScanError', message: 'x', code: 'link' },
          aborted: true,
        },
        {
          $id: 'abort-error',
          error: {
            kind: 'DOMException',
            message: 'Aborted',
            name: 'AbortError',
          },
        },
        {
          $id: 'abort-error-named',
          error: { message: 'gone', name: 'AbortError' },
        },
        { $id: 'harvest', error: { message: 'Constellation didn’t answer' } },
        { $id: 'no-message', error: { message: '' } },
        {
          $id: 'own',
          error: { kind: 'ScanError', message: 'x', code: 'link' },
        },
        {
          $id: 'own-permission',
          error: {
            kind: 'ScanError',
            message: 'Missing required scope',
            code: 'author',
          },
        },
        {
          $id: 'timeout-name',
          error: {
            message: 'The operation was aborted due to timeout',
            name: 'TimeoutError',
          },
        },
      ],
      ({ error, aborted }) => {
        const err = errorOf(error);
        const controller = new AbortController();
        if (aborted) controller.abort();
        const out = scanErrorFrom(err, controller.signal);
        return {
          name: out.name,
          code: out.code,
          message: out.message,
          same: out === err,
          cause: out.cause?.message ?? null,
        };
      },
    )),

    ...(await each('runScan', scans.map(scanInput), scanScripted)),
    ...network,
  ];
}
