// The Defense page's words and lists, apart from React, so the tests can pin
// them: which of your posts to offer for a scan, what each account's line
// says, how far along a scan is, and the scan as rows for an export.

import { fmtInt } from '../lib/locale.js';
import { SCAN_SECTORS, sectorKey } from './radar.js';
import { BAND_WORD } from './bandWords.js';
import { STAGES } from './scan.js';

const DAY_MS = 86_400_000;

/**
 * Your posts worth scanning: from the last `days`, the ones with the most
 * replies and quotes (the engagement a pile-on is made of), reposts breaking
 * a tie. A post nobody answered isn't offered.
 */
export function postsToScan(posts, { now = Date.now(), days = 30, limit = 4 } = {}) {
  const since = now - days * DAY_MS;
  const loud = (p) => (p.replies || 0) + (p.quotes || 0);
  return (posts || [])
    .filter((p) => p?.uri && Date.parse(p.at) >= since && loud(p) > 0)
    .sort((a, b) => loud(b) - loud(a) || (b.reposts || 0) - (a.reposts || 0) || Date.parse(b.at) - Date.parse(a.at))
    .slice(0, limit);
}

/** How many of the people you follow follow this account, in words. */
export function vouchPhrase(row, vouchCheck = 'canary') {
  if (row.youFollow) return 'You follow them';
  if (vouchCheck !== 'canary') return 'Who you know in common couldn’t be checked';
  const n = row.vouches || 0;
  if (!n) return 'Nobody you follow follows them';
  return n === 1 ? '1 person you follow follows them' : `${fmtInt(n)} people you follow follow them`;
}

/** What an account did to the post, as a phrase: its loudest engagement first. */
export function didPhrase(row) {
  const kinds = Object.keys(row.engagements || {});
  const words = SCAN_SECTORS.filter((s) => kinds.some((k) => sectorKey(k) === s.key)).map((s) => s.verb);
  if (!words.length) return 'Engaged';
  const text = words.length === 1 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Why an account is protected, when it is, as the score says it. */
export function protectedPhrase(row) {
  if (row.band !== 'PROTECTED' || !row.protectedReason) return null;
  return row.protectedReason.charAt(0).toUpperCase() + row.protectedReason.slice(1);
}

/** The radar's callout for one account. */
export function describeRow(row, vouchCheck = 'canary') {
  const title = row.handle ? `@${row.handle}` : row.displayName || row.did;
  return {
    title,
    lines: [
      `${BAND_WORD[row.band] || row.band}. ${vouchPhrase(row, vouchCheck)}`,
      didPhrase(row),
      row.followsYou ? 'Follows you' : null,
      row.blocksYou ? 'Blocks you' : null,
    ].filter(Boolean),
  };
}

/**
 * The facts on an account's line in the list: how you know it (or why it is
 * protected), what it did, its reach. Each is a short phrase; the page puts
 * dots between them, and a phone's line keeps the first.
 */
export function rowFacts(row, vouchCheck = 'canary') {
  return [
    (row.band === 'PROTECTED' && protectedPhrase(row)) || vouchPhrase(row, vouchCheck),
    didPhrase(row),
    row.followers ? `${fmtInt(row.followers)} ${row.followers === 1 ? 'follower' : 'followers'}` : null,
    row.blocksYou ? 'blocks you' : null,
  ].filter(Boolean);
}

/** Where a scan is, in a line: the stage, and how far through it when that's known. */
export function stageLine(state) {
  const stage = STAGES.find((s) => s.key === state?.stage);
  if (!stage) return 'Starting…';
  const p = state.progress;
  if (!p?.total) return `${stage.label}…`;
  const of = `${fmtInt(Math.min(p.done, p.total))} of ${fmtInt(p.total)}`;
  if (stage.key === 'harvest') return `${stage.label}: ${of} ${p.total === 1 ? 'kind' : 'kinds'} of engagement`;
  if (stage.key === 'score') return `${stage.label}: ${of} ${p.total === 1 ? 'account' : 'accounts'}`;
  return `${stage.label}: ${of}`;
}

/** How far along a scan is, from 0 to 1, for the bar under its line. */
export function stageFraction(state) {
  const i = STAGES.findIndex((s) => s.key === state?.stage);
  if (i < 0) return 0;
  const p = state.progress;
  const within = p?.total ? Math.min(1, p.done / p.total) : 0;
  return (i + within) / STAGES.length;
}

/** Every account in a scan as a CSV's rows, header first. */
export function scanCsvRows(summary) {
  const header = ['did', 'handle', 'display_name', 'band', 'trust', 'vouches', 'you_follow', 'follows_you', 'followers', 'engagement', 'records'];
  const rows = (summary?.rows || []).map((r) => [
    r.did,
    r.handle || '',
    r.displayName || '',
    r.band,
    r.trust ?? '',
    summary.vouchCheck === 'canary' ? (r.vouches ?? 0) : '',
    r.youFollow ? 'yes' : 'no',
    r.followsYou ? 'yes' : 'no',
    r.followers ?? '',
    Object.keys(r.engagements || {}).join(' '),
    r.total ?? '',
  ]);
  return [header, ...rows];
}
