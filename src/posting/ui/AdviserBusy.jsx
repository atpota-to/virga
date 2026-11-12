import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import Button from '../../components/Button.jsx';
import { ADVISER_CHOICE_LABELS, ADVISER_CHOICES } from '../adviser/gate.js';
import { SLOW_READ_AFTER_MS, readExpectation } from '../adviser/context.js';
import './adviser.css';

/**
 * While the adviser reads a post: a quiet line in the composer, the goals it
 * is checking, how long it usually takes, and the ways out. The pre-publish
 * check offers Publish anyway and Keep editing; a read from the "Check this
 * post" button only Keep editing (`onPublishAnyway` is null). The controller
 * holds a fast answer back (READ_MIN_MS) so this never flashes.
 */
export default function AdviserBusy({ goals = [], startedAt, onPublishAnyway, onKeepEditing }) {
  const slow = useSlowAfter(startedAt, SLOW_READ_AFTER_MS);
  return (
    <section className="adviser-busy" aria-label="The post adviser is reading" aria-busy="true">
      <div className="adviser-busy-head">
        <span className="adviser-busy-icon" aria-hidden="true">
          <Sparkles size={16} />
        </span>
        <div className="adviser-busy-text" role="status" aria-live="polite">
          <span className="adviser-busy-title">Reading your draft</span>
          <span className="adviser-busy-line">{readExpectation(slow ? SLOW_READ_AFTER_MS : 0)}</span>
        </div>
      </div>
      <span className="progress adviser-busy-bar" aria-hidden="true">
        <span className="progress-fill" data-indeterminate />
      </span>
      {goals.length > 0 && (
        <ul className="adviser-busy-goals" aria-label="What it’s checking">
          {goals.map((goal) => (
            <li key={goal.key}>
              <span className="adviser-busy-goal">{goal.label}</span>
              {goal.detail && <span className="adviser-busy-detail">{goal.detail}</span>}
            </li>
          ))}
        </ul>
      )}
      <div className="adviser-busy-actions">
        {onKeepEditing && (
          <Button size="sm" onClick={onKeepEditing}>
            {ADVISER_CHOICE_LABELS[ADVISER_CHOICES.EDIT]}
          </Button>
        )}
        {onPublishAnyway && (
          <Button size="sm" variant="primary" onClick={onPublishAnyway}>
            {ADVISER_CHOICE_LABELS[ADVISER_CHOICES.PUBLISH]}
          </Button>
        )}
      </div>
    </section>
  );
}

/** True once `ms` have passed since `startedAt` (a Date.now() time). */
function useSlowAfter(startedAt, ms) {
  const [slow, setSlow] = useState(() => Number.isFinite(startedAt) && Date.now() - startedAt >= ms);
  useEffect(() => {
    if (!Number.isFinite(startedAt)) return undefined;
    const left = ms - (Date.now() - startedAt);
    setSlow(left <= 0);
    if (left <= 0) return undefined;
    const timer = setTimeout(() => setSlow(true), left);
    return () => clearTimeout(timer);
  }, [startedAt, ms]);
  return slow;
}
