import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BookOpen } from 'lucide-react';
import Avatar from '../../components/Avatar.jsx';
import { detectFacets } from '../lib/facets.js';
import { applyInlineLinks, findInlineLinks } from '../lib/inlineLinks.js';
import { detectPartialMention } from '../lib/mentions.js';
import { publicXrpc } from '../library/sources.js';
import { detectSlashCommand, rankTemplatesForSlash } from '../library/model.js';
import { matchShortcut } from '../templates/postTemplates.js';
import { highlightSegments } from './highlight.js';
import { insertMention, pasteAsInlineLink, misleadingLinkNotes, replaceRange } from './editing.js';

const DETECT_MS = 150;
const TYPEAHEAD_MS = 150;
const SLASH_LIMIT = 5;

/**
 * One post's text field: a transparent textarea over a layer that draws the
 * same characters with mentions, links, hashtags and inline-link brackets
 * coloured. Only colour differs between the two, so the caret sits where the
 * letters are. Typing "@" suggests accounts (public typeahead), "/" suggests
 * templates by shortcut, and pasting an address over selected words makes an
 * inline link. Detection runs a moment after typing stops; the parent hears
 * which record links and web addresses it found (`onDetected`).
 *
 * The handle: `focus()`, `setCaret(n)`, `selection()`.
 */
const PostEditor = forwardRef(function PostEditor(
  {
    value,
    onChange,
    label,
    placeholder,
    describedBy,
    autoFocus = false,
    disabled = false,
    templates = [],
    templatesStatus = 'idle',
    templateUsage,
    replying = false,
    parentText = '',
    onTemplate,
    onOpenLibrary,
    onPasteFiles,
    onDetected,
    onFocus,
  },
  ref,
) {
  const id = useId();
  const inputRef = useRef(null);
  const overlayRef = useRef(null);
  const pendingCaret = useRef(null);
  const [detected, setDetected] = useState({ text: '', facets: [], links: [] });
  const [caret, setCaretState] = useState(0);
  const [mention, setMention] = useState(null); // { range, query, status, items, index }
  const [slashDismissed, setSlashDismissed] = useState(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [pasteNote, setPasteNote] = useState('');
  const text = typeof value === 'string' ? value : '';

  useImperativeHandle(
    ref,
    () => ({
      focus: () => inputRef.current?.focus(),
      setCaret: (n) => {
        pendingCaret.current = n;
        const el = inputRef.current;
        if (el && el.value.length >= n) {
          el.focus();
          el.setSelectionRange(n, n);
          pendingCaret.current = null;
        }
      },
      selection: () => {
        const el = inputRef.current;
        return el ? { start: el.selectionStart, end: el.selectionEnd } : { start: text.length, end: text.length };
      },
    }),
    [text.length],
  );

  // A caret asked for before the new text reached the textarea lands here.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (el && pendingCaret.current != null && el.value.length >= pendingCaret.current) {
      el.focus();
      el.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  });

  // The field grows with what's written; the composer's body scrolls.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, 72)}px`;
  }, [text]);

  // Detection, a beat after typing stops. Mentions aren't looked up while
  // typing; the post resolves them when it goes out.
  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;
  useEffect(() => {
    let live = true;
    const timer = setTimeout(async () => {
      const links = findInlineLinks(text).filter((l) => !l.misleading);
      let result;
      try {
        result = await detectFacets(text, { skipMentionResolution: true });
      } catch {
        return;
      }
      if (!live) return;
      const merged = applyInlineLinks(text, links, result);
      setDetected({ text, facets: merged.facets, links });
      onDetectedRef.current?.({ text, postEmbeds: merged.postEmbeds, externalLinks: merged.externalLinks });
    }, DETECT_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [text]);

  const segments = useMemo(() => {
    // Until detection catches up, the layer draws the text plain: never stale
    // colours on characters that moved.
    if (detected.text !== text) return [{ text, kind: 'plain' }];
    return highlightSegments(text, detected.facets, detected.links);
  }, [text, detected]);
  const misleading = useMemo(() => misleadingLinkNotes(text), [text]);

  // The mention being typed, and who it might be.
  const partial = useMemo(() => {
    const m = detectPartialMention(text, caret);
    return m && m.query.length >= 1 ? m : null;
  }, [text, caret]);
  useEffect(() => {
    if (!partial) {
      setMention(null);
      return undefined;
    }
    let live = true;
    setMention((m) => ({ range: partial, query: partial.query, status: 'loading', items: m?.query === partial.query ? m.items : [], index: 0 }));
    const timer = setTimeout(async () => {
      try {
        const body = await publicXrpc('app.bsky.actor.searchActorsTypeahead', { q: partial.query, limit: 5 });
        if (!live) return;
        const items = (body?.actors || []).filter((a) => a?.handle).slice(0, 5);
        setMention({ range: partial, query: partial.query, status: 'ready', items, index: 0 });
      } catch {
        if (live) setMention({ range: partial, query: partial.query, status: 'error', items: [], index: 0 });
      }
    }, TYPEAHEAD_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // The range object changes on every keystroke; the query is what counts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [partial?.query, partial?.start]);

  // The "/shortcut" being typed, and the templates it could mean.
  const slash = useMemo(() => {
    if (partial) return null;
    const s = detectSlashCommand(text, caret);
    if (!s) return null;
    if (slashDismissed && slashDismissed.start === s.start) return null;
    return s;
  }, [text, caret, partial, slashDismissed]);
  const slashMatches = useMemo(() => {
    if (!slash) return [];
    const ranked = rankTemplatesForSlash(templates, { parentText, usage: templateUsage, replying });
    return matchShortcut(ranked, slash.query, { replying, limit: SLASH_LIMIT });
  }, [slash, templates, parentText, templateUsage, replying]);
  useEffect(() => setSlashIndex(0), [slash?.query, slash?.start]);
  useEffect(() => {
    if (slashDismissed && !detectSlashCommand(text, caret)) setSlashDismissed(null);
  }, [text, caret, slashDismissed]);

  const syncCaret = useCallback(() => {
    const el = inputRef.current;
    if (el) setCaretState(el.selectionEnd);
  }, []);

  const set = (next, nextCaret) => {
    onChange?.(next);
    if (nextCaret != null) {
      pendingCaret.current = nextCaret;
      setCaretState(nextCaret);
    }
  };

  const pickMention = (actor) => {
    if (!mention?.range || !actor?.handle) return;
    const r = insertMention(text, mention.range, actor.handle);
    setMention(null);
    set(r.text, r.caret);
  };

  const pickTemplate = (template) => {
    if (!slash || !template) return;
    onTemplate?.(template, { start: slash.start, end: slash.end });
  };

  const listOpen = mention && (mention.items.length > 0 || mention.status !== 'idle');
  const mentionItems = mention?.items || [];
  const slashOpen = !!slash;
  const activeId = mentionItems.length
    ? `${id}-m-${mention.index}`
    : slashOpen && slashMatches.length
      ? `${id}-s-${slashIndex}`
      : undefined;

  function onKeyDown(e) {
    if (e.nativeEvent?.isComposing) return;
    if (mentionItems.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setMention((m) => ({ ...m, index: (m.index + step + m.items.length) % m.items.length }));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        if (e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        pickMention(mentionItems[mention.index]);
        return;
      }
    }
    if (slashOpen && slashMatches.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setSlashIndex((i) => (i + step + slashMatches.length) % slashMatches.length);
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        pickTemplate(slashMatches[slashIndex]);
        return;
      }
    }
    if (e.key === 'Escape' && (listOpen || slashOpen)) {
      // Close the list, not the composer.
      e.preventDefault();
      e.stopPropagation();
      if (listOpen) setMention(null);
      if (slashOpen) setSlashDismissed(slash);
    }
  }

  function onPaste(e) {
    const el = e.currentTarget;
    const pastedText = e.clipboardData?.getData('text/plain') || '';
    const linked = pasteAsInlineLink(text, el.selectionStart, el.selectionEnd, pastedText);
    if (linked?.refused) {
      e.preventDefault();
      setPasteNote(linked.refused);
      return;
    }
    if (linked) {
      e.preventDefault();
      setPasteNote('');
      set(linked.text, linked.caret);
      return;
    }
    setPasteNote('');
    if (!pastedText.trim() && onPasteFiles?.(e.clipboardData)) e.preventDefault();
  }

  const hintId = `${id}-hint`;
  const notes = [...misleading, ...(pasteNote ? [pasteNote] : [])];

  return (
    <div className="post-editor-wrap">
      <div className="post-editor" data-disabled={disabled || undefined}>
        <div ref={overlayRef} className="post-editor-layer" aria-hidden="true">
          {segments.map((s, i) =>
            s.kind === 'plain' ? <span key={i}>{s.text}</span> : <span key={i} className={`hl hl--${s.kind}`}>{s.text}</span>,
          )}
          {/* Keeps a trailing newline as tall as the textarea draws it. */}
          {'​'}
        </div>
        <textarea
          ref={inputRef}
          id={id}
          className="post-editor-input"
          value={text}
          rows={3}
          disabled={disabled}
          placeholder={placeholder}
          aria-label={label}
          aria-describedby={[describedBy, notes.length ? hintId : null].filter(Boolean).join(' ') || undefined}
          role={listOpen || slashOpen ? 'combobox' : undefined}
          aria-expanded={listOpen || slashOpen ? true : undefined}
          aria-controls={listOpen || slashOpen ? `${id}-list` : undefined}
          aria-autocomplete={listOpen || slashOpen ? 'list' : undefined}
          aria-activedescendant={activeId}
          data-autofocus={autoFocus || undefined}
          spellCheck
          onChange={(e) => {
            onChange?.(e.target.value);
            setCaretState(e.target.selectionEnd);
          }}
          onSelect={syncCaret}
          onKeyUp={syncCaret}
          onClick={syncCaret}
          onFocus={(e) => {
            syncCaret();
            onFocus?.(e);
          }}
          onBlur={() => setTimeout(() => setMention(null), 150)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onScroll={(e) => {
            if (overlayRef.current) overlayRef.current.scrollTop = e.currentTarget.scrollTop;
          }}
        />
      </div>

      {notes.length > 0 && (
        <p id={hintId} className="field-hint post-editor-note" role="status">
          {notes.join(' ')}
        </p>
      )}

      {listOpen && (
        <div className="suggest-pop">
          <ul id={`${id}-list`} className="suggest-list" role="listbox" aria-label="Accounts to mention">
            {mentionItems.map((a, i) => (
              <li
                key={a.did}
                id={`${id}-m-${i}`}
                role="option"
                aria-selected={i === mention.index}
                className="suggest-item"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => pickMention(a)}
              >
                <Avatar src={a.avatar} name={a.displayName || a.handle} size="sm" />
                <span className="suggest-text">
                  <span className="suggest-name">{a.displayName || a.handle}</span>
                  <span className="suggest-meta">@{a.handle}</span>
                </span>
              </li>
            ))}
          </ul>
          {mentionItems.length === 0 && (
            <p className="suggest-status" role="status">
              {mention.status === 'error' ? 'Couldn’t look up accounts just now.' : mention.status === 'loading' ? 'Looking…' : `No one found for “${mention.query}”.`}
            </p>
          )}
        </div>
      )}

      {slashOpen && (
        <div className="suggest-pop">
          {slashMatches.length > 0 && (
            <ul id={`${id}-list`} className="suggest-list" role="listbox" aria-label="Templates">
              {slashMatches.map((t, i) => (
                <li
                  key={t.rkey || t.name}
                  id={`${id}-s-${i}`}
                  role="option"
                  aria-selected={i === slashIndex}
                  className="suggest-item"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => pickTemplate(t)}
                >
                  <span className="suggest-text">
                    <span className="suggest-name">{t.name || 'Untitled template'}</span>
                    {t.shortcut && <span className="suggest-meta">/{t.shortcut}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {slashMatches.length === 0 && (
            <p className="suggest-status" role="status">
              {templatesStatus === 'loading'
                ? 'Looking for your templates…'
                : templatesStatus === 'error'
                  ? 'Couldn’t load your templates.'
                  : templates.length === 0
                    ? 'No templates yet. Make one from your library.'
                    : slash.query
                      ? `No template uses /${slash.query}.`
                      : 'None of your templates has a shortcut yet.'}
            </p>
          )}
          {onOpenLibrary && (
            <button
              type="button"
              className="suggest-foot"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => onOpenLibrary({ start: slash.start, end: slash.end })}
            >
              <BookOpen size={14} aria-hidden="true" />
              Open the library
            </button>
          )}
        </div>
      )}
    </div>
  );
});

export default PostEditor;

/** Insert `addition` at the editor's selection: the caller's helper for buttons. */
export function insertAtSelection(text, selection, addition) {
  return replaceRange(text, selection?.start ?? text.length, selection?.end ?? text.length, addition);
}
