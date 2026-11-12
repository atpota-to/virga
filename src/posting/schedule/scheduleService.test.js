/*
 * The scheduling transport over a Requester. Held here: each call's path,
 * method and body; the list split into the queue and timer notes, times read
 * as instants; the reorder's fallback to row-by-row writes only when the
 * endpoint is missing; QUOTA_EXCEEDED read by code whatever its status; the
 * limits read into one shape; and the event after every write.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  acknowledgeTimerNote,
  canCancelScheduledRow,
  canEditScheduledRow,
  cancelScheduled,
  countActiveScheduled,
  createScheduled,
  getLimits,
  getScheduled,
  getScheduledMedia,
  isReorderUnsupported,
  isTimerNoteRow,
  listScheduled,
  normalizeLimits,
  reorderScheduled,
  retryScheduled,
  scheduledRoomProblem,
  scheduledUsageLine,
  updateScheduled,
} from './scheduleService.js';

const DID = 'did:plc:writer';

function fakeRequester(did = DID) {
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

const refused = (status, code = null, extra = {}) =>
  Object.assign(new Error('no'), {
    status,
    code,
    detail: 'no',
    payload: { success: false, code, ...extra },
  });

let heard;
let originalWindow;
beforeEach(() => {
  originalWindow = globalThis.window;
  globalThis.window = new EventTarget();
  heard = [];
  globalThis.window.addEventListener('virga:scheduled-changed', (e) =>
    heard.push(e.detail),
  );
});
afterEach(() => {
  globalThis.window = originalWindow;
});

describe('listScheduled', () => {
  it('splits the queue from the timer notes, and reads times as instants', async () => {
    const req = fakeRequester().answer('/api/schedule/list', {
      success: true,
      data: [
        { id: 'a', status: 'pending', scheduledFor: '2026-11-13 09:00:00+00' },
        {
          id: 'b',
          status: 'failed',
          scheduledFor: '2026-11-12T09:00:00+00:00',
        },
        {
          id: 'n',
          status: 'published',
          lastErrorCode: 'TIMER_NOT_ARMED',
          scheduledFor: '2026-11-10T09:00:00+00:00',
        },
      ],
    });
    const out = await listScheduled(req);
    expect(out.rows.map((r) => r.id)).toEqual(['a', 'b']);
    expect(out.rows[0].scheduledFor).toBe('2026-11-13T09:00:00.000Z');
    expect(out.timerNotes.map((r) => r.id)).toEqual(['n']);
    expect(out).not.toHaveProperty('unavailable');
    expect(req.calls[0]).toMatchObject({ path: '/api/schedule/list' });
  });

  it('says so when cocoon has no scheduling, rather than reading it as empty', async () => {
    const req = fakeRequester()
      .answer('/api/schedule/list', refused(404, 'UNAVAILABLE'))
      .answer('/api/schedule/list', {
        success: true,
        data: [],
        unavailable: true,
      });
    await expect(listScheduled(req)).resolves.toEqual({
      rows: [],
      timerNotes: [],
      unavailable: true,
    });
    await expect(listScheduled(req)).resolves.toEqual({
      rows: [],
      timerNotes: [],
      unavailable: true,
    });
  });

  it('throws a real failure, and refuses without a requester', async () => {
    const req = fakeRequester().answer(
      '/api/schedule/list',
      refused(500, 'INTERNAL'),
    );
    await expect(listScheduled(req)).rejects.toMatchObject({
      code: 'INTERNAL',
    });
    await expect(listScheduled(null)).rejects.toMatchObject({
      code: 'NEEDS_BACKEND',
    });
  });
});

describe('reading one row', () => {
  it('gets a row and its media by id', async () => {
    const req = fakeRequester()
      .answer('/api/schedule/get', {
        success: true,
        data: { id: 'a', scheduledFor: '2026-11-13T09:00:00+00:00' },
      })
      .answer('/api/schedule/media', {
        success: true,
        data: { 'p0-img0': { base64: 'AAAA', encoding: 'image/png' } },
      })
      .answer('/api/schedule/media', { success: true });
    await expect(getScheduled(req, 'a')).resolves.toEqual({
      id: 'a',
      scheduledFor: '2026-11-13T09:00:00.000Z',
    });
    await expect(getScheduledMedia(req, 'a')).resolves.toEqual({
      'p0-img0': { base64: 'AAAA', encoding: 'image/png' },
    });
    await expect(getScheduledMedia(req, 'a')).resolves.toEqual({});
    expect(req.calls.map((c) => [c.path, c.query])).toEqual([
      ['/api/schedule/get', { id: 'a' }],
      ['/api/schedule/media', { id: 'a' }],
      ['/api/schedule/media', { id: 'a' }],
    ]);
  });
});

describe('writes', () => {
  const body = {
    scheduledFor: '2026-11-13T09:00:00.000Z',
    target: 'bluesky',
    queued: false,
    payload: {
      posts: [{ record: { text: 'hi' } }],
      gates: { threadgate: null, postgate: null },
      mediaBytes: {},
      selfDestruct: null,
    },
  };

  it('creates with the body as given, and tells the page', async () => {
    const req = fakeRequester().answer('/api/schedule/create', {
      success: true,
      data: { id: 'new', scheduledFor: '2026-11-13 09:00:00+00' },
    });
    const row = await createScheduled(req, body);
    expect(row).toEqual({
      id: 'new',
      scheduledFor: '2026-11-13T09:00:00.000Z',
    });
    expect(req.calls[0]).toMatchObject({ method: 'POST', body });
    expect(heard).toEqual([{ did: DID, change: 'created', id: 'new' }]);
  });

  it('passes a quota refusal through by code, whatever its status', async () => {
    for (const status of [402, 409]) {
      const req = fakeRequester().answer(
        '/api/schedule/create',
        refused(status, 'QUOTA_EXCEEDED', {
          feature: 'scheduledPosts',
          limit: 3,
        }),
      );
      await expect(createScheduled(req, body)).rejects.toMatchObject({
        code: 'QUOTA_EXCEEDED',
        payload: { feature: 'scheduledPosts' },
      });
    }
    expect(heard).toEqual([]);
  });

  it('sends each kind of update in cocoon’s shape', async () => {
    const ok = { success: true, data: { id: 'a' } };
    const req = fakeRequester().answer('/api/schedule/update', ok, ok, ok, ok);
    await updateScheduled(req, 'a', {
      scheduledFor: new Date('2026-11-14T09:00:00Z'),
    });
    await updateScheduled(req, 'a', body);
    await retryScheduled(req, 'a');
    await acknowledgeTimerNote(req, 'a');
    expect(req.calls.map((c) => c.body)).toEqual([
      { id: 'a', scheduledFor: '2026-11-14T09:00:00.000Z' },
      { ...body, id: 'a' },
      { id: 'a', retry: true },
      { id: 'a', acknowledgeTimer: true },
    ]);
    expect(heard.map((h) => h.change)).toEqual([
      'moved',
      'edited',
      'retried',
      'acknowledged',
    ]);
  });

  it('cancels by id', async () => {
    const req = fakeRequester().answer('/api/schedule/cancel', {
      success: true,
      data: { id: 'a', status: 'cancelled' },
    });
    await expect(cancelScheduled(req, 'a')).resolves.toEqual({
      id: 'a',
      status: 'cancelled',
    });
    expect(req.calls[0]).toMatchObject({ method: 'POST', body: { id: 'a' } });
    expect(heard).toEqual([{ did: DID, change: 'cancelled', id: 'a' }]);
  });
});

describe('reorderScheduled', () => {
  const moves = [
    { id: 'a', scheduledFor: '2026-11-14T09:00:00+00:00' },
    { id: 'b', scheduledFor: new Date('2026-11-13T09:00:00Z') },
  ];

  it('moves everything in one request', async () => {
    const req = fakeRequester().answer('/api/schedule/reorder', {
      success: true,
      moved: 2,
    });
    await expect(reorderScheduled(req, moves)).resolves.toEqual({
      moved: 2,
      fallback: false,
      failed: [],
      refusal: null,
    });
    expect(req.calls[0].body).toEqual({
      moves: [
        { id: 'a', scheduledFor: '2026-11-14T09:00:00.000Z' },
        { id: 'b', scheduledFor: '2026-11-13T09:00:00.000Z' },
      ],
    });
    expect(heard).toEqual([{ did: DID, change: 'reordered', ids: ['a', 'b'] }]);
  });

  it('throws a refusal: nothing was written', async () => {
    const req = fakeRequester().answer(
      '/api/schedule/reorder',
      refused(409, 'NOT_REORDERABLE'),
    );
    await expect(reorderScheduled(req, moves)).rejects.toMatchObject({
      code: 'NOT_REORDERABLE',
    });
    expect(req.calls).toHaveLength(1);
    expect(heard).toEqual([]);
  });

  it('falls back to one write per row where the endpoint is missing, carrying on past refusals', async () => {
    const notCancelable = refused(409, 'NOT_RESCHEDULABLE');
    const req = fakeRequester()
      .answer('/api/schedule/reorder', refused(404, 'UNAVAILABLE'))
      .answer('/api/schedule/update', notCancelable, {
        success: true,
        data: {},
      });
    const out = await reorderScheduled(req, moves);
    expect(out.fallback).toBe(true);
    expect(out.moved).toBe(1);
    expect(out.failed).toEqual([{ id: 'a', error: notCancelable }]);
    expect(out.refusal).toBe(notCancelable);
    expect(req.calls.slice(1).map((c) => c.body)).toEqual([
      { id: 'a', scheduledFor: '2026-11-14T09:00:00.000Z' },
      { id: 'b', scheduledFor: '2026-11-13T09:00:00.000Z' },
    ]);
    expect(heard).toEqual([{ did: DID, change: 'reordered', ids: ['b'] }]);
  });

  it('goes straight to row-by-row past cocoon’s limit of moves', async () => {
    const many = Array.from({ length: 51 }, (_, i) => ({
      id: `r${i}`,
      scheduledFor: '2026-11-14T09:00:00Z',
    }));
    const req = fakeRequester().answer(
      '/api/schedule/update',
      ...many.map(() => ({ success: true })),
    );
    const out = await reorderScheduled(req, many);
    expect(out).toMatchObject({ moved: 51, fallback: true, failed: [] });
    expect(req.calls.every((c) => c.path === '/api/schedule/update')).toBe(
      true,
    );
  });

  it('does nothing for no moves', async () => {
    const req = fakeRequester();
    await expect(reorderScheduled(req, [null, { id: 'x' }])).resolves.toEqual({
      moved: 0,
      fallback: false,
      failed: [],
      refusal: null,
    });
    expect(req.calls).toHaveLength(0);
  });

  it('knows which failures mean "no endpoint"', () => {
    expect(isReorderUnsupported(refused(404))).toBe(true);
    expect(isReorderUnsupported(refused(405))).toBe(true);
    expect(isReorderUnsupported({ reorderUnsupported: true })).toBe(true);
    expect(isReorderUnsupported(refused(409, 'NOT_REORDERABLE'))).toBe(false);
    expect(isReorderUnsupported(null)).toBe(false);
  });
});

describe('reading rows', () => {
  it('counts what holds a scheduled slot', () => {
    expect(
      countActiveScheduled([
        { status: 'pending' },
        { status: 'publishing' },
        { status: 'failed' },
        { status: 'published' },
      ]),
    ).toBe(2);
  });

  it('knows a timer note from a published post', () => {
    expect(
      isTimerNoteRow({ status: 'published', lastErrorCode: 'TIMER_NOT_ARMED' }),
    ).toBe(true);
    expect(isTimerNoteRow({ status: 'published' })).toBe(false);
    expect(
      isTimerNoteRow({ status: 'failed', lastErrorCode: 'TIMER_NOT_ARMED' }),
    ).toBe(false);
  });

  it('edits only Virga’s own rows that are still waiting or failed, and cancels any', () => {
    const virga = { clientKey: 'virga', status: 'pending' };
    expect(canEditScheduledRow(virga)).toBe(true);
    expect(canEditScheduledRow({ ...virga, status: 'failed' })).toBe(true);
    expect(canEditScheduledRow({ ...virga, partial: true })).toBe(false);
    expect(canEditScheduledRow({ ...virga, status: 'publishing' })).toBe(false);
    expect(canEditScheduledRow({ ...virga, clientKey: 'anisota' })).toBe(false);
    expect(canEditScheduledRow({ status: 'pending' })).toBe(false);
    expect(
      canCancelScheduledRow({ clientKey: 'anisota', status: 'pending' }),
    ).toBe(true);
    expect(canCancelScheduledRow({ status: 'publishing' })).toBe(false);
  });
});

describe('limits', () => {
  const body = {
    success: true,
    tier: 'caterpillar',
    isMember: false,
    policy: 'membership',
    features: {
      scheduledPosts: { isUnlimited: false, limit: 3, freeLimit: 3 },
      postTimers: { isUnlimited: false, limit: 1 },
      conditionalTimers: { isUnlimited: true, limit: null },
      postLists: { isUnlimited: false, limit: 3 },
    },
    usage: { scheduledPosts: 2, postTimers: 1 },
  };

  it('reads /api/limits/status into one shape', async () => {
    const req = fakeRequester().answer('/api/limits/status', body);
    const limits = await getLimits(req);
    expect(limits).toEqual({
      policy: 'membership',
      isMember: false,
      features: {
        scheduledPosts: { limit: 3 },
        postTimers: { limit: 1 },
        conditionalTimers: { limit: null },
      },
      usage: { scheduledPosts: 2, postTimers: 1, conditionalTimers: null },
      caps: { scheduledPosts: null, timers: null },
    });
    expect(req.calls[0].path).toBe('/api/limits/status');
  });

  it('reads the flat ceilings cocoon reports beside the policy', () => {
    const limits = normalizeLimits({
      policy: 'flat',
      features: { scheduledPosts: { isUnlimited: true, limit: null } },
      caps: { scheduledPosts: 50, timers: 200 },
    });
    expect(limits.caps).toEqual({ scheduledPosts: 50, timers: 200 });
    expect(limits.features.scheduledPosts.limit).toBeNull();
    expect(normalizeLimits({ caps: { scheduledPosts: 'x' } }).caps).toEqual({
      scheduledPosts: null,
      timers: null,
    });
  });

  it('reads an older cocoon with no policy or usage as limits without counts', () => {
    const limits = normalizeLimits({
      features: { scheduledPosts: { limit: 3 } },
    });
    expect(limits.policy).toBeNull();
    expect(limits.usage.scheduledPosts).toBeNull();
    expect(scheduledRoomProblem(limits)).toBe('');
    expect(scheduledUsageLine(limits)).toBe('');
  });

  it('says when the scheduled posts are all in use, but not for an edit', () => {
    const full = normalizeLimits({ ...body, usage: { scheduledPosts: 3 } });
    expect(scheduledRoomProblem(full)).toBe(
      'This account can keep 3 scheduled posts at a time, and they’re all in use. Limits are shared with Anisota.',
    );
    expect(scheduledRoomProblem(full, { editing: true })).toBe('');
    expect(scheduledRoomProblem(normalizeLimits(body))).toBe('');
    expect(scheduledRoomProblem(null)).toBe('');
  });

  it('states the usage plainly', () => {
    expect(scheduledUsageLine(normalizeLimits(body))).toBe(
      '2 of 3 scheduled posts in use',
    );
    expect(
      scheduledUsageLine(
        normalizeLimits({ ...body, usage: { scheduledPosts: 5 } }),
      ),
    ).toBe('3 of 3 scheduled posts in use');
  });
});
