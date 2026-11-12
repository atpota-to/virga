// The editor's highlight layer: the text cut into runs, each marked as a
// mention, a link, a hashtag, the brackets of an inline link, or plain. The
// overlay draws these runs under a transparent textarea, so it must hold
// exactly the same characters; only colour may differ, or the caret drifts.

import { createByteMap, byteToCharIndex } from '../lib/richText.js';

const KIND_BY_TYPE = {
  'app.bsky.richtext.facet#mention': 'mention',
  'app.bsky.richtext.facet#link': 'link',
  'app.bsky.richtext.facet#tag': 'tag',
};

/**
 * Character ranges for byte-indexed facets over `text`, each with its kind.
 * A facet whose range doesn't land inside the text is skipped.
 */
export function facetRanges(text, facets) {
  const source = typeof text === 'string' ? text : '';
  if (!Array.isArray(facets) || facets.length === 0) return [];
  const map = createByteMap(source);
  const out = [];
  for (const f of facets) {
    const kind = KIND_BY_TYPE[f?.features?.[0]?.$type];
    const bs = f?.index?.byteStart;
    const be = f?.index?.byteEnd;
    if (!kind || !(be > bs)) continue;
    const start = byteToCharIndex(map, bs);
    const end = byteToCharIndex(map, be);
    if (!(end > start) || end > source.length) continue;
    out.push({ start, end, kind });
  }
  return out;
}

/**
 * The runs the overlay draws: `[{ text, kind }]` covering `text` end to end,
 * `kind` one of 'plain', 'mention', 'link', 'tag', 'syntax'. `inlineLinks`
 * are findInlineLinks' results for the links that will be made; their
 * brackets and address are marked 'syntax' and their label 'link'.
 */
export function highlightSegments(text, facets = [], inlineLinks = []) {
  const source = typeof text === 'string' ? text : '';
  const marks = [];
  for (const link of inlineLinks || []) {
    if (!(link?.end > link?.start)) continue;
    if (link.labelStart > link.start)
      marks.push({ start: link.start, end: link.labelStart, kind: 'syntax' });
    if (link.labelEnd > link.labelStart)
      marks.push({ start: link.labelStart, end: link.labelEnd, kind: 'link' });
    if (link.end > link.labelEnd)
      marks.push({ start: link.labelEnd, end: link.end, kind: 'syntax' });
  }
  const linkSpans = marks.slice();
  for (const r of facetRanges(source, facets)) {
    // The inline link's own marks win over the facet laid on its label.
    if (linkSpans.some((m) => r.start < m.end && m.start < r.end)) continue;
    marks.push(r);
  }
  marks.sort((a, b) => a.start - b.start || b.end - a.end);

  const out = [];
  let at = 0;
  for (const m of marks) {
    if (m.start < at) continue; // overlapping; the earlier mark stands
    if (m.start > at)
      out.push({ text: source.slice(at, m.start), kind: 'plain' });
    out.push({ text: source.slice(m.start, m.end), kind: m.kind });
    at = m.end;
  }
  if (at < source.length) out.push({ text: source.slice(at), kind: 'plain' });
  return out;
}
