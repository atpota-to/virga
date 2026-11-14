// The harness's made-up account is the only description of what the network's
// answers look like that nothing else checks, so it can drift. These tests are
// about that: the fixtures still being read by the real code the way real
// answers are. They say nothing about the dashboard's own behaviour.

import { describe, expect, it } from 'vitest';
import { buildRepoCar } from './buildCar.js';
import { createRouter } from './fakeNetwork.js';
import { LAB, ME, PDS, buildWorld, repoRecords, tidAt } from './world.js';
import { createFakeAgent } from './fakeXrpc.js';
import { compactPostFromFeedItem, inboundFromNotification, outboundFromRecord } from '../src/lib/analytics.js';
import { followFromRecord } from '../src/lib/analyticsSync.js';
import { feedItemTime } from '../src/lib/activity.js';
import { rkeyFromAtUri, tidToTimestamp } from '../src/lib/atproto.js';
import { readRepoCar } from '../src/lib/carRepo.js';
import { fetchLinkCard, fetchCardThumbnail } from '../src/posting/lib/linkCard.js';
import { uploadVideo } from '../src/posting/lib/video.js';
import { pdsFromDidDocument } from '../src/session/pds.js';

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

  it('answers when other accounts were last active, and says which are gone', async () => {
    const seen = { active: 0, never: 0, gone: 0 };
    for (const person of world.followedOnly) {
      const res = await route(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${person.did}&limit=1`);
      if (res.status === 400) seen.gone += 1;
      else {
        const body = await res.json();
        if (body.feed.length) {
          expect(feedItemTime(body.feed[0])).toBeTruthy();
          seen.active += 1;
        } else seen.never += 1;
      }
    }
    expect(seen.active).toBeGreaterThan(0);
    expect(seen.gone).toBeGreaterThan(0);
  });

  it('names its lists, and keeps a history for the account’s DID', async () => {
    const list = world.lists[0];
    const [, , repo, collection, rkey] = list.uri.split('/');
    const res = await get(`https://public.api.bsky.app/xrpc/com.atproto.repo.getRecord?repo=${repo}&collection=${collection}&rkey=${rkey}`);
    expect(res.value.name).toBe(list.name);
    const log = await get(`https://plc.directory/${ME.did}/log/audit`);
    expect(log.map((op) => op.operation.alsoKnownAs[0])).toEqual(['at://mira.bsky.social', `at://${ME.handle}`, `at://${ME.handle}`]);
  });

  it('leaves every other host alone', async () => {
    expect(await route('https://example.com/anything')).toBeNull();
  });
});

describe('the second account', () => {
  const lab = buildWorld({ now: NOW, account: LAB });
  const route = createRouter([world, lab]);
  const get = async (url) => (await route(url)).json();

  it('is small, and the same every time', () => {
    expect(lab.me.did).toBe(LAB.did);
    expect(lab.posts.length).toBeLessThan(20);
    expect(buildWorld({ now: NOW, account: LAB }).posts).toEqual(lab.posts);
    // Building it leaves the first account as it was.
    expect(buildWorld({ now: NOW }).posts).toEqual(world.posts);
  });

  it('has its own profile, DID document, feed and repo', async () => {
    expect((await get(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${LAB.handle}`)).did).toBe(LAB.did);
    expect(pdsFromDidDocument(await get(`https://plc.directory/${LAB.did}`), LAB.did)).toBe(PDS);
    const feed = await get(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${LAB.did}&limit=100`);
    expect(feed.feed.map(compactPostFromFeedItem).filter(Boolean)).toHaveLength(lab.posts.length);
    const car = new Uint8Array(await (await route(`${PDS}/xrpc/com.atproto.sync.getRepo?did=${LAB.did}`)).arrayBuffer());
    expect((await readRepoCar(car)).did).toBe(LAB.did);
  });

  it('resolves handles for both accounts and the people around them', async () => {
    expect((await get(`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${LAB.handle}`)).did).toBe(LAB.did);
    const typeahead = await get('https://public.api.bsky.app/xrpc/app.bsky.actor.searchActorsTypeahead?q=mir');
    expect(typeahead.actors.map((a) => a.handle)).toContain(ME.handle);
  });
});

describe('what posting reads from the network', () => {
  const route = createRouter(world, { videoProcessingMs: 150 });
  const fetch = (url, init) => route(url, init);
  const get = async (url) => (await route(url)).json();

  it('answers the feeds and lists the account made', async () => {
    const feeds = await get(`https://public.api.bsky.app/xrpc/app.bsky.feed.getActorFeeds?actor=${ME.did}`);
    expect(feeds.feeds).toHaveLength(world.feeds.length);
    const one = await get(`https://public.api.bsky.app/xrpc/app.bsky.feed.getFeedGenerator?feed=${encodeURIComponent(world.feeds[0].uri)}`);
    expect(one.view.displayName).toBe(world.feeds[0].name);
    const lists = await get(`https://public.api.bsky.app/xrpc/app.bsky.graph.getLists?actor=${ME.did}`);
    const list = await get(`https://public.api.bsky.app/xrpc/app.bsky.graph.getList?list=${encodeURIComponent(lists.lists[0].uri)}`);
    expect(list.items.length).toBeGreaterThan(0);
  });

  it('hydrates other people’s posts by URI', async () => {
    const uri = `at://${world.cast[3].did}/app.bsky.feed.post/${tidAt(NOW - 86_400_000)}`;
    const res = await get(`https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?uris=${encodeURIComponent(uri)}`);
    expect(res.posts[0]).toMatchObject({ uri, author: { did: world.cast[3].did } });
    expect(Date.parse(res.posts[0].record.createdAt)).toBe(NOW - 86_400_000);
  });

  it('gives a link card whose image is a real picture', async () => {
    const card = await fetchLinkCard('https://www.example.org/repair-cafes', { fetch });
    expect(card.title).toBe('Repair cafés near you');
    const res = await route(card.thumb);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(res.headers.get('content-type')).toBe('image/png');
    expect([...bytes.slice(1, 4)].map((b) => String.fromCharCode(b)).join('')).toBe('PNG');
    // In a browser the thumbnail is shrunk; here the decode step is stood in for.
    const file = await fetchCardThumbnail(card.thumb, { fetch, decode: async () => ({ width: 600, height: 315 }), compress: async (f) => f });
    expect(file.size).toBe(bytes.length);
    expect(await fetchLinkCard('https://nowhere.invalid/', { fetch })).toBeNull();
  });

  it('takes a video upload with the right tokens, and hands back its blob once processed', async () => {
    const agent = createFakeAgent(world, { worlds: [world] });
    const file = new File([new Uint8Array(2048).fill(7)], 'clip.mp4', { type: 'video/mp4' });
    const out = await uploadVideo({ did: ME.did, agent, pdsUrl: PDS }, file, { fetch, poll: { pollIntervalMs: 50, failureIntervalMs: 50 } });
    expect(out.blob).toMatchObject({ $type: 'blob', mimeType: 'video/mp4', size: 2048 });
    expect(world.blobs.has(out.blob.ref.$link)).toBe(true);
  }, 15_000);

  it('refuses a video upload token addressed to the wrong service', async () => {
    const agent = createFakeAgent(world, { worlds: [world] });
    const { data } = await agent.com.atproto.server.getServiceAuth({ aud: 'did:web:video.bsky.app', lxm: 'com.atproto.repo.uploadBlob' });
    const res = await route(`https://video.bsky.app/xrpc/app.bsky.video.uploadVideo?did=${ME.did}&name=a.mp4`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${data.token}`, 'Content-Type': 'video/mp4' },
      body: new Uint8Array(10),
    });
    expect(res.status).toBe(401);
  });
});
