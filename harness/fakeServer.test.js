// The fake server answers the real posting services (scheduleService,
// timerService, scheduleSerialize) through the real requester, so these check
// it in their terms: the shapes they read, one client (every row is Virga's,
// and an account sees only its own), the flat limits, the sign-in paths under
// /api/oauth, and the workers writing into the account's world.

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AI_LIMITS,
  MAX_ANALYZE_TEXT,
  MAX_LIVE_TIMERS,
  MAX_PENDING_SCHEDULED,
  SERVER_ORIGIN,
  analyzePost,
  createServer,
  createServerRouter,
  narrowAllow,
} from './fakeServer.js';
import { createRouter } from './fakeNetwork.js';
import { readFlags } from './harness.js';
import { listCollection, readRecord, writeRecord } from './repo.js';
import { narrowAllow as serverNarrowAllow } from '../server/timers/selfDestruct.js';
import { MAX_TEXT_LENGTH } from '../server/ai/handlers/analyzePost.js';
import { LAB, ME, buildWorld } from './world.js';
import {
  BACKEND_PATHS,
  backendSignOut,
  checkBackendSession,
  createBackendRequester,
} from '../src/session/backendClient.js';
import { interpretLiteSessionResponse } from '../src/session/sessionHealth.js';
import {
  cancelScheduled,
  createScheduled,
  getLimits,
  getScheduled,
  getScheduledMedia,
  listScheduled,
  reorderScheduled,
  retryScheduled,
  updateScheduled,
} from '../src/posting/schedule/scheduleService.js';
import { serializeForSchedule } from '../src/posting/schedule/scheduleSerialize.js';
import { cancelTimer, listTimers } from '../src/posting/timers/timerService.js';
import { emptyComposerState } from '../src/posting/lib/composerModel.js';

const NOW = Date.parse('2026-11-12T12:00:00.000Z');
const HOUR = 3_600_000;

function setup({ limits, aiLimits, seed = true } = {}) {
  let clock = NOW;
  const mira = buildWorld({ now: NOW });
  const lab = buildWorld({ now: NOW, account: LAB });
  const worlds = [mira, lab];
  for (const w of worlds) w.scope = 'atproto';
  const server = createServer({
    worlds,
    limits,
    aiLimits,
    seed,
    aiDelayMs: 0,
    now: () => clock,
  });
  const route = createServerRouter(server);
  const fetch = (href, init) => route(new URL(href), init);
  const requester = (did) =>
    createBackendRequester({
      backendUrl: SERVER_ORIGIN,
      token: server.mintToken(did),
      did,
      fetch,
    });
  return {
    mira,
    lab,
    server,
    fetch,
    req: requester(ME.did),
    requester,
    advance: (ms) => (clock += ms),
    now: () => clock,
  };
}

const stateWith = (texts, extra = {}) => {
  const state = emptyComposerState({
    asDid: ME.did,
    defaults: { langs: ['en'] },
  });
  return {
    ...state,
    posts: texts.map((text, i) => ({ ...state.posts[0], id: `p${i}`, text })),
    ...extra,
  };
};

async function scheduleBody(texts, { at, now = NOW, extra } = {}) {
  return serializeForSchedule(stateWith(texts, extra), {
    now: new Date(now),
    scheduledFor: new Date(at).toISOString(),
    queued: false,
    tz: 'UTC',
    resolveMention: async () => null,
  });
}

describe('scheduled posts', () => {
  it('lists the account’s rows, every one of them Virga’s', async () => {
    const { req } = setup();
    const { rows, timerNotes } = await listScheduled(req);
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.clientKey))).toEqual(new Set(['virga']));
    expect(rows.find((r) => r.status === 'failed').lastErrorCode).toBe(
      'SESSION_UNAVAILABLE',
    );
    expect(timerNotes).toHaveLength(1);
    expect(timerNotes[0]).toMatchObject({
      lastErrorCode: 'TIMER_NOT_ARMED',
      clientKey: 'virga',
    });
  });

  it('never shows one account another’s rows, or lets it touch them', async () => {
    const { req, requester } = setup();
    const { rows } = await listScheduled(req);
    const lab = requester(LAB.did);
    expect((await listScheduled(lab)).rows).toEqual([]);
    const mine = rows.find((r) => r.status === 'pending');
    await expect(getScheduled(lab, mine.id)).rejects.toMatchObject({
      status: 404,
    });
    await expect(cancelScheduled(lab, mine.id)).rejects.toMatchObject({
      code: 'NOT_CANCELLABLE',
    });
  });

  it('takes what scheduleSerialize builds, and gives back the row with its record keys', async () => {
    const { req } = setup();
    const body = await scheduleBody(
      ['Scheduled from the harness', 'and a second post'],
      { at: NOW + 5 * HOUR },
    );
    const row = await createScheduled(req, body);
    expect(row).toMatchObject({
      status: 'pending',
      clientKey: 'virga',
      queued: false,
      target: 'bluesky',
    });
    expect(row.payload.rkeys).toHaveLength(2);
    expect((await getScheduled(req, row.id)).payload.posts[1].record.text).toBe(
      'and a second post',
    );
    expect(await getScheduledMedia(req, row.id)).toEqual({});
  });

  it('refuses any target but Bluesky', async () => {
    const { req } = setup();
    const body = await scheduleBody(['elsewhere'], { at: NOW + HOUR });
    await expect(
      createScheduled(req, { ...body, target: 'elsewhere' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('moves, reorders, retries and cancels the account’s rows', async () => {
    const { req } = setup();
    const { rows } = await listScheduled(req);
    const queued = rows.find((r) => r.queued && r.status === 'pending');
    const moved = await updateScheduled(req, queued.id, {
      scheduledFor: new Date(NOW + 40 * HOUR),
    });
    expect(moved).toMatchObject({
      scheduledFor: new Date(NOW + 40 * HOUR).toISOString(),
      clientKey: 'virga',
    });
    const result = await reorderScheduled(req, [
      { id: queued.id, scheduledFor: new Date(NOW + 41 * HOUR) },
    ]);
    expect(result).toMatchObject({ moved: 1, fallback: false });
    const failed = rows.find((r) => r.status === 'failed');
    expect((await retryScheduled(req, failed.id)).status).toBe('pending');
    const atTime = rows.find((r) => !r.queued && r.status === 'pending');
    await expect(cancelScheduled(req, atTime.id)).resolves.toMatchObject({
      status: 'cancelled',
    });
  });

  it('refuses a reply or a video, which the server’s payload can’t carry', async () => {
    const { req } = setup();
    const body = await scheduleBody(['hello'], { at: NOW + HOUR });
    body.payload.posts[0].record.reply = {
      root: { uri: 'at://x/y/z', cid: 'c' },
      parent: { uri: 'at://x/y/z', cid: 'c' },
    };
    await expect(createScheduled(req, body)).rejects.toMatchObject({
      status: 400,
    });
  });

  it('is unlimited by default, and always reports the caps', async () => {
    const { req, server, fetch } = setup();
    const raw = await (
      await fetch(`${SERVER_ORIGIN}/api/limits/status`, {
        headers: { Authorization: `Bearer ${server.mintToken(ME.did)}` },
      })
    ).json();
    expect(raw).toMatchObject({ success: true, policy: 'flat', tier: null, isMember: false });
    for (const feature of ['scheduledPosts', 'postTimers', 'conditionalTimers'])
      expect(raw.features[feature]).toEqual({ isUnlimited: true, limit: null });
    const limits = await getLimits(req);
    expect(limits).toMatchObject({ policy: 'flat', isMember: false });
    for (const feature of ['scheduledPosts', 'postTimers', 'conditionalTimers'])
      expect(limits.features[feature].limit).toBeNull();
    // The seeded one at a time of its own, and the queued one.
    expect(limits.usage.scheduledPosts).toBe(2);
    expect(limits.caps).toEqual({ scheduledPosts: 50, timers: 200 });
  });

  it('keeps to a scheduled-posts limit set as the server’s env would, and says which limit was hit', async () => {
    const { req } = setup({ limits: { scheduledPosts: 3 } });
    const limits = await getLimits(req);
    expect(limits.features.scheduledPosts.limit).toBe(3);
    await createScheduled(
      req,
      await scheduleBody(['third'], { at: NOW + 3 * HOUR }),
    );
    await expect(
      createScheduled(
        req,
        await scheduleBody(['fourth'], { at: NOW + 4 * HOUR }),
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: 'QUOTA_EXCEEDED',
      payload: { feature: 'scheduledPosts', limit: 3 },
    });
  });

  it('stops at the flat cap with no limit set', async () => {
    const { req } = setup({ seed: false });
    for (let i = 0; i < MAX_PENDING_SCHEDULED; i++)
      await createScheduled(
        req,
        await scheduleBody([`post ${i}`], { at: NOW + (i + 1) * HOUR }),
      );
    await expect(
      createScheduled(
        req,
        await scheduleBody(['one too many'], { at: NOW + 99 * HOUR }),
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: 'QUOTA_EXCEEDED',
      payload: { feature: 'scheduledPosts', limit: MAX_PENDING_SCHEDULED },
    });
  });

  it('publishes a due row into the world at its reserved key, with its gates, and arms its timer', async () => {
    const { req, mira, server, advance, now } = setup();
    const body = await scheduleBody(['Out at noon', 'with a reply'], {
      at: NOW + HOUR,
      extra: {
        gates: { custom: true, reply: [], quotes: true },
        lifespan: {
          enabled: true,
          lifespanSeconds: 3 * 3600,
          conditions: {},
          effects: [{ action: 'delete' }],
        },
      },
    });
    const row = await createScheduled(req, body);
    expect(row.payload.selfDestruct).toBeTruthy();
    advance(HOUR + 1000);
    const { published } = await server.runCron();
    expect(published.map((r) => r.id)).toEqual([row.id]);
    const posts = listCollection(mira, 'app.bsky.feed.post');
    const root = posts.find((p) => p.uri.endsWith(`/${row.payload.rkeys[0]}`));
    expect(root.value).toMatchObject({
      text: 'Out at noon',
      createdAt: new Date(NOW + HOUR).toISOString(),
    });
    const reply = posts.find((p) => p.uri.endsWith(`/${row.payload.rkeys[1]}`));
    expect(reply.value.reply.parent.uri).toBe(root.uri);
    expect(
      listCollection(mira, 'app.bsky.feed.threadgate').find(
        (g) => g.value.post === root.uri,
      ).value.allow,
    ).toEqual([]);

    const { rows: timers } = await listTimers(req);
    const armed = timers.find((t) => t.postUri === root.uri);
    expect(armed).toMatchObject({ status: 'armed', clientKey: 'virga' });

    // Three hours on, the timer takes the thread down.
    advance(3 * HOUR + 1000);
    expect(now()).toBeGreaterThan(Date.parse(armed.checkAt));
    await server.runCron();
    const left = listCollection(mira, 'app.bsky.feed.post').map((p) => p.uri);
    expect(left).not.toContain(root.uri);
    expect(left).not.toContain(reply.uri);
    const { rows: history } = await listTimers(req, { history: true });
    expect(history.find((t) => t.id === armed.id).status).toBe('deleted');
  });

  it('fails a row whose account has signed out of the server everywhere', async () => {
    const { server, advance, fetch, requester } = setup();
    const token = server.mintToken(ME.did);
    const req = createBackendRequester({
      backendUrl: SERVER_ORIGIN,
      token,
      did: ME.did,
      fetch,
    });
    const row = await createScheduled(
      req,
      await scheduleBody(['nobody home'], { at: NOW + HOUR }),
    );
    // Every token for the account goes, so the grant does too.
    for (const [t, info] of server.inspect().tokens)
      if (info.did === ME.did) server.signOutToken(t);
    advance(HOUR + 1000);
    await server.runCron();
    const again = await listScheduled(requester(ME.did));
    expect(again.rows.find((r) => r.id === row.id)).toMatchObject({
      status: 'pending',
      lastErrorCode: 'SESSION_UNAVAILABLE',
    });
  });
});

const GATE = 'app.bsky.feed.threadgate';
/** The account's own first posts with no gate of their own yet. */
const rootsOf = (world) =>
  world.posts.filter((p) => !p.replyTo && !readRecord(world, GATE, p.rkey));

describe('timers', () => {
  const body = (uri, extra = {}) => ({
    postUri: uri,
    postedAt: new Date(NOW).toISOString(),
    lifespanSeconds: 3600,
    conditions: {},
    effects: [{ action: 'delete' }],
    ...extra,
  });

  it('arms a timer once per post: 201 for a new one, 200 for the same one again', async () => {
    const { server, fetch, mira } = setup();
    const token = server.mintToken(ME.did);
    const uri = `at://${ME.did}/app.bsky.feed.post/${mira.posts[5].rkey}`;
    const arm = () =>
      fetch(`${SERVER_ORIGIN}/api/self-destruct/create`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body(uri)),
      });
    const first = await arm();
    expect(first.status).toBe(201);
    const firstBody = await first.json();
    expect(firstBody.data).toMatchObject({ status: 'armed', clientKey: 'virga' });
    const again = await arm();
    expect(again.status).toBe(200);
    expect((await again.json()).data.id).toBe(firstBody.data.id);
  });

  it('keeps to a plain-timer limit when one is set, and counts what is live', async () => {
    const { req, mira } = setup({ limits: { postTimers: 1 } });
    const [a, b] = mira.posts
      .slice(5, 7)
      .map((p) => `at://${ME.did}/app.bsky.feed.post/${p.rkey}`);
    await req.request('/api/self-destruct/create', {
      method: 'POST',
      body: body(a),
    });
    await expect(
      req.request('/api/self-destruct/create', {
        method: 'POST',
        body: body(b),
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'QUOTA_EXCEEDED',
      payload: { feature: 'postTimers', limit: 1 },
    });
    const limits = await getLimits(req);
    // The seeded live timer is a conditional one.
    expect(limits.usage).toMatchObject({ postTimers: 1, conditionalTimers: 1 });
    expect(limits.features.postTimers.limit).toBe(1);
    expect(limits.features.conditionalTimers.limit).toBeNull();
  });

  it('refuses a timer on someone else’s post', async () => {
    const { req, lab } = setup();
    const uri = `at://${LAB.did}/app.bsky.feed.post/${lab.posts[0].rkey}`;
    await expect(
      req.request('/api/self-destruct/create', {
        method: 'POST',
        body: body(uri),
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('spares a post whose rule it meets, and limits replies without deleting', async () => {
    const { req, mira, server, advance } = setup();
    const [kept, gated] = mira.posts
      .filter((p) => p.likes >= 3 && !p.replyTo)
      .slice(0, 2);
    const uriOf = (p) => `at://${ME.did}/app.bsky.feed.post/${p.rkey}`;
    await req.request('/api/self-destruct/create', {
      method: 'POST',
      body: body(uriOf(kept), {
        conditions: {
          clauses: [{ metric: 'likes', op: 'gte', value: 1 }],
          sense: 'unless',
        },
      }),
    });
    await req.request('/api/self-destruct/create', {
      method: 'POST',
      body: body(uriOf(gated), {
        effects: [{ action: 'limitReplies', allow: ['following'] }],
      }),
    });
    advance(2 * HOUR);
    await server.runCron();
    const { rows } = await listTimers(req, { history: true });
    expect(rows.find((t) => t.postUri === uriOf(kept)).status).toBe('spared');
    expect(rows.find((t) => t.postUri === uriOf(gated)).status).toBe('acted');
    expect(
      listCollection(mira, 'app.bsky.feed.post').some(
        (p) => p.uri === uriOf(gated),
      ),
    ).toBe(true);
    expect(
      listCollection(mira, 'app.bsky.feed.threadgate').find(
        (g) => g.value.post === uriOf(gated),
      ).value.allow,
    ).toEqual([{ $type: 'app.bsky.feed.threadgate#followingRule' }]);
  });

  it('lists every timer as Virga’s, and calls one off', async () => {
    const { req } = setup();
    const { rows } = await listTimers(req, { history: true });
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((t) => t.clientKey))).toEqual(new Set(['virga']));
    const live = (await listTimers(req)).rows.find((t) => t.status === 'armed');
    await cancelTimer(req, live.id);
    const after = await listTimers(req);
    expect(after.rows.some((t) => t.id === live.id)).toBe(false);
  });

  it('keeps one account’s timers from another', async () => {
    const { req, requester } = setup();
    const live = (await listTimers(req)).rows.find((t) => t.status === 'armed');
    const lab = requester(LAB.did);
    expect((await listTimers(lab)).rows).toEqual([]);
    await expect(cancelTimer(lab, live.id)).rejects.toMatchObject({
      code: 'NOT_CANCELLABLE',
    });
  });

  it('rewrites an armed timer on re-arm', async () => {
    const { req } = setup();
    const { rows } = await listTimers(req);
    const live = rows.find((t) => t.status === 'armed');
    const res = await req.request('/api/self-destruct/create', {
      method: 'POST',
      body: body(live.postUri, {
        lifespanSeconds: 7200,
        effects: [{ action: 'limitReplies', allow: ['following'] }],
      }),
    });
    expect(res.data).toMatchObject({
      id: live.id,
      clientKey: 'virga',
      conditions: {},
      lifespanSeconds: 7200,
      effects: [{ action: 'limitReplies', allow: ['following'] }],
      checkAt: new Date(NOW + 2 * HOUR).toISOString(),
    });
    const after = await listTimers(req);
    expect(after.rows.find((t) => t.id === live.id)).toMatchObject({
      lifespanSeconds: 7200,
      attempts: 0,
      lastError: null,
    });
  });

  it('leaves a timer that is mid-check alone on re-arm', async () => {
    const { req, server } = setup();
    const { rows } = await listTimers(req);
    const live = rows.find((t) => t.status === 'armed');
    server.inspect().timers.find((t) => t.id === live.id).status = 'checking';
    const res = await req.request('/api/self-destruct/create', {
      method: 'POST',
      body: body(live.postUri, { lifespanSeconds: 7200 }),
    });
    expect(res.data).toMatchObject({
      id: live.id,
      clientKey: 'virga',
      lifespanSeconds: live.lifespanSeconds,
      checkAt: live.checkAt,
    });
  });
  const timerFor = (server, uri) =>
    server.inspect().timers.find((t) => t.post_uri === uri);

  it('narrows a gate the author set, never opens it, and leaves a reply alone', async () => {
    const { req, mira, server, advance } = setup();
    const [mentioned, both] = rootsOf(mira);
    const reply = mira.posts.find((p) => p.replyTo === ME.did);
    const uriOf = (p) => `at://${ME.did}/app.bsky.feed.post/${p.rkey}`;
    const gate = (p, allow) =>
      writeRecord(mira, {
        collection: GATE,
        rkey: p.rkey,
        record: { $type: GATE, post: uriOf(p), createdAt: new Date(NOW).toISOString(), allow },
      });
    await gate(mentioned, [{ $type: `${GATE}#mentionRule` }]);
    await gate(both, [{ $type: `${GATE}#followerRule` }, { $type: `${GATE}#mentionRule` }]);
    for (const p of [mentioned, both, reply])
      await req.request('/api/self-destruct/create', {
        method: 'POST',
        body: body(uriOf(p), {
          effects: [{ action: 'limitReplies', allow: ['follower'] }],
        }),
      });
    advance(2 * HOUR);
    await server.runCron();

    expect(readRecord(mira, GATE, mentioned.rkey).value.allow).toEqual([
      { $type: `${GATE}#mentionRule` },
    ]);
    expect((await timerFor(server, uriOf(mentioned))).acted).toEqual([
      {
        action: 'limitReplies',
        ok: false,
        detail: 'left the reply settings alone; the rule would have opened them up',
      },
    ]);
    expect(readRecord(mira, GATE, both.rkey).value.allow).toEqual([
      { $type: `${GATE}#followerRule` },
    ]);
    expect((await timerFor(server, uriOf(both))).acted).toEqual([
      { action: 'limitReplies', ok: true, detail: 'replies limited to your followers' },
    ]);
    expect(readRecord(mira, GATE, reply.rkey)).toBeNull();
    expect((await timerFor(server, uriOf(reply))).acted[0]).toMatchObject({
      action: 'limitReplies',
      ok: false,
      detail: expect.stringContaining('this post is a reply'),
    });
  });

  it('narrows as the server does', () => {
    const LIST = 'at://did:plc:x/app.bsky.graph.list/moots';
    const cases = [
      [['follower'], undefined],
      [['follower', { list: LIST }], undefined],
      [['follower'], [{ $type: `${GATE}#mentionRule` }]],
      [['follower'], [{ $type: `${GATE}#followerRule` }, { $type: `${GATE}#followingRule` }]],
      [['follower'], [{ $type: `${GATE}#followerRule` }]],
      [['follower'], []],
      [[], [{ $type: `${GATE}#followerRule` }]],
      [[{ list: LIST }], [{ $type: `${GATE}#listRule`, list: LIST }, { $type: `${GATE}#mentionRule` }]],
      [[{ list: LIST }], [{ $type: `${GATE}#listRule`, list: `${LIST}2` }]],
    ];
    for (const [wanted, existing] of cases)
      expect(narrowAllow(wanted, existing)).toEqual(serverNarrowAllow(wanted, existing));
  });

  it('holds the flat cap where a timer is armed, and lets a post at the cap change its rule', async () => {
    const { req, server, mira } = setup();
    const { timers } = server.inspect();
    const live = timers.find((t) => t.user_did === ME.did && t.status === 'armed');
    const count = timers.filter(
      (t) => t.user_did === ME.did && ['armed', 'checking'].includes(t.status),
    ).length;
    for (let i = count; i < MAX_LIVE_TIMERS; i++)
      timers.push({ ...live, id: `filler-${i}`, post_uri: `${live.post_uri}-filler-${i}` });

    const res = await req.request('/api/self-destruct/create', {
      method: 'POST',
      body: body(live.post_uri, { lifespanSeconds: 7200 }),
    });
    expect(res.data).toMatchObject({ id: live.id, lifespanSeconds: 7200 });

    const fresh = `at://${ME.did}/app.bsky.feed.post/${rootsOf(mira).find((p) => !timers.some((t) => t.rkey === p.rkey)).rkey}`;
    await expect(
      req.request('/api/self-destruct/create', { method: 'POST', body: body(fresh) }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'QUOTA_EXCEEDED',
      payload: { limit: MAX_LIVE_TIMERS },
    });
  });
});

describe('sessions', () => {
  it('answers the session check at /api/oauth/session, and signs out per device', async () => {
    const { server, fetch } = setup();
    const one = server.mintToken(LAB.did);
    const two = server.mintToken(LAB.did);
    expect(one).toMatch(/^vg_[0-9a-f]{64}$/);
    const check = async (token) =>
      interpretLiteSessionResponse(
        await checkBackendSession({ backendUrl: SERVER_ORIGIN, token, fetch }),
      );
    expect((await check(one)).status).toBe('valid');
    expect(
      await backendSignOut({ backendUrl: SERVER_ORIGIN, token: one, fetch }),
    ).toBe(true);
    expect(await check(one)).toEqual({ status: 'expired', definitive: true });
    expect((await check(two)).status).toBe('valid');
  });

  it('ends the grant only with the account’s last token', async () => {
    const { server } = setup();
    const one = server.mintToken(LAB.did);
    const two = server.mintToken(LAB.did);
    expect(server.signOutToken(one)).toEqual({ found: true, grantRevoked: false });
    expect(server.signOutToken(two)).toEqual({ found: true, grantRevoked: true });
    expect(server.signOutToken(two)).toEqual({ found: false, grantRevoked: false });
  });

  it('answers an unknown token with FRONTEND_SESSION_INVALID everywhere', async () => {
    const { fetch } = setup();
    const ghost = createBackendRequester({
      backendUrl: SERVER_ORIGIN,
      token: `vg_${'0'.repeat(64)}`,
      did: ME.did,
      fetch,
    });
    await expect(listScheduled(ghost)).rejects.toMatchObject({
      status: 401,
      code: 'FRONTEND_SESSION_INVALID',
    });
    const res = await fetch(`${SERVER_ORIGIN}/api/limits/status`, {});
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('FRONTEND_SESSION_INVALID');
    const session = await fetch(`${SERVER_ORIGIN}${BACKEND_PATHS.session}`, {
      headers: { Authorization: `Bearer vg_${'1'.repeat(64)}` },
    });
    expect(session.status).toBe(401);
    expect((await session.json()).code).toBe('FRONTEND_SESSION_INVALID');
  });

  it('signs out an unknown token, or none, with a 200, as the server does', async () => {
    const { fetch } = setup();
    const logout = (headers) =>
      fetch(`${SERVER_ORIGIN}${BACKEND_PATHS.logout}`, { method: 'POST', headers, body: '{}' });
    const unknown = await logout({ Authorization: `Bearer vg_${'1'.repeat(64)}` });
    expect(unknown.status).toBe(200);
    expect(await unknown.json()).toEqual({
      success: true,
      message: 'Logged out successfully',
      grantRevoked: false,
    });
    const none = await logout({});
    expect(none.status).toBe(200);
    expect(await none.json()).toEqual({ success: true, message: 'No session to logout' });
    expect(
      await backendSignOut({ backendUrl: SERVER_ORIGIN, token: `vg_${'2'.repeat(64)}`, fetch }),
    ).toBe(true);
    // The session check's missing-header 401 carries no code, as session.js.
    const bare = await fetch(`${SERVER_ORIGIN}${BACKEND_PATHS.session}`, {});
    expect(bare.status).toBe(401);
    expect(await bare.json()).not.toHaveProperty('code');
  });

  it('keeps the grant for a token dropped with keepGrant', async () => {
    const { server, fetch } = setup();
    const token = server.mintToken(LAB.did);
    const out = await fetch(`${SERVER_ORIGIN}${BACKEND_PATHS.logout}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ keepGrant: true }),
    });
    expect((await out.json()).grantRevoked).toBe(false);
  });

  it('reads a refused grant as there on the lite check until something has tried it', async () => {
    const { server, fetch, req, mira, advance } = setup();
    const token = server.mintToken(ME.did);
    const auth = { Authorization: `Bearer ${token}` };
    const lite = async () =>
      interpretLiteSessionResponse(
        await checkBackendSession({ backendUrl: SERVER_ORIGIN, token, fetch }),
      );
    const uri = `at://${ME.did}/app.bsky.feed.post/${rootsOf(mira)[0].rkey}`;
    await req.request('/api/self-destruct/create', {
      method: 'POST',
      body: { postUri: uri, postedAt: new Date(NOW).toISOString(), lifespanSeconds: 3600 },
    });

    server.refuseGrant(ME.did);
    expect(await lite()).toEqual({ status: 'valid', definitive: false });

    const proxied = await fetch(`${SERVER_ORIGIN}${BACKEND_PATHS.proxy}`, {
      headers: { ...auth, 'X-XRPC-Method': 'com.atproto.repo.getRecord' },
    });
    expect(proxied.status).toBe(401);
    expect((await proxied.json()).code).toBe('OAUTH_SESSION_MISSING');
    expect(await lite()).toEqual({ status: 'expired', definitive: false });
    const full = await fetch(`${SERVER_ORIGIN}${BACKEND_PATHS.session}`, { headers: auth });
    expect(await full.json()).toMatchObject({ oauthSessionMissing: true });

    advance(2 * HOUR);
    await server.runCron();
    expect(server.inspect().timers.find((t) => t.post_uri === uri)).toMatchObject({
      status: 'armed',
      last_error_code: 'SESSION_UNAVAILABLE',
    });

    // A new sign-in writes a new grant.
    const again = server.mintToken(ME.did);
    const fresh = await fetch(`${SERVER_ORIGIN}${BACKEND_PATHS.session}?lite=1`, {
      headers: { Authorization: `Bearer ${again}` },
    });
    expect(await fresh.json()).toMatchObject({ oauthSessionMissing: false });
  });

  it('answers a preflight with no content, and the old paths not at all', async () => {
    const { server, fetch } = setup();
    const preflight = await fetch(`${SERVER_ORIGIN}/api/schedule/list`, {
      method: 'OPTIONS',
    });
    expect(preflight.status).toBe(204);
    const token = server.mintToken(ME.did);
    for (const old of ['/oauth/session', '/virga/oauth/login']) {
      const res = await fetch(`${SERVER_ORIGIN}${old}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(404);
    }
  });
});

describe('the adviser and alt text', () => {
  it('reads a draft against the writer’s goals and checks its writing', async () => {
    const { req } = setup();
    const res = await req.request('/api/ai/analyze-post', {
      method: 'POST',
      body: {
        text: 'This is the the worst bus timetable',
        goals: { presets: { reduceNegativity: true } },
        writingChecks: { typos: true },
      },
    });
    expect(res.overallStatus).toBe('caution');
    expect(res.checks[0]).toMatchObject({
      id: 'reduceNegativity',
      status: 'caution',
    });
    expect(res.writing.issues[0]).toMatchObject({
      type: 'typo',
      found: 'the the',
      replacement: 'the',
    });
    expect(res.usage).toEqual({ used: 1, limit: 30 });
  });

  it('reads a text as long as the server does: a long thread, not one post', async () => {
    expect(MAX_ANALYZE_TEXT).toBe(MAX_TEXT_LENGTH);
    const { req } = setup();
    // Eleven posts of about 290 characters, joined as the adviser sends a thread.
    const thread = Array.from({ length: 11 }, (_, i) => `Post ${i} `.padEnd(290, 'x')).join('\n\n');
    expect(thread.length).toBeGreaterThan(3000);
    const read = await req.request('/api/ai/analyze-post', {
      method: 'POST',
      body: { text: thread, writingChecks: { typos: true } },
    });
    expect(read).toHaveProperty('overallStatus');
    await expect(
      req.request('/api/ai/analyze-post', {
        method: 'POST',
        body: { text: 'x'.repeat(MAX_TEXT_LENGTH + 1) },
      }),
    ).rejects.toMatchObject({ status: 413 });
  });

  it('answers ok without counting when there is nothing to check', () => {
    expect(analyzePost({ text: 'hello', goals: {} })).toBeNull();
  });

  it('stops at the monthly allowance', async () => {
    const { req } = setup();
    const send = () =>
      req.request('/api/ai/synthesize-style', {
        method: 'POST',
        body: { posts: ['a', 'b', 'c', 'd', 'e'] },
      });
    for (let i = 0; i < DEFAULT_AI_LIMITS.style; i++)
      expect((await send()).summary).toBeTruthy();
    await expect(send()).rejects.toMatchObject({
      status: 429,
      code: 'monthly_limit',
      payload: { limit: 3, used: 3 },
    });
    await expect(
      req.request('/api/ai/synthesize-style', {
        method: 'POST',
        body: { posts: ['a'] },
      }),
    ).rejects.toMatchObject({
      code: 'not_enough_posts',
    });
  });

  it('counts nothing and reports no usage when an allowance is unlimited, and refuses all at 0', async () => {
    const { req } = setup({ aiLimits: { adviser: null, altText: 0 } });
    const read = await req.request('/api/ai/analyze-post', {
      method: 'POST',
      body: { text: 'I hate this', goals: { presets: { reduceNegativity: true } } },
    });
    expect(read).not.toHaveProperty('usage');
    await expect(
      req.request('/api/ai/alt-text', {
        method: 'POST',
        body: { imageBase64: 'iVBORw0KGgo=', mimeType: 'image/png' },
      }),
    ).rejects.toMatchObject({ status: 429, code: 'monthly_limit' });
  });

  it('writes alt text and revises it from a note', async () => {
    const { req } = setup();
    const first = await req.request('/api/ai/alt-text', {
      method: 'POST',
      body: { imageBase64: 'iVBORw0KGgo=', mimeType: 'image/png' },
    });
    expect(first.altText).toBeTruthy();
    expect(first.usage).toEqual({ used: 1, limit: 15 });
    const second = await req.request('/api/ai/alt-text', {
      method: 'POST',
      body: {
        imageBase64: 'iVBORw0KGgo=',
        mimeType: 'image/png',
        followUp: 'Mention the rain',
        previousAltText: first.altText,
      },
    });
    expect(second.altText).toMatch(/mention the rain/);
  });
});

describe('the fake network', () => {
  it('reaches the server at SERVER_ORIGIN, and only there', async () => {
    const { mira, lab, server } = setup({ limits: { postTimers: 1 } });
    const route = createRouter([mira, lab], { server });
    const token = server.mintToken(ME.did);
    const res = await route(`${SERVER_ORIGIN}/api/limits/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const status = await res.json();
    expect(status.features.postTimers.limit).toBe(1);
    expect(status.caps).toEqual({ scheduledPosts: 50, timers: 200 });
    expect(await route(`${SERVER_ORIGIN}/api/nothing-here`, {})).toHaveProperty(
      'status',
      404,
    );
    // The dev server's own /api is Vite's, never the fake's.
    expect(await createServerRouter(server)(new URL('http://127.0.0.1:5701/api/limits/status'), {})).toBeNull();
  });
});

describe('the address flags', () => {
  it('start unlimited, with the server’s default AI allowances', () => {
    const flags = readFlags('');
    expect(flags.limits).toEqual({ scheduledPosts: undefined, postTimers: undefined, conditionalTimers: undefined });
    expect(flags.aiLimits).toEqual({ adviser: 30, altText: 15, style: 3 });
  });

  it('read per-feature limits, a blank or 0 leaving one unlimited', () => {
    expect(readFlags('?limits=3,1,1').limits).toEqual({ scheduledPosts: 3, postTimers: 1, conditionalTimers: 1 });
    expect(readFlags('?limits=,2,0').limits).toEqual({ scheduledPosts: undefined, postTimers: 2, conditionalTimers: undefined });
  });

  it('read the AI allowances, or none at all', () => {
    expect(readFlags('?ailimits=5,2,1').aiLimits).toEqual({ adviser: 5, altText: 2, style: 1 });
    expect(readFlags('?ailimits=unlimited').aiLimits).toEqual({ adviser: null, altText: null, style: null });
    expect(readFlags('?ailimits=0').aiLimits).toEqual({ adviser: 0, altText: 15, style: 3 });
  });
});
