// src/posting/lib/richText.js: the UTF-16 → UTF-8 byte map facets are
// indexed with, its inverse, UTF-8 length, the sanitizer and the guard for
// URLs from record data. Swift: VirgaPosting/Lib/RichText.swift.
//
// Inputs from src/posting/lib/richText.test.js, plus every C0/C1 control,
// the zero-width and direction marks, emoji sequences, combining marks and
// scripts that encode at 2, 3 and 4 bytes.

import {
  byteToCharIndex,
  createByteMap,
  hasStrippedControlCharacter,
  safeExternalUrl,
  sanitizeText,
  utf8Length,
} from '../../../src/posting/lib/richText.js';
import { each } from './_helpers.js';

export const sources = ['src/posting/lib/richText.js'];

const TEXTS = [
  '',
  'a',
  'hello world',
  'aé日\u{1F600}b',
  'e\u0301',
  'é',
  '\u{1F600}',
  'café #note',
  '\u{1F98B} @pyxi.test',
  '\u{1F469}\u200D\u{1F52C} #note @automeris.test https://example.com',
  '\u{1F44D}\u{1F3FD}',
  '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}',
  '\u{1F1FA}\u{1F1F8}',
  'می\u200Cخواهم',
  'Ünïcödé',
  '日本語のテキスト',
  'Ελληνικά',
  'עברית',
  '\u0000\u0007\u001F\u007F\u0080\u009F',
  'line one\nline\ttwo\r\n',
  'a\u200Bb\u200Cc\u200Dd\u200Ee\u200Ff\uFEFFg\u00A0h\u0000i\u0007j\u001Fk\u007Fl\nm\rn\to',
  'a\u200Ab\u2060c',
  '\u0008\u0009\u000A\u000D\u000E',
  '\u000B\u000C\u001F\u007F',
  '\u0000\u{1F98B}\u0007\u{1F469}\u200D\u{1F52C}\u001F',
  '\uFEFF leading bom',
  'nothing to do here',
  '\u{10FFFF}\u{10000}',
  'ࠀ߿\u0080\u007F',
];

export default async function cases() {
  const out = [];
  out.push(
    ...(await each(
      'createByteMap',
      TEXTS.map((text) => ({ text })),
      ({ text }) => createByteMap(text),
    )),
  );
  // Unpaired surrogates (half an emoji, from slicing), which a Swift String
  // can't hold: given as code units.
  out.push(
    ...(await each(
      'createByteMapUnits',
      [
        [0x61, 0xd83d, 0x62],
        [0x61, 0xde00, 0x62],
        [0xd83d],
        [0xde00],
        [0xde00, 0xd83d],
        [0xd83d, 0xd83d, 0xde00],
        [0xd83d, 0xde00, 0xde00],
        [0x61, 0xd83d],
      ].map((units) => ({ units })),
      ({ units }) => createByteMap(String.fromCharCode(...units)),
    )),
  );
  const mapped = ['aé日\u{1F600}b', '', '\u{1F469}\u200D\u{1F52C}x', 'abc'];
  out.push(
    ...(await each(
      'byteToCharIndex',
      mapped.flatMap((text) =>
        [-9999, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 99999].map(
          (byteIndex) => ({ text, byteIndex }),
        ),
      ),
      ({ text, byteIndex }) => byteToCharIndex(createByteMap(text), byteIndex),
    )),
  );
  out.push(
    ...(await each(
      'utf8Length',
      [...TEXTS.map((text) => ({ text })), { text: null }],
      ({ text }) => utf8Length(text),
    )),
  );
  const controls = [];
  for (let code = 0x00; code <= 0x9f; code++)
    controls.push({ text: `a${String.fromCharCode(code)}b` });
  out.push(
    ...(await each(
      'hasStrippedControlCharacter',
      [...TEXTS.map((text) => ({ text })), ...controls],
      ({ text }) => hasStrippedControlCharacter(text),
    )),
  );
  out.push(
    ...(await each(
      'sanitizeText',
      [...TEXTS.map((text) => ({ text })), ...controls, { text: null }],
      ({ text }) => sanitizeText(text),
    )),
  );
  out.push(
    ...(await each(
      'safeExternalUrl',
      [
        ' https://example.com/a b ',
        'http://example.com',
        'HTTPS://EXAMPLE.COM/X',
        'https://bücher.de/straße',
        'https://example.com/?q=1#f',
        'javascript:alert(1)',
        'data:text/html,hi',
        'ftp://example.com',
        '/profile/x',
        '//example.com',
        'example.com',
        '',
        '   ',
        'https://',
        'https://exa mple.com',
        'http:example.com',
        null,
        42,
        { url: 'https://x.com' },
      ].map((url) => ({ url })),
      ({ url }) => safeExternalUrl(url),
    )),
  );
  return out;
}
