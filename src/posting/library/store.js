// What the library's shelves hold, kept outside React so reopening the
// library shows what was there at once. One store for the app, keyed by the
// account the post is written as.
//
// Shelves load when the dialog asks for them (`ensure`), never all at once.
// Within one opening of the dialog an entry is looked at once: an error stays
// until `retry`, and an entry older than five minutes is shown and its first
// page read again in the background. `reset()` (on sign-out, or removing an
// account) empties it; reads still in flight then land nowhere.
//
// Your posts and Your replies come from the account's archive (`archive`,
// every row at once, paged and sorted here). Only when that archive is empty
// do the `posts` and `replies` entries read the public author feed instead.

import { archiveShelf } from './sources.js';
import {
  dedupeById,
  itemFromFeed,
  itemFromLink,
  itemFromList,
  itemFromPost,
  itemFromTemplate,
  sortItems,
} from './model.js';
import { templateOffered } from '../templates/postTemplates.js';
import { sortTemplatesForShelf } from '../templates/templateUsage.js';

export const STALE_MS = 5 * 60 * 1000;

export const STORE_SHELVES = Object.freeze([
  'archive',
  'posts',
  'replies',
  'saved',
  'links',
  'feeds',
  'lists',
]);

const RECORD_EMBED = 'app.bsky.embed.record';

export const IDLE_ENTRY = Object.freeze({
  status: 'idle',
  error: null,
  data: null,
  cursor: null,
  fetchedAt: 0,
  refreshing: false,
  loadingMore: false,
  loadMoreError: null,
  seq: 0,
});

const byUri = (v) => v?.uri;
const byUrl = (l) => l?.url;

// Each loader's `first` reads the first page; `more` the page after `entry`.
// Both resolve to `{ items, cursor }`, plus `saved` for feeds.
const LOADERS = {
  archive: {
    key: byUri,
    first: async (sources) => ({
      items: (await sources.archive()) || [],
      cursor: null,
    }),
  },
  posts: {
    key: byUri,
    first: (sources) => sources.posts({}),
    more: (sources, entry) => sources.posts({ cursor: entry.cursor }),
  },
  replies: {
    key: byUri,
    first: (sources) => sources.replies({}),
    more: (sources, entry) => sources.replies({ cursor: entry.cursor }),
  },
  saved: {
    key: byUri,
    first: (sources) => sources.saved({}),
    more: (sources, entry) => sources.saved({ cursor: entry.cursor }),
  },
  links: {
    key: byUrl,
    first: (sources) => sources.links({}),
    more: (sources, entry) =>
      sources.links({
        cursor: entry.cursor,
        seen: (entry.data?.items || []).map(byUrl),
      }),
  },
  feeds: {
    key: byUri,
    // Saved feeds come with the first page only: one preferences read, not a
    // paged list.
    first: async (sources) => {
      const [own, saved] = await Promise.all([
        sources.feeds({}),
        sources.savedFeeds({}),
      ]);
      return {
        items: own?.items || [],
        cursor: own?.cursor || null,
        saved: saved || [],
      };
    },
    more: (sources, entry) => sources.feeds({ cursor: entry.cursor }),
  },
  lists: {
    key: byUri,
    first: (sources) => sources.lists({}),
    more: (sources, entry) => sources.lists({ cursor: entry.cursor }),
  },
};

function appendUnique(existing, added, key) {
  const seen = new Set(existing.map(key));
  const out = existing.slice();
  for (const item of added || []) {
    const k = key(item);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

// What a failed Load more reports: the failure's own message, or the fallback.
function failureMessage(error, fallback) {
  if (typeof error === 'string' && error) return error;
  return typeof error?.message === 'string' && error.message
    ? error.message
    : fallback;
}

/**
 * A library store: `entry(did, shelfId)`, `ensure`, `retry`, `loadMore`,
 * `hydrateTemplateEmbeds`, `embeds(did)`, `subscribe`, `version()`,
 * `nextOpen()` and `reset(did?)`. `now` is injectable for tests.
 */
export function createLibraryStore({
  now = () => Date.now(),
  staleMs = STALE_MS,
} = {}) {
  // did → { shelves: { [id]: entry }, embeds: Map(uri → view | 'missing'),
  //         embedsAt: Map(uri → ms), embedsPending: Set(uri), checked: { [key]: openId } }
  // Entries, `shelves` and `embeds` are replaced on every change so renders
  // can memoize on them; the rest is bookkeeping nothing renders.
  let accounts = new Map();
  // Bumped by reset() for everyone and by reset(did) for that account alone,
  // so a read in flight for one account isn't stranded by another's reset.
  let generation = 0;
  const accountGenerations = new Map();
  const generationOf = (did) =>
    `${generation}:${accountGenerations.get(did) || 0}`;
  let version = 0;
  let openCounter = 0;
  const listeners = new Set();

  function emit() {
    version += 1;
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        // One broken subscriber must not stop the others re-rendering.
      }
    }
  }

  function accountFor(did) {
    let account = accounts.get(did);
    if (!account) {
      account = {
        shelves: {},
        embeds: new Map(),
        embedsAt: new Map(),
        embedsPending: new Set(),
        checked: {},
      };
      accounts.set(did, account);
    }
    return account;
  }

  const entry = (did, shelfId) =>
    accounts.get(did)?.shelves[shelfId] || IDLE_ENTRY;

  function write(did, shelfId, gen, update) {
    if (gen !== generationOf(did)) return;
    const account = accountFor(did);
    const prev = account.shelves[shelfId] || IDLE_ENTRY;
    const patch = typeof update === 'function' ? update(prev) : update;
    account.shelves = { ...account.shelves, [shelfId]: { ...prev, ...patch } };
    emit();
  }

  /** The first page of a shelf; `background` keeps what is shown while it reads. */
  function load(did, shelfId, sources, { background = false } = {}) {
    const loader = LOADERS[shelfId];
    if (!loader || !did || !sources) return Promise.resolve();
    const gen = generationOf(did);
    const seq = entry(did, shelfId).seq + 1;
    // The new seq turns away any page still in flight, so its loadingMore goes too.
    write(
      did,
      shelfId,
      gen,
      background
        ? { refreshing: true, loadingMore: false, seq }
        : {
            status: 'loading',
            error: null,
            refreshing: false,
            loadingMore: false,
            loadMoreError: null,
            seq,
          },
    );
    const current = () =>
      gen === generationOf(did) && entry(did, shelfId).seq === seq;
    return Promise.resolve()
      .then(() => loader.first(sources))
      .then(
        (page) => {
          if (!current()) return;
          const items = appendUnique([], page?.items, loader.key);
          write(did, shelfId, gen, (prev) => ({
            status: 'ready',
            error: null,
            data: {
              ...(prev.data || {}),
              items,
              ...(page?.saved ? { saved: page.saved } : {}),
            },
            cursor: page?.cursor || null,
            fetchedAt: now(),
            refreshing: false,
            loadingMore: false,
            loadMoreError: null,
          }));
        },
        (error) => {
          if (!current()) return;
          // A failed refresh keeps the copy on screen; the next open tries again.
          write(
            did,
            shelfId,
            gen,
            background
              ? { refreshing: false }
              : {
                  status: 'error',
                  error: error || new Error('Load failed'),
                  refreshing: false,
                },
          );
        },
      );
  }

  function loadMore({ did, shelfId, sources }) {
    const loader = LOADERS[shelfId];
    const e = entry(did, shelfId);
    if (
      !loader?.more ||
      !sources ||
      e.status !== 'ready' ||
      !e.cursor ||
      e.loadingMore ||
      e.refreshing
    )
      return Promise.resolve();
    const gen = generationOf(did);
    const { seq } = e;
    write(did, shelfId, gen, { loadingMore: true, loadMoreError: null });
    const current = () =>
      gen === generationOf(did) && entry(did, shelfId).seq === seq;
    return Promise.resolve()
      .then(() => loader.more(sources, e))
      .then(
        (page) => {
          if (!current()) return;
          write(did, shelfId, gen, (prev) => ({
            data: {
              ...(prev.data || {}),
              items: appendUnique(
                prev.data?.items || [],
                page?.items,
                loader.key,
              ),
            },
            cursor:
              page?.cursor && page.cursor !== prev.cursor ? page.cursor : null,
            loadingMore: false,
            loadMoreError: null,
          }));
        },
        (error) => {
          // The cursor stays, so Load more can be tried again.
          if (current())
            write(did, shelfId, gen, {
              loadingMore: false,
              loadMoreError: failureMessage(error, 'Load failed'),
            });
        },
      );
  }

  /**
   * Loads what isn't loaded. Within one open (`openId`) an entry is looked at
   * once: an error stays until `retry` (a dialog that ensures on every render
   * must not hammer a failing read), and a stale entry is refreshed in the
   * background. An error from an earlier open is tried again.
   */
  function ensure({ did, shelfId, sources, openId }) {
    if (!did || !sources || !LOADERS[shelfId]) return;
    const account = accountFor(did);
    const key = `shelf:${shelfId}`;
    const e = entry(did, shelfId);
    const seenThisOpen = account.checked[key] === openId;
    account.checked[key] = openId;
    if (e.status === 'loading' || e.refreshing) return;
    if (e.status === 'idle') {
      load(did, shelfId, sources);
      return;
    }
    if (seenThisOpen) return;
    if (e.status === 'error') load(did, shelfId, sources);
    else if (!e.loadingMore && now() - e.fetchedAt >= staleMs)
      load(did, shelfId, sources, { background: true });
  }

  function retry({ did, shelfId, sources }) {
    const e = entry(did, shelfId);
    if (!LOADERS[shelfId] || e.status === 'loading' || e.refreshing)
      return Promise.resolve();
    return load(did, shelfId, sources, { background: e.status === 'ready' });
  }

  /**
   * Read the views of what `templates` quote, at most once per five minutes
   * per URI, and keep them under `embeds(did)`. A URI the read couldn't
   * settle keeps what it had.
   */
  function hydrateTemplateEmbeds({ did, sources, templates }) {
    if (!did || !sources) return Promise.resolve();
    const account = accountFor(did);
    const at = now();
    const uris = [];
    for (const template of templates || []) {
      const embed = template?.embed;
      const uri = embed?.$type === RECORD_EMBED ? embed.record?.uri : null;
      if (
        typeof uri !== 'string' ||
        !uri ||
        uris.includes(uri) ||
        account.embedsPending.has(uri)
      )
        continue;
      const seen = account.embedsAt.get(uri);
      if (seen != null && at - seen < staleMs) continue;
      uris.push(uri);
    }
    if (!uris.length) return Promise.resolve();
    const gen = generationOf(did);
    uris.forEach((uri) => account.embedsPending.add(uri));
    return Promise.resolve()
      .then(() => sources.hydrateEmbeds(uris))
      .then(
        (found) => {
          if (gen !== generationOf(did)) return;
          uris.forEach((uri) => account.embedsPending.delete(uri));
          if (!found?.size) return;
          const stamp = now();
          found.forEach((_, uri) => account.embedsAt.set(uri, stamp));
          account.embeds = new Map([...account.embeds, ...found]);
          emit();
        },
        () => {
          if (gen === generationOf(did))
            uris.forEach((uri) => account.embedsPending.delete(uri));
        },
      );
  }

  return {
    entry,
    shelves: (did) => accounts.get(did)?.shelves || null,
    embeds: (did) => accounts.get(did)?.embeds || null,
    ensure,
    retry,
    loadMore,
    hydrateTemplateEmbeds,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    version: () => version,
    /** A fresh id for one opening of the dialog. */
    nextOpen: () => (openCounter += 1),
    reset(did) {
      if (did) {
        accountGenerations.set(did, (accountGenerations.get(did) || 0) + 1);
        accounts.delete(did);
      } else {
        generation += 1;
        accounts = new Map();
      }
      emit();
    },
  };
}

/** The app's library store. */
export const libraryStore = createLibraryStore();

/* ---- shelf items ------------------------------------------------------ */

/**
 * Whether Your posts and Your replies read the archive (`'archive'`), the
 * public author feed (`'feed'`, the archive being empty), or neither yet
 * (`null`, the archive still loading).
 */
export function postsSource(archiveEntry) {
  if (archiveEntry?.status === 'ready')
    return archiveEntry.data?.items?.length ? 'archive' : 'feed';
  if (archiveEntry?.status === 'error') return 'feed';
  return null;
}

/**
 * The items on a shelf from its store entries. `posts` and `replies` take
 * `{ archive, feed }` (the archive entry and the author-feed entry), the rest
 * their own entry. Options: `did` (the account), `sort` ('date' or
 * 'engagement', for posts and replies), `query` (searches the archive's
 * rows) and `limit` (how many archive rows to show).
 * @returns {{ items: object[], total: number | null }}
 */
export function buildShelfItems(
  shelfId,
  entries,
  { did, sort = 'date', query = '', limit = 50 } = {},
) {
  if (shelfId === 'posts' || shelfId === 'replies') {
    const replies = shelfId === 'replies';
    const source = postsSource(entries?.archive);
    if (source === 'archive')
      return archiveShelf(entries.archive.data.items, {
        did,
        replies,
        sort,
        query,
        limit,
      });
    const views = entries?.feed?.data?.items || [];
    const items = views.map((v) =>
      itemFromPost(v, { shelf: shelfId, selfDid: did }),
    );
    return {
      items: sort === 'engagement' ? sortItems(items, 'engagement') : items,
      total: null,
    };
  }
  const data = entries?.data;
  if (!data) return { items: [], total: null };
  const views = data.items || [];
  switch (shelfId) {
    case 'saved':
      return {
        items: views.map((v) =>
          itemFromPost(v, { shelf: 'saved', selfDid: did }),
        ),
        total: null,
      };
    case 'links':
      return { items: views.map((l) => itemFromLink(l)), total: null };
    case 'feeds': {
      const own = dedupeById(
        views.map((v) => itemFromFeed(v, { group: 'yours' })),
      );
      const saved = dedupeById(
        (data.saved || []).map((v) => itemFromFeed(v, { group: 'saved' })),
        new Set(own.map((i) => i.id)),
      );
      return { items: [...own, ...saved], total: null };
    }
    case 'lists':
      return { items: views.map((v) => itemFromList(v)), total: null };
    default:
      return { items: [], total: null };
  }
}

const groupOf = (template) => String(template?.group || '').trim();

const templateEmbedUri = (template) =>
  template?.embed?.$type === RECORD_EMBED &&
  typeof template.embed.record?.uri === 'string'
    ? template.embed.record.uri
    : null;

/**
 * The Templates shelf: every template as an item (offered here first, then
 * the rest), and the same items in sections under their group headings,
 * with the templates not offered here in a muted section of their own.
 * @returns {{ items: object[], sections: Array<{ id, heading, muted, items }> }}
 */
export function templateShelf(
  templates,
  { usage, context, embeds, replying = false } = {},
) {
  const sorted = sortTemplatesForShelf(templates, usage);
  const toItem = (t) => {
    const uri = templateEmbedUri(t);
    return itemFromTemplate(t, context, {
      embedView: uri ? embeds?.get(uri) : undefined,
    });
  };
  const offered = [];
  const rest = [];
  for (const t of sorted)
    (templateOffered(t, { replying }) ? offered : rest).push(toItem(t));

  const sections = [];
  const anyGroup = offered.some((i) => groupOf(i.source));
  let lastGroup = null;
  for (const item of offered) {
    const group = groupOf(item.source);
    if (sections.length && group === lastGroup) {
      sections[sections.length - 1].items.push(item);
      continue;
    }
    lastGroup = group;
    sections.push({
      id: group ? `group:${group}` : 'ungrouped',
      // Ungrouped templates sort last; with groups above them they need a
      // heading of their own, or they read as part of the last group.
      heading: group || (anyGroup ? 'Other templates' : null),
      muted: false,
      items: [item],
    });
  }
  if (rest.length) {
    sections.push({
      id: 'elsewhere',
      heading: replying ? 'For new posts' : 'For replies',
      muted: true,
      items: rest,
    });
  }
  return { items: [...offered, ...rest], sections };
}

/** The query remote search runs for, or '' when it shouldn't run (too short, or a "/shortcut"). */
export function remoteQueryFor(query, minChars = 2) {
  const q = String(query || '').trim();
  return q.length >= minChars && !q.startsWith('/') ? q : '';
}
