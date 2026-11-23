// src/posting/adviser/aiService.js: the AI routes of Virga's server, called
// through the web's own requester (session/backendClient.js
// createBackendRequester) over a recorded fetch. Each case records every
// request made, the answer it got, the function's result or its error (every
// field: name, message, status, code, detail, payload), what the month's
// usage store holds afterwards, and what onUsage heard. aiErrorMessage's
// sentences are cases of their own. Swift: VirgaPosting/Adviser/AIService.swift
// over VirgaBackend and RecordedFetch.
//
// Inputs from aiService.test.js, plus every refusal the server and the
// requester make (monthly_limit with and without a limit, rate_limited,
// not_enough_posts, 401, 413, 429, 502, 503, `success: false`, no answer,
// an answer that isn't JSON), loose payloads and loose answers.

import {
  ALT_TEXT_MIME_TYPES,
  AI_REQUEST_TIMEOUT_MS,
  MAX_ALT_TEXT_BASE64,
  aiErrorMessage,
  analyzePost,
  generateAltText,
  generateAltTextForFile,
  synthesizeStyle,
} from '../../../src/posting/adviser/aiService.js';
import { createBackendRequester } from '../../../src/session/backendClient.js';
import { each, value } from './_helpers.js';
import { atNow } from './_composer.js';
import { inTurn, json, recordFetch } from './_fetch.js';

export const sources = ['src/posting/adviser/aiService.js'];

const SERVER = 'https://server.example';
const DID = 'did:plc:writer';
const TOKEN = `vg_${'0f'.repeat(32)}`;
const NOW = Date.parse('2026-11-12T10:00:00Z');
const KEY = `virga:adviser-usage:${DID}`;

function memoryStore(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

function snapshot(store) {
  const out = {};
  for (const [k, v] of store.map) {
    try {
      out[k] = { json: JSON.parse(v) };
    } catch {
      out[k] = { text: v };
    }
  }
  return out;
}

function errorShape(err) {
  return {
    name: err?.name ?? null,
    message: err?.message ?? null,
    status: err?.status ?? null,
    code: err?.code ?? null,
    detail: err?.detail ?? null,
    payload: err?.payload ?? null,
    ...(err?.canceled ? { canceled: true } : {}),
  };
}

/** The image a case names: inline base64, or `{ repeat, count }` of one character. */
function imageOf(payload) {
  if (!payload?.image) return payload;
  const { image, ...rest } = payload;
  return { ...rest, imageBase64: image.repeat.repeat(image.count) };
}

const CALLS = {
  analyzePost: (req, input, opts) => analyzePost(req, input.payload, opts),
  synthesizeStyle: (req, input, opts) =>
    synthesizeStyle(req, input.payload, opts),
  generateAltText: (req, input, opts, usages) =>
    generateAltText(
      req,
      {
        ...imageOf(input.payload),
        ...(input.withOnUsage ? { onUsage: (u) => usages.push(u) } : {}),
      },
      opts,
    ),
  generateAltTextForFile: (req, input, opts, usages) =>
    generateAltTextForFile(
      req,
      input.file
        ? new File([new Uint8Array(input.file.bytes)], input.file.name, {
            type: input.file.type,
          })
        : null,
      {
        ...(input.payload || {}),
        ...(input.withOnUsage ? { onUsage: (u) => usages.push(u) } : {}),
        ...opts,
      },
    ),
};

/**
 * One call as the composer makes it: the posting account's requester
 * (`requester: 'none'` is no requester, `did` the account it acts as), a
 * store holding `initial`, a signal already aborted when `aborted`.
 */
async function call(fn, input) {
  const {
    answers = [],
    initial = {},
    requester = 'yes',
    did = DID,
    aborted,
  } = input;
  const store = memoryStore(initial);
  const usages = [];
  const responder = inTurn(...(answers.length ? answers : [json({})]));
  return atNow(NOW, () =>
    recordFetch(
      responder,
      async () => {
        const req =
          requester === 'none'
            ? null
            : createBackendRequester({
                backendUrl: SERVER,
                token: () => TOKEN,
                did,
              });
        const controller = new AbortController();
        if (aborted) controller.abort();
        let out;
        try {
          out = {
            value:
              (await CALLS[fn](
                req,
                input,
                { store, ...(aborted ? { signal: controller.signal } : {}) },
                usages,
              )) ?? null,
          };
        } catch (err) {
          out = { error: errorShape(err) };
        }
        return { ...out, store: snapshot(store), usages };
      },
      { now: NOW },
    ),
  );
}

const ok = (body) => json(body);
const refuse = (status, body) => json(body, status);
const GOALS = { presets: { reduceNegativity: true }, customText: '' };
const usedUp = (extra = {}) =>
  JSON.stringify({ month: '2026-11', used: 30, limit: 30, ...extra });

const ANALYZE = [
  {
    $id: 'the-whole-read',
    payload: {
      text: 'a draft',
      goals: GOALS,
      scenario: 'reply',
      context: { kind: 'reply', thread: [], target: null },
      writingChecks: { typos: true },
    },
    answers: [ok({ overallStatus: 'ok', checks: [] })],
  },
  { $id: 'only-the-text', payload: { text: 'hi' }, answers: [ok({})] },
  {
    $id: 'falsy-parts-left-out',
    payload: {
      text: ' hi ',
      goals: null,
      scenario: '',
      context: 0,
      writingChecks: false,
    },
    answers: [ok({ overallStatus: 'ok' })],
  },
  {
    $id: 'keeps-the-months-count',
    payload: { text: 'hi' },
    answers: [ok({ overallStatus: 'ok', usage: { used: 7, limit: 30 } })],
  },
  {
    $id: 'monthly-limit',
    payload: { text: 'hi' },
    answers: [refuse(429, { error: 'monthly_limit', limit: 30, used: 30 })],
  },
  {
    $id: 'monthly-limit-without-a-limit',
    payload: { text: 'hi' },
    initial: {
      [KEY]: JSON.stringify({ month: '2026-11', used: 3, limit: 50 }),
    },
    answers: [refuse(429, { error: 'monthly_limit' })],
  },
  {
    $id: 'monthly-limit-as-a-code',
    payload: { text: 'hi' },
    answers: [
      refuse(429, { code: 'monthly_limit', error: 'Used up.', limit: 12 }),
    ],
  },
  {
    $id: 'unlimited-now',
    payload: { text: 'hi' },
    initial: {
      [KEY]: usedUp({ style: { month: '2026-11', used: 2, limit: 3 } }),
    },
    answers: [ok({ overallStatus: 'ok', checks: [] })],
  },
  {
    $id: 'unlimited-now-nothing-else-kept',
    payload: { text: 'hi' },
    initial: { [KEY]: usedUp() },
    answers: [ok({ overallStatus: 'ok' })],
  },
  {
    $id: 'keeps-the-count-on-another-failure',
    payload: { text: 'hi' },
    initial: { [KEY]: usedUp() },
    answers: [refuse(503, { error: 'AI unavailable' })],
  },
  {
    $id: 'rate-limited',
    payload: { text: 'hi' },
    answers: [refuse(429, { error: 'rate_limited' })],
  },
  {
    $id: 'busy',
    payload: { text: 'hi' },
    answers: [refuse(429, { error: 'Slow down.' })],
  },
  {
    $id: 'signed-out',
    payload: { text: 'hi' },
    answers: [refuse(401, { error: 'Unauthorized', code: 'AUTH_REQUIRED' })],
  },
  {
    $id: 'too-large',
    payload: { text: 'hi' },
    answers: [{ status: 413, text: 'Request Entity Too Large' }],
  },
  {
    $id: 'detail',
    payload: { text: 'hi' },
    answers: [refuse(400, { error: 'Missing "text"' })],
  },
  {
    $id: 'bare-502',
    payload: { text: 'hi' },
    answers: [{ status: 502, text: '<html>Bad gateway</html>' }],
  },
  {
    $id: 'client-unavailable',
    payload: { text: 'hi' },
    answers: [refuse(500, { code: 'VIRGA_CLIENT_UNAVAILABLE', message: 'x' })],
  },
  {
    $id: 'success-false',
    payload: { text: 'hi' },
    answers: [ok({ success: false, error: 'The read failed.' })],
  },
  {
    $id: 'success-false-bare',
    payload: { text: 'hi' },
    answers: [ok({ success: false })],
  },
  { $id: 'offline', payload: { text: 'hi' }, answers: ['offline'] },
  {
    $id: 'not-json',
    payload: { text: 'hi' },
    answers: [{ status: 200, text: 'not json' }],
  },
  { $id: 'null-answer', payload: { text: 'hi' }, answers: [ok(null)] },
  {
    $id: 'usage-not-counted',
    payload: { text: 'hi' },
    initial: { [KEY]: usedUp() },
    answers: [ok({ overallStatus: 'ok', usage: { used: 'x', limit: 30 } })],
  },
  {
    $id: 'unicode',
    payload: { text: 'naïve 👩‍👩‍👧 café', scenario: 'thread' },
    answers: [
      ok({ overallStatus: 'caution', checks: [{ status: 'caution' }] }),
    ],
  },
  {
    $id: 'already-ended',
    payload: { text: 'hi' },
    aborted: true,
    answers: [ok({})],
  },
  { $id: 'needs-a-draft', payload: { text: '  ' } },
  { $id: 'needs-text', payload: { text: 5 } },
  { $id: 'no-payload' },
  {
    $id: 'needs-the-server',
    payload: { text: 'hi' },
    requester: 'none',
  },
  {
    $id: 'empty-before-the-server',
    payload: { text: '' },
    requester: 'none',
  },
  {
    $id: 'an-account-it-does-not-know',
    payload: { text: 'hi' },
    did: '',
    initial: { [KEY]: usedUp() },
    answers: [refuse(429, { error: 'monthly_limit', limit: 30 })],
  },
];

const STYLE = [
  {
    $id: 'the-reading',
    payload: { posts: ['a'], guidance: '' },
    answers: [
      ok({
        summary: ' Lowercase. ',
        analyzedCount: 40,
        usage: { used: 1, limit: 3 },
      }),
    ],
  },
  {
    $id: 'with-the-note-and-the-last-reading',
    payload: {
      posts: ['a', 'b'],
      guidance: '  i capitalize names  ',
      previousSummary: ' Old reading. ',
    },
    answers: [ok({ success: true, summary: 'New.', analyzedCount: 2 })],
  },
  {
    $id: 'loose-payload',
    payload: { posts: 'a', guidance: 5, previousSummary: '   ' },
    answers: [ok({ summary: 5, analyzedCount: '40', usage: 0 })],
  },
  {
    $id: 'fractional-count',
    payload: { posts: [{ text: 'x' }] },
    answers: [ok({ summary: 'S', analyzedCount: 12.5, usage: null })],
  },
  {
    $id: 'not-enough-posts',
    payload: { posts: [] },
    answers: [refuse(400, { error: 'not_enough_posts', minimum: 5 })],
  },
  {
    $id: 'monthly-limit',
    payload: { posts: ['a'] },
    answers: [refuse(429, { error: 'monthly_limit', limit: 3, used: 3 })],
  },
  {
    $id: 'unlimited-now',
    payload: { posts: ['a'] },
    initial: {
      [KEY]: usedUp({ style: { month: '2026-11', used: 3, limit: 3 } }),
    },
    answers: [ok({ summary: 'S', analyzedCount: 1 })],
  },
  { $id: 'no-payload', answers: [ok({})] },
  { $id: 'needs-the-server', payload: { posts: ['a'] }, requester: 'none' },
];

const PNG = { imageBase64: 'AAAA', mimeType: 'image/png' };

const ALT = [
  {
    $id: 'notes-and-kind',
    payload: {
      ...PNG,
      followUp: 'Make it shorter.',
      previousAltText: 'Settings.',
      presets: ['shorter'],
      kind: 'interface',
    },
    answers: [ok({ altText: 'x' })],
  },
  {
    $id: 'none-of-either',
    payload: { ...PNG, presets: [], kind: null },
    answers: [ok({ altText: 'x' })],
  },
  {
    $id: 'blank-words-left-out',
    payload: {
      ...PNG,
      context: '  ',
      followUp: '',
      previousAltText: 7,
      presets: 'shorter',
      kind: 0,
    },
    answers: [ok({ altText: 'x' })],
  },
  {
    $id: 'words-kept-as-written',
    payload: {
      ...PNG,
      context: ' my post ',
      kind: 'photo',
      presets: ['detail', 'plain'],
    },
    answers: [ok({ altText: 'x' })],
  },
  {
    $id: 'reports-the-count',
    payload: PNG,
    withOnUsage: true,
    answers: [
      ok({ altText: ' A settings screen. ', usage: { used: 4, limit: 15 } }),
    ],
  },
  {
    $id: 'no-count',
    payload: PNG,
    withOnUsage: true,
    answers: [ok({ altText: 'A heron.' })],
  },
  {
    $id: 'count-not-numbers',
    payload: PNG,
    withOnUsage: true,
    answers: [ok({ altText: 'A heron.', usage: { used: '4', limit: 15 } })],
  },
  {
    $id: 'count-kept-without-a-listener',
    payload: PNG,
    answers: [ok({ altText: 'A heron.', usage: { used: 2, limit: 15 } })],
  },
  {
    $id: 'not-text',
    payload: PNG,
    answers: [ok({ altText: ['a'] })],
  },
  {
    $id: 'monthly-limit',
    payload: PNG,
    answers: [refuse(429, { error: 'monthly_limit', limit: 15 })],
  },
  {
    $id: 'every-type',
    payload: { ...PNG, mimeType: 'image/webp' },
    answers: [ok({ altText: 'w' })],
  },
  {
    $id: 'gif',
    payload: { ...PNG, mimeType: 'image/gif' },
    answers: [ok({ altText: 'g' })],
  },
  {
    $id: 'jpeg',
    payload: { ...PNG, mimeType: 'image/jpeg' },
    answers: [ok({ altText: 'j' })],
  },
  { $id: 'heic', payload: { ...PNG, mimeType: 'image/heic' } },
  { $id: 'upper-case-type', payload: { ...PNG, mimeType: 'IMAGE/PNG' } },
  { $id: 'no-type', payload: { imageBase64: 'AAAA' } },
  { $id: 'no-image', payload: { mimeType: 'image/png' } },
  { $id: 'empty-image', payload: { imageBase64: '', mimeType: 'image/png' } },
  {
    $id: 'image-not-text',
    payload: { imageBase64: 42, mimeType: 'image/png' },
  },
  {
    $id: 'too-large',
    payload: {
      image: { repeat: 'A', count: MAX_ALT_TEXT_BASE64 + 4 },
      mimeType: 'image/png',
    },
  },
  {
    $id: 'just-too-large',
    payload: {
      image: { repeat: 'A', count: MAX_ALT_TEXT_BASE64 + 1 },
      mimeType: 'image/png',
    },
  },
  {
    $id: 'largest-allowed',
    requester: 'none',
    payload: {
      image: { repeat: 'A', count: MAX_ALT_TEXT_BASE64 },
      mimeType: 'image/png',
    },
  },
  { $id: 'needs-the-server', payload: PNG, requester: 'none' },
  { $id: 'no-payload' },
];

const FILES = [
  {
    $id: 'the-files-bytes-and-type',
    file: { bytes: [97, 98, 99], name: 'p.jpg', type: 'image/jpeg' },
    payload: { context: 'my post' },
    answers: [ok({ altText: 'A photo.' })],
  },
  {
    $id: 'a-file-without-a-type',
    file: { bytes: [0, 1, 2, 253, 254, 255], name: 'blob', type: '' },
    answers: [ok({ altText: 'Bytes.' })],
  },
  {
    $id: 'every-byte',
    file: {
      bytes: Array.from({ length: 256 }, (_, i) => i),
      name: 'b.png',
      type: 'image/png',
    },
    payload: {
      kind: 'chart',
      presets: ['detail'],
      followUp: 'More.',
      previousAltText: 'A chart.',
    },
    withOnUsage: true,
    answers: [ok({ altText: 'A chart.', usage: { used: 1, limit: 15 } })],
  },
  {
    $id: 'a-type-it-cannot-describe',
    file: { bytes: [1], name: 'p.heic', type: 'image/heic' },
  },
  {
    $id: 'an-empty-file',
    file: { bytes: [], name: 'empty.png', type: 'image/png' },
  },
  {
    $id: 'the-files-image-wins',
    file: { bytes: [1, 2, 3], name: 'p.png', type: 'image/png' },
    payload: { imageBase64: 'ZZZZ', mimeType: 'image/heic', context: 'c' },
    answers: [ok({ altText: 'Mine.' })],
  },
  { $id: 'needs-a-file', file: null },
];

const MESSAGES = [
  { err: { code: 'rate_limited', status: 429 } },
  { err: { status: 429 } },
  { err: { status: 401 } },
  { err: { status: 503 } },
  { err: { status: 413 } },
  { err: { code: 'TIMEOUT' } },
  { err: { code: 'NETWORK_ERROR' } },
  { err: { status: 400, detail: 'Missing "imageBase64"' } },
  { err: { status: 502 } },
  { err: { code: 'monthly_limit', status: 429 } },
  {
    err: { code: 'not_enough_posts', status: 400, detail: 'not_enough_posts' },
  },
  { err: { code: 'VIRGA_CLIENT_UNAVAILABLE', status: 500 } },
  { err: { code: 'NEEDS_BACKEND', message: 'Sign in through Virga.' } },
  { err: { code: 'NEEDS_BACKEND' } },
  { err: { code: 'EMPTY', message: 'Write something first.' } },
  { err: { code: '', status: 418 } },
  { err: { code: null, status: 0, message: 'Plain.' } },
  { err: { status: '503' } },
  { err: { status: true } },
  { err: { status: 500, detail: 7, message: 'Server error' } },
  { err: { status: 500, detail: '' } },
  { err: { message: '' } },
  { err: {} },
  { err: null },
  { err: { code: 'monthly_limit ', status: 429 } },
  { err: { code: 'TIMEOUT', status: 401 } },
  { err: { status: 401, detail: 'Expired.' } },
  { err: { status: 2.5 } },
  { err: { status: -1 } },
];

export default async function cases() {
  const all = [
    value('aiConstants', {
      AI_REQUEST_TIMEOUT_MS,
      ALT_TEXT_MIME_TYPES,
      MAX_ALT_TEXT_BASE64,
    }),
  ];
  for (const [fn, inputs] of [
    ['analyzePost', ANALYZE],
    ['synthesizeStyle', STYLE],
    ['generateAltText', ALT],
    ['generateAltTextForFile', FILES],
  ]) {
    all.push(...(await each(fn, inputs, (input) => call(fn, input))));
  }
  all.push(
    ...(await each('aiErrorMessage', MESSAGES, ({ err }) => ({
      message: aiErrorMessage(err) ?? null,
    }))),
  );
  return all;
}
