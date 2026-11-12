import { useId, useState } from 'react';
import { X } from 'lucide-react';
import { normalizeTags, MAX_TAGS } from '../lib/tags.js';

/**
 * The post's tags: words Bluesky files the post under without showing them
 * in the text. Typed with a comma or Enter between them; a leading "#" is
 * dropped, repeats are merged, at most eight.
 */
export default function TagsField({ tags = [], onChange, disabled = false }) {
  const id = useId();
  const [draft, setDraft] = useState('');
  const full = tags.length >= MAX_TAGS;
  const commit = (text) => {
    const next = normalizeTags([...tags, ...String(text).split(',')]);
    if (next.length !== tags.length || next.some((t, i) => t !== tags[i])) onChange?.(next);
    setDraft('');
  };
  return (
    <div className="tags-field">
      <label className="field-label" htmlFor={id}>
        Tags
      </label>
      <p className="field-hint" id={`${id}-hint`}>
        Not shown in the post, but Bluesky files it under them. Separate them with commas; up to {MAX_TAGS}.
      </p>
      <div className="tags-row">
        {tags.map((t) => (
          <span key={t} className="lang-chip">
            #{t}
            <button type="button" className="lang-chip-remove" aria-label={`Remove the tag ${t}`} disabled={disabled} onClick={() => onChange?.(tags.filter((x) => x !== t))}>
              <X size={13} aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          id={id}
          className="input tags-input"
          aria-describedby={`${id}-hint`}
          value={draft}
          disabled={disabled || full}
          placeholder={full ? 'That’s the most a post can have' : tags.length ? 'Another tag' : 'gardening, repair'}
          onChange={(e) => {
            const v = e.target.value;
            if (v.includes(',')) commit(v);
            else setDraft(v);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (draft.trim()) commit(draft);
            } else if (e.key === 'Backspace' && !draft && tags.length) {
              onChange?.(tags.slice(0, -1));
            }
          }}
          onBlur={() => draft.trim() && commit(draft)}
        />
      </div>
    </div>
  );
}
