// Pure text edits the composer's editor makes: replacing a range, picking a
// mention, turning a pasted address into an inline link, taking a pasted
// post link out once it has become a quote, and splitting an over-long post
// into a thread. Offsets are UTF-16 indexes into the textarea's value.

import {
  countComposerGraphemes,
  isSingleAddress,
  labelMisleads,
  linkDestination,
  findInlineLinks,
} from '../lib/inlineLinks.js';
import { MAX_POST_GRAPHEMES } from '../lib/composerModel.js';

const str = (v) => (typeof v === 'string' ? v : '');
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

/** `text` with `[start, end)` replaced by `insertion`; the caret goes after it. */
export function replaceRange(text, start, end, insertion) {
  const source = str(text);
  const from = clamp(Number(start) || 0, 0, source.length);
  const to = clamp(Number.isFinite(end) ? end : from, from, source.length);
  const add = str(insertion);
  return {
    text: source.slice(0, from) + add + source.slice(to),
    caret: from + add.length,
  };
}

/**
 * The text once a typeahead pick replaces the partial mention at `range`
 * (detectPartialMention's `{ start, end }`, `start` at the "@"): "@handle "
 * with one space after it, unless a space already follows.
 */
export function insertMention(text, range, handle) {
  const source = str(text);
  const clean = str(handle).replace(/^@/, '').trim();
  if (!clean || !range) return { text: source, caret: source.length };
  const after = source.slice(range.end);
  const spacer = /^\s/.test(after) ? '' : ' ';
  const { text: out, caret } = replaceRange(
    source,
    range.start,
    range.end,
    `@${clean}${spacer}`,
  );
  return { text: out, caret: spacer ? caret : caret + 1 };
}

/**
 * What pasting `pasted` over the selection `[start, end)` should do when the
 * selection is words and the paste is one web address: `{ text, caret }` with
 * the words linked as `[words](address)`, or `{ refused }` with the sentence
 * to show when the words name a different site. Null when the paste isn't
 * one of those (let the browser paste it).
 */
export function pasteAsInlineLink(text, start, end, pasted) {
  const source = str(text);
  if (!(end > start)) return null;
  const url = str(pasted).trim();
  if (!/^https?:\/\/\S+$/i.test(url)) return null;
  const destination = linkDestination(url);
  if (!destination) return null;
  const label = source.slice(start, end);
  if (!label.trim() || /[[\]\n]/.test(label) || isSingleAddress(label))
    return null;
  if (labelMisleads(label, destination)) {
    return { refused: misleadingSentence(label, destination) };
  }
  const { text: out, caret } = replaceRange(
    source,
    start,
    end,
    `[${label}](${url})`,
  );
  return { text: out, caret };
}

function hostOf(uri) {
  try {
    return new URL(uri).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function misleadingSentence(label, uri) {
  const host = hostOf(uri);
  return `“${label.trim()}” names a different site than this link goes to${host ? ` (${host})` : ''}, so it stays as typed.`;
}

/**
 * Sentences for the inline links in `text` that won't become links because
 * their words name another site, one per link.
 */
export function misleadingLinkNotes(text) {
  return findInlineLinks(str(text))
    .filter((l) => l.misleading)
    .map((l) => misleadingSentence(l.label, l.uri));
}

/**
 * `text` with the link at `[charStart, charEnd)` taken out, once it has
 * become an attachment, with the space it leaves. `expect` is what the range
 * held when the link was found; when the writer has changed it since, the
 * text comes back unchanged.
 */
export function removeLinkFromText(text, { charStart, charEnd, expect } = {}) {
  const source = str(text);
  if (!(charEnd > charStart) || charEnd > source.length) return source;
  if (expect != null && source.slice(charStart, charEnd) !== expect)
    return source;
  const before = source.slice(0, charStart);
  let after = source.slice(charEnd);
  if (!before.trim() || (/[ \t]$/.test(before) && /^[ \t]/.test(after)))
    after = after.replace(/^[ \t]+/, '');
  if (!after.trim()) return before.replace(/\s+$/, '');
  return before + after;
}

/**
 * An over-long post cut into posts that each fit `max` graphemes (counted as
 * they'll be written, links shortened), at the last paragraph, sentence or
 * word break that fits. A word longer than a whole post is cut where it must.
 */
export function splitForThread(text, max = MAX_POST_GRAPHEMES) {
  const parts = [];
  let rest = str(text).trim();
  const fits = (s) => countComposerGraphemes(s.trim()) <= max;
  while (rest && !fits(rest)) {
    const cut = bestCut(rest, fits);
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts.length ? parts : [''];
}

function bestCut(text, fits) {
  // The longest prefix that fits, by binary search over code units.
  let lo = 1;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(text.slice(0, mid))) lo = mid;
    else hi = mid - 1;
  }
  const room = text.slice(0, lo);
  for (const pattern of [/\n\s*\n/g, /[.!?…](?=\s)/g, /\s/g]) {
    let at = -1;
    for (const m of room.matchAll(pattern)) at = m.index + m[0].length;
    // A break that leaves the first post nearly empty isn't worth taking.
    if (at > room.length * 0.4) return at;
  }
  // No break: never cut a surrogate pair in half.
  const code = text.charCodeAt(lo - 1);
  return code >= 0xd800 && code <= 0xdbff ? lo - 1 : lo;
}
