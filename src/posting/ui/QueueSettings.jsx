import { useId, useState } from 'react';
import { CalendarRange } from 'lucide-react';
import { Link } from '../../lib/router.jsx';
import { usePostingSettings } from '../settings.js';
import { resolveTimezone } from '../schedule/postingQueue.js';
import {
  moveToZone,
  weekSummary,
  weeklyCount,
  zoneLabel,
} from '../pages/scheduleModel.js';
import { SwitchButton, TimezoneSelect } from '../pages/scheduleParts.jsx';
import { postingPath } from '../routes.js';
import { SettingsCard, SettingsRow } from './SettingsParts.jsx';
import '../pages/schedule.css';

/**
 * Settings › Posting: the weekly queue for one account. The week in a line
 * (edited on Posting › Weekly schedule), the time zone its times are read in,
 * and whether to suggest times from the account's best times. Kept in this
 * browser.
 */
export default function QueueSettings({ did }) {
  const { settings, update } = usePostingSettings(did);
  const [error, setError] = useState('');
  const tzId = useId();
  const suggestId = useId();
  const schedule = settings.queue;
  const tz = resolveTimezone(schedule);
  const device = resolveTimezone(null);
  const save = (patch) => {
    try {
      update(patch);
      setError('');
    } catch (err) {
      setError(err?.message || 'That setting couldn’t be saved.');
    }
  };
  const count = weeklyCount(schedule);

  return (
    <SettingsCard
      title="Weekly queue"
      sub="The times each week that a post added to the queue goes out. Kept in this browser, for this account."
    >
      <SettingsRow
        label={
          count === 1
            ? '1 posting time a week'
            : `${count} posting times a week`
        }
        hint={weekSummary(schedule)}
      >
        <Link to={postingPath('schedule')} className="btn btn--sm">
          <CalendarRange size={14} aria-hidden="true" />
          Edit the week
        </Link>
      </SettingsRow>
      <SettingsRow
        label="Time zone"
        htmlFor={tzId}
        hint={
          tz === device
            ? 'The queue’s times are read on this clock.'
            : `The queue’s times are read on this clock. This device is in ${zoneLabel(device)}.`
        }
      >
        <TimezoneSelect
          id={tzId}
          value={tz}
          onChange={(z) => save({ queue: moveToZone(schedule, z) })}
        />
      </SettingsRow>
      <SettingsRow
        label="Suggest posting times"
        htmlFor={suggestId}
        hint="From when this account’s own posts have done best, once the archive holds enough of them. Never added without asking."
      >
        <SwitchButton
          id={suggestId}
          checked={settings.suggestBestTimes}
          onChange={(v) => save({ suggestBestTimes: v })}
        />
      </SettingsRow>
      {error && (
        <p className="callout callout--danger" role="alert">
          {error}
        </p>
      )}
    </SettingsCard>
  );
}
