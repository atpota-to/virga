// Defense › Lists › The moderator: linking this account to Virga's moderator,
// the Bluesky account owners DM commands to ("block @someone", "undo",
// "history"). Linking is a short code made here and sent to the moderator
// from this same account; the moderator answers only accounts that did it
// (docs/DEFENSE.md, "The moderator's conversations, kept apart").

import { useCallback, useEffect, useState } from 'react';
import Button from '../components/Button.jsx';
import { formatDateShort } from '../lib/time.js';
import { chooseLinkList, defenseErrorMessage, fetchLink, makeLinkCode, unlinkModerator } from './defenseService.js';

/** How often the link is read again while a code waits to be sent. */
const CODE_POLL_MS = 5_000;

export default function ModeratorCard({ lists }) {
  const req = lists.req;
  const [link, setLink] = useState(null);
  const [code, setCode] = useState(null); // { code, expiresAt }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!req) return;
    try {
      const next = await fetchLink(req);
      setLink(next);
      if (next.linked) setCode(null);
    } catch (err) {
      setError(defenseErrorMessage(err));
    }
  }, [req]);

  useEffect(() => {
    load();
  }, [load]);

  // While a code is out, look for the link to land, until the code expires.
  useEffect(() => {
    if (!code) return undefined;
    const timer = setInterval(() => {
      if (Date.parse(code.expiresAt) <= Date.now()) {
        setCode(null);
        return;
      }
      load();
    }, CODE_POLL_MS);
    return () => clearInterval(timer);
  }, [code, load]);

  const act = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(defenseErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const all = lists.data?.lists || [];
  const handle = link?.moderator;
  const listValue = link?.listId && all.some((l) => l.id === link.listId) ? link.listId : '';

  return (
    <section className="card defense-moderator" aria-labelledby="defense-moderator-title">
      <div className="card-head">
        <div>
          <h2 id="defense-moderator-title" className="card-title">
            The moderator
          </h2>
          <p className="card-sub">
            Virga’s Bluesky account for doing this by DM: send it “block @someone”, “undo” or “history” from this account, and it
            answers. It reads the commands it knows and nothing else, and acts only on your own lists.
          </p>
        </div>
        {link?.linked && handle && (
          <button
            type="button"
            className="link-action"
            disabled={busy}
            onClick={() =>
              act(async () => {
                await unlinkModerator(req);
                await load();
              })
            }
          >
            Unlink
          </button>
        )}
      </div>

      {!link ? (
        error ? (
          <p className="callout callout--danger" role="alert">
            {error}
          </p>
        ) : (
          <p className="empty">Reading…</p>
        )
      ) : !handle ? (
        <p className="callout">Virga’s moderator isn’t set up on this server yet.</p>
      ) : link.linked ? (
        <div className="defense-moderator-linked">
          <p>
            Linked{link.linkedAt ? ` since ${formatDateShort(link.linkedAt)}` : ''}. DM{' '}
            <a href={`https://bsky.app/profile/${handle}`} target="_blank" rel="noopener noreferrer">
              @{handle}
            </a>{' '}
            from this account; “help” lists what it does.
          </p>
          {all.length > 1 && (
            <label className="field">
              <span className="field-label">“block @someone” adds to</span>
              <select
                className="input"
                value={listValue}
                disabled={busy}
                onChange={(e) =>
                  act(async () => {
                    await chooseLinkList(req, e.target.value || null);
                    await load();
                  })
                }
              >
                <option value="">Ask me which</option>
                {all.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      ) : code ? (
        <div className="defense-moderator-code" role="status">
          <p>
            Send this to{' '}
            <a href={`https://bsky.app/profile/${handle}`} target="_blank" rel="noopener noreferrer">
              @{handle}
            </a>{' '}
            in a DM, from this account, within fifteen minutes:
          </p>
          <p className="defense-link-code">
            <code>link {code.code}</code>
          </p>
          <p className="meta">It works only from this account, and only once. This page notices when it lands.</p>
        </div>
      ) : (
        <div className="defense-actions">
          <Button
            onClick={() =>
              act(async () => {
                const made = await makeLinkCode(req);
                setCode({ code: made.code, expiresAt: made.expiresAt });
              })
            }
            disabled={busy}
            aria-busy={busy || undefined}
          >
            {busy ? 'Making a code…' : 'Link the moderator'}
          </Button>
        </div>
      )}
      {link && error && (
        <p className="callout callout--danger" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
