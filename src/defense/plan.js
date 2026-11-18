// From a scan to a plan: who would be added to a list, by the bands the owner
// ticks, and how long writing them takes.
//
// A plan names DIDs, their band and their trust key, and nothing else: no
// handles, no names, no text anyone else wrote (docs/DEFENSE.md, What's
// stored). PROTECTED is never in one, whatever is ticked, and the server
// refuses a plan that names anyone in it; the veto at the write (veto.js) is
// what finally decides.
//
// The pace is the server's (pace.js): a batch of BATCH every BATCH_GAP_MS per
// account that holds a list. Ported from bluesky-mod's bulkPlan.js
// (estimateWrites).

import { fmtInt } from '../lib/locale.js';
import { BATCH, BATCH_GAP_MS, POINTS_PER_CREATE, POINTS_PER_HOUR } from './pace.js';

export { BATCH, BATCH_GAP_MS };

/** The bands a plan may take, nearest last: PROTECTED is never one of them. */
export const APPROVABLE_BANDS = Object.freeze(['UNKNOWN', 'NOTABLE', 'PERIPHERAL', 'CONNECTED']);

/** What is ticked to start with: the strangers, and nobody anyone would notice. */
export const DEFAULT_BANDS = Object.freeze(['UNKNOWN']);

/** The most accounts one plan may add. A bigger pile-on is two plans. */
export const PLAN_MAX = 10_000;

/** The words the owner may give a plan, at most. */
export const NOTE_MAX = 500;

/**
 * The rows a plan would add: everyone in the ticked bands (never PROTECTED),
 * not already on the list, nearest first within a band. `listed` is a Set of
 * DIDs already on it.
 */
export function planRows(summary, bands, { listed = new Set() } = {}) {
  const ticked = new Set((bands || []).filter((b) => APPROVABLE_BANDS.includes(b)));
  return (summary?.rows || [])
    .filter((r) => r?.did && ticked.has(r.band) && r.band !== 'PROTECTED' && !r.youFollow && !listed.has(r.did))
    .map((r) => ({ did: r.did, band: r.band, trust: Number.isFinite(r.trust) ? r.trust : null }));
}

/** How many of the scan each band would add, for the ticks' labels. */
export function bandCounts(summary, { listed = new Set() } = {}) {
  const out = Object.fromEntries(APPROVABLE_BANDS.map((b) => [b, 0]));
  for (const r of summary?.rows || []) if (out[r.band] != null && !r.youFollow && !listed.has(r.did)) out[r.band] += 1;
  return out;
}

/**
 * How long `n` additions take at the server's pace: `{ writes, points,
 * minutes }`, where `minutes` is the larger of the pace and the write limit.
 */
export function estimateWrites(n) {
  const writes = Math.max(0, Math.floor(n || 0));
  const points = writes * POINTS_PER_CREATE;
  const batches = Math.ceil(writes / BATCH);
  const byPace = Math.max(0, batches - 1) * (BATCH_GAP_MS / 60_000);
  const byPoints = (points / POINTS_PER_HOUR) * 60;
  return { writes, points, minutes: Math.ceil(Math.max(byPace, writes ? byPoints : 0)) };
}

/** The estimate in words: "about 20 minutes", "about 3.5 hours", "a minute or two". */
export function estimateWords(n) {
  const { writes, minutes } = estimateWrites(n);
  if (!writes) return 'nothing to write';
  if (minutes < 2) return 'a minute or two';
  if (minutes < 90) return `about ${fmtInt(minutes)} minutes`;
  return `about ${(minutes / 60).toFixed(1)} hours`;
}

/** The owner's words, trimmed and capped, or null. */
export function cleanNote(text) {
  const t = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  return t ? t.slice(0, NOTE_MAX) : null;
}
