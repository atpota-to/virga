// "Add to a list", under a scan's result: tick bands, pick a list (or make
// one), say why if you like, and approve. The plan is sent to Virga's server
// and the people in it are added by the run route, a batch every few minutes,
// with the veto read again at every write (docs/DEFENSE-THREATS.md).
//
// Nothing is offered from a scan that couldn't count who you know in common:
// without that count, "no connection" is a guess.

import { useMemo, useState } from 'react';
import { Link } from '../lib/router.jsx';
import Button from '../components/Button.jsx';
import Dialog from '../components/Dialog.jsx';
import { fmtInt } from '../lib/locale.js';
import { BAND_COUNTED, BAND_MEANS, BAND_WORD } from './bandWords.js';
import { APPROVABLE_BANDS, DEFAULT_BANDS, NOTE_MAX, PLAN_MAX, bandCounts, cleanNote, estimateWords, planRows } from './plan.js';
import { createList, defenseErrorMessage, planAndApprove } from './defenseService.js';
import { BandMark } from './Radar.jsx';

/** The order the bands are offered in: the strangers first, the nearest last. */
const OFFERED = APPROVABLE_BANDS;

export default function AddToList({ result, defense, lists }) {
  const { caps, session, asking, askFor } = defense;
  const [bands, setBands] = useState(() => new Set(DEFAULT_BANDS));
  const [listId, setListId] = useState('');
  const [newName, setNewName] = useState('');
  const [newPurpose, setNewPurpose] = useState('block');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(null);

  const counts = useMemo(() => bandCounts(result), [result]);
  const rows = useMemo(() => planRows(result, [...bands]), [result, bands]);
  const kept = useMemo(() => new Set((lists.data?.kept || []).map((k) => k.did)), [lists.data]);
  const adding = rows.filter((r) => !kept.has(r.did));
  const available = lists.data?.lists || [];
  const chosen = available.find((l) => l.id === listId) || (listId === 'new' ? null : available[0] || null);
  const making = listId === 'new' || !available.length;

  const why = whyNot({ result, caps, session, lists });
  return (
    <section className="card defense-add" aria-labelledby="defense-add-title">
      <div className="card-head">
        <div>
          <h2 id="defense-add-title" className="card-title">
            Add to a list
          </h2>
          <p className="card-sub">
            Choose who from this post goes on one of your block or mute lists. Anyone you follow, keep, or have on a curation list is
            left off, checked again as each one is written.
          </p>
        </div>
      </div>

      {why ? (
        <WhyNot why={why} asking={asking} onAsk={() => askFor('lists')} />
      ) : done ? (
        <div className="defense-done" role="status">
          <p>
            {done.queued
              ? `${fmtInt(done.queued)} queued for “${done.list}”. Writing starts within a few minutes and takes ${estimateWords(done.queued)}.`
              : `Nobody new to add to “${done.list}”: everyone ticked is on it already or kept.`}
            {done.kept ? ` ${fmtInt(done.kept)} you keep by hand left off.` : ''}
            {done.already ? ` ${fmtInt(done.already)} on it already.` : ''}
          </p>
          <p className="defense-done-links">
            <Link to="/defense/lists">Follow it on Lists</Link>
            <button type="button" className="link-action" onClick={() => setDone(null)}>
              Add more from this post
            </button>
          </p>
        </div>
      ) : (
        <form
          className="defense-add-form"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            if (adding.length && (!making || newName.trim())) setConfirming(true);
          }}
        >
          <fieldset className="defense-bands">
            <legend className="defense-legend">Who</legend>
            {OFFERED.map((band) => (
              <label key={band} className="defense-band-tick">
                <input
                  type="checkbox"
                  checked={bands.has(band)}
                  disabled={!counts[band]}
                  onChange={(e) =>
                    setBands((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(band);
                      else next.delete(band);
                      return next;
                    })
                  }
                />
                <BandMark band={band} />
                <span className="defense-band-tick-name">{BAND_WORD[band]}</span>
                <span className="num defense-band-tick-n">{fmtInt(counts[band] || 0)}</span>
                <span className="defense-band-tick-means">{BAND_MEANS[band]}</span>
              </label>
            ))}
            <p className="defense-band-never">
              <BandMark band="PROTECTED" /> {fmtInt(result.totals.byBand.PROTECTED || 0)} protected are never added.
            </p>
          </fieldset>

          <div className="defense-add-where">
            <label className="field">
              <span className="field-label">To</span>
              <select className="input" value={making ? 'new' : chosen?.id || ''} onChange={(e) => setListId(e.target.value)}>
                {available.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.purpose === 'mute' ? 'mute' : 'block'})
                  </option>
                ))}
                <option value="new">A new list…</option>
              </select>
            </label>
            {making && (
              <div className="defense-new-list">
                <label className="field">
                  <span className="field-label">Its name</span>
                  <input className="input" type="text" maxLength={64} value={newName} placeholder="Pile-ons" onChange={(e) => setNewName(e.target.value)} />
                </label>
                <label className="field">
                  <span className="field-label">For</span>
                  <select className="input" value={newPurpose} onChange={(e) => setNewPurpose(e.target.value)}>
                    <option value="block">Blocking</option>
                    <option value="mute">Muting</option>
                  </select>
                </label>
              </div>
            )}
            <label className="field">
              <span className="field-label">Why, in your words (optional)</span>
              <input className="input" type="text" maxLength={NOTE_MAX} value={note} placeholder="The quote pile-on, 18 November" onChange={(e) => setNote(e.target.value)} />
              <span className="field-hint">Kept with each of them, so “why is this person on my list” has an answer.</span>
            </label>
          </div>

          {adding.length > PLAN_MAX && <p className="callout callout--warn">That’s more than {fmtInt(PLAN_MAX)}, the most one plan holds. Tick fewer bands.</p>}
          <div className="defense-add-go">
            <Button type="submit" disabled={!adding.length || adding.length > PLAN_MAX || (making && !newName.trim()) || busy}>
              {adding.length ? `Add ${fmtInt(adding.length)}…` : 'Nobody ticked'}
            </Button>
            {adding.length > 0 && <span className="meta">{estimateWords(adding.length)} at Virga’s pace</span>}
          </div>
          {error && (
            <p className="callout callout--danger" role="alert">
              {error}
            </p>
          )}
        </form>
      )}

      <Dialog
        open={confirming}
        onClose={() => !busy && setConfirming(false)}
        title={`Add ${fmtInt(adding.length)} to ${making ? `a new list, “${newName.trim()}”` : `“${chosen?.name}”`}?`}
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant="primary"
              data-autofocus
              disabled={busy}
              aria-busy={busy || undefined}
              onClick={async () => {
                setBusy(true);
                setError(null);
                try {
                  const req = lists.req;
                  const list = making ? await createList(req, { name: newName.trim(), purpose: newPurpose }) : chosen;
                  const out = await planAndApprove(req, {
                    listId: list.id,
                    postUri: result.post?.uri || null,
                    rows: adding,
                    totals: { participants: result.totals.participants, ...result.totals.byBand },
                    bands: [...bands],
                    note: cleanNote(note),
                  });
                  setDone({ list: list.name, queued: out.queued, kept: out.kept, already: out.already });
                  setListId(list.id);
                  setNewName('');
                  lists.refresh();
                } catch (err) {
                  setError(defenseErrorMessage(err));
                } finally {
                  setBusy(false);
                  setConfirming(false);
                }
              }}
            >
              {busy ? 'Adding…' : `Add ${fmtInt(adding.length)}`}
            </Button>
          </>
        }
      >
        <div className="defense-confirm">
          <p>
            {[...bands]
              .filter((b) => counts[b])
              .map((b) => `${fmtInt(counts[b])} ${BAND_COUNTED[b]}`)
              .join(', ')}
            . They go on {making ? 'a new list in your repo' : 'the list'} {estimateWords(adding.length) === 'a minute or two' ? 'in a minute or two' : `over ${estimateWords(adding.length)}`}, a batch at a time.
          </p>
          <p>Anyone you follow by then, keep, or have on a curation list is left off at the moment they would be written. History can take the whole lot back.</p>
          {making && (
            <p>
              The list is made in your own repo, where anyone can see it on your profile. Once it’s there, open it in Bluesky and{' '}
              {newPurpose === 'mute' ? 'mute' : 'block'} it, so its members are {newPurpose === 'mute' ? 'muted' : 'blocked'} for you.
            </p>
          )}
        </div>
      </Dialog>
    </section>
  );
}

/** Why a scan's people can't be added from here, or null when they can. */
export function whyNot({ result, caps, session, lists }) {
  if (result?.vouchCheck !== 'canary') return { key: 'vouches', text: 'This scan couldn’t check who you know in common, so nothing from it can go on a list. Scan again later.' };
  if (caps.mode !== 'backend') {
    return session.authMode === 'backend'
      ? { key: 'long', text: 'Lists are written by Virga’s server while your browser is closed, so they need a long session. Reconnect for a longer session from the account menu.' }
      : { key: 'long', text: 'Lists are written by Virga’s server, which isn’t taking long sessions here.' };
  }
  if (lists.error) return { key: 'error', text: lists.error };
  if (!lists.data) return { key: 'loading', text: 'Reading your lists…' };
  if (lists.data.writes === false) return { key: 'off', text: 'Defense’s lists aren’t turned on on Virga’s server yet. A scan still shows you everything, and Export takes it with you.' };
  if (caps.lists === 'missing') return { key: 'scope', text: 'Defense needs one more permission to make lists and add people to them: writing list records in your repo, nothing else.' };
  return null;
}

function WhyNot({ why, asking, onAsk }) {
  return (
    <div className="defense-why-not">
      <p className={why.key === 'scope' || why.key === 'loading' ? 'callout' : 'callout callout--warn'}>{why.text}</p>
      {why.key === 'scope' && (
        <div className="defense-actions">
          <Button onClick={onAsk} disabled={asking?.busy}>
            {asking?.busy ? 'Opening the sign-in…' : 'Let Defense make lists'}
          </Button>
          {asking?.error && (
            <p className="callout callout--danger" role="alert">
              {asking.error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
