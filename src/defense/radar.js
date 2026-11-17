// Where each mark on the radar goes, and what a scan puts on it.
//
// You are at the centre. A band is a ring: protected innermost, then
// connected, then peripheral, and everyone with no connection in the wide
// outer ring, notable accounts among them. A sector is a slice of the circle:
// what an account did to the post (its loudest engagement, harvest.js
// KIND_ORDER).
//
// Inside its ring and sector, an account's place comes from a hash of its
// DID, so it sits in the same spot every time the radar is drawn and doesn't
// jump when something else changes. All distances are fractions of the
// circle's radius. Pure, so the tests run it without a browser.
//
// The strangers aren't drawn one by one: a pile-on is mostly them, and a
// thousand marks would hide the dozen that matter. They are texture, a dot
// for each of them up to a cap, shared out between the sectors by count.
//
// Ported from bluesky-mod (src/panel/public/lib/radar-layout.js, and the
// scan's sectors from views/shared.js), MIT.

import { BANDS } from './score.js';

/** Inner and outer radius of each ring. */
export const RINGS = Object.freeze({
  PROTECTED: [0.04, 0.145],
  CONNECTED: [0.2, 0.31],
  PERIPHERAL: [0.37, 0.5],
  OUTER: [0.58, 0.97],
});

/** Where one ring ends and the next begins. */
export const EDGES = Object.freeze({ PROTECTED: 0.17, CONNECTED: 0.34, PERIPHERAL: 0.535, OUTER: 1 });

/** The ring a band is drawn in. */
export const ringOf = (band) => (band === 'PROTECTED' || band === 'CONNECTED' || band === 'PERIPHERAL' ? band : 'OUTER');

/** The ring at a distance from the centre, or null outside the circle. */
export function ringAt(r) {
  if (r > EDGES.OUTER) return null;
  if (r <= EDGES.PROTECTED) return 'PROTECTED';
  if (r <= EDGES.CONNECTED) return 'CONNECTED';
  if (r <= EDGES.PERIPHERAL) return 'PERIPHERAL';
  return 'OUTER';
}

/** Two numbers in [0, 1) from a string, the same every time (FNV-1a). */
export function spots(text) {
  let a = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    a ^= text.charCodeAt(i);
    a = Math.imul(a, 0x01000193);
  }
  const b = Math.imul(a ^ (a >>> 15), 0x2c1b3c6d);
  const c = Math.imul(b ^ (b >>> 12), 0x297a2d39);
  return [((b ^ (b >>> 15)) >>> 0) / 4294967296, ((c ^ (c >>> 15)) >>> 0) / 4294967296];
}

/**
 * The slices of the circle, clockwise from the top: for each, where it
 * starts and ends and its middle, as angles on screen (0 is to the right,
 * growing clockwise, since y grows downward).
 */
export function sectorAngles(n) {
  const count = Math.max(1, n);
  const span = (2 * Math.PI) / count;
  return Array.from({ length: count }, (_, i) => {
    const start = -Math.PI / 2 + i * span;
    return { start, end: start + span, mid: start + span / 2 };
  });
}

/** The slice an angle falls in. */
export function sectorAt(angle, n) {
  const span = (2 * Math.PI) / Math.max(1, n);
  const turned = (((angle + Math.PI / 2) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return Math.min(n - 1, Math.floor(turned / span));
}

/** How far from a sector's edges marks stay, so a slice reads as a slice. */
const EDGE_GAP = 0.09;

function spot(ring, slice, u, v) {
  const [lo, hi] = RINGS[ring];
  const span = slice.end - slice.start;
  // Fewer sectors than three leave no edge to keep away from.
  const gap = Math.min(EDGE_GAP, span / 6);
  const angle = slice.start + gap + u * (span - 2 * gap);
  // Even over the ring's area, not bunched at its inner edge.
  const r = Math.sqrt(lo * lo + v * (hi * hi - lo * lo));
  return { x: r * Math.cos(angle), y: r * Math.sin(angle), r, angle };
}

/**
 * Place accounts. Each needs `id`, `band` and `sector` (an index into the
 * slices). Returns them with x and y from -1 to 1 and their ring.
 */
export function place(points, sectorCount) {
  const slices = sectorAngles(sectorCount);
  return points.map((p) => {
    const ring = ringOf(p.band);
    const slice = slices[Math.min(slices.length - 1, Math.max(0, p.sector || 0))];
    const [u, v] = spots(p.id);
    return { ...p, ring, ...spot(ring, slice, u, v) };
  });
}

/**
 * The strangers, as texture: at most `max` small marks shared out between
 * the sectors by how many strangers each holds. A sector with any gets at
 * least one, so nothing that is there looks empty.
 */
export function texture(counts, { max = 700 } = {}) {
  const total = counts.reduce((a, b) => a + (b || 0), 0);
  if (!total) return [];
  const slices = sectorAngles(counts.length);
  const scale = Math.min(1, max / total);
  const out = [];
  counts.forEach((count, sector) => {
    const n = count ? Math.max(1, Math.round(count * scale)) : 0;
    for (let i = 0; i < n; i += 1) {
      const [u, v] = spots(`far:${sector}:${i}`);
      out.push({ sector, ...spot('OUTER', slices[sector], u, v) });
    }
  });
  return out;
}

/** The placed account nearest a point, within `within`, or null. */
export function nearest(placed, x, y, within) {
  let best = null;
  let bestD = within * within;
  for (const p of placed) {
    const d = (p.x - x) ** 2 + (p.y - y) ** 2;
    if (d <= bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

/**
 * The order the arrow keys walk the accounts in: ring by ring from the
 * centre, and round each ring clockwise from the top.
 */
export function walkOrder(placed) {
  const rank = { PROTECTED: 0, CONNECTED: 1, PERIPHERAL: 2, OUTER: 3 };
  const turn = (p) => (((p.angle + Math.PI / 2) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return [...placed].sort((a, b) => rank[a.ring] - rank[b.ring] || turn(a) - turn(b));
}

/* ---- a scan on the radar -------------------------------------------- */

/**
 * The slices a scan is cut into, clockwise from the top, and the words for
 * each. `other` is engagement from outside Bluesky's own kinds, and is only
 * a slice when someone did that.
 */
export const SCAN_SECTORS = Object.freeze([
  { key: 'quote', name: 'Quoted', verb: 'quoted' },
  { key: 'reply', name: 'Replied', verb: 'replied in the thread' },
  { key: 'repost', name: 'Reposted', verb: 'reposted' },
  { key: 'like', name: 'Liked', verb: 'liked' },
  { key: 'other', name: 'Other', verb: 'linked to it from another app' },
]);

/** The slice a row's loudest engagement falls in. */
export function sectorKey(kind) {
  if (kind === 'quote' || kind === 'repost' || kind === 'like') return kind;
  if (kind === 'reply' || kind === 'threadReply') return 'reply';
  return 'other';
}

/**
 * A scan summary (score.js summarise) as the radar draws it: the slices, with
 * how many engaged that way and how many of them are strangers, and a mark
 * for everyone who isn't a stranger. `row` rides along on each mark for the
 * callout and for picking.
 */
export function scanRadar(summary) {
  const rows = summary?.rows || [];
  const keyed = rows.map((row) => ({ row, key: sectorKey(row.primary) }));
  const used = SCAN_SECTORS.filter((s) => s.key !== 'other' || keyed.some((x) => x.key === 'other'));
  const index = new Map(used.map((s, i) => [s.key, i]));
  const sectors = used.map((s) => {
    const mine = keyed.filter((x) => x.key === s.key);
    return { ...s, total: mine.length, far: mine.filter((x) => x.row.band === 'UNKNOWN').length };
  });
  const points = keyed
    .filter((x) => x.row.band !== 'UNKNOWN')
    .map(({ row, key }) => ({ id: row.did, band: row.band, sector: index.get(key), row }));
  const byBand = Object.fromEntries(BANDS.map((b) => [b, rows.filter((r) => r.band === b).length]));
  return { sectors, points, byBand, total: rows.length };
}

/** The band × slice counts, for the radar's table. */
export function radarTable(summary) {
  const { sectors } = scanRadar(summary);
  const rows = summary?.rows || [];
  return BANDS.map((band) => ({
    band,
    cells: sectors.map((s) => rows.filter((r) => r.band === band && sectorKey(r.primary) === s.key).length),
    total: rows.filter((r) => r.band === band).length,
  }));
}
