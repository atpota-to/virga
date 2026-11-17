import { Heart, MessageCircle, Quote, Repeat2 } from 'lucide-react';
import { engagementOf, fmtCompact } from '../lib/analytics.js';
import { formatDateShort, relativeTime } from '../lib/time.js';
import { activeLocale } from '../lib/locale.js';

/** The text a post row shows: its words, or what kind of post it is. */
export function postText(post) {
  return (post.text || '').trim() || (post.hasMedia ? '(media post)' : post.quoteOf ? '(quote post)' : '(no text)');
}

export function postUrl(did, post) {
  // By DID, not handle: a handle can change, and the DID is in hand before
  // the profile has loaded.
  return `https://bsky.app/profile/${did}/post/${encodeURIComponent(post.rkey)}`;
}

const WEEK_MS = 7 * 86_400_000;

/** A post's counts, in the order every list gives them. */
const COUNTS = [
  { key: 'likes', kind: 'like', glyph: Heart, one: 'like', many: 'likes' },
  { key: 'reposts', kind: 'repost', glyph: Repeat2, one: 'repost', many: 'reposts' },
  { key: 'replies', kind: 'reply', glyph: MessageCircle, one: 'reply', many: 'replies' },
  { key: 'quotes', kind: 'quote', glyph: Quote, one: 'quote', many: 'quotes' },
];

function countWords(n, { one, many }) {
  return `${n.toLocaleString(activeLocale())} ${n === 1 ? one : many}`;
}

/**
 * When a post went out, as its line says it: "2d ago" under a week, and
 * after that its day ("Oct 23"), with the year only when it isn't this one,
 * as a draft's "Edited Nov 12" is. Every list of posts says it this way.
 */
export function postWhen(at, now = Date.now()) {
  const t = typeof at === 'number' ? at : Date.parse(at);
  if (!Number.isFinite(t)) return '';
  if (now - t < WEEK_MS) return relativeTime(t, now);
  const day = new Date(t);
  const opts = { month: 'short', day: 'numeric' };
  if (day.getFullYear() !== new Date(now).getFullYear()) opts.year = 'numeric';
  return day.toLocaleDateString(activeLocale(), opts);
}

/**
 * The line under a post, wherever it is listed: when, what kind of post it
 * is if it isn't a plain one, and its counts, as a .meta line ("2d ago ·
 * reply · ♥ 532 ⟲ 108"). A week old or more, the day (postWhen); the full
 * date is in the tooltip either way. Only counts above zero are shown, each with the
 * glyph the engagement filter wears. `kind` dims the counts the current
 * filter isn't about. `breakdown={false}` leaves the counts out, for a row
 * that shows its total on its own (a dashboard card's top posts). `now` is
 * when "2d ago" is counted from.
 */
export function PostMeta({ post, kind = 'all', breakdown = true, now = Date.now(), className = '' }) {
  const counts = breakdown ? COUNTS.filter((c) => (post[c.key] || 0) > 0) : [];
  return (
    <span className={`meta ${className}`.trim()}>
      <span title={formatDateShort(post.at)}>{postWhen(post.at, now)}</span>
      {post.replyTo && <span>reply</span>}
      {post.quoteOf && <span>quote</span>}
      {counts.length > 0 && (
        <span className="meta-group num">
          {counts.map((c) => {
            const n = post[c.key];
            const Glyph = c.glyph;
            return (
              <span key={c.key} className={`post-count${kind !== 'all' && kind !== c.kind ? ' is-dim' : ''}`} title={countWords(n, c)}>
                <Glyph size={13} aria-hidden="true" />
                {fmtCompact(n)}
                <span className="visually-hidden"> {n === 1 ? c.one : c.many}</span>
              </span>
            );
          })}
        </span>
      )}
    </span>
  );
}

/**
 * One post in a list: its words (two lines at most), and PostMeta under
 * them. `kind` dims the counts the current filter isn't about. `rank`
 * numbers it. `breakdown={false}` puts its total (of the kind the list is
 * ranked by) at the right of the row instead of the four counts.
 */
export default function PostRow({ post, did, kind = 'all', rank = null, breakdown = true }) {
  const total = breakdown ? null : engagementOf(post, kind);
  return (
    <li className="post-row">
      {rank != null && <span className="post-rank num">{rank}</span>}
      <div className="post-main">
        <a className="post-text" href={postUrl(did, post)} target="_blank" rel="noopener noreferrer" title="Open on Bluesky">
          {postText(post)}
        </a>
        <PostMeta post={post} kind={kind} breakdown={breakdown} />
      </div>
      {total != null && (
        <span
          className="person-value num"
          title={COUNTS.filter((c) => kind === 'all' || kind === c.kind)
            .map((c) => countWords(post[c.key] || 0, c))
            .join(', ')}
        >
          {total.toLocaleString(activeLocale())}
        </span>
      )}
    </li>
  );
}
