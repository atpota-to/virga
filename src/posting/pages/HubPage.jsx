import { useMemo, useRef, useState } from 'react';
import { Link } from '../../lib/router.jsx';
import { useArchive, isBuilt } from '../../archive/ArchiveContext.jsx';
import { useAtprotoSession } from '../../session/useAtprotoSession.jsx';
import { useOverflowEdge } from '../../components/Segmented.jsx';
import { useIsNarrow, useToast } from '../../shell/bits.jsx';
import { PostMeta } from '../../reports/PostRow.jsx';
import { useComposer } from '../composer/ComposerContext.jsx';
import PostingPermissionNotice from '../../accounts/PostingPermissionNotice.jsx';
import { DRAFTS_CHANGED_EVENT, POSTS_CHANGED_EVENT, SCHEDULED_CHANGED_EVENT, TIMERS_CHANGED_EVENT } from '../events.js';
import { listDrafts, postingDeviceId } from '../drafts/drafts.js';
import { listScheduled, retryScheduled } from '../schedule/scheduleService.js';
import { scheduleErrorMessage } from '../schedule/scheduledPostError.js';
import { listTimers } from '../timers/timerService.js';
import { useTemplates } from '../templates/useTemplates.js';
import { publicXrpc } from '../library/sources.js';
import { bskyUrlFor } from '../lib/postLink.js';
import { isMissingScopeError } from '../../session/scopes.js';
import { POSTING_PAGES, postingPath } from '../routes.js';
import PostingHeader from '../ui/PostingHeader.jsx';
import NeedsBackend from '../ui/NeedsBackend.jsx';
import { draftRows, mergePostRows, rowFromPostView, scheduledOverview, scheduledSnippet, timersOverview, whenLabel } from './hubModel.js';
import { draftMeta } from './draftActions.js';
import { isReplyRow } from './postedModel.js';
import { rowStatus } from './scheduleModel.js';
import { LoadError, RowSkeleton, useLoad } from './hubParts.jsx';
import './hub.css';
import { activeLocale } from '../../lib/locale.js';

/**
 * The posting pages as a row of words, for a screen without the sidebar
 * that lists them: the overview pressed, and after a page's name how many
 * it holds, where the overview has read that. It scrolls sideways when it
 * doesn't fit, out to the screen's edges.
 */
function PostingNav({ counts }) {
  const ref = useRef(null);
  useOverflowEdge(ref);
  return (
    <nav ref={ref} className="segmented posting-nav scroll-row scroll-row--bleed" aria-label="Posting pages">
      {POSTING_PAGES.map((page) => {
        const on = page.key === 'hub';
        const count = counts[page.key];
        return (
          <Link key={page.key} to={page.path} className={`segmented-key${on ? ' is-on' : ''}`} aria-current={on ? 'page' : undefined}>
            <span className="segmented-label" data-label={page.label}>
              {page.label}
            </span>
            {count != null && <span className="posting-nav-count num">{count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * A list of the overview: its name over a rule in ink, and the way to the
 * whole of it. No line under the name: the page it leads to says what the
 * list is, and side by side the rules of two lists stay on one line.
 */
function SectionCard({ title, to, linkLabel, children }) {
  return (
    <section className="card card--flush hub-card" aria-label={title}>
      <div className="card-head">
        <div>
          <h2 className="card-title">{title}</h2>
        </div>
        {to && (
          <Link to={to} className="more-link">
            {linkLabel}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

/** "Tomorrow, 10:00 AM" as its day and its hour, for a row that leads with them. */
function whenParts(label) {
  const at = label.lastIndexOf(', ');
  return at < 0 ? [label, ''] : [label.slice(0, at), label.slice(at + 2)];
}

/**
 * Why a scheduled post didn't go out, as the start of a sentence that ends
 * "retry or see what happened". The session ending is the usual reason and
 * is said in the fewest words; anything else in the Scheduled page's own.
 */
function failedLead(row) {
  const code = String(row?.lastErrorCode || '').toUpperCase();
  const session = code ? code === 'SESSION_UNAVAILABLE' : /session/i.test(row?.lastError || '');
  if (session) return { text: 'Its session had ended. Sign in again, then', retry: 'retry' };
  return { text: rowStatus(row).detail, retry: 'Retry' };
}

/**
 * The posting overview: what goes out next (and what didn't go out), the
 * drafts waiting and what went out last, each leading to its page. Where
 * there is no sidebar, the posting pages are a row under the header. An
 * account without a long session sees what it can use, and what needs one.
 */
export default function HubPage({ did }) {
  const composer = useComposer();
  const archive = useArchive();
  const toast = useToast();
  const narrow = useIsNarrow();
  const { agentFor, backendFor, capabilitiesFor } = useAtprotoSession();
  const caps = capabilitiesFor(did);
  const req = caps.canSchedule ? backendFor(did) : null;
  const templates = useTemplates(did);
  const [retrying, setRetrying] = useState(null);

  const drafts = useLoad(
    async (signal) => {
      const agent = await agentFor(did);
      const page = await listDrafts(agent, { limit: 100, signal });
      return { rows: draftRows(page.drafts, { deviceId: postingDeviceId() }), more: Boolean(page.cursor) };
    },
    { key: did, did, events: [DRAFTS_CHANGED_EVENT] },
  );

  const scheduled = useLoad(
    async (signal) => {
      const list = await listScheduled(req, { signal });
      return {
        ...scheduledOverview(list.rows),
        failedRows: (list.rows || []).filter((r) => r?.status === 'failed'),
        unavailable: Boolean(list.unavailable),
      };
    },
    { key: `${did}:${Boolean(req)}`, did, events: [SCHEDULED_CHANGED_EVENT], enabled: Boolean(req) },
  );

  // Only the row of pages shows how many timers count down, and it is
  // only there without the sidebar.
  const timers = useLoad(
    async (signal) => {
      const { rows, unavailable } = await listTimers(req, { signal });
      return { ...timersOverview(rows), unavailable };
    },
    { key: `${did}:${Boolean(req)}`, did, events: [TIMERS_CHANGED_EVENT], enabled: Boolean(req) && narrow },
  );

  // The latest posts: the archive's, with the author feed's newer ones on top.
  const fresh = useLoad(
    async (signal) => {
      const body = await publicXrpc('app.bsky.feed.getAuthorFeed', { actor: did, limit: 10, filter: 'posts_with_replies' }, { signal });
      return (body?.feed || []).filter((e) => !e.reason).map((e) => rowFromPostView(e.post, did)).filter(Boolean);
    },
    { key: did, did, events: [POSTS_CHANGED_EVENT] },
  );
  const recent = useMemo(
    () => mergePostRows(archive.did === did ? archive.posts : [], fresh.data || []).slice(0, 5),
    [archive.posts, archive.did, did, fresh.data],
  );
  const recentLoading = fresh.status === 'loading' && !(isBuilt(archive) && archive.posts.length);

  // What each page holds, after its name in the row of pages: only what has
  // been read and isn't nothing, and Scheduled and Timers only with a long
  // session, without which they can't be read.
  const counts = {};
  const locale = activeLocale();
  if (drafts.data?.rows.length) counts.drafts = `${drafts.data.rows.length.toLocaleString(locale)}${drafts.data.more ? '+' : ''}`;
  if (req && scheduled.data?.waiting) counts.scheduled = scheduled.data.waiting.toLocaleString(locale);
  if (req && timers.data?.live) counts.timers = timers.data.live.toLocaleString(locale);
  if (templates.templates.length) counts.templates = templates.templates.length.toLocaleString(locale);

  const retry = async (row) => {
    if (retrying) return;
    setRetrying(row.id);
    try {
      await retryScheduled(req, row.id);
      toast?.(row.partial ? 'The rest of the thread goes out in a moment.' : 'It goes out again in a moment.');
    } catch (err) {
      toast?.(scheduleErrorMessage(err));
    } finally {
      setRetrying(null);
    }
  };

  const now = new Date();
  const nextRows = scheduled.data?.next || [];
  const failedRows = scheduled.data?.failedRows || [];

  return (
    <>
      <PostingHeader page="hub">{narrow && <PostingNav counts={counts} />}</PostingHeader>
      <div className="page-body hub">
        <PostingPermissionNotice did={did} />

        <div className="hub-columns">
          <div className="hub-column">
            <SectionCard title="Going out next" to={req ? postingPath('scheduled') : null} linkLabel="All scheduled">
              {!req ? (
                <NeedsBackend did={did} />
              ) : scheduled.status === 'loading' ? (
                <RowSkeleton rows={3} />
              ) : scheduled.status === 'error' ? (
                <LoadError message="Your scheduled posts couldn’t be read from Virga’s server." onRetry={scheduled.reload} />
              ) : scheduled.data.unavailable ? (
                <div className="empty-block">
                  <p className="empty">Scheduling isn’t available on Virga’s server just now.</p>
                </div>
              ) : nextRows.length || failedRows.length ? (
                <ul className="hub-list">
                  {nextRows.map((row) => {
                    const [day, hour] = whenParts(whenLabel(row.scheduledFor, now));
                    const time = [hour, row.queued && 'Queue', row.status === 'publishing' && 'Going out now'].filter(Boolean).join(' · ');
                    return (
                      <li key={row.id} className="hub-row hub-row--when">
                        <time className="hub-when" dateTime={row.scheduledFor}>
                          <span className="hub-when-day">{day}</span>
                          {time && <span className="hub-when-time">{time}</span>}
                        </time>
                        <div className="hub-row-main">
                          <p className="hub-row-text">{scheduledSnippet(row)}</p>
                        </div>
                      </li>
                    );
                  })}
                  {failedRows.map((row) => {
                    const lead = failedLead(row);
                    const [day, hour] = whenParts(whenLabel(row.scheduledFor, now));
                    return (
                      <li key={row.id} className="hub-row hub-row--when" aria-busy={retrying === row.id || undefined}>
                        <div className="hub-when">
                          <span className="hub-when-day hub-when-failed">{rowStatus(row).label}</span>
                          {/* Its day and its hour each kept whole, so a narrow
                              column breaks between them. */}
                          <time className="hub-when-time" dateTime={row.scheduledFor}>
                            <span>{hour ? `${day},` : day}</span> {hour && <span>{hour}</span>}
                          </time>
                        </div>
                        <div className="hub-row-main">
                          <p className="hub-row-text">{scheduledSnippet(row)}</p>
                          {/* One run of words, so the two actions wrap with them. */}
                          <p className="hub-row-why">
                            {lead.text}{' '}
                            <button type="button" className="hub-inline-action" disabled={Boolean(retrying)} onClick={() => retry(row)}>
                              {lead.retry}
                            </button>{' '}
                            or{' '}
                            <Link className="hub-inline-action" to={postingPath('scheduled')}>
                              see what happened
                            </Link>
                            .
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="empty-block">
                  <p className="empty">Nothing is scheduled. Write a post and choose Schedule, or add it to your queue.</p>
                </div>
              )}
            </SectionCard>

            <SectionCard title="Latest drafts" to={postingPath('drafts')} linkLabel="All drafts">
              {drafts.status === 'loading' ? (
                <RowSkeleton rows={3} />
              ) : drafts.status === 'error' ? (
                isMissingScopeError(drafts.error) ? (
                  <PostingPermissionNotice did={did} force />
                ) : (
                  <LoadError message="Your drafts couldn’t be read from Bluesky." onRetry={drafts.reload} />
                )
              ) : drafts.data.rows.length ? (
                <ul className="hub-list">
                  {drafts.data.rows.slice(0, 3).map((row) => (
                    <li key={row.id} className="hub-row hub-row--open">
                      <div className="hub-row-main">
                        <p className="hub-row-text">{row.text.trim() || <span className="muted">No text yet</span>}</p>
                        <p className="meta">
                          {draftMeta(row)
                            .slice(0, 3)
                            .map((part) => (
                              <span key={part}>{part}</span>
                            ))}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="link-action"
                        aria-label={`Open the draft “${row.text.trim().slice(0, 40) || 'with no text'}”`}
                        onClick={() => composer.open({ draftId: row.id, draftOwnerDid: did, asDid: did })}
                      >
                        Open
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="empty-block">
                  <p className="empty">No drafts. In the composer, Save draft keeps a post here until you’re ready.</p>
                </div>
              )}
            </SectionCard>
          </div>

          <div className="hub-column">
            <SectionCard title="Recently posted" to={postingPath('posted')} linkLabel="All posts">
              {recentLoading ? (
                <RowSkeleton rows={5} />
              ) : recent.length ? (
                <ul className="hub-list">
                  {recent.map((row) => (
                    <li key={row.uri} className="hub-row">
                      <div className="hub-row-main">
                        <a className="hub-row-text hub-row-link" href={bskyUrlFor(row.uri)} target="_blank" rel="noopener noreferrer" title="Open on Bluesky">
                          {row.text?.trim() || <span className="muted">{row.hasMedia ? 'A post with media' : 'No text'}</span>}
                        </a>
                        {/* A post in a thread of the account's own isn't called a reply. */}
                        <PostMeta post={isReplyRow(row, did) ? row : { ...row, replyTo: null }} className="num" />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : fresh.status === 'error' ? (
                <LoadError message="Your latest posts couldn’t be read from Bluesky." onRetry={fresh.reload} />
              ) : (
                <div className="empty-block">
                  <p className="empty">Nothing posted yet. New post starts one.</p>
                </div>
              )}
            </SectionCard>
          </div>
        </div>
      </div>
    </>
  );
}
