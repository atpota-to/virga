// src/defense/veto.js: who no automated path may ever add to a list, read
// from the public AppView. Swift: VirgaDefense/Veto.swift. Every case is a
// recorded exchange (_fetch.js): the requests the web made, the answers, and
// the Map it resolved to (as an object) or the error it threw, with its
// cause's message. Batches and lists are read side by side, so the Swift
// test matches the requests in any order.
//
// The fake AppView is veto.test.js's, and the cases borrow its scripts (the
// owner, the holder, the kept, the followed and the curated; a moderation
// list's members not protected; reads that fail closed; thirty at a time; an
// account Bluesky can't find; lists read side by side, someone on two named
// by the first), and add the edges: answers that leave someone out or say
// more, odd rows, cursors, the limits at their boundaries, and DIDs that are
// only canonically equal.

import {
  CURATION_LIMITS,
  curationMembers,
  followedNow,
  vetoed,
} from '../../../src/defense/veto.js';
import { each, value } from './_helpers.js';
import { json, recordFetch } from './_fetch.js';

export const sources = ['src/defense/veto.js'];

const OWNER = 'did:plc:owner';
const HOLDER = 'did:plc:holder';
const CURATE = 'app.bsky.graph.defs#curatelist';
const MOD = 'app.bsky.graph.defs#modlist';

/**
 * veto.test.js's fake public AppView: `follows`, the DIDs the owner follows;
 * `lists`, their lists with members (paged a hundred at a time); `fail`, a
 * method that answers 502. `extra` adds rows to every getRelationships
 * answer; `listsPage` pages getLists that many at a time.
 */
function appview({
  follows = [],
  lists = [],
  fail = null,
  extra = [],
  listsPage = 0,
  answer = null,
} = {}) {
  return (request) => {
    const u = new URL(request.url);
    const method = u.pathname.split('/xrpc/')[1];
    if (answer && answer[method]) return answer[method](u);
    if (fail === method) return { status: 502, text: 'down' };
    if (method === 'app.bsky.graph.getRelationships') {
      return json({
        relationships: [
          ...u.searchParams.getAll('others').map((did) => ({
            did,
            ...(follows.includes(did)
              ? { following: `at://${OWNER}/app.bsky.graph.follow/x` }
              : {}),
          })),
          ...extra,
        ],
      });
    }
    if (method === 'app.bsky.graph.getLists') {
      const all = lists.map((l) => ({
        uri: l.uri,
        name: l.name,
        purpose: l.purpose,
      }));
      if (!listsPage) return json({ lists: all });
      const from = Number(u.searchParams.get('cursor') || 0);
      return json({
        lists: all.slice(from, from + listsPage),
        ...(from + listsPage < all.length
          ? { cursor: String(from + listsPage) }
          : {}),
      });
    }
    if (method === 'app.bsky.graph.getList') {
      const list = lists.find((l) => l.uri === u.searchParams.get('list'));
      if (!list) return { status: 400, json: { error: 'InvalidRequest' } };
      if (list.items) return json(list.items);
      const from = Number(u.searchParams.get('cursor') || 0);
      const page = list.members.slice(from, from + 100);
      return json({
        list: { uri: list.uri },
        items: page.map((did) => ({ subject: { did } })),
        ...(from + 100 < list.members.length
          ? { cursor: String(from + 100) }
          : {}),
      });
    }
    return { status: 404, text: '?' };
  };
}

/** What the veto threw, as a case records it. */
function thrown(err) {
  return {
    $error: {
      name: err?.name,
      code: err?.code ?? null,
      message: err?.message,
      cause: err?.cause?.message ?? null,
    },
  };
}

/**
 * `fn` recorded against `fake`, its Map as an object, and the reads it left
 * running (Promise.all rejects at the first failure and leaves the other
 * read going) given time to land in the record.
 */
function recorded(fake, fn) {
  return recordFetch(fake, async () => {
    let out;
    try {
      out = [...(await fn())].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    } catch (err) {
      out = thrown(err);
    }
    for (let i = 0; i < 50; i += 1) await new Promise((r) => setImmediate(r));
    return out;
  });
}

const range = (n, prefix) =>
  Array.from({ length: n }, (_, i) => `${prefix}${i}`);

const NEIGHBOURS = [
  {
    uri: 'at://owner/l/1',
    name: 'Neighbours',
    purpose: CURATE,
    members: ['did:plc:neighbour'],
  },
  {
    uri: 'at://owner/l/2',
    name: 'Blocked',
    purpose: MOD,
    members: ['did:plc:stranger'],
  },
];

export default async function cases() {
  return [
    value('constants', { CURATION_LIMITS }),

    ...(await each(
      'followedNow',
      [
        {
          $id: 'thirty-at-a-time',
          dids: range(70, 'did:plc:f'),
          fake: { follows: ['did:plc:f45'] },
        },
        {
          $id: 'just-thirty',
          dids: range(30, 'did:plc:f'),
          fake: { follows: ['did:plc:f0', 'did:plc:f29'] },
        },
        {
          $id: 'thirty-one',
          dids: range(31, 'did:plc:f'),
          fake: { follows: ['did:plc:f30'] },
        },
        { $id: 'nobody', dids: [] },
        {
          $id: 'asked-once-each',
          dids: [
            'did:plc:a',
            'did:plc:a',
            'did:plc:café',
            'did:plc:café',
            'did:plc:K',
            'did:plc:K',
          ],
          fake: { follows: ['did:plc:café', 'did:plc:K'] },
        },
        {
          $id: 'encoded',
          owner: 'did:web:a b',
          dids: ['did:plc:x#y', 'did:plc:1+1', 'did:plc:😀'],
          fake: {},
        },
        {
          $id: 'answers-more',
          dids: ['did:plc:a'],
          fake: {
            extra: [
              { did: 'did:plc:unasked', following: 'at://x' },
              { did: 'did:plc:other' },
            ],
          },
        },
        {
          $id: 'odd-rows',
          dids: ['did:plc:a', 'did:plc:b'],
          fake: {
            extra: [
              null,
              5,
              'did:plc:a',
              {},
              { did: '' },
              { did: null, following: 'x' },
              { did: 'did:plc:b', following: '' },
            ],
          },
        },
        {
          $id: 'followed-twice',
          dids: ['did:plc:a'],
          fake: { extra: [{ did: 'did:plc:a', following: 'at://again' }] },
        },
        {
          $id: 'not-found',
          dids: [
            'did:plc:gone',
            'did:plc:gone2',
            'did:plc:here',
            'did:plc:typed',
          ],
          fake: {
            answer: {
              'app.bsky.graph.getRelationships': () =>
                json({
                  relationships: [
                    {
                      $type: 'app.bsky.graph.defs#notFoundActor',
                      actor: 'did:plc:gone',
                      notFound: true,
                    },
                    { notFound: true, did: 'did:plc:gone2' },
                    {
                      $type: 'app.bsky.graph.defs#notFoundActor',
                      actor: 'did:plc:typed',
                    },
                    { notFound: true, actor: 'did:plc:elsewhere' },
                    { notFound: true },
                    { did: 'did:plc:here', following: 'at://x' },
                  ],
                }),
            },
          },
        },
        {
          $id: 'not-found-actor-not-a-string',
          dids: ['did:plc:gone'],
          fake: {
            answer: {
              'app.bsky.graph.getRelationships': () =>
                json({
                  relationships: [
                    { notFound: true, actor: 5, did: 'did:plc:gone' },
                  ],
                }),
            },
          },
        },
        {
          $id: 'not-found-type-look-alike',
          dids: ['did:plc:gone'],
          fake: {
            answer: {
              'app.bsky.graph.getRelationships': () =>
                json({
                  relationships: [
                    {
                      $type: 'app.bsky.graph.defs#notFoundActor ',
                      actor: 'did:plc:gone',
                    },
                  ],
                }),
            },
          },
        },
        {
          $id: 'leaves-one-out',
          dids: ['did:plc:a', 'did:plc:b'],
          fake: {
            answer: {
              'app.bsky.graph.getRelationships': () =>
                json({ relationships: [{ did: 'did:plc:a' }] }),
            },
          },
        },
        {
          $id: 'no-list',
          dids: ['did:plc:a'],
          fake: {
            answer: { 'app.bsky.graph.getRelationships': () => json({}) },
          },
        },
        {
          $id: 'body-null',
          dids: ['did:plc:a'],
          fake: {
            answer: { 'app.bsky.graph.getRelationships': () => json(null) },
          },
        },
        {
          $id: 'not-json',
          dids: ['did:plc:a'],
          fake: {
            answer: {
              'app.bsky.graph.getRelationships': () => ({
                status: 200,
                text: 'nope',
              }),
            },
          },
        },
        {
          $id: 'down',
          dids: ['did:plc:a'],
          fake: { fail: 'app.bsky.graph.getRelationships' },
        },
        {
          $id: 'other-appview',
          dids: ['did:plc:a'],
          appview: 'https://appview.example.org/base',
          fake: { follows: ['did:plc:a'] },
        },
      ],
      ({ owner = OWNER, dids, fake, appview: base }) =>
        recorded(appview(fake), () =>
          followedNow(owner, dids, base ? { appview: base } : {}),
        ),
    )),

    ...(await each(
      'curationMembers',
      [
        { $id: 'neighbours', fake: { lists: NEIGHBOURS } },
        {
          $id: 'side-by-side',
          fake: {
            lists: [
              {
                uri: 'at://owner/l/1',
                name: 'First',
                purpose: CURATE,
                members: ['did:plc:both'],
              },
              {
                uri: 'at://owner/l/2',
                name: 'Second',
                purpose: CURATE,
                members: ['did:plc:both', 'did:plc:two'],
              },
              {
                uri: 'at://owner/l/3',
                name: '',
                purpose: CURATE,
                members: ['did:plc:unnamed'],
              },
              {
                uri: 'at://owner/l/4',
                purpose: CURATE,
                members: ['did:plc:nameless', 'did:plc:two'],
              },
              {
                uri: '',
                name: 'No address',
                purpose: CURATE,
                members: ['did:plc:never'],
              },
              {
                uri: 'at://owner/l/6',
                name: 'Mod',
                purpose: MOD,
                members: ['did:plc:moderated'],
              },
              {
                uri: 'at://owner/l/7',
                name: 'Reference',
                purpose: 'app.bsky.graph.defs#referencelist',
                members: ['did:plc:ref'],
              },
            ],
          },
        },
        {
          $id: 'paged-members',
          fake: {
            lists: [
              {
                uri: 'big',
                name: 'Big',
                purpose: CURATE,
                members: range(250, 'did:plc:m'),
              },
            ],
          },
        },
        {
          $id: 'members-at-the-limit',
          limits: { lists: 20, membersPerList: 200 },
          fake: {
            lists: [
              {
                uri: 'big',
                name: 'Big',
                purpose: CURATE,
                members: range(200, 'did:plc:m'),
              },
            ],
          },
        },
        {
          $id: 'members-past-the-limit',
          limits: { lists: 20, membersPerList: 200 },
          fake: {
            lists: [
              {
                uri: 'big',
                name: 'Big',
                purpose: CURATE,
                members: range(250, 'did:plc:m'),
              },
            ],
          },
        },
        {
          $id: 'lists-at-the-limit',
          fake: {
            lists: range(20, 'l').map((uri, i) => ({
              uri,
              name: `L${i}`,
              purpose: CURATE,
              members: [],
            })),
          },
        },
        {
          $id: 'lists-past-the-limit',
          fake: {
            lists: range(21, 'l').map((uri, i) => ({
              uri,
              name: `L${i}`,
              purpose: CURATE,
              members: [],
            })),
          },
        },
        {
          $id: 'lists-paged-past-the-limit',
          fake: {
            listsPage: 15,
            lists: range(31, 'l').map((uri, i) => ({
              uri,
              name: `L${i}`,
              purpose: CURATE,
              members: [`did:plc:in${i}`],
            })),
          },
        },
        {
          $id: 'lists-paged',
          fake: {
            listsPage: 2,
            lists: [
              { uri: 'a', name: 'A', purpose: CURATE, members: ['did:plc:a'] },
              { uri: 'b', name: 'B', purpose: MOD, members: ['did:plc:b'] },
              {
                uri: 'c',
                name: 'C',
                purpose: CURATE,
                members: ['did:plc:c', 'did:plc:a'],
              },
            ],
          },
        },
        {
          $id: 'smaller-limits',
          limits: { lists: 1, membersPerList: 5000 },
          fake: {
            lists: [
              { uri: 'a', name: 'A', purpose: CURATE, members: [] },
              { uri: 'b', name: 'B', purpose: CURATE, members: [] },
            ],
          },
        },
        {
          $id: 'member-shapes',
          fake: {
            lists: [
              {
                uri: 'odd',
                name: 'Odd',
                purpose: CURATE,
                items: {
                  items: [
                    null,
                    {},
                    { subject: null },
                    { subject: 'did:plc:s' },
                    { subject: { did: '' } },
                    { subject: { did: 'did:plc:ok' } },
                  ],
                },
              },
            ],
          },
        },
        {
          $id: 'member-cursors',
          fake: {
            lists: [
              {
                uri: 'odd',
                name: 'Odd',
                purpose: CURATE,
                items: {
                  items: [{ subject: { did: 'did:plc:once' } }],
                  cursor: '',
                },
              },
            ],
          },
        },
        {
          $id: 'canonically-equal-members',
          fake: {
            lists: [
              {
                uri: 'a',
                name: 'A',
                purpose: CURATE,
                members: ['did:plc:café', 'did:plc:K'],
              },
              {
                uri: 'b',
                name: 'B',
                purpose: CURATE,
                members: ['did:plc:café', 'did:plc:K'],
              },
            ],
          },
        },
        {
          $id: 'items-not-a-list',
          fake: {
            lists: [
              {
                uri: 'odd',
                name: 'Odd',
                purpose: CURATE,
                items: { items: 'none' },
              },
            ],
          },
        },
        {
          $id: 'getList-down',
          fake: {
            fail: 'app.bsky.graph.getList',
            lists: [{ uri: 'a', name: 'A', purpose: CURATE, members: [] }],
          },
        },
        { $id: 'getLists-down', fake: { fail: 'app.bsky.graph.getLists' } },
        {
          $id: 'getLists-no-list',
          fake: {
            answer: { 'app.bsky.graph.getLists': () => json({ cursor: 'x' }) },
          },
        },
        {
          $id: 'getLists-cursor-number',
          fake: {
            answer: {
              'app.bsky.graph.getLists': (u) =>
                json(
                  u.searchParams.get('cursor')
                    ? { lists: [] }
                    : { lists: [], cursor: 7 },
                ),
            },
          },
        },
        { $id: 'none', fake: {} },
        {
          $id: 'other-appview',
          appview: 'https://appview.example.org',
          fake: { lists: NEIGHBOURS },
        },
        { $id: 'owner-encoded', owner: 'did:web:a b&c=d', fake: {} },
      ],
      ({ owner = OWNER, fake, appview: base, limits }) =>
        recorded(appview(fake), () =>
          curationMembers(owner, {
            ...(base ? { appview: base } : {}),
            ...(limits ? { limits } : {}),
          }),
        ),
    )),

    ...(await each(
      'vetoed',
      [
        {
          $id: 'never-lets-through',
          ownerDid: OWNER,
          holderDid: HOLDER,
          dids: [
            OWNER,
            HOLDER,
            'did:plc:kept',
            'did:plc:friend',
            'did:plc:neighbour',
            'did:plc:stranger',
          ],
          kept: { 'did:plc:kept': 'my sister' },
          fake: { follows: ['did:plc:friend'], lists: NEIGHBOURS },
        },
        {
          $id: 'decided-without-the-network',
          ownerDid: OWNER,
          dids: [OWNER],
          fake: {},
        },
        {
          $id: 'decided-without-the-network-too',
          ownerDid: OWNER,
          holderDid: HOLDER,
          dids: [HOLDER, 'did:plc:kept', OWNER],
          kept: { 'did:plc:kept': '' },
          fake: {},
        },
        {
          $id: 'curation-given',
          ownerDid: OWNER,
          dids: ['did:plc:n'],
          curation: { 'did:plc:n': 'Mine' },
          fake: {},
        },
        {
          $id: 'curation-given-empty',
          ownerDid: OWNER,
          dids: ['did:plc:n'],
          curation: {},
          fake: { follows: ['did:plc:n'] },
        },
        {
          $id: 'followed-and-curated',
          ownerDid: OWNER,
          dids: ['did:plc:both', 'did:plc:listed'],
          fake: {
            follows: ['did:plc:both'],
            lists: [
              {
                uri: 'a',
                name: 'Close',
                purpose: CURATE,
                members: ['did:plc:both', 'did:plc:listed'],
              },
            ],
          },
        },
        {
          $id: 'odd-dids',
          ownerDid: OWNER,
          holderDid: '',
          dids: [
            null,
            '',
            'did:plc:a',
            'did:plc:a',
            '',
            'did:plc:café',
            'did:plc:café',
          ],
          fake: { follows: ['did:plc:café'] },
        },
        {
          $id: 'holder-is-owner',
          ownerDid: OWNER,
          holderDid: OWNER,
          dids: [OWNER],
          fake: {},
        },
        {
          $id: 'kept-look-alike',
          ownerDid: OWNER,
          dids: ['did:plc:K'],
          kept: { 'did:plc:K': 'kept' },
          fake: {},
        },
        {
          $id: 'cant-find',
          ownerDid: OWNER,
          dids: ['did:plc:gone', 'did:plc:here'],
          fake: {
            answer: {
              'app.bsky.graph.getRelationships': () =>
                json({
                  relationships: [
                    {
                      $type: 'app.bsky.graph.defs#notFoundActor',
                      actor: 'did:plc:gone',
                      notFound: true,
                    },
                    { did: 'did:plc:here' },
                  ],
                }),
            },
          },
        },
        {
          $id: 'follows-unreadable',
          ownerDid: OWNER,
          dids: ['did:plc:x'],
          fake: { fail: 'app.bsky.graph.getRelationships' },
        },
        {
          $id: 'curation-unreadable',
          ownerDid: OWNER,
          dids: ['did:plc:x'],
          fake: {
            fail: 'app.bsky.graph.getList',
            lists: [{ uri: 'a', name: 'A', purpose: CURATE, members: [] }],
          },
        },
        {
          $id: 'too-many-lists',
          ownerDid: OWNER,
          dids: ['did:plc:x'],
          fake: {
            lists: range(21, 'l').map((uri) => ({
              uri,
              name: uri,
              purpose: CURATE,
              members: [],
            })),
          },
        },
        {
          $id: 'smaller-limits',
          ownerDid: OWNER,
          dids: ['did:plc:x'],
          limits: { lists: 0, membersPerList: 0 },
          fake: {
            lists: [{ uri: 'a', name: 'A', purpose: CURATE, members: [] }],
          },
        },
        { $id: 'needs-an-owner', dids: ['did:plc:x'], fake: {} },
        { $id: 'empty-owner', ownerDid: '', dids: [], fake: {} },
        { $id: 'nobody', ownerDid: OWNER, dids: [], fake: {} },
        { $id: 'dids-missing', ownerDid: OWNER, fake: {} },
        {
          $id: 'other-appview',
          ownerDid: OWNER,
          dids: ['did:plc:friend', 'did:plc:neighbour'],
          appview: 'https://appview.example.org',
          fake: { follows: ['did:plc:friend'], lists: NEIGHBOURS },
        },
      ],
      ({
        ownerDid,
        holderDid,
        dids,
        kept,
        curation,
        fake,
        appview: base,
        limits,
      }) =>
        recorded(appview(fake), () =>
          vetoed({
            ownerDid,
            ...(holderDid === undefined ? {} : { holderDid }),
            dids,
            ...(kept ? { kept: new Map(Object.entries(kept)) } : {}),
            ...(curation
              ? { curation: async () => new Map(Object.entries(curation)) }
              : {}),
            ...(base ? { appview: base } : {}),
            ...(limits ? { limits } : {}),
          }),
        ),
    )),
  ];
}
