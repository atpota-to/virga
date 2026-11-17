import { describe, expect, it } from 'vitest';
import { EDGES, RINGS, nearest, place, radarTable, ringAt, ringOf, scanRadar, sectorAngles, sectorAt, sectorKey, spots, texture, walkOrder } from './radar.js';

describe('where the radar puts a mark', () => {
  const points = [
    { id: 'did:plc:a', band: 'PROTECTED', sector: 0 },
    { id: 'did:plc:b', band: 'CONNECTED', sector: 1 },
    { id: 'did:plc:c', band: 'PERIPHERAL', sector: 2 },
    { id: 'did:plc:d', band: 'NOTABLE', sector: 3 },
    { id: 'did:plc:e', band: 'UNKNOWN', sector: 0 },
  ];

  it('is the same every time, and differs between accounts', () => {
    expect(place(points, 4)).toEqual(place(points, 4));
    expect(spots('did:plc:a')).not.toEqual(spots('did:plc:b'));
    const [u, v] = spots('did:plc:a');
    expect(u).toBeGreaterThanOrEqual(0);
    expect(u).toBeLessThan(1);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });

  it('keeps each band in its ring and each account in its slice', () => {
    const many = [];
    for (let i = 0; i < 400; i += 1) {
      many.push({ id: `did:plc:m${i}`, band: ['PROTECTED', 'CONNECTED', 'PERIPHERAL', 'NOTABLE'][i % 4], sector: i % 5 });
    }
    for (const p of place(many, 5)) {
      const [lo, hi] = RINGS[p.ring];
      expect(p.r).toBeGreaterThanOrEqual(lo);
      expect(p.r).toBeLessThanOrEqual(hi);
      expect(ringAt(p.r)).toBe(p.ring);
      expect(sectorAt(p.angle, 5)).toBe(p.sector);
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(p.r, 10);
    }
  });

  it('draws notable accounts out with the strangers', () => {
    expect(ringOf('NOTABLE')).toBe('OUTER');
    expect(ringOf('UNKNOWN')).toBe('OUTER');
    expect(ringOf('CONNECTED')).toBe('CONNECTED');
  });

  it('knows which ring a point is in', () => {
    expect(ringAt(0.1)).toBe('PROTECTED');
    expect(ringAt(EDGES.PROTECTED + 0.01)).toBe('CONNECTED');
    expect(ringAt(0.45)).toBe('PERIPHERAL');
    expect(ringAt(0.9)).toBe('OUTER');
    expect(ringAt(1.01)).toBe(null);
  });

  it('cuts the circle clockwise from the top', () => {
    const [first, second] = sectorAngles(4);
    expect(first.start).toBeCloseTo(-Math.PI / 2);
    expect(second.start).toBeCloseTo(0);
    expect(sectorAt(-Math.PI / 2 + 0.01, 4)).toBe(0);
    expect(sectorAt(Math.PI / 2 - 0.01, 4)).toBe(1);
    expect(sectorAt(Math.PI - 0.01, 4)).toBe(2);
    expect(sectorAngles(0)).toHaveLength(1);
  });

  it('shares the strangers out as texture, at most the cap, none hidden', () => {
    const dots = texture([5000, 0, 1, 300], { max: 200 });
    expect(dots.length).toBeLessThanOrEqual(203);
    expect(dots.filter((d) => d.sector === 1)).toHaveLength(0);
    expect(dots.filter((d) => d.sector === 2)).toHaveLength(1);
    for (const d of dots) expect(ringAt(d.r)).toBe('OUTER');
    expect(texture([0, 0])).toEqual([]);
  });

  it('finds the nearest mark and walks them from the centre out', () => {
    const placed = place(points, 4);
    const b = placed.find((p) => p.id === 'did:plc:b');
    expect(nearest(placed, b.x, b.y, 0.01)).toBe(b);
    expect(nearest(placed, 5, 5, 0.01)).toBeNull();
    expect(walkOrder(placed).map((p) => p.ring)).toEqual(['PROTECTED', 'CONNECTED', 'PERIPHERAL', 'OUTER', 'OUTER']);
  });
});

describe('a scan on the radar', () => {
  const row = (did, band, primary) => ({ did, band, primary });
  const summary = {
    rows: [
      row('did:plc:q1', 'UNKNOWN', 'quote'),
      row('did:plc:q2', 'CONNECTED', 'quote'),
      row('did:plc:r1', 'UNKNOWN', 'threadReply'),
      row('did:plc:r2', 'PROTECTED', 'reply'),
      row('did:plc:l1', 'UNKNOWN', 'like'),
      row('did:plc:l2', 'NOTABLE', 'like'),
      row('did:plc:p1', 'PERIPHERAL', 'repost'),
    ],
  };

  it('puts each engagement in its slice, replies anywhere in the thread together', () => {
    expect(sectorKey('reply')).toBe('reply');
    expect(sectorKey('threadReply')).toBe('reply');
    expect(sectorKey('gate')).toBe('other');
    expect(sectorKey('other')).toBe('other');
    expect(sectorKey(undefined)).toBe('other');
  });

  it('counts each slice and its strangers, and marks everyone else', () => {
    const r = scanRadar(summary);
    expect(r.sectors.map((s) => [s.key, s.total, s.far])).toEqual([
      ['quote', 2, 1],
      ['reply', 2, 1],
      ['repost', 1, 0],
      ['like', 2, 1],
    ]);
    expect(r.points.map((p) => [p.id, p.band, p.sector])).toEqual([
      ['did:plc:q2', 'CONNECTED', 0],
      ['did:plc:r2', 'PROTECTED', 1],
      ['did:plc:l2', 'NOTABLE', 3],
      ['did:plc:p1', 'PERIPHERAL', 2],
    ]);
    expect(r.byBand).toEqual({ PROTECTED: 1, CONNECTED: 1, PERIPHERAL: 1, NOTABLE: 1, UNKNOWN: 3 });
    expect(r.total).toBe(7);
  });

  it('adds a slice for other apps only when someone used one', () => {
    const r = scanRadar({ rows: [...summary.rows, row('did:plc:o', 'UNKNOWN', 'other')] });
    expect(r.sectors.map((s) => s.key)).toEqual(['quote', 'reply', 'repost', 'like', 'other']);
    expect(scanRadar({ rows: [] }).sectors).toHaveLength(4);
    expect(scanRadar(null).total).toBe(0);
  });

  it('gives the same counts as a table, band by slice', () => {
    const t = radarTable(summary);
    expect(t.find((r) => r.band === 'UNKNOWN')).toEqual({ band: 'UNKNOWN', cells: [1, 1, 0, 1], total: 3 });
    expect(t.map((r) => r.total).reduce((a, b) => a + b)).toBe(7);
  });
});
