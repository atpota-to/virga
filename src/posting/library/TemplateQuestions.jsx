import { useId, useMemo, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import Button from '../../components/Button.jsx';
import { initialAnswers, missingAnswers, templateQuestions } from '../templates/postTemplates.js';
import { itemFromTemplate, previewFor } from './model.js';
import { templateContextFrom } from './libraryUi.js';
import './library.css';

const isPlainEnter = (e) =>
  e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && !e.nativeEvent?.isComposing;

/**
 * A radio group of buttons with one tab stop: the arrow keys move and
 * choose, as native radios do. Choosing the chosen option again clears it
 * when `allowClear` is set, so an optional question can be left blank again.
 */
export function ChoiceGroup({ id, options, value, onChange, labelledBy, describedBy, required = false, allowClear = false }) {
  const ref = useRef(null);
  const chosen = options.findIndex((o) => o === value);
  const stop = chosen >= 0 ? chosen : 0;
  const focusAt = (i) => ref.current?.querySelectorAll('[role="radio"]')[i]?.focus();
  return (
    <div
      ref={ref}
      id={id}
      role="radiogroup"
      className="lib-choices"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-required={required || undefined}
    >
      {options.map((option, i) => {
        const on = i === chosen;
        return (
          <button
            key={`${i}:${option}`}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={i === stop ? 0 : -1}
            className="lib-choice"
            onClick={() => onChange(allowClear && on ? '' : option)}
            onKeyDown={(e) => {
              const n = options.length;
              let next = null;
              if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (i + 1) % n;
              else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (i - 1 + n) % n;
              else if (e.key === 'Home') next = 0;
              else if (e.key === 'End') next = n - 1;
              if (next == null) return;
              e.preventDefault();
              onChange(options[next]);
              focusAt(next);
            }}
          >
            <span className="lib-choice-label">{option}</span>
            <Check size={15} aria-hidden="true" className="lib-choice-check" />
          </button>
        );
      })}
    </div>
  );
}

/**
 * What the post will read with a library item used (previewFor's result):
 * the words already there dimmed, what's added plain, what fills itself
 * underlined, answers tinted and blanks still to answer as dashed chips;
 * the count against 300, what it attaches, and any notes.
 */
export function TemplatePreview({ preview, label = 'The post will read', maxLength = 300 }) {
  if (!preview) return null;
  const parts = (preview.parts || []).filter((p) => p?.text);
  return (
    <div className="lib-preview">
      <div className="lib-preview-head">
        <span className="lib-eyebrow">{label}</span>
        <span className={`lib-preview-count num${preview.overLimit ? ' is-over' : ''}`}>
          {preview.count.toLocaleString('en-US')} of {maxLength}
          {preview.overLimit && <span className="visually-hidden">, over the limit</span>}
        </span>
      </div>
      {parts.length ? (
        <p className="lib-preview-text">
          {parts.map((part, i) => (
            <span key={i} className={`lib-part lib-part--${part.kind}`}>
              {part.kind === 'blank' && <span className="visually-hidden">blank: </span>}
              {part.text}
            </span>
          ))}
        </p>
      ) : (
        <p className="lib-preview-text muted">The text stays as it is.</p>
      )}
      {preview.attachment && (
        <div className="lib-preview-attach">
          <span className="lib-preview-attach-by">{preview.attachment.by}</span>
          {preview.attachment.title && <span className="lib-preview-attach-title">{preview.attachment.title}</span>}
        </div>
      )}
      {preview.notes?.map((note) => (
        <p key={note} className="lib-preview-note">
          {note}
        </p>
      ))}
      {preview.blocked && (
        <p className="lib-preview-blocked" role="status">
          {preview.blocked}
        </p>
      )}
    </div>
  );
}

/**
 * A template's questions, asked before it fills a post: a text field per
 * typed question and a radio group per choice question, with a live preview
 * of what the post will read. Blanks the context fills (who is replied to,
 * your handle, today) aren't asked. `onDone(answers)` once every required
 * question has an answer; `onCancel` to go back.
 *
 * `context` is a template context or a LibraryDialog context
 * (`{ state, reply? }`). Optional: `state`, `postIndex` and `insertion` show
 * the preview within the post being written; `embedView` is what the
 * template quotes, read; `submitLabel` names the button ("Put in reply");
 * `busy` while the caller is acting on it.
 */
export default function TemplateQuestions({
  template,
  context,
  onDone,
  onCancel,
  submitLabel = 'Use it',
  cancelLabel = 'Cancel',
  state = null,
  postIndex = 0,
  insertion = null,
  embedView,
  selfHandle,
  busy = false,
  autoFocus = false,
}) {
  const idPrefix = useId();
  const formRef = useRef(null);
  const ctx = useMemo(() => templateContextFrom(context, { selfHandle }), [context, selfHandle]);
  const questions = useMemo(() => templateQuestions(template, ctx), [template, ctx]);
  const [answers, setAnswers] = useState(() => initialAnswers(questions));
  const [tried, setTried] = useState(false);
  const missing = missingAnswers(questions, answers);
  const item = useMemo(() => itemFromTemplate(template, ctx, { embedView }), [template, ctx, embedView]);
  const preview = previewFor(item, {
    state,
    postIndex,
    currentText: state ? undefined : '',
    insertion: insertion || undefined,
    answers,
    context: ctx,
  });
  const set = (key, value) => setAnswers((a) => ({ ...a, [key]: value }));

  const focusKey = (key) => {
    const el = formRef.current?.querySelector(`[data-question-key="${CSS.escape(key)}"]`);
    const target = el?.querySelector('input') || el?.querySelector('[role="radio"][aria-checked="true"]') || el?.querySelector('[role="radio"]');
    target?.focus();
  };

  const submit = (event) => {
    event?.preventDefault();
    if (busy) return;
    if (missing.length) {
      setTried(true);
      focusKey(missing[0]);
      return;
    }
    onDone?.(answers);
  };

  const unusable = !preview.usable;

  return (
    <form ref={formRef} className="lib-questions" onSubmit={submit} noValidate>
      {questions.length > 0 && (
        <div className="lib-question-list">
          {questions.map((q, index) => {
            const fieldId = `${idPrefix}-q${index}`;
            const hintId = q.hint ? `${fieldId}-hint` : undefined;
            const noteId = q.note ? `${fieldId}-note` : undefined;
            const errorId = tried && missing.includes(q.key) ? `${fieldId}-err` : undefined;
            const describedBy = [hintId, noteId, errorId].filter(Boolean).join(' ') || undefined;
            const label = (
              <>
                {q.label}
                {q.optional && <span className="lib-optional"> · optional</span>}
              </>
            );
            return (
              <div key={`${index}:${q.key}`} className="field lib-question" data-question-key={q.key}>
                {q.kind === 'choice' ? (
                  <>
                    <span id={`${fieldId}-label`} className="field-label">
                      {label}
                    </span>
                    <ChoiceGroup
                      id={fieldId}
                      labelledBy={`${fieldId}-label`}
                      describedBy={describedBy}
                      options={q.choices}
                      value={answers[q.key] || ''}
                      onChange={(v) => set(q.key, v)}
                      required={!q.optional}
                      allowClear
                    />
                  </>
                ) : (
                  <>
                    <label className="field-label" htmlFor={fieldId}>
                      {label}
                    </label>
                    <input
                      id={fieldId}
                      className="input"
                      type="text"
                      autoComplete="off"
                      value={answers[q.key] || ''}
                      aria-describedby={describedBy}
                      aria-required={q.optional ? undefined : 'true'}
                      aria-invalid={errorId ? 'true' : undefined}
                      data-autofocus={autoFocus && index === 0 ? true : undefined}
                      onChange={(e) => set(q.key, e.target.value)}
                      onKeyDown={(e) => {
                        if (!isPlainEnter(e)) return;
                        e.preventDefault();
                        e.stopPropagation();
                        const next = missing.find((k) => k !== q.key);
                        if (next) focusKey(next);
                        else submit();
                      }}
                    />
                  </>
                )}
                {q.hint && (
                  <p id={hintId} className="field-hint">
                    {q.hint}
                  </p>
                )}
                {q.note && (
                  <p id={noteId} className="field-hint lib-question-note">
                    {q.note}
                  </p>
                )}
                {errorId && (
                  <p id={errorId} className="field-hint lib-question-error">
                    Answer this one first.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
      <TemplatePreview preview={preview} label={ctx?.their ? 'Your reply will read' : 'Your post will read'} />
      <div className="lib-questions-actions">
        {onCancel && (
          <Button onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
        )}
        <Button variant="primary" type="submit" disabled={busy || unusable} aria-busy={busy || undefined}>
          {busy ? 'Adding…' : submitLabel}
        </Button>
      </div>
      {tried && missing.length > 0 && (
        <p className="sr-status visually-hidden" role="status">
          {missing.length === 1 ? 'One question still needs an answer.' : `${missing.length} questions still need an answer.`}
        </p>
      )}
    </form>
  );
}
