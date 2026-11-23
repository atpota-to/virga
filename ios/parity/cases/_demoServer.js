// Shared by the demo-server generators (demo-server.fakeServer.js and
// demo-server.fakeDefense.js): Virga's server in the harness
// (harness/fakeServer.js, with the Defense routes it mounts from
// harness/fakeDefense.js), run through createServerRouter over the
// harness's worlds, on a clock that moves only when a step says so, with
// the workers (runCron) run between requests, each answer kept (status,
// type, body) and at the end the server's tables, its log and what the
// workers wrote into each world.
//
// The randomness is made repeatable on both sides: the tokens' bytes
// (_demoNetwork.js's repeatableRandom), crypto.randomUUID (a count),
// Math.random (a fixed sequence), and the clock id of Defense's record keys
// (src/posting/lib/tid.js picks one with Math.random when it loads, so the
// server is imported afresh with Math.random at 0, and performance.now is
// held at 0 for the keys' sub-millisecond digits). A scenario can run in a
// zone (`zone`), for the seeded rows' local hours and times written without
// an offset.
//
// A request step is recorded resolved (method, path, the index of the token
// it carries, its text), so the Swift test sends exactly what was sent here.
// Swift: ios/VirgaKit/Tests/VirgaDemoTests/DemoServerParityTests.swift.

import { vi } from 'vitest';
import { LAB, ME } from '../../../harness/world.js';
import { emptyComposerState } from '../../../src/posting/lib/composerModel.js';
import { serializeForSchedule } from '../../../src/posting/schedule/scheduleSerialize.js';
import { NOW, worldDigest } from './_demoWorld.js';
import {
  answerOf,
  shrink,
  withRepeatableRandom,
  worldsFor,
} from './_demoNetwork.js';
import { toJSON, withTimeZone } from './_helpers.js';

export const sources = ['harness/fakeServer.js', 'harness/fakeDefense.js'];

export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;
export const GATE = 'app.bsky.feed.threadgate';
export const POST = 'app.bsky.feed.post';
const json = { 'content-type': 'application/json' };

/** crypto.randomUUID, counted: Swift's DemoServerParity.uuids. */
const uuidOf = (n) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
/** Math.random, a fixed sequence: Swift's DemoServerParity.randoms. */
const randomOf = (k) => ((k * 37 + 11) % 64) / 64;

/** The server's module, loaded afresh with Math.random at 0. */
export async function freshModules() {
  vi.resetModules();
  const random = Math.random;
  Math.random = () => 0;
  try {
    const server = await import('../../../harness/fakeServer.js');
    const repo = await import('../../../harness/repo.js');
    return { ...server, repo };
  } finally {
    Math.random = random;
  }
}

/* ---- what the steps send ---------------------------------------------- */

export const iso = (ms) => new Date(ms).toISOString();
export const later = (ms) => iso(Date.now() + ms);
export const text = (s) => ({ record: { text: s, langs: ['en'] } });

/** A body to /api/schedule/create, by hand. */
export const create = (posts, { at = HOUR, ...payload } = {}, extra = {}) => ({
  scheduledFor: typeof at === 'number' ? later(at) : at,
  target: 'bluesky',
  queued: false,
  ...extra,
  payload: {
    posts: posts.map((p) => (typeof p === 'string' ? text(p) : p)),
    gates: { threadgate: null, postgate: null },
    tz: 'UTC',
    selfDestruct: null,
    ...payload,
  },
});

/** A body the composer's own serializer builds (fakeServer.test.js's scheduleBody). */
export async function composed(
  texts,
  { at, extra = {}, tz = 'UTC', queued = false } = {},
) {
  const state = emptyComposerState({
    asDid: ME.did,
    defaults: { langs: ['en'] },
  });
  const full = {
    ...state,
    posts: texts.map((t, i) => ({ ...state.posts[0], id: `p${i}`, text: t })),
    ...extra,
  };
  return serializeForSchedule(full, {
    now: new Date(),
    scheduledFor: iso(at),
    queued,
    tz,
    resolveMention: async () => null,
  });
}

/** A body to /api/self-destruct/create. */
export const arm = (uri, extra = {}) => ({
  postUri: uri,
  postedAt: iso(Date.now()),
  lifespanSeconds: 3600,
  conditions: {},
  effects: [{ action: 'delete' }],
  ...extra,
});

export const postUri = (did, rkey) => `at://${did}/${POST}/${rkey}`;
export const get = (path, o = {}) => ({ method: 'GET', path, ...o });
export const post = (path, body, o = {}) => ({
  method: 'POST',
  path,
  body,
  ...o,
});

/* ---- running a scenario ------------------------------------------------ */

function worldState(w, repo) {
  const written = w.posts.filter((p) => p.record);
  return {
    revision: w.revision,
    posts: w.posts.length,
    writtenPosts: shrink(
      written.map((p) => ({ rkey: p.rkey, cid: p.cid, record: p.record })),
    ),
    written: shrink([...w.written]),
    removed: [...w.removed],
    blobs: shrink(
      [...w.blobs].map(([cid, b]) => [
        cid,
        { mimeType: b.mimeType, size: b.size },
      ]),
    ),
    listItems: repo.listCollection(w, 'app.bsky.graph.listitem').length,
  };
}

async function run(mods, { search = '', options = {}, steps, digest = false }) {
  const { createServer, createServerRouter, SERVER_ORIGIN, repo } = mods;
  const worlds = worldsFor(search, NOW);
  const [mira, lab] = [
    worlds.find((w) => w.me.did === ME.did),
    worlds.find((w) => w.me.did === LAB.did),
  ];
  return withRepeatableRandom(async () => {
    const realUuid = globalThis.crypto.randomUUID;
    const realRandom = Math.random;
    const realPerf = performance.now;
    let uuids = 0;
    let randoms = 0;
    globalThis.crypto.randomUUID = () => uuidOf(++uuids);
    Math.random = () => randomOf(randoms++);
    performance.now = () => 0;
    vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
    try {
      const server = createServer({ worlds, aiDelayMs: 0, ...options });
      const route = createServerRouter(server);
      const tokens = [];
      const named = {};
      const ctx = { mira, lab, worlds, server, named, repo, tokens };
      const resolved = [];
      const out = [];
      for (const s of steps) {
        const step = typeof s === 'function' ? await s(ctx) : s;
        if (step.mint) {
          tokens.push(server.mintToken(step.mint));
          resolved.push({ mint: step.mint });
          out.push({ token: tokens.at(-1) });
        } else if (step.advance) {
          vi.setSystemTime(Date.now() + step.advance);
          resolved.push({ advance: step.advance });
          out.push(null);
        } else if (step.cron || step.schedule || step.timers || step.defense) {
          const which = step.cron
            ? 'cron'
            : step.schedule
              ? 'schedule'
              : step.timers
                ? 'timers'
                : 'defense';
          let ran;
          if (which === 'cron') ran = await server.runCron();
          else if (which === 'schedule')
            ran = { published: await server.runSchedule() };
          else if (which === 'timers')
            ran = { settled: await server.runTimers() };
          else ran = { listed: await server.runDefense() };
          resolved.push({ [which]: true });
          out.push({
            published: ran.published?.map((r) => [
              r.id,
              r.status,
              r.last_error_code ?? null,
            ]),
            settled: ran.settled?.map((t) => [
              t.id,
              t.status,
              t.resolution ?? null,
            ]),
            listed: ran.listed,
          });
        } else if (step.refuse || step.expire) {
          if (step.refuse) server.refuseGrant(step.refuse);
          else server.expireAccount(step.expire);
          resolved.push(
            step.refuse ? { refuse: step.refuse } : { expire: step.expire },
          );
          out.push(null);
        } else if (step.signOut !== undefined) {
          const result = server.signOutToken(tokens[step.signOut]);
          resolved.push({ signOut: step.signOut });
          out.push(result);
        } else if (step.write) {
          const w = worlds.find((x) => x.me.did === step.write.did);
          const result = await repo.writeRecord(w, step.write);
          resolved.push({ write: step.write });
          out.push(result);
        } else if (step.remove) {
          const w = worlds.find((x) => x.me.did === step.remove.did);
          const result = repo.removeRecord(
            w,
            step.remove.collection,
            step.remove.rkey,
          );
          resolved.push({ remove: step.remove });
          out.push(result);
        } else if (step.setScope) {
          worlds.find((x) => x.me.did === step.setScope.did).scope =
            step.setScope.scope;
          resolved.push({ setScope: step.setScope });
          out.push(null);
        } else if (step.timerStatus) {
          const row = server
            .inspect()
            .timers.find((t) => t.id === step.timerStatus.id);
          row.status = step.timerStatus.status;
          resolved.push({ timerStatus: step.timerStatus });
          out.push(null);
        } else if (step.fillTimers) {
          // As fakeServer.test.js fills the account's timers to the cap.
          const { timers } = server.inspect();
          const live = timers.find(
            (t) => t.user_did === ME.did && t.status === 'armed',
          );
          const count = timers.filter(
            (t) =>
              t.user_did === ME.did && ['armed', 'checking'].includes(t.status),
          ).length;
          for (let i = count; i < step.fillTimers; i++)
            timers.push({
              ...live,
              id: `filler-${i}`,
              post_uri: `${live.post_uri}-filler-${i}`,
            });
          resolved.push({ fillTimers: step.fillTimers, from: live.id });
          out.push(count);
        } else {
          const body =
            typeof step.body === 'function' ? await step.body(ctx) : step.body;
          const textBody =
            step.text ??
            (body === undefined ? undefined : JSON.stringify(body));
          const token = step.token === undefined ? 0 : step.token;
          const headers = {
            ...(textBody !== undefined ? json : {}),
            ...(step.headers || {}),
          };
          if (token !== null) headers.authorization = `Bearer ${tokens[token]}`;
          const init = { method: step.method, headers };
          if (textBody !== undefined) init.body = textBody;
          const res = await route(
            new URL(`${SERVER_ORIGIN}${step.path}`),
            init,
          );
          const answer = await answerOf(res);
          if (step.as) named[step.as] = answer.json;
          const recorded = { method: step.method, path: step.path, token };
          if (step.headers) recorded.headers = step.headers;
          if (textBody !== undefined) recorded.text = textBody;
          resolved.push(recorded);
          out.push(
            step.quiet
              ? { status: answer.status, code: answer.json?.code ?? null }
              : answer,
          );
        }
      }
      const held = server.inspect();
      const end = {
        scheduled: shrink(held.scheduled),
        timers: shrink(held.timers),
        defense: shrink(held.defense),
        log: shrink(held.log),
        worlds: worlds.map((w) =>
          digest ? worldDigest(w) : worldState(w, repo),
        ),
      };
      return { resolved, out, end };
    } finally {
      vi.useRealTimers();
      globalThis.crypto.randomUUID = realUuid;
      Math.random = realRandom;
      performance.now = realPerf;
    }
  });
}

/* ---- the scenarios ----------------------------------------------------- */

export const MIRA = ME.did;

/** The account's own first posts with no gate of their own yet, as the scenario first saw them. */
export const rootsOf = (ctx) => {
  ctx.named.roots ??= ctx.mira.posts.filter(
    (p) => !p.replyTo && !ctx.repo.readRecord(ctx.mira, GATE, p.rkey),
  );
  return ctx.named.roots;
};

/** The cases of a list of scenarios, each run in its zone. */
export async function scenarioCases(scenarios) {
  const mods = await freshModules();
  const out = [];
  for (const scenario of scenarios) {
    const zone = scenario.zone ?? 'UTC';
    const {
      resolved,
      out: steps,
      end,
    } = await withTimeZone(zone, () => run(mods, scenario));
    out.push({
      id: scenario.name,
      fn: 'server',
      input: toJSON({
        search: scenario.search ?? '',
        zone,
        options: scenario.options ?? {},
        steps: resolved,
      }),
      output: toJSON({ steps, end }),
    });
  }
  return out;
}
