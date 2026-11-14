import { useEffect, useId, useRef, useState } from 'react';
import { RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import Button from '../../components/Button.jsx';
import Dialog from '../../components/Dialog.jsx';
import Segmented from '../../components/Segmented.jsx';
import { useAtprotoSession } from '../../session/useAtprotoSession.jsx';
import { usePostingSettings } from '../settings.js';
import { ADVISER_TEXT_LIMITS, STYLE_SAMPLE_SIZES, normalizeAdviserSettings } from '../adviser/setup.js';
import { forgetStyleProfile, styleProfileFrom } from '../adviser/style.js';
import { STYLE_STAGES, createStyleSession, styleProfileLine } from '../adviser/styleSession.js';
import { adviserUsageLine, readAdviserUsage } from '../adviser/usage.js';
import NeedsBackend from './NeedsBackend.jsx';
import './adviser.css';

/**
 * The adviser's reading of how this account writes: its recent posts are
 * gathered once, read for deliberate habits (all lowercase, no full stops,
 * "gonna"), and described in a few sentences the proofread then respects.
 * The writer can edit the description, refine it with a note, read the
 * posts again, keep it, or forget it. Nothing is kept until "Keep this".
 */
export default function StyleDialog({ open = false, onClose, did }) {
  const { backendFor, capabilitiesFor } = useAtprotoSession();
  const { settings, update } = usePostingSettings(did);
  const adviser = normalizeAdviserSettings(settings.adviser);
  const saved = adviser.writingChecks.styleProfile;
  const canUseAi = Boolean(did && capabilitiesFor(did).canUseAi);
  const requester = canUseAi ? backendFor(did) : null;
  const ids = { summary: useId(), note: useId() };

  const sessionRef = useRef(null);
  const [view, setView] = useState(null);
  const [note, setNote] = useState('');
  const [sampleSize, setSampleSize] = useState(adviser.writingChecks.styleSampleSize);
  const [saveError, setSaveError] = useState('');

  // One sitting per opening: the posts gathered are kept only while it's open.
  useEffect(() => {
    if (!open) return undefined;
    const session = createStyleSession({ did, requester, profile: saved, onChange: setView });
    sessionRef.current = session;
    setView(session.getView());
    setNote(saved.guidance || '');
    setSampleSize(adviser.writingChecks.styleSampleSize);
    setSaveError('');
    return () => {
      session.dispose();
      sessionRef.current = null;
    };
    // The saved profile is read when the dialog opens, not followed after.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, did]);

  const v = view || { phase: 'idle', stage: 'gather', postCount: 0, summary: '' };
  const working = v.phase === 'working';
  const hasDescription = v.phase === 'result' && !!v.summary.trim();
  const usage = v.usage || readAdviserUsage(did, { feature: 'style' });
  const usageLine = adviserUsageLine(usage, { feature: 'style' });
  const hasSaved = !!saved.summary.trim();

  const start = (opts = {}) =>
    sessionRef.current?.start({
      sampleSize,
      guidance: note.trim(),
      ...opts,
    });

  const writeProfile = (profile) => {
    try {
      update({
        adviser: {
          ...adviser,
          writingChecks: { ...adviser.writingChecks, styleSampleSize: sampleSize, styleProfile: profile },
        },
      });
      return true;
    } catch (err) {
      setSaveError(err?.message || 'The description couldn’t be saved.');
      return false;
    }
  };

  const keep = () => {
    if (!hasDescription) return;
    const profile = styleProfileFrom({ summary: v.summary.trim(), analyzedCount: v.analyzedCount, updatedAt: v.updatedAt }, note.trim());
    if (writeProfile(profile)) onClose?.();
  };

  const forget = () => {
    if (writeProfile(forgetStyleProfile({ ...saved, guidance: note.trim() }))) onClose?.();
  };

  const footer = (
    <>
      {hasSaved && !working && (
        <Button variant="ghost" className="style-forget" onClick={forget}>
          <Trash2 size={14} aria-hidden="true" />
          Forget my style
        </Button>
      )}
      <Button onClick={onClose}>{hasDescription && v.fresh ? 'Cancel' : 'Close'}</Button>
      {hasDescription && (
        <Button variant="primary" onClick={keep} disabled={working || (!v.fresh && note.trim() === (saved.guidance || '').trim())}>
          Keep this
        </Button>
      )}
    </>
  );

  return (
    <Dialog open={open} onClose={onClose} title="Your writing style" className="style-dialog" actions={footer}>
      {!requester ? (
        <NeedsBackend did={did} />
      ) : (
        <div className="style-body">
          <p className="style-intro">
            The adviser can learn how you write from your recent posts, so the proofread leaves your habits alone: all
            lowercase, no full stops, “gonna”. It sends your recent public posts to Virga’s server, which asks an AI model to
            describe them. Only the description is kept, in this browser.
          </p>

          {(v.phase === 'idle' || v.phase === 'error') && (
            <div className="style-start">
              <Segmented
                label="How many recent posts to read"
                size="sm"
                value={sampleSize}
                onChange={setSampleSize}
                options={STYLE_SAMPLE_SIZES.map((n) => ({ value: n, label: `${n} posts` }))}
              />
              <p className="field-hint">More posts give a steadier reading and take a little longer. Replies count too.</p>
              <div>
                <Button variant="primary" onClick={() => start()}>
                  <Sparkles size={15} aria-hidden="true" />
                  Read my posts
                </Button>
              </div>
            </div>
          )}

          {working && <StyleProgress stage={v.stage} count={v.postCount} />}

          {v.error && (
            <p className={`callout ${v.error.code === 'monthly_limit' ? 'callout--warn' : 'callout--danger'}`} role="alert">
              {v.error.message}
            </p>
          )}

          {(v.phase === 'result' || (working && v.summary)) && (
            <div className="style-result">
              <div className="field">
                <label className="field-label" htmlFor={ids.summary}>
                  How you write
                </label>
                <textarea
                  id={ids.summary}
                  className="input"
                  rows={6}
                  value={v.summary}
                  maxLength={ADVISER_TEXT_LIMITS.styleSummary}
                  readOnly={working}
                  onChange={(e) => sessionRef.current?.edit(e.target.value)}
                />
                <span className="field-hint">
                  {styleProfileLine(v) || 'Written by hand'}
                  {v.fresh ? ' · not kept yet' : ''}
                </span>
              </div>

              <div className="field">
                <label className="field-label" htmlFor={ids.note}>
                  What should change?
                </label>
                <input
                  id={ids.note}
                  className="input"
                  value={note}
                  maxLength={ADVISER_TEXT_LIMITS.styleGuidance}
                  placeholder="For example: I do capitalise names on purpose"
                  disabled={working}
                  onChange={(e) => setNote(e.target.value)}
                />
                <span className="field-hint">Kept with the description, and used each time it’s read again.</span>
              </div>
              <div className="style-actions">
                <Button onClick={() => start({ previousSummary: v.summary })} disabled={working || !note.trim()}>
                  <Sparkles size={14} aria-hidden="true" />
                  Refine with my note
                </Button>
                <Button variant="ghost" onClick={() => start({ again: true, previousSummary: '' })} disabled={working}>
                  <RotateCcw size={14} aria-hidden="true" />
                  Read my posts again
                </Button>
                <label className="style-sample">
                  <span className="visually-hidden">How many posts to read again</span>
                  <select className="input" value={sampleSize} onChange={(e) => setSampleSize(Number(e.target.value))} disabled={working}>
                    {STYLE_SAMPLE_SIZES.map((n) => (
                      <option key={n} value={n}>
                        {n} posts
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          )}

          {saveError && (
            <p className="callout callout--danger" role="alert">
              {saveError}
            </p>
          )}
          {usageLine && <p className="style-usage">{usageLine}</p>}
        </div>
      )}
    </Dialog>
  );
}

function StyleProgress({ stage, count }) {
  const at = STYLE_STAGES.findIndex((s) => s.id === stage);
  return (
    <ol className="style-progress" role="status" aria-live="polite">
      {STYLE_STAGES.map((s, i) => (
        <li key={s.id} data-state={i < at ? 'done' : i === at ? 'now' : 'later'}>
          <span className="style-progress-dot" aria-hidden="true" />
          <span>
            {s.label}
            {s.id === 'gather' && count > 0 ? ` · ${count.toLocaleString('en-US')} posts` : ''}
          </span>
          {i === at && <span className="visually-hidden"> (in progress)</span>}
        </li>
      ))}
    </ol>
  );
}
