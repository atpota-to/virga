// The harness's made-up account is the only description of what the network's
// answers look like that nothing else checks, so it can drift. These tests are
// about that: the fixtures still being read by the real code the way real
// answers are. They say nothing about the dashboard's own behaviour.

import { describe, expect, it } from 'vitest';
import { buildRepoCar } from './buildCar.js';
import { createRouter } from './fakeNetwork.js';
import { ME, PDS, buildWorld, repoRecords, tidAt } from './world.js';
import { compactPostFromFeedItem, inboundFromNotification, outboundFromRecord } from '../src/lib/analytics.js';
import { followFromRecord } from '../src/lib/analyticsSync.js';
import { rkeyFromAtUri, tidToTimestamp } from '../src/lib/atproto.js';
import { readRepoCar } from '../src/lib/carRepo.js';

const NOW = Date.parse('2026-11-12T12:00:00.000Z');
const world = buildWorld({ now: NOW });

describe('the made-up account', () => {
  it('is the same account every time', () => {
    const again = buildWorld({ now: NOW });
    expect(again.posts).toEqual(world.posts);
    expect(again.followers.map((f) => f.did)).toEqual(world.followers.map((f) => f.did));
  });

  it('mints record keys the dashboard can date', () => {
    const at = NOW - 86_400_000;
    expect(Date.parse(tidToTimestamp(tidAt(at)))).toBe(at);
  });

  it('lists each follower once, nearly all of them dated by their follow record', () => {
    const dids = new Set(world.followers.map((f) => f.did));
    expect(dids.size).toBe(world.followers.length);
    const dated = world.followers.filter((f) => tidToTimestamp(rkeyFromAtUri(f.viewer.followedBy)));
    // A few carry a hand-written key, as a few real ones do.
    expect(dated.length).toBeLessThan(world.followers.length);
    expect(dated.length).toBeGreaterThan(world.followers.length * 0.99);
  });

  it('writes follows, likes, reposts and notifications the sweeps accept', () => {
    expect(world.follows.every((r) => followFromRecord(r))).toBe(true);
    expect(world.likes.every((r) => outboundFromRecord('like', r))).toBe(true);
    expect(world.reposts.every((r) => outboundFromRecord('repost', r))).toBe(true);
    // Follows arrive as notifications too, and are not engagement.
    const engagement = world.notifications.filter((n) => inboundFromNotification(n));
    expect(engagement.length).toBeGreaterThan(0);
    expect(engagement.length).toBeLessThan(world.notifications.length);
  });
});

describe('the fake network', () => {
  const route = createRouter(world);
  const get = async (url) => (await route(url)).json();

  it('pages the author feed to its end, and only the account’s own posts are kept', async () => {
    const rows = [];
    let cursor;
    for (let page = 0; page < 100; page++) {
      const params = new URLSearchParams({ actor: ME.did, limit: '100' });
      if (cursor) params.set('cursor', cursor);
      const res = await get(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?${params}`);
      rows.push(...res.feed.map(compactPostFromFeedItem).filter(Boolean));
      cursor = res.cursor;
      if (!cursor) break;
    }
    expect(rows).toHaveLength(world.posts.length);
    expect(rows.some((r) => r.replyTo)).toBe(true);
    expect(rows.some((r) => r.quoteOf)).toBe(true);
    expect(rows.some((r) => r.hasMedia)).toBe(true);
  });

  it('serves a repo the reader walks, holding every record', async () => {
    const records = repoRecords(world);
    expect(records.map(([key]) => key)).toEqual([...records.map(([key]) => key)].sort());
    const car = await buildRepoCar(ME.did, records);
    const { did, entries } = await readRepoCar(car);
    expect(did).toBe(ME.did);
    expect(entries).toHaveLength(records.length);
    expect(entries.filter((e) => e.collection === 'app.bsky.feed.post')).toHaveLength(world.posts.length);
  });

  it('answers a diff with "revision gone", so the dashboard pulls the whole repo', async () => {
    const res = await route(`${PDS}/xrpc/com.atproto.sync.getRepo?did=${ME.did}&since=3mold`);
    expect(res.status).toBe(400);
  });

  it('names the account’s PDS, and resolves the people around it', async () => {
    const doc = await get(`https://plc.directory/${ME.did}`);
    expect(doc.service[0].serviceEndpoint).toBe(PDS);
    const params = new URLSearchParams();
    for (const did of [world.cast[0].did, 'did:plc:nobodyatall']) params.append('actors', did);
    const res = await get(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfiles?${params}`);
    expect(res.profiles.map((p) => p.did)).toEqual([world.cast[0].did]);
  });

  it('leaves every other host alone', async () => {
    expect(await route('https://example.com/anything')).toBeNull();
  });
});
