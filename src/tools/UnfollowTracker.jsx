// Who left, and who arrived, between syncs. An unfollow takes its follow
// record with it, so the only way to see one is to compare the follower list
// at two syncs; every sync with a complete list on both sides adds its
// differences to a log kept in this browser.

import { useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import Button from '../components/Button.jsx';
import Figures from '../components/Figures.jsx';
import Segmented from '../components/Segmented.jsx';
import { useArchive } from '../archive/ArchiveContext.jsx';
import { exportRows } from '../archive/exports.js';
import { formatDateShort, relativeTime } from '../lib/time.js';
import { PersonRow, useFollow } from '../people/people.jsx';
import { followerLogModel } from '../reports/models.js';
import { ToolHeader } from './ToolPage.jsx';

const PAGE = 40;

export default function UnfollowTracker({ tool }) {
  const archive = useArchive();
  const follow = useFollow(archive);
  const m = followerLogModel(archive);
  const [side, setSide] = useState('lost');
  const [limit, setLimit] = useState(PAGE);
  const entries = side === 'lost' ? m.lost : m.gained;
  const shown = entries.slice(0, limit);

  // Grouped by the sync that noticed them.
  const groups = [];
  for (const e of shown) {
    const last = groups[groups.length - 1];
    if (last && last.at === e.at) last.entries.push(e);
    else groups.push({ at: e.at, since: e.since, entries: [e] });
  }

  const syncNow = () => archive.runSync(archive.meta.posts?.complete ? 'incremental' : 'resume');

  return (
    <>
      <ToolHeader
        tool={tool}
        actions={
          m.tracking && (
            <Button
              onClick={() =>
                exportRows(archive, 'follower-changes', [
                  ['change', 'did', 'handle', 'display_name', 'noticed_at', 'since', 'followed_at'],
                  ...[...m.lost, ...m.gained].map((e) => [e.kind, e.did, e.handle, e.displayName, new Date(e.at).toISOString(), e.since ? new Date(e.since).toISOString() : '', e.followedAt || '']),
                ])
              }
            >
              <Download size={15} aria-hidden="true" />
              Export
            </Button>
          )
        }
      />
      <div className="page-body">
        {!m.tracking ? (
          <div className="card empty-page">
            <h2 className="card-title">Counting starts with your next sync</h2>
            <p className="card-sub">
              Virga compares your follower list at each sync with the one before. Your archive has one list so far; the next sync will
              have a second to compare it with, and from then on every unfollow lands here.
            </p>
            <div>
              <Button variant="primary" onClick={syncNow} disabled={Boolean(archive.sync)}>
                <RefreshCw size={15} aria-hidden="true" />
                {archive.sync ? 'Syncing…' : 'Sync now'}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <Figures
              label="Changes in figures"
              items={[
                { key: 'left', label: 'Left at the last sync', value: m.latestLost.length, note: relativeTime(m.lastSyncAt) },
                { key: 'arrived', label: 'Arrived at the last sync', value: m.latestGained.length },
                { key: 'left-all', label: 'Left in all', value: m.lost.length, note: `Since ${formatDateShort(m.since)}` },
                { key: 'arrived-all', label: 'Arrived in all', value: m.gained.length, note: `Since ${formatDateShort(m.since)}` },
              ]}
            />
            <section className="card card--flush" aria-label={side === 'lost' ? 'Who left' : 'Who arrived'}>
              <div className="card-head">
                <Segmented
                  label="Show"
                  value={side}
                  onChange={(v) => {
                    setSide(v);
                    setLimit(PAGE);
                  }}
                  options={[
                    { value: 'lost', label: `Left (${m.lost.length.toLocaleString('en-US')})` },
                    { value: 'gained', label: `Arrived (${m.gained.length.toLocaleString('en-US')})` },
                  ]}
                />
                <Button size="sm" onClick={syncNow} disabled={Boolean(archive.sync)}>
                  <RefreshCw size={14} aria-hidden="true" />
                  {archive.sync ? 'Syncing…' : 'Sync now'}
                </Button>
              </div>
              {!entries.length && (
                <p className="empty">
                  {side === 'lost' ? `Nobody has unfollowed you since ${formatDateShort(m.since)}.` : `Nobody new since ${formatDateShort(m.since)}.`}
                </p>
              )}
              {groups.map((g) => (
                <div key={g.at} className="change-group">
                  <h3 className="change-group-head num">
                    Noticed {formatDateShort(g.at)}
                    {g.since ? `, since the sync on ${formatDateShort(g.since)}` : ''} · {g.entries.length.toLocaleString('en-US')}
                  </h3>
                  <ul className="widget-rows report-rows">
                    {g.entries.map((e) => (
                      <PersonRow
                        key={`${e.did}-${e.at}`}
                        archive={archive}
                        did={e.did}
                        card={{ handle: e.handle, displayName: e.displayName, avatar: e.avatar }}
                        meta={
                          side === 'lost'
                            ? e.followedAt
                              ? `had followed you since ${formatDateShort(e.followedAt)}`
                              : null
                            : e.followedAt
                              ? `followed ${relativeTime(e.followedAt)}`
                              : null
                        }
                        follow={follow}
                      />
                    ))}
                  </ul>
                </div>
              ))}
              {entries.length > shown.length && (
                <div className="card-foot">
                  <Button size="sm" variant="ghost" onClick={() => setLimit((l) => l + PAGE)}>
                    Show {Math.min(PAGE, entries.length - shown.length)} more
                  </Button>
                </div>
              )}
            </section>
            <p className="note">
              A change is noticed at the sync after it happened, so “noticed” is a window, not a moment. Someone who unfollowed and
              followed again between two syncs never shows. The log is kept in this browser, up to 5,000 changes.
            </p>
          </>
        )}
      </div>
    </>
  );
}
