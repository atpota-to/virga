import { useEffect, useMemo, useState } from 'react';
import { Timer } from 'lucide-react';
import Button from '../../components/Button.jsx';
import Dialog from '../../components/Dialog.jsx';
import Segmented from '../../components/Segmented.jsx';
import { useAtprotoSession } from '../../session/useAtprotoSession.jsx';
import { relativeTime } from '../../lib/time.js';
import { usePostingSettings } from '../settings.js';
import { getLimits } from '../schedule/scheduleService.js';
import { scheduleErrorMessage } from '../schedule/scheduledPostError.js';
import {
  composerTimerFit,
  defaultRuleFromSettings,
  describeTimer,
  formatLifespan,
  MIN_LIFESPAN_SECONDS,
  normalizeTimer,
} from '../timers/selfDestruct.js';
import {
  createTimer,
  isLiveTimer,
  listTimers,
  timerDidForUri,
} from '../timers/timerService.js';
import { publicXrpc } from '../library/sources.js';
import { ruleOfTimerRow, formatInZone } from '../pages/scheduleModel.js';
import LifespanEditor from './LifespanEditor.jsx';
import NeedsBackend from './NeedsBackend.jsx';
import { editorNotes, firstActAt, timerStart } from './lifespanModel.js';
import '../pages/schedule.css';

/**
 * Put a post that's already out on a timer. `post` is `{ uri, cid,
 * extraUris?, text, postedAt, reply? }`; the timer is set as the account in
 * the post's URI (only it may), through Virga's server. The clock starts now
 * or when the post went up. A post that already has a timer counting down
 * gets the new rule in its place. `onArmed(result)` hears createTimer's
 * answer once the timer is set.
 */
export default function TimerDialog({ open, onClose, did, post, onArmed }) {
  const { backendFor, capabilitiesFor } = useAtprotoSession();
  const owner = timerDidForUri(post?.uri) || did;
  const canSchedule = Boolean(owner && capabilitiesFor(owner).canSchedule);
  const req = canSchedule ? backendFor(owner) : null;
  const { settings } = usePostingSettings(owner);

  const [rule, setRule] = useState(() => ({
    ...defaultRuleFromSettings(settings.lifespan),
    enabled: true,
  }));
  const [start, setStart] = useState('now');
  const [info, setInfo] = useState({
    status: 'loading',
    limits: null,
    existing: null,
    reply: post?.reply,
    postedAt: post?.postedAt || null,
  });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  // What the dialog needs before the rule can be judged: the account's
  // limits, any timer the post already has, and whether it's a reply.
  useEffect(() => {
    if (!open || !post?.uri) return undefined;
    setError('');
    setBusy('');
    setStart('now');
    setRule({ ...defaultRuleFromSettings(settings.lifespan), enabled: true });
    let live = true;
    const fromBluesky =
      post.reply === undefined || !post.postedAt
        ? publicXrpc('app.bsky.feed.getPosts', { uris: [post.uri] })
            .then((body) => body?.posts?.[0] || null)
            .catch(() => null)
        : Promise.resolve(null);
    setInfo({
      status: 'loading',
      limits: null,
      existing: null,
      reply: post.reply,
      postedAt: post.postedAt || null,
    });
    Promise.all([
      req ? getLimits(req).catch(() => null) : null,
      req ? listTimers(req).catch(() => null) : null,
      fromBluesky,
    ]).then(([limits, timers, view]) => {
      if (!live) return;
      const existing =
        timers?.rows?.find((r) => r.postUri === post.uri && isLiveTimer(r)) ||
        null;
      if (existing) setRule(ruleOfTimerRow(existing));
      setInfo({
        status: 'ready',
        limits,
        existing,
        reply: post.reply ?? Boolean(view?.record?.reply),
        postedAt:
          post.postedAt || view?.record?.createdAt || view?.indexedAt || null,
      });
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, post?.uri, req]);

  const fit = useMemo(
    () => ({
      reply: Boolean(info.reply),
      thread: (post?.extraUris || []).length > 0,
    }),
    [info.reply, post?.extraUris],
  );
  const now = Date.now();
  const holds = info.existing ? ruleOfTimerRow(info.existing) : null;
  const postedAtMs = Date.parse(info.postedAt || '');
  const ruleNow = normalizeTimer({ ...rule, enabled: true });
  // The start the server will actually count from, worked out before the notes
  // so the sentence, the first-acts time and the request all agree with it.
  const counting = timerStart(ruleNow, {
    start,
    postedAt: info.postedAt,
    now,
  });
  const notes = editorNotes(rule, {
    fit,
    limits: info.limits,
    holds,
    countFrom: counting.from,
    now,
  });
  const actsAt = notes.fitted.enabled
    ? firstActAt(notes.fitted, { startedAt: counting.startedAt, now })
    : null;
  const blocked =
    !notes.fitted.enabled || Boolean(notes.room) || notes.pinBlocks;

  const arm = async () => {
    setBusy('arming');
    setError('');
    try {
      const out = await createTimer(req, {
        uri: post.uri,
        cid: post.cid,
        extraUris: post.extraUris || [],
        snippet: post.text,
        // Read again at the press: the render's clock can be minutes old.
        postedAt: new Date(
          timerStart(ruleNow, { start, postedAt: info.postedAt }).startedAt,
        ).toISOString(),
        rule,
        fit: composerTimerFit({ reply: Boolean(info.reply) }),
      });
      if (out.status === 'armed') {
        onArmed?.(out);
        return;
      }
      if (out.status === 'confirming') {
        setBusy('confirming');
        const outcome = await out.confirmation;
        if (outcome.status === 'armed') {
          onArmed?.({ ...out, ...outcome });
          return;
        }
        setError(
          outcome.status === 'failed'
            ? scheduleErrorMessage(outcome.error)
            : 'Virga’s server didn’t answer, so it isn’t clear whether the timer was set. Posting › Timers shows it if it was.',
        );
        return;
      }
      if (out.status === 'none') {
        setError(
          'This rule can’t apply to this post, so there’s nothing to set.',
        );
        return;
      }
      setError(scheduleErrorMessage(out.error));
    } catch (err) {
      setError(scheduleErrorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const snippet = String(post?.text || '').trim();

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      title={
        info.existing ? 'Change this post’s timer' : 'Put this post on a timer'
      }
      className="timer-dialog"
      actions={
        req ? (
          <>
            <Button onClick={onClose} disabled={Boolean(busy)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={arm}
              disabled={Boolean(busy) || info.status !== 'ready' || blocked}
              aria-busy={busy ? true : undefined}
            >
              <Timer size={15} aria-hidden="true" />
              {busy === 'confirming'
                ? 'Checking…'
                : busy
                  ? 'Setting…'
                  : info.existing
                    ? 'Replace the timer'
                    : 'Set the timer'}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Close</Button>
        )
      }
    >
      <div className="timer-dialog-body">
        {snippet ? (
          <blockquote className="hub-quote sched-quote">
            {snippet.slice(0, 280)}
          </blockquote>
        ) : (
          <p className="field-hint">A post with no words of its own.</p>
        )}
        {!req ? (
          <NeedsBackend did={owner} />
        ) : info.status === 'loading' ? (
          <div
            className="sched-dialog-skeleton"
            aria-busy="true"
            aria-label="Loading"
          >
            <span className="hub-bone" style={{ width: '40%' }} />
            <span
              className="hub-bone hub-bone--button"
              style={{ width: '100%', height: 32 }}
            />
            <span className="hub-bone" style={{ width: '70%' }} />
            <span
              className="hub-bone hub-bone--button"
              style={{ width: '100%', height: 32 }}
            />
          </div>
        ) : (
          <>
            {info.existing && (
              <p className="callout">
                It already has a timer:{' '}
                {describeTimer(ruleOfTimerRow(info.existing))} The rule below
                takes its place.
              </p>
            )}
            <div className="lse-sub">
              <span className="field-label">Start counting</span>
              <Segmented
                size="sm"
                label="Start counting"
                value={start}
                onChange={setStart}
                options={[
                  { value: 'now', label: 'From now' },
                  {
                    value: 'posted',
                    label: Number.isFinite(postedAtMs)
                      ? `From when it went up (${relativeTime(postedAtMs)})`
                      : 'From when it went up',
                  },
                ]}
              />
            </div>
            <LifespanEditor
              value={ruleNow}
              onChange={(next) => setRule({ ...next, enabled: true })}
              fit={fit}
              limits={info.limits}
              holds={holds}
              did={owner}
              showToggle={false}
              countFrom={counting.from}
            />
            {actsAt && !notes.room && (
              <p className="field-hint" aria-live="polite">
                {counting.passed === 'elapsed'
                  ? `It went up more than ${formatLifespan(notes.fitted.lifespanSeconds)} ago, so the time counts from now instead. It`
                  : counting.passed === 'floor'
                    ? `That’s less than ${MIN_LIFESPAN_SECONDS / 60} minutes away, the soonest a timer can act, so it`
                    : 'It'}{' '}
                first acts {formatInZone(actsAt, undefined, now)}.
              </p>
            )}
          </>
        )}
        {error && (
          <p className="callout callout--danger" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
