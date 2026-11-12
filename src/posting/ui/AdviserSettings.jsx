import { useId, useState } from 'react';
import { BookOpenText } from 'lucide-react';
import Button from '../../components/Button.jsx';
import Segmented from '../../components/Segmented.jsx';
import { COCOON_URL } from '../../config.js';
import { useAtprotoSession } from '../../session/useAtprotoSession.jsx';
import { usePostingSettings } from '../settings.js';
import { ADVISER_TEXT_LIMITS, nextPostingAdviserState, normalizeAdviserSettings } from '../adviser/setup.js';
import { styleProfileLine } from '../adviser/styleSession.js';
import { adviserUsageLine, readAdviserUsage } from '../adviser/usage.js';
import { SettingsCard, SettingsRow } from './SettingsParts.jsx';
import NeedsBackend from './NeedsBackend.jsx';
import StyleDialog from './StyleDialog.jsx';
import './adviser.css';

const SERVER_HOST = (() => {
  try {
    return new URL(COCOON_URL).host;
  } catch {
    return COCOON_URL;
  }
})();

const REVIEW_OPTIONS = [
  { value: 'significant', label: 'When something’s off' },
  { value: 'always', label: 'Every time' },
];

const SCOPE_OPTIONS = [
  { value: 'all', label: 'All posts' },
  { value: 'topLevel', label: 'New posts and my own threads' },
  { value: 'replies', label: 'Only replies to other people' },
];

const GOAL_PRESETS = [
  { key: 'reduceNegativity', label: 'Reduce negativity', hint: 'Flag a hostile, cruel or doom-heavy tone.' },
  { key: 'lessConfrontational', label: 'Less confrontational', hint: 'Flag dunking, sarcastic replies or pointed criticism.' },
];

const WRITING_CHECKS = [
  { key: 'typos', label: 'Typos', hint: 'A wrong or misspelled word, like “out” where you meant “our”.' },
  { key: 'grammar', label: 'Grammar', hint: 'Grammar that would trip a reader up. A casual style is yours to keep.' },
  { key: 'clarity', label: 'Clarity', hint: 'A sentence likely to confuse people or land differently than you meant.' },
];

/**
 * Settings › Posting: the post adviser for one account. Off until it's
 * turned on; the first time, it comes on with a recommended setup (every
 * check, both general goals) that the rest of the card can change. Only for
 * an account signed in through Virga's server (D16). Says what is sent, and
 * to whom.
 */
// eslint-disable-next-line no-unused-vars
export default function AdviserSettings({ open, onClose, did }) {
  const { capabilitiesFor } = useAtprotoSession();
  const { settings, update } = usePostingSettings(did);
  const [error, setError] = useState('');
  const [styleOpen, setStyleOpen] = useState(false);
  const ids = {
    enabled: useId(),
    gate: useId(),
    room: useId(),
    topic: useId(),
    goals: useId(),
    notes: useId(),
  };
  const canUseAi = Boolean(did && capabilitiesFor(did).canUseAi);
  const adviser = normalizeAdviserSettings(settings.adviser);

  if (!canUseAi) {
    return (
      <SettingsCard title="Post adviser" sub="Reads a post against goals you set, and proofreads it, before it goes out.">
        <NeedsBackend did={did} />
      </SettingsCard>
    );
  }

  const save = (next) => {
    try {
      update({ adviser: next });
      setError('');
    } catch (err) {
      setError(err?.message || 'That setting couldn’t be saved.');
    }
  };
  const patch = (fields) => save({ ...adviser, ...fields });
  const patchGoals = (fields) => patch({ goals: { ...adviser.goals, ...fields } });
  const patchPresets = (fields) => patchGoals({ presets: { ...adviser.goals.presets, ...fields } });
  const patchWriting = (fields) => patch({ writingChecks: { ...adviser.writingChecks, ...fields } });
  const topic = adviser.goals.presets.limitTopic;
  const profile = adviser.writingChecks.styleProfile;
  const usageLines = [
    adviserUsageLine(readAdviserUsage(did, { feature: 'adviser' }), { feature: 'adviser' }),
    adviserUsageLine(readAdviserUsage(did, { feature: 'style' }), { feature: 'style' }),
    adviserUsageLine(readAdviserUsage(did, { feature: 'altText' }), { feature: 'altText' }),
  ].filter(Boolean);

  return (
    <SettingsCard
      title="Post adviser"
      sub="Reads a post against goals you set for yourself, and proofreads it, before it goes out. It never stops a post: you can always publish anyway."
    >
      <SettingsRow
        label="Use the post adviser"
        htmlFor={ids.enabled}
        hint={
          adviser.enabled
            ? 'The composer has a “Check this post” button, and checks posts as set below.'
            : 'Off. The first time it’s turned on, every check below comes on with it; change any of them after.'
        }
      >
        <button
          id={ids.enabled}
          type="button"
          role="switch"
          className="switch"
          aria-checked={adviser.enabled}
          onClick={() => save(nextPostingAdviserState(adviser))}
        />
      </SettingsRow>

      {adviser.enabled && (
        <>
          <SettingsRow
            label="Check before posting"
            htmlFor={ids.gate}
            hint="Reads each post when you press Post (not when you schedule one). If it takes more than 10 seconds or can’t be reached, the post goes out as it is."
          >
            <button
              id={ids.gate}
              type="button"
              role="switch"
              className="switch"
              aria-checked={adviser.checkBeforePublish}
              onClick={() => patch({ checkBeforePublish: !adviser.checkBeforePublish })}
            />
          </SettingsRow>

          {adviser.checkBeforePublish && (
            <div className="adviser-set-group">
              <div className="adviser-set-row">
                <div className="settings-row-text">
                  <div className="settings-row-label">Stop me</div>
                  <div className="settings-row-hint">
                    “When something’s off” stops for a post that goes against a goal, or a slip in the writing.
                  </div>
                </div>
                <Segmented label="When the check stops a post" size="sm" value={adviser.reviewMode} onChange={(v) => patch({ reviewMode: v })} options={REVIEW_OPTIONS} />
              </div>
              <div className="adviser-set-row">
                <div className="settings-row-text">
                  <div className="settings-row-label">Which posts</div>
                  <div className="settings-row-hint">A reply to your own post counts as one of your threads. The button checks any post.</div>
                </div>
                <Segmented label="Which posts are checked" size="sm" className="adviser-scope" value={adviser.checkScope} onChange={(v) => patch({ checkScope: v })} options={SCOPE_OPTIONS} />
              </div>
            </div>
          )}

          <SettingsRow
            label="Read replies with their conversation"
            htmlFor={ids.room}
            hint="For a reply or a quote, the posts it answers are read too, so the adviser can say if you may have misread someone. Those are other people’s public posts."
          >
            <button
              id={ids.room}
              type="button"
              role="switch"
              className="switch"
              aria-checked={adviser.checkReplyContext}
              onClick={() => patch({ checkReplyContext: !adviser.checkReplyContext })}
            />
          </SettingsRow>

          <fieldset className="adviser-set-fieldset">
            <legend className="settings-row-label">Your goals</legend>
            {GOAL_PRESETS.map((g) => (
              <label key={g.key} className="adviser-check">
                <input type="checkbox" checked={adviser.goals.presets[g.key]} onChange={(e) => patchPresets({ [g.key]: e.target.checked })} />
                <span>
                  <span className="adviser-check-label">{g.label}</span>
                  <span className="adviser-check-hint">{g.hint}</span>
                </span>
              </label>
            ))}
            <label className="adviser-check">
              <input
                type="checkbox"
                checked={topic.enabled}
                onChange={(e) => patchPresets({ limitTopic: { ...topic, enabled: e.target.checked } })}
              />
              <span>
                <span className="adviser-check-label">Post less about some topics</span>
                <span className="adviser-check-hint">Flag a post that leans on them. Separate topics with commas.</span>
              </span>
            </label>
            {topic.enabled && (
              <div className="field adviser-indent">
                <label className="visually-hidden" htmlFor={ids.topic}>
                  Topics to post less about
                </label>
                <input
                  id={ids.topic}
                  className="input"
                  value={topic.topic}
                  maxLength={ADVISER_TEXT_LIMITS.topic}
                  placeholder="For example: politics, the news"
                  onChange={(e) => patchPresets({ limitTopic: { ...topic, topic: e.target.value } })}
                />
              </div>
            )}
            <div className="field">
              <label className="adviser-check-label" htmlFor={ids.goals}>
                Goals in your own words
              </label>
              <textarea
                id={ids.goals}
                className="input"
                rows={2}
                value={adviser.goals.customText}
                maxLength={ADVISER_TEXT_LIMITS.goalsText}
                placeholder="For example: keep it warm and curious; double-check anything I state as fact"
                onChange={(e) => patchGoals({ customText: e.target.value })}
              />
              <span className="field-hint">
                {adviser.goals.customText.length} of {ADVISER_TEXT_LIMITS.goalsText}
              </span>
            </div>
          </fieldset>

          <fieldset className="adviser-set-fieldset">
            <legend className="settings-row-label">Proofread</legend>
            {WRITING_CHECKS.map((c) => (
              <label key={c.key} className="adviser-check">
                <input type="checkbox" checked={adviser.writingChecks[c.key]} onChange={(e) => patchWriting({ [c.key]: e.target.checked })} />
                <span>
                  <span className="adviser-check-label">{c.label}</span>
                  <span className="adviser-check-hint">{c.hint}</span>
                </span>
              </label>
            ))}
            <div className="field">
              <label className="adviser-check-label" htmlFor={ids.notes}>
                Notes for the proofread
              </label>
              <textarea
                id={ids.notes}
                className="input"
                rows={2}
                value={adviser.writingChecks.customText}
                maxLength={ADVISER_TEXT_LIMITS.writingNotes}
                placeholder="For example: I skip apostrophes on purpose; never flag “gonna”"
                onChange={(e) => patchWriting({ customText: e.target.value })}
              />
              <span className="field-hint">These come before everything else the proofread goes by.</span>
            </div>
            <div className="adviser-style">
              <div className="settings-row-text">
                <div className="adviser-check-label">Your writing style</div>
                <div className="adviser-check-hint">
                  {profile.summary.trim()
                    ? `${styleProfileLine(profile) || 'Written by hand'}. The proofread treats these habits as yours.`
                    : 'Not learned yet. It can be read from your recent posts, so your habits aren’t flagged as slips.'}
                </div>
              </div>
              <Button size="sm" onClick={() => setStyleOpen(true)}>
                <BookOpenText size={14} aria-hidden="true" />
                {profile.summary.trim() ? 'See or change it' : 'Learn my style'}
              </Button>
            </div>
          </fieldset>
        </>
      )}

      {usageLines.length > 0 && (
        <div className="adviser-set-usage">
          {usageLines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}

      <details className="disclosure adviser-sent">
        <summary>What’s sent, and to whom</summary>
        <div className="adviser-sent-body">
          <p>
            Only when the adviser reads a post, or you ask for a description or a style reading, this goes to Virga’s server (
            {SERVER_HOST}), signed in as this account:
          </p>
          <ul>
            <li>the post’s text, your goals, your notes for the proofread and your style description;</li>
            <li>
              with “Read replies with their conversation” on, the posts a reply or quote answers: other people’s public posts
              and their names;
            </li>
            <li>to learn your style, your recent public posts; to describe an image, the image and the post’s text.</li>
          </ul>
          <p>
            Virga’s server passes it, with this account’s DID for counting use, to an AI model through an AI gateway, and sends
            the answer back. It doesn’t store what was sent; whether the model’s provider keeps it is set by the gateway’s
            account settings, not per request. Virga’s server keeps only how many of this month’s free uses this account has
            had, a count it shares with Anisota. Your goals, notes and style description stay in this browser.
          </p>
        </div>
      </details>

      {error && (
        <p className="callout callout--danger" role="alert">
          {error}
        </p>
      )}
      <StyleDialog open={styleOpen} onClose={() => setStyleOpen(false)} did={did} />
    </SettingsCard>
  );
}
