import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, MinusCircle } from 'lucide-react';
import Button from '../../components/Button.jsx';
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
import { ActionDialog, useFocusAfterRemoval } from './scheduleParts.jsx';
import './hub.css';
import './schedule.css';

// Deleted posts already passed to the archive this visit, per account.
const reported = new Map();

/**
 * A timer: the post's words (a link to the post, so the row needs no button
 * for that), when it acts as the line's key fact, what it does, and Call off.
 * One that gave up says so in red, once.
 */
function TimerRow({ row, now, busy, onCancel }) {
  const m = timerRowModel(row, now);
  const url = timerPostUrl(row);
  const words = m.text || (
    <span className="muted">A post with no words of its own</span>
  );
  return (
    <li
      id={`timer-row-${row.id}`}
      className="sched-row sched-timer"
      aria-busy={busy || undefined}
    >
      <div className="hub-row-main sched-row-main">
        <p className="hub-row-text">
          {url ? (
            <a
              className="hub-row-link"
              href={url}
              target="_blank"
              rel="noreferrer"
              title="Open on Bluesky"
            >
              {words}
            </a>
          ) : (
            words
          )}
        </p>
        {/* A timer that gave up sits under a heading that says so, and its
            reason is in red: the line itself stays quiet. */}
        <p className="meta">
          <span className={m.live ? 'is-key' : undefined}>{m.when}</span>
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
      {m.canCancel && (
        <div className="row-actions">
          <Button size="sm" onClick={() => onCancel(row)} disabled={busy}>
            {m.cancelLabel}
          </Button>
        </div>
      )}
    </li>
  );
}

/** A scheduled post that starts a timer when it goes out. */
function WaitingRow({ row, tz, now, onEdit }) {
  const facts = rowFacts(row);
  const timer = readStoredTimer({
    ...row.payload.selfDestruct,
    enabled: true,
  }).timer;
  const actions = rowActions(row);
  return (
    <li className="sched-row sched-timer">
      <div className="hub-row-main sched-row-main">
        <p className="hub-row-text">
          {facts.text || <span className="muted">A post with media</span>}
        </p>
        <p className="meta">
          <span className="is-key">
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
      {actions.edit && row.status === 'pending' && (
        <div className="row-actions">
          <Button size="sm" onClick={() => onEdit(row)}>
            Edit
          </Button>
        </div>
      )}
    </li>
  );
}

/** Hands the posts a timer deleted to the archive, once a visit each. */
function reportDeleted(did, rows) {
  const seen = reported.get(did) || new Set();
  reported.set(did, seen);
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
}

/** '1 post counting down', '2 timers gave up, posts still up'. */
function groupTitle(key, n) {
  const posts = n === 1 ? '1 post' : `${n} posts`;
  if (key === 'live') return `${posts} counting down`;
  if (key === 'waiting') return `${posts} waiting to go out`;
  if (key === 'failed')
    return n === 1
      ? '1 timer gave up, post still up'
      : `${n} timers gave up, posts still up`;
  return '';
}

/**
 * Posts on a timer: what's counting down (and when each acts), scheduled
 * posts that start a timer when they go out, and timers that gave up, each
 * a list headed by its count. What the settled ones did is behind a
 * disclosure at the foot, read only when it's opened. Calling a timer off
 * keeps the post: nothing on this page deletes anything.
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

  const timers = useLoad((signal) => listTimers(req, { signal }), {
    key: did,
    did,
    events: [TIMERS_CHANGED_EVENT],
    enabled: Boolean(req),
  });
  // Every settled timer, read when the disclosure is opened. It is a read
  // of its own, so the lists above stay on screen while it runs.
  const settled = useLoad(
    (signal) => listTimers(req, { history: true, signal }),
    {
      key: `${did}:settled`,
      did,
      events: [TIMERS_CHANGED_EVENT],
      enabled: Boolean(req) && history,
    },
  );
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
    const live = new Set(
      (timers.data.rows || [])
        .filter((r) => r.status === 'armed' || r.status === 'checking')
        .map((r) => r.id),
    );
    const before = liveIds.current;
    liveIds.current = live;
    const dropped = !before || [...before].some((id) => !live.has(id));
    if (!dropped) return undefined;
    let on = true;
    listTimers(req, { history: true }).then(
      (out) => on && reportDeleted(did, out.rows),
      () => {},
    );
    return () => {
      on = false;
    };
  }, [timers.data, did, req]);
  useEffect(() => {
    if (settled.data) reportDeleted(did, settled.data.rows || []);
  }, [settled.data, did]);

  const waiting = useMemo(
    () => waitingTimerRows(scheduled.data?.rows || []),
    [scheduled.data],
  );
  // The lists on the page: counting down, waiting, gave up. The week's
  // settled ones the default read brings go under the disclosure with the
  // rest of the settled.
  const groups = useMemo(
    () =>
      timerSections(
        groupTimers(timers.data?.rows || []).filter(
          (g) => g.key !== 'settled',
        ),
        waiting,
      ),
    [timers.data, waiting],
  );
  const settledRows = useMemo(
    () =>
      groupTimers(settled.data?.rows || [], { history: true }).find(
        (g) => g.key === 'settled',
      )?.rows || [],
    [settled.data],
  );
  const liveRows = (timers.data?.rows || []).filter(
    (r) => r.status === 'armed' || r.status === 'checking',
  );
  const limitsLine = timerLimitsLine(
    scheduled.data?.limits,
    timerUsage({ liveRows, scheduledRows: scheduled.data?.rows || [] }),
  );
  const full = fullTimerBuckets(scheduled.data?.limits);
  const keepFocus = useFocusAfterRemoval(
    '.sched-page .sched-timer[id]',
    timers.data,
  );

  const cancel = (row) =>
    setConfirm({
      row,
      run: async () => {
        setBusy((b) => ({ ...b, [row.id]: true }));
        keepFocus(`timer-row-${row.id}`);
        try {
          await cancelTimer(req, row.id);
          toast?.(
            row.status === 'failed'
              ? 'Dismissed.'
              : 'The timer is off. The post stays up.',
          );
        } catch (err) {
          keepFocus(null);
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
  const unreadable = timers.status === 'error' && !timers.data;
  const unavailable = timers.data?.unavailable;
  const timerRow = (row) => (
    <TimerRow
      key={row.id}
      row={row}
      now={now}
      busy={Boolean(busy[row.id])}
      onCancel={cancel}
    />
  );

  return (
    <>
      <PostingHeader page="timers" />
      <div className="page-body sched-page">
        {full.map((line) => (
          <p key={line} className="callout callout--warn">
            {line}
          </p>
        ))}

        {unreadable ? (
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
          <div className="empty-block">
            <p className="empty">
              No posts on a timer. Give a new post a timer in the composer, or
              put one that’s out on a timer from{' '}
              <Link to={postingPath('posted')}>Posted</Link>.
            </p>
            <Button onClick={() => composer.open({ asDid: did })}>
              New post
            </Button>
          </div>
        ) : (
          groups.map((group, i) => (
            <section
              key={group.key}
              className="card card--flush"
              aria-labelledby={`timers-${group.key}`}
            >
              <div className="card-head">
                <div>
                  <h2 className="card-title" id={`timers-${group.key}`}>
                    {groupTitle(group.key, group.rows.length)}
                  </h2>
                  {i === 0 && (
                    <p className="card-sub">
                      Calling a timer off keeps the post. Nothing on this page
                      deletes anything.
                    </p>
                  )}
                </div>
              </div>
              <ul className="hub-list sched-list">
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
                  : group.rows.map(timerRow)}
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
        {!loading && !unreadable && !unavailable && (
          <details
            className="disclosure sched-settled"
            onToggle={(e) => setHistory(e.currentTarget.open)}
          >
            <summary>Show settled timers</summary>
            {history &&
              (settled.status === 'error' && !settled.data ? (
                <LoadError
                  message={`Couldn’t read ${name}’s settled timers. ${scheduleErrorMessage(settled.error)}`}
                  onRetry={settled.reload}
                />
              ) : !settled.data ? (
                <RowSkeleton rows={2} />
              ) : settledRows.length ? (
                <ul className="hub-list sched-list">
                  {settledRows.map(timerRow)}
                </ul>
              ) : (
                <p className="empty">No timer has settled in a while.</p>
              ))}
          </details>
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
