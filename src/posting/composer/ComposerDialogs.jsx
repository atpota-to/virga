import { useEffect, useId, useState } from 'react';
import Button from '../../components/Button.jsx';
import Dialog from '../../components/Dialog.jsx';
import PostPreview from '../ui/PostPreview.jsx';
import GatesEditor from '../ui/GatesEditor.jsx';
import LifespanEditor from '../ui/LifespanEditor.jsx';
import LanguagePicker from './LanguagePicker.jsx';
import { ADULT_LABEL_OPTIONS, GRAPHIC_LABEL } from './languages.js';
import { relativeTime } from '../../lib/time.js';
import { countGraphemes } from '../lib/graphemes.js';

/** A yes-or-no question over the composer; `choices` are its buttons. */
export function ConfirmDialog({ ask, onAnswer }) {
  return (
    <Dialog
      open={!!ask}
      onClose={() => onAnswer?.(null)}
      title={ask?.title || ''}
      actions={
        ask && (
          <>
            {ask.choices.map((c, i) => (
              <Button key={c.value} variant={c.primary ? 'primary' : c.danger ? 'danger' : 'quiet'} onClick={() => onAnswer?.(c.value)} data-autofocus={i === ask.choices.length - 1 || undefined}>
                {c.label}
              </Button>
            ))}
          </>
        )
      }
    >
      {ask?.body && <p>{ask.body}</p>}
    </Dialog>
  );
}

/** Languages and content labels for the whole post (every post of a thread). */
export function MetaDialog({ open, langs, labels, onClose, onSave }) {
  const id = useId();
  const [l, setL] = useState(langs || []);
  const [lab, setLab] = useState(labels || []);
  useEffect(() => {
    if (!open) return;
    setL(langs || []);
    setLab(labels || []);
  }, [open, langs, labels]);
  const adult = lab.find((x) => ADULT_LABEL_OPTIONS.some((o) => o.value === x)) || '';
  const graphic = lab.includes(GRAPHIC_LABEL.value);
  const setAdult = (v) => setLab([...(v ? [v] : []), ...(graphic ? [GRAPHIC_LABEL.value] : [])]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Language and content labels"
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              onSave?.({ langs: l, labels: lab });
              onClose?.();
            }}
          >
            Done
          </Button>
        </>
      }
    >
      <div className="dialog-form">
        <LanguagePicker label="Written in" hint="Up to three. Bluesky uses these for people’s language filters." value={l} onChange={setL} />
        <fieldset className="choice-list">
          <legend className="field-label">Adult content</legend>
          <p className="field-hint">Label it if it is, so people who’d rather not see it don’t.</p>
          <label className="choice" data-on={!adult || undefined}>
            <input type="radio" name={`${id}-adult`} checked={!adult} onChange={() => setAdult('')} />
            <span>
              <span className="choice-label">None</span>
            </span>
          </label>
          {ADULT_LABEL_OPTIONS.map((o) => (
            <label key={o.value} className="choice" data-on={adult === o.value || undefined}>
              <input type="radio" name={`${id}-adult`} checked={adult === o.value} onChange={() => setAdult(o.value)} />
              <span>
                <span className="choice-label">{o.label}</span>
                <span className="choice-desc">{o.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <label className="check">
          <input
            type="checkbox"
            checked={graphic}
            onChange={(e) => setLab([...(adult ? [adult] : []), ...(e.target.checked ? [GRAPHIC_LABEL.value] : [])])}
          />
          <span>
            {GRAPHIC_LABEL.label} <span className="field-hint">({GRAPHIC_LABEL.hint.toLowerCase()})</span>
          </span>
        </label>
      </div>
    </Dialog>
  );
}

/** Who can reply and quote, for this post only. */
export function GatesDialog({ open, did, value, sourceLine, onClose, onSave, onUseDefault }) {
  const [v, setV] = useState(value);
  useEffect(() => {
    if (open) setV(value);
  }, [open, value]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Who can reply and quote"
      actions={
        <>
          {onUseDefault && (
            <Button variant="ghost" onClick={onUseDefault}>
              Use my default
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              onSave?.(v);
              onClose?.();
            }}
          >
            Done
          </Button>
        </>
      }
    >
      <div className="dialog-form">
        {sourceLine && <p className="field-hint">{sourceLine}</p>}
        <GatesEditor did={did} value={v} onChange={setV} />
      </div>
    </Dialog>
  );
}

/** The post's timer: how long it stays up, and what it waits for. */
export function LifespanDialog({ open, value, fit, publishAt, limits, did, holds, note, onClose, onSave }) {
  const [rule, setRule] = useState(value);
  useEffect(() => {
    if (open) setRule(value);
  }, [open, value]);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Timer"
      className="lifespan-dialog"
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              onSave?.(rule);
              onClose?.();
            }}
          >
            Done
          </Button>
        </>
      }
    >
      <div className="dialog-form">
        {note && <p className="callout callout--warn">{note}</p>}
        <LifespanEditor value={rule} onChange={setRule} fit={fit} publishAt={publishAt} limits={limits} did={did} holds={holds} />
      </div>
    </Dialog>
  );
}

/** Pick one of the account's own recent posts to continue as a thread. */
export function ContinueThreadDialog({ open, status, items, error, onClose, onPick, onRetry }) {
  return (
    <Dialog open={open} onClose={onClose} title="Continue a thread" actions={<Button onClick={onClose}>Cancel</Button>}>
      <div className="dialog-form">
        <p className="field-hint">Your post will reply to the one you pick, so it reads as the next part of that thread.</p>
        {status === 'loading' && (
          <ul className="continue-list" aria-busy="true" aria-label="Your recent posts">
            {[0, 1, 2].map((i) => (
              <li key={i} className="post-preview post-preview--skeleton" data-compact>
                <span className="skeleton skeleton-line skeleton-line--short" />
                <span className="skeleton skeleton-line" />
              </li>
            ))}
          </ul>
        )}
        {status === 'error' && (
          <div className="callout callout--danger" role="alert">
            <span>{error || 'Couldn’t read your recent posts.'}</span>
            {onRetry && (
              <Button size="sm" onClick={onRetry}>
                Try again
              </Button>
            )}
          </div>
        )}
        {status === 'ready' && items.length === 0 && <p className="empty">No posts of yours to continue yet. Post something first.</p>}
        {status === 'ready' && items.length > 0 && (
          <ul className="continue-list" aria-label="Your recent posts">
            {items.map((item) => (
              <li key={item.uri}>
                <button type="button" className="continue-item" onClick={() => onPick?.(item)} aria-label={`Continue the post from ${relativeTime(item.at)}: ${item.text || 'no text'}`}>
                  <PostPreview view={item.view || null} record={item.view ? null : { text: item.text || '', createdAt: item.at }} uri={item.uri} compact />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

/** Alt text for a video: what someone who can't watch it should know. */
export function VideoAltDialog({ open, alt, max, onClose, onSave }) {
  const id = useId();
  const [text, setText] = useState(alt || '');
  useEffect(() => {
    if (open) setText(alt || '');
  }, [open, alt]);
  const over = max && countGraphemes(text) > max;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Describe the video"
      actions={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={over}
            onClick={() => {
              onSave?.(text.trim());
              onClose?.();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <label className="field" htmlFor={id}>
        <span className="field-label">What happens in it</span>
        <textarea id={id} className="input" rows={5} value={text} onChange={(e) => setText(e.target.value)} data-autofocus />
        {max && (
          <span className={`field-hint num${over ? ' is-over' : ''}`}>
            {countGraphemes(text)} of {max}
          </span>
        )}
      </label>
    </Dialog>
  );
}
