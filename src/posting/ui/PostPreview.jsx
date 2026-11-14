import { ExternalLink, Heart, MessageSquare, Paperclip, Quote, Repeat2 } from 'lucide-react';
import Avatar from '../../components/Avatar.jsx';
import { formatDateShort, relativeTime } from '../../lib/time.js';
import { postPreviewModel } from './postPreview.js';
import '../posting.css';

/**
 * A post, small: who wrote it, its words, what's attached, when, and its
 * counts when there are any. Takes a post view, a bare record, or both
 * (`uri` names it when only a record is known). `compact` is the one-line
 * version, for a reply's "Replying to" or a row in a list.
 */
export default function PostPreview({ view = null, record = null, uri = null, compact = false }) {
  const m = postPreviewModel({ view, record, uri }, { compact });
  const name = m.author?.displayName || (m.author?.handle ? `@${m.author.handle}` : null);
  return (
    <article className="post-preview" data-compact={compact || undefined}>
      {m.author && (
        <div className="post-preview-head">
          <Avatar src={m.author.avatar} name={name} size="sm" />
          <span className="post-preview-who">
            {name && <span className="post-preview-name">{name}</span>}
            {m.author.handle && m.author.displayName && <span className="post-preview-handle">@{m.author.handle}</span>}
          </span>
          {m.at && (
            <time className="post-preview-time" dateTime={m.at} title={formatDateShort(m.at)}>
              {relativeTime(m.at)}
            </time>
          )}
        </div>
      )}
      {m.text ? <p className="post-preview-text">{m.text}</p> : !m.embed && <p className="post-preview-text muted">No text</p>}
      {(m.embed || (!m.author && m.at) || (m.counts && !compact) || (m.url && !compact)) && (
        <div className="post-preview-foot">
          {m.embed && (
            <span className="post-preview-embed">
              <Paperclip size={13} aria-hidden="true" />
              {m.embed}
            </span>
          )}
          {!m.author && m.at && (
            <time className="post-preview-time" dateTime={m.at} title={formatDateShort(m.at)}>
              {relativeTime(m.at)}
            </time>
          )}
          {m.counts && !compact && (
            <span className="post-preview-counts num">
              <span title="Replies">
                <MessageSquare size={13} aria-hidden="true" />
                <span className="visually-hidden">Replies </span>
                {m.counts.replies.toLocaleString('en-US')}
              </span>
              <span title="Reposts">
                <Repeat2 size={13} aria-hidden="true" />
                <span className="visually-hidden">Reposts </span>
                {m.counts.reposts.toLocaleString('en-US')}
              </span>
              <span title="Quotes">
                <Quote size={13} aria-hidden="true" />
                <span className="visually-hidden">Quotes </span>
                {m.counts.quotes.toLocaleString('en-US')}
              </span>
              <span title="Likes">
                <Heart size={13} aria-hidden="true" />
                <span className="visually-hidden">Likes </span>
                {m.counts.likes.toLocaleString('en-US')}
              </span>
            </span>
          )}
          {m.url && !compact && (
            <a className="post-preview-link" href={m.url} target="_blank" rel="noreferrer">
              <ExternalLink size={13} aria-hidden="true" />
              Bluesky
            </a>
          )}
        </div>
      )}
    </article>
  );
}
