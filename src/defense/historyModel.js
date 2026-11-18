// The History page's words, apart from React: what each decision came to, and
// what an approval came to in all.

import { fmtInt } from '../lib/locale.js';

/** A decision in a few words: "Added", "Waiting to be added", "Kept off: you follow them". */
export function decisionPhrase(d) {
  if (d.action === 'remove') {
    if (d.state === 'done') return 'Taken off';
    if (d.state === 'already') return 'Taken off (already gone)';
    if (d.state === 'failed') return `Couldn’t take off: ${d.reason || 'the PDS refused'}`;
    return 'Waiting to be taken off';
  }
  if (d.undoneAt && d.state === 'cancelled') return 'Undone before it was written';
  if (d.undoneAt) return 'Added, then taken off';
  switch (d.state) {
    case 'done':
      return 'Added';
    case 'already':
      return 'Was on the list already';
    case 'vetoed':
      return `Kept off: ${d.reason || 'protected'}`;
    case 'failed':
      return `Couldn’t add: ${d.reason || 'the PDS refused'}`;
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Waiting to be added';
  }
}

/**
 * What an approval came to: `{ added, waiting, kept, failed, undone, live,
 * line }`, from the counts the server keeps for it. `live` is how many an
 * undo would take back.
 */
export function planOutcome(plan) {
  const c = plan?.counts || {};
  const out = {
    added: c.added || 0,
    waiting: c.waiting || 0,
    kept: c.kept || 0,
    failed: c.failed || 0,
    undone: c.undone || 0,
    live: c.live || 0,
  };
  const parts = [
    out.added ? `${fmtInt(out.added)} added` : null,
    out.waiting ? `${fmtInt(out.waiting)} waiting` : null,
    out.kept ? `${fmtInt(out.kept)} kept off by the veto` : null,
    out.failed ? `${fmtInt(out.failed)} couldn’t be added` : null,
    out.undone ? `${fmtInt(out.undone)} undone` : null,
  ].filter(Boolean);
  out.line = parts.length ? parts.join(' · ') : 'Nothing to add';
  return out;
}
