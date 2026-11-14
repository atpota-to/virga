import { describe, expect, it, vi } from 'vitest';
import {
  DraftActionError,
  blobImageLoader,
  draftActionMessage,
  draftMeta,
  draftPostBlock,
  draftScheduleBlock,
  editedLabel,
  postDraftNow,
  prepareDraft,
  scheduleDraft,
} from './draftActions.js';

const DID = 'did:plc:mira';
const VIEW = { id: 'd1', draft: { posts: [{ text: 'hello' }] } };

function baseState(over = {}) {
  return {
    posts: [{ id: 'p', text: 'hello', images: [], video: null, record: null, card: null }],
    reply: null,
    tags: [],
    langs: ['en'],
    labels: [],
    gates: { custom: false, reply: null, quotes: true },
    asDid: DID,
    schedule: null,
    lifespan: { enabled: false },
    source: { kind: 'draft', id: 'd1', ownerDid: DID },
    ...over,
  };
}

function deps(over = {}) {
  return {
    openDraft: vi.fn(async () => ({ state: baseState(), missing: [] })),
    resolveDefaultGates: vi.fn(async () => ({
      gates: { custom: false, reply: [{ type: 'following' }], quotes: true },
      notice: null,
    })),
    targetFor: vi.fn(async (did) => ({ did, agent: {}, pdsUrl: 'https://pds.example' })),
    publish: vi.fn(async () => ({
      posts: [{ uri: `at://${DID}/app.bsky.feed.post/1`, cid: 'c' }],
      root: { uri: `at://${DID}/app.bsky.feed.post/1`, cid: 'c' },
      written: [{ uri: `at://${DID}/app.bsky.feed.post/1`, cid: 'c', record: { text: 'hello' } }],
    })),
    emitPostsChanged: vi.fn(),
    deleteDraft: vi.fn(async () => {}),
    serializeForSchedule: vi.fn(async (state, opts) => ({ scheduledFor: opts.scheduledFor, queued: opts.queued, payload: {} })),
    createScheduled: vi.fn(async () => ({ id: 'row1' })),
    requester: { did: DID, request: vi.fn() },
    ...over,
  };
}

describe('draftMeta', () => {
  it('describes what the draft holds', () => {
    const now = Date.parse('2026-11-12T12:00:00Z');
    const parts = draftMeta(
      {
        updatedAt: '2026-11-12T11:55:00Z',
        isThread: true,
        posts: 3,
        isReply: false,
        images: 2,
        video: false,
        link: null,
        record: { kind: 'post' },
        labels: [],
        tags: ['books', 'reading'],
        deviceName: 'Bluesky',
        savedHere: false,
      },
      now,
    );
    expect(parts).toEqual(['Edited 5 min ago', 'Thread of 3', '2 images', 'Quotes a post', '#books #reading', 'Saved in Bluesky']);
  });
  it('is empty without a row', () => {
    expect(draftMeta(null)).toEqual([]);
  });
});

describe('editedLabel', () => {
  const now = Date.parse('2026-11-12T12:00:00Z');
  it('rounds to what says something', () => {
    expect(editedLabel('2026-11-12T11:59:50Z', now)).toBe('Edited just now');
    expect(editedLabel('2026-11-12T09:00:00Z', now)).toBe('Edited 3 hr ago');
    expect(editedLabel('2026-11-02T09:00:00Z', now)).toBe('Edited Nov 2');
    expect(editedLabel('2025-11-02T09:00:00Z', now)).toBe('Edited Nov 2, 2025');
    expect(editedLabel('nope', now)).toBe('');
  });
});

describe('blocks', () => {
  it('says why a draft can’t be scheduled', () => {
    expect(draftScheduleBlock({}, { canSchedule: false })).toMatch(/long session/);
    expect(draftScheduleBlock({ isReply: true }, { canSchedule: true })).toMatch(/Replies/);
    expect(draftScheduleBlock({ video: true }, { canSchedule: true })).toMatch(/video/);
    expect(draftScheduleBlock({ mediaElsewhere: true }, { canSchedule: true })).toMatch(/another device/);
    expect(draftScheduleBlock({ text: 'x' }, { canSchedule: true })).toBe('');
  });
  it('says why a draft can’t be posted', () => {
    expect(draftPostBlock({ text: 'x' }, { canPost: false })).toMatch(/permission/);
    expect(draftPostBlock({ text: '  ', images: 0 }, { canPost: true })).toMatch(/nothing/);
    expect(draftPostBlock({ text: 'x', mediaElsewhere: true }, { canPost: true })).toMatch(/another device/);
    expect(draftPostBlock({ text: 'x' }, { canPost: true })).toBe('');
  });
});

describe('prepareDraft', () => {
  it('opens with the settings as defaults and resolves default gates', async () => {
    const d = deps();
    const settings = { langs: ['en'] };
    const { state, notes } = await prepareDraft(VIEW, { did: DID, settings, agent: 'agent', deps: d });
    expect(d.openDraft).toHaveBeenCalledWith(VIEW, { asDid: DID, defaults: settings });
    expect(d.resolveDefaultGates).toHaveBeenCalledWith(settings, { agent: 'agent' });
    expect(state.gates.reply).toEqual([{ type: 'following' }]);
    expect(notes).toEqual([]);
  });

  it('keeps gates the draft chose, and never gates a reply', async () => {
    const custom = deps({
      openDraft: vi.fn(async () => ({ state: baseState({ gates: { custom: true, reply: [], quotes: false } }), missing: [] })),
    });
    const a = await prepareDraft(VIEW, { did: DID, settings: {}, agent: null, deps: custom });
    expect(a.state.gates).toEqual({ custom: true, reply: [], quotes: false });
    expect(custom.resolveDefaultGates).not.toHaveBeenCalled();

    const reply = deps({
      openDraft: vi.fn(async () => ({ state: baseState({ reply: { uri: 'at://x/app.bsky.feed.post/1' } }), missing: [] })),
    });
    await prepareDraft(VIEW, { did: DID, settings: {}, agent: null, deps: reply });
    expect(reply.resolveDefaultGates).not.toHaveBeenCalled();
  });

  it('refuses a draft whose images are elsewhere', async () => {
    const d = deps({ openDraft: vi.fn(async () => ({ state: baseState(), missing: ['virga-media:1'] })) });
    await expect(prepareDraft(VIEW, { did: DID, settings: {}, deps: d })).rejects.toMatchObject({ code: 'MEDIA_MISSING' });
  });

  it('says when the default gates fell back', async () => {
    const d = deps({
      resolveDefaultGates: vi.fn(async () => ({ gates: { custom: false, reply: null, quotes: true }, notice: 'Couldn’t read.' })),
    });
    const { notes } = await prepareDraft(VIEW, { did: DID, settings: {}, deps: d });
    expect(notes).toEqual(['Couldn’t read.']);
  });

  it('keeps the default timer only where it can be set', async () => {
    const withTimer = () => vi.fn(async () => ({ state: baseState({ lifespan: { enabled: true, lifespanSeconds: 3600 } }), missing: [] }));
    const room = await prepareDraft(VIEW, {
      did: DID,
      settings: {},
      deps: deps({ openDraft: withTimer(), timerRoom: async () => '' }),
    });
    expect(room.state.lifespan.enabled).toBe(true);

    const full = await prepareDraft(VIEW, {
      did: DID,
      settings: {},
      deps: deps({ openDraft: withTimer(), timerRoom: async () => 'It’s in use.' }),
    });
    expect(full.state.lifespan.enabled).toBe(false);
    expect(full.notes[0]).toMatch(/without your default timer. It’s in use/);

    const browser = await prepareDraft(VIEW, { did: DID, settings: {}, deps: deps({ openDraft: withTimer() }) });
    expect(browser.state.lifespan.enabled).toBe(false);
    expect(browser.notes).toEqual([]);
  });
});

describe('postDraftNow', () => {
  it('publishes, tells the archive, then deletes the draft', async () => {
    const d = deps();
    const order = [];
    d.publish.mockImplementation(async () => {
      order.push('publish');
      return { posts: [], root: { uri: 'at://x/app.bsky.feed.post/1' }, written: [{ uri: 'at://x/app.bsky.feed.post/1' }] };
    });
    d.deleteDraft.mockImplementation(async () => order.push('delete'));
    const out = await postDraftNow(VIEW, { did: DID, settings: { requireAltText: true }, agent: 'agent', deps: d });
    expect(order).toEqual(['publish', 'delete']);
    expect(d.publish.mock.calls[0][2].requireAltText).toBe(true);
    expect(d.emitPostsChanged).toHaveBeenCalledWith(DID, { added: [{ uri: 'at://x/app.bsky.feed.post/1' }] });
    expect(d.deleteDraft).toHaveBeenCalledWith('agent', 'd1');
    expect(out.deleted).toBe(true);
    expect(out.timer).toBeNull();
  });

  it('keeps the draft when the publish fails', async () => {
    const d = deps({ publish: vi.fn(async () => Promise.reject(new Error('nope'))) });
    await expect(postDraftNow(VIEW, { did: DID, settings: {}, deps: d })).rejects.toThrow('nope');
    expect(d.deleteDraft).not.toHaveBeenCalled();
  });

  it('reports a draft it couldn’t delete without failing the post', async () => {
    const d = deps({ deleteDraft: vi.fn(async () => Promise.reject(new Error('x'))) });
    const out = await postDraftNow(VIEW, { did: DID, settings: {}, deps: d });
    expect(out.deleted).toBe(false);
    expect(out.notes.at(-1)).toMatch(/still in your drafts/);
  });

  it('arms the default timer after the post', async () => {
    const armTimer = vi.fn(async () => ({ status: 'failed', error: new Error('No room') }));
    const d = deps({
      openDraft: vi.fn(async () => ({ state: baseState({ lifespan: { enabled: true } }), missing: [] })),
      timerRoom: async () => '',
      armTimer,
    });
    const out = await postDraftNow(VIEW, { did: DID, settings: {}, deps: d });
    expect(armTimer).toHaveBeenCalled();
    expect(out.notes[0]).toMatch(/without its timer: No room/);
  });
});

describe('scheduleDraft', () => {
  it('serializes, creates the row, then deletes the draft', async () => {
    const d = deps({ loadImage: async () => null });
    const out = await scheduleDraft(VIEW, {
      did: DID,
      settings: {},
      agent: 'agent',
      scheduledFor: '2026-11-14T09:00:00.000Z',
      queued: true,
      deps: d,
    });
    const [, opts] = d.serializeForSchedule.mock.calls[0];
    expect(opts).toMatchObject({ scheduledFor: '2026-11-14T09:00:00.000Z', queued: true, loadImage: d.loadImage });
    expect(d.createScheduled).toHaveBeenCalledWith(d.requester, expect.objectContaining({ queued: true }));
    expect(d.deleteDraft).toHaveBeenCalledWith('agent', 'd1');
    expect(out.row).toEqual({ id: 'row1' });
  });

  it('needs a long session', async () => {
    await expect(scheduleDraft(VIEW, { did: DID, settings: {}, deps: deps({ requester: null }) })).rejects.toMatchObject({
      code: 'NEEDS_BACKEND',
    });
  });

  it('keeps the draft when the server refuses', async () => {
    const d = deps({ createScheduled: vi.fn(async () => Promise.reject(Object.assign(new Error('q'), { code: 'QUOTA_EXCEEDED' }))) });
    await expect(scheduleDraft(VIEW, { did: DID, settings: {}, scheduledFor: 'x', deps: d })).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
    });
    expect(d.deleteDraft).not.toHaveBeenCalled();
  });
});

describe('blobImageLoader', () => {
  it('passes a file through and reads a blob from the PDS', async () => {
    const fetch = vi.fn(async () => ({ ok: true, blob: async () => 'BYTES' }));
    const load = blobImageLoader({ did: DID, pdsUrl: 'https://pds.example/', fetch });
    expect(await load({ file: 'F' })).toBe('F');
    expect(await load({ blob: { $type: 'blob', ref: { $link: 'bafkrei' }, mimeType: 'image/jpeg', size: 1 } })).toBe('BYTES');
    expect(fetch.mock.calls[0][0]).toBe(
      'https://pds.example/xrpc/com.atproto.sync.getBlob?did=did%3Aplc%3Amira&cid=bafkrei',
    );
    expect(await load({})).toBeNull();
  });
  it('gives null when the read fails', async () => {
    const load = blobImageLoader({ did: DID, pdsUrl: 'https://p', fetch: async () => ({ ok: false }) });
    expect(await load({ blob: { ref: { $link: 'x' }, mimeType: 'image/png' } })).toBeNull();
  });
});

describe('draftActionMessage', () => {
  it('passes plain sentences through and wraps the rest', () => {
    expect(draftActionMessage(new DraftActionError('MEDIA_MISSING', 'Open it.'), { action: 'post' })).toBe('Open it.');
    expect(draftActionMessage({ problems: [{ message: 'Too long.' }] }, { action: 'post' })).toBe('Too long.');
    expect(draftActionMessage(new Error('Offline.'), { action: 'post' })).toBe('The draft couldn’t be posted. Offline.');
    expect(draftActionMessage({}, { action: 'schedule' })).toBe('The draft couldn’t be scheduled. Try again.');
    expect(draftActionMessage(null, { action: 'post' })).toBe('');
  });
});
