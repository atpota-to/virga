// src/defense/score.js publicRelationships: who you follow and who follows
// you, from the public AppView, as recorded exchanges (_fetch.js). Swift:
// VirgaDefense/Score+Relationships.swift. The rest of score.js is held by
// defense-early.score.js.
//
// Also one score through it, as createScorer's default getRelationships: a
// scripted getProfiles and the public relationships over the fake network.

import {
  createScorer,
  publicRelationships,
} from '../../../src/defense/score.js';
import { FIXED_NOW, each } from './_helpers.js';
import { inTurn, json, recordFetch } from './_fetch.js';
import { NO_WAIT, scripted, withNow } from './_defense.js';

export const sources = ['src/defense/score.js'];

const OWNER = 'did:plc:owner';

/** The AppView's answer for the DIDs asked: `following` for those in `follows`. */
function relationshipsOf(request, { follows = [], fans = [] } = {}) {
  const asked = new URL(request.url).searchParams.getAll('others');
  return json({
    actor: OWNER,
    relationships: asked.map((did) => ({
      $type: 'app.bsky.graph.defs#relationship',
      did,
      ...(follows.includes(did)
        ? { following: `at://${OWNER}/app.bsky.graph.follow/${did.slice(8)}` }
        : {}),
      ...(fans.includes(did)
        ? { followedBy: `at://${did}/app.bsky.graph.follow/x` }
        : {}),
    })),
  });
}

export default async function cases() {
  return [
    ...(await each(
      'publicRelationships',
      [
        {
          $id: 'answered',
          ownerDid: OWNER,
          dids: ['did:plc:a', 'did:plc:b', 'did:plc:c'],
          answers: [
            (r) =>
              relationshipsOf(r, {
                follows: ['did:plc:b'],
                fans: ['did:plc:a', 'did:plc:b'],
              }),
          ],
        },
        {
          $id: 'encoded',
          ownerDid: 'did:web:example.com:me',
          dids: [
            'did:plc:é',
            'did:web:a b',
            'did:plc:x#y',
            'did:plc:1+1=2',
            'did:plc:😀',
          ],
          answers: [(r) => relationshipsOf(r)],
        },
        {
          $id: 'nobody',
          ownerDid: OWNER,
          dids: [],
          answers: [json({ relationships: [] })],
        },
        {
          $id: 'other-appview',
          ownerDid: OWNER,
          dids: ['did:plc:a'],
          appview: 'https://appview.example.org',
          answers: [(r) => relationshipsOf(r)],
        },
        {
          $id: 'not-found-actor',
          ownerDid: OWNER,
          dids: ['did:plc:gone'],
          answers: [
            json({
              relationships: [
                {
                  $type: 'app.bsky.graph.defs#notFoundActor',
                  actor: 'did:plc:gone',
                  notFound: true,
                },
              ],
            }),
          ],
        },
        {
          $id: 'bad-gateway',
          ownerDid: OWNER,
          dids: ['did:plc:a'],
          answers: [{ status: 502, json: { error: 'Down' } }],
        },
        {
          $id: 'rate-limited',
          ownerDid: OWNER,
          dids: ['did:plc:a'],
          answers: [{ status: 429, json: {} }],
        },
        {
          $id: 'bad-request',
          ownerDid: OWNER,
          dids: ['did:plc:a'],
          answers: [{ status: 400, json: { error: 'InvalidRequest' } }],
        },
        {
          $id: 'no-list',
          ownerDid: OWNER,
          dids: ['did:plc:a'],
          answers: [json({})],
        },
        {
          $id: 'list-null',
          ownerDid: OWNER,
          dids: ['did:plc:a'],
          answers: [json({ relationships: null })],
        },
        {
          $id: 'list-object',
          ownerDid: OWNER,
          dids: ['did:plc:a'],
          answers: [json({ relationships: { did: 'did:plc:a' } })],
        },
        {
          $id: 'body-null',
          ownerDid: OWNER,
          dids: ['did:plc:a'],
          answers: [json(null)],
        },
        {
          $id: 'not-json',
          ownerDid: OWNER,
          dids: ['did:plc:a'],
          answers: [{ status: 200, text: '<!DOCTYPE html>' }],
        },
        {
          $id: 'empty-body',
          ownerDid: OWNER,
          dids: ['did:plc:a'],
          answers: [{ status: 200, text: '' }],
        },
        {
          $id: 'offline',
          ownerDid: OWNER,
          dids: ['did:plc:a'],
          answers: ['offline'],
        },
      ],
      ({ ownerDid, dids, appview, answers }) =>
        recordFetch(inTurn(...answers), () =>
          publicRelationships(appview ? { appview } : {})(ownerDid, dids),
        ),
    )),

    // createScorer's default getRelationships, over the fake network: 70
    // accounts in three batches of at most 30, the second failing once (a
    // 503, asked again) and one followed.
    ...(await each(
      'scoreWithPublicRelationships',
      [
        {
          $id: 'three-batches',
          ownerDid: OWNER,
          dids: Array.from(
            { length: 70 },
            (_, i) => `did:plc:p${String(i).padStart(2, '0')}`,
          ),
          follows: ['did:plc:p45'],
          failFirst: 'did:plc:p30',
        },
      ],
      ({ ownerDid, dids, follows, failFirst }) => {
        const fake = scripted({
          profiles: Object.fromEntries(
            dids.map((did, i) => [
              did,
              {
                did,
                handle: `${did.slice(8)}.test`,
                followersCount: i * 10,
                viewer: {},
              },
            ]),
          ),
        });
        let failed = false;
        return recordFetch(
          (request) => {
            const asked = new URL(request.url).searchParams.getAll('others');
            if (!failed && asked[0] === failFirst) {
              failed = true;
              return { status: 503, json: { error: 'Busy' } };
            }
            return relationshipsOf(request, { follows });
          },
          () =>
            withNow(FIXED_NOW, async () => {
              const scorer = createScorer({
                ownerDid,
                getProfiles: fake.getProfiles,
                retryDelaysMs: NO_WAIT,
              });
              return scorer.score(dids);
            }),
        );
      },
    )),
  ];
}
