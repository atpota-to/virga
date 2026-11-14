import { useId, useMemo, useState } from 'react';
import {
  CalendarClock,
  Copy,
  Lightbulb,
  ListRestart,
  Plus,
  RotateCcw,
  X,
} from 'lucide-react';
import Button from '../../components/Button.jsx';
import Menu from '../../components/Menu.jsx';
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
  formatInZone,
  isDefaultWeek,
  moveToZone,
  nextOpenSlots,
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

/** One weekday's times, with a way to add one, copy them, or clear the day. */
function DayRow({ day, times, onAdd, onRemove, onCopy, onClear }) {
  const [adding, setAdding] = useState(false);
  const [time, setTime] = useState('09:00');
  const id = useId();
  const add = () => {
    if (!time) return;
    onAdd(time);
    setAdding(false);
  };
  const copyItems = [
    ...COPY_TARGETS.map((t) => ({
      key: t.key,
      label: `Copy to ${t.label.toLowerCase()}`,
      icon: Copy,
      onSelect: () => onCopy(t.days),
    })),
    { separator: true, key: 'sep-days' },
    ...WEEKDAYS.filter((d) => d.key !== day.key).map((d) => ({
      key: d.key,
      label: `Copy to ${d.label}`,
      onSelect: () => onCopy([d.key]),
    })),
  ];
  return (
    <li className="sched-day">
      <h3 className="sched-day-name" id={`${id}-name`}>
        {day.label}
      </h3>
      <div className="sched-day-times">
        {times.length === 0 && !adding && (
          <span className="field-hint">No posting times</span>
        )}
        <ul className="sched-slot-list" aria-labelledby={`${id}-name`}>
          {times.map((t) => (
            <li key={t} className="sched-slot">
              <span>{slotLabel(t)}</span>
              <button
                type="button"
                className="sched-slot-x"
                aria-label={`Remove ${slotLabel(t)} on ${LONG_DAY[day.key]}`}
                onClick={() => onRemove(t)}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
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
                  setAdding(false);
                }
              }}
              // The field is what was asked for; it takes the focus.
              autoFocus
            />
            <Button size="sm" variant="primary" type="submit">
              Add
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </form>
        )}
      </div>
      <div className="sched-day-actions">
        {!adding && (
          <Button
            size="sm"
            onClick={() => setAdding(true)}
            aria-label={`Add a time on ${LONG_DAY[day.key]}`}
          >
            <Plus size={14} aria-hidden="true" />
            <span className="sched-hide-narrow">Add a time</span>
          </Button>
        )}
        <Menu
          label={`More for ${LONG_DAY[day.key]}`}
          icon
          size="sm"
          items={
            times.length
              ? [
                  ...copyItems,
                  { separator: true, key: 'sep' },
                  {
                    key: 'clear',
                    label: 'Clear this day',
                    tone: 'danger',
                    icon: X,
                    onSelect: onClear,
                  },
                ]
              : [
                  {
                    key: 'clear',
                    label: 'Clear this day',
                    icon: X,
                    onSelect: onClear,
                  },
                ]
          }
        >
          <Copy size={15} aria-hidden="true" />
        </Menu>
      </div>
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
 * they're read in, what the next open times are, and suggestions from the
 * account's best times. Every change is saved as it's made, in this browser.
 * Posts already queued keep their times until the queue is moved onto the
 * new ones.
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
  const open = nextOpenSlots(schedule, queued, now, 5);
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
      <PostingHeader
        page="schedule"
        actions={
          <Link to={postingPath('scheduled')} className="btn btn--sm">
            <CalendarClock size={14} aria-hidden="true" />
            Scheduled posts
          </Link>
        }
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
            className="card sched-suggest"
            aria-labelledby="sched-suggest-title"
          >
            <span className="sched-suggest-icon" aria-hidden="true">
              <Lightbulb size={17} />
            </span>
            <div className="sched-suggest-text">
              <h2 className="card-title" id="sched-suggest-title">
                Times your posts have done well
              </h2>
              <p className="card-sub">
                From your posts over the last year, in {zoneLabel(device)} time:{' '}
                {[...suggestions.items]
                  .sort(
                    (a, b) =>
                      WEEKDAYS.findIndex((d) => d.key === a.dayKey) -
                        WEEKDAYS.findIndex((d) => d.key === b.dayKey) ||
                      a.time.localeCompare(b.time),
                  )
                  .map(
                    (s) =>
                      `${WEEKDAYS.find((d) => d.key === s.dayKey)?.label} ${slotLabel(s.time)}`,
                  )
                  .join(', ')}
                .
                {shippedOrEmpty
                  ? ' They can replace the starting times.'
                  : ' They can be added beside your own.'}
              </p>
              <div className="sched-suggest-actions">
                <Button
                  size="sm"
                  variant="primary"
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
            </div>
          </section>
        )}

        <div className="sched-week-layout">
          <section
            className="card sched-week"
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
              {WEEKDAYS.map((day) => (
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
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setResetting(true)}
                >
                  <RotateCcw size={14} aria-hidden="true" />
                  Start again from the default
                </Button>
              )}
            </div>
          </section>

          <div className="sched-week-side">
            <section className="card" aria-labelledby="sched-next-title">
              <h2 className="card-title" id="sched-next-title">
                Next open times
              </h2>
              <p className="card-sub">
                Where the next posts added to the queue go
                {list.status === 'ready'
                  ? ', stepping round what’s already queued.'
                  : '.'}
              </p>
              {empty ? (
                <p className="empty">
                  No posting times yet. Add a time to a day and the next ones
                  show here.
                </p>
              ) : list.status === 'loading' ? (
                <ul className="sched-next" aria-hidden="true">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <li key={i}>
                      <span
                        className="hub-bone"
                        style={{ width: `${[70, 60, 66, 54, 62][i]}%` }}
                      />
                    </li>
                  ))}
                </ul>
              ) : open.length ? (
                <ol className="sched-next">
                  {open.map((slot) => (
                    <li key={slot.getTime()}>{formatInZone(slot, tz, now)}</li>
                  ))}
                </ol>
              ) : (
                <p className="empty">No open times in the next 90 days.</p>
              )}
              {list.status === 'error' && (
                <p className="field-hint">
                  Couldn’t read what’s already queued, so these may be taken.
                </p>
              )}
              {list.status === 'ready' && (
                <p className="card-caption">
                  {summary.queuedCount === 1
                    ? '1 post is'
                    : `${summary.queuedCount} posts are`}{' '}
                  in the queue
                  {summary.scheduledCount
                    ? `, and ${summary.scheduledCount} at a set time`
                    : ''}
                  . <Link to={postingPath('scheduled')}>See them</Link>
                </p>
              )}
            </section>

            {off.length > 0 && (
              <section className="card" aria-labelledby="sched-off-title">
                <h2 className="card-title" id="sched-off-title">
                  {off.length === 1
                    ? '1 queued post is off these times'
                    : `${off.length} queued posts are off these times`}
                </h2>
                <p className="card-sub">
                  Posts already in the queue keep the times they were given.
                  Move them onto the week’s times, in the order they’re in now.
                </p>
                <div className="sched-side-actions">
                  <Button
                    size="sm"
                    onClick={repack}
                    disabled={repacking || empty}
                    aria-busy={repacking || undefined}
                  >
                    <ListRestart size={14} aria-hidden="true" />
                    {repacking ? 'Moving…' : 'Move them onto these times'}
                  </Button>
                </div>
              </section>
            )}

            <section className="card" aria-labelledby="sched-preview-title">
              <h2 className="card-title" id="sched-preview-title">
                The week ahead
              </h2>
              {empty ? (
                <p className="empty">No posting times yet.</p>
              ) : (
                <QueueCalendar
                  schedule={schedule}
                  rows={queued.filter((r) => r.status === 'pending')}
                  now={now}
                  occupancy={list.status === 'ready'}
                />
              )}
            </section>

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
