// Defense › Lists: the block and mute lists Defense keeps for the account,
// what each holds by Virga's hand and what is still being written, a new one,
// and the people kept off every list by hand.
//
// The lists are records in the account's own repo (mode 'own',
// docs/DEFENSE.md): anyone can see them on its profile, and the account blocks
// or mutes one in Bluesky to have it take effect. The writing is done by
// Virga's server, so this page reads it back every few seconds while anything
// waits.

import { useState } from 'react';
import { ExternalLink, Plus } from 'lucide-react';
import Button from '../components/Button.jsx';
import { useArchive } from '../archive/ArchiveContext.jsx';
import { fmtInt } from '../lib/locale.js';
import { formatDateShort } from '../lib/time.js';
import { PersonRow, useWantActors } from '../people/people.jsx';
import { bskyUrlFor } from '../posting/lib/postLink.js';
import { resolveHandle } from '../posting/library/sources.js';
import { PageHeader } from '../shell/bits.jsx';
import { whyNot } from './AddToList.jsx';
import { createList, defenseErrorMessage, keepAccount, unkeepAccount } from './defenseService.js';
import { DEFENSE_PAGE_BY_KEY } from './routes.js';
import { useDefenseAccount, useDefenseLists } from './useDefense.js';
import './defense.css';

const PAGE = DEFENSE_PAGE_BY_KEY.lists;

/** "held until 14:20: the PDS's write limit was reached", or null. */
function heldLine(list) {
  if (!list.heldUntil && !list.lastError) return null;
  const until = list.heldUntil ? new Date(list.heldUntil) : null;
  const when = until && until.getTime() > Date.now() ? `Waiting until ${until.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : null;
  return [when, list.lastError].filter(Boolean).join(': ');
}

export default function DefenseLists() {
  const defense = useDefenseAccount();
  const lists = useDefenseLists(defense.did);
  // The scan's conditions, without a scan: a list is made and written the same way.
  const why = whyNot({ result: { vouchCheck: 'canary' }, caps: defense.caps, session: defense.session, lists });

  return (
    <>
      <PageHeader crumbs={[{ label: 'Defense', to: '/defense' }]} title={PAGE.title} sub={PAGE.desc} access={['lists']} />
      <div className="page-body defense">
        {why ? (
          <section className="card">
            <p className={why.key === 'scope' || why.key === 'loading' ? 'callout' : 'callout callout--warn'}>{why.text}</p>
            {why.key === 'scope' && (
              <div className="defense-actions">
                <Button onClick={() => defense.askFor('lists')} disabled={defense.asking?.busy}>
                  {defense.asking?.busy ? 'Opening the sign-in…' : 'Let Defense make lists'}
                </Button>
              </div>
            )}
          </section>
        ) : (
          <>
            <YourLists lists={lists} />
            <KeptByHand lists={lists} />
          </>
        )}
      </div>
    </>
  );
}

function YourLists({ lists }) {
  const [making, setMaking] = useState(false);
  const [name, setName] = useState('');
  const [purpose, setPurpose] = useState('block');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const all = lists.data?.lists || [];

  return (
    <section className="card" aria-labelledby="defense-lists-title">
      <div className="card-head">
        <div>
          <h2 id="defense-lists-title" className="card-title num">
            {all.length ? `${fmtInt(all.length)} ${all.length === 1 ? 'list' : 'lists'}` : 'Your lists'}
          </h2>
          <p className="card-sub">In your own repo, on your profile. Block or mute one in Bluesky for it to take effect for you.</p>
        </div>
        {!making && (
          <button type="button" className="link-action" onClick={() => setMaking(true)}>
            <Plus size={14} aria-hidden="true" />
            New list
          </button>
        )}
      </div>

      {making && (
        <form
          className="defense-new-list defense-new-list--page"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!name.trim()) return;
            setBusy(true);
            setError(null);
            try {
              await createList(lists.req, { name: name.trim(), purpose });
              setMaking(false);
              setName('');
              lists.refresh();
            } catch (err) {
              setError(defenseErrorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            <span className="field-label">Name</span>
            <input className="input" type="text" maxLength={64} value={name} placeholder="Pile-ons" onChange={(e) => setName(e.target.value)} data-autofocus />
          </label>
          <label className="field">
            <span className="field-label">For</span>
            <select className="input" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
              <option value="block">Blocking</option>
              <option value="mute">Muting</option>
            </select>
          </label>
          <div className="defense-new-list-go">
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy ? 'Making it…' : 'Make the list'}
            </Button>
            <Button variant="ghost" onClick={() => setMaking(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
          {error && (
            <p className="callout callout--danger" role="alert">
              {error}
            </p>
          )}
        </form>
      )}

      {all.length ? (
        <ul className="defense-list-rows">
          {all.map((l) => {
            const held = heldLine(l);
            const url = bskyUrlFor(l.uri);
            return (
              <li key={l.id} className="defense-list-row">
                <span className="defense-list-main">
                  {url ? (
                    <a className="defense-list-name" href={url} target="_blank" rel="noopener noreferrer">
                      {l.name}
                      <ExternalLink size={12} aria-hidden="true" />
                    </a>
                  ) : (
                    <span className="defense-list-name">{l.name}</span>
                  )}
                  <span className="meta">
                    <span>{l.purpose === 'mute' ? 'To mute' : 'To block'}</span>
                    <span className="num">{fmtInt(l.listed)} on it by Virga</span>
                    {l.waiting > 0 && <span className="num">{fmtInt(l.waiting)} being written</span>}
                    <span>Made {formatDateShort(l.createdAt)}</span>
                  </span>
                  {held && <span className="defense-list-held">{held}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        !making && <p className="empty">No lists yet. Make one here, or from a scan’s Add to a list.</p>
      )}
    </section>
  );
}

function KeptByHand({ lists }) {
  const archive = useArchive();
  const kept = lists.data?.kept || [];
  useWantActors(archive, kept.map((k) => k.did));
  const [handle, setHandle] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  return (
    <section className="card" aria-labelledby="defense-kept-title">
      <div className="card-head">
        <div>
          <h2 id="defense-kept-title" className="card-title num">
            {kept.length ? `${fmtInt(kept.length)} kept by hand` : 'Kept by hand'}
          </h2>
          <p className="card-sub">Never added to any of your lists, whatever a scan says. Everyone you follow is kept already.</p>
        </div>
      </div>
      <form
        className="defense-keep-form"
        onSubmit={async (event) => {
          event.preventDefault();
          const text = handle.trim().replace(/^@/, '');
          if (!text) return;
          setBusy('add');
          setError(null);
          try {
            const did = text.startsWith('did:') ? text : await resolveHandle(text);
            if (!did) throw new Error(`Couldn’t find @${text}.`);
            await keepAccount(lists.req, did, reason.trim() || null);
            setHandle('');
            setReason('');
            lists.refresh();
          } catch (err) {
            setError(defenseErrorMessage(err));
          } finally {
            setBusy(null);
          }
        }}
      >
        <label className="field">
          <span className="field-label">Keep</span>
          <input className="input" type="text" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="@handle" value={handle} onChange={(e) => setHandle(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">Why (optional)</span>
          <input className="input" type="text" maxLength={200} placeholder="My sister’s other account" value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <Button type="submit" disabled={busy === 'add' || !handle.trim()}>
          Keep
        </Button>
      </form>
      {error && (
        <p className="callout callout--danger" role="alert">
          {error}
        </p>
      )}
      {kept.length > 0 && (
        <ul className="widget-rows report-rows">
          {kept.map((k) => (
            <PersonRow
              key={k.did}
              archive={archive}
              did={k.did}
              meta={k.reason}
              extra={
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy === k.did}
                  onClick={async () => {
                    setBusy(k.did);
                    try {
                      await unkeepAccount(lists.req, k.did);
                      lists.refresh();
                    } catch (err) {
                      setError(defenseErrorMessage(err));
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  Stop keeping
                </Button>
              }
            />
          ))}
        </ul>
      )}
    </section>
  );
}
