import { useEffect, useId, useMemo, useState } from 'react';
import { CalendarClock, ListTree } from 'lucide-react';
import Button from '../../components/Button.jsx';
import { Link } from '../../lib/router.jsx';
import { useAtprotoSession } from '../../session/useAtprotoSession.jsx';
import { usePostingSettings } from '../settings.js';
import {
  MIN_LEAD_MS,
  QUEUE_HORIZON_DAYS,
  isScheduleEmpty,
  nextOpenSlot,
  resolveTimezone,
  zonedWallTime,
  zonedWallTimeToUtc,
} from '../schedule/postingQueue.js';
import { listScheduled } from '../schedule/scheduleService.js';
import {
  formatInZone,
  quickPicks,
  whenProblem,
  zoneLabel,
} from '../pages/scheduleModel.js';
import { postingPath } from '../routes.js';
import '../pages/schedule.css';

const instant = (v) => (v ? Date.parse(v) : NaN);

/**
 * When a post goes out: a date and a time on the account's queue clock (its
 * weekly schedule's time zone), quick picks, and with `queue` the next open
 * time in the weekly queue and a way to use it (`onQueue`). `value` is an ISO
 * string or null; `onChange` hears an ISO string, or null while the date or
 * time is incomplete. `min` and `max` default to what Virga's server takes:
 * a minute from now to 90 days out.
 */
export default function WhenPicker({
  did,
  value,
  onChange,
  queue = false,
  onQueue,
  min,
  max,
}) {
  const { backendFor, capabilitiesFor } = useAtprotoSession();
  const { settings } = usePostingSettings(did);
  const schedule = settings.queue;
  const tz = resolveTimezone(schedule);
  const device = resolveTimezone(null);
  const baseId = useId();
  const [now, setNow] = useState(() => Date.now());

  // The clock moves on while the picker is open; the bounds and picks follow.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const lo = Number.isFinite(instant(min)) ? instant(min) : now + MIN_LEAD_MS;
  const hi = Number.isFinite(instant(max))
    ? instant(max)
    : now + QUEUE_HORIZON_DAYS * 86_400_000;

  // What's typed, on the queue's clock. Kept apart from `value` so a date
  // typed before its time isn't wiped by the parent's null.
  const [parts, setParts] = useState(
    () => zonedWallTime(value, tz) || { date: '', time: '' },
  );
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    const ms = instant(value);
    if (!Number.isFinite(ms)) return;
    setParts((p) => {
      const shown = zonedWallTimeToUtc(p.date, p.time, tz);
      return shown && shown.getTime() === ms ? p : zonedWallTime(ms, tz) || p;
    });
  }, [value, tz]);

  const emit = (next) => {
    setParts(next);
    setTouched(true);
    const at = zonedWallTimeToUtc(next.date, next.time, tz);
    onChange?.(at ? at.toISOString() : null);
  };

  const picks = useMemo(
    () => quickPicks(now, tz, { min: lo, max: hi }),
    [now, tz, lo, hi],
  );
  const problem =
    touched || value ? whenProblem(value, now, { min: lo, max: hi }) : '';
  const loDay = zonedWallTime(lo, tz)?.date;
  const hiDay = zonedWallTime(hi, tz)?.date;

  // The next open time in the weekly queue, when asked for.
  const req =
    queue && did && capabilitiesFor(did).canSchedule ? backendFor(did) : null;
  const [taken, setTaken] = useState({ status: 'idle', rows: [] });
  useEffect(() => {
    if (!queue) return undefined;
    if (!req) {
      setTaken({ status: 'none', rows: [] });
      return undefined;
    }
    let live = true;
    setTaken({ status: 'loading', rows: [] });
    listScheduled(req).then(
      (list) =>
        live &&
        setTaken({
          status: 'ready',
          rows: list.rows.filter(
            (r) =>
              r.queued && (r.status === 'pending' || r.status === 'publishing'),
          ),
        }),
      () => live && setTaken({ status: 'error', rows: [] }),
    );
    return () => {
      live = false;
    };
  }, [queue, req]);
  const slot =
    queue && taken.status !== 'loading'
      ? nextOpenSlot(schedule, taken.rows, new Date(now))
      : null;

  const describedBy = `${baseId}-zone${problem ? ` ${baseId}-problem` : ''}`;

  return (
    <div className="when-picker sched-when">
      <div className="sched-when-fields">
        <label className="field" htmlFor={`${baseId}-date`}>
          <span className="field-label">Date</span>
          <input
            id={`${baseId}-date`}
            type="date"
            className="input"
            value={parts.date}
            min={loDay}
            max={hiDay}
            onChange={(e) => emit({ ...parts, date: e.target.value })}
            aria-describedby={describedBy}
            aria-invalid={problem ? true : undefined}
          />
        </label>
        <label className="field" htmlFor={`${baseId}-time`}>
          <span className="field-label">Time</span>
          <input
            id={`${baseId}-time`}
            type="time"
            step={300}
            className="input"
            value={parts.time}
            onChange={(e) => emit({ ...parts, time: e.target.value })}
            aria-describedby={describedBy}
            aria-invalid={problem ? true : undefined}
          />
        </label>
      </div>

      {picks.length > 0 && (
        <div className="sched-picks" role="group" aria-label="Quick picks">
          {picks.map((p) => {
            const on = instant(value) === p.at.getTime();
            return (
              <button
                key={p.key}
                type="button"
                className="chip"
                aria-pressed={on}
                title={formatInZone(p.at, tz, now)}
                onClick={() => {
                  setTouched(true);
                  setParts(zonedWallTime(p.at, tz) || parts);
                  onChange?.(p.at.toISOString());
                }}
              >
                {p.label}
              </button>
            );
          })}
        </div>
      )}

      <p className="field-hint sched-when-zone" id={`${baseId}-zone`}>
        {tz === device ? (
          <>Times are in your time zone, {zoneLabel(tz)}.</>
        ) : (
          <>
            Times are in {zoneLabel(tz)}, your weekly schedule’s time zone. This
            device is in {zoneLabel(device)}.
          </>
        )}
        {Number.isFinite(instant(value)) && !problem && (
          <> Goes out {formatInZone(value, tz, now)}.</>
        )}
      </p>
      {problem && (
        <p
          className="field-hint sched-problem"
          id={`${baseId}-problem`}
          role="alert"
        >
          {problem}
        </p>
      )}

      {queue && (
        <div className="sched-when-queue">
          <ListTree size={16} aria-hidden="true" />
          <div className="sched-when-queue-text">
            {taken.status === 'loading' ? (
              <span className="field-hint">
                Finding the next open time in your queue…
              </span>
            ) : isScheduleEmpty(schedule) ? (
              <span className="field-hint">
                Your weekly schedule has no times yet.{' '}
                <Link to={postingPath('schedule')}>Set some</Link> to use the
                queue.
              </span>
            ) : slot ? (
              <span>
                Next open time in your queue:{' '}
                <strong>{formatInZone(slot, tz, now)}</strong>
                {taken.status === 'error' && (
                  <span className="field-hint">
                    {' '}
                    (couldn’t check what’s already queued)
                  </span>
                )}
              </span>
            ) : (
              <span className="field-hint">
                Your queue has no open times in the next 90 days.
              </span>
            )}
          </div>
          {onQueue && slot && (
            <Button size="sm" onClick={onQueue}>
              <CalendarClock size={14} aria-hidden="true" />
              Use this time
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
