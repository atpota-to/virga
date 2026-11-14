import { useId, useState } from 'react';
import Segmented from '../../components/Segmented.jsx';
import { SettingsCard, SettingsRow } from './SettingsParts.jsx';
import GatesEditor from './GatesEditor.jsx';
import LanguagePicker from '../composer/LanguagePicker.jsx';
import { usePostingSettings } from '../settings.js';
import { PUBLISH_ACTION_OPTIONS, normalizePublishAction } from '../schedule/publishActions.js';
import { EVERYONE_GATES } from '../lib/gates.js';
import '../composer/composer.css';

/**
 * Settings › Posting: what a new post starts with, for one account: its
 * languages, who can reply and quote, what the main button does, and two
 * habits (requiring alt text, offering to split a long post). Kept in this
 * browser, per account.
 */
export default function ComposerDefaults({ did }) {
  const { settings, update } = usePostingSettings(did);
  const [error, setError] = useState(null);
  const ids = { action: useId(), alt: useId(), thread: useId() };
  const save = (patch) => {
    try {
      update(patch);
      setError(null);
    } catch (err) {
      setError(err?.message || 'That setting couldn’t be saved.');
    }
  };
  const ownGates = settings.gates != null;

  return (
    <SettingsCard title="New posts" sub="What the composer starts with for this account. Each post can still change it.">
      <div className="settings-row settings-row--stack">
        <LanguagePicker
          label="Languages"
          hint="Bluesky uses these to show your posts to people who read them. Up to three."
          value={settings.langs}
          onChange={(langs) => save({ langs })}
        />
      </div>

      <div className="settings-row settings-row--stack">
        <div className="settings-row-text">
          <div className="settings-row-label">Who can reply and quote</div>
          <div className="settings-row-hint">
            {ownGates
              ? 'New posts from Virga use what you choose here.'
              : 'New posts use the setting you chose in Bluesky. If it can’t be read, anyone can reply and quote.'}
          </div>
        </div>
        <Segmented
          label="Where the reply settings come from"
          size="sm"
          value={ownGates ? 'here' : 'bluesky'}
          onChange={(v) => save({ gates: v === 'here' ? settings.gates || { ...EVERYONE_GATES } : null })}
          options={[
            { value: 'bluesky', label: 'My Bluesky setting' },
            { value: 'here', label: 'Choose here' },
          ]}
        />
        {ownGates && <GatesEditor did={did} value={settings.gates} onChange={(gates) => save({ gates })} />}
      </div>

      <SettingsRow label="Main button" hint="What the composer’s main button does. The others stay in its menu." htmlFor={ids.action}>
        <select
          id={ids.action}
          className="input"
          value={normalizePublishAction(settings.defaultAction)}
          onChange={(e) => save({ defaultAction: e.target.value })}
        >
          {PUBLISH_ACTION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </SettingsRow>

      <SettingsRow label="Require alt text" hint="Don’t post an image until it has a description." htmlFor={ids.alt}>
        <button
          id={ids.alt}
          type="button"
          role="switch"
          className="switch"
          aria-checked={!!settings.requireAltText}
          onClick={() => save({ requireAltText: !settings.requireAltText })}
        />
      </SettingsRow>

      <SettingsRow label="Offer to split long posts" hint="When a post runs past 300 characters, offer to make it a thread." htmlFor={ids.thread}>
        <button
          id={ids.thread}
          type="button"
          role="switch"
          className="switch"
          aria-checked={settings.showThreadSuggestion !== false}
          onClick={() => save({ showThreadSuggestion: settings.showThreadSuggestion === false })}
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
