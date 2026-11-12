// The follow-back queue: people who follow you and engage with your posts,
// that you don't follow yet, the most engaged first. Each row has Follow
// back; Dismiss keeps someone out of the queue for good, in this browser.

import { useState } from 'react';
import Button from '../components/Button.jsx';
import { useArchive } from '../archive/ArchiveContext.jsx';
import { PersonRow, useFollow, useWantActors } from '../people/people.jsx';
import { followBackModel } from '../reports/models.js';
import { PeriodPicker, periodPhrase, usePeriod } from '../shell/bits.jsx';
import { ToolHeader } from './ToolPage.jsx';
import { useKeepList } from './keep.js';

const PAGE = 25;

export default function FollowBack({ tool }) {
  const archive = useArchive();
  const [period] = usePeriod();
  const follow = useFollow(archive);
  const dismissed = useKeepList(archive.did, 'followback');
  const [limit, setLimit] = useState(PAGE);
  // Someone followed from the queue stays on it (reading Following) until
  // the page is left, so the press can be undone.
  const [followed, setFollowed] = useState(() => new Set());
  const queue = followBackModel(archive, period, archive.nowMs);
  const rows = queue.filter((r) => !dismissed.has(r.did));
  const held = [...followed].filter((did) => !rows.some((r) => r.did === did));
  const shown = rows.slice(0, limit);
  useWantActors(archive, shown.map((r) => r.did));

  const detail = (r) =>
    Object.entries(r.byKind)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${n} ${k}${n === 1 ? '' : 's'}`)
      .join(', ');

  const followTracked = {
    ...follow,
    toggle: async (did, on) => {
      const ok = await follow.toggle(did, on);
      if (ok) setFollowed((s) => new Set(s).add(did));
      return ok;
    },
  };

  return (
    <>
      <ToolHeader tool={tool} actions={<PeriodPicker />} />
      <div className="page-body">
        <section className="card card--flush" aria-label="The queue">
          <div className="card-head">
            <div>
              <h2 className="card-title">
                {rows.length.toLocaleString('en-US')} {rows.length === 1 ? 'person' : 'people'} waiting
              </h2>
              <p className="card-sub">Engaged with you in {periodPhrase(period)}, follow you, and you don’t follow them.</p>
            </div>
            {dismissed.size > 0 && (
              <Button size="sm" variant="ghost" onClick={() => dismissed.clear()}>
                Bring back {dismissed.size} dismissed
              </Button>
            )}
          </div>
          {!follow.known && <p className="callout">Who you follow arrives with the next sync; until then the queue can’t tell who you already follow.</p>}
          {shown.length || held.length ? (
            <ul className="widget-rows report-rows">
              {held.map((did) => (
                <PersonRow key={did} archive={archive} did={did} meta="followed just now" follow={followTracked} followLabel="Follow back" />
              ))}
              {shown.map((r) => (
                <PersonRow
                  key={r.did}
                  archive={archive}
                  did={r.did}
                  meta={detail(r)}
                  value={r.total.toLocaleString('en-US')}
                  valueTitle={detail(r)}
                  follow={followTracked}
                  followLabel="Follow back"
                  extra={
                    <Button size="sm" variant="ghost" onClick={() => dismissed.add([r.did])} aria-label="Dismiss from the queue" title="Don’t suggest again">
                      Dismiss
                    </Button>
                  }
                />
              ))}
            </ul>
          ) : (
            <p className="empty">Everyone who follows you and engaged in this window, you already follow.</p>
          )}
          {rows.length > shown.length && (
            <div className="card-foot">
              <Button size="sm" variant="ghost" onClick={() => setLimit((l) => l + PAGE)}>
                Show {Math.min(PAGE, rows.length - shown.length)} more
              </Button>
            </div>
          )}
        </section>
        <p className="note">Engagement comes from your notifications, which reach back about a year. Follow back writes a follow record to your repo.</p>
      </div>
    </>
  );
}
