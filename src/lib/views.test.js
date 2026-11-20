import { describe, expect, it } from 'vitest';
import {
  VIEWS_MAX_POINTS,
  VIEWS_WALK_PAST_OLDEST,
  ageGate,
  applyReading,
  oldestCountedMs,
  recheckAfter,
  thinPoints,
  typicalViews,
  viewCountOf,
  viewGains,
  viewsDue,
  viewsStatus,
} from './views.js';

const HOUR = 3_600_000;
const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 20, 12);
const iso = (ms) => new Date(ms).toISOString();
const uri = (n) => `at://did:plc:me/app.bsky.feed.post/${String(n).padStart(13, 'a')}`;

describe('viewCountOf', () => {
  it('reads a whole count and nothing else', () => {
    expect(viewCountOf({ viewCount: 123 })).toBe(123);
    expect(viewCountOf({ viewCount: 0 })).toBe(0);
    expect(viewCountOf({})).toBeNull();
    expect(viewCountOf({ viewCount: undefined })).toBeNull();
    expect(viewCountOf({ viewCount: '500' })).toBeNull();
    expect(viewCountOf({ viewCount: 1.5 })).toBeNull();
    expect(viewCountOf({ viewCount: -1 })).toBeNull();
    expect(viewCountOf({ viewCount: 2 ** 60 })).toBeNull();
    expect(viewCountOf(null)).toBeNull();
  });
});

describe('ageGate', () => {
  const pref = (fields) => ({ $type: 'app.bsky.actor.defs#declaredAgePref', ...fields });
  it('reads Bluesky’s declared age the way its own app does', () => {
    expect(ageGate([pref({ isOverAge13: true, isOverAge16: true, isOverAge18: true })])).toBe('adult');
    expect(ageGate([pref({ isOverAge13: true, isOverAge16: true, isOverAge18: false })])).toBe('minor');
  });
  it('is undeclared without the preference, or with nothing to say', () => {
    expect(ageGate([])).toBe('undeclared');
    expect(ageGate([{ $type: 'app.bsky.actor.defs#adultContentPref', enabled: true }])).toBe('undeclared');
    expect(ageGate([pref({})])).toBe('undeclared');
    expect(ageGate(null)).toBe('undeclared');
  });
});

describe('applyReading', () => {
  it('starts a row from the first reading', () => {
    const row = applyReading(null, { uri: uri(1), at: iso(NOW - DAY), count: 240, readAt: NOW });
    expect(row).toEqual({ uri: uri(1), at: iso(NOW - DAY), count: 240, countedAt: NOW, checkedAt: NOW, checks: 1, points: [[NOW, 240]] });
  });

  it('never lets a missing count take away one it has', () => {
    let row = applyReading(null, { uri: uri(1), count: 240, readAt: NOW });
    row = applyReading(row, { uri: uri(1), count: null, readAt: NOW + HOUR });
    expect(row.count).toBe(240);
    expect(row.countedAt).toBe(NOW);
    expect(row.checkedAt).toBe(NOW + HOUR);
    expect(row.checks).toBe(2);
    expect(row.points).toEqual([[NOW, 240]]);
  });

  it('keeps a post with no count yet as one under the floor, not zero', () => {
    const row = applyReading(null, { uri: uri(1), count: null, readAt: NOW });
    expect(row.count).toBeNull();
    expect(row.countedAt).toBeNull();
    expect(row.points).toEqual([]);
  });

  it('holds the highest count through a dip in the estimate', () => {
    let row = applyReading(null, { uri: uri(1), count: 500, readAt: NOW });
    row = applyReading(row, { uri: uri(1), count: 480, readAt: NOW + HOUR });
    expect(row.count).toBe(500);
    row = applyReading(row, { uri: uri(1), count: 620, readAt: NOW + 2 * HOUR });
    expect(row.count).toBe(620);
  });

  it('keeps a flat stretch as its first and last readings', () => {
    let row = null;
    for (const [i, c] of [100, 200, 200, 200, 200, 300].entries()) row = applyReading(row, { uri: uri(1), count: c, readAt: NOW + i * HOUR });
    expect(row.points).toEqual([
      [NOW, 100],
      [NOW + HOUR, 200],
      [NOW + 4 * HOUR, 200],
      [NOW + 5 * HOUR, 300],
    ]);
  });

  it('ignores a reading that is not after the last one', () => {
    let row = applyReading(null, { uri: uri(1), count: 100, readAt: NOW });
    row = applyReading(row, { uri: uri(1), count: 150, readAt: NOW });
    expect(row.points).toEqual([[NOW, 100]]);
    expect(row.count).toBe(150);
  });

  it('keeps at most VIEWS_MAX_POINTS readings', () => {
    let row = null;
    for (let i = 0; i < VIEWS_MAX_POINTS * 3; i++) row = applyReading(row, { uri: uri(1), count: 100 + i, readAt: NOW + i * HOUR });
    expect(row.points).toHaveLength(VIEWS_MAX_POINTS);
    expect(row.points[0]).toEqual([NOW, 100]);
    expect(row.points.at(-1)).toEqual([NOW + (VIEWS_MAX_POINTS * 3 - 1) * HOUR, 100 + VIEWS_MAX_POINTS * 3 - 1]);
  });
});

describe('thinPoints', () => {
  it('drops the bunched readings first and keeps both ends', () => {
    const points = [
      [0, 1],
      [10, 2],
      [11, 3],
      [12, 4],
      [100, 5],
    ];
    expect(thinPoints(points, 4)).toEqual([
      [0, 1],
      [10, 2],
      [12, 4],
      [100, 5],
    ]);
    expect(thinPoints(points, 2)).toEqual([
      [0, 1],
      [100, 5],
    ]);
    expect(thinPoints(points, 10)).toBe(points);
  });
});

describe('recheckAfter', () => {
  it('reads young posts every sync and old ones rarely', () => {
    expect(recheckAfter(HOUR)).toBe(0);
    expect(recheckAfter(3 * DAY)).toBe(6 * HOUR);
    expect(recheckAfter(10 * DAY)).toBe(DAY);
    expect(recheckAfter(60 * DAY)).toBe(7 * DAY);
    expect(recheckAfter(400 * DAY)).toBe(30 * DAY);
  });
});

describe('viewsDue', () => {
  const post = (n, ageMs) => ({ uri: uri(n), at: iso(NOW - ageMs) });

  it('asks about every post on a first walk, newest first, up to the limit', () => {
    const posts = [post(3, 40 * DAY), post(1, HOUR), post(2, 5 * DAY)];
    expect(viewsDue(posts, new Map(), NOW)).toEqual([uri(1), uri(2), uri(3)]);
    expect(viewsDue(posts, new Map(), NOW, { limit: 2 })).toEqual([uri(1), uri(2)]);
  });

  it('puts posts under two days old before anything unread', () => {
    const rows = new Map([[uri(1), { uri: uri(1), at: iso(NOW - HOUR), checkedAt: NOW - 1000, countedAt: NOW - 1000, count: 100 }]]);
    const posts = [post(2, 9 * DAY), post(1, HOUR)];
    expect(viewsDue(posts, rows, NOW, { limit: 1 })).toEqual([uri(1)]);
  });

  it('waits out each post’s interval, then asks the longest overdue first', () => {
    const rows = new Map([
      [uri(1), { uri: uri(1), at: iso(NOW - 3 * DAY), checkedAt: NOW - HOUR, countedAt: NOW - HOUR, count: 300 }],
      [uri(2), { uri: uri(2), at: iso(NOW - 10 * DAY), checkedAt: NOW - 2 * DAY, countedAt: NOW - 2 * DAY, count: 300 }],
      [uri(3), { uri: uri(3), at: iso(NOW - 4 * DAY), checkedAt: NOW - 7 * HOUR, countedAt: NOW - 7 * HOUR, count: 300 }],
    ]);
    const posts = [post(1, 3 * DAY), post(2, 10 * DAY), post(3, 4 * DAY)];
    expect(viewsDue(posts, rows, NOW)).toEqual([uri(2), uri(3)]);
  });

  it('stops going back once it has read enough posts past the oldest count', () => {
    const rows = new Map();
    // One counted post forty days back, then a run of uncounted older ones.
    rows.set(uri(0), { uri: uri(0), at: iso(NOW - 40 * DAY), checkedAt: NOW - HOUR, countedAt: NOW - HOUR, count: 400 });
    for (let i = 1; i <= VIEWS_WALK_PAST_OLDEST; i++) {
      rows.set(uri(i), { uri: uri(i), at: iso(NOW - (40 + i) * DAY), checkedAt: NOW - HOUR, countedAt: null, count: null });
    }
    const older = post(9999, 500 * DAY);
    const newerUnread = post(8888, 35 * DAY);
    const due = viewsDue([older, newerUnread, ...[...rows.values()].map((r) => ({ uri: r.uri, at: r.at }))], rows, NOW);
    expect(due).toContain(uri(8888));
    expect(due).not.toContain(uri(9999));
    // And the uncounted ones past the oldest count aren't read again.
    expect(due.filter((u) => u !== uri(8888) && u !== uri(0))).toEqual([]);
  });

  it('keeps reading recent posts that haven’t reached a count yet', () => {
    const rows = new Map([
      [uri(0), { uri: uri(0), at: iso(NOW - 3 * DAY), checkedAt: NOW - 2 * DAY, countedAt: NOW - 2 * DAY, count: 150 }],
      [uri(1), { uri: uri(1), at: iso(NOW - 10 * DAY), checkedAt: NOW - 2 * DAY, countedAt: null, count: null }],
    ]);
    expect(viewsDue([post(0, 3 * DAY), post(1, 10 * DAY)], rows, NOW)).toEqual([uri(0), uri(1)]);
  });

  it('walks back at most so far while nothing has a count', () => {
    const posts = Array.from({ length: VIEWS_WALK_PAST_OLDEST + 50 }, (_, i) => post(i, (40 + i) * DAY));
    const due = viewsDue([post(9000, 3 * DAY), ...posts], new Map(), NOW);
    // The recent post, then the newest of the old ones, up to the walk's length.
    expect(due[0]).toBe(uri(9000));
    expect(due).toHaveLength(1 + VIEWS_WALK_PAST_OLDEST);
    expect(due.at(-1)).toBe(uri(VIEWS_WALK_PAST_OLDEST - 1));

    const rows = new Map();
    for (let i = 0; i < 10; i++) rows.set(uri(i), { uri: uri(i), at: iso(NOW - (100 + i) * DAY), checkedAt: NOW - HOUR, countedAt: null, count: null, checks: 1 });
    expect(viewsDue([post(50, 200 * DAY)], rows, NOW)).toEqual([uri(50)]);
    for (let i = 10; i < VIEWS_WALK_PAST_OLDEST; i++) rows.set(uri(i), { uri: uri(i), at: iso(NOW - (100 + i) * DAY), checkedAt: NOW - HOUR, countedAt: null, count: null, checks: 1 });
    expect(viewsDue([post(50, 500 * DAY)], rows, NOW)).toEqual([]);
  });

  it('stops reading an old post after two reads without a count', () => {
    const once = { uri: uri(1), at: iso(NOW - 60 * DAY), checkedAt: NOW - 8 * DAY, countedAt: null, count: null, checks: 1 };
    expect(viewsDue([post(1, 60 * DAY)], new Map([[uri(1), once]]), NOW)).toEqual([uri(1)]);
    expect(viewsDue([post(1, 60 * DAY)], new Map([[uri(1), { ...once, checks: 2 }]]), NOW)).toEqual([]);
    // A recent one keeps being read, however often it came back without one.
    const young = { uri: uri(2), at: iso(NOW - 10 * DAY), checkedAt: NOW - 2 * DAY, countedAt: null, count: null, checks: 9 };
    expect(viewsDue([post(2, 10 * DAY)], new Map([[uri(2), young]]), NOW)).toEqual([uri(2)]);
  });

  it('skips rows it can’t date', () => {
    expect(viewsDue([{ uri: uri(1), at: 'nope' }, { at: iso(NOW) }], new Map(), NOW)).toEqual([]);
  });
});

describe('oldestCountedMs', () => {
  it('is the oldest post with a count, or null', () => {
    expect(oldestCountedMs([])).toBeNull();
    expect(
      oldestCountedMs([
        { at: iso(NOW - DAY), countedAt: NOW },
        { at: iso(NOW - 9 * DAY), countedAt: null },
        { at: iso(NOW - 5 * DAY), countedAt: NOW },
      ]),
    ).toBe(NOW - 5 * DAY);
  });
});

describe('viewGains', () => {
  const day = (i) => NOW - (10 - i) * DAY;
  const buckets = Array.from({ length: 10 }, (_, i) => ({ t: day(i), v: 0 }));
  const t1 = NOW;

  it('spreads a rise evenly over the time between readings', () => {
    const rows = [{ uri: uri(1), at: iso(day(0)), points: [[day(2), 100], [day(5), 400]] }];
    const out = viewGains(rows, buckets, { t1 });
    expect(out.map((b) => Math.round(b.v))).toEqual([0, 0, 100, 100, 100, 0, 0, 0, 0, 0]);
  });

  it('counts a new post’s views from the moment it was posted', () => {
    const rows = [{ uri: uri(1), at: iso(day(3)), points: [[day(5), 200]] }];
    expect(viewGains(rows, buckets, { t1, sinceMs: day(1) }).map((b) => Math.round(b.v))).toEqual([0, 0, 0, 100, 100, 0, 0, 0, 0, 0]);
    // Posted before Virga was reading: its first reading is only a start.
    expect(viewGains(rows, buckets, { t1, sinceMs: day(4) }).every((b) => b.v === 0)).toBe(true);
  });

  it('adds up to the rise it was given, inside the window', () => {
    const rows = [
      { uri: uri(1), at: iso(day(0)), points: [[day(1) + HOUR, 100], [day(3) + 5 * HOUR, 350], [day(9) + 2 * HOUR, 1000]] },
      { uri: uri(2), at: iso(day(0)), points: [[day(4), 100], [day(4) + 3 * HOUR, 160]] },
    ];
    const total = viewGains(rows, buckets, { t1 }).reduce((s, b) => s + b.v, 0);
    expect(total).toBeCloseTo(900 + 60, 6);
  });

  it('leaves out what happened before the first bucket', () => {
    const rows = [{ uri: uri(1), at: iso(day(0) - 9 * DAY), points: [[day(0) - 4 * DAY, 100], [day(0) + DAY, 600]] }];
    const out = viewGains(rows, buckets, { t1 });
    expect(Math.round(out.reduce((s, b) => s + b.v, 0))).toBe(100);
    expect(Math.round(out[0].v)).toBe(100);
  });
});

describe('typicalViews', () => {
  it('is the median of the counts', () => {
    expect(typicalViews([300, 100, 200])).toEqual({ value: 200, under: false, posts: 3 });
    expect(typicalViews([100, 200, 300, 500])).toEqual({ value: 250, under: false, posts: 4 });
  });
  it('is under 100 when the middle post has no count', () => {
    expect(typicalViews([null, null, 900])).toEqual({ value: null, under: true, posts: 3 });
    expect(typicalViews([null, 300, 900, null])).toEqual({ value: null, under: true, posts: 4 });
  });
  it('is nothing for no posts', () => {
    expect(typicalViews([])).toEqual({ value: null, under: false, posts: 0 });
  });
});

describe('viewsStatus', () => {
  const counted = [{ uri: uri(1), countedAt: NOW, count: 200 }];
  it('says off, and an age that isn’t 18, before anything else', () => {
    expect(viewsStatus({ status: 'ok', since: NOW }, counted, { enabled: false })).toBe('off');
    expect(viewsStatus({ status: 'minor', since: NOW }, counted)).toBe('minor');
    expect(viewsStatus({ status: 'undeclared' }, [])).toBe('undeclared');
  });
  it('shows what is kept even when the latest read couldn’t happen', () => {
    expect(viewsStatus({ status: 'scope', since: NOW }, counted)).toBe('ready');
    expect(viewsStatus({ status: 'error', since: NOW }, counted)).toBe('ready');
  });
  it('tells a missing permission, an unread archive and an all-under-100 one apart', () => {
    expect(viewsStatus({ status: 'scope' }, [])).toBe('scope');
    expect(viewsStatus(null, [])).toBe('unread');
    expect(viewsStatus({ status: 'error' }, [])).toBe('unread');
    expect(viewsStatus({ status: 'ok', since: NOW }, [{ uri: uri(1), countedAt: null, count: null }])).toBe('none');
  });
});
