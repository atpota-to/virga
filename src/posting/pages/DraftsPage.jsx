import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, MoreHorizontal, Send, SquarePen, Trash2 } from 'lucide-react';
import Button from '../../components/Button.jsx';
import Dialog from '../../components/Dialog.jsx';
import Menu from '../../components/Menu.jsx';
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
import { activeLocale } from '../../lib/locale.js';

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
  const empty = list.status === 'ready' && !rows.length;

  // What a draft can do beyond Open: post it, schedule it, and deleting it
  // last. A step that can't be taken just now isn't offered; the line under
  // the draft says why.
  const menuItems = (row, { postBlock, scheduleBlock }) => {
    const items = [
      !postBlock && { key: 'post', label: 'Post now', icon: Send, onSelect: () => postNow(row) },
      !scheduleBlock && { key: 'schedule', label: 'Schedule…', icon: CalendarClock, onSelect: () => !busy && setScheduling(row) },
    ].filter(Boolean);
    if (caps.canPost) {
      if (items.length) items.push({ separator: true });
      items.push({ key: 'delete', label: 'Delete draft', icon: Trash2, tone: 'danger', onSelect: () => !busy && setDeleting(row) });
    }
    return items;
  };

  return (
    <>
      <PostingHeader page="drafts" />
      <div className="page-body hub">
        <PostingPermissionNotice did={did} force={scopeError || Boolean(notice?.scope)} />
        {notice && !notice.scope && (
          <p className={`callout callout--${notice.tone}`} role={notice.tone === 'danger' ? 'alert' : 'status'}>
            {notice.text}
          </p>
        )}

        {empty ? (
          // Nothing to list, so no heading over nothing: the sentence and
          // the way to start one.
          <div className="empty-block">
            <p className="empty">No drafts yet. Start a post and choose Save draft: it waits here, private to your account, until you’re ready.</p>
            <Button onClick={() => composer.open({ asDid: did })}>
              <SquarePen size={15} aria-hidden="true" />
              New post
            </Button>
          </div>
        ) : list.status === 'error' ? (
          // Nothing could be read, so no heading either: what went wrong,
          // under the notice that says how to put it right.
          scopeError ? (
            <div className="empty-block">
              <p className="empty">Your drafts can’t be read until Virga has permission.</p>
            </div>
          ) : (
            <LoadError message="Your drafts couldn’t be read from Bluesky. Check the connection and try again." onRetry={list.reload} />
          )
        ) : (
          <section className="card card--flush hub-card" aria-labelledby="drafts-title">
            <div className="card-head">
              <div>
                <h2 id="drafts-title" className="card-title">
                  {list.status === 'ready' && rows.length
                    ? `${rows.length.toLocaleString(activeLocale())}${list.cursor ? '+' : ''} ${rows.length === 1 && !list.cursor ? 'draft' : 'drafts'}`
                    : 'Drafts'}
                </h2>
                <p className="card-sub">The latest edit first. Pictures stay on the device that saved them.</p>
              </div>
            </div>

            {list.status === 'loading' ? (
              <RowSkeleton rows={4} actions={1} />
            ) : (
              <ul className="hub-list hub-list--rows">
                {rows.map((row) => {
                  const postBlock = draftPostBlock(row, { canPost: caps.canPost });
                  const scheduleBlock = draftScheduleBlock(row, { canSchedule: caps.canSchedule });
                  const working = busy === row.id;
                  const items = menuItems(row, { postBlock, scheduleBlock });
                  const why = [postBlock, scheduleBlock && caps.canSchedule ? scheduleBlock : ''].filter(Boolean).join(' ');
                  const name = row.text.trim().slice(0, 40) || 'with no text';
                  return (
                    <li key={row.id} className="hub-row draft-row has-corner-menu" aria-busy={working || undefined}>
                      <div className="hub-row-main">
                        <p className="hub-row-text draft-text">{row.text.trim() || <span className="muted">No text yet</span>}</p>
                        <p className="meta">
                          {draftMeta(row).map((part) => (
                            <span key={part}>{part}</span>
                          ))}
                        </p>
                        {row.mediaElsewhere ? (
                          <p className="hub-row-note">Its pictures were saved on another device. Open it to attach them again before posting.</p>
                        ) : (
                          why && <p className="hub-row-why">{why}</p>
                        )}
                      </div>
                      <div className="row-actions">
                        <Button
                          size="sm"
                          disabled={Boolean(busy)}
                          aria-label={`Open the draft “${name}”`}
                          onClick={() => composer.open({ draftId: row.id, draftOwnerDid: did, asDid: did })}
                        >
                          Open
                        </Button>
                        {items.length > 0 && (
                          // The kit's ⋯ (MoreMenu), with a spinner in place of
                          // the dots while the draft goes out.
                          <Menu label={`More for the draft “${name}”`} icon variant="ghost" className="row-menu" items={items}>
                            {working ? <span className="hub-spinner" aria-hidden="true" /> : <MoreHorizontal size={16} aria-hidden="true" />}
                          </Menu>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {list.status === 'ready' && list.cursor && (
              <div className="card-foot">
                <Button size="sm" variant="ghost" onClick={list.loadMore} disabled={list.more} aria-busy={list.more || undefined}>
                  {list.more ? 'Loading…' : 'Show more'}
                </Button>
              </div>
            )}
            {list.status === 'ready' && rows.length >= MANY_DRAFTS && (
              <p className="card-caption">Bluesky may stop keeping new drafts past a limit. If one won’t save: {DRAFT_LIMIT_MESSAGE}</p>
            )}
            {!caps.canSchedule && rows.length > 0 && (
              <p className="card-caption">Scheduling a draft needs a long session. Settings › Account offers one.</p>
            )}
          </section>
        )}
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
      className="when-dialog dialog--stack-actions"
      actions={
        <>
          <Button className="when-dialog-cancel" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          {/* The queue's next open time is said on its button, so the
              picker above is only for a time of one's own. */}
          <Button onClick={() => go(true)} disabled={busy || !info.slot || Boolean(info.room)} title={info.slot ? undefined : 'Your weekly schedule has no open time'}>
            {info.slot ? `Add to queue · ${whenLabel(info.slot)}` : 'Add to queue'}
          </Button>
          <Button variant="primary" onClick={() => go(false)} disabled={busy || tooSoon || Boolean(info.room)} aria-busy={busy || undefined}>
            {busy ? 'Scheduling…' : 'Schedule'}
          </Button>
        </>
      }
    >
      <div className="hub-confirm">
        {row?.text?.trim() && <blockquote className="hub-quote">{row.text.trim().slice(0, 200)}</blockquote>}
        <WhenPicker did={did} value={when} onChange={setWhen} />
        {tooSoon && when && <p className="field-hint lib-question-error">Choose a time at least a minute from now.</p>}
        {info.status === 'loading' && <p className="field-hint">Looking for the next open time in your queue…</p>}
        {info.status === 'ready' && !info.slot && (
          <p className="field-hint">Your weekly schedule has no open times. Set some in Posting › Weekly schedule to use the queue.</p>
        )}
        {info.usage && <p className="field-hint">{info.usage}.</p>}
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
