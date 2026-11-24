// Defense › History: every approval and what came of it, and everyone added
// to or taken off a list, newest first, with the owner's own words. It's
// what "why is this person on my list" reads, and where an approval, or one
// person, is taken back (undo removes by the very record its add wrote).

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, Undo2 } from 'lucide-react';
import Button from '../components/Button.jsx';
import Dialog from '../components/Dialog.jsx';
import { useArchive } from '../archive/ArchiveContext.jsx';
import { fmtInt } from '../lib/locale.js';
import { formatDateShort } from '../lib/time.js';
import { PersonRow, useWantActors } from '../people/people.jsx';
import { bskyUrlFor } from '../posting/lib/postLink.js';
import { PageHeader } from '../shell/bits.jsx';
import { BAND_WORD } from './bandWords.js';
import { defenseErrorMessage, fetchHistory, undoAdds } from './defenseService.js';
import { decisionPhrase, planOutcome } from './historyModel.js';
import { DEFENSE_PAGE_BY_KEY } from './routes.js';
import { useDefenseAccount, useDefenseLists } from './useDefense.js';
import './defense.css';

const PAGE = DEFENSE_PAGE_BY_KEY.history;

export default function DefenseHistory() {
  const defense = useDefenseAccount();
  const lists = useDefenseLists(defense.did);
  const archive = useArchive();
  const [state, setState] = useState({ decisions: [], plans: [], loading: true, error: null, more: false });
  const [undoing, setUndoing] = useState(null); // { planId?, ids?, label }
  const [busy, setBusy] = useState(false);
  const req = lists.req;

  const load = useCallback(
    async (before = null) => {
      if (!req) {
        setState((s) => ({ ...s, loading: false }));
        return;
      }
      try {
        const data = await fetchHistory(req, { before });
        setState((s) => ({
          decisions: before ? [...s.decisions, ...data.decisions] : data.decisions,
          plans: before ? s.plans : data.plans,
          loading: false,
          error: null,
          more: data.decisions.length >= 200,
        }));
      } catch (err) {
        setState((s) => ({ ...s, loading: false, error: defenseErrorMessage(err) }));
      }
    },
    [req],
  );

  useEffect(() => {
    load();
  }, [load]);
  // While anything is being written, the history moves with it.
  const waiting = state.decisions.some((d) => d.state === 'queued' || d.state === 'sent');
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setInterval(() => load(), 15_000);
    return () => clearInterval(timer);
  }, [waiting, load]);

  const listName = useMemo(() => new Map((lists.data?.lists || []).map((l) => [l.id, l.name])), [lists.data]);
  useWantActors(archive, state.decisions.slice(0, 200).map((d) => d.did));

  const confirmUndo = async () => {
    setBusy(true);
    try {
      await undoAdds(req, { planId: undoing.planId || null, ids: undoing.ids || null });
      setUndoing(null);
      await load();
    } catch (err) {
      setState((s) => ({ ...s, error: defenseErrorMessage(err) }));
      setUndoing(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader crumbs={[{ label: 'Defense', to: '/defense' }]} title={PAGE.title} sub={PAGE.desc} access={['lists']} />
      <div className="page-body defense">
        {!req ? (
          <p className="callout callout--warn">The history is kept by Virga’s server, so it needs a long session. Reconnect from the account menu.</p>
        ) : state.loading ? (
          <p className="empty">Reading the history…</p>
        ) : (
          <>
            {state.error && (
              <p className="callout callout--danger" role="alert">
                {state.error}
              </p>
            )}
            <section className="card" aria-labelledby="defense-plans-title">
              <div className="card-head">
                <div>
                  <h2 id="defense-plans-title" className="card-title">
                    Approvals
                  </h2>
                  <p className="card-sub">Each time you added people from a scan, and what came of it.</p>
                </div>
              </div>
              {state.plans.length ? (
                <ul className="defense-plan-rows">
                  {state.plans.map((p) => {
                    const out = planOutcome(p);
                    const post = p.postUri ? bskyUrlFor(p.postUri) : null;
                    return (
                      <li key={p.id} className="defense-plan-row">
                        <span className="defense-list-main">
                          <span className="defense-list-name">{p.note || `From a scan, ${formatDateShort(p.approvedAt)}`}</span>
                          <span className="meta">
                            <span>{formatDateShort(p.approvedAt)}</span>
                            <span>to “{listName.get(p.listId) || 'a list no longer kept'}”</span>
                            <span>{(p.bands || []).map((b) => BAND_WORD[b]?.toLowerCase()).join(', ')}</span>
                            {post && (
                              <a href={post} target="_blank" rel="noopener noreferrer">
                                the post <ExternalLink size={11} aria-hidden="true" />
                              </a>
                            )}
                          </span>
                          <span className="meta num">{out.line}</span>
                        </span>
                        {out.live > 0 && (
                          <button type="button" className="link-action" onClick={() => setUndoing({ planId: p.id, label: `${fmtInt(out.live)} from this approval` })}>
                            <Undo2 size={14} aria-hidden="true" />
                            Undo
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="empty">Nothing approved yet. Scan a post, and Add to a list under its result.</p>
              )}
            </section>

            <section className="card" aria-labelledby="defense-everyone-title">
              <div className="card-head">
                <div>
                  <h2 id="defense-everyone-title" className="card-title">
                    Everyone
                  </h2>
                  <p className="card-sub">Newest first. A vetoed add is someone the veto kept off at the moment they would have been written.</p>
                </div>
              </div>
              {state.decisions.length ? (
                <ul className="widget-rows report-rows">
                  {state.decisions.map((d) => (
                    <PersonRow
                      key={d.id}
                      archive={archive}
                      did={d.did}
                      meta={[decisionPhrase(d), listName.get(d.listId) ? `“${listName.get(d.listId)}”` : null, formatDateShort(d.actedAt || d.createdAt), d.note].filter(Boolean).join(' · ')}
                      extra={
                        d.action === 'add' && !d.undoneAt && (d.state === 'done' || d.state === 'queued' || d.state === 'sent') ? (
                          <Button size="sm" variant="ghost" onClick={() => setUndoing({ ids: [d.id], label: 'this person' })}>
                            Take off
                          </Button>
                        ) : null
                      }
                    />
                  ))}
                </ul>
              ) : (
                <p className="empty">Nobody added or taken off yet.</p>
              )}
              {state.more && (
                <div className="card-foot">
                  <button type="button" className="link-action" onClick={() => load(state.decisions.at(-1)?.id)}>
                    Show older
                  </button>
                </div>
              )}
            </section>
          </>
        )}
      </div>
      <Dialog
        open={Boolean(undoing)}
        onClose={() => !busy && setUndoing(null)}
        title={`Take ${undoing?.label || 'them'} off the list?`}
        actions={
          <>
            <Button variant="ghost" onClick={() => setUndoing(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" data-autofocus onClick={confirmUndo} disabled={busy} aria-busy={busy || undefined}>
              {busy ? 'Taking off…' : 'Take off'}
            </Button>
          </>
        }
      >
        <p>Adds not written yet are cancelled. The rest come off a batch at a time. Anyone added another way stays.</p>
      </Dialog>
    </>
  );
}
