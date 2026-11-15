import { describe, expect, it } from 'vitest';
import {
  ANNOTATION_LABEL_MAX,
  addAnnotation,
  cleanAnnotations,
  followerMilestones,
  markText,
  marksOnSeries,
  milestoneSteps,
  noteMark,
  readAnnotations,
  removeAnnotation,
  writeAnnotations,
} from './annotations.js';
import { bucketSeries } from '../lib/analytics.js';

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();

describe('notes', () => {
  it('keeps what can be drawn, oldest day first', () => {
    const list = cleanAnnotations([
      { id: 'b', day: '2026-10-03', label: '  Zine went out  ' },
      { id: 'a', day: '2026-09-16', label: 'Changed my handle' },
      { id: 'a', day: '2026-09-17', label: 'same id again' },
      { id: 'c', day: 'October', label: 'no day' },
      { id: 'd', day: '2026-10-04', label: '   ' },
      { day: '2026-10-05', label: 'no id' },
      null,
    ]);
    expect(list).toEqual([
      { id: 'a', day: '2026-09-16', label: 'Changed my handle' },
      { id: 'b', day: '2026-10-03', label: 'Zine went out' },
    ]);
    expect(cleanAnnotations('nope')).toEqual([]);
  });

  it('adds and removes, and refuses a note that says nothing', () => {
    let list = addAnnotation([], { day: '2026-10-03', label: 'Zine went out', id: 'x' });
    expect(list).toEqual([{ id: 'x', day: '2026-10-03', label: 'Zine went out' }]);
    expect(addAnnotation(list, { day: '2026-10-04', label: '' })).toBe(list);
    expect(addAnnotation(list, { day: 'soon', label: 'A day that isn’t one' })).toBe(list);
    list = addAnnotation(list, { day: '2026-01-01', label: 'x'.repeat(200), id: 'y' });
    expect(list[0].label).toHaveLength(ANNOTATION_LABEL_MAX);
    expect(removeAnnotation(list, 'y')).toEqual([{ id: 'x', day: '2026-10-03', label: 'Zine went out' }]);
  });

  it('is kept per account', () => {
    const data = new Map();
    const store = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
    writeAnnotations('did:plc:a', [{ id: 'x', day: '2026-10-03', label: 'Mine' }], store);
    expect(readAnnotations('did:plc:a', store)).toHaveLength(1);
    expect(readAnnotations('did:plc:b', store)).toEqual([]);
    data.set('virga:annotations:did:plc:b', '{broken');
    expect(readAnnotations('did:plc:b', store)).toEqual([]);
  });
});

describe('milestones', () => {
  it('steps through the round numbers', () => {
    expect(milestoneSteps(99)).toEqual([]);
    expect(milestoneSteps(1000)).toEqual([100, 250, 500, 1000]);
    expect(milestoneSteps(6000)).toEqual([100, 250, 500, 1000, 2500, 5000]);
  });

  it('dates each one by the follower who made it', () => {
    const followers = Array.from({ length: 260 }, (_, i) => ({ did: `did:plc:${i}`, followedAt: new Date(at(2026, 1, 1) + i * 86_400_000).toISOString() }));
    // Out of order on purpose: the walk pages newest first.
    const marks = followerMilestones([...followers].reverse());
    expect(marks.map((m) => m.count)).toEqual([100, 250]);
    expect(marks[0]).toMatchObject({ t: at(2026, 1, 1) + 99 * 86_400_000, label: '100 followers', kind: 'milestone' });
    expect(marks[1].t).toBe(at(2026, 1, 1) + 249 * 86_400_000);
  });

  it('counts followers with no date from the start', () => {
    const dated = Array.from({ length: 60 }, (_, i) => ({ followedAt: new Date(at(2026, 1, 1) + i * 86_400_000).toISOString() }));
    const undated = Array.from({ length: 50 }, () => ({ followedAt: null }));
    const [hundred] = followerMilestones([...dated, ...undated]);
    // 50 with no date, so the 50th dated follower is the 100th.
    expect(hundred).toMatchObject({ count: 100, t: at(2026, 1, 1) + 49 * 86_400_000 });
    // More undated than the milestone: it can't be dated at all.
    expect(followerMilestones([...Array.from({ length: 120 }, () => ({})), ...dated]).map((m) => m.count)).toEqual([]);
    expect(followerMilestones(null)).toEqual([]);
  });
});

describe('marks on a chart', () => {
  const t0 = at(2026, 10, 1, 0);
  const t1 = at(2026, 10, 31, 23);
  const daily = bucketSeries([], { unit: 'day', t0, t1, pickTime: (x) => x });
  const weekly = bucketSeries([], { unit: 'week', t0, t1, pickTime: (x) => x });

  it('lands each mark in the bucket holding its day', () => {
    const marks = [noteMark({ id: 'a', day: '2026-10-03', label: 'Zine went out' }), { t: at(2026, 10, 20, 9), label: '5,000 followers', kind: 'milestone' }];
    const onDays = marksOnSeries(daily, 'day', marks);
    expect(onDays.map((m) => [new Date(m.t).getDate(), m.kind])).toEqual([[3, 'note'], [20, 'milestone']]);
    expect(onDays[0].i).toBe(2);
    expect(markText(onDays[1], 'day')).toBe('Oct 20: 5,000 followers');
    const onWeeks = marksOnSeries(weekly, 'week', marks);
    expect(onWeeks).toHaveLength(2);
    expect(markText(onWeeks[0], 'week')).toMatch(/^wk of .*: Zine went out$/);
  });

  it('puts two marks in one bucket together, and reads as the note', () => {
    const marks = [{ t: at(2026, 10, 3, 8), label: '1,000 followers', kind: 'milestone' }, noteMark({ id: 'a', day: '2026-10-03', label: 'Zine went out' })];
    const [one] = marksOnSeries(daily, 'day', marks);
    expect(one.kind).toBe('note');
    expect(markText(one, 'day')).toBe('Oct 3: 1,000 followers; Zine went out');
  });

  it('leaves out what the chart doesn’t reach', () => {
    expect(marksOnSeries(daily, 'day', [noteMark({ id: 'a', day: '2025-01-01', label: 'Long ago' })])).toEqual([]);
    expect(marksOnSeries([], 'day', [noteMark({ id: 'a', day: '2026-10-03', label: 'x' })])).toEqual([]);
    expect(marksOnSeries(daily, 'day', null)).toEqual([]);
  });
});
