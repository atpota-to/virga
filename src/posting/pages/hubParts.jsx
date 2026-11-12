// Pieces the overview, Drafts, Posted and Templates pages share: a read that
// follows the account and the posting events, rows of bones shaped like the
// list that's loading, an error line with a way to try again, and the
// confirmation every delete asks.

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import Button from '../../components/Button.jsx';
import Dialog from '../../components/Dialog.jsx';
import { onPostingEvent } from '../events.js';
import './hub.css';

/**
 * `load(signal)` run for `key` (rerun when it changes), and again when any
 * of the posting `events` arrives for `did`. Returns `{ status, data, error,
 * reload }`; `status` is 'loading' only until the first answer, so a reload
 * keeps what's on screen. `enabled: false` reads nothing ('idle').
 */
export function useLoad(load, { key, did, events = [], enabled = true }) {
  const [state, setState] = useState({ status: enabled ? 'loading' : 'idle', data: null, error: null, key });
  const loadRef = useRef(load);
  loadRef.current = load;
  const run = useRef(0);

  const reload = useCallback(() => {
    if (!enabled) return undefined;
    const token = ++run.current;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    Promise.resolve()
      .then(() => loadRef.current(controller?.signal))
      .then(
        (data) => token === run.current && setState({ status: 'ready', data, error: null, key }),
        (error) => token === run.current && setState((s) => ({ ...s, status: s.data != null && s.key === key ? 'ready' : 'error', error, key })),
      );
    return () => controller?.abort();
  }, [enabled, key]);

  useEffect(() => {
    if (!enabled) {
      setState({ status: 'idle', data: null, error: null, key });
      return undefined;
    }
    setState((s) => (s.key === key ? s : { status: 'loading', data: null, error: null, key }));
    return reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key]);

  const eventKey = events.join('|');
  useEffect(() => {
    if (!enabled || !did || !events.length) return undefined;
    const offs = events.map((name) => onPostingEvent(name, () => reload(), { did }));
    return () => offs.forEach((off) => off());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, did, eventKey, reload]);

  return { ...state, reload };
}

/** Rows of bones shaped like a list of posts: a line or two of words, then a meta line. */
export function RowSkeleton({ rows = 3, actions = 0 }) {
  return (
    <ul className="hub-list hub-skeleton" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="hub-row">
          <div className="hub-row-main">
            <span className="hub-bone" style={{ width: `${[88, 64, 76, 58, 70][i % 5]}%` }} />
            {i % 2 === 0 && <span className="hub-bone" style={{ width: `${[52, 40, 46][i % 3]}%` }} />}
            <span className="hub-bone hub-bone--meta" style={{ width: `${[30, 24, 34, 28][i % 4]}%` }} />
          </div>
          {actions > 0 && (
            <div className="hub-row-actions">
              {Array.from({ length: actions }, (_, j) => (
                <span key={j} className="hub-bone hub-bone--button" />
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/** A read that failed: what happened, in a sentence, and Try again. */
export function LoadError({ message, onRetry }) {
  return (
    <div className="callout callout--danger hub-error" role="alert">
      <AlertTriangle aria-hidden="true" />
      <span>{message}</span>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          <RefreshCw size={14} aria-hidden="true" />
          Try again
        </Button>
      )}
    </div>
  );
}

/**
 * The question every delete asks first. `onConfirm` may return a promise:
 * the button shows busy until it settles and a rejection's message is
 * shown in the dialog, which stays open.
 */
export function ConfirmDialog({ open, title, children, confirmLabel = 'Delete', busyLabel = 'Deleting…', onConfirm, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) setError('');
  }, [open]);
  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      await onConfirm?.();
      onClose?.();
    } catch (err) {
      setError(err?.message || 'That didn’t work. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      title={title}
      tone="danger"
      actions={
        <>
          <Button onClick={onClose} disabled={busy} data-autofocus>
            Cancel
          </Button>
          <Button variant="danger" onClick={confirm} disabled={busy} aria-busy={busy || undefined}>
            {busy ? busyLabel : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="hub-confirm">
        {children}
        {error && (
          <p className="callout callout--danger" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
