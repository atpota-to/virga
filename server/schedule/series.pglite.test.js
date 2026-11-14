// Repeating scheduled posts over a real Postgres (PGlite): the migration's
// settle function and the store around it. What has to hold: the next
// occurrence is written with the status that ends this one or not at all, a
// second run writes no second copy, a series never ends up with nothing
// waiting, the images last as long as the series and no longer, and a series
// holds one slot of the account's cap.

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import { createTestDatabase } from '../test/pglite.js';
import {
  setSupabaseClientForTests,
  resetSupabaseClientForTests,
} from '../supabase.js';
import * as scheduled from './scheduledPosts.js';
import { nextOccurrence } from './recurrence.js';
import {
  DID,
  OTHER_DID,
  MINUTE,
  HOUR,
  DAY,
  iso,
  PNG_BASE64,
} from './testing/fixtures.js';

const SERIES = '11111111-1111-4111-8111-111111111111';
const BUCKET = 'scheduled-media';

let t;
beforeAll(async () => {
  t = await createTestDatabase({ upTo: '20261114000100' });
});
afterAll(async () => {
  await t?.close();
});
beforeEach(async () => {
  await t.exec('TRUNCATE scheduled_posts');
  t.supabase.storage.reset();
  setSupabaseClientForTests(t.supabase);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  resetSupabaseClientForTests();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A daily rule in UTC whose occurrence `n` is at `at` (ms). */
function dailyRule(at, n = 1, extra = {}) {
  const d = new Date(at);
  const pad = (v) => String(v).padStart(2, '0');
  return {
    every: 'day',
    tz: 'UTC',
    until: null,
    count: null,
    anchor: {
      date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
      time: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
      occurrence: n,
    },
    ...extra,
  };
}

/** A whole minute, so a rule anchored at it reads back the same instant. */
const minute = (ms) => Math.floor(ms / MINUTE) * MINUTE;

/**
 * Insert a row directly. With `repeat` (true, or rule fields) it is the
 * carrier of SERIES at `occurrence`, repeating daily from its own time.
 */
async function insertRow(fields = {}) {
  const at = minute(fields.at ?? Date.now() - MINUTE);
  const occurrence = fields.occurrence ?? (fields.repeat || fields.series_id ? 1 : null);
  const repeat = fields.repeat
    ? dailyRule(at, occurrence, fields.repeat === true ? {} : fields.repeat)
    : null;
  const row = {
    user_did: DID,
    status: 'publishing',
    progress: [],
    attempts: 1,
    ...fields,
    payload: {
      posts: [{ record: { text: 'every day' } }],
      gates: { threadgate: null, postgate: null },
      media: {},
      rkeys: ['3kaaaaaaaaaa2'],
      tz: 'UTC',
      selfDestruct: null,
      ...(repeat ? { repeat } : {}),
      ...(fields.payload || {}),
    },
  };
  const seriesId = fields.series_id ?? (repeat ? SERIES : null);
  const { rows } = await t.query(
    `INSERT INTO scheduled_posts (user_did, scheduled_for, status, payload, progress, attempts, series_id, occurrence,
                                  last_error, last_error_code, updated_at, created_at, media_reclaimed_at)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10, COALESCE($11, NOW()), COALESCE($12, NOW()), $13)
     RETURNING *`,
    [
      row.user_did,
      iso(at),
      row.status,
      JSON.stringify(row.payload),
      JSON.stringify(row.progress),
      row.attempts,
      seriesId,
      seriesId ? occurrence : null,
      row.last_error ?? null,
      row.last_error_code ?? null,
      row.updated_at ?? null,
      row.created_at ?? null,
      row.media_reclaimed_at ?? null,
    ],
  );
  return rows[0];
}

const readRow = async (id) =>
  (await t.query('SELECT * FROM scheduled_posts WHERE id = $1', [id])).rows[0];
const seriesRows = async (seriesId = SERIES) =>
  (
    await t.query(
      'SELECT * FROM scheduled_posts WHERE series_id = $1 ORDER BY occurrence',
      [seriesId],
    )
  ).rows;
const stored = (path) => t.supabase.storage.read(BUCKET, path);

/** Stash one image under a row and name it in the row's payload. */
async function giveImage(row, mediaId = 'p0-img0', subdir = '') {
  const path = await scheduled.storeMedia(
    row.id,
    mediaId,
    PNG_BASE64,
    'image/png',
    subdir,
  );
  const fresh = await readRow(row.id);
  const updated = await scheduled.updatePayload(row.id, {
    ...fresh.payload,
    posts: [
      {
        record: { text: 'with a picture' },
        embed: { type: 'images', images: [{ mediaId, alt: '' }] },
      },
    ],
    media: {
      ...fresh.payload.media,
      [mediaId]: { storagePath: path, encoding: 'image/png' },
    },
  });
  return { path, row: { ...updated, scheduled_for: fresh.scheduled_for } };
}

const settle = (params) =>
  t.supabase.rpc('settle_scheduled_occurrence', {
    p_fields: {},
    p_next: null,
    p_user_did: null,
    p_only_pending: false,
    ...params,
  });

const REF = { uri: `at://${DID}/app.bsky.feed.post/3kaaaaaaaaaa2`, cid: 'bafyone' };

describe('the migration', () => {
  it('adds the series columns, both or neither, counting from one', async () => {
    const plain = await insertRow();
    expect(plain).toMatchObject({ series_id: null, occurrence: null });
    for (const [series, occurrence] of [
      [SERIES, null],
      [null, 2],
      [SERIES, 0],
    ]) {
      await expect(
        t.query(
          `INSERT INTO scheduled_posts (user_did, scheduled_for, payload, series_id, occurrence) VALUES ('d', NOW(), '{}', $1, $2)`,
          [series, occurrence],
        ),
      ).rejects.toThrow(/scheduled_posts_series_shape/);
    }
  });

  it('holds one row per occurrence of a series', async () => {
    await insertRow({ series_id: SERIES, occurrence: 2 });
    await expect(
      insertRow({ series_id: SERIES, occurrence: 2 }),
    ).rejects.toThrow(/scheduled_posts_series_occurrence_idx/);
    // Another series, and rows with no series, are nobody's business.
    await insertRow({ series_id: '22222222-2222-4222-8222-222222222222', occurrence: 2 });
    await insertRow();
    await insertRow();
  });

  it('starts a series from the capped create, and none for a plain post', async () => {
    const first = await scheduled.createScheduledPost({
      userDid: DID,
      scheduledFor: iso(Date.now() + HOUR),
      payload: { posts: [], repeat: dailyRule(Date.now() + HOUR) },
    });
    expect(first.series_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.occurrence).toBe(1);
    const plain = await scheduled.createScheduledPost({
      userDid: DID,
      scheduledFor: iso(Date.now() + HOUR),
      payload: { posts: [] },
    });
    expect(plain).toMatchObject({ series_id: null, occurrence: null });
  });
});

describe('settle_scheduled_occurrence', () => {
  const next = (at, occurrence = 2, payload = { rkeys: ['3knext0000002'] }) => ({
    scheduledFor: iso(at),
    occurrence,
    payload,
  });

  it('marks the row published and writes the next occurrence in the same call', async () => {
    const row = await insertRow({ repeat: true, status: 'publishing' });
    const at = Date.now() + DAY;
    const { data, error } = await settle({
      p_id: row.id,
      p_status: 'published',
      p_fields: { result_uri: REF.uri, result_cid: REF.cid, last_error: null, last_error_code: null },
      p_next: next(at),
    });
    expect(error).toBeNull();
    expect(data.ok).toBe(true);

    const [first, second] = await seriesRows();
    expect(first).toMatchObject({
      id: row.id,
      status: 'published',
      result_uri: REF.uri,
      result_cid: REF.cid,
      locked_at: null,
      occurrence: 1,
    });
    // The rule has moved on with the series.
    expect(first.payload).not.toHaveProperty('repeat');
    expect(second).toMatchObject({
      id: data.next.id,
      user_did: DID,
      status: 'pending',
      queued: false,
      target: 'bluesky',
      series_id: SERIES,
      occurrence: 2,
      attempts: 0,
      progress: [],
      result_uri: null,
      media_reclaimed_at: null,
    });
    expect(new Date(second.scheduled_for).getTime()).toBe(at);
    // The same post, with the keys minted for its own time.
    expect(second.payload).toEqual({
      ...row.payload,
      rkeys: ['3knext0000002'],
    });
  });

  it('writes nothing more when the same row is settled again', async () => {
    const row = await insertRow({ repeat: true });
    const call = () =>
      settle({ p_id: row.id, p_status: 'published', p_next: next(Date.now() + DAY) });
    expect((await call()).data.next).not.toBeNull();
    // A second run that also finished this row: nothing left to carry forward.
    expect((await call()).data).toEqual({ ok: true, next: null });
    expect(await seriesRows()).toHaveLength(2);
  });

  it('writes one next occurrence when two settles race', async () => {
    const row = await insertRow({ repeat: true });
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        settle({ p_id: row.id, p_status: 'published', p_next: next(Date.now() + DAY) }),
      ),
    );
    expect(results.filter((r) => r.data?.next)).toHaveLength(1);
    expect(await seriesRows()).toHaveLength(2);
  });

  it('leaves an occurrence number that is already taken alone', async () => {
    const row = await insertRow({ repeat: true });
    const taken = await insertRow({
      series_id: SERIES,
      occurrence: 2,
      status: 'pending',
      payload: { posts: [{ record: { text: 'already here' } }] },
    });
    const { data } = await settle({
      p_id: row.id,
      p_status: 'published',
      p_next: next(Date.now() + DAY),
    });
    expect(data).toEqual({ ok: true, next: null });
    const rows = await seriesRows();
    expect(rows.map((r) => r.id)).toEqual([row.id, taken.id]);
    expect(rows[1].payload.posts[0].record.text).toBe('already here');
  });

  it('rolls the status change back when the next occurrence can’t be written', async () => {
    const row = await insertRow({ repeat: true, status: 'publishing' });
    const { data, error } = await settle({
      p_id: row.id,
      p_status: 'published',
      p_fields: { result_uri: REF.uri },
      p_next: { scheduledFor: 'not a time', occurrence: 2 },
    });
    expect(data).toBeNull();
    expect(error).toBeTruthy();
    // Still claimed, still carrying the rule: the stuck-row reclaim hands it
    // to the next run, which settles it again. Never published with no next.
    expect(await readRow(row.id)).toMatchObject({
      status: 'publishing',
      result_uri: null,
    });
    expect((await readRow(row.id)).payload.repeat).toBeTruthy();
    expect(await seriesRows()).toHaveLength(1);
  });

  it('writes no next without a rule, a series or a plan', async () => {
    const stopped = await insertRow({ series_id: SERIES, occurrence: 3 });
    const plain = await insertRow();
    const over = await insertRow({
      repeat: true,
      series_id: '22222222-2222-4222-8222-222222222222',
    });
    for (const [row, p_next] of [
      [stopped, next(Date.now() + DAY, 4)],
      [plain, next(Date.now() + DAY)],
      [over, null],
    ]) {
      const { data } = await settle({ p_id: row.id, p_status: 'published', p_next });
      expect(data).toEqual({ ok: true, next: null });
      expect((await readRow(row.id)).status).toBe('published');
    }
    const { rows } = await t.query('SELECT COUNT(*)::int AS n FROM scheduled_posts');
    expect(rows[0].n).toBe(3);
    // A series that is over keeps its rule on its last row.
    expect((await readRow(over.id)).payload.repeat).toBeTruthy();
  });

  it('writes only the bookkeeping it is given: an absent key is left, a null clears', async () => {
    const row = await insertRow({
      last_error: 'earlier trouble',
      last_error_code: 'RATE_LIMITED',
    });
    await settle({ p_id: row.id, p_status: 'failed', p_fields: { last_error: 'gave up' } });
    expect(await readRow(row.id)).toMatchObject({
      status: 'failed',
      last_error: 'gave up',
      last_error_code: 'RATE_LIMITED',
    });
    await settle({
      p_id: row.id,
      p_status: 'published',
      p_fields: { result_uri: REF.uri, last_error: null, last_error_code: null },
    });
    expect(await readRow(row.id)).toMatchObject({
      status: 'published',
      result_uri: REF.uri,
      last_error: null,
      last_error_code: null,
    });
  });

  it('refuses a skip of a row that isn’t waiting, or isn’t the account’s', async () => {
    const publishing = await insertRow({ repeat: true, status: 'publishing' });
    const partial = await insertRow({
      repeat: true,
      series_id: '22222222-2222-4222-8222-222222222222',
      status: 'pending',
      progress: [REF],
    });
    const skip = (row, did = DID) =>
      settle({
        p_id: row.id,
        p_status: 'cancelled',
        p_next: next(Date.now() + DAY),
        p_user_did: did,
        p_only_pending: true,
      });
    expect((await skip(publishing)).data).toEqual({
      ok: false,
      code: 'NOT_PENDING',
      status: 'publishing',
    });
    expect((await skip(partial)).data.code).toBe('NOT_PENDING');
    expect((await skip(publishing, OTHER_DID)).data).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
    const { rows } = await t.query('SELECT COUNT(*)::int AS n FROM scheduled_posts');
    expect(rows[0].n).toBe(2);
  });

  it('refuses a status it doesn’t settle, and a row that isn’t there', async () => {
    const row = await insertRow();
    for (const p_status of ['pending', 'publishing', 'sent', null]) {
      expect((await settle({ p_id: row.id, p_status })).data).toEqual({
        ok: false,
        code: 'BAD_REQUEST',
      });
    }
    expect(
      (
        await settle({
          p_id: '00000000-0000-4000-8000-000000000000',
          p_status: 'published',
        })
      ).data,
    ).toEqual({ ok: false, code: 'NOT_FOUND' });
  });
});

describe('stop_scheduled_repeat and stopRepeating', () => {
  it('takes the rule off the waiting row and leaves the rest as it was', async () => {
    const row = await insertRow({ repeat: true, status: 'pending', at: Date.now() + HOUR });
    const stoppedRow = await scheduled.stopRepeating({ id: row.id, userDid: DID });
    expect(stoppedRow.id).toBe(row.id);
    const after = await readRow(row.id);
    expect(after.payload).toEqual({ ...row.payload, repeat: undefined });
    expect(after).toMatchObject({
      status: 'pending',
      series_id: SERIES,
      occurrence: 1,
    });
    expect(new Date(after.scheduled_for).getTime()).toBe(
      new Date(row.scheduled_for).getTime(),
    );
    // Once stopped, there is nothing to stop.
    expect(await scheduled.stopRepeating({ id: row.id, userDid: DID })).toBeNull();
  });

  it('stops a failed carrier too, and nothing that is going out, someone else’s, or plain', async () => {
    const failed = await insertRow({ repeat: true, status: 'failed' });
    expect(
      (await scheduled.stopRepeating({ id: failed.id, userDid: DID })).status,
    ).toBe('failed');
    const publishing = await insertRow({
      repeat: true,
      series_id: '22222222-2222-4222-8222-222222222222',
      status: 'publishing',
    });
    const plain = await insertRow({ status: 'pending' });
    expect(await scheduled.stopRepeating({ id: publishing.id, userDid: DID })).toBeNull();
    expect(await scheduled.stopRepeating({ id: plain.id, userDid: DID })).toBeNull();
    expect(await scheduled.stopRepeating({ id: 'nope', userDid: DID })).toBeNull();
    const theirs = await insertRow({
      repeat: true,
      series_id: '33333333-3333-4333-8333-333333333333',
      status: 'pending',
      user_did: OTHER_DID,
    });
    expect(await scheduled.stopRepeating({ id: theirs.id, userDid: DID })).toBeNull();
    expect((await readRow(theirs.id)).payload.repeat).toBeTruthy();
  });
});

describe('planNextOccurrence', () => {
  it('plans the rule’s next slot with keys minted for it', async () => {
    const at = minute(Date.now() - MINUTE);
    const row = await insertRow({ repeat: true, at });
    const plan = await scheduled.planNextOccurrence(row);
    expect(plan.occurrence).toBe(2);
    expect(plan.scheduledFor).toBe(iso(at + DAY));
    expect(plan.payload.rkeys).toHaveLength(1);
    expect(plan.payload.rkeys[0]).toMatch(/^[234567a-z]{13}$/);
    expect(plan.payload.rkeys[0]).not.toBe(row.payload.rkeys[0]);
    expect(plan.payload).not.toHaveProperty('selfDestruct');
  });

  it('mints a key for every post of a thread', async () => {
    const row = await insertRow({
      repeat: true,
      payload: {
        posts: [{ record: { text: 'a' } }, { record: { text: 'b' } }, { record: { text: 'c' } }],
      },
    });
    const plan = await scheduled.planNextOccurrence(row);
    expect(new Set(plan.payload.rkeys).size).toBe(3);
  });

  it('picks up at the next slot still ahead when this one went out late', async () => {
    const at = minute(Date.now() - 3 * DAY - HOUR);
    const row = await insertRow({ repeat: true, at });
    const plan = await scheduled.planNextOccurrence(row);
    // Occurrences 2, 3 and 4 have passed; they are counted, not sent.
    expect(plan.occurrence).toBe(5);
    expect(plan.scheduledFor).toBe(iso(at + 4 * DAY));
  });

  it('lets a pinned delete time go: later occurrences run for its length', async () => {
    const selfDestruct = {
      lifespanSeconds: 3600,
      deleteAt: iso(Date.now() + HOUR),
      conditions: { sense: 'any', clauses: [] },
      effects: [{ action: 'delete' }],
    };
    const row = await insertRow({ repeat: true, payload: { selfDestruct } });
    const plan = await scheduled.planNextOccurrence(row);
    expect(plan.payload.selfDestruct).toEqual({ ...selfDestruct, deleteAt: null });
  });

  it('is null when the series is over, or the row carries none', async () => {
    const last = await insertRow({ repeat: { count: 3 }, occurrence: 3 });
    expect(await scheduled.planNextOccurrence(last)).toBeNull();
    const ended = await insertRow({
      repeat: { until: '2000-01-01' },
      series_id: '22222222-2222-4222-8222-222222222222',
    });
    expect(await scheduled.planNextOccurrence(ended)).toBeNull();
    expect(await scheduled.planNextOccurrence(await insertRow())).toBeNull();
    expect(
      await scheduled.planNextOccurrence(
        await insertRow({ series_id: '33333333-3333-4333-8333-333333333333', occurrence: 2 }),
      ),
    ).toBeNull();
    expect(await scheduled.planNextOccurrence(null)).toBeNull();
  });
});

describe('markPublished on a repeating post', () => {
  it('publishes this occurrence and leaves the next one waiting', async () => {
    const at = minute(Date.now() - MINUTE);
    const row = await insertRow({ repeat: { count: 5 }, at });
    await scheduled.markPublished(row.id, REF, row.payload.media, row);
    const [first, second] = await seriesRows();
    expect(first).toMatchObject({ status: 'published', result_uri: REF.uri });
    expect(second).toMatchObject({ status: 'pending', occurrence: 2 });
    expect(new Date(second.scheduled_for).getTime()).toBe(at + DAY);
    expect(second.payload.repeat).toEqual(row.payload.repeat);
    expect(second.payload.posts).toEqual(row.payload.posts);
    // The list shows what is waiting.
    expect((await scheduled.listScheduledPosts(DID)).map((r) => r.id)).toEqual([
      second.id,
    ]);
  });

  it('writes one next occurrence when two runs both finish the row', async () => {
    const row = await insertRow({ repeat: true });
    await Promise.all([
      scheduled.markPublished(row.id, REF, row.payload.media, row),
      scheduled.markPublished(row.id, REF, row.payload.media, row),
    ]);
    await scheduled.markPublished(row.id, REF, row.payload.media, row);
    const rows = await seriesRows();
    expect(rows.map((r) => [r.occurrence, r.status])).toEqual([
      [1, 'published'],
      [2, 'pending'],
    ]);
  });

  it('ends the series after its last occurrence', async () => {
    const row = await insertRow({ repeat: { count: 2 }, occurrence: 2 });
    await scheduled.markPublished(row.id, REF, row.payload.media, row);
    expect((await seriesRows()).map((r) => r.status)).toEqual(['published']);
    expect(await scheduled.listScheduledPosts(DID)).toEqual([]);
  });

  it('carries a series through its whole count, one waiting at a time', async () => {
    const start = minute(Date.now() - MINUTE);
    let row = await insertRow({ repeat: { count: 4 }, at: start });
    const seen = [];
    for (let guard = 0; guard < 10 && row; guard++) {
      seen.push(row.occurrence);
      // Each occurrence comes due a day after the one before.
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(new Date(row.scheduled_for).getTime() + MINUTE));
      const waiting = (await seriesRows()).filter((r) => r.status === 'pending');
      expect(waiting.length).toBeLessThanOrEqual(1);
      await scheduled.markPublished(row.id, REF, row.payload.media, row);
      row = (await seriesRows()).find((r) => r.status === 'pending');
    }
    expect(seen).toEqual([1, 2, 3, 4]);
    const rows = await seriesRows();
    expect(rows.map((r) => r.status)).toEqual(Array(4).fill('published'));
    expect(rows.map((r) => new Date(r.scheduled_for).getTime())).toEqual(
      [0, 1, 2, 3].map((n) => start + n * DAY),
    );
  });

  it('settles a row without a series as it always did', async () => {
    const row = await insertRow();
    await scheduled.markPublished(row.id, REF, row.payload.media, row);
    expect(await readRow(row.id)).toMatchObject({
      status: 'published',
      result_uri: REF.uri,
      result_cid: REF.cid,
      locked_at: null,
    });
    const { rows } = await t.query('SELECT COUNT(*)::int AS n FROM scheduled_posts');
    expect(rows[0].n).toBe(1);
  });
});

describe('a failed occurrence', () => {
  const fail = (row) =>
    scheduled.markFailedOrRetry(row, 'Bluesky refused the post', {
      terminal: true,
      code: 'REFUSED',
    });

  it('stays in the list as failed, and the series goes on from its schedule', async () => {
    const at = minute(Date.now() - MINUTE);
    const row = await insertRow({ repeat: true, at });
    expect(await fail(row)).toBe('failed');
    const [first, second] = await seriesRows();
    expect(first).toMatchObject({
      status: 'failed',
      last_error: 'Bluesky refused the post',
      last_error_code: 'REFUSED',
      locked_at: null,
    });
    expect(first.payload).not.toHaveProperty('repeat');
    expect(second).toMatchObject({ status: 'pending', occurrence: 2 });
    expect(new Date(second.scheduled_for).getTime()).toBe(at + DAY);
    expect(second.payload.repeat).toEqual(row.payload.repeat);
    expect((await scheduled.listScheduledPosts(DID)).map((r) => r.status).sort()).toEqual([
      'failed',
      'pending',
    ]);
  });

  it('doesn’t pile up: when the next one fails too, the older failure makes way', async () => {
    let row = await insertRow({ repeat: true, at: Date.now() - 2 * DAY - MINUTE });
    await fail(row);
    for (let i = 0; i < 2; i++) {
      row = (await seriesRows()).find((r) => r.status === 'pending');
      await t.query(`UPDATE scheduled_posts SET status = 'publishing' WHERE id = $1`, [row.id]);
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(new Date(row.scheduled_for).getTime() + MINUTE));
      await fail({ ...row, status: 'publishing' });
    }
    const rows = await seriesRows();
    expect(rows.filter((r) => r.status === 'failed')).toHaveLength(1);
    expect(rows.filter((r) => r.status === 'pending')).toHaveLength(1);
    // The one that failed last is the one kept to retry.
    const failed = rows.find((r) => r.status === 'failed');
    expect(failed.occurrence).toBe(Math.max(...rows.filter((r) => r.status !== 'pending').map((r) => r.occurrence)));
    expect(rows.filter((r) => r.status === 'cancelled').length).toBeGreaterThan(0);
  });

  it('keeps its rule when it was the last, so a retry or an edit can take it up', async () => {
    const row = await insertRow({ repeat: { count: 2 }, occurrence: 2 });
    await fail(row);
    const after = await readRow(row.id);
    expect(after.status).toBe('failed');
    expect(after.payload.repeat).toBeTruthy();
    expect(await seriesRows()).toHaveLength(1);
  });

  it('retried later, goes out once and writes no second copy of what follows it', async () => {
    const row = await insertRow({ repeat: true });
    await fail(row);
    const retried = await scheduled.retryFailedScheduledPost({ id: row.id, userDid: DID });
    expect(retried.status).toBe('pending');
    await scheduled.markPublished(retried.id, REF, retried.payload.media, retried);
    const rows = await seriesRows();
    expect(rows.map((r) => [r.occurrence, r.status])).toEqual([
      [1, 'published'],
      [2, 'pending'],
    ]);
  });

  it('still records the failure when the next occurrence can’t be written', async () => {
    const row = await insertRow({ repeat: true });
    const realRpc = t.supabase.rpc;
    vi.spyOn(t.supabase, 'rpc').mockImplementation((name, args) =>
      name === 'settle_scheduled_occurrence'
        ? Promise.resolve({ data: null, error: { message: 'connection reset' } })
        : realRpc(name, args),
    );
    expect(await fail(row)).toBe('failed');
    const after = await readRow(row.id);
    expect(after).toMatchObject({ status: 'failed', last_error_code: 'REFUSED' });
    // Nothing follows it yet, but the rule is still on it: retrying it, when
    // it publishes, writes the next one.
    expect(after.payload.repeat).toBeTruthy();
    vi.restoreAllMocks();
    const retried = await scheduled.retryFailedScheduledPost({ id: row.id, userDid: DID });
    await scheduled.markPublished(retried.id, REF, retried.payload.media, retried);
    expect((await seriesRows()).map((r) => r.status)).toEqual(['published', 'pending']);
  });

  it('requeues a retriable failure without touching the series', async () => {
    const row = await insertRow({ repeat: true, attempts: 1 });
    expect(await scheduled.markFailedOrRetry(row, 'timed out')).toBe('retry');
    const rows = await seriesRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pending');
    expect(rows[0].payload.repeat).toBeTruthy();
  });
});

describe('skipOccurrence', () => {
  it('takes this one off and puts the next in its place', async () => {
    const at = minute(Date.now() + HOUR);
    const row = await insertRow({ repeat: true, status: 'pending', at });
    const out = await scheduled.skipOccurrence({ id: row.id, userDid: DID });
    expect(out.skipped.id).toBe(row.id);
    expect(out.next).toMatchObject({ status: 'pending', occurrence: 2, series_id: SERIES });
    expect(new Date(out.next.scheduled_for).getTime()).toBe(at + DAY);
    const [first, second] = await seriesRows();
    expect(first.status).toBe('cancelled');
    expect(second.payload.repeat).toEqual(row.payload.repeat);
    expect((await scheduled.listScheduledPosts(DID)).map((r) => r.id)).toEqual([second.id]);
  });

  it('ends the series when the one skipped was the last', async () => {
    const row = await insertRow({
      repeat: { count: 3 },
      occurrence: 3,
      status: 'pending',
      at: Date.now() + HOUR,
    });
    const out = await scheduled.skipOccurrence({ id: row.id, userDid: DID });
    expect(out.next).toBeNull();
    expect((await seriesRows()).map((r) => r.status)).toEqual(['cancelled']);
  });

  it('answers null for a row that can’t be skipped', async () => {
    const publishing = await insertRow({ repeat: true, status: 'publishing' });
    const plain = await insertRow({ status: 'pending', at: Date.now() + HOUR });
    const failed = await insertRow({
      repeat: true,
      series_id: '22222222-2222-4222-8222-222222222222',
      status: 'failed',
    });
    for (const [id, did] of [
      [publishing.id, DID],
      [plain.id, DID],
      [failed.id, DID],
      ['not-a-uuid', DID],
    ])
      expect(await scheduled.skipOccurrence({ id, userDid: did })).toBeNull();
    const mine = await insertRow({
      repeat: true,
      series_id: '33333333-3333-4333-8333-333333333333',
      status: 'pending',
      at: Date.now() + HOUR,
    });
    expect(await scheduled.skipOccurrence({ id: mine.id, userDid: OTHER_DID })).toBeNull();
    expect((await readRow(mine.id)).status).toBe('pending');
  });

  it('loses safely to a worker that claimed the row in between', async () => {
    const row = await insertRow({ repeat: true, status: 'pending', at: Date.now() + HOUR });
    const realRpc = t.supabase.rpc;
    vi.spyOn(t.supabase, 'rpc').mockImplementation(async (name, args) => {
      if (name === 'settle_scheduled_occurrence')
        await t.query(`UPDATE scheduled_posts SET status = 'publishing' WHERE id = $1`, [row.id]);
      return realRpc(name, args);
    });
    expect(await scheduled.skipOccurrence({ id: row.id, userDid: DID })).toBeNull();
    expect(await seriesRows()).toHaveLength(1);
    expect((await readRow(row.id)).status).toBe('publishing');
  });
});

describe('a repeating post’s images', () => {
  it('stay when an occurrence publishes, for the next one to use', async () => {
    const inserted = await insertRow({ repeat: true });
    const { path, row } = await giveImage(inserted);
    await scheduled.markPublished(row.id, REF, row.payload.media, row);
    expect(stored(path)).toBeTruthy();
    const [first, second] = await seriesRows();
    // The row that is done has let go; the one waiting names the same bytes.
    expect(first.media_reclaimed_at).not.toBeNull();
    expect(second.media_reclaimed_at).toBeNull();
    expect(second.payload.media).toEqual(row.payload.media);
    expect(await scheduled.getScheduledMediaMap(second.id, DID)).toEqual({
      'p0-img0': { base64: PNG_BASE64, encoding: 'image/png' },
    });
  });

  it('go when the last occurrence publishes', async () => {
    const inserted = await insertRow({ repeat: { count: 2 } });
    const { path, row } = await giveImage(inserted);
    await scheduled.markPublished(row.id, REF, row.payload.media, row);
    const second = (await seriesRows())[1];
    expect(stored(path)).toBeTruthy();
    await scheduled.markPublished(second.id, REF, second.payload.media, second);
    expect(stored(path)).toBeUndefined();
    expect((await seriesRows()).every((r) => r.media_reclaimed_at)).toBe(true);
  });

  it('go when the waiting occurrence is cancelled', async () => {
    const inserted = await insertRow({ repeat: true });
    const { path, row } = await giveImage(inserted);
    await scheduled.markPublished(row.id, REF, row.payload.media, row);
    const second = (await seriesRows())[1];
    const cancelled = await scheduled.cancelScheduledPost(second.id, DID);
    expect(cancelled.status).toBe('cancelled');
    expect(stored(path)).toBeUndefined();
    expect((await readRow(second.id)).media_reclaimed_at).not.toBeNull();
  });

  it('go after a stopped post has gone out its one last time', async () => {
    const inserted = await insertRow({ repeat: true });
    const { path, row } = await giveImage(inserted);
    await scheduled.markPublished(row.id, REF, row.payload.media, row);
    const second = (await seriesRows())[1];
    await scheduled.stopRepeating({ id: second.id, userDid: DID });
    expect(stored(path)).toBeTruthy();
    const stopped = await readRow(second.id);
    await scheduled.markPublished(stopped.id, REF, stopped.payload.media, stopped);
    expect(stored(path)).toBeUndefined();
    expect(await seriesRows()).toHaveLength(2);
  });

  it('stay through a skip, and go when the skipped one was the last', async () => {
    const inserted = await insertRow({
      repeat: { count: 2 },
      status: 'pending',
      at: Date.now() + HOUR,
    });
    const { path } = await giveImage(inserted);
    const out = await scheduled.skipOccurrence({ id: inserted.id, userDid: DID });
    expect(stored(path)).toBeTruthy();
    expect(out.next.payload.media['p0-img0'].storagePath).toBe(path);
    const again = await scheduled.skipOccurrence({ id: out.next.id, userDid: DID });
    expect(again.next).toBeNull();
    expect(stored(path)).toBeUndefined();
  });

  it('stay for a failed occurrence to retry, until it is dismissed', async () => {
    const inserted = await insertRow({ repeat: { count: 2 } });
    const { path, row } = await giveImage(inserted);
    await scheduled.markFailedOrRetry(row, 'refused', { terminal: true, code: 'REFUSED' });
    const [failed, second] = await seriesRows();
    // The series ends with its second occurrence...
    await scheduled.markPublished(second.id, REF, second.payload.media, second);
    // ...but the failed first one can still be retried with its pictures.
    expect(stored(path)).toBeTruthy();
    expect((await readRow(failed.id)).media_reclaimed_at).toBeNull();
    await scheduled.cancelScheduledPost(failed.id, DID);
    expect(stored(path)).toBeUndefined();
  });

  it('are left alone by the sweep while the series is live', async () => {
    const inserted = await insertRow({ repeat: true });
    const { path, row } = await giveImage(inserted);
    await scheduled.markFailedOrRetry(row, 'refused', { terminal: true, code: 'REFUSED' });
    // The failed occurrence has sat for forty days; its successor still waits.
    await t.query(
      `UPDATE scheduled_posts SET updated_at = NOW() - INTERVAL '40 days' WHERE id = $1`,
      [row.id],
    );
    expect(await scheduled.reclaimFailedMedia()).toEqual({
      swept: 1,
      failed: 0,
      unavailable: false,
    });
    expect(stored(path)).toBeTruthy();
    // The old failure no longer has a claim on them, so it can't be retried
    // with pictures; the waiting occurrence is untouched.
    expect((await readRow(row.id)).media_reclaimed_at).not.toBeNull();
    const waiting = (await seriesRows())[1];
    expect(waiting.media_reclaimed_at).toBeNull();
    expect(
      await scheduled.retryFailedScheduledPost({ id: row.id, userDid: DID }),
    ).toEqual({ blocked: 'MEDIA_MISSING', partial: false });
  });

  it('are removed by the sweep when a release didn’t finish and the series is over', async () => {
    const inserted = await insertRow({ repeat: { count: 2 }, occurrence: 2 });
    const { path, row } = await giveImage(inserted);
    t.supabase.storage.failNext(BUCKET, 'remove');
    await scheduled.markPublished(row.id, REF, row.payload.media, row);
    expect(stored(path)).toBeTruthy();
    expect((await readRow(row.id)).media_reclaimed_at).toBeNull();
    t.supabase.storage.clearFailures();
    await t.query(
      `UPDATE scheduled_posts SET updated_at = NOW() - INTERVAL '2 hours' WHERE id = $1`,
      [row.id],
    );
    expect((await scheduled.reclaimFailedMedia()).swept).toBe(1);
    expect(stored(path)).toBeUndefined();
  });

  it('are kept, and the row left unstamped, when the series can’t be read', async () => {
    const inserted = await insertRow({ repeat: true });
    const { path, row } = await giveImage(inserted);
    const realFrom = t.supabase.from;
    let calls = 0;
    vi.spyOn(t.supabase, 'from').mockImplementation((table) => {
      const builder = realFrom(table);
      const select = builder.select.bind(builder);
      builder.select = (columns, options) => {
        if (columns === 'id, payload' && calls++ === 0)
          return {
            eq: () => ({ neq: () => ({ in: () => ({ is: async () => ({ error: { message: 'boom' } }) }) }) }),
          };
        return select(columns, options);
      };
      return builder;
    });
    await scheduled.markPublished(row.id, REF, row.payload.media, row);
    expect(stored(path)).toBeTruthy();
    expect((await readRow(row.id)).media_reclaimed_at).toBeNull();
  });
});

describe('editing a repeating post', () => {
  const edit = (row, extra = {}) =>
    scheduled.updateScheduledPostContent({
      id: row.id,
      userDid: DID,
      scheduledFor: iso(new Date(row.scheduled_for).getTime()),
      posts: [{ record: { text: 'reworded' } }],
      gates: { threadgate: null, postgate: null },
      ...extra,
    });

  it('changes this occurrence and the ones after it', async () => {
    const at = minute(Date.now() + HOUR);
    const row = await insertRow({ repeat: true, status: 'pending', at, occurrence: 3 });
    const moved = at + 2 * HOUR;
    const rule = dailyRule(moved, 1, { count: 9 });
    const saved = await edit(row, { scheduledFor: iso(moved), repeat: rule });
    expect(saved).toMatchObject({ series_id: SERIES, occurrence: 3, status: 'pending' });
    // The rule is anchored at this row's own number, whatever was sent.
    expect(saved.payload.repeat).toEqual({
      ...rule,
      anchor: { ...rule.anchor, occurrence: 3 },
    });
    const claimed = { ...saved, status: 'publishing' };
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(moved + MINUTE));
    await scheduled.markPublished(claimed.id, REF, claimed.payload.media, claimed);
    const next = (await seriesRows()).find((r) => r.status === 'pending');
    expect(next.occurrence).toBe(4);
    expect(new Date(next.scheduled_for).getTime()).toBe(moved + DAY);
    expect(next.payload.posts).toEqual([{ record: { text: 'reworded' } }]);
  });

  it('stops the series when the rule is taken off', async () => {
    const row = await insertRow({ repeat: true, status: 'pending', at: Date.now() + HOUR });
    const saved = await edit(row);
    expect(saved.payload).not.toHaveProperty('repeat');
    expect(saved).toMatchObject({ series_id: SERIES, occurrence: 1 });
  });

  it('starts a series when a plain post is given a rule', async () => {
    const row = await insertRow({ status: 'pending', at: Date.now() + HOUR });
    const rule = dailyRule(new Date(row.scheduled_for).getTime());
    const saved = await edit(row, { repeat: rule });
    expect(saved.series_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(saved.occurrence).toBe(1);
    expect(saved.payload.repeat).toEqual(rule);
  });

  it('gives a failed occurrence the series has moved past a series of its own', async () => {
    const row = await insertRow({ repeat: true });
    await scheduled.markFailedOrRetry(row, 'refused', { terminal: true, code: 'REFUSED' });
    const failed = await readRow(row.id);
    const at = minute(Date.now() + HOUR);
    const saved = await edit(failed, {
      scheduledFor: iso(at),
      repeat: dailyRule(at, 7),
    });
    expect(saved.status).toBe('pending');
    expect(saved.series_id).not.toBe(SERIES);
    expect(saved.occurrence).toBe(1);
    expect(saved.payload.repeat.anchor.occurrence).toBe(1);
    // The series it came from still has exactly its own next occurrence.
    expect((await seriesRows()).map((r) => r.occurrence)).toEqual([2]);
  });

  it('keeps the old pictures while a failed occurrence could still be retried with them', async () => {
    const inserted = await insertRow({ repeat: true });
    const { path, row } = await giveImage(inserted);
    await scheduled.markFailedOrRetry(row, 'refused', { terminal: true, code: 'REFUSED' });
    const waiting = (await seriesRows())[1];
    const saved = await edit(waiting, {
      posts: [
        {
          record: { text: 'new picture' },
          embed: { type: 'images', images: [{ mediaId: 'p0-img0', alt: '' }] },
        },
      ],
      mediaBytes: { 'p0-img0': { base64: PNG_BASE64, encoding: 'image/png' } },
      repeat: waiting.payload.repeat,
    });
    const fresh = saved.payload.media['p0-img0'].storagePath;
    expect(fresh).not.toBe(path);
    expect(stored(fresh)).toBeTruthy();
    expect(stored(path)).toBeTruthy();
    // Once the failure is dismissed nothing names the old bytes.
    await scheduled.cancelScheduledPost(row.id, DID);
    expect(stored(path)).toBeUndefined();
    expect(stored(fresh)).toBeTruthy();
  });

  it('drops the old pictures at once when nothing else names them', async () => {
    const inserted = await insertRow({ repeat: true, status: 'pending', at: Date.now() + HOUR });
    const { path, row } = await giveImage(inserted);
    await edit(row, { repeat: row.payload.repeat });
    expect(stored(path)).toBeUndefined();
  });

  it('moves the anchor with a time-only move', async () => {
    const at = minute(Date.now() + HOUR);
    const row = await insertRow({ repeat: true, status: 'pending', at, occurrence: 2 });
    const to = at + 3 * HOUR;
    const moved = await scheduled.rescheduleScheduledPost({
      id: row.id,
      userDid: DID,
      scheduledFor: iso(to),
    });
    expect(moved.payload.repeat.anchor).toEqual({
      ...dailyRule(to, 2).anchor,
    });
    expect(nextOccurrence(moved.payload.repeat, 2, to)).toEqual({
      occurrence: 3,
      scheduledFor: iso(to + DAY),
    });
  });
});

describe('a series and the account’s cap', () => {
  it('holds one slot: the next occurrence takes the place of the one that went out', async () => {
    vi.stubEnv('SCHEDULE_MAX_PENDING', '2');
    const row = await insertRow({ repeat: true, status: 'publishing' });
    await insertRow({ status: 'pending', at: Date.now() + HOUR });
    // Full: the series and one other post.
    await expect(
      scheduled.createScheduledPost({
        userDid: DID,
        scheduledFor: iso(Date.now() + HOUR),
        payload: { posts: [] },
      }),
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
    // The series goes on all the same: nothing new is being asked for.
    await scheduled.markPublished(row.id, REF, row.payload.media, row);
    const rows = await seriesRows();
    expect(rows.map((r) => r.status)).toEqual(['published', 'pending']);
    // And it still counts, like any other scheduled post.
    await expect(
      scheduled.createScheduledPost({
        userDid: DID,
        scheduledFor: iso(Date.now() + HOUR),
        payload: { posts: [] },
      }),
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED', limit: 2 });
    // Once the series is cancelled, its slot is free.
    await scheduled.cancelScheduledPost(rows[1].id, DID);
    const created = await scheduled.createScheduledPost({
      userDid: DID,
      scheduledFor: iso(Date.now() + HOUR),
      payload: { posts: [] },
    });
    expect(created.status).toBe('pending');
  });

  it('counts a repeating post once when it is created', async () => {
    vi.stubEnv('SCHEDULE_MAX_PENDING', '1');
    await scheduled.createScheduledPost({
      userDid: DID,
      scheduledFor: iso(Date.now() + HOUR),
      payload: { posts: [], repeat: dailyRule(Date.now() + HOUR) },
    });
    await expect(
      scheduled.createScheduledPost({
        userDid: DID,
        scheduledFor: iso(Date.now() + HOUR),
        payload: { posts: [], repeat: dailyRule(Date.now() + HOUR) },
      }),
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED', limit: 1 });
  });

  it('takes a slot to retry a failed occurrence beside the one waiting', async () => {
    vi.stubEnv('SCHEDULE_MAX_PENDING', '1');
    const row = await insertRow({ repeat: true });
    await scheduled.markFailedOrRetry(row, 'refused', { terminal: true, code: 'REFUSED' });
    await expect(
      scheduled.retryFailedScheduledPost({ id: row.id, userDid: DID }),
    ).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
  });
});
