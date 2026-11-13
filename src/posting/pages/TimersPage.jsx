import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Hourglass,
  MinusCircle,
  Pencil,
  Timer,
  X,
} from 'lucide-react';
import Button from '../../components/Button.jsx';
import Segmented from '../../components/Segmented.jsx';
import { Link } from '../../lib/router.jsx';
import { useToast } from '../../shell/bits.jsx';
import { useAtprotoSession } from '../../session/useAtprotoSession.jsx';
import { accountName } from '../../session/accounts.js';
import { useComposer } from '../composer/ComposerContext.jsx';
import {
  SCHEDULED_CHANGED_EVENT,
  TIMERS_CHANGED_EVENT,
  emitPostsChanged,
} from '../events.js';
import { usePostingSettings } from '../settings.js';
import { resolveTimezone } from '../schedule/postingQueue.js';
import { getLimits, listScheduled } from '../schedule/scheduleService.js';
import { scheduleErrorMessage } from '../schedule/scheduledPostError.js';
import {
  describeTimer,
  groupTimers,
  readStoredTimer,
  timerUsage,
  waitingTimerRows,
} from '../timers/selfDestruct.js';
import {
  cancelTimer,
  listTimers,
  timerPostUrl,
} from '../timers/timerService.js';
import { postingPath } from '../routes.js';
import PostingHeader from '../ui/PostingHeader.jsx';
import { LoadError, RowSkeleton, useLoad } from './hubParts.jsx';
import {
  deletedPostUris,
  formatInZone,
  fullTimerBuckets,
  rowActions,
  rowFacts,
  timerLimitsLine,
  timerRowModel,
  timerSections,
} from './scheduleModel.js';
import { ActionDialog } from './scheduleParts.jsx';
import './hub.css';
import './schedule.css';

// Deleted posts already passed to the archive this visit, per account.
const reported = new Map();

function TimerRow({ row, now, busy, onCancel }) {
  const m = timerRowModel(row, now);
  const url = timerPostUrl(row);
  return (
    <li className="hub-row sched-timer" aria-busy={busy || undefined}>
      <span
        className={`sched-timer-icon${m.live ? ' is-live' : row.status === 'failed' ? ' is-failed' : ''}`}
        aria-hidden="true"
      >
        {m.live ? (
          <Hourglass size={16} />
        ) : row.status === 'failed' ? (
          <AlertTriangle size={16} />
        ) : row.status === 'deleted' ? (
          <X size={16} />
        ) : (
          <CheckCircle2 size={16} />
        )}
      </span>
      <div className="hub-row-main">
        <p className="hub-row-text">
          {m.text || (
            <span className="muted">A post with no words of its own</span>
          )}
        </p>
        <p className="hub-row-meta">
          <span
            className={`badge ${m.live ? 'badge--accent' : row.status === 'failed' ? 'badge--danger' : ''}`}
          >
            {m.when}
          </span>
          {m.live && row.checkAt && (
            <span>{formatInZone(row.checkAt, undefined, now)}</span>
          )}
          {!m.live && row.resolvedAt && (
            <span>{formatInZone(row.resolvedAt, undefined, now)}</span>
          )}
          <span>
            {m.bucket === 'conditional' ? 'Conditional timer' : 'Plain timer'}
          </span>
          {m.extensions && <span>{m.extensions}</span>}
        </p>
        <p className="sched-rule">{m.rule}</p>
        {m.failure && <p className="sched-row-why">{m.failure}</p>}
        {m.resolution && <p className="hub-row-why">{m.resolution}</p>}
        {m.acted.length > 0 && (
          <ul className="sched-acted">
            {m.acted.map((a, i) => (
              <li key={i} className={a.ok ? '' : 'is-skipped'}>
                {a.ok ? (
                  <CheckCircle2 size={13} aria-hidden="true" />
                ) : (
                  <MinusCircle size={13} aria-hidden="true" />
                )}
                {a.text}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="hub-row-actions">
        {url && (
          <a
            className="btn btn--sm btn--ghost"
            href={url}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={14} aria-hidden="true" />
            Open the post
          </a>
        )}
        {m.canCancel && (
          <Button size="sm" onClick={() => onCancel(row)} disabled={busy}>
            {m.cancelLabel}
          </Button>
        )}
      </div>
    </li>
  );
}

function WaitingRow({ row, tz, now, onEdit }) {
  const facts = rowFacts(row);
  const timer = readStoredTimer({
    ...row.payload.selfDestruct,
    enabled: true,
  }).timer;
  const actions = rowActions(row);
  return (
    <li className="hub-row sched-timer">
      <span className="sched-timer-icon" aria-hidden="true">
        <Timer size={16} />
      </span>
      <div className="hub-row-main">
        <p className="hub-row-text">
          {facts.text || <span className="muted">A post with media</span>}
        </p>
        <p className="hub-row-meta">
          <span className="badge">
            {row.status === 'publishing'
              ? 'Going out now'
              : `Goes out ${formatInZone(row.scheduledFor, tz, now)}`}
          </span>
          <span>{row.queued ? 'From the queue' : 'At a set time'}</span>
          {facts.posts > 1 && <span>Thread of {facts.posts}</span>}
        </p>
        <p className="sched-rule">{describeTimer(timer, now)}</p>
        <p className="hub-row-why">
          Its timer starts counting when it goes out.
        </p>
      </div>
      <div className="hub-row-actions">
        {actions.edit && row.status === 'pending' && (
          <Button size="sm" onClick={() => onEdit(row)}>
            <Pencil size={14} aria-hidden="true" />
            Edit
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * Posts on a timer: what's counting down (and when each acts), scheduled
 * posts that start a timer when they go out, timers that gave up, and what
 * the settled ones did. Calling a timer off keeps the post: nothing on this
 * page deletes anything.
 */
export default function TimersPage({ did }) {
  const composer = useComposer();
  const toast = useToast();
  const { accounts, backendFor } = useAtprotoSession();
  const req = backendFor(did);
  const { settings } = usePostingSettings(did);
  const tz = resolveTimezone(settings.queue);
  const name = accountName(accounts.find((a) => a.did === did) || null);
  const [history, setHistory] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState({});
  const [confirm, setConfirm] = useState(null);

  const timers = useLoad((signal) => listTimers(req, { history, signal }), {
    key: `${did}:${history}`,
    did,
    events: [TIMERS_CHANGED_EVENT],
    enabled: Boolean(req),
  });
  // A second read that may fail alone: the scheduled posts with a timer.
  const scheduled = useLoad(
    async (signal) => {
      const [list, limits] = await Promise.all([
        listScheduled(req, { signal }),
        getLimits(req, { signal }).catch(() => null),
      ]);
      return { rows: list.rows, limits };
    },
    {
      key: did,
      did,
      events: [SCHEDULED_CHANGED_EVENT, TIMERS_CHANGED_EVENT],
      enabled: Boolean(req),
    },
  );

  // Countdowns move on, and a timer that has come due is looked for again.
  const reload = useRef(timers.reload);
  reload.current = timers.reload;
  const rowsRef = useRef([]);
  rowsRef.current = timers.data?.rows || [];
  useEffect(() => {
    const t = setInterval(() => {
      const at = Date.now();
      setNow(at);
      if (
        rowsRef.current.some(
          (r) => r.status === 'armed' && Date.parse(r.checkAt) <= at - 30_000,
        )
      )
        reload.current();
    }, 30_000);
    return () => clearInterval(t);
  }, []);

  // Posts a timer deleted leave the archive too. The default list leaves
  // deleted timers out, so the settled list is read once a visit, and again
  // whenever a timer that was counting down drops off.
  const liveIds = useRef(null);
  useEffect(() => {
    if (!req || !timers.data) return undefined;
    const seen = reported.get(did) || new Set();
    reported.set(did, seen);
    const pass = (rows) => {
      const fresh = deletedPostUris(rows).filter(
        (uri) => !seen.has(uri) && uri.startsWith(`at://${did}/`),
      );
      if (!fresh.length) return;
      fresh.forEach((uri) => seen.add(uri));
      try {
        emitPostsChanged(did, { removed: fresh });
      } catch {
        // The archive catches up on its next sync.
      }
    };
    const rows = timers.data.rows || [];
    const live = new Set(
      rows
        .filter((r) => r.status === 'armed' || r.status === 'checking')
        .map((r) => r.id),
    );
    const before = liveIds.current;
    liveIds.current = live;
    if (history) {
      pass(rows);
      return undefined;
    }
    const dropped = !before || [...before].some((id) => !live.has(id));
    if (!dropped) return undefined;
    let on = true;
    listTimers(req, { history: true }).then(
      (out) => on && pass(out.rows),
      () => {},
    );
    return () => {
      on = false;
    };
  }, [timers.data, did, req, history]);

  const waiting = useMemo(
    () => waitingTimerRows(scheduled.data?.rows || []),
    [scheduled.data],
  );
  const groups = useMemo(
    () =>
      timerSections(groupTimers(timers.data?.rows || [], { history }), waiting),
    [timers.data, history, waiting],
  );
  const liveRows = (timers.data?.rows || []).filter(
    (r) => r.status === 'armed' || r.status === 'checking',
  );
  const limitsLine = timerLimitsLine(
    scheduled.data?.limits,
    timerUsage({ liveRows, scheduledRows: scheduled.data?.rows || [] }),
  );
  const full = fullTimerBuckets(scheduled.data?.limits);

  const cancel = (row) =>
    setConfirm({
      row,
      run: async () => {
        setBusy((b) => ({ ...b, [row.id]: true }));
        try {
          await cancelTimer(req, row.id);
          toast?.(
            row.status === 'failed'
              ? 'Dismissed.'
              : 'The timer is off. The post stays up.',
          );
        } catch (err) {
          // The worker may hold it: what's on screen is reloaded, never patched.
          timers.reload();
          throw new Error(
            err?.code === 'NOT_CANCELLABLE' || err?.status === 409
              ? 'This timer is being checked right now, or has already acted, so it can’t be called off.'
              : scheduleErrorMessage(err),
          );
        } finally {
          setBusy((b) => {
            const next = { ...b };
            delete next[row.id];
            return next;
          });
        }
      },
    });

  const loading = timers.status === 'loading';
  const unavailable = timers.data?.unavailable;
  const counting = liveRows.length;

  return (
    <>
      <PostingHeader
        page="timers"
        actions={
          <Segmented
            size="sm"
            label="Which timers"
            value={history ? 'history' : 'current'}
            onChange={(v) => setHistory(v === 'history')}
            options={[
              { value: 'current', label: 'Now' },
              { value: 'history', label: 'Everything settled' },
            ]}
          />
        }
      />
      <div className="page-body sched-page">
        <p className="note">
          Calling a timer off keeps the post. Nothing on this page deletes
          anything.
        </p>
        {full.map((line) => (
          <p key={line} className="callout callout--warn">
            {line}
          </p>
        ))}

        {timers.status === 'error' && !timers.data ? (
          <LoadError
            message={`Couldn’t read ${name}’s timers. ${scheduleErrorMessage(timers.error)}`}
            onRetry={timers.reload}
          />
        ) : unavailable ? (
          <section className="card">
            <h2 className="card-title">Post timers aren’t available yet</h2>
            <p className="card-sub">
              Virga’s server can’t hold timers right now. Posts can still be
              deleted by hand from Posting › Posted.
            </p>
          </section>
        ) : loading ? (
          <section className="card card--flush" aria-label="Loading timers">
            <RowSkeleton rows={3} actions={1} />
          </section>
        ) : groups.length === 0 ? (
          <section className="card">
            <div className="hub-empty">
              <p className="empty">
                {history
                  ? 'No timer has settled in a while.'
                  : 'No posts on a timer. Give a new post a timer in the composer, or put one that’s out on a timer from Posted.'}
              </p>
              <div className="sched-side-actions">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => composer.open({ asDid: did })}
                >
                  New post
                </Button>
                <Link to={postingPath('posted')} className="btn btn--sm">
                  Posted
                </Link>
              </div>
            </div>
          </section>
        ) : (
          groups.map((group) => (
            <section
              key={group.key}
              className="card card--flush sched-section"
              aria-labelledby={`timers-${group.key}`}
            >
              <div className="card-head">
                <h2 className="card-title" id={`timers-${group.key}`}>
                  {group.title}{' '}
                  <span className="sched-count">{group.rows.length}</span>
                </h2>
              </div>
              <ul className="hub-list hub-list--rows">
                {group.key === 'waiting'
                  ? group.rows.map((row) => (
                      <WaitingRow
                        key={row.id}
                        row={row}
                        tz={tz}
                        now={now}
                        onEdit={(r) =>
                          composer.open({ scheduledId: r.id, asDid: did })
                        }
                      />
                    ))
                  : group.rows.map((row) => (
                      <TimerRow
                        key={row.id}
                        row={row}
                        now={now}
                        busy={Boolean(busy[row.id])}
                        onCancel={cancel}
                      />
                    ))}
              </ul>
            </section>
          ))
        )}

        {scheduled.status === 'error' && !scheduled.data && (
          <p className="field-hint">
            Couldn’t read the scheduled posts, so ones that start a timer when
            they go out aren’t shown.
          </p>
        )}
        {!loading && !unavailable && (counting > 0 || waiting.length > 0) && (
          <p className="card-caption">
            {counting === 1 ? '1 post is' : `${counting} posts are`} on a timer.
            {waiting.length
              ? ` ${waiting.length} more ${waiting.length === 1 ? 'starts' : 'start'} counting when ${waiting.length === 1 ? 'it goes' : 'they go'} out.`
              : ''}
          </p>
        )}
        {limitsLine && (
          <p className="card-caption sched-limits">{limitsLine}</p>
        )}
      </div>

      <ActionDialog
        open={Boolean(confirm)}
        title={
          confirm?.row?.status === 'failed'
            ? 'Dismiss this timer?'
            : 'Call this timer off?'
        }
        confirmLabel={
          confirm?.row?.status === 'failed' ? 'Dismiss' : 'Call it off'
        }
        busyLabel="Calling it off…"
        onConfirm={confirm?.run}
        onClose={() => setConfirm(null)}
      >
        <p>
          {confirm?.row?.status === 'failed'
            ? 'It goes from this list. The post stays up.'
            : 'The post stays up, as it is now, and its timer slot is freed.'}
        </p>
        {confirm?.row?.snippet && (
          <blockquote className="hub-quote">
            {String(confirm.row.snippet).slice(0, 200)}
          </blockquote>
        )}
      </ActionDialog>
    </>
  );
}
