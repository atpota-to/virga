/*
 * The timer transport. Held here: the wire shape (effects always sent, since
 * the server reads absent effects as delete); which failures count as a lost
 * answer; a lost one is retried once (create is idempotent per post) and the
 * timers list is asked before anything definite is said; "unconfirmed" is
 * what's left when nothing answers; a timer is only ever set as the account
 * that wrote the post; and only the server's explicit word hides the feature.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  armAfterPublish,
  cancelTimer,
  confirmArmAfterUnknown,
  countLiveTimers,
  createTimer,
  isArmOutcomeUnknown,
  isDefiniteArmRefusal,
  isTimersUnsupported,
  listTimers,
  loadTimerUsage,
  markTimersUnavailable,
  probeTimerAvailability,
  resetTimerAvailability,
  timerAvailability,
  timerBody,
  timerDidForUri,
  timerPostUrl,
  timerSnippet,
} from './timerService.js';
import { composerTimerFit } from './selfDestruct.js';

const WRITER = 'did:plc:writer';
const POST = `at://${WRITER}/app.bsky.feed.post/3kpost`;
const RULE = { enabled: true, lifespanSeconds: 3600 };
const FIT = composerTimerFit({});

/** A Requester whose answers are queued per path; each call is recorded. */
function fakeRequester(did = WRITER) {
  const queues = {};
  const calls = [];
  return {
    did,
    calls,
    answer(path, ...outcomes) {
      (queues[path] ||= []).push(...outcomes);
      return this;
    },
    async request(path, opts = {}) {
      calls.push({ path, ...opts });
      const next = (queues[path] || []).shift();
      if (next === undefined) throw new Error(`no answer queued for ${path}`);
      if (typeof next === 'function') return next(opts);
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

const timeout = () =>
  Object.assign(new Error('Virga’s server didn’t answer in time.'), {
    status: 0,
    code: 'TIMEOUT',
  });
const offline = () =>
  Object.assign(new Error('Couldn’t reach Virga’s server.'), {
    status: 0,
    code: 'NETWORK_ERROR',
  });
const refused = (status, code = null, message = 'no') =>
  Object.assign(new Error(message), {
    status,
    code,
    detail: message,
    payload: { success: false, error: message, code },
  });

beforeEach(() => {
  resetTimerAvailability();
});

describe('the create body', () => {
  const GATE_ONLY = {
    enabled: true,
    lifespanSeconds: 3600,
    deleteAt: null,
    conditions: {
      clauses: [{ metric: 'quotes', op: 'gte', value: 10 }],
      logic: 'any',
      sense: 'onlyIf',
      onSpare: 'keep',
    },
    effects: [{ action: 'limitReplies', allow: ['follower'] }],
  };

  it('sends the effects block — a gate-only rule must never arm as a delete', async () => {
    const req = fakeRequester().answer('/api/self-destruct/create', {
      success: true,
      data: { id: 't1' },
    });
    const out = await createTimer(req, {
      uri: POST,
      cid: 'bafyabc',
      rule: GATE_ONLY,
      fit: FIT,
      postedAt: new Date().toISOString(),
    });
    expect(out.status).toBe('armed');
    const { body, method } = req.calls[0];
    expect(method).toBe('POST');
    expect(body.effects).toEqual([
      { action: 'limitReplies', allow: ['follower'] },
    ]);
    expect(body.lifespanSeconds).toBe(3600);
    expect(body.conditions.clauses).toEqual([
      { metric: 'quotes', op: 'gte', value: 10 },
    ]);
    expect(body.postUri).toBe(POST);
    expect(body.postCid).toBe('bafyabc');
  });

  it('sends nothing at all for a rule that is off, or fitted off', async () => {
    const req = fakeRequester();
    await expect(
      createTimer(req, { uri: POST, rule: { ...RULE, enabled: false } }),
    ).resolves.toEqual({ status: 'none', adjusted: null });
    // A reply can't limit replies; a rule that only did that has nothing left.
    await expect(
      createTimer(req, {
        uri: POST,
        rule: { ...RULE, effects: [{ action: 'limitReplies' }] },
        fit: composerTimerFit({ reply: true }),
      }),
    ).resolves.toEqual({ status: 'none', adjusted: null });
    expect(req.calls).toHaveLength(0);
  });

  it('strips list names, keeps the pin only when there is one, and caps the snippet', () => {
    const postedAt = '2026-09-01T12:00:00.000Z';
    const body = timerBody({
      uri: POST,
      extraUris: ['at://x/app.bsky.feed.post/2', null, ''],
      snippet: `  ${'word '.repeat(80)}  `,
      postedAt,
      rule: {
        enabled: true,
        lifespanSeconds: 7200,
        effects: [
          {
            action: 'limitReplies',
            allow: [
              { list: 'at://did:plc:a/app.bsky.graph.list/l1', name: 'Pals' },
            ],
          },
        ],
      },
      fit: FIT,
    });
    expect(body.effects).toEqual([
      {
        action: 'limitReplies',
        allow: [{ list: 'at://did:plc:a/app.bsky.graph.list/l1' }],
      },
    ]);
    expect(body).not.toHaveProperty('deleteAt');
    expect(body.extraUris).toEqual(['at://x/app.bsky.feed.post/2']);
    expect(body.snippet.length).toBeLessThanOrEqual(200);
    expect(body.snippet.endsWith('…')).toBe(true);
    expect(body.postedAt).toBe(postedAt);

    const pinned = timerBody({
      uri: POST,
      postedAt,
      rule: { ...RULE, deleteAt: '2026-09-01T17:00:00.000Z' },
      fit: FIT,
    });
    expect(pinned.deleteAt).toBe('2026-09-01T17:00:00.000Z');
    // The extend window is publish → pin, measured here, not on the server.
    expect(pinned.lifespanSeconds).toBe(5 * 3600);
  });
});

describe('isArmOutcomeUnknown', () => {
  it('counts a timeout, a dropped connection and a gateway that gave up as lost', () => {
    expect(isArmOutcomeUnknown(timeout())).toBe(true);
    expect(isArmOutcomeUnknown(offline())).toBe(true);
    expect(isArmOutcomeUnknown(refused(504))).toBe(true);
    expect(isArmOutcomeUnknown(refused(502))).toBe(true);
    expect(isArmOutcomeUnknown(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('counts an answer as an answer, and a request never sent as definite', () => {
    expect(isArmOutcomeUnknown(refused(400))).toBe(false);
    expect(isArmOutcomeUnknown(refused(503, 'UNAVAILABLE'))).toBe(false);
    expect(isArmOutcomeUnknown(refused(429, 'RATE_LIMITED'))).toBe(false);
    expect(
      isArmOutcomeUnknown(
        Object.assign(new Error('x'), { code: 'NEEDS_BACKEND' }),
      ),
    ).toBe(false);
    expect(isArmOutcomeUnknown(null)).toBe(false);
  });
});

describe('isDefiniteArmRefusal', () => {
  it('takes a 4xx about the request, or the feature being off, as a no', () => {
    expect(isDefiniteArmRefusal(refused(400))).toBe(true);
    expect(isDefiniteArmRefusal(refused(402, 'QUOTA_EXCEEDED'))).toBe(true);
    expect(isDefiniteArmRefusal(refused(503, 'UNAVAILABLE'))).toBe(true);
  });

  it('does not take a rate limit or a session refusal as an answer', () => {
    expect(isDefiniteArmRefusal(refused(429, 'RATE_LIMITED'))).toBe(false);
    expect(isDefiniteArmRefusal(refused(401))).toBe(false);
    expect(isDefiniteArmRefusal(refused(403))).toBe(false);
    expect(isDefiniteArmRefusal(refused(408))).toBe(false);
    expect(isDefiniteArmRefusal(null)).toBe(false);
  });
});

describe('createTimer and confirming a lost answer', () => {
  it('is armed when the server answers', async () => {
    const req = fakeRequester().answer('/api/self-destruct/create', {
      success: true,
      data: { id: 't1' },
    });
    await expect(
      createTimer(req, { uri: POST, rule: RULE, fit: FIT }),
    ).resolves.toEqual({ status: 'armed', row: { id: 't1' }, adjusted: null });
    expect(timerAvailability()).toBe('available');
  });

  it('fails at once on a refusal, without retrying or listing', async () => {
    const no = refused(400, null, 'a post has to stand for at least 5 minutes');
    const req = fakeRequester().answer('/api/self-destruct/create', no);
    const out = await createTimer(req, { uri: POST, rule: RULE, fit: FIT });
    expect(out).toEqual({ status: 'failed', error: no, adjusted: null });
    expect(req.calls).toHaveLength(1);
  });

  it('hands back a confirmation for a lost answer, armed when the retry answers', async () => {
    const req = fakeRequester().answer('/api/self-destruct/create', timeout(), {
      success: true,
      data: { id: 't1' },
    });
    const out = await createTimer(req, { uri: POST, rule: RULE, fit: FIT });
    expect(out.status).toBe('confirming');
    await expect(out.confirmation).resolves.toEqual({
      status: 'armed',
      row: { id: 't1' },
    });
    // The same post both times, which makes the retry safe.
    expect(req.calls.map((c) => c.body.postUri)).toEqual([POST, POST]);
  });

  it('finds the timer in the list when both attempts lose their answers', async () => {
    const req = fakeRequester()
      .answer('/api/self-destruct/create', timeout(), offline())
      .answer('/api/self-destruct/list', {
        success: true,
        data: [{ id: 't1', postUri: POST, status: 'armed' }],
      });
    const out = await createTimer(req, { uri: POST, rule: RULE, fit: FIT });
    const final = await out.confirmation;
    expect(final.status).toBe('armed');
    expect(final.row.id).toBe('t1');
  });

  it('fails on a definite refusal of the retry — the server read it and said no', async () => {
    const no = refused(400, null, 'a timer can run for at most 30 days');
    const req = fakeRequester().answer(
      '/api/self-destruct/create',
      timeout(),
      no,
    );
    const out = await createTimer(req, { uri: POST, rule: RULE, fit: FIT });
    await expect(out.confirmation).resolves.toEqual({
      status: 'failed',
      error: no,
    });
    expect(req.calls.some((c) => c.path.endsWith('/list'))).toBe(false);
  });

  it('asks the list after a rate limit on the retry', async () => {
    const req = fakeRequester()
      .answer(
        '/api/self-destruct/create',
        timeout(),
        refused(429, 'RATE_LIMITED'),
      )
      .answer('/api/self-destruct/list', {
        success: true,
        data: [{ id: 't1', postUri: POST, status: 'armed' }],
      });
    const out = await createTimer(req, { uri: POST, rule: RULE, fit: FIT });
    await expect(out.confirmation).resolves.toEqual(
      expect.objectContaining({ status: 'armed' }),
    );
  });

  it('cannot confirm when the list answers without the post — a page of timers proves nothing', async () => {
    const req = fakeRequester()
      .answer('/api/self-destruct/create', timeout(), offline())
      .answer('/api/self-destruct/list', {
        success: true,
        data: [
          {
            id: 'other',
            postUri: `at://${WRITER}/app.bsky.feed.post/3kother`,
            status: 'armed',
          },
          // A settled row for the same post is history, not this timer.
          { id: 'old', postUri: POST, status: 'cancelled' },
        ],
      });
    const out = await createTimer(req, { uri: POST, rule: RULE, fit: FIT });
    expect((await out.confirmation).status).toBe('unconfirmed');
  });

  it('never rejects, even when nothing answers at all', async () => {
    const req = fakeRequester()
      .answer('/api/self-destruct/create', new Error('anything'))
      .answer('/api/self-destruct/list', new Error('anything else'));
    const body = timerBody({ uri: POST, rule: RULE, fit: FIT });
    await expect(confirmArmAfterUnknown(req, body, timeout())).resolves.toEqual(
      expect.objectContaining({ status: 'unconfirmed' }),
    );
  });

  it('refuses before sending a pinned time that has already passed', async () => {
    const req = fakeRequester();
    const now = Date.parse('2026-09-01T12:00:00Z');
    const out = await createTimer(req, {
      uri: POST,
      rule: { ...RULE, deleteAt: '2026-09-01T11:00:00Z' },
      fit: FIT,
      now,
    });
    expect(out.status).toBe('failed');
    expect(out.error.code).toBe('TIMER_PROBLEM');
    expect(out.error.message).toMatch(/already passed/);
    expect(req.calls).toHaveLength(0);
  });

  it('marks the feature unavailable on the server’s explicit word', async () => {
    const req = fakeRequester().answer(
      '/api/self-destruct/create',
      refused(503, 'UNAVAILABLE'),
    );
    const out = await createTimer(req, { uri: POST, rule: RULE, fit: FIT });
    expect(out.status).toBe('failed');
    expect(timerAvailability()).toBe('unavailable');
  });
});

describe('only as the account that wrote the post', () => {
  it('reads the account off the post URI', () => {
    expect(timerDidForUri(POST)).toBe(WRITER);
    expect(timerDidForUri('not a uri')).toBeNull();
    expect(
      timerDidForUri('at://handle.example/app.bsky.feed.post/1'),
    ).toBeNull();
  });

  it('refuses a requester for another account, without sending', async () => {
    const req = fakeRequester('did:plc:other');
    const out = await createTimer(req, { uri: POST, rule: RULE, fit: FIT });
    expect(out.status).toBe('failed');
    expect(out.error.code).toBe('WRONG_ACCOUNT');
    expect(req.calls).toHaveLength(0);
  });

  it('says plainly when there is no requester (a browser-only account)', async () => {
    const out = await createTimer(null, { uri: POST, rule: RULE, fit: FIT });
    expect(out.status).toBe('failed');
    expect(out.error.code).toBe('NEEDS_BACKEND');
    await expect(listTimers(null)).rejects.toMatchObject({
      code: 'NEEDS_BACKEND',
    });
    await expect(cancelTimer(null, 't1')).rejects.toMatchObject({
      code: 'NEEDS_BACKEND',
    });
  });
});

describe('armAfterPublish', () => {
  const THREAD = {
    posts: [
      { uri: POST, cid: 'c0' },
      { uri: `at://${WRITER}/app.bsky.feed.post/3kb`, cid: 'c1' },
      { uri: `at://${WRITER}/app.bsky.feed.post/3kc`, cid: 'c2' },
    ],
    root: { uri: POST, cid: 'c0' },
  };

  it('puts the timer on the root and takes the rest of the thread with it', async () => {
    const req = fakeRequester().answer('/api/self-destruct/create', {
      success: true,
      data: { id: 't1' },
    });
    const out = await armAfterPublish(req, THREAD, RULE, {
      snippet: 'hello',
      fit: FIT,
    });
    expect(out.status).toBe('armed');
    const { body } = req.calls[0];
    expect(body.postUri).toBe(POST);
    expect(body.postCid).toBe('c0');
    expect(body.extraUris).toEqual([
      `at://${WRITER}/app.bsky.feed.post/3kb`,
      `at://${WRITER}/app.bsky.feed.post/3kc`,
    ]);
    expect(body.snippet).toBe('hello');
  });

  it('waits through a lost answer, saying when it starts', async () => {
    const onConfirming = vi.fn();
    const req = fakeRequester()
      .answer('/api/self-destruct/create', timeout(), offline())
      .answer('/api/self-destruct/list', {
        success: true,
        data: [{ id: 't1', postUri: POST, status: 'armed' }],
      });
    const out = await armAfterPublish(req, THREAD, RULE, {
      fit: FIT,
      onConfirming,
    });
    expect(onConfirming).toHaveBeenCalledTimes(1);
    expect(out.status).toBe('armed');
    expect(out.row.id).toBe('t1');
  });

  it('turns a pin that passed while the post went out into the five-minute floor, and says so', async () => {
    const now = Date.parse('2026-09-01T12:00:00Z');
    const req = fakeRequester().answer('/api/self-destruct/create', {
      success: true,
      data: { id: 't1' },
    });
    const out = await armAfterPublish(
      req,
      THREAD,
      { ...RULE, deleteAt: '2026-09-01T11:59:30Z' },
      { fit: FIT, now, postedAt: new Date(now).toISOString() },
    );
    expect(out.status).toBe('armed');
    expect(out.adjusted).toBe('floor');
    expect(out.note).toMatch(/comes down in 5 minutes/);
    expect(req.calls[0].body.lifespanSeconds).toBe(300);
    expect(req.calls[0].body).not.toHaveProperty('deleteAt');
  });

  it('never rejects, whatever it is handed', async () => {
    await expect(armAfterPublish(null, null, RULE)).resolves.toEqual(
      expect.objectContaining({ status: 'failed' }),
    );
    const req = { did: WRITER, request: () => Promise.reject(refused(500)) };
    await expect(
      armAfterPublish(req, THREAD, RULE, { fit: FIT }),
    ).resolves.toEqual(expect.objectContaining({ status: 'failed' }));
  });

  it('does nothing for no timer', async () => {
    const req = fakeRequester();
    const out = await armAfterPublish(
      req,
      THREAD,
      { enabled: false },
      { fit: FIT },
    );
    expect(out.status).toBe('none');
    expect(req.calls).toHaveLength(0);
  });
});

describe('listing timers', () => {
  it('passes "unavailable" through instead of reading it as an empty list', async () => {
    const req = fakeRequester().answer('/api/self-destruct/list', {
      success: true,
      data: [],
      unavailable: true,
    });
    await expect(listTimers(req)).resolves.toEqual({
      rows: [],
      unavailable: true,
    });
    expect(timerAvailability()).toBe('unavailable');
  });

  it("reads the server's explicit 503 UNAVAILABLE as unavailable", async () => {
    const req = fakeRequester().answer(
      '/api/self-destruct/list',
      refused(503, 'UNAVAILABLE'),
    );
    await expect(listTimers(req)).resolves.toEqual({
      rows: [],
      unavailable: true,
    });
    expect(timerAvailability()).toBe('unavailable');
  });

  it("does not read a 404 or 405 as unavailable — only the server's own word does", async () => {
    const req = fakeRequester().answer(
      '/api/self-destruct/list',
      refused(404),
      refused(405),
    );
    await expect(listTimers(req)).rejects.toThrow();
    await expect(listTimers(req)).rejects.toThrow();
    expect(timerAvailability()).toBe('unknown');
    expect(isTimersUnsupported(refused(404))).toBe(true);
  });

  it('asks for history with ?history=1', async () => {
    const rows = [{ id: 't1', status: 'deleted' }];
    const req = fakeRequester().answer('/api/self-destruct/list', {
      success: true,
      data: rows,
    });
    await expect(listTimers(req, { history: true })).resolves.toEqual({
      rows,
      unavailable: false,
    });
    expect(req.calls[0].query).toEqual({ history: '1' });
    expect(timerAvailability()).toBe('available');
  });

  it('counts live timers and works out slots in use', async () => {
    expect(
      countLiveTimers([
        { status: 'armed' },
        { status: 'checking' },
        { status: 'deleted' },
      ]),
    ).toBe(2);
    const req = fakeRequester().answer('/api/self-destruct/list', {
      success: true,
      data: [{ id: 't1', status: 'armed', conditions: {}, effects: null }],
    });
    const usage = await loadTimerUsage(req, {
      scheduledRows: [
        {
          id: 's1',
          status: 'pending',
          payload: {
            selfDestruct: {
              lifespanSeconds: 3600,
              conditions: { clauses: [{ metric: 'likes', value: 2 }] },
            },
          },
        },
      ],
    });
    expect(usage).toEqual({ plain: 1, conditional: 1 });
    const broken = fakeRequester().answer(
      '/api/self-destruct/list',
      refused(500),
    );
    await expect(loadTimerUsage(broken)).resolves.toBeNull();
  });
});

describe('the availability probe', () => {
  it('asks once per page, however many composers open', async () => {
    const req = fakeRequester().answer('/api/self-destruct/list', {
      success: true,
      data: [],
      unavailable: true,
    });
    const answers = await Promise.all([
      probeTimerAvailability(req),
      probeTimerAvailability(req),
    ]);
    expect(answers).toEqual(['unavailable', 'unavailable']);
    await expect(probeTimerAvailability(req)).resolves.toBe('unavailable');
    expect(req.calls).toHaveLength(1);
  });

  it('treats a failed network as unknown — still offered — and does not ask again', async () => {
    const req = fakeRequester().answer('/api/self-destruct/list', offline());
    await expect(probeTimerAvailability(req)).resolves.toBe('unknown');
    await expect(probeTimerAvailability(req)).resolves.toBe('unknown');
    expect(req.calls).toHaveLength(1);
  });

  it('does not ask without a requester, and asks once one is there', async () => {
    await expect(probeTimerAvailability(null)).resolves.toBe('unknown');
    const req = fakeRequester().answer('/api/self-destruct/list', {
      success: true,
      data: [],
    });
    await expect(probeTimerAvailability(req)).resolves.toBe('available');
  });

  it('changes only on the explicit code', () => {
    expect(markTimersUnavailable(refused(404))).toBe(false);
    expect(markTimersUnavailable(new TypeError('Failed to fetch'))).toBe(false);
    expect(timerAvailability()).toBe('unknown');
    expect(markTimersUnavailable(refused(503, 'UNAVAILABLE'))).toBe(true);
    expect(timerAvailability()).toBe('unavailable');
  });
});

describe('telling the page', () => {
  let heard;
  let original;
  beforeEach(() => {
    original = globalThis.window;
    globalThis.window = new EventTarget();
    heard = [];
    globalThis.window.addEventListener('virga:timers-changed', (e) =>
      heard.push(e.detail),
    );
  });
  afterEach(() => {
    globalThis.window = original;
  });

  it('dispatches virga:timers-changed for the account after an arm and a cancel', async () => {
    const req = fakeRequester()
      .answer('/api/self-destruct/create', {
        success: true,
        data: { id: 't1' },
      })
      .answer('/api/self-destruct/cancel', {
        success: true,
        data: { id: 't1', status: 'cancelled' },
      });
    await createTimer(req, { uri: POST, rule: RULE, fit: FIT });
    await expect(cancelTimer(req, 't1')).resolves.toEqual({
      id: 't1',
      status: 'cancelled',
    });
    expect(req.calls[1]).toMatchObject({
      method: 'POST',
      body: { id: 't1' },
    });
    expect(heard).toEqual([
      { did: WRITER, change: 'armed', postUri: POST, id: 't1' },
      { did: WRITER, change: 'cancelled', id: 't1' },
    ]);
  });

  it('says nothing after a refusal', async () => {
    const req = fakeRequester().answer(
      '/api/self-destruct/create',
      refused(400),
    );
    await createTimer(req, { uri: POST, rule: RULE, fit: FIT });
    expect(heard).toEqual([]);
  });
});

describe('helpers for the timers page', () => {
  it('links a live post to bsky.app, and a deleted one nowhere', () => {
    expect(timerPostUrl({ postUri: POST, status: 'armed' })).toBe(
      `https://bsky.app/profile/${encodeURIComponent(WRITER)}/post/3kpost`,
    );
    expect(timerPostUrl({ postUri: POST, status: 'deleted' })).toBeNull();
    expect(timerPostUrl({})).toBeNull();
  });

  it('makes a snippet of a post', () => {
    expect(timerSnippet('  a\n\nb  ')).toBe('a b');
    expect(timerSnippet('')).toBeUndefined();
  });
});
