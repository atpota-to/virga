// The Posting cards: what is going out next, the drafts waiting and the
// timers counting down, on a dashboard beside the numbers. They read what
// the Posting overview reads (posting/pages/HubPage.jsx), for the account
// the dashboard belongs to, and follow the same events, so a post scheduled
// in the composer shows up here without a reload.
//
// Scheduling and timers are done by Virga's server, so those cards need a
// long session and say so on an account without one.

import Button from '../../components/Button.jsx';
import { fmtInt } from '../../lib/locale.js';
import { Link } from '../../lib/router.jsx';
import { useComposer } from '../../posting/composer/ComposerContext.jsx';
import { listDrafts, postingDeviceId } from '../../posting/drafts/drafts.js';
import { DRAFTS_CHANGED_EVENT, SCHEDULED_CHANGED_EVENT, TIMERS_CHANGED_EVENT } from '../../posting/events.js';
import { draftMeta } from '../../posting/pages/draftActions.js';
import { countPhrase, draftRows, scheduledOverview, scheduledSnippet, timersOverview, whenLabel } from '../../posting/pages/hubModel.js';
import { LoadError, RowSkeleton, useLoad } from '../../posting/pages/hubParts.jsx';
import { relativeWhen } from '../../posting/schedule/postingQueue.js';
import { listScheduled } from '../../posting/schedule/scheduleService.js';
import { listTimers } from '../../posting/timers/timerService.js';
import { useAtprotoSession } from '../../session/useAtprotoSession.jsx';
import { Stat, rowsFor } from './parts.jsx';

const NEEDS = 'Needs a long session';

/** The account's requester for Virga's server, or null on a browser session. */
function useBackend(did) {
  const { backendFor, capabilitiesFor } = useAtprotoSession();
  return capabilitiesFor(did).canSchedule ? backendFor(did) : null;
}

function useScheduled(did, limit) {
  const req = useBackend(did);
  const load = useLoad(
    async (signal) => {
      const list = await listScheduled(req, { signal });
      return { ...scheduledOverview(list.rows, { limit }), unavailable: Boolean(list.unavailable) };
    },
    { key: `${did}:${Boolean(req)}:${limit}`, did, events: [SCHEDULED_CHANGED_EVENT], enabled: Boolean(req) },
  );
  return { req, ...load };
}

function StatScheduled({ archive, def, title }) {
  const { req, status, data } = useScheduled(archive.did, 1);
  const label = title || 'Scheduled';
  if (!req) return <Stat icon={def.icon} label={label} to={def.href} value="—" sub={NEEDS} />;
  if (status === 'loading') return <Stat icon={def.icon} label={label} to={def.href} value="…" sub="Reading" />;
  if (status === 'error' || data.unavailable) return <Stat icon={def.icon} label={label} to={def.href} value="—" sub="Couldn’t be read just now" />;
  const next = data.next[0];
  return (
    <Stat
      icon={def.icon}
      label={label}
      to={def.href}
      window="Waiting"
      value={fmtInt(data.waiting)}
      sub={
        data.failed
          ? `${countPhrase(data.failed, 'post')} didn’t go out`
          : next
            ? `Next: ${whenLabel(next.scheduledFor)}`
            : 'Nothing is scheduled'
      }
    />
  );
}

function StatTimers({ archive, def, title }) {
  const did = archive.did;
  const req = useBackend(did);
  const { status, data } = useLoad(
    async (signal) => {
      const { rows, unavailable } = await listTimers(req, { signal });
      return { ...timersOverview(rows), unavailable };
    },
    { key: `${did}:${Boolean(req)}`, did, events: [TIMERS_CHANGED_EVENT], enabled: Boolean(req) },
  );
  const label = title || 'Timers';
  if (!req) return <Stat icon={def.icon} label={label} to={def.href} value="—" sub={NEEDS} />;
  if (status === 'loading') return <Stat icon={def.icon} label={label} to={def.href} value="…" sub="Reading" />;
  if (status === 'error' || data.unavailable) return <Stat icon={def.icon} label={label} to={def.href} value="—" sub="Couldn’t be read just now" />;
  return (
    <Stat
      icon={def.icon}
      label={label}
      to={def.href}
      window="Counting down"
      value={fmtInt(data.live)}
      sub={data.nextCheck ? `Next check ${relativeWhen(data.nextCheck)}` : 'None counting down'}
    />
  );
}

function PostingNext({ archive, size, def, rows = null }) {
  const n = rowsFor(size, rows);
  const { req, status, data, reload } = useScheduled(archive.did, n);
  if (!req) {
    return (
      <p className="empty">
        Scheduling needs a long session, because Virga’s server posts while this browser is closed. <Link to={def.href}>See how</Link>
      </p>
    );
  }
  if (status === 'loading') return <RowSkeleton rows={Math.min(n, 3)} />;
  if (status === 'error') return <LoadError message="Your scheduled posts couldn’t be read from Virga’s server." onRetry={reload} />;
  if (data.unavailable) return <p className="empty">Scheduling isn’t available on Virga’s server just now.</p>;
  if (!data.next.length) return <p className="empty">Nothing is scheduled. Write a post and choose Schedule, or add it to your queue.</p>;
  const now = new Date();
  return (
    <>
      <ul className="hub-list">
        {data.next.map((row) => (
          <li key={row.id} className="hub-row">
            <div className="hub-row-main">
              <span className="hub-row-text">{scheduledSnippet(row)}</span>
              <span className="hub-row-meta">
                <time dateTime={row.scheduledFor}>{whenLabel(row.scheduledFor, now)}</time>
                {row.queued && <span className="badge badge--outline">Queue</span>}
                {row.status === 'publishing' && <span>Going out now</span>}
              </span>
            </div>
          </li>
        ))}
      </ul>
      {(data.waiting > data.next.length || data.failed > 0) && (
        <p className="widget-foot">
          {data.failed > 0 ? `${countPhrase(data.failed, 'post')} didn’t go out. ` : ''}
          <Link to={def.href}>See all {fmtInt(data.waiting)}</Link>
        </p>
      )}
    </>
  );
}

function PostingDrafts({ archive, size, def, rows = null }) {
  const did = archive.did;
  const n = rowsFor(size, rows);
  const composer = useComposer();
  const { agentFor } = useAtprotoSession();
  const { status, data, reload } = useLoad(
    async (signal) => {
      const agent = await agentFor(did);
      const page = await listDrafts(agent, { limit: 100, signal });
      return { rows: draftRows(page.drafts, { deviceId: postingDeviceId() }), more: Boolean(page.cursor) };
    },
    { key: did, did, events: [DRAFTS_CHANGED_EVENT] },
  );
  if (status === 'loading') return <RowSkeleton rows={Math.min(n, 3)} actions={1} />;
  if (status === 'error') return <LoadError message="Your drafts couldn’t be read from Bluesky." onRetry={reload} />;
  if (!data.rows.length) return <p className="empty">No drafts. In the composer, Save draft keeps a post here until you’re ready.</p>;
  const shown = data.rows.slice(0, n);
  return (
    <>
      <ul className="hub-list">
        {shown.map((row) => (
          <li key={row.id} className="hub-row">
            <div className="hub-row-main">
              <span className="hub-row-text">{row.text.trim() || <span className="muted">No text yet</span>}</span>
              <span className="hub-row-meta">{draftMeta(row).slice(0, 3).join(' · ')}</span>
            </div>
            <div className="hub-row-actions">
              <Button size="sm" onClick={() => composer.open({ draftId: row.id, draftOwnerDid: did, asDid: did })}>
                Open
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {(data.rows.length > shown.length || data.more) && (
        <p className="widget-foot">
          <Link to={def.href}>
            See all {fmtInt(data.rows.length)}
            {data.more ? '+' : ''}
          </Link>
        </p>
      )}
    </>
  );
}

export const POSTING_WIDGETS = {
  'stat-scheduled': StatScheduled,
  'stat-timers': StatTimers,
  'posting-next': PostingNext,
  'posting-drafts': PostingDrafts,
};
