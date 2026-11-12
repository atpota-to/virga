import { Heart, MessageCircle, Quote, Repeat2 } from 'lucide-react';
import { fmtCompact } from '../lib/analytics.js';
import { formatDateShort } from '../lib/time.js';

/** The text a post row shows: its words, or what kind of post it is. */
export function postText(post) {
  return (post.text || '').trim() || (post.hasMedia ? '(media post)' : post.quoteOf ? '(quote post)' : '(no text)');
}

export function postUrl(did, post) {
  // By DID, not handle: a handle can change, and the DID is in hand before
  // the profile has loaded.
  return `https://bsky.app/profile/${did}/post/${encodeURIComponent(post.rkey)}`;
}

/**
 * One post in a list: its words (two lines at most), when, and its counts,
 * each with the same glyph the engagement filter wears. `kind` dims the
 * counts the current filter isn't about. `rank` numbers it.
 */
export default function PostRow({ post, did, kind = 'all', rank = null }) {
  return (
    <li className="post-row">
      {rank != null && <span className="post-rank num">{rank}</span>}
      <div className="post-main">
        <a className="post-text" href={postUrl(did, post)} target="_blank" rel="noopener noreferrer" title="Open on Bluesky">
          {postText(post)}
        </a>
        <span className="post-meta num">
          <span>
            {formatDateShort(post.at)}
            {post.replyTo ? ' · reply' : ''}
            {post.quoteOf ? ' · quote' : ''}
          </span>
          <Count glyph={Heart} label="likes" value={post.likes} dim={kind !== 'all' && kind !== 'like'} />
          <Count glyph={Repeat2} label="reposts" value={post.reposts} dim={kind !== 'all' && kind !== 'repost'} />
          <Count glyph={MessageCircle} label="replies" value={post.replies} dim={kind !== 'all' && kind !== 'reply'} />
          <Count glyph={Quote} label="quotes" value={post.quotes} dim={kind !== 'all' && kind !== 'quote'} />
        </span>
      </div>
    </li>
  );
}

function Count({ glyph: Glyph, label, value, dim }) {
  const n = value || 0;
  return (
    <span className={`post-count${dim ? ' is-dim' : ''}`} title={`${n.toLocaleString('en-US')} ${label}`}>
      <Glyph size={13} aria-hidden="true" />
      {fmtCompact(n)}
      <span className="visually-hidden"> {label}</span>
    </span>
  );
}
