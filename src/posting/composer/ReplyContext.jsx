import { CornerDownRight, RotateCcw, X } from 'lucide-react';
import Button from '../../components/Button.jsx';
import PostPreview from '../ui/PostPreview.jsx';

/**
 * "Replying to @x" above the editor, with the post being answered. While it
 * loads, a placeholder the same shape; when it couldn't be read, why and a
 * way on. A reply can be taken off, which makes the post a new one.
 */
export default function ReplyContext({ reply, selfDid, loading = false, error = '', onRetry, onRemove, disabled = false }) {
  if (loading) {
    return (
      <section className="reply-context" aria-label="Replying to" aria-busy="true">
        <p className="reply-context-line">
          <CornerDownRight size={14} aria-hidden="true" />
          Replying to…
        </p>
        <div className="post-preview post-preview--skeleton" data-compact aria-hidden="true">
          <span className="skeleton skeleton-line skeleton-line--short" />
          <span className="skeleton skeleton-line" />
        </div>
      </section>
    );
  }
  if (error) {
    return (
      <section className="reply-context" aria-label="Replying to">
        <div className="callout callout--danger" role="alert">
          <span>{error}</span>
          <span className="callout-actions">
            {onRetry && (
              <Button size="sm" onClick={onRetry}>
                <RotateCcw size={14} aria-hidden="true" />
                Try again
              </Button>
            )}
            {onRemove && (
              <Button size="sm" variant="ghost" onClick={onRemove}>
                Post it on its own
              </Button>
            )}
          </span>
        </div>
      </section>
    );
  }
  if (!reply) return null;
  const who = reply.author?.handle ? `@${reply.author.handle}` : 'a post';
  const own = reply.author?.did && reply.author.did === selfDid;
  return (
    <section className="reply-context" aria-label={`Replying to ${who}`}>
      <div className="reply-context-head">
        <p className="reply-context-line">
          <CornerDownRight size={14} aria-hidden="true" />
          {own ? 'Continuing your thread' : `Replying to ${who}`}
        </p>
        {onRemove && (
          <Button variant="ghost" size="sm" onClick={onRemove} disabled={disabled} aria-label="Don’t reply: make this a new post">
            <X size={14} aria-hidden="true" />
            Don’t reply
          </Button>
        )}
      </div>
      <PostPreview view={reply.view || null} record={reply.view ? null : { text: reply.text || '' }} uri={reply.uri} compact />
    </section>
  );
}
