// The dashboard's archive: IndexedDB, because the post archive is too big for
// anything else. ~25,000 compact rows is ~6 MB of JSON, past localStorage's
// quota and far past what should be re-fetched on every visit (a full sweep
// of that many posts is ~250 sequential AppView pages).
//
// An archive is fetched once expensively, topped up cheaply, and expected to
// still be there next week.
//
// One database per account. More than one person can sign in from the same
// browser, and one person can have more than one account; each DID's rows
// live in a database of their own, so nobody's numbers are ever drawn from
// somebody else's archive.
//
// Everything degrades. If IndexedDB is absent (node, private windows) or any
// call throws (quota, eviction mid-transaction), the same API is served from
// an in-memory Map: the dashboard works for the session and simply re-syncs
// next time. No caller ever sees an IDB error; they see an empty archive.

const DB_PREFIX = 'virga-analytics:';
// The upgrade path is the STORES loop in onupgradeneeded: any store missing
// from an older database is created, nothing existing is touched. Adding a
// store means adding it below and raising this number.
const DB_VERSION = 1;

/** The database holding one account's archive. */
export function analyticsDbName(did) {
  return `${DB_PREFIX}${did}`;
}

/** store name → keyPath. One object store per archive, plus sync metadata. */
const STORES = {
  posts: 'uri', // compact post rows (analytics.js compactPostFromFeedItem)
  followers: 'did', // { did, handle, displayName, avatar, followedAt }
  following: 'uri', // { uri, did, followedAt }: the account's follow records, by record
  blocks: 'uri', // { uri, did, blockedAt, source }: direct and moderation-list block paths
  inbound: 'uri', // engagement events aimed at the account
  outbound: 'uri', // the account's like/repost events (replies/quotes derive from posts)
  atmosphere: 'uri', // { uri, collection, at }: every record on the repo, dated
  actors: 'did', // resolved profile cards for the People lists
  meta: 'key', // { key, ...facts }: sync stamps, coverage marks
};

/** did → the promise of its handle. One connection per account, shared. */
const _handles = new Map();

// How long an open waits on another tab before serving this one from memory.
// A blocked open isn't a failure: it goes through the moment the tab holding
// the older version lets go, which a tab running this code does at once (see
// onversionchange below). Without a limit, though, the dashboard would sit on
// its loading state for as long as a tab that never lets go stayed open.
const BLOCKED_WAIT_MS = 5_000;

/**
 * Open (once per account) and return the store handle for `did`:
 *
 *   all(store)            → Promise<row[]>
 *   putAll(store, rows)   → Promise<void>   (one transaction, ignores [] )
 *   remove(store, keys)   → Promise<void>   (one transaction, ignores [] )
 *   clear(store)          → Promise<void>
 *   getMeta(key)          → Promise<object|null>
 *   setMeta(key, facts)   → Promise<void>
 *   persistent            true when rows will survive a reload
 *
 * The handle is memoized per account: every consumer shares one connection,
 * and a failed open memoizes the memory fallback rather than retrying per
 * call. Except a blocked one: that is another tab holding the database at an
 * older version, which passes, so its fallback (marked `blocked`, for a
 * dashboard that wants to say why) serves this call and the next call tries
 * again.
 */
export function openAnalyticsStore(did) {
  if (!did) return Promise.resolve(memoryHandle());
  if (!_handles.has(did)) {
    const forget = () => {
      if (_handles.get(did) === opening) _handles.delete(did);
    };
    const opening = openIdb(analyticsDbName(did))
      .then((db) => idbHandle(db, forget))
      .catch((err) => {
        if (err?.blocked) {
          forget();
          return memoryHandle({ blocked: true });
        }
        return memoryHandle();
      });
    _handles.set(did, opening);
  }
  return _handles.get(did);
}

/** Test seam: forget every memoized handle (and its fake DB) between tests. */
export function resetAnalyticsStore() {
  _handles.clear();
}

function openIdb(name) {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('no indexedDB'));
      return;
    }
    const req = indexedDB.open(name, DB_VERSION);
    let settled = false;
    let blockedTimer = null;
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, keyPath] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
      }
    };
    req.onsuccess = () => {
      clearTimeout(blockedTimer);
      // Opened after this call already gave up on it: release it straight
      // away, or this tab becomes the one blocking the next upgrade.
      if (settled) {
        req.result.close();
        return;
      }
      settled = true;
      resolve(req.result);
    };
    req.onerror = () => {
      clearTimeout(blockedTimer);
      if (settled) return;
      settled = true;
      reject(req.error || new Error('indexedDB open failed'));
    };
    req.onblocked = () => {
      if (blockedTimer || settled) return;
      blockedTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const err = new Error('indexedDB blocked by another tab');
        err.blocked = true;
        reject(err);
      }, BLOCKED_WAIT_MS);
    };
  });
}

function idbHandle(db, forget) {
  // A newer build in another tab wants to upgrade the schema. Step aside: this
  // tab's calls fall back as if the database had gone (each one already
  // tolerates that), and the handle is forgotten, so a later open asks again
  // instead of handing out a closed connection.
  db.onversionchange = () => {
    db.close();
    forget();
  };

  // Any structural failure after open (a store missing because a future
  // version renamed it, an eviction mid-write) downgrades that CALL to the
  // fallback result rather than throwing into the dashboard.
  const tx = (store, mode) =>
    new Promise((resolve, reject) => {
      let t;
      try {
        t = db.transaction(store, mode);
      } catch (err) {
        reject(err);
        return;
      }
      resolve(t.objectStore(store));
    });

  const request = (r) =>
    new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });

  return {
    persistent: true,
    async all(store) {
      try {
        return (await request((await tx(store, 'readonly')).getAll())) || [];
      } catch {
        return [];
      }
    },
    async putAll(store, rows) {
      if (!rows || rows.length === 0) return;
      try {
        const os = await tx(store, 'readwrite');
        for (const row of rows) if (row && row[STORES[store]] != null) os.put(row);
        await new Promise((resolve, reject) => {
          os.transaction.oncomplete = resolve;
          os.transaction.onerror = () => reject(os.transaction.error);
          os.transaction.onabort = () => reject(os.transaction.error || new Error('aborted'));
        });
      } catch {
        /* dropped: the next sync rebuilds what this write lost */
      }
    },
    async remove(store, keys) {
      if (!keys || keys.length === 0) return;
      try {
        const os = await tx(store, 'readwrite');
        for (const key of keys) if (key != null) os.delete(key);
        await new Promise((resolve, reject) => {
          os.transaction.oncomplete = resolve;
          os.transaction.onerror = () => reject(os.transaction.error);
          os.transaction.onabort = () => reject(os.transaction.error || new Error('aborted'));
        });
      } catch {
        /* dropped: the next full sweep of that store settles it */
      }
    },
    async clear(store) {
      try {
        const os = await tx(store, 'readwrite');
        await request(os.clear());
      } catch {
        /* ignore */
      }
    },
    async getMeta(key) {
      try {
        return (await request((await tx('meta', 'readonly')).get(key))) || null;
      } catch {
        return null;
      }
    },
    async setMeta(key, facts) {
      await this.putAll('meta', [{ ...facts, key }]);
    },
  };
}

function memoryHandle({ blocked = false } = {}) {
  const mem = new Map(Object.keys(STORES).map((name) => [name, new Map()]));
  return {
    persistent: false,
    blocked,
    async all(store) {
      return Array.from(mem.get(store)?.values() || []);
    },
    async putAll(store, rows) {
      const m = mem.get(store);
      if (!m) return;
      for (const row of rows || []) {
        const key = row?.[STORES[store]];
        if (key != null) m.set(key, row);
      }
    },
    async remove(store, keys) {
      const m = mem.get(store);
      for (const key of keys || []) m?.delete(key);
    },
    async clear(store) {
      mem.get(store)?.clear();
    },
    async getMeta(key) {
      return mem.get('meta').get(key) || null;
    },
    async setMeta(key, facts) {
      mem.get('meta').set(key, { ...facts, key });
    },
  };
}
