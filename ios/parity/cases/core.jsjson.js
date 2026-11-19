// JavaScript's JSON.parse, which the Swift ports read the web's stored
// values and network bodies with (VirgaCore/Support/JSONParse.swift): what
// it accepts, what it refuses, and what it makes of what it accepts (the
// last of two equal keys, numbers past a double's range, lone surrogates).
// The web only ever catches a refusal, so a refusal is compared as one,
// not by V8's message.

import { each } from './_helpers.js';

export const sources = [
  'ios/VirgaKit/Sources/VirgaCore/Support/JSONParse.swift',
];

const TEXTS = [
  // Every kind of value.
  'null',
  'true',
  'false',
  '0',
  '-0',
  '12',
  '-12.5',
  '1e3',
  '1E+3',
  '1e-3',
  '0.1',
  '123456789012345678901234567890',
  '1e400',
  '-1e400',
  '5e-324',
  '1e-400',
  '"text"',
  '""',
  '[]',
  '{}',
  '[1,"two",[3],{"four":4},null,true]',
  '{"a":{"b":{"c":[1,{"d":[]}]}}}',
  // Whitespace: only tab, line feed, carriage return and space.
  ' \t\n\r[ 1 , 2 ]\r\n\t ',
  ' []',
  '[] ',
  '﻿[]',
  ' []',
  '\v[]',
  '\f[]',
  // Strings and their escapes.
  '"\\"\\\\\\/\\b\\f\\n\\r\\t"',
  '"\\u0041\\u00e9\\u4e2d\\uD83D\\uDC4D"',
  '"\\uDBFF\\uDFFF"',
  '"\\ud800"',
  '"\\udc00x"',
  '"\\ud800\\ud800"',
  '"a\\u0000b"',
  '"\\u00"',
  '"\\uGGGG"',
  '"\\x41"',
  '"\\a"',
  '"\\\'"',
  '"raw\ttab"',
  '"raw\nline"',
  '"raw\u001f"',
  '"raw\u007f"',
  '"  "',
  '"👍🏽 naïve"',
  '"unterminated',
  '"',
  // Objects.
  '{"a":1,"a":2}',
  '{"a":1,"b":2,"a":3}',
  '{"":1}',
  '{"a" : 1 , "b" : [ ] }',
  '{"a":1,}',
  '{,}',
  '{"a"}',
  '{"a":}',
  '{"a" 1}',
  '{a:1}',
  "{'a':1}",
  '{"a":1}}',
  '{"a":1',
  '{1:1}',
  // Arrays.
  '[1,]',
  '[,1]',
  '[1,,2]',
  '[1 2]',
  '[',
  ']',
  `${'['.repeat(200)}1${']'.repeat(200)}`,
  `${'['.repeat(20)}1${']'.repeat(19)}`,
  `${'{"a":'.repeat(100)}null${'}'.repeat(100)}`,
  // Numbers JSON.parse refuses.
  '01',
  '-01',
  '+1',
  '.5',
  '5.',
  '1.e3',
  '1e',
  '1e+',
  '-',
  '0x10',
  'Infinity',
  'NaN',
  '1_000',
  // Literals and the rest.
  'nul',
  'nulls',
  'True',
  'undefined',
  '',
  ' ',
  '1 2',
  '[] x',
  '/* comment */ 1',
  '1 // comment',
];

/** JSON.parse's result, with -0 and non-finite numbers left to toJSON. */
export default async function cases() {
  return each(
    'parse',
    TEXTS.map((text) => ({ text })),
    ({ text }) => {
      const value = JSON.parse(text);
      // A top-level number is wrapped, so 1e400 (Infinity, which toJSON
      // writes as null) and -0 are still told apart from null and 0.
      return {
        value,
        number:
          typeof value === 'number'
            ? Number.isFinite(value)
              ? Object.is(value, -0)
                ? '-0'
                : value
              : String(value)
            : null,
      };
    },
  );
}
