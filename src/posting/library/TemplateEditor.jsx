import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { LogIn, Plus, Trash2, X } from 'lucide-react';
import Button from '../../components/Button.jsx';
import Dialog from '../../components/Dialog.jsx';
import Segmented from '../../components/Segmented.jsx';
import { requestReauth } from '../../accounts/accountCopy.js';
import { useToast } from '../../shell/bits.jsx';
import { countGraphemes } from '../lib/graphemes.js';
import { TEMPLATE_LIMITS } from '../templates/postTemplates.js';
import { BLANK_TEMPLATE, draftFromTemplate, templateEmbedKind, templateFromDraft } from '../templates/editorDrafts.js';
import { useTemplates } from '../templates/useTemplates.js';
import { fetchOwnPosts, hydrateEmbedViews, resolveExternalLink, resolveRecordLink } from './sources.js';
import {
  CONTEXT_INSERTS,
  USE_OPTIONS,
  addBlank,
  blanksIn,
  editorHasChanges,
  editorProblems,
  insertAtSelection,
  patchVariable,
} from './templateEditorModel.js';
import './library.css';

const ATTACH_OPTIONS = [
  { value: 'none', label: 'Nothing' },
  { value: 'post', label: 'One of your posts' },
  { value: 'link', label: 'A link' },
];

const KIND_OPTIONS = [
  { value: 'text', label: 'Typed answer' },
  { value: 'choice', label: 'Pick from a list' },
];

const POSTS_STEP = 5;

function firstLine(text) {
  return (
    String(text || '')
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) || ''
  );
}

function viewSummary(view) {
  if (!view || view === 'missing') return null;
  if (view.record?.text !== undefined || view.author) {
    return { by: view.author?.handle ? `Post by @${view.author.handle}` : 'Post', title: firstLine(view.record?.text) || 'Post' };
  }
  if (view.displayName) return { by: view.creator?.handle ? `Feed by @${view.creator.handle}` : 'Feed', title: view.displayName };
  if (view.name) return { by: view.creator?.handle ? `List by @${view.creator.handle}` : 'List', title: view.name };
  return null;
}

function startingDraft(template, seed) {
  if (template) return draftFromTemplate(template);
  if (seed?.draft) return draftFromTemplate(seed.draft);
  if (seed) return draftFromTemplate({ ...BLANK_TEMPLATE, text: seed.text || '', embed: seed.embed || null, use: seed.use || 'any' });
  return draftFromTemplate(null);
}

/**
 * Make or change a template: its name, its text with blanks for the
 * questions it asks (and the ones that fill themselves, such as the first
 * name of whoever is replied to), what it attaches, where it's offered, its
 * group, its "/shortcut" and the words that suggest it. Saved in the
 * account's repo as `net.anisota.feed.template`, where anyone can read it.
 *
 * `template` edits that one; `seed` (`{ text, embed }`, or `{ draft, note }`
 * from draftFromReply) starts a new one from a post ("Save this as a
 * template"). `onSaved(template)` after a save.
 */
export default function TemplateEditor({ open, onClose, did, template = null, seed = null, onSaved }) {
  // The dialog's own close (Escape, the backdrop, the X) asks the form
  // first, which may have changes to keep.
  const closeRef = useRef(null);
  return (
    <Dialog
      open={open}
      onClose={() => closeRef.current?.()}
      title={template ? 'Edit the template' : 'New template'}
      className="lib-dialog tpl-dialog"
    >
      {open && <EditorForm did={did} template={template} seed={seed} onClose={onClose} onSaved={onSaved} closeRef={closeRef} />}
    </Dialog>
  );
}

function EditorForm({ did, template, seed, onClose, onSaved, closeRef }) {
  const uid = useId();
  const toast = useToast();
  const textRef = useRef(null);
  const { templates, create, update, remove } = useTemplates(did);
  const initial = useMemo(() => startingDraft(template, seed), [template, seed]);
  const [draft, setDraft] = useState(initial);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [blankLabel, setBlankLabel] = useState(null);
  const [link, setLink] = useState({ status: 'idle', summary: null, error: '' });
  const [posts, setPosts] = useState({ status: 'idle', items: [], cursor: null, shown: POSTS_STEP });

  const others = templates.filter((t) => t.rkey !== template?.rkey);
  const problems = { ...editorProblems(draft, others), ...(serverError?.fieldErrors || {}) };
  const showProblems = tried || Boolean(serverError?.fieldErrors);
  const problem = (field) => (showProblems ? problems[field] : '');
  const changed = editorHasChanges(initial, draft);
  const blanks = blanksIn(draft);
  const textCount = countGraphemes(draft.text || '');
  const groups = [...new Set(templates.map((t) => String(t.group || '').trim()).filter(Boolean))];

  closeRef.current = () => {
    if (saving) return;
    if (changed && !confirmDiscard) setConfirmDiscard(true);
    else onClose?.();
  };
  useEffect(
    () => () => {
      closeRef.current = null;
    },
    [closeRef],
  );

  // What an existing quote is, read, so the form can name it.
  useEffect(() => {
    const kind = templateEmbedKind(initial.embed);
    if (!['post', 'feed', 'list'].includes(kind)) return undefined;
    let live = true;
    hydrateEmbedViews([initial.embed])
      .then((views) => {
        if (!live) return;
        const view = views.get(initial.embed.record.uri);
        if (view === 'missing') setLink({ status: 'ready', summary: { by: 'Gone', title: 'What this quotes has been deleted.' }, error: '' });
        else if (view) {
          setLink({ status: 'ready', summary: viewSummary(view), error: '' });
          setDraft((d) => (d.embed === initial.embed ? { ...d, quoteView: view } : d));
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [initial]);

  // Recent posts, when the writer chooses to attach one.
  useEffect(() => {
    if (draft.quoteMode !== 'post' || posts.status !== 'idle') return;
    setPosts((p) => ({ ...p, status: 'loading' }));
    fetchOwnPosts(did)
      .then((res) => setPosts({ status: 'ready', items: res.items, cursor: res.cursor, shown: POSTS_STEP }))
      .catch(() => setPosts((p) => ({ ...p, status: 'error' })));
  }, [draft.quoteMode, posts.status, did]);

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const selection = () => {
    const el = textRef.current;
    return el ? { start: el.selectionStart, end: el.selectionEnd } : null;
  };
  const placeCaret = (caret) =>
    setTimeout(() => {
      const el = textRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(caret, caret);
    }, 0);

  const insertToken = (key) => {
    const { text, caret } = insertAtSelection(draft.text, `{{${key}}}`, selection());
    setDraft((d) => ({ ...d, text }));
    placeCaret(caret);
  };

  const addAskedBlank = (event) => {
    event?.preventDefault();
    const out = addBlank(draft, blankLabel || '', selection());
    if (!out) return;
    setDraft(out.draft);
    setBlankLabel(null);
    placeCaret(out.caret);
  };

  const setAttach = (mode) => {
    if (mode === 'none') {
      set({ quoteMode: 'none', embed: null, quoteView: null, quoteUrl: '' });
      setLink({ status: 'idle', summary: null, error: '' });
    } else if (mode === 'post') set({ quoteMode: 'post', embed: draft.quoteMode === 'post' ? draft.embed : null, quoteUrl: '' });
    else set({ quoteMode: 'link', embed: draft.quoteMode === 'link' ? draft.embed : null });
  };

  const readLink = async () => {
    const url = String(draft.quoteUrl || '').trim();
    if (!url) return;
    setLink({ status: 'loading', summary: null, error: '' });
    try {
      const found = (await resolveRecordLink(url)) || (await resolveExternalLink(url));
      if (!found) {
        setLink({ status: 'error', summary: null, error: 'That link couldn’t be read. Check it, or try another.' });
        return;
      }
      setDraft((d) => ({ ...d, embed: found.embed, quoteView: found.view || null }));
      setLink({ status: 'ready', summary: { by: found.by, title: found.title }, error: '' });
    } catch {
      setLink({ status: 'error', summary: null, error: 'That link couldn’t be read. Check it, or try another.' });
    }
  };

  const pickPost = (view) => {
    set({ embed: { $type: 'app.bsky.embed.record', record: { uri: view.uri, cid: view.cid } }, quoteView: view });
    setLink({ status: 'ready', summary: viewSummary(view), error: '' });
  };

  const save = async (event) => {
    event?.preventDefault();
    if (saving) return;
    setTried(true);
    setServerError(null);
    const own = editorProblems(draft, others);
    if (Object.keys(own).length) {
      const field = Object.keys(own)[0];
      document.getElementById(`${uid}-${field}`)?.focus?.();
      return;
    }
    setSaving(true);
    try {
      const value = templateFromDraft(draft);
      const saved = template?.rkey ? await update(template.rkey, value) : await create(value);
      toast?.(template ? 'Template saved.' : 'Template made. It’s in your library now.');
      onSaved?.(saved);
      onClose?.();
    } catch (err) {
      setServerError(err);
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    if (!template?.rkey) return;
    setSaving(true);
    setServerError(null);
    try {
      await remove(template.rkey);
      toast?.('Template deleted.');
      onClose?.();
    } catch (err) {
      setServerError(err);
      setConfirmDelete(false);
    } finally {
      setSaving(false);
    }
  };

  const fieldProps = (field) => ({
    id: `${uid}-${field}`,
    'aria-invalid': problem(field) ? 'true' : undefined,
    'aria-describedby': problem(field) ? `${uid}-${field}-err` : undefined,
  });
  const fieldError = (field) =>
    problem(field) ? (
      <p id={`${uid}-${field}-err`} className="field-hint lib-question-error">
        {problem(field)}
      </p>
    ) : null;

  const shownPosts = posts.items.slice(0, posts.shown);

  return (
    <form className="tpl-form" onSubmit={save} noValidate>
      <p className="note">
        Templates are saved in your repo, where anyone can read them. Don’t put anything private in one.
      </p>
      {seed?.note && <p className="callout">{seed.note}</p>}

      <div className="field">
        <label className="field-label" htmlFor={`${uid}-name`}>
          Name
        </label>
        <input
          {...fieldProps('name')}
          className="input"
          value={draft.name}
          maxLength={200}
          placeholder="Is there an app for that?"
          data-autofocus
          onChange={(e) => set({ name: e.target.value })}
        />
        {fieldError('name')}
      </div>

      <div className="field">
        <label className="field-label" htmlFor={`${uid}-text`}>
          Text
        </label>
        <textarea
          {...fieldProps('text')}
          ref={textRef}
          className="input"
          rows={5}
          value={draft.text}
          onChange={(e) => set({ text: e.target.value })}
        />
        <div className="tpl-text-foot">
          <div className="tpl-inserts" role="group" aria-label="Put in a blank">
            <Button size="sm" onClick={() => setBlankLabel('')}>
              <Plus size={14} aria-hidden="true" />
              Add a blank
            </Button>
            {CONTEXT_INSERTS.map((c) => (
              <Button key={c.key} size="sm" variant="ghost" onClick={() => insertToken(c.key)}>
                {c.label}
              </Button>
            ))}
          </div>
          <span className={`field-hint num${textCount > TEMPLATE_LIMITS.textGraphemes ? ' is-over' : ''}`}>
            {textCount.toLocaleString('en-US')} of {TEMPLATE_LIMITS.textGraphemes}
          </span>
        </div>
        {blankLabel !== null && (
          <div className="tpl-blank-new">
            <label className="field-label" htmlFor={`${uid}-blank`}>
              What should it ask?
            </label>
            <div className="tpl-row">
              <input
                id={`${uid}-blank`}
                className="input"
                value={blankLabel}
                placeholder="Which app?"
                autoFocus
                onChange={(e) => setBlankLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') addAskedBlank(e);
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    setBlankLabel(null);
                  }
                }}
              />
              <Button size="sm" variant="primary" onClick={addAskedBlank} disabled={!blankLabel.trim()}>
                Add
              </Button>
              <Button size="sm" variant="ghost" icon aria-label="Don’t add a blank" title="Don’t add a blank" onClick={() => setBlankLabel(null)}>
                <X size={14} aria-hidden="true" />
              </Button>
            </div>
          </div>
        )}
        <p className="field-hint">
          A blank is a word in double braces, like {'{{app}}'}. Using the template asks for each one.
        </p>
        {fieldError('text')}
      </div>

      {(blanks.asked.length > 0 || blanks.context.length > 0) && (
        <fieldset className="tpl-blanks">
          <legend className="field-label">Questions</legend>
          {blanks.asked.map((v) => (
            <div key={v.key} className="tpl-blank">
              <span className="tpl-blank-key mono">{`{{${v.key}}}`}</span>
              <div className="field">
                <label className="field-label" htmlFor={`${uid}-q-${v.key}`}>
                  Question
                </label>
                <input
                  id={`${uid}-q-${v.key}`}
                  className="input"
                  value={v.label || ''}
                  placeholder={`Fill in “${v.key}”`}
                  onChange={(e) => setDraft((d) => patchVariable(d, v.key, { label: e.target.value }))}
                />
              </div>
              <div className="field">
                <label className="field-label" htmlFor={`${uid}-h-${v.key}`}>
                  Example or hint
                </label>
                <input
                  id={`${uid}-h-${v.key}`}
                  className="input"
                  value={v.hint || ''}
                  onChange={(e) => setDraft((d) => patchVariable(d, v.key, { hint: e.target.value }))}
                />
              </div>
              <Segmented
                size="sm"
                label={`How “${v.label || v.key}” is answered`}
                options={KIND_OPTIONS}
                value={v.kind === 'choice' ? 'choice' : 'text'}
                onChange={(kind) => setDraft((d) => patchVariable(d, v.key, { kind }))}
              />
              {v.kind === 'choice' && (
                <div className="field">
                  <label className="field-label" htmlFor={`${uid}-c-${v.key}`}>
                    Choices, one per line
                  </label>
                  <textarea
                    id={`${uid}-c-${v.key}`}
                    className="input"
                    rows={3}
                    value={v.choicesText || ''}
                    onChange={(e) => setDraft((d) => patchVariable(d, v.key, { choicesText: e.target.value }))}
                  />
                </div>
              )}
              <label className="check">
                <input
                  type="checkbox"
                  checked={v.optional === true}
                  onChange={(e) => setDraft((d) => patchVariable(d, v.key, { optional: e.target.checked }))}
                />
                <span>Optional: an empty answer is left out</span>
              </label>
            </div>
          ))}
          {blanks.context.length > 0 && (
            <p className="field-hint">Filled in for you: {blanks.context.map((c) => c.label).join(', ')}.</p>
          )}
          {problem('variables') && <p className="field-hint lib-question-error">{problem('variables')}</p>}
        </fieldset>
      )}

      <div className="field">
        <span className="field-label" id={`${uid}-attach-label`}>
          Attach
        </span>
        {draft.quoteMode === 'other' ? (
          <div className="tpl-attached">
            <span>This template attaches something Virga can’t show here, such as pictures. Saving keeps it.</span>
            <Button size="sm" onClick={() => setAttach('none')}>
              Remove it
            </Button>
          </div>
        ) : (
          <Segmented size="sm" label="Attach" options={ATTACH_OPTIONS} value={draft.quoteMode} onChange={setAttach} />
        )}
        {draft.quoteMode === 'link' && (
          <div className="tpl-row">
            <label className="visually-hidden" htmlFor={`${uid}-quote`}>
              A link to a post, feed, list or web page
            </label>
            <input
              {...fieldProps('quote')}
              className="input"
              type="url"
              inputMode="url"
              value={draft.quoteUrl || ''}
              placeholder="https://bsky.app/profile/…/post/…, or any web page"
              onChange={(e) => {
                set({ quoteUrl: e.target.value, embed: null, quoteView: null });
                setLink({ status: 'idle', summary: null, error: '' });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  readLink();
                }
              }}
            />
            <Button size="sm" onClick={readLink} disabled={!String(draft.quoteUrl || '').trim() || link.status === 'loading'} aria-busy={link.status === 'loading' || undefined}>
              {link.status === 'loading' ? 'Reading…' : 'Read the link'}
            </Button>
          </div>
        )}
        {draft.quoteMode === 'post' && (
          <div className="tpl-posts">
            {posts.status === 'loading' && (
              <div className="lib-bone-card" aria-hidden="true">
                <span className="lib-bone lib-bone--line" style={{ width: '80%' }} />
                <span className="lib-bone lib-bone--line" style={{ width: '60%' }} />
                <span className="lib-bone lib-bone--line" style={{ width: '70%' }} />
              </div>
            )}
            {posts.status === 'error' && (
              <p className="callout callout--danger">
                Your recent posts couldn’t be read.{' '}
                <Button size="sm" onClick={() => setPosts({ status: 'idle', items: [], cursor: null, shown: POSTS_STEP })}>
                  Try again
                </Button>
              </p>
            )}
            {posts.status === 'ready' && !posts.items.length && <p className="field-hint">No posts of yours to quote yet.</p>}
            {shownPosts.length > 0 && (
              <div role="radiogroup" aria-labelledby={`${uid}-attach-label`} className="lib-choices">
                {shownPosts.map((view) => {
                  const on = draft.embed?.record?.uri === view.uri;
                  return (
                    <button
                      key={view.uri}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      className="lib-choice"
                      onClick={() => pickPost(view)}
                    >
                      <span className="lib-choice-label">{firstLine(view.record?.text) || 'A post with no text'}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {posts.items.length > posts.shown && (
              <Button size="sm" variant="ghost" onClick={() => setPosts((p) => ({ ...p, shown: p.shown + POSTS_STEP }))}>
                Show more
              </Button>
            )}
          </div>
        )}
        {draft.embed && link.summary && draft.quoteMode !== 'other' && (
          <div className="lib-preview-attach">
            <span className="lib-preview-attach-by">{link.summary.by}</span>
            <span className="lib-preview-attach-title">{link.summary.title}</span>
          </div>
        )}
        {draft.embed && !link.summary && draft.quoteMode !== 'other' && draft.quoteMode !== 'none' && (
          <p className="field-hint">Attached: {templateEmbedKind(draft.embed) === 'link' ? 'a link card' : `a ${templateEmbedKind(draft.embed)}`}.</p>
        )}
        {link.error && <p className="field-hint lib-question-error">{link.error}</p>}
        {fieldError('quote')}
      </div>

      <div className="field">
        <span className="field-label">Offer it when</span>
        <Segmented size="sm" label="Offer it when" options={USE_OPTIONS} value={draft.use || 'any'} onChange={(use) => set({ use })} />
      </div>

      <div className="tpl-grid">
        <div className="field">
          <label className="field-label" htmlFor={`${uid}-group`}>
            Group
          </label>
          <input
            {...fieldProps('group')}
            className="input"
            list={`${uid}-groups`}
            value={draft.group || ''}
            placeholder="Optional"
            onChange={(e) => set({ group: e.target.value })}
          />
          <datalist id={`${uid}-groups`}>
            {groups.map((g) => (
              <option key={g} value={g} />
            ))}
          </datalist>
          {fieldError('group')}
        </div>
        <div className="field">
          <label className="field-label" htmlFor={`${uid}-shortcut`}>
            Shortcut
          </label>
          <div className="tpl-shortcut">
            <span aria-hidden="true" className="mono">
              /
            </span>
            <input
              {...fieldProps('shortcut')}
              className="input"
              value={draft.shortcut || ''}
              placeholder="app"
              autoCapitalize="off"
              spellCheck={false}
              onChange={(e) => set({ shortcut: e.target.value.replace(/^\/+/, '') })}
            />
          </div>
          <p className="field-hint">Type it after a slash in the composer to use the template.</p>
          {fieldError('shortcut')}
        </div>
      </div>

      <div className="field">
        <label className="field-label" htmlFor={`${uid}-keywords`}>
          Suggest it when a post mentions
        </label>
        <input
          {...fieldProps('keywords')}
          className="input"
          value={draft.keywordsText || ''}
          placeholder="app, client, reader"
          onChange={(e) => set({ keywordsText: e.target.value })}
        />
        <p className="field-hint">Words separated by commas. A reply to a post with one of them offers this template first.</p>
        {fieldError('keywords')}
      </div>

      {serverError && !serverError.fieldErrors && (
        <div className="callout callout--danger" role="alert">
          <span>{serverError.message || 'The template couldn’t be saved. Try again.'}</span>
          {serverError.permission && (
            <Button size="sm" variant="primary" onClick={() => requestReauth(did, { immediate: true })}>
              <LogIn size={14} aria-hidden="true" />
              Sign in again
            </Button>
          )}
        </div>
      )}

      {confirmDiscard ? (
        <div className="tpl-actions" role="group" aria-label="Discard changes?">
          <span className="tpl-actions-note">Discard your changes?</span>
          <Button onClick={() => setConfirmDiscard(false)} data-autofocus>
            Keep editing
          </Button>
          <Button variant="danger" onClick={onClose}>
            Discard
          </Button>
        </div>
      ) : confirmDelete ? (
        <div className="tpl-actions" role="group" aria-label="Delete this template?">
          <span className="tpl-actions-note">Delete “{template?.name}” for good? It goes from your repo, and from every app that reads it.</span>
          <Button onClick={() => setConfirmDelete(false)} disabled={saving}>
            Keep it
          </Button>
          <Button variant="danger" onClick={doDelete} disabled={saving} aria-busy={saving || undefined}>
            {saving ? 'Deleting…' : 'Delete for good'}
          </Button>
        </div>
      ) : (
        <div className="tpl-actions">
          {template?.rkey && (
            <Button variant="ghost" className="tpl-delete" onClick={() => setConfirmDelete(true)} disabled={saving}>
              <Trash2 size={14} aria-hidden="true" />
              Delete
            </Button>
          )}
          <Button onClick={() => closeRef.current?.()} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={saving} aria-busy={saving || undefined}>
            {saving ? 'Saving…' : 'Save template'}
          </Button>
        </div>
      )}
    </form>
  );
}
