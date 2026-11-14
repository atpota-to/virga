import { useEffect, useId, useRef, useState } from 'react';
import { Image as ImageIcon, List, Pencil, Rss, Users, X } from 'lucide-react';
import Button from '../../components/Button.jsx';
import Dialog from '../../components/Dialog.jsx';
import PostPreview from '../ui/PostPreview.jsx';
import { CARD_DESCRIPTION_MAX, CARD_TITLE_MAX } from '../lib/linkCard.js';
import { prepareImage, CARD_THUMB_BUDGET } from '../lib/images.js';
import { countGraphemes, truncateGraphemes } from '../lib/graphemes.js';

const LIST_PURPOSE = {
  'app.bsky.graph.defs#modlist': 'Moderation list',
  'app.bsky.graph.defs#curatelist': 'List',
  'app.bsky.graph.defs#referencelist': 'List',
};

/** What a post quotes or attaches: a post, a feed, a list or a starter pack. */
export function RecordCard({ record, onRemove, disabled = false }) {
  if (!record) return null;
  const view = record.view || null;
  const remove = onRemove && (
    <Button variant="ghost" size="sm" icon className="embed-remove" aria-label="Remove the attachment" onClick={onRemove} disabled={disabled}>
      <X size={15} aria-hidden="true" />
    </Button>
  );
  if (record.kind === 'post') {
    return (
      <div className="embed-card embed-card--post">
        {view ? <PostPreview view={view} compact /> : <p className="field-hint">A post ({record.uri})</p>}
        {remove}
      </div>
    );
  }
  const Icon = record.kind === 'feed' ? Rss : record.kind === 'starterpack' ? Users : List;
  const name = view?.displayName || view?.name || view?.record?.name || 'Untitled';
  const by = view?.creator?.handle ? `@${view.creator.handle}` : null;
  const kindWord =
    record.kind === 'feed' ? 'Feed' : record.kind === 'starterpack' ? 'Starter pack' : LIST_PURPOSE[view?.purpose] || 'List';
  const about = view?.description || view?.record?.description || '';
  return (
    <div className="embed-card embed-card--record">
      <span className="embed-icon" aria-hidden="true">
        {view?.avatar ? <img src={view.avatar} alt="" /> : <Icon size={18} />}
      </span>
      <span className="embed-text">
        <span className="embed-title">{name}</span>
        <span className="embed-sub">
          {kindWord}
          {by ? ` by ${by}` : ''}
        </span>
        {about && <span className="embed-desc">{truncateGraphemes(about, 140)}</span>}
      </span>
      {remove}
    </div>
  );
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** A link card: its image, title, description and site, with edit and remove. */
export function LinkCard({ card, loading = false, onEdit, onRemove, disabled = false }) {
  if (loading) {
    return (
      <div className="embed-card embed-card--link is-loading" aria-label="Reading the link" role="status">
        <span className="link-thumb skeleton" />
        <span className="embed-text">
          <span className="skeleton skeleton-line" />
          <span className="skeleton skeleton-line skeleton-line--short" />
        </span>
      </div>
    );
  }
  if (!card) return null;
  return (
    <div className="embed-card embed-card--link">
      {card.thumb ? (
        <img
          className="link-thumb"
          src={card.thumb}
          alt=""
          onError={(e) => {
            // A page image that won't load is left out of the preview.
            e.currentTarget.style.visibility = 'hidden';
          }}
        />
      ) : (
        <span className="link-thumb link-thumb--none" aria-hidden="true">
          <ImageIcon size={18} />
        </span>
      )}
      <span className="embed-text">
        <span className="embed-title">{card.title || hostOf(card.url)}</span>
        {card.description && <span className="embed-desc">{truncateGraphemes(card.description, 160)}</span>}
        <span className="embed-sub">{hostOf(card.url)}</span>
      </span>
      <span className="embed-tools">
        {onEdit && (
          <Button variant="ghost" size="sm" icon aria-label="Edit the link card" onClick={onEdit} disabled={disabled}>
            <Pencil size={15} aria-hidden="true" />
          </Button>
        )}
        {onRemove && (
          <Button variant="ghost" size="sm" icon aria-label="Remove the link card" onClick={onRemove} disabled={disabled}>
            <X size={15} aria-hidden="true" />
          </Button>
        )}
      </span>
    </div>
  );
}

/**
 * Change a link card's title (up to 200 characters), description (up to
 * 500) and image. A new image is shrunk to the card's size and stripped of
 * its metadata before it's kept.
 */
export function LinkCardDialog({ open, card, onClose, onSave }) {
  const id = useId();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [thumb, setThumb] = useState({ url: null, file: null, removed: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  useEffect(() => {
    if (!open || !card) return;
    setTitle(card.title || '');
    setDescription(card.description || '');
    setThumb({ url: card.thumb || null, file: card.thumbFile || null, removed: false });
    setError('');
  }, [open, card]);

  const titleOver = countGraphemes(title) > CARD_TITLE_MAX;
  const descOver = countGraphemes(description) > CARD_DESCRIPTION_MAX;

  async function pick(file) {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const prepared = await prepareImage(file, { budget: CARD_THUMB_BUDGET });
      setThumb({ url: URL.createObjectURL(prepared.file), file: prepared.file, removed: false });
    } catch (err) {
      setError(err?.message || 'That image couldn’t be used.');
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (titleOver || descOver) return;
    const next = { ...card, title: title.trim(), description: description.trim(), edited: true };
    if (thumb.removed) {
      next.thumb = null;
      delete next.thumbFile;
      delete next.thumbBlob;
      delete next.thumbBlobDid;
    } else if (thumb.file && thumb.file !== card.thumbFile) {
      next.thumb = thumb.url;
      next.thumbFile = thumb.file;
      delete next.thumbBlob;
      delete next.thumbBlobDid;
    }
    onSave?.(next);
    onClose?.();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Edit the link card"
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={busy || titleOver || descOver}>
            Save card
          </Button>
        </>
      }
    >
      <div className="dialog-form" onKeyDown={(e) => (e.key === 'Enter' && (e.metaKey || e.ctrlKey) ? save() : null)}>
        <p className="field-hint">{card?.url}</p>
        <label className="field" htmlFor={`${id}-t`}>
          <span className="field-label">Title</span>
          <input id={`${id}-t`} className="input" value={title} onChange={(e) => setTitle(e.target.value)} data-autofocus />
          <span className={`field-hint num${titleOver ? ' is-over' : ''}`}>
            {countGraphemes(title)} of {CARD_TITLE_MAX}
          </span>
        </label>
        <label className="field" htmlFor={`${id}-d`}>
          <span className="field-label">Description</span>
          <textarea id={`${id}-d`} className="input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          <span className={`field-hint num${descOver ? ' is-over' : ''}`}>
            {countGraphemes(description)} of {CARD_DESCRIPTION_MAX}
          </span>
        </label>
        <div className="field">
          <span className="field-label">Image</span>
          <div className="card-thumb-edit">
            {thumb.url && !thumb.removed ? (
              <img className="link-thumb link-thumb--lg" src={thumb.url} alt="The card’s image" />
            ) : (
              <span className="link-thumb link-thumb--lg link-thumb--none">No image</span>
            )}
            <span className="card-thumb-actions">
              <Button size="sm" onClick={() => fileRef.current?.click()} disabled={busy} aria-busy={busy || undefined}>
                {busy ? 'Preparing…' : 'Choose an image'}
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                tabIndex={-1}
                onChange={(e) => {
                  pick(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              {thumb.url && !thumb.removed && (
                <Button size="sm" variant="ghost" onClick={() => setThumb((t) => ({ ...t, removed: true }))}>
                  Remove the image
                </Button>
              )}
            </span>
          </div>
        </div>
        {error && (
          <p className="callout callout--danger" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
