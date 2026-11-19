// src/lib/activity.js: when an account was last active, from its author
// feed. Swift: VirgaNetwork/Lib/Activity.swift. checkActivity's cases are
// recorded exchanges (_fetch.js), with the progress it reported.

import { checkActivity, feedItemTime } from '../../../src/lib/activity.js';
import { ZONES, each, inZone } from './_helpers.js';
import { json, recordFetch } from './_fetch.js';

export const sources = ['src/lib/activity.js'];

const post = {
  post: {
    record: { createdAt: '2026-03-01T10:00:00.000Z' },
    indexedAt: '2026-03-01T10:00:05.000Z',
  },
};

/** The AppView, answering for each account by the DID's last word. */
function appview(req) {
  const actor = new URL(req.url).searchParams.get('actor');
  const kind = actor.split(':').pop();
  if (kind.startsWith('post')) return json({ feed: [post] });
  if (kind.startsWith('repost'))
    return json({
      feed: [
        {
          ...post,
          reason: {
            $type: 'app.bsky.feed.defs#reasonRepost',
            indexedAt: '2026-06-02T08:00:00.000Z',
          },
        },
      ],
    });
  if (kind.startsWith('quiet')) return json({ feed: [] });
  if (kind.startsWith('notfound'))
    return json({ error: 'InvalidRequest', message: 'Profile not found' }, 400);
  if (kind.startsWith('deactivated'))
    return json(
      { error: 'AccountDeactivated', message: 'Account is deactivated' },
      400,
    );
  if (kind.startsWith('takendown'))
    return json({ error: 'AccountTakedown' }, 400);
  if (kind.startsWith('NOTFOUND')) return json({ error: 'NotFound' }, 404);
  if (kind.startsWith('blocked'))
    return json(
      { error: 'BlockedActor', message: 'Requester has blocked actor' },
      400,
    );
  if (kind.startsWith('weird400')) return { status: 400, text: 'not json' };
  if (kind.startsWith('five')) return { status: 500, text: 'boom' };
  if (kind.startsWith('badjson')) return { status: 200, text: '{' };
  if (kind.startsWith('offline')) throw new TypeError('fetch failed');
  if (kind.startsWith('numbers'))
    return json({ error: 404, message: 'suspended' }, 404);
  // The regex reads code units: a combining mark after "found" still matches.
  if (kind.startsWith('combining'))
    return json(
      { error: 'InvalidRequest', message: 'Profile not found\u0301' },
      400,
    );
  // `body.feed[0]` of an object is its member "0".
  if (kind.startsWith('feedobject')) return json({ feed: { 0: post } });
  return json({ feed: 'odd' });
}

export default async function cases() {
  return [
    ...(await each(
      'feedItemTime',
      [
        { item: post },
        {
          item: { ...post, reason: { indexedAt: '2026-06-02T08:00:00.000Z' } },
        },
        { item: { post: { indexedAt: '2026-01-01T00:00:00.000Z' } } },
        { item: { post: { record: { createdAt: 'not a date' } } } },
        {
          item: {
            post: {
              record: { createdAt: '' },
              indexedAt: '2026-01-01T00:00:00Z',
            },
          },
        },
        { item: { post: { record: { createdAt: '2026-01-01' } } } },
        { item: { post: { record: { createdAt: '2026-01-01T10:00:00' } } } },
        {
          item: {
            post: { record: { createdAt: '2026-01-01T10:00:00+05:30' } },
          },
        },
        { item: { post: { record: { createdAt: 1767225600000 } } } },
        {
          item: {
            reason: { indexedAt: null },
            post: { indexedAt: '2026-01-01T00:00:00.000Z' },
          },
        },
        { item: {} },
        { item: 'x' },
        { item: null },
      ],
      ({ item }) => feedItemTime(item),
    )),

    // A time without a zone is read in the local one: across DST gaps and
    // overlaps, half-hour and 45-minute offsets.
    ...(await each(
      'feedItemTimeInZone',
      ZONES.flatMap((zone) =>
        [
          '2026-03-08T02:30:00',
          '2026-11-01T01:30:00',
          '2026-10-04T02:15:00',
          '2026-04-05T01:45:00',
          '2026-01-01T10:00:00',
          '2026-01-01',
          '2026-01-01T10:00:00Z',
        ].map((createdAt) => ({
          zone,
          item: { post: { record: { createdAt } } },
        })),
      ),
      ({ zone, item }) => inZone(zone, () => feedItemTime(item)),
    )),

    ...(await each(
      'checkActivity',
      [
        {
          $id: 'mixed',
          dids: [
            'did:plc:post1',
            'did:plc:repost1',
            'did:plc:quiet1',
            'did:plc:notfound1',
            'did:plc:deactivated1',
            'did:plc:takendown1',
            'did:plc:NOTFOUND1',
            'did:plc:blocked1',
            'did:plc:weird400',
            'did:plc:five1',
            'did:plc:badjson1',
            'did:plc:offline1',
            'did:plc:numbers1',
            'did:plc:odd1',
            'did:plc:post1',
            '',
            null,
          ],
        },
        { $id: 'few', dids: ['did:plc:post2', 'did:plc:quiet2'] },
        {
          $id: 'code-units',
          dids: [
            'did:plc:postcaf\u00e9',
            'did:plc:postcafe\u0301',
            'did:plc:postcaf\u00e9',
            'did:plc:combining1',
            'did:plc:feedobject1',
          ],
        },
        { $id: 'none', dids: [] },
        { $id: 'missing', dids: null },
      ],
      ({ dids }) =>
        recordFetch(appview, async () => {
          const progress = [];
          const results = await checkActivity(dids, {
            onProgress: (p) => progress.push(p),
          });
          return { results, progress };
        }),
    )),
  ];
}
