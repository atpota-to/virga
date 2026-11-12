import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bookmark,
  FileText,
  Link2,
  List,
  MessageSquare,
  Rss,
  Search,
  Sparkles,
  LayoutTemplate,
  RefreshCw,
  X,
} from 'lucide-react';
import Button from '../../components/Button.jsx';
import Segmented from '../../components/Segmented.jsx';
import { useIsNarrow } from '../../shell/bits.jsx';
import PostPreview from '../ui/PostPreview.jsx';
import { templateQuestions } from '../templates/postTemplates.js';
import { effectFor, previewFor, verbFor } from './model.js';
import { SHELF_EMPTY, SHELF_HINT, looksLikeLink, moveActive, sectionsFor } from './libraryUi.js';
import TemplateQuestions, { TemplatePreview } from './TemplateQuestions.jsx';
import './library.css';

const SHELF_ICONS = {
  suggested: Sparkles,
  templates: LayoutTemplate,
  posts: FileText,
  replies: MessageSquare,
  saved: Bookmark,
  links: Link2,
  feeds: Rss,
  lists: List,
  search: Search,
};

const SORTS = [
  { value: 'date', label: 'Newest' },
  { value: 'engagement', label: 'Most engagement' },
];

function errorText(err) {
  if (!err) return '';
  if (err.code === 'GONE') return err.message || 'That isn’t there any more.';
  return err.message ? `Couldn’t read it: ${err.message}` : 'Couldn’t read it. Try again.';
}

/** Rows shaped like the list, while a shelf loads. */
export function LibrarySkeleton({ rows = 5 }) {
  return (
    <ul className="lib-skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="lib-skeleton-row">
          <span className="lib-bone lib-bone--title" style={{ width: `${[72, 56, 80, 48, 64][i % 5]}%` }} />
          <span className="lib-bone lib-bone--line" style={{ width: `${[40, 32, 46, 28, 36][i % 5]}%` }} />
        </li>
      ))}
    </ul>
  );
}

function ItemRow({ item, id, active, selected, onPick }) {
  const thumb = item.media?.thumb;
  return (
    <li
      id={id}
      role="option"
      aria-selected={selected}
      className="lib-row"
      data-active={active || undefined}
      onClick={onPick}
    >
      {thumb && <img className="lib-row-thumb" src={thumb} alt="" loading="lazy" />}
      <span className="lib-row-text">
        <span className="lib-row-title">
          {item.title}
          {item.shortcut && <span className="lib-row-shortcut mono">{item.shortcut}</span>}
        </span>
        {item.reason ? (
          <span className="lib-row-reason">{item.reason}</span>
        ) : (
          item.label && <span className="lib-row-label">{item.label}</span>
        )}
        {item.excerpt && <span className="lib-row-excerpt">{item.excerpt}</span>}
      </span>
    </li>
  );
}

function ShelfStatus({ shelf, onRetry }) {
  if (!shelf || shelf.status !== 'error') return null;
  return (
    <div className="callout callout--danger lib-status" role="alert">
      <span>{errorText(shelf.error) || 'This shelf couldn’t be read.'}</span>
      <Button size="sm" onClick={onRetry}>
        <RefreshCw size={14} aria-hidden="true" />
        Try again
      </Button>
    </div>
  );
}

/**
 * The library's browsing UI, shared by the dialog the composer opens and the
 * Library page: the shelves, a search box that also reads a pasted link, a
 * list the arrow keys move through, and the chosen item's detail with what
 * using it does. Templates ask their questions in the detail before they are
 * used.
 *
 * `lib` is useLibrary's value. `onUse(item, answers)` acts on a choice and
 * may return a promise (the button shows busy until it settles; a rejection
 * is shown under it). `state`, `postIndex` and `insertion` are the post
 * being written, for the preview; `verb` overrides the use button's words.
 */
export default function LibraryPanel({
  lib,
  onUse,
  mode = 'dialog',
  state = null,
  postIndex = 0,
  insertion = null,
  initialShelf = 'templates',
  focusTemplate = null,
  verb = null,
  onNewTemplate = null,
}) {
  const uid = useId();
  const narrow = useIsNarrow('(max-width: 760px)');
  const [shelfId, setShelfId] = useState(initialShelf);
  const [activeId, setActiveId] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [phoneDetail, setPhoneDetail] = useState(false);
  const [using, setUsing] = useState(null);
  const [useError, setUseError] = useState(null);
  const [hydrated, setHydrated] = useState(() => new Map());
  const [pasted, setPasted] = useState({ text: '', status: 'idle', item: null });
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const detailRef = useRef(null);
  const search = lib.search;
  const query = search.query;
  const trimmed = query.trim();
  const replying = lib.replying;

  const shelves = lib.shelves;
  const shelf = shelves.find((s) => s.id === shelfId) || shelves[0];

  const { ensure } = lib;
  useEffect(() => {
    if (shelf?.id) ensure(shelf.id);
  }, [shelf?.id, ensure]);

  // A pasted link is read as the item it names, a moment after typing stops.
  const resolveLink = lib.resolveLink;
  useEffect(() => {
    if (!looksLikeLink(trimmed)) {
      setPasted((p) => (p.status === 'idle' ? p : { text: '', status: 'idle', item: null }));
      return undefined;
    }
    let live = true;
    setPasted({ text: trimmed, status: 'loading', item: null });
    const timer = setTimeout(() => {
      Promise.resolve(resolveLink(trimmed))
        .then((item) => live && setPasted({ text: trimmed, status: item ? 'ready' : 'none', item: item || null }))
        .catch(() => live && setPasted({ text: trimmed, status: 'none', item: null }));
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [trimmed, resolveLink]);

  // A template asked for by its rkey (the slash menu's "open the library on it").
  const templateItems = lib.items('templates');
  useEffect(() => {
    if (!focusTemplate) return;
    const found = templateItems.find((i) => i.source?.rkey === focusTemplate);
    if (found) {
      setShelfId('templates');
      setActiveId(found.id);
      setSelectedId(found.id);
      if (narrow) setPhoneDetail(true);
    }
    // Only once the templates have landed, and only for the asked one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusTemplate, templateItems.length]);

  const searching = trimmed.length > 0;
  const sections = useMemo(() => {
    if (searching) {
      const out = [];
      if (pasted.item) out.push({ id: 'pasted', heading: 'From the link', items: [pasted.item] });
      if (search.local.length) out.push({ id: 'local', heading: 'In your library', items: search.local });
      if (search.remote.posts.length)
        out.push({ id: 'remote', heading: search.mine ? 'Your posts on Bluesky' : 'On Bluesky', items: search.remote.posts });
      return out;
    }
    if (shelf?.id === 'search') return [];
    return sectionsFor(shelf?.id, lib.items(shelf?.id), {
      templateSections: shelf?.id === 'templates' ? lib.templateSections() : null,
    });
  }, [searching, pasted.item, search.local, search.remote.posts, search.mine, shelf?.id, lib]);

  const flat = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const s of sections)
      for (const item of s.items)
        if (!seen.has(item.id)) {
          seen.add(item.id);
          out.push(item);
        }
    return out;
  }, [sections]);
  const ids = flat.map((i) => i.id);
  const optionId = (itemId) => `${uid}-opt-${ids.indexOf(itemId)}`;

  const selected = flat.find((i) => i.id === selectedId) || (narrow ? null : flat.find((i) => i.id === activeId)) || null;
  const shown = selected ? hydrated.get(selected.id) || selected : null;

  // On a wide screen the active row is the one shown, so keep one active.
  useEffect(() => {
    if (narrow) return;
    if (!ids.length) {
      if (activeId) setActiveId(null);
      return;
    }
    if (!ids.includes(activeId)) setActiveId(ids[0]);
  }, [narrow, ids, activeId]);

  // A post, feed or list is read again when it's shown, for its full text and its card.
  const hydrate = lib.hydrate;
  useEffect(() => {
    if (!shown || shown === hydrated.get(shown.id)) return undefined;
    if (!['post', 'feed', 'list'].includes(shown.kind) || (shown.view && shown.cid)) return undefined;
    let live = true;
    Promise.resolve(hydrate(shown))
      .then((fresh) => live && fresh && setHydrated((m) => new Map(m).set(shown.id, { ...fresh, id: shown.id })))
      .catch((err) => live && setHydrated((m) => new Map(m).set(shown.id, { ...shown, hydrateError: err })));
    return () => {
      live = false;
    };
  }, [shown, hydrate, hydrated]);

  useEffect(() => {
    setUseError(null);
  }, [selectedId, activeId]);

  // The active row stays in view as the arrow keys move it.
  useEffect(() => {
    if (!activeId || !listRef.current) return;
    const el = listRef.current.querySelector(`[id="${optionId(activeId)}"]`);
    el?.scrollIntoView?.({ block: 'nearest' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const choose = useCallback(
    (item, { focusDetail = false } = {}) => {
      setActiveId(item.id);
      setSelectedId(item.id);
      if (narrow) setPhoneDetail(true);
      if (focusDetail || narrow) {
        setTimeout(() => {
          const target =
            detailRef.current?.querySelector('[data-detail-focus]') ||
            detailRef.current?.querySelector('input, [role="radio"][aria-checked="true"], button.btn--primary');
          target?.focus();
        }, 0);
      }
    },
    [narrow],
  );

  const onListKey = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
      if (!ids.length) return;
      // Home and End belong to the text in the search box.
      if ((e.key === 'Home' || e.key === 'End') && e.currentTarget === inputRef.current) return;
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : e.key === 'Home' ? 'first' : 'last';
      const next = moveActive(ids, activeId, delta);
      setActiveId(next);
      if (!narrow) setSelectedId(next);
      return;
    }
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.nativeEvent?.isComposing) {
      const item = flat.find((i) => i.id === activeId);
      if (!item) return;
      e.preventDefault();
      choose(item, { focusDetail: true });
    }
  };

  const onSearchKey = (e) => {
    if (e.key === 'Escape' && query) {
      // A first Escape clears the search; the next one closes the dialog.
      e.preventDefault();
      e.stopPropagation();
      search.setQuery('');
      return;
    }
    onListKey(e);
  };

  const applyItem = async (item, answers = {}) => {
    if (!item || using) return;
    setUsing(item.id);
    setUseError(null);
    try {
      await onUse?.(item, answers);
    } catch (err) {
      setUseError(errorText(err) || 'That couldn’t be added. Try again.');
    } finally {
      setUsing(null);
    }
  };

  const onRootKey = (e) => {
    // Ctrl or Cmd+Enter belongs to the library while it's open: the
    // composer behind it would otherwise post.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.stopPropagation();
      e.preventDefault();
      if (shown && shown.kind !== 'template') applyItem(shown);
    }
  };

  const pickShelf = (id) => {
    setShelfId(id);
    setSelectedId(null);
    setActiveId(null);
    setPhoneDetail(false);
    if (search.query) search.setQuery('');
    if (id === 'search') setTimeout(() => inputRef.current?.focus(), 0);
  };

  const listStatus = (() => {
    if (searching) {
      if (pasted.status === 'loading') return 'loading';
      if (search.localStatus === 'loading' && !flat.length) return 'loading';
      if (search.remote.status === 'loading' && !flat.length) return 'loading';
      return 'ready';
    }
    if (shelf?.id === 'search') return 'ready';
    if (!flat.length && (shelf?.status === 'loading' || shelf?.status === 'idle')) return 'loading';
    return 'ready';
  })();

  const showList = !narrow || !phoneDetail;
  const showDetail = !narrow || phoneDetail;
  const listboxLabel = searching ? `Results for ${trimmed}` : shelf?.label || 'Library';

  return (
    <div className="lib-panel" data-mode={mode} data-narrow={narrow || undefined} onKeyDown={onRootKey}>
      {showList && (
        <div className="lib-top">
          <label className="search lib-search">
            <Search size={15} aria-hidden="true" />
            <span className="visually-hidden">Search the library or paste a link</span>
            <input
              ref={inputRef}
              className="input"
              type="search"
              value={query}
              placeholder="Search, or paste a link"
              autoComplete="off"
              role="combobox"
              aria-expanded="true"
              aria-controls={`${uid}-list`}
              aria-autocomplete="list"
              aria-activedescendant={activeId && ids.includes(activeId) ? optionId(activeId) : undefined}
              data-autofocus={mode === 'dialog' ? true : undefined}
              onChange={(e) => search.setQuery(e.target.value)}
              onKeyDown={onSearchKey}
            />
            {query && (
              <Button variant="ghost" size="sm" icon aria-label="Clear the search" title="Clear the search" onClick={() => search.setQuery('')}>
                <X size={14} aria-hidden="true" />
              </Button>
            )}
          </label>
        </div>
      )}

      <div className="lib-body">
        {showList && (
          <nav className="lib-rail" aria-label="Shelves">
            <ul>
              {shelves.map((s) => {
                const Icon = SHELF_ICONS[s.id] || FileText;
                const on = !searching && s.id === shelf?.id;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      className="lib-shelf"
                      aria-current={on ? 'true' : undefined}
                      onClick={() => pickShelf(s.id)}
                    >
                      <Icon size={15} aria-hidden="true" />
                      <span className="lib-shelf-label">{s.label}</span>
                      {s.id !== 'search' && Number.isFinite(s.count) && s.count > 0 && (
                        <span className="lib-shelf-count num">{s.count.toLocaleString('en-US')}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}

        {showList && (
          <section className="lib-list" aria-label={listboxLabel}>
            <div className="lib-list-head">
              <p className="lib-list-hint">
                {searching
                  ? trimmed.startsWith('/')
                    ? 'Templates with that shortcut.'
                    : 'In your library, then on Bluesky.'
                  : SHELF_HINT[shelf?.id]}
              </p>
              {!searching && (shelf?.id === 'posts' || shelf?.id === 'replies') && (
                <Segmented size="sm" label="Order" options={SORTS} value={lib.sort} onChange={lib.setSort} />
              )}
              {searching && !trimmed.startsWith('/') && !looksLikeLink(trimmed) && (
                <label className="check lib-mine">
                  <input type="checkbox" checked={search.mine} onChange={(e) => search.setMine(e.target.checked)} />
                  <span>Only my posts</span>
                </label>
              )}
              {!searching && shelf?.id === 'templates' && onNewTemplate && (
                <Button size="sm" onClick={onNewTemplate}>
                  New template
                </Button>
              )}
            </div>
            {!searching && <ShelfStatus shelf={shelf} onRetry={() => lib.retry(shelf.id)} />}

            {listStatus === 'loading' ? (
              <LibrarySkeleton />
            ) : flat.length ? (
              <ul
                ref={listRef}
                id={`${uid}-list`}
                role="listbox"
                tabIndex={0}
                aria-label={listboxLabel}
                aria-activedescendant={activeId && ids.includes(activeId) ? optionId(activeId) : undefined}
                className="lib-options"
                onKeyDown={onListKey}
              >
                {sections.map((section) => (
                  <li key={section.id} role="presentation" className="lib-section" data-muted={section.muted || undefined}>
                    {section.heading && (
                      <span className="lib-section-head" role="presentation">
                        {section.heading}
                      </span>
                    )}
                    <ul role="group" aria-label={section.heading || undefined} className="lib-section-items">
                      {section.items.map((item) => (
                        <ItemRow
                          key={`${section.id}:${item.id}`}
                          id={optionId(item.id)}
                          item={item}
                          active={item.id === activeId}
                          selected={item.id === (selected?.id ?? null)}
                          onPick={() => choose(item)}
                        />
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty lib-empty" id={`${uid}-list`}>
                {searching
                  ? pasted.status === 'none'
                    ? 'Nothing could be read from that link. Check it and try again.'
                    : search.remote.status === 'error'
                      ? 'Search on Bluesky didn’t answer.'
                      : 'Nothing matches that.'
                  : SHELF_EMPTY[shelf?.id] || 'Nothing here yet.'}
              </p>
            )}

            {searching && search.remote.status === 'error' && (
              <div className="callout callout--danger lib-status" role="alert">
                <span>Search on Bluesky didn’t answer.</span>
                <Button size="sm" onClick={search.remote.retry}>
                  Try again
                </Button>
              </div>
            )}
            {searching && search.remote.status === 'loading' && flat.length > 0 && (
              <p className="lib-list-hint" role="status">
                Searching Bluesky…
              </p>
            )}
            {(searching ? search.remote.hasMore : !searching && shelf && lib.hasMore(shelf.id)) && (
              <div className="lib-more">
                <Button
                  size="sm"
                  onClick={() => (searching ? search.remote.loadMore() : lib.loadMore(shelf.id))}
                  disabled={searching ? search.remote.loadingMore : shelf.loadingMore}
                  aria-busy={(searching ? search.remote.loadingMore : shelf.loadingMore) || undefined}
                >
                  {(searching ? search.remote.loadingMore : shelf.loadingMore) ? 'Loading…' : 'Load more'}
                </Button>
              </div>
            )}
          </section>
        )}

        {showDetail && (
          <section ref={detailRef} className="lib-detail" aria-label="Chosen item" aria-live="polite">
            {narrow && (
              <Button
                variant="ghost"
                size="sm"
                className="lib-back"
                onClick={() => {
                  setPhoneDetail(false);
                  setSelectedId(null);
                }}
              >
                <ArrowLeft size={15} aria-hidden="true" />
                Back to the list
              </Button>
            )}
            {shown ? (
              <ItemDetail
                key={shown.id}
                item={shown}
                lib={lib}
                state={state}
                postIndex={postIndex}
                insertion={insertion}
                verb={verb}
                replying={replying}
                busy={using === shown.id}
                error={useError}
                onUse={applyItem}
                onCancel={narrow ? () => setPhoneDetail(false) : null}
              />
            ) : (
              <p className="empty lib-detail-empty">Choose something on the left to see what it adds.</p>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function ItemDetail({ item, lib, state, postIndex, insertion, verb, replying, busy, error, onUse, onCancel }) {
  const context = lib.context;
  const label = verb || verbFor(item, { replying }) || 'Use it';
  const isTemplate = item.kind === 'template';
  const asks = isTemplate ? templateQuestions(item.source, context).length : 0;
  const preview = previewFor(item, {
    state,
    postIndex,
    currentText: state ? undefined : '',
    insertion: insertion || undefined,
    context,
    quoteSlotLocked: lib.quoteSlotLocked,
  });

  return (
    <div className="lib-item">
      <div className="lib-item-head">
        <span className="lib-eyebrow">{item.label}</span>
        <h3 className="lib-item-title">{item.title}</h3>
        <p className="lib-item-effect">{effectFor(item, context)}</p>
      </div>

      {item.kind === 'post' &&
        (item.view ? (
          <PostPreview view={item.view} />
        ) : item.hydrateError ? (
          <p className="callout callout--warn">{errorText(item.hydrateError)}</p>
        ) : (
          <div className="lib-bone-card" aria-hidden="true">
            <span className="lib-bone lib-bone--title" style={{ width: '40%' }} />
            <span className="lib-bone lib-bone--line" style={{ width: '90%' }} />
            <span className="lib-bone lib-bone--line" style={{ width: '70%' }} />
          </div>
        ))}
      {(item.kind === 'feed' || item.kind === 'list' || item.kind === 'link') && (
        <div className="lib-card">
          <span className="lib-card-title">{item.title}</span>
          {item.excerpt && <span className="lib-card-text">{item.excerpt}</span>}
          {item.url && (
            <a className="lib-card-link" href={item.url} target="_blank" rel="noreferrer">
              Open the link
            </a>
          )}
        </div>
      )}

      {isTemplate && asks > 0 ? (
        <TemplateQuestions
          template={item.source}
          context={context}
          embedView={item.embedView}
          state={state}
          postIndex={postIndex}
          insertion={insertion}
          submitLabel={label}
          cancelLabel="Back"
          busy={busy}
          onDone={(answers) => onUse(item, answers)}
          onCancel={onCancel}
        />
      ) : (
        <>
          {(isTemplate || state) && <TemplatePreview preview={preview} label={replying ? 'Your reply will read' : 'Your post will read'} />}
          {!isTemplate && !state && preview.blocked && <p className="lib-preview-blocked">{preview.blocked}</p>}
          <div className="lib-questions-actions">
            {onCancel && <Button onClick={onCancel}>Back</Button>}
            <Button
              variant="primary"
              data-detail-focus
              disabled={busy || !preview.usable || Boolean(item.hydrateError)}
              aria-busy={busy || undefined}
              onClick={() => onUse(item)}
            >
              {busy ? 'Adding…' : label}
            </Button>
          </div>
        </>
      )}
      {error && (
        <p className="callout callout--danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
