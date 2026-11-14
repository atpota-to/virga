/**
 * Turning one over-long post into a thread.
 *
 * `splitIntoThread` cuts the composer's text into posts that each fit the
 * limit as the composer counts it: inline links collapsed to their labels and
 * links shortened (`countComposerGraphemes`), in grapheme clusters, and inside
 * the lexicon's byte cap as well. The count of a post is added up from the
 * counts of its words, each measured with the composer's own function, so the
 * two can't disagree.
 *
 * Where it cuts:
 * - Only between words, unless one unbroken run is longer than a whole post;
 *   that run is cut between grapheme clusters, and after 。！？ in text written
 *   without spaces.
 * - Never inside a URL, a mention, an email address, a hashtag or an inline
 *   link, and never where the cut would make one that wasn't there (a `#` or
 *   `@` that would start a post, a domain that would end one). One of those
 *   longer than a post is left whole in a post of its own, over the limit,
 *   where the composer flags it.
 * - At the best breaks it can find. Every cut has a cost by what it breaks
 *   (nothing for a blank line, little for a line break, more for a sentence
 *   end, far more for the middle of a sentence, most for the middle of a
 *   word) and every post has a small cost. The cheapest split wins: a
 *   paragraph isn't broken to save one post, and a sentence is only broken
 *   when it is longer than a post. Among equals the earlier posts are the
 *   fuller ones.
 *
 * Numbering is a counter on a line of its own at the end of each post:
 *
 *     …the words of the post.
 *
 *     2/5
 *
 * At the end, so the first words of every post stay the writer's (they are
 * what a notification, a quote and a search result show). With the total, so
 * a reader who lands in the middle knows how much there is. Plain digits and
 * a slash, so it costs little of the 300, reads the same in any language and
 * can be found again; on its own line, so a post that happens to end in "4/5"
 * is never mistaken for one. Room is kept for two digits each side (a thread
 * is at most 25 posts), so numbering never changes with the count.
 *
 * The split is stable: `splitIntoThread(joinThread(posts, options), options)`
 * gives `posts` back. A blank line is the cheapest place to cut, so cutting
 * where the posts were joined is never beaten. (The one exception is text
 * spaced with runs of three or more spaces or line breaks where it was cut,
 * which is a little shorter joined than it was.)
 */

import {
  composerCountText,
  countComposerGraphemes,
  findInlineLinks,
} from './inlineLinks.js';
import { findUrlsAndMentions } from './urlMatching.js';
import { findHashtags } from './hashtags.js';
import { countGraphemes } from './graphemes.js';
import { utf8Length } from './richText.js';
import { MAX_POST_BYTES, MAX_POST_GRAPHEMES } from './composerModel.js';

/** The ways a split can number its posts: not at all, or "2/5". */
export const THREAD_NUMBERING = Object.freeze(['off', 'counter']);

// What a cut breaks, from worst to best.
const HARD = 0; // the middle of a word
const WORD = 1; // the middle of a sentence
const SENTENCE = 2;
const LINE = 3;
const PARAGRAPH = 4;

// A post costs more than a line break and less than a sentence end: lines
// are packed to save a post, a paragraph isn't broken to save one. A cut
// mid-sentence costs more than a post and the two sentence ends it could
// replace, so it is only made where no sentence end will do.
const POST_COST = 4;
const CUT_COST = [200, 30, 5, 1, 0];

// "\n\n" and two digits each side of the slash.
const COUNTER_DIGITS = 2;
const counterRoom = (digits) => 2 + digits * 2 + 1;

const COUNTER_LINE = /(?:^|\n)[^\S\n]*(\d{1,4})\/(\d{1,4})$/;

const segmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

/** The start of every grapheme cluster in `text`, and its end. */
function graphemeStarts(text) {
  const starts = [];
  if (segmenter) {
    for (const { index } of segmenter.segment(text)) starts.push(index);
  } else {
    // Code points: a surrogate pair is never split, a longer cluster may be.
    for (let i = 0; i < text.length; i++) {
      starts.push(i);
      const code = text.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) i++;
    }
  }
  starts.push(text.length);
  return starts;
}

const EMAIL_LOCAL = /[a-zA-Z0-9._%+-]/;

// The URL matcher is slow on a long run of letters with nothing in it (it
// tries every way to find a domain there), and such a run holds no address,
// mention or email anyway: only words with one of these are looked at.
const MAY_HOLD_A_MARK = /[.:@]/;

const QUOTE_BEFORE = /["\u201C]/;

/**
 * What a cut must leave whole and must not create, as `{ kind, start, end }`:
 * inline links, URLs, mentions (an email address counts from its first
 * letter) and hashtags. A URL or a mention straight after a quotation mark
 * is its own kind, because it isn't linked until something parts the two.
 * Anything found inside an inline link belongs to the link.
 *
 * URLs and mentions are found a word at a time, which finds the same ones
 * (neither can hold whitespace).
 */
function marksOf(text) {
  const links = findInlineLinks(text).map((l) => ({
    kind: 'link',
    start: l.start,
    end: l.end,
  }));
  const found = [];
  for (const match of text.matchAll(/\S+/g)) {
    const word = match[0];
    if (!MAY_HOLD_A_MARK.test(word)) continue;
    const at = match.index;
    const quoted = (start) => start > 0 && QUOTE_BEFORE.test(word[start - 1]);
    const { urls, mentions } = findUrlsAndMentions(word);
    for (const u of urls) {
      found.push({
        kind: quoted(u.charStart) ? 'quoted-url' : 'url',
        start: at + u.charStart,
        end: at + u.charEnd,
      });
    }
    for (const m of mentions) {
      let start = m.start;
      if (m.email)
        while (start > 0 && EMAIL_LOCAL.test(word[start - 1])) start--;
      found.push({
        kind: m.email ? 'email' : quoted(start) ? 'quoted-mention' : 'mention',
        start: at + start,
        end: at + m.end,
      });
    }
  }
  for (const h of findHashtags(text))
    found.push({ kind: 'tag', start: h.start, end: h.end });
  const inLink = (m) => links.some((l) => m.start < l.end && l.start < m.end);
  return [...links, ...found.filter((m) => !inLink(m))];
}

const markKey = (m, offset = 0) =>
  `${m.kind}:${m.start - offset}:${m.end - offset}`;

/** The marks as non-overlapping `[start, end)` spans, in order. */
function protectedSpans(marks) {
  const sorted = marks
    .map((m) => [m.start, m.end])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const spans = [];
  for (const [start, end] of sorted) {
    const last = spans[spans.length - 1];
    if (last && start < last[1]) last[1] = Math.max(last[1], end);
    else spans.push([start, end]);
  }
  return spans;
}

const NEWLINE = /\r\n|\r|\n/g;
// The end of a sentence, with whatever closes a quote or a bracket after it.
const SENTENCE_END = /[.!?…。！？।؟۔][)\]"'»”’」』）】]*$/u;
// A full stop that ends no sentence: an initial, a list number, a common
// abbreviation. English only; anything else falls back to the next word's
// first letter.
const NOT_A_SENTENCE =
  /^[(["'“‘]*(?:\p{L}|\d+|Mr|Mrs|Ms|Dr|Prof|St|vs|etc|e\.g|i\.e)\.$/iu;
// Sentence ends in text written without spaces, and what may follow one
// before the next sentence starts.
const CJK_END = /[。！？]/u;
const CJK_TAIL = /^[。！？…!?」』）】〉》”’"]/u;
const CJK_CLOSED = /[。！？][」』）】〉》”’"]*$/u;
// A post that started with one of these would gain a mention or a hashtag.
const STARTS_A_MARK = /^[@#＃]/;
const PLAIN_ASCII = /^[\x21-\x7e]*$/;

function gapLevel(gap, before, after) {
  const lines = (gap.match(NEWLINE) || []).length;
  if (lines >= 2) return PARAGRAPH;
  if (lines === 1) return LINE;
  if (
    SENTENCE_END.test(before) &&
    !NOT_A_SENTENCE.test(before) &&
    !/^\p{Ll}/u.test(after)
  )
    return SENTENCE;
  return WORD;
}

/** A run of text's count and bytes, as the composer will write it. */
function measure(run) {
  if (PLAIN_ASCII.test(run) && !run.includes('://') && !run.includes(']('))
    return { count: run.length, bytes: run.length };
  return {
    count: countComposerGraphemes(run),
    bytes: utf8Length(composerCountText(run)),
  };
}

/**
 * Every place `text` could be cut, in order, with the running count and
 * bytes on each side: `{ end, next, level, cEnd, cNext, bEnd, bNext, soft }`.
 * A post from break `i` to break `j` is `text.slice(i.next, j.end)`, and its
 * count is `j.cEnd - i.cNext`. The first break is the start of the text and
 * the last its end. `room` is what a post holds, which decides whether a run
 * without spaces has to be cut inside.
 */
function findBreaks(text, marks, room) {
  const starts = graphemeStarts(text);
  const spans = protectedSpans(marks);

  // Units: a whitespace cluster, a protected span (to the end of the cluster
  // it finishes in), or any other cluster.
  const units = [];
  let span = 0;
  for (let g = 0; g < starts.length - 1; ) {
    const start = starts[g];
    while (span < spans.length && spans[span][1] <= start) span++;
    if (span < spans.length && spans[span][0] <= start) {
      const first = g;
      while (starts[g] < spans[span][1]) g++;
      units.push({ start, end: starts[g], kind: 'mark', first });
      continue;
    }
    const end = starts[g + 1];
    units.push({
      start,
      end,
      kind: /^\s+$/.test(text.slice(start, end)) ? 'space' : 'plain',
      first: g,
    });
    g++;
  }

  const breaks = [
    { end: 0, next: 0, level: PARAGRAPH, cEnd: 0, cNext: 0, bEnd: 0, bNext: 0, soft: true },
  ];
  let count = 0;
  let bytes = 0;

  for (let u = 0; u < units.length; ) {
    // A word: every unit up to the next whitespace.
    let v = u;
    while (v < units.length && units[v].kind !== 'space') v++;
    const word = text.slice(units[u].start, units[v - 1].end);
    const whole = measure(word);
    const tooLong = whole.count > room.count || whole.bytes > room.bytes;

    // Places inside the word, only when it must be cut or is written without
    // spaces. Each unit is measured with the cluster before it beside it, so
    // an address after a quote counts as it does in the whole.
    const inner = [];
    if (tooLong || CJK_END.test(word)) {
      let c = 0;
      let b = 0;
      for (let k = u; k < v; k++) {
        const unit = units[k];
        const own = text.slice(unit.start, unit.end);
        if (unit.kind === 'plain') {
          c += 1;
          b += utf8Length(own);
        } else {
          const lead = k > u ? text.slice(starts[unit.first - 1], unit.start) : '';
          const m = measure(lead + own);
          c += m.count - countGraphemes(lead);
          b += m.bytes - utf8Length(lead);
        }
        if (k + 1 >= v) break;
        const nextText = text.slice(units[k + 1].start, units[k + 1].end);
        if (STARTS_A_MARK.test(nextText)) continue;
        const sentence =
          unit.kind === 'plain' &&
          CJK_CLOSED.test(text.slice(Math.max(units[u].start, unit.end - 8), unit.end)) &&
          !CJK_TAIL.test(nextText);
        if (sentence || tooLong)
          inner.push({ at: unit.end, level: sentence ? SENTENCE : HARD, c, b });
      }
      // The parts must add up to the composer's own count of the word; if
      // they don't, the word is left whole rather than counted wrongly.
      if (c !== whole.count || b !== whole.bytes) inner.length = 0;
    }
    for (const p of inner) {
      breaks.push({
        end: p.at,
        next: p.at,
        level: p.level,
        cEnd: count + p.c,
        cNext: count + p.c,
        bEnd: bytes + p.b,
        bNext: bytes + p.b,
        soft: false,
      });
    }
    count += whole.count;
    bytes += whole.bytes;

    // The whitespace after it, to the next word.
    let w = v;
    while (w < units.length && units[w].kind === 'space') w++;
    if (v >= units.length) break;
    const gap = text.slice(units[v].start, units[w - 1].end);
    let x = w;
    while (x < units.length && units[x].kind !== 'space') x++;
    const after = text.slice(units[w].start, units[x - 1].end);
    const cNext = count + (w - v);
    const bNext = bytes + utf8Length(gap);
    breaks.push({
      end: units[v].start,
      next: units[w].start,
      level: gapLevel(gap, word, after),
      cEnd: count,
      cNext,
      bEnd: bytes,
      bNext,
      soft: true,
    });
    count = cNext;
    bytes = bNext;
    u = w;
  }

  breaks.push({
    end: text.length,
    next: text.length,
    level: PARAGRAPH,
    cEnd: count,
    cNext: count,
    bEnd: bytes,
    bNext: bytes,
    soft: true,
  });
  return breaks;
}

/**
 * The cheapest way through `breaks`, as the indexes of the breaks used
 * (starting at 0, ending at the last). Worked from the end backwards, so the
 * choice at each break is the best for everything after it; among equals the
 * later break wins, which fills the earlier posts first.
 */
function cheapestPath(breaks, room) {
  const last = breaks.length - 1;
  const cost = new Array(breaks.length).fill(Infinity);
  const choice = new Array(breaks.length).fill(last);
  cost[last] = 0;
  for (let i = last - 1; i >= 0; i--) {
    for (let j = i + 1; j <= last; j++) {
      const fits =
        breaks[j].cEnd - breaks[i].cNext <= room.count &&
        breaks[j].bEnd - breaks[i].bNext <= room.bytes;
      // What can't be cut and doesn't fit still has to go somewhere: alone.
      if (!fits && j > i + 1) break;
      const total =
        POST_COST + (j === last ? 0 : CUT_COST[breaks[j].level]) + cost[j];
      if (total <= cost[i]) {
        cost[i] = total;
        choice[i] = j;
      }
      if (!fits) break;
    }
  }
  const path = [0];
  while (path[path.length - 1] !== last) path.push(choice[path[path.length - 1]]);
  return path;
}

/**
 * `text` cut into posts of at most `room`, with no numbering: the indexes of
 * the first `maxPosts - 1` cuts are kept, and what is left stays in the last
 * post as written.
 */
function cut(text, room, maxPosts) {
  const marks = marksOf(text);
  const known = new Set(marks.map((m) => markKey(m)));
  let breaks = findBreaks(text, marks, room);

  // A cut inside a word can make a link, a mention or a hashtag that wasn't
  // in the text (a domain now at the end of a post). Such a cut is taken
  // away and the split worked out again; a handful of rounds settles it.
  for (let round = 0; ; round++) {
    const path = cheapestPath(breaks, room).slice(0, Math.max(1, maxPosts));
    path.push(breaks.length - 1);
    const posts = [];
    let bad = -1;
    for (let p = 0; p + 1 < path.length; p++) {
      const from = breaks[path[p]];
      const to = breaks[path[p + 1]];
      if (from === to) continue;
      const post = text.slice(from.next, to.end);
      posts.push(post);
      if (bad !== -1 || (from.soft && to.soft)) continue;
      const made = marksOf(post).find(
        (m) => !known.has(markKey(m, -from.next)),
      );
      if (made)
        bad = !from.soft && (to.soft || made.start === 0) ? path[p] : path[p + 1];
    }
    if (bad === -1 || round >= 8) return posts;
    breaks = breaks.filter((_, i) => i !== bad);
  }
}

/**
 * The counter at the end of `text`, on a line of its own, as
 * `{ number, total, body }` (`body` is the text without it), or null.
 * @param {string} text
 */
export function readCounter(text) {
  const trimmed = String(text ?? '').trimEnd();
  const m = COUNTER_LINE.exec(trimmed);
  if (!m) return null;
  return {
    number: Number(m[1]),
    total: Number(m[2]),
    body: trimmed.slice(0, m.index).trimEnd(),
  };
}

/** `text` without the counter at its end, if it has one. */
export function stripCounter(text) {
  const counter = readCounter(text);
  return counter ? counter.body : String(text ?? '');
}

const withCounter = (body, number, total) =>
  body ? `${body}\n\n${number}/${total}` : `${number}/${total}`;

/**
 * One over-long post as the posts of a thread, in order. A text that already
 * fits comes back alone and untouched.
 *
 * @param {string} text - the composer's text, markdown links and all
 * @param {object} [options]
 * @param {number} [options.limit] - graphemes a post holds (300)
 * @param {'off'|'counter'} [options.numbering] - 'counter' ends every post
 *   with its place and the total ("2/5") and keeps room for it
 * @param {number} [options.maxPosts] - the most posts to make; what doesn't
 *   fit in them stays, as written, in the last one (over the limit, so it is
 *   still flagged) rather than being dropped
 * @param {number} [options.before] - posts already in the thread ahead of
 *   this one, so the counters count the whole thread
 * @param {number} [options.after] - and after it
 * @returns {string[]}
 */
export function splitIntoThread(text, options = {}) {
  const {
    limit = MAX_POST_GRAPHEMES,
    numbering = 'off',
    maxPosts = Infinity,
    before = 0,
    after = 0,
  } = options;
  const whole = String(text ?? '').trim();
  const fitsAsIs =
    countComposerGraphemes(whole) <= limit &&
    utf8Length(composerCountText(whole)) <= MAX_POST_BYTES;
  if (fitsAsIs || !(maxPosts > 1)) return [whole];

  const numbered = numbering === 'counter';

  let digits = COUNTER_DIGITS;
  for (;;) {
    const reserve = numbered ? counterRoom(digits) : 0;
    const room = {
      count: Math.max(1, limit - reserve),
      bytes: Math.max(1, MAX_POST_BYTES - reserve),
    };
    const posts = cut(whole, room, maxPosts);
    if (posts.length < 2) return [whole];
    if (!numbered) return posts;
    const total = before + posts.length + after;
    // A thread past 99 posts needs wider counters, and so shorter posts.
    if (String(total).length > digits) {
      digits = String(total).length;
      continue;
    }
    return posts.map((post, i) => withCounter(post, before + i + 1, total));
  }
}

/**
 * A thread's posts as one text again, a blank line between posts; with
 * `numbering: 'counter'`, each post's counter taken off first. Splitting it
 * with the same options gives the posts back.
 * @param {string[]} posts
 * @param {{ numbering?: 'off'|'counter' }} [options]
 * @returns {string}
 */
export function joinThread(posts, { numbering = 'off' } = {}) {
  const numbered = numbering === 'counter';
  return (Array.isArray(posts) ? posts : [])
    .map((post) => (numbered ? stripCounter(post) : String(post ?? '')).trim())
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Whether a thread's posts carry counters, and whether they are right:
 * 'none' (fewer than two posts end in one), 'current' (every post says its
 * place and the total) or 'stale' (posts were added, removed or moved since).
 * @param {string[]} texts - each post's text, in order
 * @returns {'none'|'current'|'stale'}
 */
export function threadNumbering(texts) {
  const list = Array.isArray(texts) ? texts : [];
  const counters = list.map(readCounter);
  if (list.length < 2 || counters.filter(Boolean).length < 2) return 'none';
  const right = counters.every(
    (c, i) => c && c.number === i + 1 && c.total === list.length,
  );
  return right ? 'current' : 'stale';
}

/**
 * Each post's text with its counter set to its place in the thread: one that
 * is there is replaced, a post without one gains it. Nothing else in a post
 * changes. A thread of one loses its counter.
 * @param {string[]} texts
 * @returns {string[]}
 */
export function renumberThread(texts) {
  const list = (Array.isArray(texts) ? texts : []).map((t) => String(t ?? ''));
  if (list.length < 2) return list.map((t) => stripCounter(t));
  return list.map((t, i) =>
    withCounter(stripCounter(t).trimEnd(), i + 1, list.length),
  );
}
