import { describe, expect, it, vi } from 'vitest';
import {
  replyFromView,
  loadReplyTarget,
  loadRecordTarget,
  loadDraftTarget,
  loadScheduledTarget,
  continueCandidates,
  refUri,
} from './loaders.js';

const MIRA = 'did:plc:mira';
const view = (uri, extra = {}) => ({
  uri,
  cid: 'bafycid',
  author: {
    did: 'did:plc:wren',
    handle: 'wren.example.com',
    displayName: 'Wren',
    avatar: 'https://x/a.jpg',
  },
  record: { text: 'hello', ...extra },
});

describe('replyFromView', () => {
  it('replies to a top-level post with it as the root', () => {
    const r = replyFromView(view('at://did:plc:wren/app.bsky.feed.post/1'));
    expect(r.root).toEqual({
      uri: 'at://did:plc:wren/app.bsky.feed.post/1',
      cid: 'bafycid',
    });
    expect(r.author.handle).toBe('wren.example.com');
    expect(r.text).toBe('hello');
  });
  it('keeps a reply’s own root', () => {
    const root = { uri: 'at://did:plc:a/app.bsky.feed.post/0', cid: 'rootcid' };
    const r = replyFromView(
      view('at://did:plc:wren/app.bsky.feed.post/1', {
        reply: { root, parent: root },
      }),
    );
    expect(r.root).toEqual(root);
  });
  it('is null without a cid', () => {
    expect(replyFromView({ uri: 'x' })).toBeNull();
  });
});

describe('refUri', () => {
  it('resolves a handle', async () => {
    const resolveHandle = vi.fn(async () => 'did:plc:wren');
    expect(
      await refUri(
        { kind: 'post', handle: 'wren.example.com', rkey: '3a' },
        { resolveHandle },
      ),
    ).toBe('at://did:plc:wren/app.bsky.feed.post/3a');
  });
});

describe('loadReplyTarget', () => {
  it('reads the post publicly', async () => {
    const uri = 'at://did:plc:wren/app.bsky.feed.post/1';
    const getPosts = vi.fn(async () => ({ views: [view(uri)], failed: 0 }));
    const r = await loadReplyTarget({ kind: 'post', uri }, { getPosts });
    expect(r.uri).toBe(uri);
    expect(getPosts).toHaveBeenCalledWith([uri], expect.anything());
  });
  it('says when it’s gone', async () => {
    const getPosts = async () => ({ views: [], failed: 0 });
    await expect(
      loadReplyTarget(
        { kind: 'post', uri: 'at://a/app.bsky.feed.post/1' },
        { getPosts },
      ),
    ).rejects.toMatchObject({ code: 'GONE' });
  });
  it('says when it couldn’t be read', async () => {
    const getPosts = async () => ({ views: [], failed: 1, error: null });
    await expect(
      loadReplyTarget(
        { kind: 'post', uri: 'at://a/app.bsky.feed.post/1' },
        { getPosts },
      ),
    ).rejects.toMatchObject({ code: 'READ_FAILED' });
  });
});

describe('loadRecordTarget', () => {
  it('reads a feed and a starter pack', async () => {
    const xrpc = vi.fn(async (nsid) =>
      nsid === 'app.bsky.feed.getFeedGenerator'
        ? { view: { uri: 'at://a/app.bsky.feed.generator/f', cid: 'c1' } }
        : {
            starterPack: {
              uri: 'at://a/app.bsky.graph.starterpack/s',
              cid: 'c2',
            },
          },
    );
    expect(
      await loadRecordTarget(
        { kind: 'feed', uri: 'at://a/app.bsky.feed.generator/f' },
        { xrpc },
      ),
    ).toMatchObject({ kind: 'feed', cid: 'c1' });
    expect(
      await loadRecordTarget(
        { kind: 'starterpack', uri: 'at://a/app.bsky.graph.starterpack/s' },
        { xrpc },
      ),
    ).toMatchObject({
      kind: 'starterpack',
      cid: 'c2',
    });
  });
  it('turns a 400 into “gone” and anything else into “couldn’t read”', async () => {
    const gone = async () =>
      Promise.reject(Object.assign(new Error('x'), { status: 400 }));
    await expect(
      loadRecordTarget(
        { kind: 'list', uri: 'at://a/app.bsky.graph.list/l' },
        { xrpc: gone },
      ),
    ).rejects.toMatchObject({ code: 'GONE' });
    const down = async () =>
      Promise.reject(Object.assign(new Error('x'), { status: 502 }));
    await expect(
      loadRecordTarget(
        { kind: 'list', uri: 'at://a/app.bsky.graph.list/l' },
        { xrpc: down },
      ),
    ).rejects.toMatchObject({ code: 'READ_FAILED' });
  });
});

describe('loadDraftTarget', () => {
  it('opens the draft as its owner', async () => {
    const agent = { did: MIRA };
    const openDraft = vi.fn(async (v, o) => ({
      state: { from: v.id, asDid: o.asDid },
      missing: [],
    }));
    const r = await loadDraftTarget({
      draftId: 'd2',
      ownerDid: MIRA,
      agentFor: async () => agent,
      listAllDrafts: async () => [{ id: 'd1' }, { id: 'd2' }],
      openDraft,
      defaults: { langs: ['en'] },
    });
    expect(r.state).toEqual({ from: 'd2', asDid: MIRA });
    expect(openDraft.mock.calls[0][1].defaults).toEqual({ langs: ['en'] });
  });
  it('says when the draft is gone or the account must sign in', async () => {
    await expect(
      loadDraftTarget({
        draftId: 'x',
        ownerDid: MIRA,
        agentFor: async () => ({}),
        listAllDrafts: async () => [],
        openDraft: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'GONE' });
    await expect(
      loadDraftTarget({
        draftId: 'x',
        ownerDid: MIRA,
        agentFor: async () => Promise.reject(new Error('reauth')),
        listAllDrafts: vi.fn(),
        openDraft: vi.fn(),
      }),
    ).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' });
  });
});

describe('loadScheduledTarget', () => {
  const base = {
    id: 's1',
    status: 'pending',
    clientKey: 'virga',
    payload: { media: {} },
  };
  const deps = (row, media = {}) => ({
    id: 's1',
    asDid: MIRA,
    req: {},
    getScheduled: async () => row,
    getScheduledMedia: vi.fn(async () => media),
    reconstructFromScheduled: (r, m, o) => ({
      id: r.id,
      media: m,
      asDid: o.asDid,
    }),
  });

  it('opens Virga’s own waiting row, reading its images only when it has some', async () => {
    const d = deps(base);
    expect((await loadScheduledTarget(d)).state).toEqual({
      id: 's1',
      media: {},
      asDid: MIRA,
    });
    expect(d.getScheduledMedia).not.toHaveBeenCalled();
    const withMedia = deps(
      { ...base, payload: { media: { 'p0-img0': {} } } },
      { 'p0-img0': { base64: 'x' } },
    );
    expect((await loadScheduledTarget(withMedia)).state.media).toEqual({
      'p0-img0': { base64: 'x' },
    });
  });

  it('refuses Anisota’s rows, part-published rows and rows going out', async () => {
    await expect(
      loadScheduledTarget(deps({ ...base, clientKey: 'anisota' })),
    ).rejects.toMatchObject({ code: 'NOT_YOURS' });
    await expect(
      loadScheduledTarget(deps({ ...base, partial: true })),
    ).rejects.toMatchObject({ code: 'PARTIAL' });
    await expect(
      loadScheduledTarget(deps({ ...base, status: 'publishing' })),
    ).rejects.toMatchObject({ code: 'NOT_EDITABLE' });
  });

  it('needs the server', async () => {
    await expect(
      loadScheduledTarget({ ...deps(base), req: null }),
    ).rejects.toMatchObject({ code: 'NEEDS_BACKEND' });
  });
});

describe('continueCandidates', () => {
  it('lists the account’s own threads, newest first', () => {
    const rows = [
      { uri: `at://${MIRA}/app.bsky.feed.post/1`, at: '2026-11-01T00:00:00Z' },
      {
        uri: `at://${MIRA}/app.bsky.feed.post/2`,
        at: '2026-11-03T00:00:00Z',
        replyTo: 'did:plc:other',
      },
      {
        uri: `at://${MIRA}/app.bsky.feed.post/3`,
        at: '2026-11-02T00:00:00Z',
        replyTo: MIRA,
      },
      {
        uri: 'at://did:plc:other/app.bsky.feed.post/4',
        at: '2026-11-04T00:00:00Z',
      },
    ];
    expect(
      continueCandidates(rows, MIRA).map((r) => r.uri.split('/').pop()),
    ).toEqual(['3', '1']);
  });
});
