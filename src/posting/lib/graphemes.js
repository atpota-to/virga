/**
 * Grapheme-cluster counting and truncation. AT Protocol lexicon length limits
 * count grapheme clusters (an emoji with a skin-tone modifier is one), not
 * `String.prototype.length`.
 *
 * Without `Intl.Segmenter` the code-point fallback over-counts multi-point
 * clusters (flags, ZWJ families), so it truncates early rather than emitting a
 * value the PDS would reject.
 */

const segmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

/**
 * Length of `text` in grapheme clusters.
 * @param {string} text
 * @returns {number}
 */
export function countGraphemes(text) {
  if (!text) return 0;
  if (segmenter) {
    let count = 0;
    // eslint-disable-next-line no-unused-vars
    for (const _ of segmenter.segment(text)) count++;
    return count;
  }
  return [...text].length;
}

/**
 * `text` cut to at most `max` grapheme clusters, never splitting one. Returns
 * the original string when it already fits.
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
export function truncateGraphemes(text, max) {
  if (!text) return '';
  if (countGraphemes(text) <= max) return text;
  if (segmenter) {
    let out = '';
    let count = 0;
    for (const { segment } of segmenter.segment(text)) {
      if (count >= max) break;
      out += segment;
      count++;
    }
    return out;
  }
  return [...text].slice(0, max).join('');
}
