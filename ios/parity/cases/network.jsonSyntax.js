// The SyntaxError JSON.parse throws for text it refuses, as V8 words it:
// `res.json()` and the SDK reject a body that isn't JSON with it, and its
// message reaches the person (src/lib/atproto.js's reads, sources.js's
// publicXrpc, an XRPC call's "Failed to parse response body: …").
// VirgaNetwork's JSONSyntaxError.v8 rebuilds it. Each case records the
// message, or null for text that parses: hand-picked texts for every
// message, then texts made by breaking valid JSON at random (seeded).

import { each } from './_helpers.js';

export const sources = ['src/lib/atproto.js', 'src/posting/library/sources.js'];

const PICKED = [
  '',
  ' ',
  '\n',
  '{',
  '[',
  '{"a"',
  '{"a" 1}',
  '{"a":}',
  '{"a":1,}',
  '{"a":1 "b"}',
  '[1,]',
  '[1 2]',
  '01',
  '-01',
  '-',
  '-a',
  '-.5',
  '1.',
  '1.e5',
  '1e',
  '1e+',
  '0e',
  '0.5.5',
  '-0x',
  '+1',
  '.5',
  '"abc',
  '"a\\x"',
  '"a\\u12g4"',
  '"a\\u12',
  '"\\',
  '"a\nb"',
  '"\u0001"',
  '"\u007f"',
  'tru',
  'trux',
  'tr"',
  't1',
  't ',
  'nul',
  'nulx',
  'fals',
  'falsey',
  'NaN',
  'undefined',
  'Infinity',
  '[object Object]',
  'nan',
  '<html>',
  '<!DOCTYPE html><html><head>',
  'abcdefghijklmnopqrstuvwxyz',
  '{"a":1}x',
  '{"a":1} x',
  '[1]\n\nx',
  '[1]\r\n\r\nx',
  '[1]\r\rx',
  '\r\n\r\n]',
  '1 2',
  '"a" "b"',
  '{1:2}',
  '{,}',
  '[,1]',
  'é',
  '"\\é"',
  '"\\€"',
  '{"a":1,"b"}',
  '["a" : 1]',
  '1e5x',
  '123456789012x',
  '1234567890.x',
  '[1,2,3,4,5,6,7,8,9,10,11,12,13x]',
  '{"a":"xxxxxxxxxxxxxxxx" x}',
  '{"\\ud800":1',
  '﻿{}',
  '[-]',
  '{"a":-}',
  '{"a"x',
  '{"a",',
  '[1}',
  '{]',
  'Bad Gateway',
  'Internal Server Error',
  '{"error":"x"',
  '{"error":"x",}',
  '\u{1F98B}',
  '"\u{1F98B}',
  '[\u{1F98B}]',
  'x\u{1F98B}xxxxxxxxxxxxxxxxxxxxxxxx',
  '{"a":[1,{"b":[true,false,null,"s\\n"]}]}',
  ' [ ] ',
  '{}',
  '[]',
  '0',
  '-0',
  '1E+2',
  '"\\u00e9"',
  '[[[[[[[[[[1]]]]]]]]]]',
  '[[[[[[[[[[1]]]]]]]]]',
];

const PARTS = [
  '{',
  '}',
  '[',
  ']',
  ':',
  ',',
  '"',
  '\\',
  'u',
  '0',
  '1',
  '-',
  '+',
  '.',
  'e',
  'E',
  't',
  'f',
  'n',
  'x',
  ' ',
  '\n',
  '\r',
  '\t',
  'é',
  '€',
  '\u0000',
  'true',
  'null',
  '"k"',
  '1e',
  '\u{1F98B}',
];

function seeded(seed) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648;
  };
}

function broken(seed, n) {
  const next = seeded(seed);
  const pick = (list) => list[Math.floor(next() * list.length)];
  const value = (depth) => {
    const r = next();
    if (depth > 3 || r < 0.3)
      return pick([0, -1.5, 2e21, 'str', 'a"b', 'é', true, false, null, '']);
    if (r < 0.6)
      return Array.from({ length: Math.floor(next() * 4) }, () =>
        value(depth + 1),
      );
    const o = {};
    for (let i = 0, m = Math.floor(next() * 4); i < m; i++)
      o[pick(['a', 'error', 'message', 'ké', ''])] = value(depth + 1);
    return o;
  };
  const out = [];
  for (let k = 0; k < n; k++) {
    let text = JSON.stringify(value(0), null, next() < 0.3 ? 2 : undefined);
    if (next() < 0.2) text = text.replace(/\n/g, '\r\n');
    const edits = 1 + Math.floor(next() * 3);
    for (let e = 0; e < edits; e++) {
      const at = Math.floor(next() * (text.length + 1));
      const r = next();
      if (r < 0.35) text = text.slice(0, at) + text.slice(at + 1);
      else if (r < 0.8) text = text.slice(0, at) + pick(PARTS) + text.slice(at);
      else text = text.slice(0, at);
    }
    // Only well-formed text: a lone surrogate can't reach a fixture.
    if (
      /[\uD800-\uDFFF]/.test(
        text.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ''),
      )
    )
      continue;
    out.push(text);
  }
  return out;
}

function message(text) {
  try {
    JSON.parse(text);
    return null;
  } catch (error) {
    return error.message;
  }
}

export default async function cases() {
  return each(
    'v8',
    [...PICKED, ...broken(7, 700)].map((text) => ({ text })),
    ({ text }) => message(text),
  );
}
