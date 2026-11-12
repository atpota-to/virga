/**
 * Everything behind the library dialog, with no markup: the shelves and their
 * items, suggestions for a reply, search, what each template quotes, use
 * counts, and turning a pick into a plan the composer can carry out.
 *
 *   const lib = useLibrary({ did, isOpen, reply, selfHandle, quoteSlotLocked })
 *
 * `did` is the account the post is written as: its templates, its archive,
 * its saved posts. Shelf data lives in libraryStore (store.js), keyed by DID,
 * because the hook unmounts with the dialog and reopening it should show what
 * was there at once. Shelves load when the dialog asks for them (`ensure`).
 * Use counts are read once per opening, so using a template doesn't reshuffle
 * the shelf as the dialog closes.
 *
 * Returns:
 *   shelves                 [{ id, label, count, total, status, error, refreshing, loadingMore, loadMoreError }]
 *   items(shelfId)          the shelf's items ('search' is the Bluesky search results)
 *   templateSections()      the Templates shelf under its group headings
 *   ensure, retry, hasMore, loadMore (shelfId)
 *   sort, setSort           'date' | 'engagement', for Your posts and Your replies
 *   suggested               { status, items } for "For this reply"
 *   search                  { query, setQuery, local, localStatus, remote, mine, setMine }
 *   templates               useTemplates' value
 *   context                 the template context (who is replied to, the handle, today)
 *   planFor(item, answers)  a LibraryPlan, its attachment read again (cid, view)
 *   hydrate(item)           the item read again (hydratePick)
 *   resolveLink(text)       a pasted link as an item, or null
 *
 * Using a template is counted by the composer as it applies the plan (every
 * way in reaches it there), so nothing here counts one.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useAtprotoSession } from '../../session/useAtprotoSession.jsx';
import { useTemplates } from '../templates/useTemplates.js';
import { readTemplateUsage } from '../templates/templateUsage.js';
import {
  applyPlanFor,
  dedupeById,
  itemFromPost,
  libraryContext,
  previewFor,
  searchItems,
  shelvesFor,
  suggestItems,
} from './model.js';
import { archiveShelf, librarySources } from './sources.js';
import {
  IDLE_ENTRY,
  buildShelfItems,
  libraryStore,
  postsSource,
  remoteQueryFor,
  templateShelf,
} from './store.js';

const SEARCH_DEBOUNCE_MS = 400;
const SUGGESTION_LIMIT = 5;
// How many archive rows a shelf shows at first, and how many more each Load more adds.
const ARCHIVE_PAGE = 50;
// The recent posts "For this reply" compares the parent with. More would let
// one topic the account posts about all the time count as "common".
const SUGGESTION_POSTS = 200;
// Searching an archive returns at most this many of each kind of post.
const ARCHIVE_SEARCH_LIMIT = 50;

// What searching reads, besides the templates.
const SEARCH_SHELVES = ['archive', 'saved', 'links', 'feeds', 'lists'];

const EMPTY = Object.freeze([]);
const EMPTY_EMBEDS = new Map();
const SUGGESTED_LOADING = Object.freeze({ status: 'loading', items: EMPTY });
const SUGGESTED_NONE = Object.freeze({ status: 'ready', items: EMPTY });

const REMOTE_IDLE = Object.freeze({
  query: '',
  posts: EMPTY,
  cursor: null,
  status: 'idle',
  error: null,
  loadingMore: false,
  loadMoreError: null,
});

const settled = (status) => status === 'ready' || status === 'error';

export function useLibrary({
  did,
  isOpen = true,
  reply = null,
  selfHandle,
  quoteSlotLocked = false,
  sources: givenSources,
  store = libraryStore,
} = {}) {
  const { agentFor, accounts } = useAtprotoSession();
  const replying = !!reply?.uri;
  const templates = useTemplates(did, { enabled: !!did });

  const handle =
    selfHandle || accounts?.find?.((a) => a.did === did)?.handle || null;

  const sources = useMemo(
    () =>
      givenSources ||
      (did ? librarySources({ did, agent: (d) => agentFor(d), handle }) : null),
    [givenSources, did, agentFor, handle],
  );

  useSyncExternalStore(store.subscribe, store.version, store.version);
  const shelvesState = did ? store.shelves(did) : null;

  // One id per opening, assigned while rendering because the dialog's
  // effects (which call ensure) run before this hook's own.
  const openRef = useRef(null);
  if (isOpen && openRef.current == null) openRef.current = store.nextOpen();
  else if (!isOpen && openRef.current != null) openRef.current = null;
  const openId = openRef.current;

  // Read by the stable callbacks, so they act for the account and the opening on screen.
  const liveRef = useRef(null);
  liveRef.current = { did, sources, openId, isOpen, store, handle };

  const authorName = reply?.author?.displayName;
  const authorHandle = reply?.author?.handle;
  const context = useMemo(
    () => libraryContext({ reply, selfHandle: handle, now: new Date() }),
    // The reply is read only for its author and text; `today` is fixed per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [replying, authorName, authorHandle, reply?.text, handle, openId],
  );

  const usage = useMemo(
    () => readTemplateUsage(did),
    // Read once per opening, so a use doesn't reorder the shelf as it closes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [did, openId],
  );

  /* ---- shelves -------------------------------------------------------- */

  const entryOf = useCallback(
    (id) => shelvesState?.[id] || IDLE_ENTRY,
    [shelvesState],
  );

  const ensureStoreShelf = useCallback((shelfId) => {
    const live = liveRef.current;
    if (!live.did || !live.isOpen) return;
    live.store.ensure({
      did: live.did,
      shelfId,
      sources: live.sources,
      openId: live.openId,
    });
  }, []);

  // Your posts and Your replies read the archive first, and the author feed
  // only when it turns out empty.
  const archiveEntry = entryOf('archive');
  const postsFrom = postsSource(archiveEntry);
  const [wantsFeed, setWantsFeed] = useState(() => new Set());

  const ensure = useCallback(
    (shelfId) => {
      if (shelfId === 'suggested') {
        ['archive', 'feeds', 'lists'].forEach(ensureStoreShelf);
        setWantsFeed((s) => (s.has('posts') ? s : new Set([...s, 'posts'])));
      } else if (shelfId === 'posts' || shelfId === 'replies') {
        ensureStoreShelf('archive');
        setWantsFeed((s) => (s.has(shelfId) ? s : new Set([...s, shelfId])));
      } else if (shelfId !== 'templates' && shelfId !== 'search')
        ensureStoreShelf(shelfId);
    },
    [ensureStoreShelf],
  );

  useEffect(() => {
    if (postsFrom !== 'feed') return;
    for (const shelfId of wantsFeed) ensureStoreShelf(shelfId);
  }, [postsFrom, wantsFeed, ensureStoreShelf, openId]);

  const [sort, setSortState] = useState('date');
  const [visible, setVisible] = useState({
    posts: ARCHIVE_PAGE,
    replies: ARCHIVE_PAGE,
  });
  const setSort = useCallback(
    (next) => setSortState(next === 'engagement' ? 'engagement' : 'date'),
    [],
  );

  const templatesReload = templates.reload;
  const retry = useCallback(
    (shelfId) => {
      const live = liveRef.current;
      if (shelfId === 'templates') {
        templatesReload();
        return;
      }
      if (!live.did) return;
      const ids =
        shelfId === 'suggested'
          ? ['archive', 'feeds', 'lists']
          : shelfId === 'posts' || shelfId === 'replies'
            ? postsFrom === 'feed'
              ? [shelfId]
              : ['archive']
            : [shelfId];
      for (const id of ids)
        live.store.retry({ did: live.did, shelfId: id, sources: live.sources });
    },
    [templatesReload, postsFrom],
  );

  // Each shelf's items are rebuilt only when its own entries move: entries
  // are replaced on every change, so an unchanged shelf keeps its identity
  // (and the archive isn't sorted again) when another shelf loads.
  const postsFeed = entryOf('posts');
  const repliesFeed = entryOf('replies');
  const savedEntry = entryOf('saved');
  const linksEntry = entryOf('links');
  const feedsEntry = entryOf('feeds');
  const listsEntry = entryOf('lists');
  const postsItems = useMemo(
    () =>
      buildShelfItems(
        'posts',
        { archive: archiveEntry, feed: postsFeed },
        { did, sort, limit: visible.posts },
      ),
    [archiveEntry, postsFeed, did, sort, visible.posts],
  );
  const repliesItems = useMemo(
    () =>
      buildShelfItems(
        'replies',
        { archive: archiveEntry, feed: repliesFeed },
        { did, sort, limit: visible.replies },
      ),
    [archiveEntry, repliesFeed, did, sort, visible.replies],
  );
  const savedItems = useMemo(
    () => buildShelfItems('saved', savedEntry, { did }),
    [savedEntry, did],
  );
  const linksItems = useMemo(
    () => buildShelfItems('links', linksEntry, { did }),
    [linksEntry, did],
  );
  const feedsItems = useMemo(
    () => buildShelfItems('feeds', feedsEntry, { did }),
    [feedsEntry, did],
  );
  const listsItems = useMemo(
    () => buildShelfItems('lists', listsEntry, { did }),
    [listsEntry, did],
  );
  const shelfItems = useMemo(
    () => ({
      posts: postsItems,
      replies: repliesItems,
      saved: savedItems,
      links: linksItems,
      feeds: feedsItems,
      lists: listsItems,
    }),
    [postsItems, repliesItems, savedItems, linksItems, feedsItems, listsItems],
  );

  const hasMore = useCallback(
    (shelfId) => {
      if (shelfId === 'search') return false;
      if (
        (shelfId === 'posts' || shelfId === 'replies') &&
        postsFrom === 'archive'
      ) {
        return (
          (shelfItems[shelfId]?.total || 0) > shelfItems[shelfId]?.items.length
        );
      }
      const e = entryOf(shelfId);
      return e.status === 'ready' && !!e.cursor;
    },
    [postsFrom, shelfItems, entryOf],
  );

  const loadMore = useCallback(
    (shelfId) => {
      const live = liveRef.current;
      if (!live.did) return;
      if (
        (shelfId === 'posts' || shelfId === 'replies') &&
        postsFrom === 'archive'
      ) {
        setVisible((v) => ({ ...v, [shelfId]: v[shelfId] + ARCHIVE_PAGE }));
        return;
      }
      live.store.loadMore({ did: live.did, shelfId, sources: live.sources });
    },
    [postsFrom],
  );

  const embeds = (did && store.embeds(did)) || EMPTY_EMBEDS;
  const templateList = templates.templates;
  const templateData = useMemo(
    () => templateShelf(templateList, { usage, context, embeds, replying }),
    [templateList, usage, context, embeds, replying],
  );

  /* ---- suggestions ---------------------------------------------------- */

  useEffect(() => {
    if (isOpen && replying && did) ensure('suggested');
  }, [isOpen, replying, did, openId, ensure]);

  const templatesSettled = templates.ready || !!templates.error;
  const suggestionPosts = useMemo(() => {
    if (postsFrom === 'archive')
      return archiveShelf(archiveEntry.data.items, {
        did,
        limit: SUGGESTION_POSTS,
      }).items;
    return shelfItems.posts.items;
  }, [postsFrom, archiveEntry, did, shelfItems]);
  const sourcesSettled =
    templatesSettled &&
    settled(archiveEntry.status) &&
    (postsFrom !== 'feed' || settled(postsFeed.status)) &&
    settled(feedsEntry.status) &&
    settled(listsEntry.status);
  const replyKey = replying ? reply.uri : '';

  // Computed once per opening, then frozen, so the shelf doesn't reshuffle
  // under the writer when a refresh or a new template lands.
  const frozenRef = useRef(null);
  const frozenFits = (f) =>
    !!f && f.openId === openId && f.replyKey === replyKey && f.did === did;
  if (
    replying &&
    isOpen &&
    did &&
    sourcesSettled &&
    !frozenFits(frozenRef.current)
  ) {
    const usableHere = (item) =>
      previewFor(item, { context, quoteSlotLocked }).usable;
    const picked = suggestItems({
      templates: templateData.items.filter(usableHere),
      posts: quoteSlotLocked ? EMPTY : suggestionPosts,
      feeds: quoteSlotLocked ? EMPTY : shelfItems.feeds.items,
      lists: quoteSlotLocked ? EMPTY : shelfItems.lists.items,
      parentText: reply?.text || '',
      parentUri: reply?.uri,
      limit: SUGGESTION_LIMIT,
      context,
      selfDid: did,
    });
    frozenRef.current = {
      openId,
      replyKey,
      did,
      picked: picked.map((i) => ({ ...i, shelf: 'suggested' })),
    };
  }
  const frozen =
    replying && frozenFits(frozenRef.current) ? frozenRef.current : null;

  const templatesById = useMemo(
    () => new Map(templateData.items.map((i) => [i.id, i])),
    [templateData.items],
  );
  const suggested = useMemo(() => {
    if (!replying) return SUGGESTED_NONE;
    if (!frozen) return SUGGESTED_LOADING;
    // The order and reasons are frozen; a template follows its shelf, so a
    // quote hydrated later still shows, and one deleted meanwhile drops out.
    const items = frozen.picked
      .map((s) => {
        if (s.kind !== 'template') return s;
        const current = templatesById.get(s.id);
        return current
          ? { ...current, shelf: 'suggested', reason: s.reason }
          : null;
      })
      .filter(Boolean);
    return { status: 'ready', items };
  }, [replying, frozen, templatesById]);

  /* ---- search --------------------------------------------------------- */

  const [query, setQueryState] = useState('');
  const [mine, setMineState] = useState(false);
  const [remote, setRemote] = useState(REMOTE_IDLE);
  const searchRef = useRef({
    query: '',
    mine: false,
    token: 0,
    pending: false,
    failed: null,
  });
  searchRef.current.query = query;
  searchRef.current.mine = mine;

  const runSearch = useCallback((q) => {
    const live = searchRef.current;
    const token = ++live.token;
    live.failed = null;
    setRemote({ ...REMOTE_IDLE, query: q, status: 'loading' });
    Promise.resolve()
      .then(() => liveRef.current.sources.search(q, { mine: live.mine }))
      .then(
        (res) => {
          if (token !== live.token) return;
          setRemote((r) => ({
            ...r,
            posts: res?.items || EMPTY,
            cursor: res?.cursor || null,
            status: 'ready',
          }));
        },
        (error) => {
          if (token !== live.token) return;
          live.failed = q;
          setRemote((r) => ({
            ...r,
            status: 'error',
            error: error || new Error('Search failed'),
          }));
        },
      );
  }, []);

  const stopSearch = useCallback(() => {
    searchRef.current.token += 1;
    searchRef.current.failed = null;
    setRemote((r) => (r === REMOTE_IDLE ? r : REMOTE_IDLE));
  }, []);

  const retrySearch = useCallback(() => {
    const live = searchRef.current;
    const q = remoteQueryFor(live.query);
    if (!q || live.pending || !liveRef.current.isOpen || !liveRef.current.did)
      return;
    if (live.failed === q) runSearch(q);
  }, [runSearch]);

  useEffect(() => {
    const live = searchRef.current;
    const trimmed = query.trim();
    const remoteQuery = remoteQueryFor(query);
    if (!isOpen || !did || !remoteQuery) {
      live.pending = false;
      stopSearch();
    }
    if (!isOpen || !did || !trimmed || trimmed.startsWith('/'))
      return undefined;
    live.pending = !!remoteQuery;
    const timer = setTimeout(() => {
      live.pending = false;
      SEARCH_SHELVES.forEach(ensureStoreShelf);
      if (remoteQuery) runSearch(remoteQuery);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      live.pending = false;
    };
  }, [query, isOpen, did, stopSearch, runSearch, ensureStoreShelf]);

  const setQuery = useCallback((value) => {
    setQueryState((prev) => {
      const next = typeof value === 'function' ? value(prev) : value;
      return typeof next === 'string' ? next : '';
    });
  }, []);

  const setMine = useCallback(
    (value) => {
      const prev = searchRef.current.mine;
      const next = !!(typeof value === 'function' ? value(prev) : value);
      if (next === prev) return;
      searchRef.current.mine = next;
      setMineState(next);
      const q = remoteQueryFor(searchRef.current.query);
      if (
        q &&
        !searchRef.current.pending &&
        liveRef.current.isOpen &&
        liveRef.current.did
      )
        runSearch(q);
    },
    [runSearch],
  );

  const loadMoreSearch = useCallback(() => {
    if (remote.status !== 'ready' || !remote.cursor || remote.loadingMore)
      return;
    const token = searchRef.current.token;
    const { query: q, cursor } = remote;
    setRemote((r) => ({ ...r, loadingMore: true, loadMoreError: null }));
    Promise.resolve()
      .then(() =>
        liveRef.current.sources.search(q, {
          mine: searchRef.current.mine,
          cursor,
        }),
      )
      .then(
        (res) => {
          if (token !== searchRef.current.token) return;
          setRemote((r) => {
            const seen = new Set(r.posts.map((p) => p.uri));
            return {
              ...r,
              posts: [
                ...r.posts,
                ...(res?.items || []).filter((p) => p?.uri && !seen.has(p.uri)),
              ],
              cursor: res?.cursor && res.cursor !== cursor ? res.cursor : null,
              loadingMore: false,
            };
          });
        },
        (error) => {
          if (token !== searchRef.current.token) return;
          setRemote((r) => ({
            ...r,
            loadingMore: false,
            loadMoreError: error?.message || 'Search failed',
          }));
        },
      );
  }, [remote]);

  const trimmedQuery = query.trim();
  const local = useMemo(() => {
    if (!trimmedQuery) return EMPTY;
    const listed = [
      ...templateData.items,
      ...shelfItems.saved.items,
      ...shelfItems.links.items,
      ...shelfItems.feeds.items,
      ...shelfItems.lists.items,
    ];
    if (trimmedQuery.startsWith('/'))
      return searchItems(listed, trimmedQuery, { replying });
    // The archive is searched whole, not only the rows shown.
    const posts =
      postsFrom === 'archive'
        ? [
            ...archiveShelf(archiveEntry.data.items, {
              did,
              query: trimmedQuery,
              limit: ARCHIVE_SEARCH_LIMIT,
            }).items,
            ...archiveShelf(archiveEntry.data.items, {
              did,
              replies: true,
              query: trimmedQuery,
              limit: ARCHIVE_SEARCH_LIMIT,
            }).items,
          ]
        : searchItems(
            [...shelfItems.posts.items, ...shelfItems.replies.items],
            trimmedQuery,
          );
    return dedupeById([
      ...searchItems(listed, trimmedQuery, { replying }),
      ...posts,
    ]);
  }, [
    trimmedQuery,
    templateData.items,
    shelfItems,
    replying,
    postsFrom,
    archiveEntry,
    did,
  ]);

  const remoteItems = useMemo(
    () =>
      dedupeById(
        remote.posts.map((v) =>
          itemFromPost(v, { shelf: 'search', selfDid: did }),
        ),
        new Set(local.map((i) => i.id)),
      ),
    [remote.posts, local, did],
  );

  // Whether `local` is all there: 'loading' while something it searches is
  // still to land, so the dialog doesn't take what has landed for the whole
  // answer. A "/" query searches templates only.
  let localStatus = 'ready';
  if (isOpen && did && trimmedQuery) {
    const shortcut = trimmedQuery.startsWith('/');
    const shelfPending =
      !shortcut &&
      SEARCH_SHELVES.some(
        (id) =>
          !settled((id === 'archive' ? archiveEntry : entryOf(id)).status),
      );
    if (!templatesSettled || shelfPending) localStatus = 'loading';
  }

  const search = useMemo(
    () => ({
      query,
      setQuery,
      local,
      localStatus,
      remote: {
        query: remote.query,
        status: remote.status,
        error: remote.error,
        posts: remoteItems,
        hasMore: remote.status === 'ready' && !!remote.cursor,
        loadingMore: remote.loadingMore,
        loadMoreError: remote.loadMoreError,
        loadMore: loadMoreSearch,
        retry: retrySearch,
      },
      mine,
      setMine,
    }),
    [
      query,
      setQuery,
      local,
      localStatus,
      remote,
      remoteItems,
      loadMoreSearch,
      retrySearch,
      mine,
      setMine,
    ],
  );

  /* ---- shelf summaries ------------------------------------------------ */

  let templatesStatus = 'loading';
  if (!did) templatesStatus = 'idle';
  else if (templates.ready || templateList.length) templatesStatus = 'ready';
  else if (templates.error) templatesStatus = 'error';

  const shelves = useMemo(
    () =>
      shelvesFor({ replying }).map(({ id, label }) => {
        const summary = (e, items, total = null) => ({
          id,
          label,
          count: e.data || e.status === 'ready' ? items.length : null,
          total,
          status: e.status,
          error: e.error || null,
          refreshing: !!e.refreshing,
          loadingMore: !!e.loadingMore,
          loadMoreError: e.loadMoreError || null,
        });
        if (id === 'suggested') {
          return {
            ...summary({ status: suggested.status }, suggested.items),
            count: suggested.status === 'ready' ? suggested.items.length : null,
          };
        }
        if (id === 'templates') {
          return {
            ...summary(
              { status: templatesStatus, error: templates.error },
              templateData.items,
            ),
            count:
              templatesStatus === 'ready' ? templateData.items.length : null,
            refreshing: templatesStatus === 'ready' && templates.loading,
          };
        }
        if (id === 'search')
          return summary(
            {
              status: remote.status,
              error: remote.error,
              loadingMore: remote.loadingMore,
              loadMoreError: remote.loadMoreError,
            },
            remoteItems,
          );
        if (id === 'posts' || id === 'replies') {
          const e = postsFrom === 'feed' ? entryOf(id) : archiveEntry;
          return summary(e, shelfItems[id].items, shelfItems[id].total);
        }
        return summary(entryOf(id), shelfItems[id].items);
      }),
    [
      replying,
      suggested,
      templatesStatus,
      templates.error,
      templates.loading,
      templateData.items,
      remote,
      remoteItems,
      postsFrom,
      entryOf,
      archiveEntry,
      shelfItems,
    ],
  );

  const items = useCallback(
    (shelfId) => {
      switch (shelfId) {
        case 'suggested':
          return suggested.items;
        case 'templates':
          return templateData.items;
        case 'search':
          return remoteItems;
        case 'posts':
        case 'replies':
        case 'saved':
        case 'links':
        case 'feeds':
        case 'lists':
          return shelfItems[shelfId].items;
        default:
          return EMPTY;
      }
    },
    [suggested, templateData.items, remoteItems, shelfItems],
  );

  const templateSections = useCallback(
    () => templateData.sections,
    [templateData.sections],
  );

  /* ---- template embeds ------------------------------------------------ */

  useEffect(() => {
    if (!isOpen || !did || !sources || !templateList.length) return;
    store.hydrateTemplateEmbeds({ did, sources, templates: templateList });
  }, [isOpen, did, sources, templateList, store, openId]);

  /* ---- using an item -------------------------------------------------- */

  const hydrate = useCallback(
    (item, opts) => liveRef.current.sources.hydrate(item, opts),
    [],
  );

  const planFor = useCallback(
    async (item, answers = {}, { signal } = {}) => {
      const plan = applyPlanFor(item, { context, answers, quoteSlotLocked });
      if (plan.attach && plan.attach.kind !== 'link') {
        plan.attach = await liveRef.current.sources.hydrateAttachment(
          plan.attach,
          { signal },
        );
      }
      return plan;
    },
    [context, quoteSlotLocked],
  );

  const resolveLink = useCallback(
    (text, opts) => liveRef.current.sources.resolveLink(text, opts),
    [],
  );

  return useMemo(
    () => ({
      did,
      replying,
      context,
      quoteSlotLocked: !!quoteSlotLocked,
      shelves,
      items,
      templateSections,
      ensure,
      retry,
      hasMore,
      loadMore,
      sort,
      setSort,
      postsFrom,
      suggested,
      search,
      templates,
      templateEmbeds: embeds,
      hydrate,
      planFor,
      resolveLink,
    }),
    [
      did,
      replying,
      context,
      quoteSlotLocked,
      shelves,
      items,
      templateSections,
      ensure,
      retry,
      hasMore,
      loadMore,
      sort,
      setSort,
      postsFrom,
      suggested,
      search,
      templates,
      embeds,
      hydrate,
      planFor,
      resolveLink,
    ],
  );
}

export default useLibrary;
