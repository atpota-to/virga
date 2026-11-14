// Pieces the Scheduled and Weekly schedule pages (and Settings › Posting)
// share: the time-zone picker, the week ahead as a calendar, and an on/off
// switch with its words.

import { useEffect, useId, useMemo, useState } from 'react';
import Button from '../../components/Button.jsx';
import Dialog from '../../components/Dialog.jsx';
import { buildCalendarDays, compactTime } from '../schedule/queueCalendar.js';
import { resolveTimezone } from '../schedule/postingQueue.js';
import { formatInZone, timeInZone, zoneLabel } from './scheduleModel.js';
import './schedule.css';

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

/**
 * The week ahead as a calendar: a column a day (this device's days), a cell
 * per posting time, filled with the queued post that has it. A post whose
 * time isn't one of the week's any more gets its own dashed cell. Pressing a
 * filled cell calls `onPick(row)`. With `occupancy` false the cells are just
 * posting times (the weekly schedule's preview).
 */
export function QueueCalendar({
  schedule,
  rows = [],
  now = Date.now(),
  onPick = null,
  occupancy = true,
  highlight = null,
  caption = true,
}) {
  const model = useMemo(
    () => buildCalendarDays(schedule, occupancy ? rows : [], 7, new Date(now)),
    [schedule, rows, now, occupancy],
  );
  const tz = resolveTimezone(schedule);
  const device = resolveTimezone(null);
  const open = model.days.reduce(
    (n, d) => n + d.slots.filter((s) => !s.row && !s.offSchedule).length,
    0,
  );
  const label = (slot) => {
    const when = formatInZone(slot.at, device, now);
    if (!slot.row) return `${when}: open`;
    const text = String(
      slot.row.payload?.posts?.[0]?.record?.text || '',
    ).trim();
    return `${when}: ${text ? text.slice(0, 80) : 'a post with media'}${slot.offSchedule ? ' (not one of the week’s times)' : ''}`;
  };
  return (
    <figure className="sched-cal">
      <div
        className="sched-cal-grid"
        role="list"
        aria-label="The next seven days"
      >
        {model.days.map((day, i) => (
          <div
            key={day.key}
            className="sched-cal-day"
            role="listitem"
            aria-label={day.date.toLocaleDateString(undefined, {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            })}
          >
            <div className="sched-cal-head" aria-hidden="true">
              <span className="sched-cal-dow">
                {i === 0
                  ? 'Today'
                  : day.date.toLocaleDateString(undefined, {
                      weekday: 'short',
                    })}
              </span>
              <span className="sched-cal-date">{day.date.getDate()}</span>
            </div>
            <ul className="sched-cal-cells">
              {day.slots.length === 0 && (
                <li className="sched-cal-none" aria-label="No posting times">
                  –
                </li>
              )}
              {day.slots.map((slot) => {
                const filled = Boolean(slot.row);
                const cls = `sched-cal-cell${filled ? ' is-filled' : ''}${slot.offSchedule ? ' is-off' : ''}${
                  highlight && slot.row?.id === highlight ? ' is-lit' : ''
                }`;
                return (
                  <li key={`${slot.minute}-${slot.row?.id || ''}`}>
                    {filled && onPick ? (
                      <button
                        type="button"
                        className={cls}
                        onClick={() => onPick(slot.row)}
                        aria-label={label(slot)}
                        title={label(slot)}
                      >
                        {compactTime(slot.at)}
                      </button>
                    ) : (
                      <span
                        className={cls}
                        aria-label={
                          occupancy
                            ? label(slot)
                            : formatInZone(slot.at, device, now)
                        }
                        title={occupancy ? label(slot) : undefined}
                      >
                        {compactTime(slot.at)}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      {caption && (
        <figcaption className="card-caption sched-cal-caption">
          {occupancy
            ? `${open === 1 ? '1 open time' : `${open} open times`} in the next seven days${model.laterCount ? ` · ${model.laterCount} queued further out` : ''}.`
            : 'The posting times of the next seven days.'}{' '}
          Shown in this device’s time ({zoneLabel(device)})
          {tz !== device ? `; the week is set in ${zoneLabel(tz)}` : ''}.
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
