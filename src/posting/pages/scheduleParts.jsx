// Pieces the Scheduled and Weekly schedule pages (and Settings › Posting)
// share: the time-zone picker, the week ahead as a calendar, and an on/off
// switch with its words.

import { useEffect, useId, useMemo, useState } from 'react';
import Button from '../../components/Button.jsx';
import Dialog from '../../components/Dialog.jsx';
import { buildCalendarDays } from '../schedule/queueCalendar.js';
import { resolveTimezone } from '../schedule/postingQueue.js';
import { formatInZone, timeInZone, zoneLabel } from './scheduleModel.js';
import './schedule.css';
import { activeLocale, uses12Hour } from '../../lib/locale.js';

function allZones() {
  try {
    if (typeof Intl.supportedValuesOf === 'function')
      return Intl.supportedValuesOf('timeZone');
  } catch {
    // Older engines: the zones in use are still offered below.
  }
  return [];
}

/** A time-zone picker: every zone this browser knows, this device's first. */
export function TimezoneSelect({ id, value, onChange, disabled = false }) {
  const device = resolveTimezone(null);
  const zones = useMemo(() => {
    const list = allZones().filter((z) => z !== device);
    if (value && value !== device && !list.includes(value)) list.unshift(value);
    return list;
  }, [device, value]);
  return (
    <select
      id={id}
      className="input sched-tz"
      value={value || device}
      disabled={disabled}
      onChange={(e) => onChange?.(e.target.value)}
    >
      <option value={device}>{zoneLabel(device)} (this device)</option>
      {zones.map((z) => (
        <option key={z} value={z}>
          {zoneLabel(z)}
        </option>
      ))}
    </select>
  );
}

/** A bare switch, for a SettingsRow whose label names it (`id` ties them). */
export function SwitchButton({ id, checked, onChange, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      id={id}
      aria-checked={Boolean(checked)}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
    />
  );
}

/** A switch with its words beside it. */
export function Switch({
  checked,
  onChange,
  label,
  hint = null,
  disabled = false,
}) {
  const id = useId();
  return (
    <div className="sched-switch">
      <button
        type="button"
        role="switch"
        className="switch"
        id={id}
        aria-checked={Boolean(checked)}
        aria-labelledby={`${id}-label`}
        aria-describedby={hint ? `${id}-hint` : undefined}
        disabled={disabled}
        onClick={() => onChange?.(!checked)}
      />
      <span className="sched-switch-text">
        <label htmlFor={id} id={`${id}-label`} className="sched-switch-label">
          {label}
        </label>
        {hint && (
          <span id={`${id}-hint`} className="field-hint">
            {hint}
          </span>
        )}
      </span>
    </div>
  );
}

/** A time of day as the grid's row label: '9 AM', '5:30 PM', or '17:00'. */
function rowLabel(at) {
  const minutes = at.getMinutes();
  if (!uses12Hour())
    return at.toLocaleTimeString(activeLocale(), {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  return at.toLocaleTimeString(activeLocale(), {
    hour: 'numeric',
    ...(minutes ? { minute: '2-digit' } : {}),
    hour12: true,
  });
}

/**
 * The grid's rows: each time of day the week holds, earliest first. Two
 * slots on one day at the same time (a post off the week's times landing
 * on a minute already taken) get a row each, so no two marks share a cell.
 * Returns the rows ({ key, label }) and, per day, each slot's row index.
 */
function calendarRows(days) {
  const keys = new Map();
  const placed = days.map((day) => {
    const seen = new Map();
    return day.slots.map((slot) => {
      const minute = slot.at.getHours() * 60 + slot.at.getMinutes();
      const nth = seen.get(minute) || 0;
      seen.set(minute, nth + 1);
      const key = `${minute}:${nth}`;
      if (!keys.has(key)) keys.set(key, { key, minute, nth, at: slot.at });
      return key;
    });
  });
  const rows = [...keys.values()].sort(
    (a, b) => a.minute - b.minute || a.nth - b.nth,
  );
  const index = new Map(rows.map((r, i) => [r.key, i]));
  return {
    rows: rows.map((r) => ({
      key: r.key,
      label: r.nth === 0 ? rowLabel(r.at) : '',
    })),
    rowOf: placed.map((keysOfDay) => keysOfDay.map((k) => index.get(k))),
  };
}

/**
 * The week ahead as a grid: a column a day (this device's days, today
 * first and in ink), a row a time of day, and a small circle where a day
 * has that time. An open time is a ring; one a queued post takes is filled
 * in the accent, since that is the data here; a post whose time isn't one
 * of the week's any more is a dashed ring of its own. Pressing a filled
 * one calls `onPick(row)`. With `occupancy` false the marks are just
 * posting times (the weekly schedule's preview).
 *
 * The caption says what's open and in which zone. `lead` takes the place
 * of its first sentence and `after` ends it (a link to the weekly
 * schedule, say). With `caption` false there is none.
 */
export function QueueCalendar({
  schedule,
  rows = [],
  now = Date.now(),
  onPick = null,
  occupancy = true,
  highlight = null,
  caption = true,
  lead = null,
  after = null,
}) {
  const model = useMemo(
    () => buildCalendarDays(schedule, occupancy ? rows : [], 7, new Date(now)),
    [schedule, rows, now, occupancy],
  );
  const grid = useMemo(() => calendarRows(model.days), [model]);
  const tz = resolveTimezone(schedule);
  const device = resolveTimezone(null);
  const open = model.days.reduce(
    (n, d) => n + d.slots.filter((s) => !s.row && !s.offSchedule).length,
    0,
  );
  const label = (slot) => {
    const when = formatInZone(slot.at, device, now);
    if (!occupancy) return when;
    if (!slot.row) return `${when}: open`;
    const text = String(
      slot.row.payload?.posts?.[0]?.record?.text || '',
    ).trim();
    return `${when}: ${text ? text.slice(0, 80) : 'a post with media'}${slot.offSchedule ? ' (not one of the week’s times)' : ''}`;
  };
  const count = grid.rows.length;
  return (
    <figure className="sched-cal">
      <div
        className="sched-cal-grid"
        role="list"
        aria-label="The next seven days"
        style={{ gridTemplateRows: `repeat(${count + 1}, auto)` }}
      >
        {/* The times down the side, for the eye: each mark names its own. */}
        {grid.rows.map((r, i) => (
          <span
            key={r.key}
            className="sched-cal-time"
            style={{ gridRow: i + 2 }}
            aria-hidden="true"
          >
            {r.label}
          </span>
        ))}
        {model.days.map((day, d) => (
          <div
            key={day.key}
            className={`sched-cal-day${d === 0 ? ' is-today' : ''}`}
            role="listitem"
            aria-label={day.date.toLocaleDateString(activeLocale(), {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            })}
          >
            <span className="sched-cal-head" aria-hidden="true">
              <span>
                {day.date.toLocaleDateString(activeLocale(), {
                  weekday: 'short',
                })}
              </span>
              <span>{day.date.getDate()}</span>
            </span>
            {day.slots.length === 0 ? (
              <span className="visually-hidden">No posting times</span>
            ) : (
              <ul className="sched-cal-cells">
                {day.slots.map((slot, s) => {
                  const filled = Boolean(slot.row);
                  const cls = `sched-cal-mark${filled ? ' is-filled' : ''}${slot.offSchedule ? ' is-off' : ''}${
                    highlight && slot.row?.id === highlight ? ' is-lit' : ''
                  }`;
                  const place = { gridRow: grid.rowOf[d][s] + 1 };
                  return (
                    <li
                      key={`${slot.minute}-${slot.row?.id || ''}`}
                      className="sched-cal-cell"
                      style={place}
                    >
                      {filled && onPick ? (
                        <button
                          type="button"
                          className="sched-cal-pick"
                          onClick={() => onPick(slot.row)}
                          aria-label={label(slot)}
                          title={label(slot)}
                        >
                          <span className={cls} aria-hidden="true" />
                        </button>
                      ) : (
                        <>
                          <span
                            className={cls}
                            aria-hidden="true"
                            title={occupancy ? label(slot) : undefined}
                          />
                          <span className="visually-hidden">{label(slot)}</span>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ))}
      </div>
      {caption && (
        <figcaption className="card-caption sched-cal-caption">
          {lead ? (
            <>{lead} </>
          ) : occupancy ? (
            `${open === 1 ? '1 open time' : `${open} open times`} in the next seven days${model.laterCount ? ` · ${model.laterCount} queued further out` : ''}. `
          ) : (
            'The posting times of the next seven days. '
          )}
          Shown in this device’s time ({zoneLabel(device)})
          {tz !== device ? `; the week is set in ${zoneLabel(tz)}` : ''}.
          {after && <> {after}</>}
        </figcaption>
      )}
    </figure>
  );
}

/** '9:00 AM' for a row, in the zone the week is read in. */
export function RowTime({ row, tz }) {
  return (
    <time dateTime={row.scheduledFor}>{timeInZone(row.scheduledFor, tz)}</time>
  );
}

/**
 * A question before an action: what it does, a way out ("Keep it"), and the
 * action. `onConfirm` may return a promise; the button shows `busyLabel`
 * until it settles, and a rejection's message stays in the dialog.
 * `tone` 'danger' for what can't be undone.
 */
export function ActionDialog({
  open,
  title,
  children,
  confirmLabel,
  busyLabel,
  cancelLabel = 'Keep it',
  tone = null,
  onConfirm,
  onClose,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) setError('');
  }, [open]);
  const confirm = async () => {
    setBusy(true);
    setError('');
    try {
      await onConfirm?.();
      onClose?.();
    } catch (err) {
      setError(err?.message || 'That didn’t work. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      title={title}
      tone={tone}
      actions={
        <>
          <Button onClick={onClose} disabled={busy} data-autofocus>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            onClick={confirm}
            disabled={busy}
            aria-busy={busy || undefined}
          >
            {busy ? busyLabel || confirmLabel : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="sched-confirm">
        {children}
        {error && (
          <p className="callout callout--danger" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
