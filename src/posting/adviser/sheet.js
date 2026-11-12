/**
 * The posting adviser's read, laid out for the sheet that shows the draft
 * marked up (ui/AdviserSheet.jsx). Pure: the sheet renders what these return.
 *
 * The sheet shows facts only: the verdict, the tone label, each goal's status,
 * and the draft with the passages the adviser flagged. The one place model
 * prose survives is a writing note with no mechanical fix (usually clarity).
 */

import { fixableWritingIssues } from './analysis.js';

const FLAGGED = ['conflict', 'caution'];

/** The overall verdict, or null when the read had no goal checks (writing only). */
export function adviserVerdict(result) {
  const checks = Array.isArray(result?.checks) ? result.checks : [];
  if (checks.length === 0) return null;
  if (FLAGGED.includes(result?.overallStatus) || result?.overallStatus === 'ok')
    return result.overallStatus;
  if (checks.some((c) => c?.status === 'conflict')) return 'conflict';
  if (checks.some((c) => c?.status === 'caution')) return 'caution';
  return 'ok';
}

function findFirst(texts, excerpt) {
  if (typeof excerpt !== 'string' || !excerpt.trim()) return null;
  for (let post = 0; post < texts.length; post++) {
    const start = texts[post].indexOf(excerpt);
    if (start !== -1) return { post, start, end: start + excerpt.length };
  }
  return null;
}

const overlaps = (a, b) => a.start < b.end && b.start < a.end;
const contains = (outer, inner) =>
  outer.start <= inner.start && inner.end <= outer.end;

// Passages that overlap become one, carrying every key that flagged them.
function mergeOverlapping(ranges) {
  const merged = [];
  for (const range of [...ranges].sort(
    (a, b) => a.start - b.start || a.end - b.end,
  )) {
    const last = merged[merged.length - 1];
    if (last && range.start < last.end) {
      last.end = Math.max(last.end, range.end);
      last.keys.push(...range.keys);
    } else {
      merged.push({
        start: range.start,
        end: range.end,
        keys: [...range.keys],
      });
    }
  }
  return merged;
}

function fixSegments(text, from, to, fixes) {
  const out = [];
  let cursor = from;
  for (const fix of fixes) {
    if (fix.start < from || fix.end > to) continue;
    if (fix.start > cursor)
      out.push({ type: 'text', text: text.slice(cursor, fix.start) });
    out.push({
      type: 'fix',
      key: fix.key,
      text: text.slice(fix.start, fix.end),
    });
    cursor = fix.end;
  }
  if (cursor < to) out.push({ type: 'text', text: text.slice(cursor, to) });
  return out;
}

function postSegments(text, spans, fixes) {
  const sortedFixes = [...fixes].sort((a, b) => a.start - b.start);
  const out = [];
  let cursor = 0;
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    out.push(...fixSegments(text, cursor, span.start, sortedFixes));
    out.push({
      type: 'span',
      keys: span.keys,
      children: fixSegments(text, span.start, span.end, sortedFixes),
    });
    cursor = span.end;
  }
  out.push(...fixSegments(text, cursor, text.length, sortedFixes));
  return out;
}

/**
 * Place findings in the draft, in two layers, since a slip can sit inside a
 * passage a goal flags:
 *
 *   spans  passages a goal check or a writing note is about
 *   fixes  slips with a correction; may nest inside a span
 *
 * A finding goes where the composer would act on it: the first post holding
 * its excerpt, at the first occurrence, which is where applyWritingFixes and
 * applyWritingFixesToThread put a fix. Spans that overlap merge into one
 * passage carrying all their keys (several goals often flag the same words).
 * A fix that overlaps another fix, or crosses a span's edge, is left unplaced:
 * it keeps its row in the sheet, just without a mark. Earlier fixes win.
 *
 * @param {string[]} posts the draft as read, one string per post
 * @param {{spans?: Array<{key: string, excerpt: string}>, fixes?: Array<{key: string, found: string}>}} findings
 * @returns {{posts: Array<{text: string, segments: Array<object>}>, placed: Set<string>}}
 *   segments are {type: 'text', text} | {type: 'fix', key, text} |
 *   {type: 'span', keys, children: Array<text | fix segments>}
 */
export function placeAdviserMarks(posts, { spans = [], fixes = [] } = {}) {
  const texts = Array.isArray(posts)
    ? posts.map((p) => (typeof p === 'string' ? p : ''))
    : [];
  const found = texts.map(() => []);
  for (const span of spans) {
    const at = findFirst(texts, span?.excerpt);
    if (at)
      found[at.post].push({ start: at.start, end: at.end, keys: [span.key] });
  }
  const spanRanges = found.map(mergeOverlapping);
  const fixRanges = texts.map(() => []);
  const placed = new Set(spanRanges.flat().flatMap((range) => range.keys));

  for (const fix of fixes) {
    const at = findFirst(texts, fix?.found);
    if (!at || fixRanges[at.post].some((r) => overlaps(r, at))) continue;
    if (spanRanges[at.post].some((r) => overlaps(r, at) && !contains(r, at)))
      continue;
    fixRanges[at.post].push({ ...at, key: fix.key });
    placed.add(fix.key);
  }

  return {
    posts: texts.map((text, i) => ({
      text,
      segments: postSegments(text, spanRanges[i], fixRanges[i]),
    })),
    placed,
  };
}

/**
 * Everything the sheet draws for one read.
 *
 * Notes list the flagged goals (conflicts before cautions, each in check order)
 * and then the writing notes. A note whose passage was placed in the draft is
 * numbered, in list order, and its mark carries the same number.
 *
 * @param {object|null} result the analyze-post response
 * @param {string[]} posts the draft as read, one string per post
 */
export function adviserSheetModel(result, posts) {
  const checks = (Array.isArray(result?.checks) ? result.checks : []).filter(
    (c) => c && typeof c === 'object',
  );
  const writingRequested = !!(
    result?.writing && typeof result.writing === 'object'
  );
  const issues =
    writingRequested && Array.isArray(result.writing.issues)
      ? result.writing.issues.filter(
          (issue) =>
            issue && typeof issue.found === 'string' && issue.found.trim(),
        )
      : [];

  const fixable = new Set(fixableWritingIssues(issues));
  const fixes = issues
    .map((issue, index) => ({ key: `fix:${index}`, issue }))
    .filter(({ issue }) => fixable.has(issue));
  const writingNotes = issues
    .map((issue, index) => ({ key: `note:${index}`, issue }))
    .filter(({ issue }) => !fixable.has(issue));

  const flagged = FLAGGED.flatMap((status) =>
    checks
      .map((check, index) => ({ check, index }))
      .filter(({ check }) => check.status === status),
  );

  const entries = [
    ...flagged.map(({ check, index }) => ({
      note: {
        key: `check:${index}`,
        kind: 'goal',
        tone: check.status,
        label: check.label || check.id || 'Goal',
      },
      excerpt: check.excerpt,
    })),
    ...writingNotes.map(({ key, issue }) => ({
      note: {
        key,
        kind: 'writing',
        tone: 'note',
        type: issue.type,
        detail: typeof issue.note === 'string' ? issue.note : '',
      },
      excerpt: issue.found,
    })),
  ];

  const { posts: marked, placed } = placeAdviserMarks(posts, {
    spans: entries.map(({ note, excerpt }) => ({ key: note.key, excerpt })),
    fixes: fixes.map(({ key, issue }) => ({ key, found: issue.found })),
  });

  let number = 0;
  const notes = entries.map(({ note }) => ({
    ...note,
    number: placed.has(note.key) ? ++number : null,
  }));
  const marks = Object.fromEntries(
    notes
      .filter((note) => note.number)
      .map((note) => [note.key, { number: note.number, tone: note.tone }]),
  );

  return {
    verdict: adviserVerdict(result),
    tone:
      typeof result?.sentiment?.label === 'string'
        ? result.sentiment.label
        : null,
    posts: marked,
    marks,
    notes,
    met: checks
      .filter((check) => !FLAGGED.includes(check.status))
      .map((check) => check.label || check.id || 'Goal'),
    fixes: fixes.map(({ key, issue }) => ({ key, issue })),
    writingNoteCount: writingNotes.length,
    writingRequested,
  };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * The draft panel's count line: what the proofread found, less what has been
 * fixed. "1 typo", "2 slips · 1 note", "1 typo · 1 fixed", "no slips". Null
 * when the read had no proofread and nothing to count.
 *
 * @param {object} model from adviserSheetModel
 * @param {Set<string>} taken keys of fixes already taken
 */
export function adviserWritingTally(model, taken = new Set()) {
  if (!model?.writingRequested) return null;
  const remaining = model.fixes.filter((fix) => !taken.has(fix.key));
  const fixed = model.fixes.length - remaining.length;
  const parts = [];
  if (remaining.length > 0) {
    parts.push(
      remaining.every((fix) => fix.issue.type === 'typo')
        ? plural(remaining.length, 'typo', 'typos')
        : plural(remaining.length, 'slip', 'slips'),
    );
  }
  if (model.writingNoteCount > 0)
    parts.push(plural(model.writingNoteCount, 'note', 'notes'));
  if (fixed > 0) parts.push(`${fixed} fixed`);
  return parts.length > 0 ? parts.join(' · ') : 'no slips';
}

const DRAFT_LABELS = {
  post: 'your post',
  thread: 'your thread',
  reply: 'your reply',
  selfReply: 'your reply',
  quote: 'your quote post',
};

const CONTEXT_LABELS = {
  reply: 'read with its thread',
  quote: 'read with the quoted post',
  selfReply: 'read with your thread',
};

/** The draft panel's caption: what was read, and what it was read alongside. */
export function adviserDraftLabel(scenario, readWithContext = false) {
  const draft = DRAFT_LABELS[scenario] || DRAFT_LABELS.post;
  const context = readWithContext ? CONTEXT_LABELS[scenario] : null;
  return context ? `${draft} · ${context}` : draft;
}
