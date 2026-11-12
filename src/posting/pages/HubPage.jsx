import { useMemo } from 'react';
import { ArrowRight, CalendarClock, CalendarRange, FileText, LayoutTemplate, Library, Send, SquarePen, Timer } from 'lucide-react';
import Button from '../../components/Button.jsx';
import { Link } from '../../lib/router.jsx';
import { useArchive, isBuilt } from '../../archive/ArchiveContext.jsx';
import { useAtprotoSession } from '../../session/useAtprotoSession.jsx';
import { useComposer } from '../composer/ComposerContext.jsx';
import PostingPermissionNotice from '../../accounts/PostingPermissionNotice.jsx';
import { DRAFTS_CHANGED_EVENT, POSTS_CHANGED_EVENT, SCHEDULED_CHANGED_EVENT, TIMERS_CHANGED_EVENT } from '../events.js';
import { listDrafts, postingDeviceId } from '../drafts/drafts.js';
import { getLimits, listScheduled, scheduledUsageLine } from '../schedule/scheduleService.js';
import { listTimers } from '../timers/timerService.js';
import { relativeWhen } from '../schedule/postingQueue.js';
import { useTemplates } from '../templates/useTemplates.js';
import { publicXrpc } from '../library/sources.js';
import { isMissingScopeError } from '../../session/scopes.js';
import { postingPath } from '../routes.js';
import PostingHeader from '../ui/PostingHeader.jsx';
import NeedsBackend from '../ui/NeedsBackend.jsx';
import { formatDateShort, relativeTime } from '../../lib/time.js';
import { countPhrase, draftRows, mergePostRows, rowFromPostView, scheduledOverview, scheduledSnippet, timersOverview, whenLabel } from './hubModel.js';
import { draftMeta } from './draftActions.js';
import { LoadError, RowSkeleton, useLoad } from './hubParts.jsx';
import './hub.css';

function Tile({ to, icon: Icon, label, value, note, loading }) {
  return (
    <Link to={to} className="card hub-tile">
      <span className="hub-tile-icon" aria-hidden="true">
        <Icon size={17} />
      </span>
      <span className="hub-tile-text">
        <span className="hub-tile-label">{label}</span>
        {loading ? (
          <span className="hub-bone hub-bone--figure" aria-hidden="true" />
        ) : (
          <span className="hub-tile-value num">{value}</span>
        )}
        {note && !loading && <span className="hub-tile-note">{note}</span>}
        {loading && <span className="visually-hidden">Loading</span>}
      </span>
    </Link>
  );
}

function SectionCard({ title, sub, to, linkLabel, children }) {
  return (
    <section className="card hub-card" aria-label={title}>
      <div className="card-head">
        <div>
          <h2 className="card-title">{title}</h2>
          {sub && <p className="card-sub">{sub}</p>}
        </div>
        {to && (
          <Link to={to} className="btn btn--sm btn--ghost hub-card-link">
            {linkLabel}
            <ArrowRight size={14} aria-hidden="true" />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

/**
 * The posting overview: what goes out next, the drafts waiting, what went
 * out last, and how many timers are counting down, each leading to its page.
 * An account without a long session sees what it can use, and what needs
 * one.
 */
export default function HubPage({ did }) {
  const composer = useComposer();
  const archive = useArchive();
  const { agentFor, backendFor, capabilitiesFor } = useAtprotoSession();
  const caps = capabilitiesFor(did);
  const req = caps.canSchedule ? backendFor(did) : null;
  const templates = useTemplates(did);

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
      const [list, limits] = await Promise.all([listScheduled(req, { signal }), getLimits(req, { signal }).catch(() => null)]);
      return { ...scheduledOverview(list.rows), unavailable: Boolean(list.unavailable), usage: scheduledUsageLine(limits) };
    },
    { key: `${did}:${Boolean(req)}`, did, events: [SCHEDULED_CHANGED_EVENT], enabled: Boolean(req) },
  );

  const timers = useLoad(
    async (signal) => {
      const { rows, unavailable } = await listTimers(req, { signal });
      return { ...timersOverview(rows), unavailable };
    },
    { key: `${did}:${Boolean(req)}`, did, events: [TIMERS_CHANGED_EVENT], enabled: Boolean(req) },
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

  const draftCount = drafts.data ? `${drafts.data.rows.length.toLocaleString('en-US')}${drafts.data.more ? '+' : ''}` : '–';
  const now = new Date();

  return (
    <>
      <PostingHeader
        page="hub"
        actions={
          <Button variant="primary" onClick={() => composer.open({ asDid: did })} aria-keyshortcuts="n">
            <SquarePen size={15} aria-hidden="true" />
            New post
          </Button>
        }
      />
      <div className="page-body hub">
        <PostingPermissionNotice did={did} />

        <div className="hub-tiles">
          <Tile
            to={postingPath('drafts')}
            icon={FileText}
            label="Drafts"
            loading={drafts.status === 'loading'}
            value={drafts.status === 'error' ? '–' : draftCount}
            note={drafts.status === 'error' ? 'Couldn’t read them' : 'Private, on your Bluesky account'}
          />
          <Tile
            to={postingPath('scheduled')}
            icon={CalendarClock}
            label="Scheduled"
            loading={Boolean(req) && scheduled.status === 'loading'}
            value={!req ? '–' : scheduled.data ? scheduled.data.waiting : '–'}
            note={
              !req
                ? 'Needs a long session'
                : scheduled.data?.failed
                  ? `${countPhrase(scheduled.data.failed, 'post')} didn’t go out`
                  : scheduled.data
                    ? `${scheduled.data.queued.toLocaleString('en-US')} in the queue`
                    : scheduled.status === 'error'
                      ? 'Couldn’t read them'
                      : ''
            }
          />
          <Tile
            to={postingPath('timers')}
            icon={Timer}
            label="Timers counting down"
            loading={Boolean(req) && timers.status === 'loading'}
            value={!req ? '–' : timers.data ? timers.data.live : '–'}
            note={
              !req
                ? 'Needs a long session'
                : timers.data?.nextCheck
                  ? `Next check ${relativeWhen(timers.data.nextCheck)}`
                  : timers.status === 'error'
                    ? 'Couldn’t read them'
                    : ''
            }
          />
          <Tile
            to={postingPath('templates')}
            icon={LayoutTemplate}
            label="Templates"
            loading={templates.loading && !templates.templates.length}
            value={templates.templates.length}
            note="In your repo"
          />
        </div>

        <div className="hub-columns">
          <div className="hub-column">
            <SectionCard
              title="Going out next"
              sub={req ? scheduled.data?.usage || 'Scheduled posts and the weekly queue.' : null}
              to={postingPath('scheduled')}
              linkLabel="All scheduled"
            >
              {!req ? (
                <NeedsBackend did={did} />
              ) : scheduled.status === 'loading' ? (
                <RowSkeleton rows={3} />
              ) : scheduled.status === 'error' ? (
                <LoadError message="Your scheduled posts couldn’t be read from Virga’s server." onRetry={scheduled.reload} />
              ) : scheduled.data.unavailable ? (
                <p className="empty">Scheduling isn’t available on Virga’s server just now.</p>
              ) : scheduled.data.next.length ? (
                <ul className="hub-list">
                  {scheduled.data.next.map((row) => (
                    <li key={row.id} className="hub-row">
                      <div className="hub-row-main">
                        <span className="hub-row-text">{scheduledSnippet(row)}</span>
                        <span className="hub-row-meta">
                          <time dateTime={row.scheduledFor}>{whenLabel(row.scheduledFor, now)}</time>
                          {row.queued && <span className="badge badge--outline">Queue</span>}
                          {row.clientKey && row.clientKey !== 'virga' && <span className="badge">From Anisota</span>}
                          {row.status === 'publishing' && <span>Going out now</span>}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="hub-empty">
                  <p className="empty">Nothing is scheduled. Write a post and choose Schedule, or add it to your queue.</p>
                </div>
              )}
              {req && scheduled.data?.failed > 0 && (
                <p className="callout callout--warn hub-card-note">
                  {countPhrase(scheduled.data.failed, 'scheduled post')} didn’t go out.{' '}
                  <Link to={postingPath('scheduled')}>See what happened</Link>
                </p>
              )}
            </SectionCard>

            <SectionCard title="Latest drafts" sub="Kept as private drafts on your Bluesky account." to={postingPath('drafts')} linkLabel="All drafts">
              {drafts.status === 'loading' ? (
                <RowSkeleton rows={3} actions={1} />
              ) : drafts.status === 'error' ? (
                isMissingScopeError(drafts.error) ? (
                  <PostingPermissionNotice did={did} force />
                ) : (
                  <LoadError message="Your drafts couldn’t be read from Bluesky." onRetry={drafts.reload} />
                )
              ) : drafts.data.rows.length ? (
                <ul className="hub-list">
                  {drafts.data.rows.slice(0, 3).map((row) => (
                    <li key={row.id} className="hub-row">
                      <div className="hub-row-main">
                        <span className="hub-row-text">{row.text.trim() || <span className="muted">No text yet</span>}</span>
                        <span className="hub-row-meta">{draftMeta(row).slice(0, 3).join(' · ')}</span>
                      </div>
                      <div className="hub-row-actions">
                        <Button size="sm" onClick={() => composer.open({ draftId: row.id, draftOwnerDid: did, asDid: did })}>
                          Open
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty">No drafts. In the composer, Save draft keeps a post here until you’re ready.</p>
              )}
            </SectionCard>
          </div>

          <div className="hub-column">
            <SectionCard title="Recently posted" sub="Reply, quote, change who can reply, or delete." to={postingPath('posted')} linkLabel="All posts">
              {recentLoading ? (
                <RowSkeleton rows={5} />
              ) : recent.length ? (
                <ul className="hub-list">
                  {recent.map((row) => (
                    <li key={row.uri} className="hub-row">
                      <div className="hub-row-main">
                        <span className="hub-row-text">{row.text?.trim() || <span className="muted">{row.hasMedia ? 'A post with media' : 'No text'}</span>}</span>
                        <span className="hub-row-meta num">
                          <time dateTime={row.at} title={formatDateShort(row.at)}>
                            {relativeTime(row.at)}
                          </time>
                          {row.replyTo && row.replyTo !== did && <span>Reply</span>}
                          <span>
                            {countPhrase(row.likes || 0, 'like')} · {countPhrase(row.replies || 0, 'reply', 'replies')}
                          </span>
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : fresh.status === 'error' ? (
                <LoadError message="Your latest posts couldn’t be read from Bluesky." onRetry={fresh.reload} />
              ) : (
                <p className="empty">Nothing posted yet. New post starts one.</p>
              )}
            </SectionCard>

            <nav className="hub-more" aria-label="More in Posting">
              <Link to={postingPath('schedule')} className="hub-more-link">
                <CalendarRange size={16} aria-hidden="true" />
                <span>
                  <span className="hub-more-name">Weekly schedule</span>
                  <span className="hub-more-desc">{req ? 'The times your queue posts go out.' : 'Needs a long session.'}</span>
                </span>
              </Link>
              <Link to={postingPath('library')} className="hub-more-link">
                <Library size={16} aria-hidden="true" />
                <span>
                  <span className="hub-more-name">Library</span>
                  <span className="hub-more-desc">Your posts, saved posts, links, feeds and lists to attach.</span>
                </span>
              </Link>
              <Link to={postingPath('posted')} className="hub-more-link">
                <Send size={16} aria-hidden="true" />
                <span>
                  <span className="hub-more-name">Posted</span>
                  <span className="hub-more-desc">Everything you’ve posted, to search and manage.</span>
                </span>
              </Link>
            </nav>
          </div>
        </div>
      </div>
    </>
  );
}
