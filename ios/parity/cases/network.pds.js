// src/session/pds.js: an account's PDS from its DID document, and the
// resolver that caches it. Swift: VirgaNetwork/Session/PDS.swift. The
// resolver cases read DID documents through atproto.js (recorded
// exchanges), each with a resolver of its own.

import {
  createPdsResolver,
  pdsFromDidDocument,
} from '../../../src/session/pds.js';
import { getDidDocument } from '../../../src/lib/atproto.js';
import { each } from './_helpers.js';
import { inTurn, json, recordFetchFresh } from './_fetch.js';

export const sources = ['src/session/pds.js'];

const DID = 'did:plc:virgaharnessmira2zq4x';
const doc = (endpoint, id = '#atproto_pds') => ({
  id: DID,
  service: [
    {
      id: '#bsky_notif',
      type: 'BskyNotificationService',
      serviceEndpoint: 'https://notify.example',
    },
    { id, type: 'AtprotoPersonalDataServer', serviceEndpoint: endpoint },
  ],
});

// atproto.js caches documents in module state; a clock eleven minutes on for
// each case keeps every case's reads its own.
const recorded = recordFetchFresh;

const settle = async (p) => {
  try {
    return { value: await p };
  } catch (e) {
    return { error: e.message };
  }
};

export default async function cases() {
  return [
    ...(await each(
      'pdsFromDidDocument',
      [
        { doc: doc('https://morel.us-east.host.bsky.network/') },
        { doc: doc('https://pds.example///') },
        { doc: doc('https://pds.example', `${DID}#atproto_pds`), did: DID },
        { doc: doc('https://pds.example', `${DID}#atproto_pds`) },
        {
          doc: doc('https://pds.example', 'did:plc:other#atproto_pds'),
          did: DID,
        },
        {
          doc: {
            ...doc('https://pds.example', `${DID}#atproto_pds`),
            id: undefined,
          },
        },
        { doc: { ...doc('https://pds.example', '5#atproto_pds'), id: 5 } },
        { doc: doc('https://pds.example', '#atproto_pds'), did: '' },
        {
          doc: {
            service: [
              { id: '#bsky_notif', serviceEndpoint: 'https://notify.example' },
            ],
          },
        },
        { doc: doc('javascript:alert(1)') },
        { doc: doc('ftp://pds.example') },
        { doc: doc('not a url') },
        { doc: doc('HTTPS://PDS.EXAMPLE/') },
        { doc: doc('http://localhost:2583') },
        { doc: doc('https://pds.example/ ') },
        { doc: doc(' https://pds.example') },
        { doc: doc('https://') },
        { doc: doc(5) },
        { doc: doc({ uri: 'https://x' }) },
        { doc: { service: 'https://x' } },
        {
          doc: {
            service: [
              null,
              'x',
              { id: '#atproto_pds', serviceEndpoint: 'https://second.example' },
            ],
          },
        },
        {
          doc: {
            service: [
              { id: '#atproto_pds' },
              { id: '#atproto_pds', serviceEndpoint: 'https://second.example' },
            ],
          },
        },
        { doc: null },
        { doc: 'did doc' },
      ],
      ({ doc: d, did }) =>
        did === undefined ? pdsFromDidDocument(d) : pdsFromDidDocument(d, did),
    )),

    ...(await each(
      'resolver',
      [
        {
          $id: 'resolves',
          steps: [['resolve', DID]],
          answers: [json(doc('https://pds.example/'))],
        },
        {
          $id: 'shared-and-kept',
          steps: [
            ['resolveTwiceAtOnce', DID],
            ['resolve', DID],
          ],
          answers: [json(doc('https://pds.example'))],
        },
        {
          $id: 'forgets-failure',
          steps: [
            ['resolve', DID],
            ['resolve', DID],
          ],
          answers: ['offline', json(doc('https://pds.example'))],
        },
        {
          $id: 'no-pds',
          steps: [['resolve', DID]],
          answers: [json({ service: [] })],
        },
        { $id: 'missing-did', steps: [['resolve', '']], answers: [] },
        {
          $id: 'remember',
          steps: [
            ['remember', DID, 'https://pds.example/'],
            ['resolve', DID],
            ['remember', DID, 'ftp://nope'],
            ['resolve', DID],
          ],
          answers: [],
        },
        {
          $id: 'remember-ignored',
          steps: [
            ['remember', DID, 'HTTPS://pds.example'],
            ['remember', '', 'https://x'],
            ['resolve', DID],
          ],
          answers: [json(doc('https://from-doc.example'))],
        },
        {
          $id: 'forget',
          steps: [
            ['resolve', DID],
            ['forget', DID],
            ['resolve', DID],
          ],
          answers: [
            json(doc('https://a.example')),
            json(doc('https://b.example')),
          ],
        },
        {
          $id: 'did-web',
          steps: [['resolve', 'did:web:example.com']],
          answers: [
            json({
              id: 'did:web:example.com',
              service: [
                {
                  id: 'did:web:example.com#atproto_pds',
                  serviceEndpoint: 'https://pds.example',
                },
              ],
            }),
          ],
        },
      ],
      ({ steps, answers }) =>
        recorded(inTurn(...answers), async () => {
          const resolver = createPdsResolver({ getDidDocument });
          const out = [];
          for (const [op, did, url] of steps) {
            if (op === 'resolve')
              out.push(await settle(resolver.resolvePdsUrl(did)));
            else if (op === 'resolveTwiceAtOnce')
              out.push(
                await settle(
                  Promise.all([
                    resolver.resolvePdsUrl(did),
                    resolver.resolvePdsUrl(did),
                  ]),
                ),
              );
            else if (op === 'remember')
              out.push(resolver.remember(did, url) ?? null);
            else if (op === 'forget') out.push(resolver.forget(did) ?? null);
          }
          return out;
        }),
    )),
  ];
}
