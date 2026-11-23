// src/lib/constellation.js: the backlinks service, its retries and back-off,
// and the two readers of its answers. Swift: VirgaNetwork/Lib/
// Constellation.swift. Network cases are recorded exchanges with their waits
// (_fetch.js): a 429 asking for 600 s records a wait of 15000.

import {
  backlinkRows,
  flattenSources,
  getBacklinkCount,
  getBacklinkSources,
  getBacklinks,
  getManyToMany,
} from '../../../src/lib/constellation.js';
import { FIXED_NOW, each } from './_helpers.js';
import { inTurn, json, recordFetch } from './_fetch.js';

export const sources = ['src/lib/constellation.js'];

const POST = 'at://did:plc:me/app.bsky.feed.post/3k';
const ok = json({
  records: [{ did: 'did:plc:a', collection: 'app.bsky.feed.like', rkey: '3l' }],
  cursor: 'c2',
});
const limited = (retryAfter) => ({
  status: 429,
  json: { error: 'RateLimitExceeded' },
  ...(retryAfter === undefined
    ? {}
    : { headers: { 'Retry-After': retryAfter } }),
});

// `/links/all` answers, written as text so the key order (which decides
// equal counts) is in the fixture.
const SOURCES = {
  typical: {
    links: {
      'app.bsky.feed.like': {
        '.subject.uri': { records: 3, distinct_dids: 2 },
      },
      'app.bsky.feed.post': {
        '.reply.root.uri': { records: 29, distinct_dids: 11 },
        '.reply.parent.uri': { records: 5 },
      },
      'app.bsky.feed.repost': {
        '.subject.uri': { records: 3, distinct_dids: 3 },
      },
      'app.bsky.graph.block': { subject: { count: 7, distinctDids: 7 } },
    },
  },
  ties: {
    links: {
      'z.coll': { '.a': { records: 1 } },
      'a.coll': { '.b': { records: 1 }, '.a': { records: 1 } },
      'm.coll': { '.c': { records: 1 } },
    },
  },
  bare: { 'app.bsky.feed.like': { '.subject.uri': { records: 1 } } },
  integerKeys: {
    links: {
      b: { '.x': { records: 1 } },
      10: { '.y': { records: 1 } },
      2: { '.z': { records: 1 } },
    },
  },
  oddCounts: {
    links: {
      c1: {
        '.a': { records: null, count: 4 },
        '.b': {},
        '.c': null,
        '.d': { records: '7' },
        '.e': { records: 'x' },
      },
      c2: 'skip me',
      c3: null,
      c4: [{ records: 9 }, { records: [2] }],
      c5: { '.f': { records: 0, distinct_dids: null, distinctDids: 3 } },
    },
  },
  nanCounts: {
    links: {
      a: {
        '.1': { records: 1 },
        '.2': { records: 'x' },
        '.3': { records: 3 },
        '.4': { records: 2 },
      },
    },
  },
  emptyLinks: { links: {} },
  linksFalsy: { links: 0, 'x.coll': { '.p': { records: 1 } } },
  // Keys by code unit: two spellings of "café" are two collections, and a
  // path's leading dot is one code unit even with a mark after it.
  codeUnits: {
    links: {
      'caf\u00e9': { '.\u0301subject': { records: 2 } },
      'cafe\u0301': { '.x': { records: 1 } },
    },
  },
  arrayRaw: [{ '.a': { records: 2 } }, 'x'],
  stringRaw: 'abc',
  numberRaw: 5,
};

export default async function cases() {
  return [
    ...(await each(
      'backlinkRows',
      [
        {
          page: {
            total: 2,
            records: [{ did: 'did:plc:a', rkey: '3l' }],
            cursor: null,
          },
        },
        {
          page: {
            linking_records: [{ did: 'did:plc:a' }, { did: 'did:plc:b' }],
          },
        },
        { page: { records: [] } },
        { page: { records: [], linking_records: [{ did: 'x' }] } },
        { page: { records: 'odd' } },
        { page: null },
        { page: {} },
      ],
      ({ page }) => backlinkRows(page),
    )),

    ...(await each(
      'flattenSources',
      [
        ...Object.entries(SOURCES).map(([$id, raw]) => ({
          $id,
          text: JSON.stringify(raw),
        })),
        {
          $id: 'duplicate-keys',
          text: '{"links":{"b":{".x":{"records":1}},"a":{".y":{"records":1}},"b":{".z":{"records":1}}}}',
        },
        { $id: 'null', text: 'null' },
        { $id: 'false', text: 'false' },
      ],
      ({ text }) => flattenSources(JSON.parse(text)),
    )),

    ...(await each(
      'getBacklinkSources',
      [
        {
          $id: 'ok',
          target: POST,
          answers: [{ status: 200, text: JSON.stringify(SOURCES.ties) }],
        },
        {
          $id: 'did',
          target: 'did:plc:me',
          answers: [{ status: 200, text: JSON.stringify(SOURCES.typical) }],
        },
        { $id: 'empty-target', target: '', answers: [] },
        {
          $id: 'not-json',
          target: POST,
          answers: [
            { status: 200, text: 'oops' },
            { status: 200, text: JSON.stringify(SOURCES.bare) },
          ],
        },
      ],
      ({ target, answers }) =>
        recordFetch(inTurn(...answers), async () => {
          const raw = await getBacklinkSources(target);
          return { raw, flat: flattenSources(raw) };
        }),
    )),

    ...(await each(
      'getBacklinkCount',
      [
        {
          $id: 'ok',
          target: POST,
          source: 'app.bsky.feed.like:subject.uri',
          answers: [json({ total: 3 })],
        },
        {
          $id: 'retry-after-seconds',
          target: POST,
          source: 'app.bsky.feed.like:subject.uri',
          answers: [limited('2'), json({ total: 3 })],
        },
        {
          $id: 'retry-after-capped',
          target: POST,
          source: 'app.bsky.feed.like:subject.uri',
          answers: [limited('600'), json({ total: 3 })],
        },
        {
          $id: 'retry-after-fraction',
          target: POST,
          source: 'x:y',
          answers: [limited('0.25'), json({ total: 1 })],
        },
        {
          $id: 'retry-after-negative',
          target: POST,
          source: 'x:y',
          answers: [limited('-5'), json({ total: 1 })],
        },
        {
          $id: 'retry-after-space',
          target: POST,
          source: 'x:y',
          answers: [limited(' '), json({ total: 1 })],
        },
        {
          $id: 'retry-after-date',
          target: POST,
          source: 'x:y',
          answers: [
            limited(new Date(FIXED_NOW + 3_000).toUTCString()),
            json({ total: 1 }),
          ],
        },
        {
          $id: 'retry-after-past-date',
          target: POST,
          source: 'x:y',
          answers: [
            limited(new Date(FIXED_NOW - 60_000).toUTCString()),
            json({ total: 1 }),
          ],
        },
        {
          $id: 'retry-after-garbage',
          target: POST,
          source: 'x:y',
          answers: [limited('soon'), json({ total: 1 })],
        },
        {
          $id: 'backoff-503',
          target: POST,
          source: 'x:y',
          answers: [
            { status: 503, text: '' },
            { status: 502, text: '' },
            { status: 504, text: '' },
            json({ total: 1 }),
          ],
        },
        {
          $id: 'gives-up',
          target: POST,
          source: 'x:y',
          answers: [{ status: 503, text: '' }],
        },
        {
          $id: 'offline-retries',
          target: POST,
          source: 'x:y',
          answers: ['offline', 'offline', json({ total: 2 })],
        },
        {
          $id: 'offline-gives-up',
          target: POST,
          source: 'x:y',
          answers: ['offline'],
        },
        {
          $id: 'not-retried',
          target: POST,
          source: 'x:y',
          answers: [json({ error: 'BadRequest' }, 400)],
        },
        {
          $id: 'server-error',
          target: POST,
          source: 'x:y',
          answers: [{ status: 500, text: 'boom' }],
        },
        {
          $id: 'bad-json-retried',
          target: POST,
          source: 'x:y',
          answers: [{ status: 200, text: '{bad' }, json({ total: 5 })],
        },
        { $id: 'missing-source', target: POST, source: '', answers: [] },
        {
          $id: 'encoding',
          target: 'at://did:plc:é/a b/c&d',
          source: 'a+b:c d',
          answers: [json({ total: 0 })],
        },
      ],
      ({ target, source, answers }) =>
        recordFetch(inTurn(...answers), () => getBacklinkCount(target, source)),
    )),

    ...(await each(
      'getBacklinks',
      [
        {
          $id: 'defaults',
          target: 'did:plc:me',
          source: 'app.bsky.graph.block:subject',
          answers: [ok],
        },
        {
          $id: 'cursor-and-dids',
          target: 'did:plc:me',
          source: 'app.bsky.graph.block:subject',
          options: {
            limit: 100,
            cursor: 'c1',
            dids: ['did:plc:a', 'did:plc:b'],
          },
          answers: [ok],
        },
        {
          $id: 'empty-cursor',
          target: 'did:plc:me',
          source: 's:p',
          options: { cursor: '', dids: [] },
          answers: [ok],
        },
        {
          $id: 'rate-limited',
          target: 'did:plc:me',
          source: 's:p',
          answers: [limited('2'), ok],
        },
        { $id: 'missing-target', target: null, source: 's:p', answers: [] },
      ],
      ({ target, source, options, answers }) =>
        recordFetch(inTurn(...answers), () =>
          getBacklinks(target, source, options),
        ),
    )),

    ...(await each(
      'getManyToMany',
      [
        {
          $id: 'defaults',
          subject: 'did:plc:me',
          source: 'app.bsky.graph.listitem:subject',
          pathToOther: 'list',
          answers: [
            json({
              items: [
                {
                  linkRecord: {
                    did: 'did:plc:o',
                    collection: 'app.bsky.graph.listitem',
                    rkey: '3l',
                  },
                  otherSubject: 'at://did/list/key',
                },
              ],
              cursor: null,
            }),
          ],
        },
        {
          $id: 'all-options',
          subject: 'did:plc:me',
          source: 'app.bsky.graph.listitem:subject',
          pathToOther: 'list',
          options: {
            limit: 10,
            cursor: 'c',
            otherSubject: 'at://did:plc:o/app.bsky.graph.list/1',
          },
          answers: [json({ items: [] })],
        },
        {
          $id: 'missing-path',
          subject: 'did:plc:me',
          source: 's:p',
          pathToOther: '',
          answers: [],
        },
      ],
      ({ subject, source, pathToOther, options, answers }) =>
        recordFetch(inTurn(...answers), () =>
          getManyToMany(subject, source, pathToOther, options),
        ),
    )),
  ];
}
