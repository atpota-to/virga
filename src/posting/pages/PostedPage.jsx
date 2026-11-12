import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Heart, MessageSquare, MoreHorizontal, Quote, Repeat2, Reply, Search, SquarePen } from 'lucide-react';
import Button from '../../components/Button.jsx';
import Dialog from '../../components/Dialog.jsx';
import Menu from '../../components/Menu.jsx';
import Segmented from '../../components/Segmented.jsx';
import { Link } from '../../lib/router.jsx';
import { useToast } from '../../shell/bits.jsx';
import { formatDateShort, relativeTime } from '../../lib/time.js';
import { useArchive, isBuilt } from '../../archive/ArchiveContext.jsx';
import { useAtprotoSession } from '../../session/useAtprotoSession.jsx';
import { isMissingScopeError } from '../../session/scopes.js';
import PostingPermissionNotice from '../../accounts/PostingPermissionNotice.jsx';
import { useComposer } from '../composer/ComposerContext.jsx';
import { POSTS_CHANGED_EVENT, emitPostsChanged } from '../events.js';
import { updatePostGates } from '../lib/gates.js';
import { bskyUrlFor } from '../lib/postLink.js';
import { publicXrpc } from '../library/sources.js';
import TemplateEditor from '../library/TemplateEditor.jsx';
import GatesEditor from '../ui/GatesEditor.jsx';
import TimerDialog from '../ui/TimerDialog.jsx';
import PostingHeader from '../ui/PostingHeader.jsx';
import { countPhrase, mergePostRows, rowFromPostView } from './hubModel.js';
import {
  POSTED_FILTERS,
  deletePost,
  filterPostRows,
  isReplyRow,
  postRowActions,
  readPostGates,
  readPostNow,
  templateSeedFrom,
  textForComposer,
} from './postedModel.js';
import { ConfirmDialog, LoadError, RowSkeleton, useLoad } from './hubParts.jsx';
import './hub.css';

const STEP = 30;

function actionError(err, what) {
  if (err?.code === 'GONE') return err.message;
  if (isMissingScopeError(err)) return 'Virga needs permission to do that. Sign in again to grant it.';
  return `${what} ${err?.message || 'Try again.'}`;
}

function Count({ icon: Icon, value, label }) {
  const n = value || 0;
  return (
    <span className="posted-count" title={`${n.toLocaleString('en-US')} ${label}`}>
      <Icon size={13} aria-hidden="true" />
      {n.toLocaleString('en-US')}
      <span className="visually-hidden"> {label}</span>
    </span>
  );
}

/**
 * What the account has posted, from its archive plus a fresh read of its
 * latest posts that the archive hasn't synced yet. Each post can be replied
 * to, quoted, copied into a new post, saved as a template, given new reply
 * and quote settings, put on a timer (with a long session) or deleted.
 * Published posts aren't edited in place: copy one into a new post instead.
 */
export default function PostedPage({ did }) {
  const archive = useArchive();
  const composer = useComposer();
  const toast = useToast();
  const { agentFor, capabilitiesFor } = useAtprotoSession();
  const caps = capabilitiesFor(did);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [shown, setShown] = useState(STEP);
  const [removed, setRemoved] = useState([]);
  const [working, setWorking] = useState(null);
  const [error, setError] = useState(null);
  const [gates, setGates] = useState(null);
  const [timer, setTimer] = useState(null);
  const [seed, setSeed] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [feedPages, setFeedPages] = useState({ rows: [], cursor: null, loadingMore: false });

  const own = archive.did === did;
  const built = own && isBuilt(archive);

  const fresh = useLoad(
    async (signal) => {
      const body = await publicXrpc('app.bsky.feed.getAuthorFeed', { actor: did, limit: 50, filter: 'posts_with_replies' }, { signal });
      return {
        rows: (body?.feed || []).filter((e) => !e.reason).map((e) => rowFromPostView(e.post, did)).filter(Boolean),
        cursor: body?.cursor || null,
      };
    },
    { key: did, did, events: [POSTS_CHANGED_EVENT] },
  );
  useEffect(() => {
    setFeedPages({ rows: [], cursor: null, loadingMore: false });
  }, [fresh.data]);

  const feedRows = useMemo(() => [...(fresh.data?.rows || []), ...feedPages.rows], [fresh.data, feedPages.rows]);
  const feedCursor = feedPages.cursor ?? fresh.data?.cursor ?? null;
  const all = useMemo(() => mergePostRows(own ? archive.posts : [], feedRows, { removed }), [own, archive.posts, feedRows, removed]);
  const rows = useMemo(() => filterPostRows(all, { did, filter, query }), [all, did, filter, query]);
  const visible = rows.slice(0, shown);
  const waitingForArchive = !archive.loaded;
  const loading = waitingForArchive || (fresh.status === 'loading' && !built);

  useEffect(() => setShown(STEP), [filter, query]);

  const loadMoreFeed = async () => {
    if (!feedCursor) return;
    setFeedPages((p) => ({ ...p, loadingMore: true }));
    try {
      const body = await publicXrpc('app.bsky.feed.getAuthorFeed', { actor: did, limit: 50, filter: 'posts_with_replies', cursor: feedCursor });
      const more = (body?.feed || []).filter((e) => !e.reason).map((e) => rowFromPostView(e.post, did)).filter(Boolean);
      setFeedPages((p) => ({ rows: [...p.rows, ...more], cursor: body?.cursor && body.cursor !== feedCursor ? body.cursor : '', loadingMore: false }));
    } catch {
      setFeedPages((p) => ({ ...p, loadingMore: false }));
      setError('Older posts couldn’t be read from Bluesky. Try again.');
    }
  };

  // Every action reads the post as it is now before acting on it.
  const act = async (row, what, fn) => {
    if (working) return;
    setWorking(row.uri);
    setError(null);
    try {
      const agent = await agentFor(did);
      const post = await readPostNow(row.uri, { agent });
      await fn(post, agent);
    } catch (err) {
      if (err?.code === 'GONE') setRemoved((r) => [...r, row.uri]);
      setError(actionError(err, what));
    } finally {
      setWorking(null);
    }
  };

  const confirmDelete = async () => {
    const row = deleting;
    const agent = await agentFor(did);
    try {
      await readPostNow(row.uri, { agent });
    } catch (err) {
      if (err?.code !== 'GONE') throw new Error(actionError(err, 'The post couldn’t be read.'));
    }
    try {
      await deletePost(row.uri, { agent });
    } catch (err) {
      throw new Error(actionError(err, 'The post couldn’t be deleted.'));
    }
    setRemoved((r) => [...r, row.uri]);
    emitPostsChanged(did, { removed: [row.uri] });
    toast?.('Post deleted.');
  };

  const menuItems = (row) => {
    const offer = postRowActions(row, { did, canPost: caps.canPost, canSchedule: caps.canSchedule });
    return [
      { key: 'open', label: 'Open on Bluesky', icon: ExternalLink, onSelect: () => window.open(bskyUrlFor(row.uri), '_blank', 'noopener') },
      offer.copy && {
        key: 'copy',
        label: 'Copy into a new post',
        hint: 'Posts can’t be edited once they’re out',
        icon: SquarePen,
        onSelect: () => act(row, 'The post couldn’t be read.', (post) => composer.open({ asDid: did, text: textForComposer(post.record) })),
      },
      offer.gates && {
        key: 'gates',
        label: offer.gatesQuotesOnly ? 'Who can quote' : 'Who can reply and quote',
        onSelect: () =>
          act(row, 'Its settings couldn’t be read.', async (post, agent) => {
            const value = await readPostGates(post.uri, { agent });
            setGates({ post, value, quotesOnly: offer.gatesQuotesOnly });
          }),
      },
      offer.timer && {
        key: 'timer',
        label: 'Put on a timer',
        hint: 'Delete it after a while, or when something happens',
        onSelect: () =>
          act(row, 'The post couldn’t be read.', (post) =>
            setTimer({ uri: post.uri, cid: post.cid, text: post.record?.text || '', postedAt: post.record?.createdAt || row.at }),
          ),
      },
      offer.template && {
        key: 'template',
        label: 'Save as a template',
        onSelect: () => act(row, 'The post couldn’t be read.', (post) => setSeed(templateSeedFrom(post.record))),
      },
      offer.delete && { separator: true },
      offer.delete && { key: 'delete', label: 'Delete', tone: 'danger', onSelect: () => setDeleting(row) },
    ];
  };

  const total = all.length;

  return (
    <>
      <PostingHeader
        page="posted"
        actions={
          <Button variant="primary" onClick={() => composer.open({ asDid: did })}>
            <SquarePen size={15} aria-hidden="true" />
            New post
          </Button>
        }
      />
      <div className="page-body hub">
        <PostingPermissionNotice did={did} />
        {archive.loaded && !built && (
          <p className="callout">
            <span>
              Only your latest posts are listed. <Link to="/">Build your archive</Link> to list and search everything you’ve posted.
            </span>
          </p>
        )}
        {error && (
          <p className="callout callout--danger" role="alert">
            {error}
          </p>
        )}

        <section className="card card--flush hub-card" aria-labelledby="posted-title">
          <div className="card-head">
            <div>
              <h2 id="posted-title" className="card-title">
                {loading ? 'Your posts' : `${countPhrase(rows.length, 'post')}${rows.length !== total ? ` of ${total.toLocaleString('en-US')}` : ''}`}
              </h2>
              <p className="card-sub">Newest first. Posts can’t be edited once they’re out; copy one into a new post instead.</p>
            </div>
          </div>
          <div className="hub-toolbar">
            <label className="search hub-search">
              <Search aria-hidden="true" />
              <span className="visually-hidden">Search your posts</span>
              <input className="input" type="search" placeholder="Search your posts" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <Segmented size="sm" label="Show" options={POSTED_FILTERS} value={filter} onChange={setFilter} />
          </div>

          {loading ? (
            <RowSkeleton rows={6} actions={2} />
          ) : fresh.status === 'error' && !built && !rows.length ? (
            <div className="hub-pad">
              <LoadError message="Your posts couldn’t be read from Bluesky." onRetry={fresh.reload} />
            </div>
          ) : visible.length ? (
            <ul className="hub-list hub-list--rows">
              {visible.map((row) => {
                const isReply = isReplyRow(row, did);
                const busy = working === row.uri;
                return (
                  <li key={row.uri} className="hub-row posted-row" aria-busy={busy || undefined}>
                    <div className="hub-row-main">
                      <p className="hub-row-text">{row.text?.trim() || <span className="muted">{row.hasMedia ? 'A post with media' : 'No text'}</span>}</p>
                      <p className="hub-row-meta num">
                        <time dateTime={row.at} title={formatDateShort(row.at)}>
                          {relativeTime(row.at)}
                        </time>
                        {isReply && <span>Reply</span>}
                        {row.quoteOf && <span>Quote</span>}
                        {row.hasMedia && <span>Media</span>}
                        {row.fresh && built && <span className="badge badge--outline">Not in the archive yet</span>}
                        <span className="posted-counts">
                          <Count icon={MessageSquare} value={row.replies} label="replies" />
                          <Count icon={Repeat2} value={row.reposts} label="reposts" />
                          <Count icon={Quote} value={row.quotes} label="quotes" />
                          <Count icon={Heart} value={row.likes} label="likes" />
                        </span>
                      </p>
                    </div>
                    <div className="hub-row-actions posted-actions">
                      {caps.canPost && (
                        <>
                          <Button
                            size="sm"
                            disabled={Boolean(working)}
                            onClick={() => act(row, 'The post couldn’t be read.', (post) => composer.open({ asDid: did, reply: { uri: post.uri } }))}
                          >
                            <Reply size={14} aria-hidden="true" />
                            Reply
                          </Button>
                          <Button
                            size="sm"
                            disabled={Boolean(working)}
                            onClick={() => act(row, 'The post couldn’t be read.', (post) => composer.open({ asDid: did, quote: { uri: post.uri } }))}
                          >
                            <Quote size={14} aria-hidden="true" />
                            Quote
                          </Button>
                        </>
                      )}
                      <Menu label={`More for the post from ${formatDateShort(row.at)}`} icon items={menuItems(row)}>
                        {busy ? <span className="hub-spinner" aria-hidden="true" /> : <MoreHorizontal size={16} aria-hidden="true" />}
                      </Menu>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="hub-empty hub-pad">
              <p className="empty">
                {query || filter !== 'all' ? 'Nothing matches. Clear the search or choose All.' : 'Nothing posted yet. New post starts one.'}
              </p>
            </div>
          )}

          {!loading && (rows.length > shown || (!built && feedCursor)) && (
            <div className="hub-more-row">
              <Button
                size="sm"
                disabled={feedPages.loadingMore}
                aria-busy={feedPages.loadingMore || undefined}
                onClick={() => (rows.length > shown ? setShown((n) => n + STEP) : loadMoreFeed())}
              >
                {feedPages.loadingMore ? 'Loading…' : 'Show more'}
              </Button>
            </div>
          )}
          {!caps.canSchedule && <p className="card-caption hub-pad">Putting a post on a timer needs a long session. Settings › Account offers one.</p>}
        </section>
      </div>

      <GatesDialog state={gates} did={did} onClose={() => setGates(null)} onSaved={() => toast?.('Saved. Bluesky shows the change at once.')} />
      {timer && (
        <TimerDialog
          open
          did={did}
          post={timer}
          onClose={() => setTimer(null)}
          onArmed={() => {
            setTimer(null);
            toast?.('The timer is set. Posting › Timers shows it.');
          }}
        />
      )}
      <TemplateEditor open={Boolean(seed)} did={did} seed={seed} onClose={() => setSeed(null)} />
      <ConfirmDialog open={Boolean(deleting)} title="Delete this post?" onClose={() => setDeleting(null)} onConfirm={confirmDelete}>
        <p>It’s deleted from your repo and goes from Bluesky. Replies and quotes stay, showing it as deleted. This can’t be undone.</p>
        {deleting?.text?.trim() && <blockquote className="hub-quote">{deleting.text.trim()}</blockquote>}
      </ConfirmDialog>
    </>
  );
}

function GatesDialog({ state, did, onClose, onSaved }) {
  const { agentFor } = useAtprotoSession();
  const [value, setValue] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const open = Boolean(state);
  useEffect(() => {
    if (state) {
      setValue(state.value);
      setError('');
    }
  }, [state]);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const agent = await agentFor(did);
      await updatePostGates(agent, { uri: state.post.uri, reply: state.quotesOnly ? state.value.reply : value.reply, quotes: value.quotes });
      onSaved?.();
      onClose();
    } catch (err) {
      setError(actionError(err, 'The settings couldn’t be saved.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      title={state?.quotesOnly ? 'Who can quote this reply' : 'Who can reply and quote'}
      actions={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={busy || !value} aria-busy={busy || undefined}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      {open && value && (
        <div className="hub-confirm">
          {state.post.record?.text && <blockquote className="hub-quote">{state.post.record.text.slice(0, 200)}</blockquote>}
          {state.quotesOnly ? (
            <>
              <label className="check">
                <input type="checkbox" checked={value.quotes !== false} onChange={(e) => setValue({ ...value, quotes: e.target.checked })} />
                <span>Allow quote posts</span>
              </label>
              <p className="field-hint">Who can reply is set on the post that starts the thread.</p>
            </>
          ) : (
            <GatesEditor did={did} value={value} onChange={setValue} disabled={busy} />
          )}
          <p className="field-hint">Changing who can quote doesn’t remove quotes already made.</p>
          {error && (
            <p className="callout callout--danger" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </Dialog>
  );
}
