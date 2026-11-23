// Defense's crowd in the demo worlds (harness/crowd.js): the strangers, who
// in the cast follows whom, profiles (public and as each account sees
// them), relationships, vouches, and the crowd on every post of both
// accounts. Swift: VirgaDemo/Harness/Crowd.swift; tests in
// ios/VirgaKit/Tests/VirgaDemoTests/CrowdParityTests.swift.

import { castFollows, createCrowd } from '../../../harness/crowd.js';
import { removeRecord, writeRecord } from '../../../harness/repo.js';
import { LAB, ME, buildWorld } from '../../../harness/world.js';
import { each, value } from './_helpers.js';
import { part } from './_canonical.js';
import { NOW } from './_demoWorld.js';

export const sources = ['harness/crowd.js'];

const crowdDid = (i) =>
  `did:plc:virgaharnesscrowd${String(i).padStart(5, '0')}`;

const FOLLOW = 'app.bsky.graph.follow';

/**
 * The crowd's caches across writes. A crowd keeps whom an account follows
 * as it first saw them and each post's engagers once worked out, while the
 * count of vouches reads the live follows; a crowd made after the writes
 * sees them all. Mira follows two more people (one of the cast, one
 * nobody knows), stops following another, and deletes a busy post.
 */
async function afterWrites() {
  const mira = buildWorld({ now: NOW });
  const lab = buildWorld({ now: NOW, account: LAB });
  const crowd = createCrowd([mira, lab]);
  const unfollowed = mira.cast[2].did;
  const followed = mira.cast[0].did;
  const nobody = 'did:plc:harnessnewfriend';
  const targets = [unfollowed, nobody, followed, mira.cast[5].did];
  const cards = targets.map((did) => {
    const p = mira.cast.find((c) => c.did === did);
    return p
      ? { did, handle: p.handle, displayName: p.displayName, avatar: p.avatar }
      : { did, handle: 'handle.invalid', displayName: '' };
  });
  const busy = mira.posts.find((p) => p.likes > 40 && !p.replyTo);
  const quiet = mira.posts.find((p) => p.likes > 5 && p.rkey !== busy.rkey);
  const uriOf = (p) => `at://${ME.did}/app.bsky.feed.post/${p.rkey}`;
  const engagers = (c, p) =>
    Object.fromEntries(
      Object.entries(c.engagersOf(uriOf(p))).map(([kind, list]) => [
        kind,
        part(list),
      ]),
    );
  const ask = (c, { quietToo = false } = {}) => ({
    profileAs: targets.map((did, i) => c.profileAs(mira, did, cards[i])),
    relationship: targets.map((did) => c.relationship(mira, did)),
    knownCount: targets.map((did) => c.knownCount(mira, did)),
    labKnownCount: targets.map((did) => c.knownCount(lab, did)),
    busy: engagers(c, busy),
    ...(quietToo ? { quiet: engagers(c, quiet) } : {}),
  });
  const writes = [
    {
      op: 'write',
      collection: FOLLOW,
      rkey: '3zzzzzzzzzzz2',
      record: { subject: unfollowed, createdAt: '2026-11-14T10:00:00.000Z' },
    },
    {
      op: 'write',
      collection: FOLLOW,
      rkey: '3zzzzzzzzzzy2',
      record: { subject: nobody, createdAt: '2026-11-14T10:00:00.000Z' },
    },
    {
      op: 'remove',
      collection: FOLLOW,
      rkey: mira.follows
        .find((r) => r.value.subject === followed)
        .uri.split('/')
        .pop(),
    },
    { op: 'remove', collection: 'app.bsky.feed.post', rkey: busy.rkey },
    { op: 'remove', collection: 'app.bsky.feed.post', rkey: quiet.rkey },
  ];
  const before = ask(crowd);
  for (const w of writes) {
    if (w.op === 'write') await writeRecord(mira, w);
    else removeRecord(mira, w.collection, w.rkey);
  }
  return {
    input: { targets, cards, busy: busy.rkey, quiet: quiet.rkey, writes },
    output: {
      before,
      after: ask(crowd, { quietToo: true }),
      fresh: ask(createCrowd([mira, lab]), { quietToo: true }),
    },
  };
}

export default async function cases() {
  const scenario = await afterWrites();
  const mira = buildWorld({ now: NOW });
  const lab = buildWorld({ now: NOW, account: LAB });
  const crowd = createCrowd([mira, lab]);
  const viewers = { me: mira, lab };
  const cast = mira.cast.map((p) => p.did);
  const fans = mira.followers
    .filter((f) => f.did.includes('fan'))
    .map((f) => f.did);

  // Every interesting kind of account: the cast (followed or not, by each
  // account), strangers of every sort, Mira's fans, the follows outside the
  // cast, the accounts themselves, and nobody at all.
  const dids = [
    ...cast.slice(0, 16),
    cast[30],
    cast[63],
    ...[0, 2, 3, 7, 9, 11, 13, 17, 30, 46, 74, 96, 124, 228, 1199].map(
      crowdDid,
    ),
    ...fans.slice(0, 6),
    fans[fans.length - 1],
    'did:plc:virgaharnessfol0000',
    'did:plc:virgaharnessfol0035',
    ME.did,
    LAB.did,
    'did:plc:nobodyatall',
    '',
  ];
  // The ones a caller would pass a card for: the cast, the follows outside
  // it and nobody (strangers and fans have profiles of their own).
  const CARDED = [
    ...cast.slice(0, 6),
    cast[30],
    'did:plc:virgaharnessfol0000',
    'did:plc:nobodyatall',
    '',
  ];
  const card = (did) => {
    const p = mira.cast.find((c) => c.did === did);
    return p
      ? { did, handle: p.handle, displayName: p.displayName, avatar: p.avatar }
      : { did, handle: 'handle.invalid', displayName: '' };
  };

  const postsOf = (world) =>
    world.posts.map((p) => `at://${world.me.did}/app.bsky.feed.post/${p.rkey}`);
  const loudest = [...mira.posts].sort(
    (a, b) => b.replies + b.quotes - (a.replies + a.quotes),
  )[0];
  const runaway = [...mira.posts].sort((a, b) => b.likes - a.likes)[0];

  return [
    {
      id: 'after-writes',
      fn: 'afterWrites',
      input: scenario.input,
      output: scenario.output,
    },
    ...(await each(
      'castFollows',
      [
        ...cast
          .slice(0, 12)
          .flatMap((from) => cast.slice(0, 12).map((to) => ({ from, to }))),
        { from: cast[1], to: crowdDid(7) },
        { from: cast[1], to: ME.did },
        { from: '', to: '' },
        { from: 'é', to: 'é' },
      ],
      ({ from, to }) => castFollows(from, to),
    )),
    value('strangers', part([...crowd.strangers.values()])),
    ...(await each(
      'stranger',
      [0, 2, 3, 7, 9, 11, 13, 17, 30, 46, 228, 1199].map((i) => ({ i })),
      ({ i }) => crowd.strangers.get(crowdDid(i)),
    )),
    ...(await each(
      'profile',
      dids.map((did) => ({ did })),
      ({ did }) => crowd.profile(did),
    )),
    ...(await each(
      'profileAs',
      ['me', 'lab'].flatMap((viewer) => [
        ...dids.map((did) => ({ viewer, did })),
        ...CARDED.map((did) => ({
          $id: `${viewer}-card-${did}`,
          viewer,
          did,
          card: card(did),
        })),
        {
          $id: `${viewer}-string-card`,
          viewer,
          did: 'did:plc:nobodyatall',
          card: 'ab',
        },
        {
          $id: `${viewer}-array-card`,
          viewer,
          did: 'did:plc:nobodyatall',
          card: ['x', 'y'],
        },
        {
          $id: `${viewer}-empty-card`,
          viewer,
          did: 'did:plc:nobodyatall',
          card: '',
        },
      ]),
      ({ viewer, did, card: given }) =>
        crowd.profileAs(viewers[viewer], did, given ?? null),
    )),
    ...(await each(
      'relationship',
      ['me', 'lab'].flatMap((viewer) => dids.map((did) => ({ viewer, did }))),
      ({ viewer, did }) => crowd.relationship(viewers[viewer], did),
    )),
    ...(await each(
      'knownCount',
      ['me', 'lab'].map((viewer) => ({
        viewer,
        dids: [
          ...cast,
          ...dids,
          ...Array.from({ length: 120 }, (_, i) => crowdDid(i * 10)),
        ],
      })),
      ({ viewer, dids: list }) =>
        list.map((did) => crowd.knownCount(viewers[viewer], did)),
    )),
    value(
      'engagersOf-every-post',
      part(
        [...postsOf(mira), ...postsOf(lab)].map((uri) => [
          uri,
          crowd.engagersOf(uri),
        ]),
      ),
    ),
    ...(await each(
      'engagersOf',
      [
        {
          $id: 'loudest',
          uri: `at://${ME.did}/app.bsky.feed.post/${loudest.rkey}`,
        },
        {
          $id: 'runaway',
          uri: `at://${ME.did}/app.bsky.feed.post/${runaway.rkey}`,
        },
        { $id: 'lab-first', uri: postsOf(lab)[0] },
        {
          $id: 'extra-segment',
          uri: `at://${ME.did}/app.bsky.feed.post/${loudest.rkey}/more`,
        },
        {
          $id: 'cast-post',
          uri: `at://${cast[0]}/app.bsky.feed.post/3kzzzzzzzzzzz`,
        },
        {
          $id: 'not-a-post',
          uri: `at://${ME.did}/app.bsky.feed.like/${loudest.rkey}`,
        },
        { $id: 'no-rkey', uri: `at://${ME.did}/app.bsky.feed.post` },
        { $id: 'empty', uri: '' },
        {
          $id: 'missing-post',
          uri: `at://${ME.did}/app.bsky.feed.post/3kzzzzzzzzzzz`,
        },
      ],
      ({ uri }) =>
        Object.fromEntries(
          Object.entries(crowd.engagersOf(uri)).map(([kind, list]) => [
            kind,
            part(list),
          ]),
        ),
    )),
  ];
}
