// Text helpers for rich text: the UTF-16 → UTF-8 offset map facets are
// indexed with, the sanitizer that strips characters which break link
// detection, and the guard for URLs taken from record data.

/**
 * Cumulative UTF-8 byte offsets per UTF-16 index (`byteMap[i]` is the byte
 * offset of code unit `i`; `byteMap[text.length]` is the total). Facets are
 * indexed in bytes; JS strings in UTF-16 code units.
 * @param {string} str
 * @returns {number[]}
 */
export function createByteMap(str) {
  const encoder = new TextEncoder();
  const byteMap = [0];

  let i = 0;
  while (i < str.length) {
    const char = str[i];
    const charCode = char.charCodeAt(0);

    if (charCode >= 0xd800 && charCode <= 0xdbff && i + 1 < str.length) {
      const nextChar = str[i + 1];
      const nextCharCode = nextChar.charCodeAt(0);

      if (nextCharCode >= 0xdc00 && nextCharCode <= 0xdfff) {
        const bytes = encoder.encode(char + nextChar);
        // Both code units get the pair's end offset; the low surrogate is
        // zero-width.
        const nextBytePos = byteMap[byteMap.length - 1] + bytes.length;
        byteMap.push(nextBytePos);
        byteMap.push(nextBytePos);
        i += 2;
      } else {
        // A lone high surrogate encodes as U+FFFD (3 bytes).
        const bytes = encoder.encode(char);
        byteMap.push(byteMap[byteMap.length - 1] + bytes.length);
        i++;
      }
    } else {
      const bytes = encoder.encode(char);
      byteMap.push(byteMap[byteMap.length - 1] + bytes.length);
      i++;
    }
  }

  return byteMap;
}

/**
 * The UTF-16 index a byte offset falls in.
 * @param {number[]} byteMap - from createByteMap
 * @param {number} byteIndex
 * @returns {number}
 */
export function byteToCharIndex(byteMap, byteIndex) {
  for (let i = 0; i < byteMap.length - 1; i++) {
    if (byteMap[i] <= byteIndex && byteIndex < byteMap[i + 1]) {
      return i;
    }
  }

  // Exactly at the end: the text length.
  if (byteIndex === byteMap[byteMap.length - 1]) {
    return byteMap.length - 1;
  }

  if (byteIndex < 0) return 0;
  if (byteIndex > byteMap[byteMap.length - 1]) return byteMap.length - 1;

  return 0;
}

/** Bytes of `text` in UTF-8: what the lexicon's `maxLength` counts. */
export function utf8Length(text) {
  return new TextEncoder().encode(text || '').length;
}

// Control characters a post may contain; sanitizeText keeps these.
const PRESERVED_CONTROL_CODE_POINTS = new Set([
  0x09, // tab
  0x0a, // line feed
  0x0d, // carriage return
]);

/**
 * True for the control characters sanitizeText strips: C0 (U+0000-U+001F) and
 * DEL (U+007F), minus tab, LF and CR. C1 (U+0080-U+009F) is not included.
 */
function isStrippedControlCharacter(codePoint) {
  if (PRESERVED_CONTROL_CODE_POINTS.has(codePoint)) return false;
  return codePoint <= 0x1f || codePoint === 0x7f;
}

/**
 * A code point predicate rather than a regex class: control characters in a
 * pattern are invisible and easily mistyped, and for..of keeps surrogate pairs
 * (emoji) intact.
 */
function stripControlCharacters(text) {
  let out = '';
  for (const char of text) {
    if (!isStrippedControlCharacter(char.codePointAt(0))) out += char;
  }
  return out;
}

/**
 * True when text holds a control character sanitizeText would strip. Shares
 * the predicate with sanitizeText so the two can't drift.
 * @param {string} text
 * @returns {boolean}
 */
export function hasStrippedControlCharacter(text) {
  for (const char of text) {
    if (isStrippedControlCharacter(char.codePointAt(0))) return true;
  }
  return false;
}

/**
 * Remove hidden characters that interfere with URL detection: zero-width
 * marks, the BOM and stray control characters; a non-breaking space becomes a
 * plain one.
 * @param {string} text
 * @returns {string}
 */
export function sanitizeText(text) {
  const withoutHiddenCharacters = String(text ?? '')
    // U+200B-U+200F (ZWSP, ZWNJ, ZWJ, LRM, RLM) as a range, so the ZWJ isn't
    // read as joining its neighbours into a sequence.
    .replace(/[\u200B-\u200F]/g, '')
    .replace(/\uFEFF/g, '')
    .replace(/\u00A0/g, ' ');

  return stripControlCharacters(withoutHiddenCharacters);
}

/**
 * A URL taken from record data that may be opened or linked to: absolute
 * http(s), normalized, so what was checked is what opens; otherwise null. A
 * `javascript:` URL handed to `window.open` or an `href` runs in this origin.
 * @param {unknown} url
 * @returns {string|null}
 */
export function safeExternalUrl(url) {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  return parsed.href;
}
