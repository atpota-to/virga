import { useEffect, useId, useRef, useState } from 'react';
import Avatar from '../components/Avatar.jsx';
import { cleanTyped } from './identity.js';
import { SUGGEST_DEBOUNCE_MS, moveActive, searchAccounts, suggestQuery } from './suggest.js';

/**
 * The handle field, with accounts suggested under it as the handle is typed.
 * A combobox in the ARIA sense: the list is announced, the arrows move
 * through it without the caret leaving the field, Enter takes the marked
 * suggestion (or, with none marked, submits the form as any field does), and
 * Escape puts the list away.
 *
 * `onPick(handle)` is told when a suggestion is chosen. A search that fails
 * shows nothing: the field works without suggestions.
 */
export default function HandleField({ id, value, onChange, onPick, invalid = false, describedBy, disabled = false, autoFocus = false, inputRef = null, size = 'lg' }) {
  const listId = useId();
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const own = useRef(null);
  const field = inputRef || own;
  // A suggestion just taken is in the field now; it shouldn't be searched for.
  const skip = useRef(null);
  // Suggestions answer typing. A handle that was already in the field when
  // it came back on screen (after "Not you?") isn't a question.
  const typed = useRef(false);

  useEffect(() => {
    const query = suggestQuery(value);
    if (!query || disabled || !typed.current || query === skip.current) {
      setItems([]);
      setOpen(false);
      setActive(-1);
      return undefined;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchAccounts(query, { signal: controller.signal })
        .then((found) => {
          if (controller.signal.aborted) return;
          setItems(found);
          setActive(-1);
          // Only for a field someone is in: an answer that arrives after
          // they left shouldn't open a list over the page.
          setOpen(found.length > 0 && document.activeElement === field.current);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setItems([]);
          setOpen(false);
        });
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value, disabled, field]);

  function pick(item) {
    skip.current = item.handle;
    setOpen(false);
    setItems([]);
    setActive(-1);
    onPick?.(item.handle);
  }

  function onKeyDown(event) {
    if (event.key === 'Escape' && open) {
      // The list goes away; the dialog the field may be in stays.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      setActive(-1);
      return;
    }
    if (!items.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(event.key === 'ArrowDown' ? 0 : items.length - 1);
      } else setActive((index) => moveActive(index, items.length, event.key));
      return;
    }
    if (!open) return;
    if (event.key === 'Enter' && active >= 0) {
      event.preventDefault();
      pick(items[active]);
    } else if (event.key === 'Tab') {
      setOpen(false);
      setActive(-1);
    }
  }

  const optionId = (index) => `${listId}-${index}`;
  const showing = open && items.length > 0;

  return (
    <div className="handle-field" data-open={showing || undefined}>
      <span className="handle-field-at" aria-hidden="true">
        @
      </span>
      {/* A handle is not prose: iOS otherwise capitalizes the first letter
          and runs autocorrect over it, and each of the three has to be turned
          off by name. inputMode="url" puts the '.' on the first key plane,
          and enterKeyHint labels the return key for what it does. */}
      <input
        ref={field}
        id={id}
        className={`input handle-field-input${size === 'lg' ? ' input--lg' : ''}`}
        type="text"
        name="handle"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={showing}
        aria-controls={showing ? listId : undefined}
        aria-activedescendant={showing && active >= 0 ? optionId(active) : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        autoComplete="username"
        autoCorrect="off"
        autoCapitalize="none"
        inputMode="url"
        enterKeyHint="go"
        spellCheck={false}
        placeholder="you.bsky.social"
        value={value}
        disabled={disabled}
        data-autofocus={autoFocus || undefined}
        onChange={(event) => {
          typed.current = true;
          skip.current = null;
          onChange(cleanTyped(event.target.value));
        }}
        onKeyDown={onKeyDown}
        onFocus={() => {
          if (items.length) setOpen(true);
        }}
        onBlur={() => {
          setOpen(false);
          setActive(-1);
        }}
      />
      {showing && (
        <ul className="handle-suggestions" id={listId} role="listbox" aria-label="Accounts that match">
          {items.map((item, index) => (
            <li
              key={item.did}
              id={optionId(index)}
              className="handle-suggestion"
              role="option"
              aria-selected={index === active}
              // The press would take focus from the field, and its blur would
              // put the list away before the click arrived.
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => pick(item)}
            >
              <Avatar src={item.avatar} name={item.displayName || item.handle} size="sm" />
              <span className="handle-suggestion-text">
                {item.displayName && <span className="handle-suggestion-name">{item.displayName}</span>}
                <span className="handle-suggestion-handle">@{item.handle}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
