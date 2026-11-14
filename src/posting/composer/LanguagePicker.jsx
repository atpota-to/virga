import { useId, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { languageName, searchLanguages } from './languages.js';

const MAX = 3;

function preferredLanguages() {
  try {
    return typeof navigator !== 'undefined' ? navigator.languages || [navigator.language] : [];
  } catch {
    return [];
  }
}

/**
 * Up to three languages: the chosen ones as chips that can be taken off, and
 * a search field that suggests more (by name or code). A combobox: ↑ and ↓
 * move through the suggestions, Enter adds one, Escape closes them.
 */
export default function LanguagePicker({ value = [], onChange, label = 'Languages', hint = null, disabled = false }) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const chosen = (value || []).slice(0, MAX);
  const full = chosen.length >= MAX;
  const options = useMemo(
    () => (open && !full ? searchLanguages(query, { chosen, preferred: preferredLanguages(), limit: 6 }) : []),
    [open, full, query, chosen],
  );
  const listId = `${id}-list`;
  const add = (code) => {
    if (!code || chosen.includes(code) || full) return;
    onChange?.([...chosen, code]);
    setQuery('');
    setActive(0);
    setOpen(false);
  };

  return (
    <div className="lang-picker">
      <label className="field-label" htmlFor={`${id}-input`}>
        {label}
      </label>
      {hint && <p className="field-hint">{hint}</p>}
      <div className="lang-chips" aria-live="polite">
        {chosen.length === 0 && <span className="field-hint">None chosen</span>}
        {chosen.map((code) => (
          <span key={code} className="lang-chip">
            {languageName(code)}
            <button
              type="button"
              className="lang-chip-remove"
              aria-label={`Remove ${languageName(code)}`}
              disabled={disabled}
              onClick={() => onChange?.(chosen.filter((c) => c !== code))}
            >
              <X size={13} aria-hidden="true" />
            </button>
          </span>
        ))}
      </div>
      <div className="lang-search">
        <input
          id={`${id}-input`}
          className="input"
          type="text"
          role="combobox"
          aria-expanded={options.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={options.length ? `${id}-opt-${active}` : undefined}
          autoComplete="off"
          placeholder={full ? 'Three languages is the most a post can have' : 'Add a language'}
          disabled={disabled || full}
          value={query}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (!options.length) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => (a + 1) % options.length);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => (a - 1 + options.length) % options.length);
            } else if (e.key === 'Enter') {
              e.preventDefault();
              add(options[active]?.code);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }
          }}
        />
        {options.length > 0 && (
          <ul id={listId} className="suggest-list" role="listbox" aria-label="Languages">
            {options.map((o, i) => (
              <li
                key={o.code}
                id={`${id}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                className="suggest-item"
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => add(o.code)}
              >
                <span>{o.name}</span>
                <span className="suggest-meta">{o.code}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
