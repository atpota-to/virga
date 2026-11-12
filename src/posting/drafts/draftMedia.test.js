import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LOCAL_REF_PREFIX,
  isVirgaLocalRef,
  loadDraftMedia,
  missingDraftMedia,
  newLocalRef,
  openDraftMedia,
  postingDbName,
  pruneDraftMedia,
  removeDraftMedia,
  resetDraftMedia,
  stateLocalRefs,
  storeDraftMedia,
} from './draftMedia.js';

const ALICE = 'did:plc:alice';
const BOB = 'did:plc:bob';

// A small working IndexedDB, as analyticsStore.test.js has its own: databases,
// stores with a keyPath, and put / get / delete / getAllKeys in transactions
// that complete a tick later. Values are kept as given.
function later(fn) {
  queueMicrotask(fn);
}

function fireRequest(result, error = null) {
  const req = {
    result: undefined,
    error: null,
    onsuccess: null,
    onerror: null,
  };
  later(() => {
    if (error) {
      req.error = error;
      req.onerror?.();
    } else {
      req.result = result;
      req.onsuccess?.();
    }
  });
  return req;
}

function createFakeIndexedDB({ failOpen = false } = {}) {
  const databases = new Map();

  function makeDb(name, stores) {
    const db = {
      name,
      closed: false,
      onversionchange: null,
      objectStoreNames: { contains: (s) => stores.has(s) },
      createObjectStore(store, { keyPath }) {
        stores.set(store, { keyPath, rows: new Map() });
      },
      close() {
        this.closed = true;
      },
      transaction(storeName, mode = 'readonly') {
        const store = stores.get(storeName);
        if (!store) throw new Error(`No store ${storeName}`);
        const tx = {
          mode,
          oncomplete: null,
          onerror: null,
          onabort: null,
          error: null,
        };
        const pending = [];
        const schedule = () =>
          later(() => {
            Promise.all(pending).then(() => later(() => tx.oncomplete?.()));
          });
        let scheduled = false;
        const track = (req) => {
          pending.push(new Promise((r) => later(r)));
          if (!scheduled) {
            scheduled = true;
            schedule();
          }
          return req;
        };
        const os = {
          transaction: tx,
          put(value) {
            if (mode !== 'readwrite') throw new Error('read-only transaction');
            store.rows.set(value[store.keyPath], value);
            return track(fireRequest(value[store.keyPath]));
          },
          delete(key) {
            if (mode !== 'readwrite') throw new Error('read-only transaction');
            store.rows.delete(key);
            return track(fireRequest(undefined));
          },
          get(key) {
            return track(fireRequest(store.rows.get(key)));
          },
          getAll() {
            return track(fireRequest([...store.rows.values()]));
          },
          getAllKeys() {
            return track(fireRequest([...store.rows.keys()]));
          },
        };
        tx.objectStore = () => os;
        // A transaction with no requests still completes.
        later(() => {
          if (!scheduled) {
            scheduled = true;
            schedule();
          }
        });
        return tx;
      },
    };
    return db;
  }

  return {
    databases,
    open(name) {
      const req = {
        result: null,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        onblocked: null,
      };
      later(() => {
        if (failOpen) {
          req.error = new Error('open failed');
          req.onerror?.();
          return;
        }
        let stores = databases.get(name);
        const fresh = !stores;
        if (fresh) {
          stores = new Map();
          databases.set(name, stores);
        }
        req.result = makeDb(name, stores);
        if (fresh) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
}

function file(name, type = 'image/jpeg', size = 3) {
  return { name, type, size };
}

function state(posts) {
  return { asDid: ALICE, posts };
}

let idb;

beforeEach(() => {
  idb = createFakeIndexedDB();
  resetDraftMedia();
});

afterEach(() => {
  resetDraftMedia();
});

describe('local refs', () => {
  it('are minted with Virga’s prefix, so other apps’ paths are never looked up', () => {
    const ref = newLocalRef();
    expect(ref.startsWith(LOCAL_REF_PREFIX)).toBe(true);
    expect(newLocalRef()).not.toBe(ref);
    expect(isVirgaLocalRef(ref)).toBe(true);
    expect(isVirgaLocalRef('file:///var/mobile/photo.jpg')).toBe(false);
  });
});

describe('openDraftMedia', () => {
  it('opens one database per account, with a media store', async () => {
    const alice = await openDraftMedia(ALICE, { indexedDB: idb });
    await openDraftMedia(BOB, { indexedDB: idb });
    expect(postingDbName(ALICE)).toBe('virga-posting:did:plc:alice');
    expect([...idb.databases.keys()]).toEqual([
      postingDbName(ALICE),
      postingDbName(BOB),
    ]);
    expect(idb.databases.get(postingDbName(ALICE)).has('media')).toBe(true);
    expect(alice.persistent).toBe(true);
    expect(await openDraftMedia(ALICE, { indexedDB: idb })).toBe(alice);
  });

  it('keeps files in memory for the session when IndexedDB can’t open', async () => {
    const store = await openDraftMedia(ALICE, {
      indexedDB: createFakeIndexedDB({ failOpen: true }),
    });
    expect(store.persistent).toBe(false);
    await store.put([{ ref: 'virga-media:1', file: file('a.jpg') }]);
    expect((await store.get('virga-media:1')).file.name).toBe('a.jpg');
    resetDraftMedia();
    expect((await openDraftMedia(BOB, { indexedDB: null })).persistent).toBe(
      false,
    );
  });
});

describe('storeDraftMedia and loadDraftMedia', () => {
  it('keep each picked file under a new path, and give it back', async () => {
    const media = await openDraftMedia(ALICE, { indexedDB: idb });
    const a = file('a.jpg');
    const v = file('v.mp4', 'video/mp4', 9);
    const { state: saved, refs } = await storeDraftMedia(
      ALICE,
      state([
        {
          id: 'p1',
          images: [
            {
              id: 'i1',
              file: a,
              mime: 'image/jpeg',
              alt: 'a moth',
              previewUrl: 'blob:1',
            },
          ],
        },
        {
          id: 'p2',
          images: [],
          video: { file: v, mime: 'video/mp4', status: 'idle' },
        },
      ]),
      { media, now: 5 },
    );
    expect(refs).toHaveLength(2);
    expect(saved.posts[0].images[0].localRef).toBe(refs[0]);
    expect(saved.posts[1].video.localRef).toBe(refs[1]);
    expect(stateLocalRefs(saved)).toEqual(refs);
    expect(await media.refs()).toEqual(refs);

    // As a reopened draft has them: paths and alt text, no files.
    const reopened = state([
      { id: 'p1', images: [{ id: 'x', localRef: refs[0], alt: 'a moth' }] },
      { id: 'p2', images: [], video: { localRef: refs[1], status: 'idle' } },
    ]);
    const previews = [];
    const { state: back, missing } = await loadDraftMedia(ALICE, reopened, {
      media,
      makePreviewUrl: (f) => {
        previews.push(f);
        return `blob:${f.name}`;
      },
    });
    expect(missing).toEqual([]);
    expect(back.posts[0].images[0]).toMatchObject({
      file: a,
      previewUrl: 'blob:a.jpg',
      alt: 'a moth',
      mime: 'image/jpeg',
      size: 3,
    });
    expect(back.posts[1].video).toMatchObject({
      file: v,
      mime: 'video/mp4',
      size: 9,
    });
    expect(previews).toEqual([a]);
  });

  it('leaves alone media that already has a path, or no file', async () => {
    const media = await openDraftMedia(ALICE, { indexedDB: idb });
    const { state: saved } = await storeDraftMedia(
      ALICE,
      state([
        {
          id: 'p',
          images: [
            { id: 'i', localRef: 'virga-media:kept' },
            { id: 'j', blob: { ref: { $link: 'b' } } },
          ],
        },
      ]),
      { media },
    );
    expect(saved.posts[0].images.map((i) => i.localRef)).toEqual([
      'virga-media:kept',
      undefined,
    ]);
    expect(await media.refs()).toEqual([]);
  });

  it('report what this browser doesn’t hold, so it can be attached again', async () => {
    const media = await openDraftMedia(ALICE, { indexedDB: idb });
    const reopened = state([
      {
        id: 'p',
        images: [
          { id: 'a', localRef: 'virga-media:gone', alt: 'first' },
          {
            id: 'b',
            localRef: 'file:///phone/photo.jpg',
            alt: 'from the phone',
          },
          {
            id: 'c',
            localRef: 'file:///phone/2.jpg',
            blob: { ref: { $link: 'b' }, mimeType: 'image/jpeg' },
          },
        ],
      },
    ]);
    const { state: back, missing } = await loadDraftMedia(ALICE, reopened, {
      media,
      makePreviewUrl: null,
    });
    expect(missing).toEqual(['virga-media:gone', 'file:///phone/photo.jpg']);
    expect(missingDraftMedia(back)).toEqual([
      {
        kind: 'image',
        postIndex: 0,
        imageIndex: 0,
        localRef: 'virga-media:gone',
        alt: 'first',
      },
      {
        kind: 'image',
        postIndex: 0,
        imageIndex: 1,
        localRef: 'file:///phone/photo.jpg',
        alt: 'from the phone',
      },
    ]);
  });

  it('keep one account’s files out of another’s database', async () => {
    const alice = await openDraftMedia(ALICE, { indexedDB: idb });
    const bob = await openDraftMedia(BOB, { indexedDB: idb });
    const { refs } = await storeDraftMedia(
      ALICE,
      state([{ id: 'p', images: [{ id: 'i', file: file('a.jpg') }] }]),
      { media: alice },
    );
    expect(await bob.get(refs[0])).toBeNull();
  });

  it('copy a file into another account’s store under the same path, when a draft is saved as that account', async () => {
    const alice = await openDraftMedia(ALICE, { indexedDB: idb });
    const bob = await openDraftMedia(BOB, { indexedDB: idb });
    const a = file('a.jpg');
    const { state: saved, refs } = await storeDraftMedia(
      ALICE,
      state([{ id: 'p', images: [{ id: 'i', file: a }] }]),
      { media: alice },
    );
    const again = await storeDraftMedia(BOB, saved, { media: bob });
    expect(again.refs).toEqual(refs);
    expect((await bob.get(refs[0])).file).toBe(a);
    // Already held: not written twice.
    const put = vi.spyOn(bob, 'put');
    await storeDraftMedia(BOB, saved, { media: bob });
    expect(put).toHaveBeenCalledWith([]);
  });

  it('give a file attached over another app’s path a path of its own', async () => {
    const media = await openDraftMedia(ALICE, { indexedDB: idb });
    const a = file('a.jpg');
    const { state: saved, refs } = await storeDraftMedia(
      ALICE,
      state([
        {
          id: 'p',
          images: [{ id: 'i', localRef: 'file:///phone/photo.jpg', file: a }],
        },
      ]),
      { media },
    );
    expect(refs).toHaveLength(1);
    expect(isVirgaLocalRef(refs[0])).toBe(true);
    expect(saved.posts[0].images[0].localRef).toBe(refs[0]);
    expect((await media.get(refs[0])).file).toBe(a);
  });
});

describe('removing and pruning', () => {
  it('forget only Virga’s own paths', async () => {
    const media = await openDraftMedia(ALICE, { indexedDB: idb });
    await media.put([
      { ref: 'virga-media:a', file: file('a') },
      { ref: 'virga-media:b', file: file('b') },
    ]);
    await removeDraftMedia(ALICE, ['virga-media:a', 'file:///x'], { media });
    expect(await media.refs()).toEqual(['virga-media:b']);
  });

  it('drop every file no remaining draft names', async () => {
    const media = await openDraftMedia(ALICE, { indexedDB: idb });
    await media.put([
      { ref: 'virga-media:a', file: file('a') },
      { ref: 'virga-media:b', file: file('b') },
      { ref: 'virga-media:c', file: file('c') },
    ]);
    expect(await pruneDraftMedia(ALICE, ['virga-media:b'], { media })).toEqual([
      'virga-media:a',
      'virga-media:c',
    ]);
    expect(await media.refs()).toEqual(['virga-media:b']);
  });

  it('keeps a file saved since `savedBefore`, whatever the drafts say', async () => {
    const media = await openDraftMedia(ALICE, { indexedDB: idb });
    await media.put([
      { ref: 'virga-media:old', file: file('a'), savedAt: 100 },
      { ref: 'virga-media:new', file: file('b'), savedAt: 200 },
    ]);
    expect(await pruneDraftMedia(ALICE, [], { media, savedBefore: 200 })).toEqual([
      'virga-media:old',
    ]);
    expect(await media.refs()).toEqual(['virga-media:new']);
  });
});
