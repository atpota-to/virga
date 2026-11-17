import { useEffect, useId, useState } from 'react';
import { Link } from '../../lib/router.jsx';
import { useAtprotoSession } from '../../session/useAtprotoSession.jsx';
import { usePostingSettings } from '../settings.js';
import { getLimits } from '../schedule/scheduleService.js';
import { describeTimer, normalizeTimer } from '../timers/selfDestruct.js';
import { timerLimitsLine } from '../pages/scheduleModel.js';
import { SwitchButton } from '../pages/scheduleParts.jsx';
import { postingPath } from '../routes.js';
import LifespanEditor from './LifespanEditor.jsx';
import { SettingsCard, SettingsRow } from './SettingsParts.jsx';
import '../pages/schedule.css';

/**
 * Settings › Posting: the timer new posts start with, for one account.
 * Whether there is one, and its rule (a length, never a set time). The
 * composer puts it on only when the account has a free timer of its kind,
 * and says so when it can't. Kept in this browser.
 */
export default function LifespanDefaults({ did }) {
  const { backendFor, capabilitiesFor } = useAtprotoSession();
  const { settings, update } = usePostingSettings(did);
  const [error, setError] = useState('');
  const [limits, setLimits] = useState(null);
  const onId = useId();
  const req = did && capabilitiesFor(did).canSchedule ? backendFor(did) : null;

  useEffect(() => {
    if (!req) return undefined;
    let live = true;
    getLimits(req).then(
      (l) => live && setLimits(l),
      () => live && setLimits(null),
    );
    return () => {
      live = false;
    };
  }, [req]);

  const lifespan = normalizeTimer(settings.lifespan);
  const save = (next) => {
    try {
      update({ lifespan: { ...normalizeTimer(next), deleteAt: null } });
      setError('');
    } catch (err) {
      setError(err?.message || 'That setting couldn’t be saved.');
    }
  };
  const usage = timerLimitsLine(limits);
  const rule = describeTimer({ ...lifespan, enabled: true });
  const editor = (
    <div className="settings-rule-editor">
      <LifespanEditor
        value={{ ...lifespan, enabled: true }}
        onChange={(next) => save({ ...next, enabled: lifespan.enabled })}
        fit={{}}
        limits={limits}
        did={did}
        allowExactTime={false}
        showToggle={false}
      />
    </div>
  );

  return (
    <SettingsCard
      title="Default timer"
      sub="A timer every new post starts with. Each post can change it or take it off."
    >
      <SettingsRow
        label="Start new posts with a timer"
        htmlFor={onId}
        hint={
          lifespan.enabled
            ? `New posts start with: ${rule}`
            : 'New posts start without one. The rule is kept for when you turn this on.'
        }
      >
        <SwitchButton
          id={onId}
          checked={lifespan.enabled}
          onChange={(on) => save({ ...lifespan, enabled: on })}
        />
      </SettingsRow>
      {/* Off, the rule waits behind its sentence, closed, so the page
          doesn't show an editor for something that isn't in use; it's still
          there to change before turning the timer on. */}
      {lifespan.enabled ? (
        <SettingsRow block>{editor}</SettingsRow>
      ) : (
        <details className="disclosure settings-rule">
          <summary>The rule it will use: {sentenceClause(rule)}</summary>
          {editor}
        </details>
      )}
      {/* A wrapper, so the hairline under this runs the section's width
          while the words keep to a readable measure. */}
      <div className="sched-settings-note">
        <p className="card-caption">
          {usage ? `${usage} ` : ''}When the account has no free timer of the
          kind this rule needs, a new post starts without it, and the composer
          says why. <Link to={postingPath('timers')}>See posts on a timer</Link>.
        </p>
      </div>
      {error && (
        <p className="callout callout--danger" role="alert">
          {error}
        </p>
      )}
    </SettingsCard>
  );
}

/** "Deletes itself 24 hours after it goes up." as the end of a sentence. */
function sentenceClause(text) {
  return text.charAt(0).toLowerCase() + text.slice(1).replace(/\.$/, '');
}
