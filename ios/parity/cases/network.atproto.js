// src/lib/atproto.js: DID documents (PLC and did:web), a DID's PDS,
// profiles, a did:plc's history and the dates inside record keys. Swift:
// VirgaNetwork/Lib/Atproto.swift. Network cases are recorded exchanges
// (_fetch.js).
//
// The module caches DID documents for ten minutes, in module state that
// lives across cases and across the runner's two builds. Each case runs on a
// clock eleven minutes past the last, so every case starts with nothing
// cached and no case sees another's documents (the clock itself isn't part
// of any output). The Swift test gives each case a fresh cache.

import {
  didWebDocumentUrl,
  fetchWithTimeout,
  getDidDocument,
  getPlcHistory,
  getProfile,
  resolvePds,
  resolveProfiles,
  rkeyFromAtUri,
  tidToTimestamp,
} from '../../../src/lib/atproto.js';
import { each } from './_helpers.js';
import { inTurn, json, recordFetchFresh } from './_fetch.js';

export const sources = ['src/lib/atproto.js'];

const recorded = recordFetchFresh;

const DID = 'did:plc:virgaharnessmira2zq4x';
const PLC_DOC = {
  '@context': ['https://www.w3.org/ns/did/v1'],
  id: DID,
  alsoKnownAs: ['at://mira.example.com'],
  service: [
    {
      id: '#bsky_notif',
      type: 'BskyNotificationService',
      serviceEndpoint: 'https://notify.example',
    },
    {
      id: '#atproto_pds',
      type: 'AtprotoPersonalDataServer',
      serviceEndpoint: 'https://morel.us-east.host.bsky.network/',
    },
  ],
};

const errorOf = (fn) => async () => {
  try {
    return { value: await fn() };
  } catch (e) {
    return {
      error: {
        message: e.message,
        status: e.status ?? null,
        url: e.url ?? null,
      },
    };
  }
};

export default async function cases() {
  return [
    ...(await each(
      'didWebDocumentUrl',
      [
        { did: 'did:web:example.com' },
        { did: 'did:web:localhost%3A2583' },
        { did: 'did:web:localhost%3a2583' },
        { did: 'did:web:Example.COM' },
        { did: 'did:web:example.com:path' },
        { did: 'did:web:example.com%3Aabc' },
        { did: 'did:web:example.com%3A' },
        { did: 'did:web:a_b.com' },
        { did: 'did:web:exa mple.com' },
        { did: 'did:web:exa\nmple.com' },
        { did: 'did:web:' },
        { did: 'did:web:münchen.de' },
        { did: 'did:web:example.com/x' },
        { did: 'did:web:example.com?x' },
        { did: 'did:web:example.com#x' },
        { did: 'did:web:%3A80' },
        { did: 'did:web:example.com%3A80%3A90' },
        { did: 'did:plc:abc' },
        { did: 'DID:web:example.com' },
        { did: '' },
        { did: null },
      ],
      ({ did }) => didWebDocumentUrl(did),
    )),

    ...(await each(
      'rkeyFromAtUri',
      [
        { uri: `at://${DID}/app.bsky.feed.post/3kabc` },
        { uri: `at://${DID}/app.bsky.feed.post/3kabc?x#y` },
        { uri: `at://${DID}/app.bsky.feed.post/` },
        { uri: `at://${DID}/app.bsky.feed.post` },
        { uri: 'https://bsky.app/profile/x/post/y' },
        { uri: '' },
        { uri: null },
      ],
      ({ uri }) => rkeyFromAtUri(uri),
    )),

    ...(await each(
      'tidToTimestamp',
      [
        { rkey: '3kabcdefghijk' },
        { rkey: '3lcgnmbujy22x' },
        { rkey: '2222222222222' },
        { rkey: '2222222222223' },
        { rkey: '22222222222zz' },
        { rkey: 'zzzzzzzzzzzzz' },
        { rkey: 'jzzzzzzzzzzzz' },
        { rkey: 'kaaaaaaaaaaaa' },
        { rkey: '3KABCDEFGHIJK' },
        { rkey: '3kabcdefghij' },
        { rkey: '3kabcdefghijkl' },
        { rkey: '3kabcdefghij1' },
        { rkey: '3kabcdefghij😀' },
        { rkey: 'self' },
        { rkey: '' },
        { rkey: null },
      ],
      ({ rkey }) => tidToTimestamp(rkey),
    )),

    ...(await each(
      'getDidDocument',
      [
        { $id: 'plc', did: DID, answers: [json(PLC_DOC)] },
        {
          $id: 'plc-encoded',
          did: 'did:plc:a/b c',
          answers: [json({ id: 'x' })],
        },
        {
          $id: 'web',
          did: 'did:web:example.com',
          answers: [json({ id: 'did:web:example.com' })],
        },
        {
          $id: 'web-port',
          did: 'did:web:localhost%3A2583',
          answers: [json({ id: 'did:web:localhost%3A2583' })],
        },
        { $id: 'web-unusable', did: 'did:web:example.com:path', answers: [] },
        { $id: 'missing', did: '', answers: [] },
        {
          $id: 'not-found',
          did: DID,
          answers: [json({ message: 'DID not registered: did:plc:x' }, 404)],
        },
        {
          $id: 'gone-text',
          did: DID,
          answers: [{ status: 410, text: 'é'.repeat(250) }],
        },
        { $id: 'offline', did: DID, answers: ['offline'] },
        { $id: 'shared', did: DID, twice: true, answers: [json(PLC_DOC)] },
        {
          $id: 'failure-forgotten',
          did: DID,
          twice: true,
          answers: ['offline', json(PLC_DOC)],
        },
      ],
      ({ did, answers, twice }) =>
        recorded(inTurn(...answers), async () => {
          const first = await errorOf(() => getDidDocument(did))();
          if (!twice) return first;
          return [first, await errorOf(() => getDidDocument(did))()];
        }),
    )),

    ...(await each(
      'resolvePds',
      [
        { $id: 'pds', did: DID, answers: [json(PLC_DOC)] },
        {
          $id: 'first-service',
          did: DID,
          answers: [
            json({
              service: [
                { id: '#other', serviceEndpoint: 'https://first.example//' },
              ],
            }),
          ],
        },
        { $id: 'no-services', did: DID, answers: [json({ id: DID })] },
        {
          $id: 'empty-endpoint',
          did: DID,
          answers: [
            json({
              service: [
                { id: '#atproto_pds', serviceEndpoint: '' },
                { serviceEndpoint: 'https://b.example' },
              ],
            }),
          ],
        },
        {
          $id: 'service-not-array',
          did: DID,
          answers: [json({ service: 'https://x.example' })],
        },
        {
          $id: 'service-null-entry',
          did: DID,
          answers: [
            json({
              service: [
                null,
                { id: '#atproto_pds', serviceEndpoint: 'https://x' },
              ],
            }),
          ],
        },
        {
          $id: 'service-null-after',
          did: DID,
          answers: [
            json({
              service: [
                { id: '#atproto_pds', serviceEndpoint: 'https://x/' },
                null,
              ],
            }),
          ],
        },
        {
          $id: 'endpoint-not-string',
          did: DID,
          answers: [
            json({ service: [{ id: '#atproto_pds', serviceEndpoint: 5 }] }),
          ],
        },
        {
          $id: 'endpoint-object',
          did: DID,
          answers: [
            json({
              service: [
                { id: '#atproto_pds', serviceEndpoint: { uri: 'https://x' } },
              ],
            }),
          ],
        },
        { $id: 'doc-is-array', did: DID, answers: [json([1, 2])] },
        { $id: 'doc-is-null', did: DID, answers: [json(null)] },
        {
          $id: 'web',
          did: 'did:web:example.com',
          answers: [
            json({
              service: [
                {
                  id: '#atproto_pds',
                  serviceEndpoint: 'https://pds.example.com',
                },
              ],
            }),
          ],
        },
        { $id: 'error', did: DID, answers: [{ status: 500, text: 'boom' }] },
      ],
      ({ did, answers }) => recorded(inTurn(...answers), () => resolvePds(did)),
    )),

    ...(await each(
      'getProfile',
      [
        {
          $id: 'handle',
          actor: 'mira.example.com',
          answers: [
            json({ did: DID, handle: 'mira.example.com', displayName: 'Mira' }),
          ],
        },
        {
          $id: 'did',
          actor: DID,
          answers: [json({ did: DID, handle: 'mira.example.com' })],
        },
        {
          $id: 'encoded',
          actor: 'a b/é?',
          answers: [json({ did: DID, handle: 'x' })],
        },
        {
          $id: 'appview',
          actor: 'x',
          appview: 'https://api.example',
          answers: [json({ did: DID, handle: 'x' })],
        },
        {
          $id: 'not-found',
          actor: 'gone.example.com',
          answers: [
            json(
              { error: 'InvalidRequest', message: 'Profile not found' },
              400,
            ),
          ],
        },
        { $id: 'offline', actor: 'x', answers: ['offline'] },
      ],
      ({ actor, appview, answers }) =>
        recorded(inTurn(...answers), () =>
          getProfile(actor, appview ? { appview } : undefined),
        ),
    )),

    ...(await each(
      'resolveProfiles',
      [
        {
          $id: 'one-chunk',
          dids: ['did:plc:a', 'did:plc:b', 'did:plc:a', '', null, 'did:plc:c'],
          answers: [
            json({
              profiles: [
                {
                  did: 'did:plc:a',
                  handle: 'a.example',
                  displayName: 'A',
                  avatar: 'https://cdn/a',
                },
                { did: 'did:plc:b', handle: 'b.example' },
                { handle: 'nodid.example' },
                null,
                { did: 'did:plc:c', handle: '', displayName: null },
              ],
            }),
          ],
        },
        {
          $id: 'chunks',
          dids: Array.from(
            { length: 53 },
            (_, i) => `did:plc:${String(i).padStart(3, '0')}`,
          ),
          answers: [
            (req) =>
              json({
                profiles: new URL(req.url).searchParams
                  .getAll('actors')
                  .map((did) => ({ did, handle: `${did.slice(8)}.example` })),
              }),
          ],
        },
        {
          $id: 'retry-once',
          dids: ['did:plc:a'],
          answers: [
            'offline',
            json({ profiles: [{ did: 'did:plc:a', handle: 'a.example' }] }),
          ],
        },
        {
          $id: 'chunk-skipped',
          dids: Array.from({ length: 30 }, (_, i) => `did:plc:${i}`),
          answers: [
            { status: 500, text: 'boom' },
            { status: 502, text: 'again' },
            json({ profiles: [{ did: 'did:plc:29', handle: 'last.example' }] }),
          ],
        },
        { $id: 'empty', dids: [], answers: [] },
        { $id: 'nothing', dids: null, answers: [] },
        { $id: 'profiles-missing', dids: ['did:plc:a'], answers: [json({})] },
        {
          $id: 'appview',
          dids: ['did:plc:a'],
          appview: 'https://api.example',
          answers: [json({ profiles: [] })],
        },
      ],
      ({ dids, appview, answers }) =>
        recorded(inTurn(...answers), () =>
          resolveProfiles(dids, appview ? { appview } : undefined),
        ),
    )),

    ...(await each(
      'getPlcHistory',
      [
        {
          $id: 'log',
          did: DID,
          answers: [
            json([
              {
                createdAt: '2023-04-01T00:00:00.000Z',
                nullified: false,
                operation: {
                  type: 'create',
                  handle: 'mira.bsky.social',
                  service: 'https://bsky.social',
                },
              },
              {
                createdAt: '2024-01-01T00:00:00.000Z',
                nullified: true,
                operation: {
                  type: 'plc_operation',
                  alsoKnownAs: [
                    'at://mira.example.com',
                    'https://mira.example',
                    'at://',
                    null,
                    5,
                  ],
                  services: {
                    atproto_pds: {
                      type: 'AtprotoPersonalDataServer',
                      endpoint: 'https://morel.example',
                    },
                  },
                },
              },
              {
                createdAt: '2024-02-01T00:00:00.000Z',
                operation: { type: 'plc_tombstone' },
              },
              null,
              { operation: 'weird' },
              {
                createdAt: '',
                nullified: 1,
                operation: {
                  alsoKnownAs: [],
                  handle: 'ignored',
                  services: { atproto_pds: {} },
                },
              },
            ]),
          ],
        },
        {
          $id: 'aka-not-array',
          did: DID,
          answers: [json([{ operation: { alsoKnownAs: 'at://x' } }])],
        },
        { $id: 'not-array', did: DID, answers: [json({ error: 'x' })] },
        {
          $id: 'not-ok',
          did: DID,
          answers: [json({ message: 'DID not registered' }, 404)],
        },
        {
          $id: 'not-json',
          did: DID,
          answers: [{ status: 200, text: '<html>' }],
        },
        { $id: 'offline', did: DID, answers: ['offline'] },
        { $id: 'web', did: 'did:web:example.com', answers: [] },
        { $id: 'unencoded', did: 'did:plc:a b', answers: [json([])] },
        { $id: 'empty', did: '', answers: [] },
      ],
      ({ did, answers }) =>
        recorded(inTurn(...answers), () => getPlcHistory(did)),
    )),

    ...(await each(
      'fetchWithTimeout',
      [
        {
          $id: 'passes-through',
          url: 'https://constellation.example/x?y=1',
          init: {
            method: 'POST',
            headers: { Accept: 'application/json' },
            body: '{"a":1}',
          },
          answers: [json({ ok: true })],
        },
      ],
      ({ url, init, answers }) =>
        recorded(inTurn(...answers), async () => {
          const res = await fetchWithTimeout(url, init);
          return { status: res.status, body: await res.json() };
        }),
    )),
  ];
}
