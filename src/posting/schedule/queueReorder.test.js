/*
 * Re-packing the queue after a drag. Every queued row holds its minute,
 * whoever placed it; only Virga's own pending rows move, and a move that would
 * strand a pinned delete time is caught before the new order is drawn.
 */

import { describe, expect, it } from 'vitest';
import {
  pendingMoves,
  planQueueReorder,
  queueTimerConflict,
  splitQueueRows,
} from './queueReorder.js';

const row = (id, scheduledFor, extra = {}) => ({
  id,
  queued: true,
  status: 'pending',
  clientKey: 'virga',
  scheduledFor,
  payload: {
    posts: [{ record: { text: `post ${id}` } }],
    ...(extra.selfDestruct ? { selfDestruct: extra.selfDestruct } : {}),
  },
  ...extra,
});

describe('queueTimerConflict', () => {
  const pin = '2026-09-03T22:00:00.000Z';
  const rows = [
    row('a', '2026-09-03T18:00:00.000Z', {
      selfDestruct: {
        lifespanSeconds: 3600,
        deleteAt: pin,
        conditions: {},
        effects: [],
      },
    }),
    row('b', '2026-09-04T09:00:00.000Z'),
  ];

  it('finds a move that would carry a pinned post past its delete time', () => {
    const assignment = [
      {
        id: 'a',
        oldScheduledFor: '2026-09-03T18:00:00+00:00',
        newScheduledFor: '2026-09-04T09:00:00.000Z',
      },
      {
        id: 'b',
        oldScheduledFor: '2026-09-04T09:00:00+00:00',
        newScheduledFor: '2026-09-03T18:00:00.000Z',
      },
    ];
    const conflict = queueTimerConflict(rows, assignment);
    expect(conflict.id).toBe('a');
    expect(conflict.message).toMatch(
      /^“post a” has a delete time this order would move it past, so the order wasn’t changed\./,
    );
    expect(conflict.message).toMatch(/pick a later delete time or a length/);
  });

  it('says the other thing when a move would put a post more than thirty days before its pin', () => {
    const farPin = '2026-10-20T18:00:00.000Z';
    const farRows = [
      row('far', '2026-10-01T18:00:00.000Z', {
        selfDestruct: {
          lifespanSeconds: 3600,
          deleteAt: farPin,
          conditions: {},
          effects: [],
        },
      }),
    ];
    const conflict = queueTimerConflict(farRows, [
      {
        id: 'far',
        oldScheduledFor: '2026-10-01T18:00:00+00:00',
        newScheduledFor: '2026-09-10T18:00:00.000Z',
      },
    ]);
    expect(conflict.message).toMatch(
      /more than 30 days after the slot this order would give it/,
    );
    expect(conflict.message).toMatch(/pick an earlier delete time or a length/);
    expect(conflict.message).not.toMatch(/move it past/);
  });

  it('lets through moves that stay clear of the pin, and rows without one', () => {
    expect(
      queueTimerConflict(rows, [
        {
          id: 'a',
          oldScheduledFor: '2026-09-03T18:00:00+00:00',
          newScheduledFor: '2026-09-03T20:00:00.000Z',
        },
        {
          id: 'b',
          oldScheduledFor: '2026-09-04T09:00:00+00:00',
          newScheduledFor: '2026-09-05T09:00:00.000Z',
        },
      ]),
    ).toBeNull();
    // A row that does not move is not a conflict however its time compares.
    expect(
      queueTimerConflict(rows, [
        {
          id: 'a',
          oldScheduledFor: '2026-09-03T18:00:00+00:00',
          newScheduledFor: '2026-09-03T18:00:00.000Z',
        },
      ]),
    ).toBeNull();
  });

  it('names a post with no words as one of these posts', () => {
    const silent = {
      ...rows[0],
      payload: { ...rows[0].payload, posts: [{ record: { text: '' } }] },
    };
    const conflict = queueTimerConflict(
      [silent],
      [
        {
          id: 'a',
          oldScheduledFor: '2026-09-03T18:00:00Z',
          newScheduledFor: '2026-09-04T09:00:00Z',
        },
      ],
    );
    expect(conflict.message).toMatch(/^One of these posts has a delete time/);
  });
});

describe('pendingMoves', () => {
  it('moves only rows whose instant changed, comparing instants not strings', () => {
    expect(
      pendingMoves([
        {
          id: 'same',
          oldScheduledFor: '2026-09-03T18:00:00+00:00',
          newScheduledFor: '2026-09-03T18:00:00.000Z',
        },
        {
          id: 'moved',
          oldScheduledFor: '2026-09-03T18:00:00+00:00',
          newScheduledFor: '2026-09-04T18:00:00.000Z',
        },
        { id: 'past horizon', oldScheduledFor: null, newScheduledFor: null },
      ]),
    ).toEqual([{ id: 'moved', scheduledFor: '2026-09-04T18:00:00.000Z' }]);
    expect(pendingMoves(null)).toEqual([]);
  });
});

describe('splitQueueRows', () => {
  it('moves only this app’s own pending rows, none of a thread out yet', () => {
    const rows = [
      row('later', '2026-09-05T09:00:00Z'),
      row('sooner', '2026-09-04T09:00:00Z'),
      row('theirs', '2026-09-04T17:00:00Z', { clientKey: 'anisota' }),
      row('partial', '2026-09-01T09:00:00Z', { partial: true }),
      row('failed', '2026-09-01T09:00:00Z', { status: 'failed' }),
      row('unknown', '2026-09-06T09:00:00Z', { clientKey: undefined }),
      { ...row('oneoff', '2026-09-06T09:00:00Z'), queued: false },
    ];
    const { movable, occupied } = splitQueueRows(rows, {
      now: new Date('2026-08-30T12:00:00Z'),
    });
    expect(movable.map((r) => r.id)).toEqual(['sooner', 'later']);
    expect(occupied.map((r) => r.id)).toEqual([
      'theirs',
      'partial',
      'failed',
      'unknown',
    ]);
  });
});

describe('splitQueueRows and a row whose time has come', () => {
  const now = new Date('2026-11-16T10:00:00Z');

  it('holds a pending row that is due or waiting on a retry in place', () => {
    const rows = [
      row('due', '2026-11-16T09:00:00Z'),
      row('soon', '2026-11-16T10:00:30Z'),
      row('ahead', '2026-11-17T09:00:00Z'),
    ];
    const { movable, occupied } = splitQueueRows(rows, { now });
    expect(movable.map((r) => r.id)).toEqual(['ahead']);
    expect(occupied.map((r) => r.id)).toEqual(['due', 'soon']);
  });
});

describe('planQueueReorder', () => {
  const schedule = {
    timezone: 'UTC',
    slots: { mon: ['09:00'], tue: ['09:00'], wed: ['09:00'], thu: ['09:00'] },
  };
  const now = new Date('2026-08-16T12:00:00Z');

  it('re-packs the new order around another client’s row', () => {
    const rows = [
      row('a', '2026-08-17T09:00:00+00:00'),
      row('theirs', '2026-08-18T09:00:00+00:00', { clientKey: 'anisota' }),
      row('b', '2026-08-19T09:00:00+00:00'),
    ];
    const plan = planQueueReorder(schedule, rows, ['b', 'a'], now);
    expect(plan.moves).toEqual([
      { id: 'b', scheduledFor: '2026-08-17T09:00:00.000Z' },
      { id: 'a', scheduledFor: '2026-08-19T09:00:00.000Z' },
    ]);
    expect(plan.conflict).toBeNull();
    // The other client's row never appears in the assignment.
    expect(plan.assignment.map((a) => a.id)).toEqual(['b', 'a']);
  });

  it('keeps a row the new order forgot, at the end, and ignores ids it may not move', () => {
    const rows = [
      row('a', '2026-08-17T09:00:00Z'),
      row('b', '2026-08-18T09:00:00Z'),
      row('theirs', '2026-08-19T09:00:00Z', { clientKey: 'anisota' }),
    ];
    const plan = planQueueReorder(schedule, rows, ['theirs', 'b'], now);
    expect(plan.assignment.map((a) => a.id)).toEqual(['b', 'a']);
    expect(plan.moves).toEqual([
      { id: 'b', scheduledFor: '2026-08-17T09:00:00.000Z' },
      { id: 'a', scheduledFor: '2026-08-18T09:00:00.000Z' },
    ]);
  });

  it('reports a pinned post the order would strand', () => {
    const rows = [
      row('a', '2026-08-17T09:00:00Z', {
        selfDestruct: {
          lifespanSeconds: 3600,
          deleteAt: '2026-08-17T12:00:00Z',
          conditions: {},
          effects: [],
        },
      }),
      row('b', '2026-08-18T09:00:00Z'),
    ];
    const plan = planQueueReorder(schedule, rows, ['b', 'a'], now);
    expect(plan.conflict?.id).toBe('a');
  });
});

describe('planQueueReorder with a row waiting on a retry', () => {
  // Weekdays at 09:00 UTC; it's Monday 10:00. A was due at 09:00, failed
  // once and is waiting to be tried again.
  const schedule = {
    timezone: 'UTC',
    slots: {
      mon: ['09:00'],
      tue: ['09:00'],
      wed: ['09:00'],
      thu: ['09:00'],
      fri: ['09:00'],
    },
  };
  const now = new Date('2026-11-16T10:00:00Z');
  const rows = [
    row('A', '2026-11-16T09:00:00+00:00'),
    row('B', '2026-11-17T09:00:00+00:00'),
    row('C', '2026-11-18T09:00:00+00:00'),
  ];

  it('leaves the overdue row where it is and swaps only the two asked for', () => {
    const plan = planQueueReorder(schedule, rows, ['C', 'B'], now);
    expect(plan.moves).toEqual([
      { id: 'C', scheduledFor: '2026-11-17T09:00:00.000Z' },
      { id: 'B', scheduledFor: '2026-11-18T09:00:00.000Z' },
    ]);
  });

  it('never moves the overdue row, even when an old order still names it', () => {
    const plan = planQueueReorder(schedule, rows, ['A', 'C', 'B'], now);
    expect(plan.moves.map((m) => m.id)).not.toContain('A');
    expect(plan.moves).toEqual([
      { id: 'C', scheduledFor: '2026-11-17T09:00:00.000Z' },
      { id: 'B', scheduledFor: '2026-11-18T09:00:00.000Z' },
    ]);
  });
});
