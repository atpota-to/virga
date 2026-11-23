// Follow cleanup: the accounts you follow that have gone quiet, are gone, or
// don't follow you back, with a bulk Unfollow. Nothing is unfollowed until
// it is asked for, every unfollow can be undone from the same row, and an
// account marked Keep is never suggested again.

import { useMemo, useRef, useState } from 'react';
import { Download, Eye, EyeOff, RefreshCw } from 'lucide-react';
import Avatar from '../components/Avatar.jsx';
import Button from '../components/Button.jsx';
import Dialog from '../components/Dialog.jsx';
import { useArchive } from '../archive/ArchiveContext.jsx';
import { exportRows } from '../archive/exports.js';
import { formatDateShort, relativeTime } from '../lib/time.js';
import { cardFor, displayName, profileUrl, useFollow, useWantActors } from '../people/people.jsx';
import { relationSets } from '../reports/models.js';
import { useToast } from '../shell/bits.jsx';
import { ToolHeader } from './ToolPage.jsx';
import { useKeepList } from './keep.js';
import { activeLocale } from '../lib/locale.js';

const DAY_MS = 86_400_000;
const PAGE = 50;
const QUIET_CHOICES = [30, 90, 180, 365];

export default function FollowCleanup({ tool }) {
  const archive = useArchive();
  const follow = useFollow(archive);
  const toast = useToast();
  const keep = useKeepList(archive.did, 'cleanup');
  const [filter, setFilter] = useState('quiet');
  const [quietDays, setQuietDays] = useState(90);
  const [sort, setSort] = useState('quiet');
  const [selected, setSelected] = useState(() => new Set());
  const [undo, setUndo] = useState(() => new Set());
  const [limit, setLimit] = useState(PAGE);
  const [showKept, setShowKept] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(null); // { done, total }
  const [checking, setChecking] = useState(null); // { done, total }
  const abortRef = useRef(null);
  const nowMs = archive.nowMs;

  // Every account followed, once, with what is known about it.
  const rows = useMemo(() => {
    const sets = relationSets(archive);
    const interactions = new Map();
    const yearAgo = nowMs - 365 * DAY_MS;
    const bump = (did, at) => {
      if (!did) return;
      const t = Date.parse(at || '');
      const e = interactions.get(did) || { all: 0, recent: 0 };
      e.all += 1;
      if (Number.isFinite(t) && t >= yearAgo) e.recent += 1;
      interactions.set(did, e);
    };
    for (const ev of archive.inbound) bump(ev.did, ev.at);
    for (const ev of archive.outbound) bump(ev.did, ev.at);
    const seen = new Map();
    for (const f of archive.following) {
      const prev = seen.get(f.did);
      if (!prev || Date.parse(f.followedAt || '') < Date.parse(prev.followedAt || '')) seen.set(f.did, f);
    }
    return [...seen.values()].map((f) => {
      const card = archive.actors.get(f.did);
      const last = Date.parse(card?.lastActiveAt || '');
      return {
        did: f.did,
        followedAt: f.followedAt,
        followsYou: sets.followers.has(f.did),
        interactions: interactions.get(f.did)?.all || 0,
        recent: interactions.get(f.did)?.recent || 0,
        checked: Boolean(card?.activityAt),
        gone: Boolean(card?.gone),
        lastActiveMs: Number.isFinite(last) ? last : null,
      };
    });
  }, [archive, nowMs]);

  // A row unfollowed on this page leaves the archive's follows, but stays on
  // the page with its Undo until the page is left.
  const known = useRef(new Map());
  for (const r of rows) known.current.set(r.did, r);
  const current = new Set(rows.map((r) => r.did));
  const allRows = [...rows, ...[...undo].filter((did) => !current.has(did)).map((did) => known.current.get(did)).filter(Boolean)];

  const quietCut = nowMs - quietDays * DAY_MS;
  const isQuiet = (r) => r.checked && (r.gone || r.lastActiveMs == null || r.lastActiveMs < quietCut);
  const counts = {
    quiet: rows.filter((r) => !keep.has(r.did) && isQuiet(r)).length,
    oneway: rows.filter((r) => !keep.has(r.did) && !r.followsYou).length,
    silent: rows.filter((r) => !keep.has(r.did) && r.recent === 0).length,
    all: rows.length,
  };
  const checkedCount = rows.filter((r) => r.checked).length;

  const filtered = allRows
    .filter((r) => (showKept ? true : !keep.has(r.did) || undo.has(r.did)))
    .filter((r) => (filter === 'quiet' ? isQuiet(r) : filter === 'oneway' ? !r.followsYou : filter === 'silent' ? r.recent === 0 : true))
    .sort((a, b) => {
      if (sort === 'quiet') return (a.gone ? -1 : 0) - (b.gone ? -1 : 0) || (a.lastActiveMs ?? (a.checked ? -1 : Infinity)) - (b.lastActiveMs ?? (b.checked ? -1 : Infinity));
      if (sort === 'interactions') return a.interactions - b.interactions;
      return Date.parse(a.followedAt || '') - Date.parse(b.followedAt || '');
    });
  const shown = filtered.slice(0, limit);
  useWantActors(archive, shown.map((r) => r.did));

  const live = shown.filter((r) => follow.isFollowing(r.did));
  const selectedLive = [...selected].filter((did) => follow.isFollowing(did));

  async function runCheck(dids) {
    const ac = new AbortController();
    abortRef.current = ac;
    setChecking({ done: 0, total: dids.length });
    try {
      const n = await archive.checkActivity(dids, { signal: ac.signal, onProgress: (p) => setChecking(p) });
      toast?.(`Checked ${n.toLocaleString(activeLocale())} accounts.`);
    } finally {
      abortRef.current = null;
      setChecking(null);
    }
  }

  async function unfollowSelected() {
    const dids = selectedLive;
    setConfirming(false);
    setWorking({ done: 0, total: dids.length });
    let ok = 0;
    for (const did of dids) {
      if (await follow.toggle(did, false)) {
        ok += 1;
        setUndo((u) => new Set(u).add(did));
      }
      setWorking((w) => ({ ...w, done: w.done + 1 }));
    }
    setWorking(null);
    setSelected(new Set());
    toast?.(`Unfollowed ${ok.toLocaleString(activeLocale())} ${ok === 1 ? 'account' : 'accounts'}. Each row can undo it.`);
  }

  function toggleRow(did) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(did)) next.delete(did);
      else next.add(did);
      return next;
    });
  }

  const FILTERS = [
    { key: 'quiet', label: `Quiet for ${quietDays} days`, hint: checkedCount ? 'Or gone: deleted or deactivated' : 'Check activity to find them' },
    { key: 'oneway', label: 'Don’t follow you back', hint: 'One-way follows' },
    { key: 'silent', label: 'No interaction in a year', hint: 'Neither of you liked, replied or reposted' },
    { key: 'all', label: 'Everyone you follow', hint: 'Unfiltered' },
  ];

  return (
    <>
      <ToolHeader tool={tool} sub={`You follow ${rows.length.toLocaleString(activeLocale())} accounts. Nothing happens until you press Unfollow.`} />
      <div className="page-body">
        {!follow.known && (
          <p className="callout">Who you follow arrives with the next sync. Until then there’s nothing to tidy.</p>
        )}

        <section className="check-card" aria-labelledby="cleanup-check">
          <div className="check-card-text">
            <h2 id="cleanup-check" className="card-title">
              {checkedCount ? `Activity checked for ${checkedCount.toLocaleString(activeLocale())} of ${rows.length.toLocaleString(activeLocale())} accounts` : 'When did they last post?'}
            </h2>
            <p className="card-sub">
              Reads the newest post or repost of each account you follow from Bluesky’s public API, one request each. About a minute for
              800 accounts. Kept on this device.
            </p>
          </div>
          {checking ? (
            <div className="check-progress">
              <span className="num muted">
                {checking.done.toLocaleString(activeLocale())} of {checking.total.toLocaleString(activeLocale())}
              </span>
              <div className="progress" aria-hidden="true">
                <div className="progress-fill" style={{ width: `${checking.total ? (checking.done / checking.total) * 100 : 0}%` }} />
              </div>
              <Button size="sm" onClick={() => abortRef.current?.abort()}>
                Stop
              </Button>
            </div>
          ) : (
            <div className="check-actions">
              <label className="field-inline">
                <span>Quiet after</span>
                <select className="input" value={quietDays} onChange={(e) => setQuietDays(Number(e.target.value))}>
                  {QUIET_CHOICES.map((d) => (
                    <option key={d} value={d}>
                      {d} days
                    </option>
                  ))}
                </select>
              </label>
              <Button onClick={() => runCheck(rows.map((r) => r.did))} disabled={!rows.length}>
                <RefreshCw size={15} aria-hidden="true" />
                {checkedCount ? 'Check again' : 'Check activity'}
              </Button>
            </div>
          )}
        </section>

        {/* Four figures that are also the filter: the pressed one has its rule in the accent. */}
        <div className="filter-cards" role="group" aria-label="Which accounts">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className="filter-card"
              aria-pressed={filter === f.key}
              onClick={() => {
                setFilter(f.key);
                setSelected(new Set());
                setLimit(PAGE);
              }}
            >
              <span className="filter-card-label">{f.label}</span>
              <span className="filter-card-count num">{counts[f.key].toLocaleString(activeLocale())}</span>
              <span className="filter-card-hint">{f.hint}</span>
            </button>
          ))}
        </div>

        <section className="table-card" aria-label="Accounts">
          {/* Over the table: how it is sorted and what to do with it, or, once
              rows are ticked, how many and what to do with them. With no rows
              to show (before the first check) there is nothing to sort, so the
              line waits for some, unless kept accounts could be shown. */}
          {(shown.length > 0 || working || keep.size > 0) && (
            <div className="table-bar" data-selected={selectedLive.length ? '' : undefined}>
              {working ? (
                <span role="status">
                  Unfollowing {working.done.toLocaleString(activeLocale())} of {working.total.toLocaleString(activeLocale())}…
                </span>
              ) : selectedLive.length ? (
                <>
                  <span className="table-bar-count">{selectedLive.length.toLocaleString(activeLocale())} selected</span>
                  <span className="table-bar-actions">
                    <Button size="sm" onClick={() => setSelected(new Set())}>
                      Clear
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        keep.add(selectedLive);
                        toast?.(`Kept ${selectedLive.length}. They won’t be suggested again.`);
                        setSelected(new Set());
                      }}
                    >
                      Keep, don’t suggest
                    </Button>
                    <Button size="sm" className="is-danger" onClick={() => setConfirming(true)} disabled={follow.locked}>
                      Unfollow {selectedLive.length.toLocaleString(activeLocale())}
                    </Button>
                  </span>
                </>
              ) : (
                <>
                  <label className="field-inline">
                    <span>Sort</span>
                    <select className="input" value={sort} onChange={(e) => setSort(e.target.value)}>
                      <option value="quiet">Quiet longest</option>
                      <option value="interactions">Fewest interactions</option>
                      <option value="oldest">Followed longest ago</option>
                    </select>
                  </label>
                  <span className="head-actions">
                    {keep.size > 0 && (
                      <button type="button" className="link-action" onClick={() => setShowKept((v) => !v)}>
                        {showKept ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                        {showKept ? 'Hide kept' : `Show ${keep.size.toLocaleString(activeLocale())} kept`}
                      </button>
                    )}
                    <button
                      type="button"
                      className="link-action"
                      onClick={() =>
                        exportRows(archive, 'follows', [
                          ['did', 'handle', 'follows_you', 'last_active', 'interactions', 'followed_at'],
                          ...filtered.map((r) => [r.did, cardFor(archive, r.did)?.handle || '', r.followsYou ? 'yes' : 'no', r.gone ? 'gone' : r.lastActiveMs ? new Date(r.lastActiveMs).toISOString() : '', r.interactions, r.followedAt || '']),
                        ])
                      }
                    >
                      <Download size={14} aria-hidden="true" />
                      Export
                    </button>
                  </span>
                </>
              )}
            </div>
          )}
          {/* On a phone each row of this table is set as a small block (tools.css),
              which takes the table's own layout away, and in some browsers its
              meaning with it. The roles say again what each part is. */}
          <div className="table-scroll table-scroll--bleed">
            <table className="table table--stack cleanup-table" role="table">
              <thead role="rowgroup" hidden={!shown.length}>
                <tr role="row">
                  <th scope="col" role="columnheader" className="col-check">
                    <label className="stack-all">
                      <input
                        type="checkbox"
                        aria-label="Select every account shown"
                        checked={live.length > 0 && live.every((r) => selected.has(r.did))}
                        onChange={(e) => setSelected(e.target.checked ? new Set(live.map((r) => r.did)) : new Set())}
                      />
                      <span className="stack-all-label" aria-hidden="true">
                        Select all shown
                      </span>
                    </label>
                  </th>
                  <th scope="col" role="columnheader">
                    Account
                  </th>
                  <th scope="col" role="columnheader">
                    Follows you
                  </th>
                  <th scope="col" role="columnheader">
                    Last active
                  </th>
                  <th scope="col" role="columnheader" className="is-num">
                    Interactions
                  </th>
                  <th scope="col" role="columnheader">
                    Followed
                  </th>
                  <th scope="col" role="columnheader" className="col-action">
                    <span className="visually-hidden">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {shown.map((r) => {
                  const card = cardFor(archive, r.did);
                  const name = displayName(card, r.did);
                  const following = follow.isFollowing(r.did);
                  const undone = undo.has(r.did) && !following;
                  const kept = keep.has(r.did);
                  return (
                    <tr key={r.did} role="row" className={selected.has(r.did) ? 'is-selected' : undefined} data-gone={undone || undefined}>
                      <td role="cell" className="col-check">
                        {/* The label is the box's reach on a touch screen (tools.css). */}
                        <label className="check-reach">
                          <input type="checkbox" aria-label={`Select ${name}`} checked={selected.has(r.did)} disabled={!following} onChange={() => toggleRow(r.did)} />
                        </label>
                      </td>
                      <td role="cell" className="col-main">
                        <span className="table-person">
                          <Avatar src={card?.avatar} name={card?.displayName || card?.handle} />
                          <span className="table-person-text">
                            <a href={profileUrl(card, r.did)} target="_blank" rel="noopener noreferrer" className="table-person-name">
                              {name}
                            </a>
                            {/* The handle only where the name isn't it already; Kept as a quiet word beside it. */}
                            {((card?.displayName && card?.handle) || kept) && (
                              <span className="meta">
                                {card?.displayName && card?.handle && <span className="table-person-handle">@{card.handle}</span>}
                                {kept && <span>Kept</span>}
                              </span>
                            )}
                          </span>
                        </span>
                      </td>
                      {/* On a phone these cells run on under the name as one meta
                          line, the activity first (tools.css); the words only a
                          phone shows stand in for the column heads it hides. A
                          "No" and a nought say nothing there, so they go. */}
                      <td role="cell" className="cleanup-follows" data-empty={r.followsYou ? undefined : ''}>
                        {r.followsYou ? (
                          <>
                            <span className="stack-hide">Yes</span>
                            <span className="stack-word">follows you</span>
                          </>
                        ) : (
                          <span className="muted">No</span>
                        )}
                      </td>
                      <td role="cell" className="cleanup-active">
                        <span className="activity">
                          <span className={`dot${r.gone ? ' dot--danger' : !r.checked ? ' dot--idle' : r.lastActiveMs && r.lastActiveMs >= quietCut ? '' : ' dot--warn'}`} aria-hidden="true" />
                          {r.gone ? 'Gone' : !r.checked ? <span className="muted">Not checked</span> : r.lastActiveMs ? relativeTime(r.lastActiveMs) : 'Never posted'}
                        </span>
                      </td>
                      <td role="cell" className="is-num cleanup-count" data-empty={r.interactions ? undefined : ''}>
                        {r.interactions.toLocaleString(activeLocale())}
                        <span className="stack-word"> {r.interactions === 1 ? 'interaction' : 'interactions'}</span>
                      </td>
                      <td role="cell" className="num cleanup-followed" data-empty={r.followedAt ? undefined : ''}>
                        <span className="stack-word">followed </span>
                        {r.followedAt ? formatDateShort(r.followedAt) : '—'}
                      </td>
                      <td role="cell" className="col-action">
                        {following ? (
                          <Button size="sm" disabled={follow.busy(r.did)} onClick={() => follow.toggle(r.did, false).then((ok) => ok && setUndo((u) => new Set(u).add(r.did)))}>
                            Unfollow<span className="visually-hidden"> {name}</span>
                          </Button>
                        ) : (
                          <Button size="sm" disabled={follow.busy(r.did)} onClick={() => follow.toggle(r.did, true)}>
                            Undo<span className="visually-hidden"> unfollowing {name}</span>
                          </Button>
                        )}
                        {follow.error(r.did) && (
                          <span className="person-error" role="alert">
                            {follow.error(r.did)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!shown.length && (
              <p className="empty">
                {filter === 'quiet' && !checkedCount ? 'Check activity to find the accounts that went quiet.' : 'Nobody here. Your follows are in good shape.'}
              </p>
            )}
          </div>
          {filtered.length > shown.length && (
            <div className="card-foot">
              <Button size="sm" variant="ghost" onClick={() => setLimit((l) => l + PAGE)}>
                Show {Math.min(PAGE, filtered.length - shown.length)} more
              </Button>
              <span className="num">
                {shown.length.toLocaleString(activeLocale())} of {filtered.length.toLocaleString(activeLocale())}
              </span>
            </div>
          )}
          <p className="card-caption">
            Unfollowing deletes the follow record from your repo, the same as unfollowing in any app. Undo writes a new one. Marking an
            account Keep only changes what this page suggests, on this device.
          </p>
        </section>
      </div>

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Unfollow ${selectedLive.length.toLocaleString(activeLocale())} ${selectedLive.length === 1 ? 'account' : 'accounts'}?`}
        actions={
          <>
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
            <Button variant="danger" onClick={unfollowSelected}>
              Unfollow
            </Button>
          </>
        }
      >
        <p>
          Their follow records are deleted from your repo, one by one. They aren’t told. Each row keeps an Undo for as long as this page
          is open.
        </p>
      </Dialog>
    </>
  );
}
