import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, FileText, Send, SquarePen, Trash2 } from 'lucide-react';
import Button from '../../components/Button.jsx';
import Dialog from '../../components/Dialog.jsx';
import { navigate } from '../../lib/router.jsx';
import { useToast } from '../../shell/bits.jsx';
import { useAtprotoSession } from '../../session/useAtprotoSession.jsx';
import { accountHandle, accountName } from '../../session/accounts.js';
import { isMissingScopeError } from '../../session/scopes.js';
import PostingPermissionNotice from '../../accounts/PostingPermissionNotice.jsx';
import { useComposer } from '../composer/ComposerContext.jsx';
import { DRAFTS_CHANGED_EVENT, emitPostsChanged } from '../events.js';
import { DRAFT_LIMIT_MESSAGE, deleteDraft, listDrafts, openDraft, postingDeviceId, pruneOrphanedDraftMedia } from '../drafts/drafts.js';
import { resolveDefaultGates, usePostingSettings } from '../settings.js';
import { createScheduled, getLimits, listScheduled, scheduledRoomProblem, scheduledUsageLine } from '../schedule/scheduleService.js';
import { nextOpenSlot } from '../schedule/postingQueue.js';
import { scheduleErrorMessage } from '../schedule/scheduledPostError.js';
import { armAfterPublish, timerSnippet } from '../timers/timerService.js';
import { composerTimerFit, timerRoomProblem } from '../timers/selfDestruct.js';
import { postingPath } from '../routes.js';
import PostingHeader from '../ui/PostingHeader.jsx';
import WhenPicker from '../ui/WhenPicker.jsx';
import { blobImageLoader, draftActionMessage, draftMeta, draftPostBlock, draftScheduleBlock, postDraftNow, scheduleDraft } from './draftActions.js';
import { draftRows, whenLabel } from './hubModel.js';
import { ConfirmDialog, LoadError, RowSkeleton } from './hubParts.jsx';
import './hub.css';

const PAGE = 50;
// Accounts whose stray draft files this tab has already cleared out.
const prunedMedia = new Set();
// Bluesky doesn't say how many drafts it keeps; past this many, say that it may stop.
const MANY_DRAFTS = 50;

function useDraftList(did, agentFor) {
  const [state, setState] = useState({ status: 'loading', views: [], cursor: null, error: null, more: false });
  const token = useRef(0);

  const load = async ({ append = false } = {}) => {
    const mine = ++token.current;
    setState((s) => ({ ...s, ...(append ? { more: true } : {}), error: append ? s.error : null }));
    try {
      const agent = await agentFor(did);
      const page = await listDrafts(agent, { limit: PAGE, cursor: append ? state.cursor : undefined });
      if (mine !== token.current) return;
      setState((s) => {
        const views = append ? [...s.views, ...page.drafts.filter((d) => !s.views.some((v) => v.id === d.id))] : page.drafts;
        return { status: 'ready', views, cursor: page.cursor, error: null, more: false };
      });
    } catch (error) {
      if (mine !== token.current) return;
      setState((s) => ({ ...s, status: s.views.length ? 'ready' : 'error', error, more: false }));
    }
  };

  useEffect(() => {
    setState({ status: 'loading', views: [], cursor: null, error: null, more: false });
    load();
    const on = (event) => {
      if (event.detail?.did === did) load();
    };
    window.addEventListener(DRAFTS_CHANGED_EVENT, on);
    return () => window.removeEventListener(DRAFTS_CHANGED_EVENT, on);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [did]);

  return { ...state, reload: () => load(), loadMore: () => load({ append: true }) };
}

/**
 * The account's Bluesky drafts: open one in the composer, post it now,
 * schedule it, or delete it. Drafts are private to the account and shared
 * with every app that reads them; pictures in them stay on the device that
 * saved them.
 */
export default function DraftsPage({ did, id = null }) {
  const composer = useComposer();
  const toast = useToast();
  const session = useAtprotoSession();
  const { agentFor, backendFor, capabilitiesFor, targetFor, accounts } = session;
  const caps = capabilitiesFor(did);
  const req = caps.canSchedule ? backendFor(did) : null;
  const { settings } = usePostingSettings(did);
  const list = useDraftList(did, agentFor);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [scheduling, setScheduling] = useState(null);
  const account = accounts.find((a) => a.did === did);
  const handle = accountHandle(account) || accountName(account);

  // /posting/drafts/<id> opens that draft in the composer.
  const opened = useRef(false);
  useEffect(() => {
    if (!id || opened.current) return;
    opened.current = true;
    composer.open({ draftId: id, draftOwnerDid: did, asDid: did });
    navigate(postingPath('drafts'), { replace: true });
  }, [id, did, composer]);

  // Files kept for drafts that were posted or deleted in another app are
  // cleared out once a tab, after the list reads. Not while the composer is
  // open: a save there may be between keeping its files and writing the draft.
  const composerOpen = composer.isOpen;
  useEffect(() => {
    if (list.status !== 'ready' || composerOpen || prunedMedia.has(did)) return;
    prunedMedia.add(did);
    Promise.resolve(agentFor(did))
      .then((agent) => pruneOrphanedDraftMedia(agent, did))
      .catch(() => prunedMedia.delete(did));
  }, [list.status, composerOpen, did, agentFor]);

  const rows = useMemo(() => draftRows(list.views, { deviceId: postingDeviceId() }), [list.views]);
  const viewsById = useMemo(() => new Map(list.views.map((v) => [v.id, v])), [list.views]);

  const deps = async () => {
    const [{ publish }, { resolveMention }, { serializeForSchedule }] = await Promise.all([
      import('../lib/publish.js'),
      import('../lib/mentions.js'),
      import('../schedule/scheduleSerialize.js'),
    ]);
    const target = await targetFor(did);
    return {
      openDraft,
      resolveDefaultGates,
      targetFor: async () => target,
      publish,
      resolveMention,
      emitPostsChanged,
      deleteDraft,
      serializeForSchedule,
      createScheduled,
      requester: req,
      loadImage: blobImageLoader({ did, pdsUrl: target.pdsUrl }),
      timerRoom: req ? async (rule) => timerRoomProblem(rule, await getLimits(req).catch(() => null)) : null,
      armTimer: req
        ? (result, state) =>
            armAfterPublish(req, result, state.lifespan, {
              snippet: timerSnippet(state.posts[0]?.text),
              postedAt: new Date().toISOString(),
              fit: composerTimerFit({ reply: Boolean(state.reply) }),
            })
        : null,
    };
  };

  const postNow = async (row) => {
    const view = viewsById.get(row.id);
    if (!view || busy) return;
    setBusy(row.id);
    setNotice(null);
    try {
      const agent = await agentFor(did);
      const out = await postDraftNow(view, { did, settings, agent, deps: await deps() });
      toast?.(`Posted as ${handle}.`);
      if (out.notes.length) setNotice({ tone: 'warn', text: out.notes.join(' ') });
    } catch (err) {
      setNotice({
        tone: 'danger',
        text: draftActionMessage(err, { action: 'post' }),
        scope: isMissingScopeError(err) || err?.code === 'MISSING_SCOPE',
      });
    } finally {
      setBusy(null);
    }
  };

  const schedule = async ({ row, scheduledFor, queued }) => {
    const view = viewsById.get(row.id);
    if (!view) return;
    setBusy(row.id);
    setNotice(null);
    try {
      const agent = await agentFor(did);
      const out = await scheduleDraft(view, { did, settings, agent, scheduledFor, queued, deps: await deps() });
      toast?.(queued ? `Added to your queue for ${whenLabel(out.row?.scheduledFor || scheduledFor)}.` : `Scheduled for ${whenLabel(scheduledFor)}.`);
      if (out.notes.length) setNotice({ tone: 'warn', text: out.notes.join(' ') });
      setScheduling(null);
    } catch (err) {
      throw new Error(
        err?.code === 'MEDIA_MISSING' || err?.code === 'NEEDS_BACKEND' ? err.message : scheduleErrorMessage(err) || draftActionMessage(err, { action: 'schedule' }),
      );
    } finally {
      setBusy(null);
    }
  };

  const remove = async (row) => {
    const agent = await agentFor(did);
    try {
      await deleteDraft(agent, row.id);
    } catch (err) {
      throw new Error(isMissingScopeError(err) ? 'Virga needs permission to delete drafts. Sign in again to grant it.' : `The draft couldn’t be deleted. ${err?.message || 'Try again.'}`);
    }
    toast?.('Draft deleted.');
  };

  const scopeError = list.status === 'error' && isMissingScopeError(list.error);

  return (
    <>
      <PostingHeader
        page="drafts"
        actions={
          <Button variant="primary" onClick={() => composer.open({ asDid: did })}>
            <SquarePen size={15} aria-hidden="true" />
            New post
          </Button>
        }
      />
      <div className="page-body hub">
        <PostingPermissionNotice did={did} force={scopeError || Boolean(notice?.scope)} />
        {notice && !notice.scope && (
          <p className={`callout callout--${notice.tone}`} role={notice.tone === 'danger' ? 'alert' : 'status'}>
            {notice.text}
          </p>
        )}

        <section className="card card--flush hub-card" aria-labelledby="drafts-title">
          <div className="card-head">
            <div>
              <h2 id="drafts-title" className="card-title">
                {list.status === 'ready' && rows.length
                  ? `${rows.length.toLocaleString('en-US')}${list.cursor ? '+' : ''} ${rows.length === 1 && !list.cursor ? 'draft' : 'drafts'}`
                  : 'Drafts'}
              </h2>
              <p className="card-sub">The latest edit first. Pictures stay on the device that saved them.</p>
            </div>
          </div>

          {list.status === 'loading' ? (
            <RowSkeleton rows={4} actions={3} />
          ) : list.status === 'error' ? (
            scopeError ? (
              <p className="empty">Your drafts can’t be read until Virga has permission.</p>
            ) : (
              <div className="hub-pad">
                <LoadError message="Your drafts couldn’t be read from Bluesky. Check the connection and try again." onRetry={list.reload} />
              </div>
            )
          ) : rows.length ? (
            <ul className="hub-list hub-list--rows">
              {rows.map((row) => {
                const postBlock = draftPostBlock(row, { canPost: caps.canPost });
                const scheduleBlock = draftScheduleBlock(row, { canSchedule: caps.canSchedule });
                const disabled = Boolean(busy);
                const working = busy === row.id;
                return (
                  <li key={row.id} className="hub-row draft-row" aria-busy={working || undefined}>
                    <div className="hub-row-main">
                      <p className="hub-row-text draft-text">{row.text.trim() || <span className="muted">No text yet</span>}</p>
                      <p className="hub-row-meta">{draftMeta(row).join(' · ')}</p>
                      {row.mediaElsewhere && (
                        <p className="hub-row-note">Its pictures were saved on another device. Open it to attach them again before posting.</p>
                      )}
                    </div>
                    <div className="hub-row-actions draft-actions">
                      <Button size="sm" disabled={disabled} onClick={() => composer.open({ draftId: row.id, draftOwnerDid: did, asDid: did })}>
                        <FileText size={14} aria-hidden="true" />
                        Open
                      </Button>
                      <Button
                        size="sm"
                        disabled={disabled || Boolean(postBlock)}
                        title={postBlock || 'Post it now, as it is'}
                        aria-busy={working || undefined}
                        onClick={() => postNow(row)}
                      >
                        <Send size={14} aria-hidden="true" />
                        {working ? 'Working…' : 'Post now'}
                      </Button>
                      <Button
                        size="sm"
                        disabled={disabled || Boolean(scheduleBlock)}
                        title={scheduleBlock || 'Choose when it goes out'}
                        onClick={() => setScheduling(row)}
                      >
                        <CalendarClock size={14} aria-hidden="true" />
                        Schedule
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon
                        className="hub-danger"
                        disabled={disabled || !caps.canPost}
                        aria-label={`Delete the draft “${row.text.trim().slice(0, 40) || 'with no text'}”`}
                        title="Delete this draft"
                        onClick={() => setDeleting(row)}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </Button>
                    </div>
                    {(postBlock || scheduleBlock) && !row.mediaElsewhere && (
                      <p className="hub-row-why">{[postBlock, scheduleBlock && caps.canSchedule ? scheduleBlock : ''].filter(Boolean).join(' ')}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="hub-empty hub-pad">
              <p className="empty">No drafts yet. Start a post and choose Save draft: it waits here, private to your account, until you’re ready.</p>
              <Button onClick={() => composer.open({ asDid: did })}>
                <SquarePen size={15} aria-hidden="true" />
                Write a post
              </Button>
            </div>
          )}

          {list.status === 'ready' && list.cursor && (
            <div className="hub-more-row">
              <Button size="sm" onClick={list.loadMore} disabled={list.more} aria-busy={list.more || undefined}>
                {list.more ? 'Loading…' : 'Load more drafts'}
              </Button>
            </div>
          )}
          {list.status === 'ready' && rows.length >= MANY_DRAFTS && (
            <p className="card-caption hub-pad">Bluesky may stop keeping new drafts past a limit. If one won’t save: {DRAFT_LIMIT_MESSAGE}</p>
          )}
          {!caps.canSchedule && rows.length > 0 && (
            <p className="card-caption hub-pad">Scheduling a draft needs a long session. Settings › Account offers one.</p>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this draft?"
        onClose={() => setDeleting(null)}
        onConfirm={() => remove(deleting)}
      >
        <p>
          It goes from your Bluesky account, so the Bluesky app and anything else that reads your drafts loses it too. This can’t be undone.
        </p>
        {deleting?.text?.trim() && <blockquote className="hub-quote">{deleting.text.trim().slice(0, 280)}</blockquote>}
      </ConfirmDialog>

      <ScheduleDraftDialog
        open={Boolean(scheduling)}
        row={scheduling}
        did={did}
        req={req}
        queueSettings={settings.queue}
        onClose={() => setScheduling(null)}
        onSchedule={schedule}
      />
    </>
  );
}

function ScheduleDraftDialog({ open, row, did, req, queueSettings, onClose, onSchedule }) {
  const [when, setWhen] = useState(null);
  const [info, setInfo] = useState({ status: 'idle', slot: null, usage: '', room: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !req) return undefined;
    let live = true;
    setError('');
    setWhen(new Date(Date.now() + 60 * 60 * 1000).toISOString());
    setInfo({ status: 'loading', slot: null, usage: '', room: '' });
    Promise.all([listScheduled(req), getLimits(req).catch(() => null)])
      .then(([list, limits]) => {
        if (!live) return;
        const queued = list.rows.filter((r) => r.queued && (r.status === 'pending' || r.status === 'publishing'));
        const slot = nextOpenSlot(queueSettings, queued, new Date());
        setInfo({ status: 'ready', slot: slot ? slot.toISOString() : null, usage: scheduledUsageLine(limits), room: scheduledRoomProblem(limits) });
      })
      .catch(() => live && setInfo({ status: 'error', slot: null, usage: '', room: '' }));
    return () => {
      live = false;
    };
  }, [open, req, queueSettings]);

  const go = async (queued) => {
    setBusy(true);
    setError('');
    try {
      await onSchedule({ row, scheduledFor: queued ? info.slot : when, queued });
    } catch (err) {
      setError(err?.message || 'The draft couldn’t be scheduled. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const whenMs = Date.parse(when || '');
  const tooSoon = !Number.isFinite(whenMs) || whenMs < Date.now() + 60_000;

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      title="Schedule this draft"
      actions={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => go(true)} disabled={busy || !info.slot || Boolean(info.room)} title={info.slot ? undefined : 'Your weekly schedule has no open time'}>
            Add to queue
          </Button>
          <Button variant="primary" onClick={() => go(false)} disabled={busy || tooSoon || Boolean(info.room)} aria-busy={busy || undefined}>
            {busy ? 'Scheduling…' : 'Schedule'}
          </Button>
        </>
      }
    >
      <div className="hub-confirm">
        {row?.text?.trim() && <blockquote className="hub-quote">{row.text.trim().slice(0, 200)}</blockquote>}
        <WhenPicker did={did} value={when} onChange={setWhen} queue={Boolean(info.slot)} onQueue={() => info.slot && setWhen(info.slot)} />
        {tooSoon && when && <p className="field-hint lib-question-error">Choose a time at least a minute from now.</p>}
        {info.status === 'loading' && <p className="field-hint">Looking for the next open time in your queue…</p>}
        {info.status === 'ready' && (
          <p className="field-hint">
            {info.slot
              ? `Add to queue puts it in the next open time: ${whenLabel(info.slot)}.`
              : 'Your weekly schedule has no open times. Set some in Posting › Weekly schedule to use the queue.'}
          </p>
        )}
        {info.usage && <p className="field-hint">{info.usage}. Limits are shared with Anisota.</p>}
        {info.room && (
          <p className="callout callout--warn" role="status">
            {info.room}
          </p>
        )}
        {info.status === 'error' && <p className="callout callout--warn">Your queue couldn’t be read, so only a set time can be chosen.</p>}
        <p className="field-hint">Once it’s scheduled, the draft is deleted: the scheduled post takes its place.</p>
        {error && (
          <p className="callout callout--danger" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
