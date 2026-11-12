// The fake agent stands where a signed-in @atproto/api Agent stands, so these
// check it against the code that will call it: the posting core's publish,
// the drafts service, the gates and library readers. What it writes has to
// come back out of every reader, the public ones included.

import { describe, expect, it } from 'vitest';
import { createFakeAgent, readServiceToken } from './fakeXrpc.js';
import { createRouter } from './fakeNetwork.js';
import { READ_ONLY_SCOPE } from './harness.js';
import { LAB, ME, PDS, buildWorld } from './world.js';
import { listCollection } from './repo.js';
import { computeRecordCid } from '../src/posting/lib/recordCid.js';
import { publish } from '../src/posting/lib/publish.js';
import { emptyComposerState } from '../src/posting/lib/composerModel.js';
import { readDefaultGates } from '../src/posting/lib/gates.js';
import { uploadBlob } from '../src/posting/lib/blobs.js';
import {
  createDraft,
  deleteDraft,
  listAllDrafts,
  updateDraft,
} from '../src/posting/drafts/drafts.js';
import { fetchBookmarks, searchPosts } from '../src/posting/library/sources.js';
import { isMissingScopeError } from '../src/session/scopes.js';
import { readRepoCar } from '../src/lib/carRepo.js';

const NOW = Date.parse('2026-11-12T12:00:00.000Z');

function setup({ scope } = {}) {
  const mira = buildWorld({ now: NOW });
  const lab = buildWorld({ now: NOW, account: LAB });
  const worlds = [mira, lab];
  let sweeps = 0;
  const agent = createFakeAgent(mira, {
    worlds,
    scope,
    sweepCounter: { next: () => ++sweeps },
  });
  const route = createRouter(worlds);
  const get = async (url) => (await route(url)).json();
  return { mira, lab, worlds, agent, route, get };
}

const stateWith = (texts, extra = {}) => {
  const state = emptyComposerState({
    asDid: ME.did,
    defaults: { langs: ['en'] },
  });
  return {
    ...state,
    posts: texts.map((text, i) => ({ ...state.posts[0], id: `p${i}`, text })),
    ...extra,
  };
};

describe('the fake agent', () => {
  it('builds the NSID from the property chain and answers with { data }', async () => {
    const { agent } = setup();
    expect(agent.did).toBe(ME.did);
    const res = await agent.app.bsky.graph.getFollowers({
      actor: ME.did,
      limit: 3,
    });
    expect(res.success).toBe(true);
    expect(res.data.followers).toHaveLength(3);
    expect(res.data.cursor).toBe('3');
    const next = await agent.handle('app.bsky.graph.getFollowers', {
      limit: 3,
      cursor: res.data.cursor,
    });
    expect(next.data.cursor).toBe('6');
  });

  it('is never mistaken for a promise', async () => {
    const { agent } = setup();
    expect(agent.app.then).toBeUndefined();
    expect(await Promise.resolve(agent)).toBe(agent);
    const namespace = agent.app.bsky;
    expect(await Promise.resolve(namespace)).toBe(namespace);
  });

  it('gives an equivalent agent through withProxy, for the same account', async () => {
    const { agent } = setup();
    const proxied = agent.withProxy('bsky_appview', 'did:web:api.bsky.app');
    expect(proxied.did).toBe(ME.did);
    expect(proxied.proxy).toBe('did:web:api.bsky.app#bsky_appview');
    const res = await proxied.app.bsky.draft.getDrafts({});
    expect(res.data.drafts.length).toBeGreaterThan(0);
  });

  it('refuses a method it has no answer for, as an unimplemented XRPC method', async () => {
    const { agent } = setup();
    await expect(
      agent.app.bsky.unspecced.getSomething({}),
    ).rejects.toMatchObject({ status: 501, error: 'MethodNotImplemented' });
  });

  it('keeps drafts and bookmarks on Bluesky’s AppView only', async () => {
    const { agent } = setup();
    await expect(agent.app.bsky.draft.getDrafts({})).rejects.toMatchObject({
      error: 'MethodNotImplemented',
    });
  });

  it('changes the followers between sweeps, from the second on', async () => {
    const { agent } = setup();
    const first = await agent.app.bsky.graph.getFollowers({ limit: 100 });
    const second = await agent.app.bsky.graph.getFollowers({ limit: 100 });
    expect(first.data.followers[0].handle).not.toBe('tove.example.org');
    expect(second.data.followers[0].handle).toBe('tove.example.org');
  });
});

describe('writing to the repo', () => {
  it('stores a record with the CID a PDS would give it, and lists it first', async () => {
    const { agent, mira } = setup();
    const record = {
      $type: 'app.bsky.feed.post',
      text: 'Hello from the harness',
      createdAt: new Date(NOW).toISOString(),
    };
    const res = await agent.com.atproto.repo.createRecord({
      repo: ME.did,
      collection: 'app.bsky.feed.post',
      record,
    });
    expect(res.data.cid).toBe(await computeRecordCid(record));
    const listed = await agent.com.atproto.repo.listRecords({
      repo: ME.did,
      collection: 'app.bsky.feed.post',
      limit: 1,
    });
    expect(listed.data.records[0]).toMatchObject({
      uri: res.data.uri,
      cid: res.data.cid,
    });
    expect(mira.profile.postsCount).toBe(mira.posts.length);
  });

  it('refuses a create over an existing record, a swap that doesn’t match and another account’s repo', async () => {
    const { agent } = setup();
    const record = {
      $type: 'net.anisota.feed.template',
      name: 'x',
      text: 'y',
      createdAt: new Date(NOW).toISOString(),
    };
    await agent.com.atproto.repo.createRecord({
      repo: ME.did,
      collection: 'net.anisota.feed.template',
      rkey: 'abc',
      record,
    });
    await expect(
      agent.com.atproto.repo.createRecord({
        repo: ME.did,
        collection: 'net.anisota.feed.template',
        rkey: 'abc',
        record,
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      agent.com.atproto.repo.putRecord({
        repo: ME.did,
        collection: 'net.anisota.feed.template',
        rkey: 'abc',
        record,
        swapRecord: 'bafywrong',
      }),
    ).rejects.toMatchObject({ error: 'InvalidSwap' });
    await expect(
      agent.com.atproto.repo.createRecord({
        repo: LAB.did,
        collection: 'net.anisota.feed.template',
        record,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('answers getRecord for what was written and RecordNotFound once it is deleted', async () => {
    const { agent } = setup();
    const record = {
      $type: 'app.bsky.feed.post',
      text: 'Short-lived',
      createdAt: new Date(NOW).toISOString(),
    };
    const { data } = await agent.com.atproto.repo.createRecord({
      repo: ME.did,
      collection: 'app.bsky.feed.post',
      record,
    });
    const rkey = data.uri.split('/').pop();
    expect(
      (
        await agent.com.atproto.repo.getRecord({
          repo: ME.did,
          collection: 'app.bsky.feed.post',
          rkey,
        })
      ).data.value.text,
    ).toBe('Short-lived');
    await agent.com.atproto.repo.deleteRecord({
      repo: ME.did,
      collection: 'app.bsky.feed.post',
      rkey,
    });
    await expect(
      agent.com.atproto.repo.getRecord({
        repo: ME.did,
        collection: 'app.bsky.feed.post',
        rkey,
      }),
    ).rejects.toMatchObject({
      error: 'RecordNotFound',
    });
  });

  it('takes a thread with its gates from the real publish, and the public views show it', async () => {
    const { agent, mira, get } = setup();
    const state = stateWith(['First post of a thread', 'And the second'], {
      gates: { custom: true, reply: [{ type: 'following' }], quotes: false },
    });
    const out = await publish(
      state,
      { did: ME.did, agent, pdsUrl: PDS },
      { resolveMention: async () => null, now: () => NOW },
    );
    expect(out.posts).toHaveLength(2);
    const written = listCollection(mira, 'app.bsky.feed.post');
    expect(written.find((r) => r.uri === out.posts[1].uri).cid).toBe(
      out.posts[1].cid,
    );
    expect(
      listCollection(mira, 'app.bsky.feed.threadgate')[0].value.allow,
    ).toEqual([{ $type: 'app.bsky.feed.threadgate#followingRule' }]);
    expect(
      listCollection(mira, 'app.bsky.feed.postgate')[0].value.embeddingRules,
    ).toEqual([{ $type: 'app.bsky.feed.postgate#disableRule' }]);

    const feed = await get(
      `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${ME.did}&limit=3`,
    );
    expect(feed.feed.map((i) => i.post.uri)).toEqual(
      expect.arrayContaining(out.posts.map((p) => p.uri)),
    );
    const thread = await get(
      `https://public.api.bsky.app/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(out.root.uri)}`,
    );
    expect(thread.thread.replies[0].post.uri).toBe(out.posts[1].uri);
    expect(thread.thread.post.threadgate.record.allow).toHaveLength(1);
  });

  it('puts what was written in the repo download', async () => {
    const { agent, route } = setup();
    const record = {
      $type: 'app.bsky.feed.post',
      text: 'In the CAR',
      createdAt: new Date(NOW).toISOString(),
    };
    const { data } = await agent.com.atproto.repo.createRecord({
      repo: ME.did,
      collection: 'app.bsky.feed.post',
      record,
    });
    const car = new Uint8Array(
      await (
        await route(`${PDS}/xrpc/com.atproto.sync.getRepo?did=${ME.did}`)
      ).arrayBuffer(),
    );
    const { entries } = await readRepoCar(car);
    expect(
      entries.some(
        (e) =>
          e.collection === 'app.bsky.feed.post' &&
          e.rkey === data.uri.split('/').pop(),
      ),
    ).toBe(true);
  });

  it('uploads blobs with a real CID, and refuses one without a media type', async () => {
    const { agent, mira } = setup();
    const target = { did: ME.did, agent };
    const blob = await uploadBlob(target, new Uint8Array([1, 2, 3, 4]), {
      encoding: 'image/png',
    });
    expect(blob.ref.$link).toMatch(/^bafkrei/);
    expect(mira.blobs.get(blob.ref.$link).size).toBe(4);
    await expect(
      agent.com.atproto.repo.uploadBlob(new Uint8Array([1]), {}),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('the signed-in reads posting needs', () => {
  it('keeps drafts in memory per account, through the drafts service', async () => {
    const { agent, worlds } = setup();
    const before = (await listAllDrafts(agent)).length;
    const made = await createDraft(agent, stateWith(['A draft']), {
      resolveMention: async () => null,
      deviceId: null,
    });
    let all = await listAllDrafts(agent);
    expect(all).toHaveLength(before + 1);
    expect(all[0].id).toBe(made.id);
    await updateDraft(agent, made.id, stateWith(['A draft, edited']), {
      resolveMention: async () => null,
      deviceId: null,
    });
    all = await listAllDrafts(agent);
    expect(all[0].draft.posts[0].text).toBe('A draft, edited');
    await deleteDraft(agent, made.id);
    expect(await listAllDrafts(agent)).toHaveLength(before);
    const labAgent = createFakeAgent(worlds[1], { worlds });
    expect(await listAllDrafts(labAgent)).toHaveLength(0);
  });

  it('answers the account’s default reply and quote settings', async () => {
    const { agent, worlds } = setup();
    expect(await readDefaultGates(agent)).toEqual({
      reply: [{ type: 'following' }, { type: 'mention' }],
      quotes: true,
    });
    expect(
      await readDefaultGates(createFakeAgent(worlds[1], { worlds })),
    ).toEqual({ reply: null, quotes: true });
  });

  it('answers bookmarks and post search with posts the public views can hydrate', async () => {
    const { agent, get } = setup();
    const saved = await fetchBookmarks(agent);
    expect(saved.items.length).toBeGreaterThan(0);
    const found = await searchPosts(agent, 'garden');
    expect(found.items.length).toBeGreaterThan(0);
    const uri = found.items[0].uri;
    const posts = await get(
      `https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?uris=${encodeURIComponent(uri)}`,
    );
    expect(posts.posts).toHaveLength(1);
  });

  it('mints service-auth tokens the fake video service can read, and no longer than an hour', async () => {
    const { agent } = setup();
    const exp = Math.floor(Date.now() / 1000) + 1800;
    const { data } = await agent.com.atproto.server.getServiceAuth({
      aud: 'did:web:video.bsky.app',
      lxm: 'app.bsky.video.getUploadLimits',
      exp,
    });
    expect(readServiceToken(data.token)).toMatchObject({
      iss: ME.did,
      aud: 'did:web:video.bsky.app',
      exp,
    });
    await expect(
      agent.com.atproto.server.getServiceAuth({
        aud: 'did:web:x',
        lxm: 'app.bsky.video.getJobStatus',
        exp: exp + 7200,
      }),
    ).rejects.toMatchObject({ error: 'BadExpiration' });
  });

  it('refuses a write the session wasn’t granted, with the words the app looks for', async () => {
    const { mira, worlds } = setup();
    const reader = createFakeAgent(mira, { worlds, scope: READ_ONLY_SCOPE });
    const record = {
      $type: 'app.bsky.feed.post',
      text: 'nope',
      createdAt: new Date(NOW).toISOString(),
    };
    const err = await reader.com.atproto.repo
      .createRecord({ repo: ME.did, collection: 'app.bsky.feed.post', record })
      .catch((e) => e);
    expect(err.status).toBe(403);
    expect(isMissingScopeError(err)).toBe(true);
    const follow = {
      $type: 'app.bsky.graph.follow',
      subject: mira.cast[2].did,
      createdAt: new Date(NOW).toISOString(),
    };
    await expect(
      reader.com.atproto.repo.createRecord({
        repo: ME.did,
        collection: 'app.bsky.graph.follow',
        record: follow,
      }),
    ).resolves.toBeTruthy();
  });
});
