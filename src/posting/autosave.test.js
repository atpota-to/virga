import { afterEach, describe, expect, it } from 'vitest';
import {
  AUTOSAVE_TTL_MS,
  autosaveKey,
  clearAllSessionDrafts,
  clearAutosave,
  collectPreviewUrls,
  countSetAside,
  createAutosaver,
  deserializeComposerState,
  forgetSessionDrafts,
  MAX_SET_ASIDE,
  setAside,
  takeSetAside,
  hasAutosaveContent,
  loadSessionDraft,
  previewUrlIsHeld,
  readAutosave,
  saveSessionDraft,
  serializeComposerState,
  writeAutosave,
} from './autosave.js';

const ALICE = 'did:plc:alice';
const BOB = 'did:plc:bob';
const NOW = Date.parse('2026-11-12T12:00:00.000Z');

function memoryStore({ failWrites = 0 } = {}) {
  const data = new Map();
  let failures = failWrites;
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => {
      if (failures > 0) {
        failures -= 1;
        const err = new Error('full');
        err.name = 'QuotaExceededError';
        throw err;
      }
      data.set(k, String(v));
    },
    removeItem: (k) => data.delete(k),
  };
}

const BLOB = {
  $type: 'blob',
  ref: { $link: 'bafkimage' },
  mimeType: 'image/jpeg',
  size: 1200,
};

function post(fields = {}) {
  return {
    id: 'p1',
    text: '',
    images: [],
    video: null,
    record: null,
    card: null,
    ...fields,
  };
}

function state(fields = {}) {
  return {
    posts: [post()],
    reply: null,
    tags: [],
    langs: ['en'],
    labels: [],
    gates: { custom: false, reply: null, quotes: true },
    asDid: ALICE,
    schedule: null,
    lifespan: { enabled: false, lifespanSeconds: 86400 },
    source: null,
    ...fields,
  };
}

afterEach(() => {
  clearAllSessionDrafts();
});

describe('serializeComposerState', () => {
  it('keeps text, the thread, quotes, cards and settings', () => {
    const s = state({
      posts: [
        post({
          text: 'first',
          record: {
            kind: 'post',
            uri: 'at://x/app.bsky.feed.post/1',
            cid: 'c1',
            view: { uri: 'at://x/app.bsky.feed.post/1' },
          },
        }),
        post({
          id: 'p2',
          text: 'second',
          card: {
            url: 'https://example.com',
            title: 'Ex',
            description: '',
            thumb: 'https://img/1.jpg',
          },
        }),
      ],
      tags: ['art'],
      labels: ['nudity'],
      reply: {
        uri: 'at://y/app.bsky.feed.post/2',
        cid: 'c2',
        root: { uri: 'at://y/app.bsky.feed.post/0', cid: 'c0' },
        author: { did: 'did:plc:y', handle: 'y.test' },
        text: 'parent',
      },
      source: { kind: 'draft', id: '3kd', ownerDid: ALICE },
    });
    const { state: out, mediaLeftOut } = serializeComposerState(s);
    expect(mediaLeftOut).toBe(0);
    expect(out.posts.map((p) => p.text)).toEqual(['first', 'second']);
    expect(out.posts[0].record).toEqual({
      kind: 'post',
      uri: 'at://x/app.bsky.feed.post/1',
      cid: 'c1',
      view: { uri: 'at://x/app.bsky.feed.post/1' },
    });
    expect(out.posts[1].card).toEqual({
      url: 'https://example.com',
      title: 'Ex',
      description: '',
      thumb: 'https://img/1.jpg',
    });
    expect(out).toMatchObject({
      tags: ['art'],
      labels: ['nudity'],
      asDid: ALICE,
      source: { kind: 'draft', id: '3kd' },
    });
    expect(out.reply.text).toBe('parent');
  });

  it('keeps media a reload can get back, and counts what it can’t', () => {
    const file = { name: 'a.jpg' };
    const s = state({
      posts: [
        post({
          text: 'pics',
          images: [
            {
              id: 'i1',
              file,
              mime: 'image/jpeg',
              size: 10,
              alt: 'only a file',
              previewUrl: 'blob:local/1',
            },
            {
              id: 'i2',
              mime: 'image/jpeg',
              size: 10,
              alt: 'in a draft',
              localRef: 'virga-posting:abc',
            },
            {
              id: 'i3',
              blob: BLOB,
              blobDid: ALICE,
              mime: 'image/jpeg',
              size: 1200,
              alt: 'uploaded',
              previewUrl: 'https://cdn/x',
            },
          ],
          card: {
            url: 'https://example.com',
            title: 'Ex',
            description: '',
            thumb: 'blob:local/2',
            thumbFile: file,
            edited: true,
          },
        }),
      ],
    });
    const { state: out, mediaLeftOut } = serializeComposerState(s);
    expect(out.posts[0].images.map((i) => i.id)).toEqual(['i2', 'i3']);
    expect(out.posts[0].images[1]).toMatchObject({
      blob: BLOB,
      blobDid: ALICE,
      previewUrl: 'https://cdn/x',
    });
    expect(out.posts[0].images[0]).not.toHaveProperty('file');
    expect(out.posts[0].card.thumb).toBeNull();
    expect(mediaLeftOut).toBe(2);
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
  });

  it('resets a video still uploading, so it starts again after a reload', () => {
    const { state: out } = serializeComposerState(
      state({
        posts: [
          post({
            video: {
              localRef: 'virga-posting:v',
              mime: 'video/mp4',
              size: 9,
              alt: '',
              status: 'processing',
              jobId: 'j',
            },
          }),
        ],
      }),
    );
    expect(out.posts[0].video).toEqual({
      localRef: 'virga-posting:v',
      mime: 'video/mp4',
      size: 9,
      alt: '',
      status: 'idle',
    });
  });
});

describe('hasAutosaveContent', () => {
  it('counts text, media, embeds, a reply or tags', () => {
    expect(hasAutosaveContent(state())).toBe(false);
    expect(hasAutosaveContent(state({ posts: [post({ text: '  ' })] }))).toBe(
      false,
    );
    expect(hasAutosaveContent(state({ posts: [post({ text: 'hi' })] }))).toBe(
      true,
    );
    expect(hasAutosaveContent(state({ tags: ['x'] }))).toBe(true);
    expect(hasAutosaveContent(state({ reply: { uri: 'at://a/b/c' } }))).toBe(
      true,
    );
    expect(
      hasAutosaveContent(
        state({ posts: [post({ card: { url: 'https://e.com' } })] }),
      ),
    ).toBe(true);
  });
});

describe('writeAutosave and readAutosave', () => {
  it('round-trip a post over the account’s defaults', () => {
    const store = memoryStore();
    writeAutosave(
      ALICE,
      state({ posts: [post({ text: 'hello' })], tags: ['t'] }),
      { store, now: NOW },
    );
    expect(store.data.has(autosaveKey(ALICE))).toBe(true);
    expect(autosaveKey(ALICE)).toBe('virga:composer-autosave:did:plc:alice');

    const base = state({
      langs: ['fr'],
      lifespan: { enabled: true, lifespanSeconds: 60 },
    });
    const back = readAutosave(ALICE, { store, now: NOW + 1000, base });
    expect(back.savedAt).toBe(NOW);
    expect(back.state.posts[0].text).toBe('hello');
    expect(back.state.tags).toEqual(['t']);
    // Stored values win over the base; the base fills what wasn't stored.
    expect(back.state.langs).toEqual(['en']);
    expect(back.state.lifespan).toEqual({
      enabled: false,
      lifespanSeconds: 86400,
    });
  });

  it('clears an empty post instead of saving it', () => {
    const store = memoryStore();
    writeAutosave(ALICE, state({ posts: [post({ text: 'x' })] }), {
      store,
      now: NOW,
    });
    expect(writeAutosave(ALICE, state(), { store, now: NOW })).toBeNull();
    expect(store.data.has(autosaveKey(ALICE))).toBe(false);
  });

  it('forgets an entry older than a day, from another version, or filed wrongly', () => {
    const store = memoryStore();
    writeAutosave(ALICE, state({ posts: [post({ text: 'x' })] }), {
      store,
      now: NOW,
    });
    expect(
      readAutosave(ALICE, { store, now: NOW + AUTOSAVE_TTL_MS + 1 }),
    ).toBeNull();
    expect(store.data.has(autosaveKey(ALICE))).toBe(false);

    store.setItem(
      autosaveKey(ALICE),
      JSON.stringify({
        version: 99,
        savedAt: NOW,
        state: { posts: [{ text: 'x' }] },
      }),
    );
    expect(readAutosave(ALICE, { store, now: NOW })).toBeNull();

    store.setItem(
      autosaveKey(ALICE),
      JSON.stringify({
        version: 1,
        savedAt: NOW,
        did: BOB,
        state: { posts: [{ text: 'x' }] },
      }),
    );
    expect(readAutosave(ALICE, { store, now: NOW })).toBeNull();

    store.setItem(autosaveKey(ALICE), '{broken');
    expect(readAutosave(ALICE, { store, now: NOW })).toBeNull();
  });

  it('keeps each account’s apart', () => {
    const store = memoryStore();
    writeAutosave(ALICE, state({ posts: [post({ text: 'alice' })] }), {
      store,
      now: NOW,
    });
    writeAutosave(BOB, state({ posts: [post({ text: 'bob' })], asDid: BOB }), {
      store,
      now: NOW,
    });
    expect(readAutosave(ALICE, { store, now: NOW }).state.posts[0].text).toBe(
      'alice',
    );
    expect(readAutosave(BOB, { store, now: NOW }).state.posts[0].text).toBe(
      'bob',
    );
    clearAutosave(ALICE, { store });
    expect(readAutosave(ALICE, { store, now: NOW })).toBeNull();
    expect(readAutosave(BOB, { store, now: NOW })).not.toBeNull();
  });

  it('tries a smaller entry when storage is full', () => {
    const store = memoryStore({ failWrites: 1 });
    const entry = writeAutosave(
      ALICE,
      state({
        posts: [
          post({
            text: 'q',
            record: {
              kind: 'post',
              uri: 'at://x/app.bsky.feed.post/1',
              cid: 'c',
              view: { big: true },
            },
          }),
        ],
      }),
      { store, now: NOW },
    );
    expect(entry.state.posts[0].record).toEqual({
      kind: 'post',
      uri: 'at://x/app.bsky.feed.post/1',
      cid: 'c',
    });
  });

  it('gives a state without stored gates the base’s', () => {
    const base = state();
    expect(
      deserializeComposerState({ posts: [{ text: 'x' }], gates: null }, base)
        .gates,
    ).toEqual(base.gates);
    expect(deserializeComposerState({}, base).posts).toBe(base.posts);
  });
});

describe('createAutosaver', () => {
  function harness(options = {}) {
    const timers = [];
    const target = new EventTarget();
    const doc = Object.assign(new EventTarget(), {
      visibilityState: 'visible',
    });
    const store = memoryStore();
    const autosave = createAutosaver({
      store,
      now: () => NOW,
      setTimer: (fn, ms) => {
        timers.push({ fn, ms, live: true });
        return timers.length - 1;
      },
      clearTimer: (id) => {
        if (timers[id]) timers[id].live = false;
      },
      target,
      doc,
      ...options,
    });
    const fire = () =>
      timers
        .filter((t) => t.live)
        .forEach((t) => {
          t.live = false;
          t.fn();
        });
    return { autosave, store, target, doc, timers, fire };
  }

  it('writes two seconds after the last change', () => {
    const { autosave, store, timers, fire } = harness();
    autosave.save(ALICE, state({ posts: [post({ text: 'a' })] }));
    autosave.save(ALICE, state({ posts: [post({ text: 'ab' })] }));
    expect(timers.filter((t) => t.live)).toHaveLength(1);
    expect(timers[1].ms).toBe(2000);
    expect(store.data.size).toBe(0);
    fire();
    expect(
      JSON.parse(store.getItem(autosaveKey(ALICE))).state.posts[0].text,
    ).toBe('ab');
  });

  it('writes what is waiting when the page is hidden', () => {
    const { autosave, store, target, doc } = harness();
    autosave.save(ALICE, state({ posts: [post({ text: 'leaving' })] }));
    target.dispatchEvent(new Event('pagehide'));
    expect(
      JSON.parse(store.getItem(autosaveKey(ALICE))).state.posts[0].text,
    ).toBe('leaving');

    autosave.save(ALICE, state({ posts: [post({ text: 'tabbed away' })] }));
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(
      JSON.parse(store.getItem(autosaveKey(ALICE))).state.posts[0].text,
    ).toBe('leaving');
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(
      JSON.parse(store.getItem(autosaveKey(ALICE))).state.posts[0].text,
    ).toBe('tabbed away');
  });

  it('drops a write meant for an account that is no longer the composer’s', () => {
    let current = ALICE;
    const { autosave, store, target } = harness({ currentDid: () => current });
    autosave.save(ALICE, state({ posts: [post({ text: 'for alice' })] }));
    current = BOB;
    target.dispatchEvent(new Event('pagehide'));
    expect(store.data.size).toBe(0);
  });

  it('can be cancelled after a publish, and stops listening when disposed', () => {
    const { autosave, store, target, fire } = harness();
    autosave.save(ALICE, state({ posts: [post({ text: 'sent' })] }));
    expect(autosave.pending()).toBe(ALICE);
    autosave.cancel();
    fire();
    expect(store.data.size).toBe(0);

    autosave.save(ALICE, state({ posts: [post({ text: 'later' })] }));
    autosave.dispose();
    target.dispatchEvent(new Event('pagehide'));
    expect(store.data.size).toBe(0);
  });
});

describe('session drafts', () => {
  it('keep the whole state per account, files included, and drop an empty one', () => {
    const file = { name: 'a.jpg' };
    const s = state({
      posts: [
        post({ text: 'x', images: [{ id: 'i', file, previewUrl: 'blob:1' }] }),
      ],
    });
    saveSessionDraft(ALICE, s, NOW);
    expect(loadSessionDraft(ALICE)).toEqual({ state: s, savedAt: NOW });
    expect(loadSessionDraft(ALICE).state.posts[0].images[0].file).toBe(file);
    expect(loadSessionDraft(BOB)).toBeNull();
    saveSessionDraft(ALICE, state());
    expect(loadSessionDraft(ALICE)).toBeNull();
  });

  it('hold an object URL as long as any kept draft shows it', () => {
    const kept = state({
      posts: [
        post({ text: 'x', images: [{ id: 'i', previewUrl: 'blob:kept' }] }),
      ],
    });
    const live = state({
      posts: [
        post({ text: 'y', card: { url: 'https://e', thumb: 'blob:card' } }),
      ],
    });
    saveSessionDraft(BOB, kept);
    expect([...collectPreviewUrls(live)]).toEqual(['blob:card']);
    expect(previewUrlIsHeld('blob:kept', live)).toBe(true);
    expect(previewUrlIsHeld('blob:card', live)).toBe(true);
    expect(previewUrlIsHeld('blob:gone', live)).toBe(false);
  });
});

describe('the timer choice and posts set aside', () => {
  it('keep whether the writer chose the timer, in both layers', () => {
    const store = memoryStore();
    const s = state({ posts: [post({ text: 'keep it' })] });
    writeAutosave(ALICE, s, { store, now: NOW, lifespanTouched: true });
    expect(readAutosave(ALICE, { store, now: NOW }).lifespanTouched).toBe(true);
    writeAutosave(ALICE, s, { store, now: NOW });
    expect(readAutosave(ALICE, { store, now: NOW }).lifespanTouched).toBeUndefined();
    saveSessionDraft(ALICE, s, { now: NOW, lifespanTouched: true });
    expect(loadSessionDraft(ALICE)).toEqual({ state: s, savedAt: NOW, lifespanTouched: true });
  });

  it('passes the timer choice through the debounced writer', () => {
    const store = memoryStore();
    const timers = [];
    const autosave = createAutosaver({
      store,
      now: () => NOW,
      setTimer: (fn) => timers.push(fn),
      clearTimer: () => {},
      target: null,
      doc: null,
    });
    autosave.save(ALICE, state({ posts: [post({ text: 'x' })] }), { lifespanTouched: true });
    autosave.flush();
    expect(readAutosave(ALICE, { store, now: NOW }).lifespanTouched).toBe(true);
  });

  it('set a post aside without touching the one being written, and give it back once', () => {
    const store = memoryStore();
    writeAutosave(ALICE, state({ posts: [post({ text: 'current' })] }), { store, now: NOW });
    const id = setAside(ALICE, state({ posts: [post({ text: 'the essay' })] }), { store, now: NOW, lifespanTouched: true });
    expect(id).toBeTruthy();
    expect(countSetAside(ALICE, { store, now: NOW })).toBe(1);
    expect(readAutosave(ALICE, { store, now: NOW }).state.posts[0].text).toBe('current');

    const back = takeSetAside(ALICE, { store, now: NOW });
    expect(back.state.posts[0].text).toBe('the essay');
    expect(back.inMemory).toBe(true);
    expect(back.lifespanTouched).toBe(true);
    expect(countSetAside(ALICE, { store, now: NOW })).toBe(0);
    expect(takeSetAside(ALICE, { store, now: NOW })).toBeNull();
  });

  it('bring a set-aside post back after a reload, from storage', () => {
    const store = memoryStore();
    const id = setAside(ALICE, state({ posts: [post({ text: 'after reload' })] }), { store, now: NOW });
    clearAllSessionDrafts(); // the tab closed
    const back = takeSetAside(ALICE, { id, store, now: NOW + 1000, base: state({ langs: ['fr'] }) });
    expect(back.inMemory).toBe(false);
    expect(back.state.posts[0].text).toBe('after reload');
    expect(store.data.has(autosaveKey(ALICE))).toBe(false);
  });

  it('survive the post being written being cleared, emptied or replaced', () => {
    const store = memoryStore();
    setAside(ALICE, state({ posts: [post({ text: 'aside' })] }), { store, now: NOW });
    writeAutosave(ALICE, state({ posts: [post({ text: 'one' })] }), { store, now: NOW });
    writeAutosave(ALICE, state(), { store, now: NOW });
    expect(readAutosave(ALICE, { store, now: NOW })).toBeNull();
    clearAutosave(ALICE, { store, now: NOW });
    clearAllSessionDrafts();
    expect(countSetAside(ALICE, { store, now: NOW })).toBe(1);
    expect(takeSetAside(ALICE, { store, now: NOW }).state.posts[0].text).toBe('aside');
  });

  it('expire after a day, and keep at most MAX_SET_ASIDE', () => {
    const store = memoryStore();
    setAside(ALICE, state({ posts: [post({ text: 'old' })] }), { store, now: NOW });
    clearAllSessionDrafts();
    expect(countSetAside(ALICE, { store, now: NOW + AUTOSAVE_TTL_MS + 1 })).toBe(0);

    for (let i = 0; i < MAX_SET_ASIDE + 2; i += 1) {
      setAside(BOB, state({ asDid: BOB, posts: [post({ text: `n${i}` })] }), { store, now: NOW + i });
    }
    expect(countSetAside(BOB, { store, now: NOW + 20 })).toBe(MAX_SET_ASIDE);
    expect(takeSetAside(BOB, { store, now: NOW + 20 }).state.posts[0].text).toBe(`n${MAX_SET_ASIDE + 1}`);
  });

  it('are dropped from this tab with the account', () => {
    const store = memoryStore();
    setAside(ALICE, state({ posts: [post({ text: 'x', images: [{ id: 'i', previewUrl: 'blob:aside' }] })] }), { store: null, now: NOW });
    saveSessionDraft(ALICE, state({ posts: [post({ text: 'y' })] }));
    expect(previewUrlIsHeld('blob:aside', state())).toBe(true);
    forgetSessionDrafts(ALICE);
    expect(loadSessionDraft(ALICE)).toBeNull();
    expect(countSetAside(ALICE, { store, now: NOW })).toBe(0);
    expect(previewUrlIsHeld('blob:aside', state())).toBe(false);
  });

  it('never set aside an empty post', () => {
    expect(setAside(ALICE, state(), { store: memoryStore(), now: NOW })).toBeNull();
  });
});
