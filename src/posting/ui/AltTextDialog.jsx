import { useEffect, useId, useRef, useState } from 'react';
import { Sparkles, Undo2 } from 'lucide-react';
import Button from '../../components/Button.jsx';
import Dialog from '../../components/Dialog.jsx';
import { generateAltTextForFile } from '../adviser/aiService.js';
import {
  ALT_TEXT_IMAGE_KINDS,
  ALT_TEXT_NOTE_MAX,
  ALT_TEXT_QUICK_NOTES,
  appendItsA,
  hasFollowUpDraft,
  rankQuickNotes,
  toggleQuickNote,
} from '../adviser/altTextFollowUp.js';
import { afterGeneration, altGenerationRequest, altTextCount, altTextUsageLine, revisingLine } from '../adviser/altTextModel.js';
import { readAdviserUsage } from '../adviser/usage.js';
import './adviser.css';

const NOTE_BY_ID = Object.fromEntries(ALT_TEXT_QUICK_NOTES.map((n) => [n.id, n]));

/**
 * Describe an image for people who can't see it. The words are always the
 * writer's to write and to save. With `requester` (the posting account's
 * server requester, so only for an account with a long session) it can also
 * describe the image itself and revise the description from a note; without
 * one there's no Generate button. `context` (or `image.context`) is the
 * post's text, sent along so the description fits the post.
 */
export default function AltTextDialog({ open, onClose, image, onSave, did, requester, context = '' }) {
  const ids = { alt: useId(), note: useId(), kind: useId(), count: useId() };
  const noteRef = useRef(null);
  const run = useRef(0);
  const [alt, setAlt] = useState(image?.alt || '');
  // The composer hands a fresh object each render; the image is the same
  // while its file (or preview) is.
  const imageKey = image ? image.file || image.previewUrl || null : null;
  const [seen, setSeen] = useState({ key: imageKey, open });
  const [kind, setKind] = useState(null);
  const [selected, setSelected] = useState([]);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(null); // 'describe' | 'revise' | null
  const [error, setError] = useState('');
  const [limited, setLimited] = useState(false);
  const [undo, setUndo] = useState(null);
  const [rankedAgainst, setRankedAgainst] = useState(image?.alt || '');
  const [lastAsked, setLastAsked] = useState([]);
  const [described, setDescribed] = useState(false);

  // A new image, or the dialog opening again, starts afresh.
  if (seen.key !== imageKey || seen.open !== open) {
    setSeen({ key: imageKey, open });
    if (open && (seen.key !== imageKey || !seen.open)) {
      setAlt(image?.alt || '');
      setKind(null);
      setSelected([]);
      setNote('');
      setPending(null);
      setError('');
      setLimited(false);
      setUndo(null);
      setRankedAgainst(image?.alt || '');
      setLastAsked([]);
      setDescribed(false);
    }
  }
  useEffect(() => {
    if (!open) run.current++;
  }, [open]);

  const canGenerate = !!requester && !!(image?.file || image?.previewUrl);
  const hasText = !!alt.trim();
  const canRevise = canGenerate && (described || hasText);
  const count = altTextCount(alt);
  const usageLine = canGenerate ? altTextUsageLine(readAdviserUsage(did, { feature: 'altText' })) : '';
  const ranked = rankQuickNotes({ text: rankedAgainst, kind, lastAsked });
  const offered = [...ranked.map((r) => r.id), ...selected.filter((id) => !ranked.some((r) => r.id === id))]
    .map((id) => NOTE_BY_ID[id])
    .filter(Boolean);
  const postText = String(context || image?.context || '');

  async function generate(mode) {
    if (!canGenerate || pending) return;
    const request = altGenerationRequest({ mode, alt, selected, note, kind, context: postText });
    if (!request) return;
    const id = ++run.current;
    const before = alt;
    setPending(mode);
    setError('');
    setLimited(false);
    try {
      const file = image.file || (await fileFromPreview(image.previewUrl));
      const generated = await generateAltTextForFile(requester, file, request);
      if (id !== run.current) return;
      const next = afterGeneration({ before, generated, mode, selected });
      if (!next) {
        setError('The description came back empty. Try again, or write your own.');
        return;
      }
      setAlt(next.alt);
      setUndo(next.undo);
      setRankedAgainst(next.rankedAgainst);
      setLastAsked(next.lastAsked);
      setDescribed(true);
      if (mode === 'revise') {
        setSelected([]);
        setNote('');
      }
    } catch (err) {
      if (id !== run.current) return;
      if (err?.code === 'monthly_limit') setLimited(true);
      else setError(err?.message || 'The image couldn’t be described. Try again, or write your own.');
    } finally {
      if (id === run.current) setPending(null);
    }
  }

  const save = () => {
    if (count.over) return;
    onSave?.(alt.trim());
    onClose?.();
  };

  const busyLine = pending === 'describe' ? 'Describing the image…' : pending === 'revise' ? `${revisingLine(selected, note)}…` : '';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Alt text"
      className="alt-dialog"
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={count.over || !!pending}>
            Save
          </Button>
        </>
      }
    >
      <div
        className="alt-dialog-body"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            save();
          }
        }}
      >
        {image?.previewUrl && <img className="alt-dialog-preview" src={image.previewUrl} alt="" />}

        {canGenerate && !canRevise && (
          <div className="alt-kind">
            <span id={ids.kind} className="field-label">
              What kind of image is it? <span className="alt-optional">Optional</span>
            </span>
            <div className="alt-chips" role="group" aria-labelledby={ids.kind}>
              {ALT_TEXT_IMAGE_KINDS.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  className="chip"
                  aria-pressed={kind === k.id}
                  onClick={() => setKind((v) => (v === k.id ? null : k.id))}
                  disabled={!!pending}
                >
                  {k.label}
                </button>
              ))}
            </div>
            {ALT_TEXT_IMAGE_KINDS.find((k) => k.id === kind)?.hint && (
              <p className="field-hint">{ALT_TEXT_IMAGE_KINDS.find((k) => k.id === kind).hint}</p>
            )}
          </div>
        )}

        <div className="field">
          <div className="alt-field-head">
            <label className="field-label" htmlFor={ids.alt}>
              Description
            </label>
            <div className="alt-field-tools">
              {undo !== null && !pending && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setAlt(undo);
                    setRankedAgainst(undo);
                    setLastAsked([]);
                    setUndo(null);
                  }}
                >
                  <Undo2 size={14} aria-hidden="true" />
                  Undo
                </Button>
              )}
              {canGenerate && !canRevise && (
                <Button size="sm" onClick={() => generate('describe')} disabled={!!pending}>
                  <Sparkles size={14} aria-hidden="true" />
                  {pending === 'describe' ? 'Describing…' : 'Describe it for me'}
                </Button>
              )}
            </div>
          </div>
          <textarea
            id={ids.alt}
            className="input alt-dialog-text"
            rows={5}
            value={alt}
            aria-describedby={ids.count}
            aria-busy={pending ? true : undefined}
            readOnly={!!pending}
            placeholder="What’s in the image, and what matters about it for this post"
            onChange={(e) => {
              setAlt(e.target.value);
              // An edit is the writer's own; undoing past it would throw it away.
              if (undo !== null) setUndo(null);
            }}
            data-autofocus
          />
          <div className="alt-field-foot">
            <span id={ids.count} className={`field-hint${count.over ? ' is-over' : ''}`}>
              {count.label}
              {count.over ? ' · too long' : ''}
            </span>
            {busyLine && (
              <span className="field-hint" role="status">
                {busyLine}
              </span>
            )}
          </div>
        </div>

        {limited && (
          <p className="callout callout--warn" role="alert">
            {altTextUsageLine(readAdviserUsage(did, { feature: 'altText' })) ||
              'This month’s free descriptions are used up. They start again on the first of the month.'}{' '}
            You can still write it yourself.
          </p>
        )}
        {error && (
          <p className="callout callout--danger" role="alert">
            {error}
          </p>
        )}

        {canRevise && (
          <section className="alt-revise" aria-labelledby={`${ids.note}-title`}>
            <span id={`${ids.note}-title`} className="field-label">
              Revise it
            </span>
            <div className="alt-chips" role="group" aria-label="Quick notes">
              {offered.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className="chip"
                  aria-pressed={selected.includes(n.id)}
                  onClick={() => setSelected((v) => toggleQuickNote(v, n.id))}
                  disabled={!!pending}
                >
                  {n.label}
                </button>
              ))}
              <button
                type="button"
                className="chip"
                disabled={!!pending}
                onClick={() => {
                  setNote((v) => appendItsA(v));
                  // Focus now so typing lands in the note; the caret moves to
                  // the end once the new words are in.
                  noteRef.current?.focus();
                  setTimeout(() => {
                    const el = noteRef.current;
                    if (el) el.setSelectionRange(el.value.length, el.value.length);
                  }, 0);
                }}
              >
                It’s a…
              </button>
            </div>
            <div className="alt-revise-row">
              <label className="visually-hidden" htmlFor={ids.note}>
                What should change
              </label>
              <input
                ref={noteRef}
                id={ids.note}
                className="input"
                value={note}
                maxLength={ALT_TEXT_NOTE_MAX}
                placeholder="What should change? For example: it’s my dog, Juniper"
                disabled={!!pending}
                onChange={(e) => setNote(e.target.value.slice(0, ALT_TEXT_NOTE_MAX))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent?.isComposing && !e.metaKey && !e.ctrlKey) {
                    e.preventDefault();
                    generate('revise');
                  }
                }}
              />
              <Button onClick={() => generate('revise')} disabled={!!pending || !hasFollowUpDraft(selected, note)}>
                <Sparkles size={14} aria-hidden="true" />
                {pending === 'revise' ? 'Revising…' : 'Revise'}
              </Button>
            </div>
          </section>
        )}

        {canGenerate && (
          <p className="alt-disclosure">
            {usageLine && <span>{usageLine} </span>}
            Describing sends the image{postText.trim() ? ' and the post’s text' : ''} to Virga’s server, which asks an AI
            model. Check the words before you save them.
          </p>
        )}
      </div>
    </Dialog>
  );
}

/** The image as a File, from its preview when the composer kept no file. */
async function fileFromPreview(url) {
  if (!url) throw Object.assign(new Error('There’s no image to describe.'), { code: 'NO_IMAGE' });
  const blob = await (await fetch(url)).blob();
  return blob;
}
