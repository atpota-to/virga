import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Copy, Plus, RotateCcw, Trash2, X } from 'lucide-react';
import Button from '../../components/Button.jsx';
import { MoreMenu } from '../../components/Menu.jsx';
import { Link } from '../../lib/router.jsx';
import { useToast } from '../../shell/bits.jsx';
import { useArchive, isBuilt } from '../../archive/ArchiveContext.jsx';
import { useAtprotoSession } from '../../session/useAtprotoSession.jsx';
import { bestTimeModel } from '../../reports/models.js';
import { SCHEDULED_CHANGED_EVENT } from '../events.js';
import { usePostingSettings } from '../settings.js';
import {
  DEFAULT_POSTING_QUEUE,
  WEEKDAYS,
  isScheduleEmpty,
  resolveTimezone,
  summarizeQueue,
} from '../schedule/postingQueue.js';
import {
  listScheduled,
  reorderScheduled,
} from '../schedule/scheduleService.js';
import { planQueueReorder, splitQueueRows } from '../schedule/queueReorder.js';
import {
  reorderRefusal,
  scheduleErrorMessage,
} from '../schedule/scheduledPostError.js';
import {
  mergeSuggestionsIntoSchedule,
  missingSuggestions,
  scheduleFromSuggestions,
  suggestionsFromBestTimes,
} from '../schedule/queueSuggestions.js';
import { postingPath } from '../routes.js';
import PostingHeader from '../ui/PostingHeader.jsx';
import { useLoad } from './hubParts.jsx';
import {
  COPY_TARGETS,
  addSlot,
  clearDay,
  copyDay,
  isDefaultWeek,
  moveToZone,
  offScheduleRows,
  removeSlot,
  slotLabel,
  weekSummary,
  weeklyCount,
  zoneLabel,
} from './scheduleModel.js';
import {
  ActionDialog,
  QueueCalendar,
  Switch,
  TimezoneSelect,
} from './scheduleParts.jsx';
import './hub.css';
import './schedule.css';
import { weekOrder } from '../../lib/locale.js';

/** The weekdays in the order the reader's week runs (Settings › Appearance). */
function orderedWeekdays() {
  // weekOrder counts from Sunday as 0; WEEKDAYS starts on Monday.
  return weekOrder().map((day) => WEEKDAYS[(day + 6) % 7]);
}

const YEAR = { key: '1y', days: 365, label: 'Year' };
const LONG_DAY = {
  mon: 'Mondays',
  tue: 'Tuesdays',
  wed: 'Wednesdays',
  thu: 'Thursdays',
  fri: 'Fridays',
  sat: 'Saturdays',
  sun: 'Sundays',
};

/**
 * One weekday's times as a band: its name, its times as tokens with a + to
 * add one after them, and a ⋯ to copy them or clear the day, offered only
 * when there is something to copy or clear.
 */
function DayRow({ day, times, onAdd, onRemove, onCopy, onClear }) {
  const [adding, setAdding] = useState(false);
  const [time, setTime] = useState('09:00');
  const id = useId();
  const addRef = useRef(null);
  const listRef = useRef(null);
  // What held the focus can go (the form, a time, the ⋯ of a day just
  // cleared), so the focus is put back in the band: on the + once the form
  // closes or the day is cleared; after a time is taken off, on the time
  // that took its place, the one before it, or the + when none is left.
  const refocus = useRef(null);
  useEffect(() => {
    const at = refocus.current;
    if (at === null) return;
    refocus.current = null;
    const removes = listRef.current?.querySelectorAll('.token-remove') || [];
    const target =
      at === 'add'
        ? addRef.current
        : removes[Math.min(at, removes.length - 1)] || addRef.current;
    target?.focus();
  });
  const close = () => {
    refocus.current = 'add';
    setAdding(false);
  };
  const add = () => {
    if (!time) return;
    onAdd(time);
    close();
  };
  const copyItems = [
    ...COPY_TARGETS.map((t) => ({
      key: t.key,
      label: `Copy to ${t.label.toLowerCase()}`,
      icon: Copy,
      onSelect: () => onCopy(t.days),
    })),
    { separator: true, key: 'sep-days' },
    ...orderedWeekdays().filter((d) => d.key !== day.key).map((d) => ({
      key: d.key,
      label: `Copy to ${d.label}`,
      icon: Copy,
      onSelect: () => onCopy([d.key]),
    })),
  ];
  return (
    <li className="sched-day">
      <h3 className="sched-day-name" id={`${id}-name`}>
        {day.label}
      </h3>
      <div className="sched-day-times tokens">
        {times.length === 0 && !adding && (
          <span className="sched-day-none">No posting times</span>
        )}
        <ul
          className="sched-day-list"
          aria-labelledby={`${id}-name`}
          ref={listRef}
        >
          {times.map((t, i) => (
            <li key={t} className="token">
              {slotLabel(t)}
              <button
                type="button"
                className="token-remove"
                aria-label={`Remove ${slotLabel(t)} on ${LONG_DAY[day.key]}`}
                onClick={() => {
                  refocus.current = i;
                  onRemove(t);
                }}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        {!adding && (
          <Button
            ref={addRef}
            size="sm"
            variant="ghost"
            icon
            className="sched-day-add"
            onClick={() => setAdding(true)}
            aria-label={`Add a time on ${LONG_DAY[day.key]}`}
            title={`Add a time on ${LONG_DAY[day.key]}`}
          >
            <Plus size={16} aria-hidden="true" />
          </Button>
        )}
        {adding && (
          <form
            className="sched-add"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <label className="visually-hidden" htmlFor={`${id}-time`}>
              New time on {LONG_DAY[day.key]}
            </label>
            <input
              id={`${id}-time`}
              type="time"
              step={300}
              className="input sched-add-input"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  close();
                }
              }}
              // The field is what was asked for; it takes the focus.
              autoFocus
            />
            <Button size="sm" variant="primary" type="submit">
              Add
            </Button>
            <Button size="sm" variant="ghost" onClick={close}>
              Cancel
            </Button>
          </form>
        )}
      </div>
      {times.length > 0 && (
        <MoreMenu
          className="sched-day-menu"
          label={`More for ${LONG_DAY[day.key]}`}
          items={[
            ...copyItems,
            { separator: true, key: 'sep' },
            {
              key: 'clear',
              label: 'Clear this day',
              tone: 'danger',
              icon: Trash2,
              onSelect: () => {
                refocus.current = 'add';
                onClear();
              },
            },
          ]}
        />
      )}
    </li>
  );
}

/** Times suggested from the account's best times, when the archive says enough. */
function useSuggestions(did, schedule, enabled) {
  const archive = useArchive();
  return useMemo(() => {
    if (!enabled || archive.did !== did || !isBuilt(archive))
      return { status: archive.loaded ? 'none' : 'loading', items: [] };
    const model = bestTimeModel(archive, YEAR, archive.nowMs, { block: 1 });
    const items = suggestionsFromBestTimes(model.best, 1);
    if (!items.length) return { status: 'none', items: [] };
    return {
      status: 'ready',
      items,
      missing: missingSuggestions(schedule, items),
    };
  }, [archive, did, schedule, enabled]);
}

/**
 * The weekly schedule: the times each week a queued post goes out, the zone
 * they're read in, the week ahead as a grid of what's open, and suggestions
 * from the account's best times. Every change is saved as it's made, in this
 * browser. Posts already queued keep their times until the queue is moved
 * onto the new ones.
 */
export default function WeeklySchedulePage({ did }) {
  const toast = useToast();
  const { backendFor } = useAtprotoSession();
  const req = backendFor(did);
  const { settings, update } = usePostingSettings(did);
  const schedule = settings.queue;
  const tz = resolveTimezone(schedule);
  const device = resolveTimezone(null);
  const tzId = useId();
  const [error, setError] = useState('');
  const [resetting, setResetting] = useState(false);
  const [repacking, setRepacking] = useState(false);
  const now = Date.now();

  const list = useLoad((signal) => listScheduled(req, { signal }), {
    key: did,
    did,
    events: [SCHEDULED_CHANGED_EVENT],
    enabled: Boolean(req),
  });
  const rows = list.data?.rows || [];
  const queued = rows.filter(
    (r) => r.queued && (r.status === 'pending' || r.status === 'publishing'),
  );
  const summary = summarizeQueue(rows);
  const off = offScheduleRows(schedule, rows, now);
  const suggestions = useSuggestions(did, schedule, settings.suggestBestTimes);

  const save = (queue) => {
    try {
      update({ queue });
      setError('');
    } catch (err) {
      setError(err?.message || 'That change couldn’t be saved.');
    }
  };

  const repack = async () => {
    const at = new Date();
    const { movable } = splitQueueRows(rows, { now: at });
    const plan = planQueueReorder(
      schedule,
      rows,
      movable.map((r) => r.id),
      at,
    );
    if (plan.conflict) {
      setError(plan.conflict.message);
      return;
    }
    if (!plan.moves.length) return;
    setRepacking(true);
    try {
      const out = await reorderScheduled(req, plan.moves);
      if (out.failed.length)
        throw (
          out.refusal ||
          Object.assign(new Error('partial'), { code: 'REORDER_PARTIAL' })
        );
      toast?.(
        plan.moves.length === 1
          ? 'Moved 1 queued post onto the new times.'
          : `Moved ${plan.moves.length} queued posts onto the new times.`,
      );
    } catch (err) {
      setError(
        err?.code === 'REORDER_PARTIAL'
          ? 'Some queued posts couldn’t be moved. Scheduled posts shows where each one is.'
          : reorderRefusal(err) || scheduleErrorMessage(err),
      );
      list.reload();
    } finally {
      setRepacking(false);
    }
  };

  const empty = isScheduleEmpty(schedule);
  const shippedOrEmpty = empty || isDefaultWeek(schedule);
  const showSuggestions =
    settings.suggestBestTimes &&
    suggestions.status === 'ready' &&
    suggestions.missing.length > 0;

  return (
    <>
      {/* The page is reached from Scheduled posts, so that is the way back
          up; there is nothing to press in the header. */}
      <PostingHeader
        page="schedule"
        crumbs={[
          { label: 'Posting', to: postingPath('hub') },
          { label: 'Scheduled posts', to: postingPath('scheduled') },
        ]}
      />
      <div className="page-body sched-page">
        {error && (
          <p className="callout callout--danger" role="alert">
            {error}
          </p>
        )}

        {tz !== device && (
          <div className="callout callout--warn sched-message">
            <span>
              Your week is set in {zoneLabel(tz)}, and this device is in{' '}
              {zoneLabel(device)}. Its times go out on {zoneLabel(tz)}’s clock.
            </span>
            <Button
              size="sm"
              onClick={() => save(moveToZone(schedule, device))}
            >
              Use {zoneLabel(device)}
            </Button>
          </div>
        )}

        {showSuggestions && (
          <section
            className="sched-suggest"
            aria-labelledby="sched-suggest-title"
          >
            <h2 className="card-title" id="sched-suggest-title">
              Times your posts have done well
            </h2>
            <p className="card-sub">
              From your posts over the last year, in {zoneLabel(device)} time:{' '}
              {[...suggestions.items]
                .sort(
                  (a, b) =>
                    orderedWeekdays().findIndex((d) => d.key === a.dayKey) -
                      orderedWeekdays().findIndex((d) => d.key === b.dayKey) ||
                    a.time.localeCompare(b.time),
                )
                // Each day and time kept whole, so a line never breaks
                // between an hour and its AM or PM.
                .map((s, i) => (
                  <span key={`${s.dayKey}-${s.time}`}>
                    {i > 0 && ', '}
                    <span className="sched-suggest-time">
                      {WEEKDAYS.find((d) => d.key === s.dayKey)?.label}{' '}
                      {slotLabel(s.time)}
                    </span>
                  </span>
                ))}
              .
              {shippedOrEmpty
                ? ' They can replace the starting times.'
                : ' They can be added beside your own.'}
            </p>
            <div className="sched-suggest-actions">
              <Button
                size="sm"
                onClick={() =>
                  save(
                    shippedOrEmpty
                      ? scheduleFromSuggestions(suggestions.items, device)
                      : mergeSuggestionsIntoSchedule(
                          schedule,
                          suggestions.missing,
                        ),
                  )
                }
              >
                {shippedOrEmpty ? 'Use these times' : 'Add these times'}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => update({ suggestBestTimes: false })}
              >
                Stop suggesting
              </Button>
            </div>
          </section>
        )}

        <div className="sched-week-layout">
          <section
            className="card card--flush sched-week"
            aria-labelledby="sched-week-title"
          >
            <div className="card-head">
              <div>
                <h2 className="card-title" id="sched-week-title">
                  Posting times
                </h2>
                <p className="card-sub">
                  {weeklyCount(schedule) === 1
                    ? '1 time a week'
                    : `${weeklyCount(schedule)} times a week`}
                  . {weekSummary(schedule)}
                </p>
              </div>
            </div>
            <div className="sched-week-body">
              <div className="field sched-tz-field">
                <label className="field-label" htmlFor={tzId}>
                  Time zone
                </label>
                <TimezoneSelect
                  id={tzId}
                  value={tz}
                  onChange={(z) => save(moveToZone(schedule, z))}
                />
                <span className="field-hint">
                  The times below are read on this clock, wherever you are when
                  they come round.
                </span>
              </div>
              <ul className="sched-days">
                {orderedWeekdays().map((day) => (
                  <DayRow
                    key={day.key}
                    day={day}
                    times={schedule.slots?.[day.key] || []}
                    onAdd={(t) => save(addSlot(schedule, day.key, t, device))}
                    onRemove={(t) => save(removeSlot(schedule, day.key, t))}
                    onCopy={(to) => save(copyDay(schedule, day.key, to))}
                    onClear={() => save(clearDay(schedule, day.key))}
                  />
                ))}
              </ul>
              <div className="card-foot sched-week-foot">
                <span>Saved as you go, in this browser.</span>
                {!isDefaultWeek(schedule) && (
                  <button
                    type="button"
                    className="link-action"
                    onClick={() => setResetting(true)}
                  >
                    <RotateCcw size={14} aria-hidden="true" />
                    Start again from the default
                  </button>
                )}
              </div>
            </div>
          </section>

          {/* Its heading has a line under the title, as the week's has, and
              the two headings share a row, so the two rules in ink line up
              side by side however long the week's summary runs. */}
          <div className="sched-week-side">
            <section
              className="card card--flush sched-week-preview"
              aria-labelledby="sched-preview-title"
            >
              <div className="card-head">
                <div>
                  <h2 className="card-title" id="sched-preview-title">
                    The week ahead
                  </h2>
                  <p className="card-sub">
                    Open times over the next seven days.
                  </p>
                </div>
              </div>
              {/* With no times there is no week to draw, and nothing in it
                  that could be taken. */}
              {empty ? (
                <div className="empty-block sched-week-body">
                  <p className="empty">No posting times yet.</p>
                </div>
              ) : (
                <div className="sched-week-body">
                  <QueueCalendar
                    schedule={schedule}
                    rows={queued.filter((r) => r.status === 'pending')}
                    now={now}
                    occupancy={list.status === 'ready'}
                    lead={
                      list.status === 'ready' ? (
                        <>
                          {summary.queuedCount === 1
                            ? '1 post is'
                            : `${summary.queuedCount} posts are`}{' '}
                          in the queue
                          {summary.scheduledCount
                            ? `, and ${summary.scheduledCount} at a set time`
                            : ''}
                          . <Link to={postingPath('scheduled')}>See them</Link>.
                        </>
                      ) : null
                    }
                  />
                  {list.status === 'error' && (
                    <p className="field-hint">
                      Couldn’t read what’s already queued, so these may be
                      taken.
                    </p>
                  )}
                </div>
              )}
            </section>

            {(off.length > 0 || !settings.suggestBestTimes) && (
              <div className="sched-week-more">
                {off.length > 0 && (
                  <section className="card" aria-labelledby="sched-off-title">
                    <div className="card-head">
                      <div>
                        <h2 className="card-title" id="sched-off-title">
                          {off.length === 1
                            ? '1 queued post is off these times'
                            : `${off.length} queued posts are off these times`}
                        </h2>
                        <p className="card-sub">
                          Posts already in the queue keep the times they were
                          given. Move them onto the week’s times, in the order
                          they’re in now.
                        </p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      onClick={repack}
                      disabled={repacking || empty}
                      aria-busy={repacking || undefined}
                    >
                      {repacking ? 'Moving…' : 'Move them onto these times'}
                    </Button>
                  </section>
                )}

                {!settings.suggestBestTimes && (
                  <div className="sched-suggest-off">
                    <Switch
                      checked={false}
                      onChange={(v) => update({ suggestBestTimes: v })}
                      label="Suggest times from my best times"
                      hint="Uses the archive in this browser; nothing is sent anywhere."
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <ActionDialog
        open={resetting}
        title="Start again from the default?"
        confirmLabel="Use the default"
        onConfirm={() =>
          save({
            timezone: schedule.timezone || device,
            slots: JSON.parse(JSON.stringify(DEFAULT_POSTING_QUEUE.slots)),
          })
        }
        onClose={() => setResetting(false)}
      >
        <p>
          The week goes back to weekdays at {slotLabel('09:00')} and{' '}
          {slotLabel('17:00')}, in {zoneLabel(tz)}. Posts already queued keep
          their times.
        </p>
      </ActionDialog>
    </>
  );
}
