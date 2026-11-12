// Follow cleanup: the accounts you follow that have gone quiet, are gone, or
// don't follow you back, with a bulk Unfollow. Nothing is unfollowed until
// it is asked for, every unfollow can be undone from the same row, and an
// account marked Keep is never suggested again.

import { useMemo, useRef, useState } from 'react';
import { RefreshCw, Undo2 } from 'lucide-react';
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
      toast?.(`Checked ${n.toLocaleString('en-US')} accounts.`);
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
    toast?.(`Unfollowed ${ok.toLocaleString('en-US')} ${ok === 1 ? 'account' : 'accounts'}. Each row can undo it.`);
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
      <ToolHeader tool={tool} sub={`You follow ${rows.length.toLocaleString('en-US')} accounts. Nothing happens until you press Unfollow.`} />
      <div className="page-body">
        {!follow.known && (
          <p className="callout">Who you follow arrives with the next sync. Until then there’s nothing to tidy.</p>
        )}

        <section className="card check-card" aria-label="Activity check">
          <div className="check-card-text">
            <strong>{checkedCount ? `Activity checked for ${checkedCount.toLocaleString('en-US')} of ${rows.length.toLocaleString('en-US')} accounts` : 'When did they last post?'}</strong>
            <span className="muted">
              Reads the newest post or repost of each account you follow from Bluesky’s public API, one request each. About a minute for
              800 accounts. Kept in this browser.
            </span>
          </div>
          {checking ? (
            <div className="check-progress">
              <span className="num muted">
                {checking.done.toLocaleString('en-US')} of {checking.total.toLocaleString('en-US')}
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
              <Button variant={checkedCount ? 'quiet' : 'primary'} onClick={() => runCheck(rows.map((r) => r.did))} disabled={!rows.length}>
                <RefreshCw size={15} aria-hidden="true" />
                {checkedCount ? 'Check again' : 'Check activity'}
              </Button>
            </div>
          )}
        </section>

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
              <span className="filter-card-count num">{counts[f.key].toLocaleString('en-US')}</span>
              <span className="filter-card-hint">{f.hint}</span>
            </button>
          ))}
        </div>

        <section className="card card--flush table-card" aria-label="Accounts">
          <div className="table-bar" data-selected={selectedLive.length ? '' : undefined}>
            {working ? (
              <span role="status">
                Unfollowing {working.done.toLocaleString('en-US')} of {working.total.toLocaleString('en-US')}…
              </span>
            ) : selectedLive.length ? (
              <>
                <span className="table-bar-count">
                  {selectedLive.length.toLocaleString('en-US')} selected
                </span>
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
                  <Button size="sm" variant="danger" onClick={() => setConfirming(true)} disabled={follow.locked}>
                    Unfollow {selectedLive.length.toLocaleString('en-US')}
                  </Button>
                </span>
              </>
            ) : (
              <>
                <span className="muted num">
                  Showing {shown.length.toLocaleString('en-US')} of {filtered.length.toLocaleString('en-US')}
                  {keep.size ? `. ${keep.size.toLocaleString('en-US')} kept accounts are ${showKept ? 'shown' : 'hidden'}` : ''}.
                </span>
                <span className="table-bar-actions">
                  {keep.size > 0 && (
                    <Button size="sm" variant="ghost" onClick={() => setShowKept((v) => !v)}>
                      {showKept ? 'Hide kept' : 'Show kept'}
                    </Button>
                  )}
                  <label className="field-inline">
                    <span>Sort</span>
                    <select className="input" value={sort} onChange={(e) => setSort(e.target.value)}>
                      <option value="quiet">Quiet longest</option>
                      <option value="interactions">Fewest interactions</option>
                      <option value="oldest">Followed longest ago</option>
                    </select>
                  </label>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      exportRows(archive, 'follows', [
                        ['did', 'handle', 'follows_you', 'last_active', 'interactions', 'followed_at'],
                        ...filtered.map((r) => [r.did, cardFor(archive, r.did)?.handle || '', r.followsYou ? 'yes' : 'no', r.gone ? 'gone' : r.lastActiveMs ? new Date(r.lastActiveMs).toISOString() : '', r.interactions, r.followedAt || '']),
                      ])
                    }
                  >
                    Export
                  </Button>
                </span>
              </>
            )}
          </div>
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col" className="col-check">
                    <input
                      type="checkbox"
                      aria-label="Select every account shown"
                      checked={live.length > 0 && live.every((r) => selected.has(r.did))}
                      onChange={(e) => setSelected(e.target.checked ? new Set(live.map((r) => r.did)) : new Set())}
                    />
                  </th>
                  <th scope="col">Account</th>
                  <th scope="col">Follows you</th>
                  <th scope="col">Last active</th>
                  <th scope="col" className="is-num">
                    Interactions
                  </th>
                  <th scope="col">Followed</th>
                  <th scope="col">
                    <span className="visually-hidden">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => {
                  const card = cardFor(archive, r.did);
                  const name = displayName(card, r.did);
                  const following = follow.isFollowing(r.did);
                  const undone = undo.has(r.did) && !following;
                  return (
                    <tr key={r.did} className={selected.has(r.did) ? 'is-selected' : undefined} data-gone={undone || undefined}>
                      <td className="col-check">
                        <input type="checkbox" aria-label={`Select ${name}`} checked={selected.has(r.did)} disabled={!following} onChange={() => toggleRow(r.did)} />
                      </td>
                      <td>
                        <span className="table-person">
                          <Avatar src={card?.avatar} name={card?.displayName || card?.handle} size="sm" />
                          <span className="table-person-text">
                            <a href={profileUrl(card, r.did)} target="_blank" rel="noopener noreferrer" className="table-person-name">
                              {name}
                            </a>
                            {card?.handle && <span className="muted">@{card.handle}</span>}
                          </span>
                          {keep.has(r.did) && <span className="badge">Kept</span>}
                        </span>
                      </td>
                      <td>{r.followsYou ? 'Yes' : <span className="muted">No</span>}</td>
                      <td>
                        <span className="activity">
                          <span className={`dot${r.gone ? ' dot--danger' : !r.checked ? ' dot--idle' : r.lastActiveMs && r.lastActiveMs >= quietCut ? '' : ' dot--warn'}`} aria-hidden="true" />
                          {r.gone ? 'Gone' : !r.checked ? <span className="muted">Not checked</span> : r.lastActiveMs ? relativeTime(r.lastActiveMs) : 'Never posted'}
                        </span>
                      </td>
                      <td className="is-num">{r.interactions.toLocaleString('en-US')}</td>
                      <td className="num">{r.followedAt ? formatDateShort(r.followedAt) : '—'}</td>
                      <td className="col-action">
                        {following ? (
                          <Button size="sm" disabled={follow.busy(r.did)} onClick={() => follow.toggle(r.did, false).then((ok) => ok && setUndo((u) => new Set(u).add(r.did)))}>
                            Unfollow<span className="visually-hidden"> {name}</span>
                          </Button>
                        ) : (
                          <Button size="sm" variant="ghost" disabled={follow.busy(r.did)} onClick={() => follow.toggle(r.did, true)}>
                            <Undo2 size={14} aria-hidden="true" />
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
            </div>
          )}
        </section>
        <p className="note">
          Unfollowing deletes the follow record from your repo, the same as unfollowing in any app. Undo writes a new one. Marking an
          account Keep only changes what this page suggests, in this browser.
        </p>
      </div>

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Unfollow ${selectedLive.length.toLocaleString('en-US')} ${selectedLive.length === 1 ? 'account' : 'accounts'}?`}
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
