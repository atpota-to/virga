import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Ban,
  CalendarClock,
  CornerDownRight,
  GripVertical,
  Hourglass,
  ListPlus,
  Lock,
  Pencil,
  Repeat,
  Send,
  SkipForward,
  Trash2,
  X,
} from 'lucide-react';
import Button from '../../components/Button.jsx';
import { MoreMenu } from '../../components/Menu.jsx';
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
import {
  isScheduleEmpty,
  relativeWhen,
  resolveTimezone,
} from '../schedule/postingQueue.js';
import {
  acknowledgeTimerNote,
  cancelScheduled,
  getLimits,
  getScheduledMedia,
  listScheduled,
  reorderScheduled,
  retryScheduled,
  skipScheduled,
  stopRepeating,
} from '../schedule/scheduleService.js';
import { rowRepeat } from '../schedule/repeat.js';
import {
  reorderRefusal,
  scheduleErrorMessage,
} from '../schedule/scheduledPostError.js';
import { planQueueReorder } from '../schedule/queueReorder.js';
import { armAfterPublish, timerSnippet } from '../timers/timerService.js';
import { composerTimerFit } from '../timers/selfDestruct.js';
import { postingPath } from '../routes.js';
import PostingHeader from '../ui/PostingHeader.jsx';
import TimerDialog from '../ui/TimerDialog.jsx';
import { LoadError, RowSkeleton, useLoad } from './hubParts.jsx';
import {
  applyAssignment,
  formatInZone,
  groupByZonedDay,
  moveId,
  moveIdTo,
  movableIds,
  postScheduledNow,
  rowActions,
  rowFacts,
  rowStatus,
  rowTags,
  scheduledLimitsLine,
  scheduledSections,
  timeInZone,
  timerNoteActions,
} from './scheduleModel.js';
import { ActionDialog, QueueCalendar } from './scheduleParts.jsx';
import './hub.css';
import './schedule.css';

/** 'Fri, Nov 13' from 'Fri, Nov 13, 6:00 PM': the date a moment falls on in `tz`, without its hour. */
function dayInZone(value, tz, now) {
  const full = formatInZone(value, tz, now);
  const clock = timeInZone(value, tz);
  return clock && full.endsWith(clock)
    ? full.slice(0, -clock.length).replace(/[,\s]+$/, '')
    : full;
}

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * A row of the list: its time, words, facts, state and what can be done.
 * One action is in words (Retry for a post that didn't go out, otherwise
 * Edit); the rest are in its ⋯, the one that takes it off last.
 */
function ScheduledRow({
  row,
  tz,
  now,
  showDate = false,
  lit = false,
  busy = false,
  drag = null,
  onEdit,
  onPostNow,
  onRetry,
  onCancel,
  onSkip,
  onStopRepeat,
}) {
  const facts = rowFacts(row);
  const status = rowStatus(row, now);
  const actions = rowActions(row, now);
  const tags = rowTags(facts);
  const series = rowRepeat(row, now);
  const time = timeInZone(row.scheduledFor, tz);
  const menu = [];
  if (actions.retry && actions.edit)
    menu.push({
      key: 'edit',
      label: 'Edit',
      icon: Pencil,
      onSelect: () => onEdit(row),
    });
  if (actions.postNow)
    menu.push({
      key: 'now',
      label: 'Post now',
      icon: Send,
      onSelect: () => onPostNow(row),
    });
  if (actions.skip)
    menu.push({
      key: 'skip',
      label: 'Skip this one',
      hint: series.last ? 'It’s the last, so that ends it' : 'The next one still goes out',
      icon: SkipForward,
      onSelect: () => onSkip(row),
    });
  if (actions.stopRepeat)
    menu.push({
      key: 'stop',
      label: 'Stop repeating',
      hint: row.status === 'failed' ? 'Nothing follows this one' : 'This one still goes out',
      icon: Ban,
      onSelect: () => onStopRepeat(row),
    });
  if (actions.cancel) {
    if (menu.length) menu.push({ separator: true, key: 'sep' });
    menu.push({
      key: 'cancel',
      label:
        row.status === 'failed'
          ? 'Dismiss'
          : series.repeats
            ? 'Remove, and stop repeating'
            : 'Remove from the schedule',
      icon: Trash2,
      tone: 'danger',
      onSelect: () => onCancel(row),
    });
  }
  // The small facts, in a line with dots between them. A post going out
  // now says so a step louder; part of a thread already out is a warning.
  // A failed post says nothing here, since its section's heading does.
  const meta = [
    status.tone === 'busy' && (
      <span key="status" className="is-key">
        {status.label}
      </span>
    ),
    status.tone === 'warn' && (
      <span key="status">
        <span className="badge badge--warn">{status.label}</span>
      </span>
    ),
    series.repeats && (
      <span key="repeat" className="is-key">
        <Repeat aria-hidden="true" />
        {series.label}
        {series.progress ? `, ${series.progress}` : ''}
        {series.last && !row.payload?.repeat?.count ? ', the last one' : ''}
      </span>
    ),
    series.former && row.status === 'failed' && (
      <span key="former">
        From a repeating post
        {row.occurrence ? `, number ${row.occurrence}` : ''}
      </span>
    ),
    row.queued && row.status !== 'pending' && (
      <span key="queued">From the queue</span>
    ),
    ...tags.map((t) => <span key={t}>{t}</span>),
    facts.timer && (
      <span key="timer" title={facts.timer}>
        <Hourglass aria-hidden="true" />
        Timer
        <span className="visually-hidden">: {facts.timer}</span>
      </span>
    ),
  ].filter(Boolean);
  return (
    <li
      id={`sched-row-${row.id}`}
      className={`sched-row has-corner-menu${lit ? ' is-lit' : ''}${drag?.active ? ' is-dragging' : ''}`}
      data-movable={drag?.movable ? row.id : undefined}
      aria-busy={busy || undefined}
    >
      {drag?.movable ? (
        <button
          type="button"
          className="sched-handle"
          aria-label={`Move: ${facts.text ? facts.text.slice(0, 60) : 'a post with media'}`}
          aria-describedby="sched-move-help"
          aria-pressed={drag.active || undefined}
          disabled={drag.disabled}
          onPointerDown={drag.onPointerDown}
          onPointerMove={drag.onPointerMove}
          onPointerUp={drag.onPointerUp}
          onPointerCancel={drag.onPointerCancel}
          onKeyDown={drag.onKeyDown}
        >
          <GripVertical size={16} aria-hidden="true" />
        </button>
      ) : drag ? (
        <span
          className="sched-handle sched-handle--fixed"
          title="Keeps its time"
        >
          <Lock size={14} aria-hidden="true" />
          <span className="visually-hidden">Keeps its time</span>
        </span>
      ) : null}
      {/* The time leads the row: the hour over how far off it is, or, for
          a row out of its day's run, the day over the hour. On a phone it
          is the row's first line instead. */}
      <div className="sched-when-cell">
        <time className="sched-time" dateTime={row.scheduledFor}>
          {showDate ? dayInZone(row.scheduledFor, tz, now) : time}
        </time>
        {showDate ? (
          <span className="sched-rel">{time}</span>
        ) : (
          row.status === 'pending' && (
            <span className="sched-rel">
              {relativeWhen(row.scheduledFor, now)}
            </span>
          )
        )}
      </div>
      <div className="hub-row-main sched-row-main">
        <p className="hub-row-text">
          {facts.text || <span className="muted">A post with media</span>}
        </p>
        {facts.reply && (
          <p className="sched-row-reply">
            <CornerDownRight size={13} aria-hidden="true" />
            <span className="sched-row-reply-who">
              Replying to {facts.reply.who}
            </span>
            {facts.reply.text && (
              <span className="sched-row-reply-text">{facts.reply.text}</span>
            )}
          </p>
        )}
        {meta.length > 0 && <p className="meta">{meta}</p>}
        {/* Red once: a failed post's reason, under a heading that says it
            didn't go out. A thread part way out has its badge for that, so
            its line stays in ink. */}
        {status.detail && (
          <p
            className={
              status.tone === 'danger' ? 'sched-row-why' : 'sched-row-note'
            }
          >
            {status.detail}
          </p>
        )}
      </div>
      <div className="row-actions">
        {actions.retry ? (
          <Button size="sm" onClick={() => onRetry(row)} disabled={busy}>
            {row.partial ? 'Retry the rest' : 'Retry'}
          </Button>
        ) : (
          actions.edit && (
            <Button size="sm" onClick={() => onEdit(row)} disabled={busy}>
              Edit
            </Button>
          )
        )}
        {/* A phone has no drag: the queue moves with these instead. */}
        {drag?.movable && (
          <span className="sched-steps">
            <Button
              size="sm"
              variant="ghost"
              icon
              aria-label="Move earlier"
              disabled={drag.disabled || drag.first}
              onClick={() => drag.onStep(-1)}
            >
              <ArrowUp size={16} aria-hidden="true" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              icon
              aria-label="Move later"
              disabled={drag.disabled || drag.last}
              onClick={() => drag.onStep(1)}
            >
              <ArrowDown size={16} aria-hidden="true" />
            </Button>
          </span>
        )}
        {menu.length > 0 && (
          <MoreMenu
            className="row-menu"
            label={`More for the post at ${time}`}
            items={menu}
          />
        )}
      </div>
    </li>
  );
}

function Section({ title, sub, actions = null, children, id }) {
  return (
    <section className="card card--flush" aria-labelledby={id}>
      <div className="card-head">
        <div>
          <h2 className="card-title" id={id}>
            {title}
          </h2>
          {sub && <p className="card-sub">{sub}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/**
 * Scheduled posts: what's waiting to go out for this account, in the weekly
 * queue or at a time of its own. The week
 * ahead as a calendar; the queue in order, which can be changed by dragging
 * or with the keys; and each post's state, with what can be done about it.
 */
export default function ScheduledPage({ did }) {
  const composer = useComposer();
  const toast = useToast();
  const { accounts, backendFor, targetFor } = useAtprotoSession();
  const req = backendFor(did);
  const { settings } = usePostingSettings(did);
  const schedule = settings.queue;
  const tz = resolveTimezone(schedule);
  const name = accountName(accounts.find((a) => a.did === did) || null);

  const [now, setNow] = useState(() => Date.now());
  const list = useLoad(
    async (signal) => {
      const [scheduled, limits] = await Promise.all([
        listScheduled(req, { signal }),
        getLimits(req, { signal }).catch(() => null),
      ]);
      return { ...scheduled, limits };
    },
    {
      key: did,
      did,
      events: [SCHEDULED_CHANGED_EVENT, TIMERS_CHANGED_EVENT],
      enabled: Boolean(req),
    },
  );

  const [busy, setBusy] = useState({});
  const [message, setMessage] = useState(null);
  const [override, setOverride] = useState(null);
  const [drag, setDrag] = useState(null);
  const [lit, setLit] = useState(null);
  const [announce, setAnnounce] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [timerFor, setTimerFor] = useState(null);
  const listRef = useRef(null);
  const busyRef = useRef(false);
  busyRef.current = Object.keys(busy).length > 0 || Boolean(drag);

  // The clock moves on: relative times advance, and a post whose time has
  // come is looked for again (once a minute, never mid-drag).
  useEffect(() => {
    const t = setInterval(() => {
      const at = Date.now();
      setNow(at);
      const due = (list.data?.rows || []).some(
        (r) => r.status === 'pending' && Date.parse(r.scheduledFor) <= at,
      );
      if (due && !busyRef.current) list.reload();
    }, 60_000);
    return () => clearInterval(t);
  }, [list]);

  const saved = list.data?.rows || [];
  const rows = override && override.base === list.data ? override.rows : saved;
  const movable = useMemo(() => movableIds(rows, now), [rows, now]);
  const canReorder = !isScheduleEmpty(schedule) && movable.length > 1;

  // While a row is being moved, the queue is drawn at the times the new
  // order would give it.
  const shown = useMemo(() => {
    if (!drag || drag.order.join() === movable.join()) return rows;
    const plan = planQueueReorder(schedule, rows, drag.order, new Date(now));
    return applyAssignment(rows, plan.assignment);
  }, [drag, rows, schedule, now, movable]);
  const sections = scheduledSections(shown);

  // A row that moves in the list can lose the focus as it's moved; while
  // it's being moved with the keys, the focus stays on its handle.
  useEffect(() => {
    if (drag?.via !== 'keys') return;
    const handle = document.querySelector(
      `#sched-row-${CSS.escape(drag.id)} .sched-handle`,
    );
    if (handle && document.activeElement !== handle)
      handle.focus({ preventScroll: false });
  }, [drag]);

  const setRowBusy = (id, on) =>
    setBusy((b) => {
      const next = { ...b };
      if (on) next[id] = true;
      else delete next[id];
      return next;
    });

  /* ---- reordering ---------------------------------------------------- */

  const commitOrder = async (order) => {
    const at = new Date();
    const plan = planQueueReorder(schedule, rows, order, at);
    if (plan.conflict) {
      setMessage({ tone: 'warn', text: plan.conflict.message });
      setAnnounce(plan.conflict.message);
      return;
    }
    if (!plan.moves.length) return;
    setMessage(null);
    setOverride({
      base: list.data,
      rows: applyAssignment(rows, plan.assignment),
    });
    setRowBusy('reorder', true);
    try {
      const out = await reorderScheduled(req, plan.moves);
      if (out.fallback && out.failed.length) {
        // Some rows moved and some didn't: start again from what was saved.
        const fresh = await listScheduled(req);
        const again = planQueueReorder(schedule, fresh.rows, order, new Date());
        const retry =
          again.conflict || !again.moves.length
            ? null
            : await reorderScheduled(req, again.moves);
        if (again.conflict || retry?.failed?.length) {
          throw (
            retry?.refusal ||
            Object.assign(new Error('partial'), { code: 'REORDER_PARTIAL' })
          );
        }
      }
      setAnnounce('The new order is saved.');
    } catch (err) {
      const text =
        err?.code === 'REORDER_PARTIAL'
          ? 'Couldn’t save the whole new order. The queue below is what’s saved.'
          : reorderRefusal(err) ||
            'Couldn’t save the new order. The queue below is what’s saved.';
      setMessage({ tone: 'danger', text });
      setAnnounce(text);
      setOverride(null);
      list.reload();
    } finally {
      setRowBusy('reorder', false);
    }
  };

  const positionPhrase = (order, id) => {
    const same = order.join() === movable.join();
    const plan = same
      ? null
      : planQueueReorder(schedule, rows, order, new Date());
    const at = same
      ? rows.find((r) => r.id === id)?.scheduledFor
      : plan.assignment.find((a) => a.id === id)?.newScheduledFor;
    return `Place ${order.indexOf(id) + 1} of ${order.length}${at ? `, ${formatInZone(at, tz)}` : ''}.`;
  };

  const dragFor = (row, index, count) => {
    const isMovable = canReorder && movable.includes(row.id);
    if (!canReorder) return null;
    const disabled = Boolean(busy.reorder);
    const active = drag?.id === row.id;
    return {
      movable: isMovable,
      active,
      disabled,
      first: index === 0,
      last: index === count - 1,
      onStep: (delta) => commitOrder(moveId(movable, row.id, delta)),
      onPointerDown: (e) => {
        if (disabled || (e.button !== undefined && e.button !== 0)) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        setDrag({ id: row.id, order: movable, via: 'pointer' });
      },
      onPointerMove: (e) => {
        if (!drag || drag.id !== row.id || drag.via !== 'pointer') return;
        const others = [
          ...(listRef.current?.querySelectorAll('[data-movable]') || []),
        ].filter((el) => el.dataset.movable !== row.id);
        const index = others.filter((el) => {
          const r = el.getBoundingClientRect();
          return r.top + r.height / 2 < e.clientY;
        }).length;
        const ids = others.map((el) => el.dataset.movable);
        ids.splice(index, 0, row.id);
        // The DOM holds only the rows on screen; keep any others where they were.
        const next = movable.every((id) => ids.includes(id))
          ? ids
          : moveIdTo(drag.order, row.id, index);
        if (next.join() !== drag.order.join())
          setDrag({ ...drag, order: next });
      },
      onPointerUp: () => {
        if (!drag || drag.via !== 'pointer') return;
        const order = drag.order;
        setDrag(null);
        if (order.join() !== movable.join()) commitOrder(order);
      },
      onPointerCancel: () => setDrag(null),
      onKeyDown: (e) => {
        if (disabled) return;
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          if (!drag) {
            setDrag({ id: row.id, order: movable, via: 'keys' });
            setAnnounce(
              `Picked up. ${positionPhrase(movable, row.id)} Use the up and down arrows to move it, and Space to put it down.`,
            );
          } else if (drag.id === row.id) {
            const order = drag.order;
            setDrag(null);
            if (order.join() !== movable.join()) {
              setAnnounce(
                `Put down. ${positionPhrase(order, row.id)} Saving the new order.`,
              );
              commitOrder(order);
            } else setAnnounce('Put down where it was.');
          }
        } else if (
          (e.key === 'ArrowUp' || e.key === 'ArrowDown') &&
          drag?.id === row.id
        ) {
          e.preventDefault();
          const next = moveId(drag.order, row.id, e.key === 'ArrowUp' ? -1 : 1);
          setDrag({ ...drag, order: next });
          setAnnounce(positionPhrase(next, row.id));
        } else if (e.key === 'Escape' && drag?.id === row.id) {
          e.preventDefault();
          setDrag(null);
          setAnnounce('Put back. The order hasn’t changed.');
        }
      },
    };
  };

  /* ---- row actions --------------------------------------------------- */

  const edit = (row) => composer.open({ scheduledId: row.id, asDid: did });

  const retry = async (row) => {
    setRowBusy(row.id, true);
    try {
      await retryScheduled(req, row.id);
      toast?.(
        row.partial
          ? 'The rest of the thread goes out in a moment.'
          : 'It goes out again in a moment.',
      );
    } catch (err) {
      setMessage({ tone: 'danger', text: scheduleErrorMessage(err) });
    } finally {
      setRowBusy(row.id, false);
    }
  };

  const cancel = (row) =>
    setConfirm({
      kind: 'cancel',
      row,
      run: async () => {
        try {
          await cancelScheduled(req, row.id);
          toast?.(
            row.status === 'failed'
              ? 'Dismissed.'
              : 'Removed from the schedule.',
          );
        } catch (err) {
          if (err?.code === 'NOT_CANCELLABLE' || err?.status === 409)
            list.reload();
          throw new Error(scheduleErrorMessage(err));
        }
      },
    });

  const postNow = (row) =>
    setConfirm({
      kind: 'now',
      row,
      run: async () => {
        const [{ publish }, { resolveMention }, { reconstructFromScheduled }] =
          await Promise.all([
            import('../lib/publish.js'),
            import('../lib/mentions.js'),
            import('../schedule/scheduleSerialize.js'),
          ]);
        setRowBusy(row.id, true);
        try {
          const out = await postScheduledNow(row, {
            did,
            deps: {
              requester: req,
              getScheduledMedia,
              reconstructFromScheduled,
              targetFor,
              publish,
              resolveMention,
              cancelScheduled,
              emitPostsChanged,
              skipScheduled,
              armTimer: (result, state) =>
                armAfterPublish(req, result, state.lifespan, {
                  snippet: timerSnippet(state.posts?.[0]?.text),
                  postedAt: new Date().toISOString(),
                  fit: composerTimerFit({ reply: Boolean(state.reply) }),
                }),
            },
          });
          toast?.(['Posted.', ...out.notes].join(' '), {
            ms: out.notes.length ? 9000 : 4200,
          });
        } catch (err) {
          throw new Error(
            err?.code && err.message ? err.message : scheduleErrorMessage(err),
          );
        } finally {
          setRowBusy(row.id, false);
        }
      },
    });

  const skip = (row) =>
    setConfirm({
      kind: 'skip',
      row,
      run: async () => {
        try {
          const out = await skipScheduled(req, row.id);
          toast?.(
            out.ended
              ? 'Skipped. That was the last one, so it has stopped repeating.'
              : `Skipped. The next one goes out ${formatInZone(out.next.scheduledFor, tz)}.`,
            { ms: 7000 },
          );
        } catch (err) {
          if (err?.status === 409) list.reload();
          throw new Error(scheduleErrorMessage(err));
        }
      },
    });

  const stopRepeat = (row) =>
    setConfirm({
      kind: 'stop',
      row,
      run: async () => {
        try {
          await stopRepeating(req, row.id);
          toast?.(
            row.status === 'failed'
              ? 'It won’t repeat any more.'
              : 'It goes out once more, then stops.',
          );
        } catch (err) {
          if (err?.status === 409) list.reload();
          throw new Error(scheduleErrorMessage(err));
        }
      },
    });

  const acknowledge = async (row) => {
    setRowBusy(row.id, true);
    try {
      await acknowledgeTimerNote(req, row.id);
    } catch (err) {
      setMessage({ tone: 'danger', text: scheduleErrorMessage(err) });
    } finally {
      setRowBusy(row.id, false);
    }
  };

  const pick = (row) => {
    const el = document.getElementById(`sched-row-${row.id}`);
    el?.scrollIntoView({
      block: 'center',
      behavior: reducedMotion() ? 'auto' : 'smooth',
    });
    el?.querySelector('button, a')?.focus({ preventScroll: true });
    setLit(row.id);
    setTimeout(() => setLit((l) => (l === row.id ? null : l)), 2000);
  };

  /* ---- drawing -------------------------------------------------------- */

  const loading = list.status === 'loading';
  const failed = list.status === 'error' && !list.data;
  const limitsLine = scheduledLimitsLine(list.data?.limits);
  const timerNotes = list.data?.timerNotes || [];
  const queueAll = sections.queue;
  const rowProps = (row) => ({
    row,
    tz,
    now,
    lit: lit === row.id,
    busy: Boolean(busy[row.id]),
    onEdit: edit,
    onPostNow: postNow,
    onRetry: retry,
    onCancel: cancel,
    onSkip: skip,
    onStopRepeat: stopRepeat,
  });

  // One flat list with the day names between the rows, so a row that
  // changes day while it's moved stays the same element (and keeps focus).
  const groupsOf = (sectionRows, render) =>
    groupByZonedDay(sectionRows, tz, now).flatMap((g) => [
      <li
        key={`day-${g.key}`}
        className="sched-group-label"
        role="presentation"
      >
        <h3>{g.label}</h3>
      </li>,
      ...g.rows.map(render),
    ]);

  // The header holds the page's name and nothing to press: each way to add
  // a post sits at the head of the list it adds to, and the weekly
  // schedule is reached from the week it draws.
  return (
    <>
      <PostingHeader page="scheduled" />
      <div className="page-body sched-page">
        <p className="visually-hidden" aria-live="assertive">
          {announce}
        </p>
        <p className="visually-hidden" id="sched-move-help">
          Press Space to pick it up, the up and down arrows to move it, Space
          again to put it down, or Escape to put it back.
        </p>

        {failed && (
          <LoadError
            message={`Couldn’t read ${name}’s scheduled posts. ${scheduleErrorMessage(list.error)}`}
            onRetry={list.reload}
          />
        )}
        {list.data?.unavailable && (
          <p className="callout callout--warn">
            Scheduling isn’t switched on at Virga’s server yet, so there’s
            nothing to show here.
          </p>
        )}
        {message && (
          <div
            className={`callout ${message.tone === 'danger' ? 'callout--danger' : 'callout--warn'} sched-message`}
            role="alert"
          >
            <AlertTriangle aria-hidden="true" />
            <span>{message.text}</span>
            <Button size="sm" variant="ghost" onClick={() => setMessage(null)}>
              Dismiss
            </Button>
          </div>
        )}

        {timerNotes.length > 0 && (
          <Section
            id="sched-notes"
            title="A timer couldn’t be set"
            sub="These went out, but without the timer they were scheduled with. They stay up unless you set one or delete them."
          >
            <ul className="hub-list sched-list">
              {timerNotes.map((row) => {
                const facts = rowFacts(row);
                const note = timerNoteActions(row);
                const day = dayInZone(row.scheduledFor, tz, now);
                const hour = timeInZone(row.scheduledFor, tz);
                return (
                  <li
                    key={row.id}
                    className="sched-row has-corner-menu"
                    aria-busy={busy[row.id] || undefined}
                  >
                    {/* "Went out" where a time would lead, over when: in a
                        page of times still to come, this one is past. The
                        day and the hour are each kept whole, so the column
                        breaks between them, as the overview's does. */}
                    <div className="sched-when-cell">
                      <span className="sched-time">Went out</span>
                      <time
                        className="sched-rel sched-when-past"
                        dateTime={row.scheduledFor}
                      >
                        <span>{hour ? `${day},` : day}</span>
                        {hour && <> <span>{hour}</span></>}
                      </time>
                    </div>
                    <div className="hub-row-main sched-row-main">
                      <p className="hub-row-text">
                        {facts.text || (
                          <span className="muted">A post with media</span>
                        )}
                      </p>
                      {note.note && <p className="field-hint">{note.note}</p>}
                    </div>
                    <div className="row-actions">
                      {note.arm && (
                        <Button size="sm" onClick={() => setTimerFor(note.arm)}>
                          Set a timer
                        </Button>
                      )}
                      {note.dismiss && (
                        <span className="row-menu">
                          <Button
                            size="sm"
                            variant="ghost"
                            icon
                            aria-label="Dismiss"
                            title="Dismiss"
                            onClick={() => acknowledge(row)}
                            disabled={Boolean(busy[row.id])}
                          >
                            <X size={16} aria-hidden="true" />
                          </Button>
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Section>
        )}

        {sections.attention.length > 0 && (
          <Section
            id="sched-failed"
            title="Didn’t go out"
            sub="Retry sends it again as it is. Edit it to change it first."
          >
            <ul className="hub-list sched-list">
              {sections.attention.map((row) => (
                <ScheduledRow key={row.id} {...rowProps(row)} showDate />
              ))}
            </ul>
          </Section>
        )}

        <Section
          id="sched-queue"
          title="Your queue"
          sub={
            isScheduleEmpty(schedule)
              ? 'Posts added to the queue go out at the weekly schedule’s next open time.'
              : `Posts go out in order, at the weekly schedule’s next open times.${canReorder ? ' Drag a post, or use its arrows, to change the order.' : ''}`
          }
          actions={
            <button
              type="button"
              className="link-action"
              onClick={() => composer.open({ asDid: did, mode: 'queue' })}
            >
              <ListPlus size={14} aria-hidden="true" />
              Add to queue
            </button>
          }
        >
          {loading ? (
            <>
              <div className="sched-cal-skeleton" aria-hidden="true">
                {Array.from({ length: 7 }, (_, i) => (
                  <span key={i} className="hub-bone" />
                ))}
              </div>
              <RowSkeleton rows={3} actions={1} />
            </>
          ) : (
            list.data && (
              <>
                {!isScheduleEmpty(schedule) && (
                  <QueueCalendar
                    schedule={schedule}
                    rows={queueAll.filter((r) => r.status === 'pending')}
                    now={now}
                    onPick={pick}
                    highlight={lit}
                    after={
                      <Link to={postingPath('schedule')}>Change the times</Link>
                    }
                  />
                )}
                {queueAll.length === 0 ? (
                  <div className="empty-block">
                    <p className="empty">
                      {isScheduleEmpty(schedule)
                        ? 'Your week has no posting times yet. Set some, then add posts to the queue and they go out in turn.'
                        : 'Nothing in the queue. Every time above is open: add a post and it takes the next one.'}
                    </p>
                    {isScheduleEmpty(schedule) && (
                      <Link to={postingPath('schedule')} className="btn">
                        Set posting times
                      </Link>
                    )}
                  </div>
                ) : (
                  <ul className="hub-list sched-groups" ref={listRef}>
                    {groupsOf(queueAll, (row) => {
                      const index = movable.indexOf(row.id);
                      return (
                        <ScheduledRow
                          key={row.id}
                          {...rowProps(row)}
                          drag={dragFor(row, index, movable.length)}
                        />
                      );
                    })}
                  </ul>
                )}
                {busy.reorder && (
                  <p className="card-caption">Saving the new order…</p>
                )}
              </>
            )
          )}
        </Section>

        <Section
          id="sched-timed"
          title="At a set time"
          sub="Posts with a time of their own, replies and repeating posts among them. They don’t move when the queue does."
          actions={
            <button
              type="button"
              className="link-action"
              onClick={() => composer.open({ asDid: did, mode: 'schedule' })}
            >
              <CalendarClock size={14} aria-hidden="true" />
              Schedule a post
            </button>
          }
        >
          {loading ? (
            <RowSkeleton rows={2} actions={1} />
          ) : (
            list.data &&
            (sections.timed.length === 0 ? (
              <div className="empty-block">
                <p className="empty">
                  Nothing scheduled for a set time. Write a post and choose
                  Schedule to pick when it goes out.
                </p>
              </div>
            ) : (
              <ul className="hub-list sched-groups">
                {groupsOf(sections.timed, (row) => (
                  <ScheduledRow key={row.id} {...rowProps(row)} />
                ))}
              </ul>
            ))
          )}
        </Section>

        {(limitsLine || loading) && (
          <p className="card-caption sched-limits">
            {loading ? (
              <span
                className="hub-bone"
                style={{ width: 260 }}
                aria-hidden="true"
              />
            ) : (
              limitsLine
            )}
          </p>
        )}
      </div>

      <ActionDialog
        open={confirm?.kind === 'cancel'}
        title={
          confirm?.row?.status === 'failed'
            ? 'Dismiss this post?'
            : 'Remove this scheduled post?'
        }
        tone="danger"
        confirmLabel={confirm?.row?.status === 'failed' ? 'Dismiss' : 'Remove'}
        busyLabel="Removing…"
        onConfirm={confirm?.run}
        onClose={() => setConfirm(null)}
      >
        <p>
          It won’t go out, and Virga’s server deletes its copy, images included.
          {confirm?.row && rowRepeat(confirm.row).repeats
            ? ' It stops repeating too: nothing follows it.'
            : ''}{' '}
          This can’t be undone.
        </p>
        {confirm?.row && rowFacts(confirm.row).text && (
          <blockquote className="hub-quote">
            {rowFacts(confirm.row).text.slice(0, 200)}
          </blockquote>
        )}
      </ActionDialog>
      <ActionDialog
        open={confirm?.kind === 'now'}
        title="Post this now?"
        confirmLabel="Post now"
        busyLabel="Posting…"
        onConfirm={confirm?.run}
        onClose={() => setConfirm(null)}
      >
        <p>
          It goes out at once as {name}, with the settings it was scheduled
          with, and comes off the schedule.
          {confirm?.row && rowFacts(confirm.row).timer
            ? ' Its timer starts now.'
            : ''}
          {confirm?.row?.status === 'pending' &&
          rowRepeat(confirm.row).repeats
            ? ' It takes the place of this one; the next still goes out at its time.'
            : ''}
        </p>
        {confirm?.row && rowFacts(confirm.row).text && (
          <blockquote className="hub-quote">
            {rowFacts(confirm.row).text.slice(0, 200)}
          </blockquote>
        )}
      </ActionDialog>
      <ActionDialog
        open={confirm?.kind === 'skip'}
        title="Skip this one?"
        confirmLabel="Skip it"
        busyLabel="Skipping…"
        onConfirm={confirm?.run}
        onClose={() => setConfirm(null)}
      >
        <p>
          {confirm?.row && rowRepeat(confirm.row).last
            ? 'This one doesn’t go out. It’s the last, so the post stops repeating and Virga’s server deletes its copy.'
            : `The one due ${confirm?.row ? formatInZone(confirm.row.scheduledFor, tz, now) : ''} doesn’t go out. The next one takes its place, at its usual time.`}
        </p>
        {confirm?.row && rowFacts(confirm.row).text && (
          <blockquote className="hub-quote">
            {rowFacts(confirm.row).text.slice(0, 200)}
          </blockquote>
        )}
      </ActionDialog>
      <ActionDialog
        open={confirm?.kind === 'stop'}
        title="Stop this post repeating?"
        confirmLabel="Stop repeating"
        busyLabel="Stopping…"
        onConfirm={confirm?.run}
        onClose={() => setConfirm(null)}
      >
        <p>
          {confirm?.row?.status === 'failed'
            ? 'Nothing follows this one. It stays here to retry or dismiss.'
            : `It still goes out ${confirm?.row ? formatInZone(confirm.row.scheduledFor, tz, now) : ''}, once, and nothing follows it. To take this one off too, remove it instead.`}
        </p>
        {confirm?.row && rowFacts(confirm.row).text && (
          <blockquote className="hub-quote">
            {rowFacts(confirm.row).text.slice(0, 200)}
          </blockquote>
        )}
      </ActionDialog>
      {timerFor && (
        <TimerDialog
          open
          did={did}
          post={timerFor}
          onClose={() => setTimerFor(null)}
          onArmed={async () => {
            const row = timerFor.row;
            setTimerFor(null);
            toast?.('The timer is set. Posting › Timers shows it.');
            if (!row) return;
            await acknowledge(row);
          }}
        />
      )}
    </>
  );
}
