import { describe, it, expect } from 'vitest';
import {
  byteToCharIndex,
  createByteMap,
  hasStrippedControlCharacter,
  safeExternalUrl,
  sanitizeText,
  utf8Length,
} from './richText.js';

// Facets address UTF-8 bytes; JS strings address UTF-16 code units. A drift
// writes wrong byteStart/byteEnd to the author's PDS, where every client
// renders the link over the wrong words and nothing can repair it.
//
// Invisible characters are written as \u escapes; pasted literals can't be
// reviewed and get mangled by editors.

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** The substring a facet's byte offsets actually name, via real UTF-8 bytes. */
const bytesAt = (text, byteStart, byteEnd) =>
  decoder.decode(encoder.encode(text).slice(byteStart, byteEnd));

/**
 * UTF-8 byte offset of a character index, straight from TextEncoder and
 * deliberately independent of createByteMap: fixtures built from a broken map
 * would agree with the renderer's identical map. Only valid for indices that
 * don't split a surrogate pair; split-pair tests use literal offsets.
 */
const byteOffsetOf = (text, charIndex) =>
  encoder.encode(text.slice(0, charIndex)).length;

describe('createByteMap', () => {
  it('records the UTF-8 start offset of every character, one entry longer than the string', () => {
    // a=1 e-acute=2 日=3 emoji=4 b=1 → 11 bytes over 6 UTF-16 code units.
    // 0, 0+1, 1+2, 3+3, 6+4 (written twice: both halves of the pair), 10+1
    const text = 'a\u00E9日\u{1F600}b';
    expect(createByteMap(text)).toEqual([0, 1, 3, 6, 10, 10, 11]);
    expect(createByteMap(text)).toHaveLength(text.length + 1);
  });

  it('names byte ranges that slice back to the original characters', () => {
    const text = 'a\u00E9日\u{1F600}b';
    const map = createByteMap(text);
    expect(bytesAt(text, map[0], map[1])).toBe('a');
    expect(bytesAt(text, map[1], map[2])).toBe('\u00E9');
    expect(bytesAt(text, map[2], map[3])).toBe('日');
    // The pair spans from the high surrogate's slot to the next real character.
    expect(bytesAt(text, map[3], map[5])).toBe('\u{1F600}');
    expect(bytesAt(text, map[5], map[6])).toBe('b');
  });

  it('agrees with a plain TextEncoder prefix count at every index outside a surrogate pair', () => {
    // The invariant that lets byteOffsetOf stand in for createByteMap in the
    // fixtures.
    const text = 'a\u00E9日\u{1F600}b';
    const map = createByteMap(text);
    const oracle = [...Array(text.length + 1)].map((_, i) =>
      byteOffsetOf(text, i),
    );
    expect(oracle).toEqual([0, 1, 3, 6, 9, 10, 11]);
    // Index 4 (mid-pair) is the only disagreement: the oracle slices mid-pair
    // and TextEncoder substitutes U+FFFD (3 bytes), 6+3=9; the map reports the
    // offset after the pair, 10. Facets never start or end mid-pair.
    for (const i of [0, 1, 2, 3, 5, 6]) expect(map[i]).toBe(oracle[i]);
    expect(map[4]).toBe(10);
    expect(oracle[4]).toBe(9);
  });

  it('counts a combining mark as its own character, unlike the precomposed form', () => {
    // Same glyph, different arithmetic: e + U+0301 is 2 chars / 3 bytes,
    // precomposed U+00E9 is 1 char / 2 bytes.
    expect(createByteMap('e\u0301')).toEqual([0, 1, 3]);
    expect(createByteMap('\u00E9')).toEqual([0, 2]);
  });

  it('survives an unpaired surrogate instead of desynchronising the map', () => {
    // TextEncoder substitutes U+FFFD (3 bytes) for a lone surrogate, so the map
    // stays exactly one entry per code unit however malformed the string is.
    expect(createByteMap('a\uD83Db')).toEqual([0, 1, 4, 5]); // high surrogate, pair never closes
    expect(createByteMap('a\uD83D')).toEqual([0, 1, 4]); // high surrogate at the very end
    expect(createByteMap('a\uDE00b')).toEqual([0, 1, 4, 5]); // low surrogate with no high before it
    // A pair on its own: 4 bytes, two entries, both reading 4.
    expect(createByteMap('\u{1F600}')).toEqual([0, 4, 4]);
  });

  it('returns just the origin for an empty string', () => {
    expect(createByteMap('')).toEqual([0]);
  });
});

describe('byteToCharIndex', () => {
  const text = 'a\u00E9日\u{1F600}b';
  const map = createByteMap(text); // [0, 1, 3, 6, 10, 10, 11]

  it('inverts the map: every byte that starts a character maps back to that character', () => {
    // byte:  0  1  3  6  10        char: 0  1  2  3  5
    // Index 4 is the low surrogate, which has no byte of its own, so byte 10
    // resolves to 'b' at index 5.
    expect([0, 1, 3, 6, 10].map((byte) => byteToCharIndex(map, byte))).toEqual([
      0, 1, 2, 3, 5,
    ]);
  });

  it('collapses the interior bytes of a multi-byte character onto its start', () => {
    expect(byteToCharIndex(map, 1)).toBe(1); // e-acute (U+00E9) starts here
    expect(byteToCharIndex(map, 2)).toBe(1); // e-acute's second byte
    expect(byteToCharIndex(map, 3)).toBe(2); // 日 starts here
    expect(byteToCharIndex(map, 4)).toBe(2);
    expect(byteToCharIndex(map, 5)).toBe(2);
    expect(byteToCharIndex(map, 6)).toBe(3); // the emoji's high surrogate
    expect(byteToCharIndex(map, 7)).toBe(3);
    expect(byteToCharIndex(map, 9)).toBe(3);
  });

  it('maps the total byte length to one past the last character', () => {
    expect(byteToCharIndex(map, 11)).toBe(text.length);
  });

  it('clamps rather than throwing when the byte index is outside the text', () => {
    expect(byteToCharIndex(map, -1)).toBe(0);
    expect(byteToCharIndex(map, -9999)).toBe(0);
    expect(byteToCharIndex(map, 12)).toBe(text.length);
    expect(byteToCharIndex(map, 99999)).toBe(text.length);
    // An empty text has exactly one valid answer.
    expect(byteToCharIndex(createByteMap(''), 0)).toBe(0);
    expect(byteToCharIndex(createByteMap(''), 3)).toBe(0);
  });
});

describe('sanitizeText', () => {
  it('strips the zero-width space, direction marks and the BOM, folds NBSP to a space, drops control chars', () => {
    const messy =
      'a\u200Bb\u200Cc\u200Dd\u200Ee\u200Ff\uFEFFg\u00A0h\u0000i\u0007j\u001Fk\u007Fl\nm\rn\to';
    // NBSP becomes a space; tab, LF, CR and the two joiners are kept;
    // everything else invisible goes.
    expect(sanitizeText(messy)).toBe('ab\u200Cc\u200Ddefg hijkl\nm\rn\to');
  });

  it('keeps the characters just outside each stripped range', () => {
    // U+200A (hair space) sits one below the zero-width run that starts at
    // U+200B; U+2060 (word joiner) sits one above U+200F. Both survive.
    expect(sanitizeText('a\u200Ab\u2060c')).toBe('a\u200Ab\u2060c');
    // Control-character boundaries: U+0008, U+000B and U+000E are stripped,
    // while the tab, newline and carriage return between them are kept.
    expect(sanitizeText('\u0008\u0009\u000A\u000D\u000E')).toBe(
      '\u0009\u000A\u000D',
    );
    expect(sanitizeText('\u000B\u000C\u001F\u007F')).toBe('');
    expect(sanitizeText('')).toBe('');
    expect(sanitizeText('nothing to do here')).toBe('nothing to do here');
  });

  // Every stripped set must match one whole character at a time; matching part
  // of a sequence or half a surrogate pair would leave an orphaned code unit
  // for the byte-offset arithmetic.
  it('takes zero-width marks one character at a time, never half a surrogate pair', () => {
    // Three alternatives, not one joined sequence.
    for (const mark of ['\u200B', '\u200E', '\u200F']) {
      expect(sanitizeText(`a${mark}b`), mark.codePointAt(0).toString(16)).toBe(
        'ab',
      );
    }

    // The joiners are part of the writing: a ZWJ emoji sequence stays one
    // emoji, and a Persian word keeps its ZWNJ.
    const scientist = '\u{1F469}\u200D\u{1F52C}';
    expect(sanitizeText(scientist)).toBe(scientist);
    expect([
      ...new Intl.Segmenter().segment(sanitizeText(scientist)),
    ]).toHaveLength(1);
    const persian = 'می\u200Cخواهم';
    expect(sanitizeText(persian)).toBe(persian);

    // A skin-tone modifier is itself a surrogate pair and is in no stripped
    // set, so the whole grapheme survives byte for byte.
    const thumb = '\u{1F44D}\u{1F3FD}';
    expect(sanitizeText(`ok ${thumb}`)).toBe(`ok ${thumb}`);
    expect(encoder.encode(sanitizeText(thumb))).toEqual(encoder.encode(thumb));
  });

  it('carries astral characters across whole while stripping the controls around them', () => {
    // Pins the outcome: emoji come back as unbroken pairs.
    const text = '\u0000\u{1F98B}\u0007\u{1F469}\u200D\u{1F52C}\u001F';
    const cleaned = sanitizeText(text);
    expect(cleaned).toBe('\u{1F98B}\u{1F469}\u200D\u{1F52C}');
    // Three 4-byte emoji and the 3-byte joiner.
    expect(encoder.encode(cleaned)).toHaveLength(15);
    // A stray surrogate would round-trip as U+FFFD.
    expect(decoder.decode(encoder.encode(cleaned))).toBe(cleaned);
  });

  it('strips the C0 block and DEL, and stops there — U+0080..U+009F stay', () => {
    // Exactly {U+0000-U+001F, U+007F} minus tab/LF/CR. C1 (U+0080-U+009F) is
    // kept; widening to category Cc would delete it and shift every later byte
    // offset by two.
    for (let cp = 0x00; cp <= 0x1f; cp++) {
      const ch = String.fromCodePoint(cp);
      const kept = cp === 0x09 || cp === 0x0a || cp === 0x0d;
      expect(sanitizeText(`a${ch}b`), `U+${cp.toString(16)}`).toBe(
        kept ? `a${ch}b` : 'ab',
      );
    }
    expect(sanitizeText('a\u007Fb')).toBe('ab');
    expect(sanitizeText('a\u0080b')).toBe('a\u0080b');
    expect(sanitizeText('a\u009Fb')).toBe('a\u009Fb');
  });

  it('reads nullish input as empty text', () => {
    expect(sanitizeText(null)).toBe('');
    expect(sanitizeText(undefined)).toBe('');
  });
});

// control character appears in this file.

const cc = String.fromCharCode;
const NUL = cc(0x00);
const BEL = cc(0x07);
const VT = cc(0x0b);
const FF = cc(0x0c);
const ESC = cc(0x1b);
const DEL = cc(0x7f);
const TAB = cc(0x09);
const LF = cc(0x0a);
const CR = cc(0x0d);

describe('hasStrippedControlCharacter', () => {
  it('agrees with sanitizeText across the entire C0 and C1 range', () => {
    // "Strippable" means whatever sanitizeText removes. 0x00-0x9F holds every
    // control character and none of the other things it touches (zero-width
    // marks, BOM, NBSP sit at 0x200B+ / 0xFEFF / 0x00A0).
    for (let code = 0x00; code <= 0x9f; code++) {
      const ch = cc(code);
      const removedBySanitizer = sanitizeText(`a${ch}b`) === 'ab';
      expect(
        hasStrippedControlCharacter(ch),
        `disagreement at code point 0x${code.toString(16)}`,
      ).toBe(removedBySanitizer);
    }
  });

  it('flags C0 controls and DEL', () => {
    for (const ch of [NUL, BEL, VT, FF, ESC, DEL]) {
      expect(hasStrippedControlCharacter(`before${ch}after`)).toBe(true);
    }
  });

  it('leaves the three whitespace controls that are legal in post text', () => {
    // Stripping these would mangle every multi-line post, so they must never
    // be reported as hidden characters.
    expect(hasStrippedControlCharacter(TAB)).toBe(false);
    expect(hasStrippedControlCharacter(LF)).toBe(false);
    expect(hasStrippedControlCharacter(CR)).toBe(false);
    expect(
      hasStrippedControlCharacter(`line one${LF}line${TAB}two${CR}${LF}`),
    ).toBe(false);
  });

  it('does not mistake a surrogate half for a control character', () => {
    // The scan walks whole code points, so astral characters are never read as
    // surrogate halves.
    const butterfly = String.fromCodePoint(0x1f98b);
    const family = [0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467, 0x200d, 0x1f466]
      .map((cp) => String.fromCodePoint(cp))
      .join('');
    const waveWithSkinTone =
      String.fromCodePoint(0x1f44b) + String.fromCodePoint(0x1f3fd);
    const flag = String.fromCodePoint(0x1f1fa) + String.fromCodePoint(0x1f1f8);

    for (const text of [butterfly, family, waveWithSkinTone, flag]) {
      expect(hasStrippedControlCharacter(text)).toBe(false);
    }
  });

  it('reports nothing for ordinary text in any script', () => {
    expect(hasStrippedControlCharacter('')).toBe(false);
    expect(hasStrippedControlCharacter('hello world https://example.com')).toBe(
      false,
    );
    expect(
      hasStrippedControlCharacter(
        'cr' + cc(0xe8) + 'me br' + cc(0xfb) + 'l' + cc(0xe9) + 'e',
      ),
    ).toBe(false);
    expect(
      hasStrippedControlCharacter(cc(0x65e5) + cc(0x672c) + cc(0x8a9e)),
    ).toBe(false);
  });

  it('ignores the zero-width and spacing characters handled by the other half of the check', () => {
    // Hidden characters, but the sibling regex covers them; the two halves
    // stay disjoint.
    expect(hasStrippedControlCharacter(cc(0x200b))).toBe(false); // ZWSP
    expect(hasStrippedControlCharacter(cc(0x200d))).toBe(false); // ZWJ
    expect(hasStrippedControlCharacter(cc(0xfeff))).toBe(false); // BOM
    expect(hasStrippedControlCharacter(cc(0x00a0))).toBe(false); // NBSP
  });
});

describe('utf8Length', () => {
  it('counts bytes, not code units', () => {
    expect(utf8Length('aé日\u{1F600}')).toBe(10);
    expect(utf8Length('')).toBe(0);
    expect(utf8Length(null)).toBe(0);
  });
});

describe('safeExternalUrl', () => {
  it('normalizes http(s) URLs', () => {
    expect(safeExternalUrl(' https://example.com/a b ')).toBe(
      'https://example.com/a%20b',
    );
    expect(safeExternalUrl('http://example.com')).toBe('http://example.com/');
  });

  it('refuses other schemes, relative URLs and non-strings', () => {
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(safeExternalUrl('data:text/html,hi')).toBeNull();
    expect(safeExternalUrl('/profile/x')).toBeNull();
    expect(safeExternalUrl('')).toBeNull();
    expect(safeExternalUrl(42)).toBeNull();
  });
});
