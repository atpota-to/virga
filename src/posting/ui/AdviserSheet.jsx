import { Fragment, useMemo, useRef } from 'react';
import { Check, CircleAlert, CircleCheck, Info, PenLine, Sparkles, TriangleAlert } from 'lucide-react';
import Button from '../../components/Button.jsx';
import Dialog from '../../components/Dialog.jsx';
import { adviserDraftLabel, adviserSheetModel, adviserWritingTally } from '../adviser/sheet.js';
import {
  STATUS_WORDS,
  VERDICT_COPY,
  WRITING_TYPE_LABELS,
  fixAllLabel,
  postIndexLabel,
  sheetActions,
  sheetContextLine,
  sheetTitle,
} from '../adviser/sheetView.js';
import './adviser.css';

const VERDICT_ICONS = { ok: CircleCheck, caution: TriangleAlert, conflict: CircleAlert };

// A passage several findings share takes the most severe of their tones.
const TONE_ORDER = ['conflict', 'caution', 'note'];

/**
 * What the adviser made of a post (adviser/gateController.js hands it over as
 * `read`): the overall verdict, each goal's verdict, the post marked up (a
 * slip struck through with its fix beside it, tap to take it; a passage a
 * goal flags underlined and numbered to its note), the fixes to take one at a
 * time or all at once, and the way past it. Facts only, no rewrites; it never
 * stops a post on its own.
 *
 * `onApplyFix` takes one fix or a list (`{ key, issue }` from
 * adviserSheetModel). `onPublishAnyway` and `onSaveDraft` are left out where
 * the sheet doesn't offer them. `busy` shows a skeleton shaped like the read.
 * On a phone it is a full-height sheet with the buttons under the thumb.
 */
export default function AdviserSheet({
  open,
  onClose,
  read,
  state, // eslint-disable-line no-unused-vars
  onApplyFix,
  onPublishAnyway,
  onKeepEditing,
  onSaveDraft,
  busy = false,
}) {
  const actions = sheetActions(read, { canPublish: !!onPublishAnyway, canSaveDraft: !!onSaveDraft });
  const keepEditing = onKeepEditing || onClose;
  const footer = busy ? (
    <Button onClick={keepEditing}>Keep editing</Button>
  ) : actions.closeOnly ? (
    <Button variant="primary" onClick={keepEditing} data-autofocus>
      Close
    </Button>
  ) : (
    <>
      <Button
        variant={actions.primary === 'edit' ? 'primary' : 'quiet'}
        onClick={keepEditing}
        data-autofocus={actions.primary === 'edit' ? true : undefined}
      >
        Keep editing
      </Button>
      {actions.draft && <Button onClick={onSaveDraft}>Save as draft</Button>}
      {actions.publish && (
        <Button
          variant={actions.primary === 'publish' ? 'primary' : 'quiet'}
          onClick={onPublishAnyway}
          data-autofocus={actions.primary === 'publish' ? true : undefined}
        >
          {actions.publish.label}
        </Button>
      )}
    </>
  );

  return (
    <Dialog open={open} onClose={onClose} title={sheetTitle(read)} className="adviser-sheet" actions={footer}>
      <div className="adviser-body" aria-busy={busy || undefined}>
        {busy ? (
          <AdviserSkeleton count={read?.goalItems?.length || 2} />
        ) : !read ? null : read.status === 'ready' ? (
          <AdviserRead read={read} onApplyFix={onApplyFix} />
        ) : (
          <AdviserNotice read={read} />
        )}
      </div>
    </Dialog>
  );
}

/** Everything that isn't a read: an empty post, nothing set up, none left, a failure. */
function AdviserNotice({ read }) {
  if (read.status === 'error') {
    return (
      <div className="callout callout--danger adviser-notice" role="alert">
        <CircleAlert aria-hidden="true" />
        <div>
          <p>{read.error || 'The adviser couldn’t read this post.'}</p>
          <p>Nothing was changed. You can try again, or post it as it is.</p>
        </div>
      </div>
    );
  }
  if (read.status === 'limit') {
    return (
      <div className="adviser-empty">
        <Sparkles size={20} aria-hidden="true" />
        <p className="adviser-empty-title">This month’s free checks are used up</p>
        <p>
          {read.usageLine || 'They start again on the first of next month.'} Checks are counted for each account.
        </p>
      </div>
    );
  }
  if (read.status === 'empty') {
    return (
      <div className="adviser-empty">
        <Sparkles size={20} aria-hidden="true" />
        <p className="adviser-empty-title">Nothing to check against yet</p>
        <p>
          The adviser reads a post against goals you set, like a gentler tone or posting less about a topic, and can
          proofread it for typos. Choose what it checks in Settings › Posting, under Post adviser.
        </p>
      </div>
    );
  }
  return (
    <div className="adviser-empty">
      <PenLine size={20} aria-hidden="true" />
      <p className="adviser-empty-title">Write something first</p>
      <p>Then ask the adviser what it thinks.</p>
    </div>
  );
}

function AdviserRead({ read, onApplyFix }) {
  const model = useMemo(() => adviserSheetModel(read.result, read.posts || []), [read.result, read.posts]);
  const fixesByKey = useMemo(() => Object.fromEntries(model.fixes.map((fix) => [fix.key, fix])), [model]);
  const taken = useMemo(() => new Set(read.taken || []), [read.taken]);
  const draftRef = useRef(null);

  const remaining = model.fixes.filter((fix) => !taken.has(fix.key));
  const take = (fixes) => {
    if (!onApplyFix || !fixes.length) return;
    onApplyFix(fixes.length === 1 ? fixes[0] : fixes);
  };

  // A numbered note brings its passage into view and lights it briefly.
  const showMark = (key) => {
    const mark = draftRef.current?.querySelector(`[data-keys~="${key}"]`);
    if (!mark) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    mark.scrollIntoView?.({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    mark.classList.remove('is-shown');
    mark.getBoundingClientRect();
    mark.classList.add('is-shown');
    setTimeout(() => mark.classList.remove('is-shown'), 1600);
  };

  const tally = adviserWritingTally(model, taken);
  const verdict = model.verdict;
  const VerdictIcon = verdict ? VERDICT_ICONS[verdict] : null;
  const total = model.posts.length;
  const visible = model.posts.map((post, index) => ({ ...post, index })).filter((post) => post.text.trim());
  const contextLine = sheetContextLine(read);

  return (
    <div className="adviser-read">
      {verdict && (
        <p className="adviser-verdict" data-tone={verdict}>
          <VerdictIcon size={18} aria-hidden="true" />
          {VERDICT_COPY[verdict]}
        </p>
      )}

      <section className="adviser-draft" aria-label="Your post, marked up">
        <div className="adviser-draft-meta">
          <span>{capitalise(adviserDraftLabel(read.scenario, !!read.context?.thread?.length))}</span>
          {model.tone && <span>Tone: {model.tone}</span>}
        </div>
        <div ref={draftRef} className="adviser-draft-text">
          {visible.map((post) => (
            <p key={post.index} className="adviser-draft-post">
              {postIndexLabel(post.index, total) && (
                <span className="adviser-draft-index">
                  <span className="visually-hidden">Post </span>
                  {postIndexLabel(post.index, total)}
                </span>
              )}
              <DraftSegments
                segments={post.segments}
                marks={model.marks}
                fixesByKey={fixesByKey}
                taken={taken}
                onTake={onApplyFix ? (fix) => take([fix]) : null}
              />
            </p>
          ))}
        </div>
        {tally && (
          <div className="adviser-draft-tally">
            <span aria-live="polite">{tally}</span>
            {remaining.length > 0 && onApplyFix && (
              <Button size="sm" onClick={() => take(remaining)}>
                <Check size={14} aria-hidden="true" />
                {fixAllLabel(remaining.length)}
              </Button>
            )}
          </div>
        )}
      </section>

      {model.notes.length > 0 && (
        <ol className="adviser-notes" aria-label="What it noticed">
          {model.notes.map((note) => {
            const row = (
              <>
                <NoteMarker note={note} />
                <span className="adviser-note-words">
                  {note.kind === 'goal' ? (
                    <>
                      <span className="adviser-note-label">{note.label}</span>
                      <span className="adviser-note-status">{STATUS_WORDS[note.tone]}</span>
                    </>
                  ) : (
                    <>
                      <span className="adviser-note-label">{WRITING_TYPE_LABELS[note.type] || 'Writing'}</span>
                      {note.detail && <span className="adviser-note-detail">{note.detail}</span>}
                    </>
                  )}
                </span>
              </>
            );
            return (
              <li key={note.key} className="adviser-note" data-tone={note.tone}>
                {note.number ? (
                  <button type="button" className="adviser-note-row" onClick={() => showMark(note.key)} aria-label={`${noteText(note)}. Show it in the post`}>
                    {row}
                  </button>
                ) : (
                  <div className="adviser-note-row">{row}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {model.met.length > 0 && (
        <div className="adviser-met">
          <span className="adviser-met-title">Fine against</span>
          <ul aria-label="Goals it’s fine against">
            {model.met.map((label, i) => (
              <li key={i}>
                <Check size={13} aria-hidden="true" />
                {label}
              </li>
            ))}
          </ul>
        </div>
      )}

      {contextLine && (
        <p className="adviser-context">
          <Info size={14} aria-hidden="true" />
          {contextLine}
        </p>
      )}
      {read.usageLine && <p className="adviser-usage">{read.usageLine}</p>}
    </div>
  );
}

const capitalise = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

function noteText(note) {
  return note.kind === 'goal'
    ? `${note.label}: ${STATUS_WORDS[note.tone] || ''}`
    : `${WRITING_TYPE_LABELS[note.type] || 'Writing'}${note.detail ? `: ${note.detail}` : ''}`;
}

function NoteMarker({ note }) {
  if (note.number) {
    return (
      <span className="adviser-note-marker" aria-hidden="true">
        {note.number}
      </span>
    );
  }
  const Icon = note.tone === 'conflict' ? CircleAlert : note.tone === 'caution' ? TriangleAlert : Info;
  return (
    <span className="adviser-note-marker adviser-note-marker--icon" aria-hidden="true">
      <Icon size={13} />
    </span>
  );
}

function FixMark({ issue, taken, onTake }) {
  if (taken) {
    return (
      <span className="adviser-fixed">
        <span className="visually-hidden">Fixed: </span>
        {issue.replacement}
      </span>
    );
  }
  const content = (
    <>
      <del>{issue.found}</del> <ins>{issue.replacement}</ins>
    </>
  );
  if (!onTake) return <span className="adviser-fix">{content}</span>;
  // A span with a button's role, not a <button>, which can't break across
  // lines: a long fix would jump to a line of its own.
  return (
    <span
      role="button"
      tabIndex={0}
      className="adviser-fix"
      onClick={onTake}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onTake();
        }
      }}
      aria-label={`Change “${issue.found}” to “${issue.replacement}”`}
      title={issue.note || 'Take this fix'}
    >
      {content}
    </span>
  );
}

function DraftSegments({ segments, marks, fixesByKey, taken, onTake }) {
  const renderFix = (segment, i) => {
    const fix = fixesByKey[segment.key];
    if (!fix) return <Fragment key={i}>{segment.text}</Fragment>;
    return <FixMark key={segment.key} issue={fix.issue} taken={taken.has(segment.key)} onTake={onTake ? () => onTake(fix) : null} />;
  };
  return segments.map((segment, i) => {
    if (segment.type === 'text') return <Fragment key={i}>{segment.text}</Fragment>;
    if (segment.type === 'fix') return renderFix(segment, i);
    const found = segment.keys.map((key) => marks[key]).filter(Boolean);
    const tone = TONE_ORDER.find((t) => found.some((mark) => mark.tone === t)) || 'note';
    const numbers = found.map((mark) => mark.number).sort((a, b) => a - b);
    return (
      <Fragment key={segment.keys.join(' ')}>
        <mark className="adviser-mark" data-tone={tone} data-keys={segment.keys.join(' ')}>
          {segment.children.map((child, j) =>
            child.type === 'fix' ? (
              renderFix(child, j)
            ) : (
              <span key={j} className="adviser-mark-rule">
                {child.text}
              </span>
            ),
          )}
        </mark>
        {numbers.length > 0 && (
          <sup className="adviser-mark-number" data-tone={tone}>
            <span className="visually-hidden">{numbers.length > 1 ? ' notes ' : ' note '}</span>
            {numbers.join(',')}
          </sup>
        )}
      </Fragment>
    );
  });
}

/** The read's shape while it loads: verdict, the post, the goals. */
function AdviserSkeleton({ count = 2 }) {
  const goals = Math.max(1, Math.min(count, 5));
  return (
    <div className="adviser-skeleton" aria-hidden="true">
      <span className="skeleton adviser-skel-verdict" />
      <div className="adviser-draft">
        <span className="skeleton skeleton-line skeleton-line--short" />
        <span className="skeleton skeleton-line" />
        <span className="skeleton skeleton-line" />
        <span className="skeleton skeleton-line" style={{ width: '60%' }} />
      </div>
      <div className="adviser-skel-goals">
        {Array.from({ length: goals }).map((_, i) => (
          <span key={i} className="skeleton skeleton-chip" />
        ))}
      </div>
    </div>
  );
}
