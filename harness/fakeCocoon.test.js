// The fake server answers the real posting services (scheduleService,
// timerService, scheduleSerialize) through the real requester, so these check
// it in their terms: the shapes they read, the cross-client rules (D4), the
// limits (D5), and the workers writing into the account's world.

import { describe, expect, it } from 'vitest';
import {
  createCocoon,
  createCocoonRouter,
  analyzePost,
  FREE_LIMITS,
} from './fakeCocoon.js';
import { createRouter } from './fakeNetwork.js';
import { listCollection } from './repo.js';
import { LAB, ME, buildWorld } from './world.js';
import { COCOON_URL } from '../src/config.js';
import {
  createBackendRequester,
  checkBackendSession,
  backendSignOut,
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

function setup({ policy, tiers, seed = true } = {}) {
  let clock = NOW;
  const mira = buildWorld({ now: NOW });
  const lab = buildWorld({ now: NOW, account: LAB });
  const worlds = [mira, lab];
  for (const w of worlds) w.scope = 'atproto';
  const cocoon = createCocoon({
    worlds,
    policy,
    tiers,
    seed,
    aiDelayMs: 0,
    now: () => clock,
  });
  const route = createCocoonRouter(cocoon, new URL(COCOON_URL).origin);
  const fetch = (href, init) => route(new URL(href), init);
  const requester = (did, client = 'virga') =>
    createBackendRequester({
      backendUrl: COCOON_URL,
      token: cocoon.mintToken(did, client),
      did,
      fetch,
    });
  return {
    mira,
    lab,
    cocoon,
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
  it('lists every row of the account to Virga, each with its client', async () => {
    const { req } = setup();
    const { rows, timerNotes } = await listScheduled(req);
    expect(new Set(rows.map((r) => r.clientKey))).toEqual(
      new Set(['anisota', 'virga']),
    );
    expect(rows.find((r) => r.status === 'failed').lastErrorCode).toBe(
      'SESSION_UNAVAILABLE',
    );
    expect(timerNotes).toHaveLength(1);
    expect(timerNotes[0].lastErrorCode).toBe('TIMER_NOT_ARMED');
  });

  it('shows Anisota only its own rows', async () => {
    const { requester } = setup();
    const anisota = requester(ME.did, 'anisota');
    const { rows } = await listScheduled(anisota);
    expect(rows.every((r) => r.clientKey === 'anisota')).toBe(true);
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

  it('refuses changes to another client’s row but lets Virga cancel it', async () => {
    const { req } = setup();
    const { rows } = await listScheduled(req);
    const theirs = rows.find((r) => r.clientKey === 'anisota');
    await expect(
      updateScheduled(req, theirs.id, {
        scheduledFor: new Date(NOW + 30 * HOUR),
      }),
    ).rejects.toMatchObject({
      status: 403,
      code: 'NOT_YOUR_CLIENT',
    });
    await expect(
      reorderScheduled(req, [
        { id: theirs.id, scheduledFor: new Date(NOW + 30 * HOUR) },
      ]),
    ).rejects.toMatchObject({ code: 'NOT_YOUR_CLIENT' });
    await expect(cancelScheduled(req, theirs.id)).resolves.toMatchObject({
      status: 'cancelled',
    });
  });

  it('moves, reorders and retries Virga’s own rows', async () => {
    const { req } = setup({ tiers: { [ME.did]: 'member' } });
    const { rows } = await listScheduled(req);
    const queued = rows.find(
      (r) => r.clientKey === 'virga' && r.status === 'pending',
    );
    const moved = await updateScheduled(req, queued.id, {
      scheduledFor: new Date(NOW + 40 * HOUR),
    });
    expect(moved.scheduledFor).toBe(new Date(NOW + 40 * HOUR).toISOString());
    const result = await reorderScheduled(req, [
      { id: queued.id, scheduledFor: new Date(NOW + 41 * HOUR) },
    ]);
    expect(result).toMatchObject({ moved: 1, fallback: false });
    const failed = rows.find((r) => r.status === 'failed');
    expect((await retryScheduled(req, failed.id)).status).toBe('pending');
  });

  it('refuses a reply or a video, which cocoon’s payload can’t carry', async () => {
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

  it('counts the scheduled-post limit across clients, and says which limit was hit', async () => {
    const { req } = setup();
    const limits = await getLimits(req);
    expect(limits.policy).toBe('membership');
    expect(limits.features.scheduledPosts.limit).toBe(
      FREE_LIMITS.scheduledPosts,
    );
    // One of Anisota's and one of Virga's are waiting.
    expect(limits.usage.scheduledPosts).toBe(2);
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
      code: 'QUOTA_EXCEEDED',
      payload: { feature: 'scheduledPosts', limit: 3 },
    });
  });

  it('has no free limits under the flat policy', async () => {
    const { req } = setup({ policy: 'flat' });
    const limits = await getLimits(req);
    expect(limits.policy).toBe('flat');
    expect(limits.features.scheduledPosts.limit).toBeNull();
    for (let i = 0; i < 3; i++)
      await createScheduled(
        req,
        await scheduleBody([`post ${i}`], { at: NOW + (i + 2) * HOUR }),
      );
  });

  it('publishes a due row into the world at its reserved key, with its gates, and arms its timer', async () => {
    const { req, mira, cocoon, advance, now } = setup({
      tiers: { [ME.did]: 'member' },
    });
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
    const { published } = await cocoon.runCron();
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
    await cocoon.runCron();
    const left = listCollection(mira, 'app.bsky.feed.post').map((p) => p.uri);
    expect(left).not.toContain(root.uri);
    expect(left).not.toContain(reply.uri);
    const { rows: history } = await listTimers(req, { history: true });
    expect(history.find((t) => t.id === armed.id).status).toBe('deleted');
  });

  it('fails a row whose account has signed out of the server everywhere', async () => {
    const { cocoon, advance, fetch, requester } = setup();
    const token = cocoon.mintToken(ME.did);
    const req = createBackendRequester({
      backendUrl: COCOON_URL,
      token,
      did: ME.did,
      fetch,
    });
    const row = await createScheduled(
      req,
      await scheduleBody(['nobody home'], { at: NOW + HOUR }),
    );
    // Every Virga token for the account goes, so the grant does too.
    for (const [t, info] of cocoon.inspect().tokens)
      if (info.did === ME.did && info.client === 'virga')
        cocoon.signOutToken(t);
    advance(HOUR + 1000);
    await cocoon.runCron();
    const again = await listScheduled(requester(ME.did));
    expect(again.rows.find((r) => r.id === row.id)).toMatchObject({
      status: 'pending',
      lastErrorCode: 'SESSION_UNAVAILABLE',
    });
  });
});

describe('timers', () => {
  const body = (uri, extra = {}) => ({
    postUri: uri,
    postedAt: new Date(NOW).toISOString(),
    lifespanSeconds: 3600,
    conditions: {},
    effects: [{ action: 'delete' }],
    ...extra,
  });

  it('arms a timer once per post, and keeps a free account to one of each kind', async () => {
    const { req, mira } = setup();
    const [a, b] = mira.posts
      .slice(5, 7)
      .map((p) => `at://${ME.did}/app.bsky.feed.post/${p.rkey}`);
    const first = await req.request('/api/self-destruct/create', {
      method: 'POST',
      body: body(a),
    });
    expect(first.data).toMatchObject({ status: 'armed', clientKey: 'virga' });
    const again = await req.request('/api/self-destruct/create', {
      method: 'POST',
      body: body(a),
    });
    expect(again.data.id).toBe(first.data.id);
    await expect(
      req.request('/api/self-destruct/create', {
        method: 'POST',
        body: body(b),
      }),
    ).rejects.toMatchObject({
      status: 402,
      code: 'QUOTA_EXCEEDED',
      payload: { feature: 'postTimers' },
    });
    const limits = await getLimits(req);
    expect(limits.usage).toMatchObject({ postTimers: 1, conditionalTimers: 1 });
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
    const { req, mira, cocoon, advance } = setup({
      tiers: { [ME.did]: 'member' },
    });
    const [kept, gated] = mira.posts.filter((p) => p.likes >= 3).slice(0, 2);
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
    await cocoon.runCron();
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

  it('lets Virga call off Anisota’s timer', async () => {
    const { req } = setup();
    const { rows } = await listTimers(req);
    const theirs = rows.find((t) => t.clientKey === 'anisota');
    expect(theirs).toBeTruthy();
    await cancelTimer(req, theirs.id);
    const after = await listTimers(req);
    expect(after.rows.some((t) => t.id === theirs.id)).toBe(false);
  });
});

describe('sessions and the adviser', () => {
  it('answers the session check, and signs out per device', async () => {
    const { cocoon, fetch } = setup();
    const one = cocoon.mintToken(LAB.did);
    const two = cocoon.mintToken(LAB.did);
    const check = async (token) =>
      interpretLiteSessionResponse(
        await checkBackendSession({ backendUrl: COCOON_URL, token, fetch }),
      );
    expect((await check(one)).status).toBe('valid');
    expect(
      await backendSignOut({ backendUrl: COCOON_URL, token: one, fetch }),
    ).toBe(true);
    expect(await check(one)).toEqual({ status: 'expired', definitive: true });
    expect((await check(two)).status).toBe('valid');
  });

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

  it('answers ok without counting when there is nothing to check', () => {
    expect(analyzePost({ text: 'hello', goals: {} })).toBeNull();
  });

  it('stops a free account at the monthly trial', async () => {
    const { req } = setup();
    const send = () =>
      req.request('/api/ai/synthesize-style', {
        method: 'POST',
        body: { posts: ['a', 'b', 'c', 'd', 'e'] },
      });
    for (let i = 0; i < 3; i++) expect((await send()).summary).toBeTruthy();
    await expect(send()).rejects.toMatchObject({
      status: 429,
      code: 'monthly_limit',
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

  it('writes alt text and revises it from a note', async () => {
    const { req } = setup();
    const first = await req.request('/api/ai/alt-text', {
      method: 'POST',
      body: { imageBase64: 'iVBORw0KGgo=', mimeType: 'image/png' },
    });
    expect(first.altText).toBeTruthy();
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

  it('is reachable through the whole fake network at Virga’s server address', async () => {
    const { mira, lab, cocoon } = setup();
    const route = createRouter([mira, lab], { cocoon });
    const token = cocoon.mintToken(ME.did);
    const res = await route(`${COCOON_URL}/api/limits/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect((await res.json()).features.postTimers.limit).toBe(1);
    expect(await route(`${COCOON_URL}/api/nothing-here`, {})).toHaveProperty(
      'status',
      404,
    );
  });
});
