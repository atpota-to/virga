import { useId } from 'react';
import { ArrowDown, ArrowUp, BookOpen, Film, ImagePlus, Scissors, Trash2 } from 'lucide-react';
import Button from '../../components/Button.jsx';
import PostEditor from './PostEditor.jsx';
import { ImageGrid, VideoAttachment } from './MediaGrid.jsx';
import { LinkCard, RecordCard } from './EmbedCards.jsx';
import { countComposerGraphemes } from '../lib/inlineLinks.js';
import { MAX_POST_GRAPHEMES } from '../lib/composerModel.js';

/**
 * One post of what's being written (a single post is a thread of one): its
 * text, what's attached, its own count, and in a thread its place and the
 * ways to move or remove it.
 */
export default function PostBlock({
  post,
  index,
  total,
  editorRef,
  api,
  disabled = false,
  autoFocus = false,
  placeholder,
  templates,
  templatesStatus,
  templateUsage,
  replying = false,
  parentText = '',
  processing = 0,
  cardLoading = false,
  recordLoading = false,
  problems = [],
  requireAltText = false,
  offerSplit = false,
}) {
  const id = useId();
  const count = countComposerGraphemes((post.text || '').trim());
  const over = count > MAX_POST_GRAPHEMES;
  const thread = total > 1;
  const hasMedia = post.images.length > 0 || !!post.video;
  const countId = `${id}-count`;
  const label = thread ? `Post ${index + 1} of ${total}` : replying ? 'Your reply' : 'Your post';

  return (
    <article className="post-block" data-thread={thread || undefined} aria-label={label}>
      {thread && (
        <div className="post-block-head">
          <span className="post-block-number">
            {index + 1} of {total}
          </span>
          <span className="post-block-tools">
            <Button variant="ghost" size="sm" icon aria-label={`Move post ${index + 1} up`} title="Move up" disabled={disabled || index === 0} onClick={() => api.movePost(index, index - 1)}>
              <ArrowUp size={15} aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon
              aria-label={`Move post ${index + 1} down`}
              title="Move down"
              disabled={disabled || index === total - 1}
              onClick={() => api.movePost(index, index + 1)}
            >
              <ArrowDown size={15} aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="sm" icon aria-label={`Remove post ${index + 1}`} title="Remove this post" disabled={disabled} onClick={() => api.removePost(index)}>
              <Trash2 size={15} aria-hidden="true" />
            </Button>
          </span>
        </div>
      )}

      <PostEditor
        ref={editorRef}
        value={post.text}
        onChange={(text) => api.setText(index, text)}
        label={label}
        placeholder={placeholder}
        describedBy={countId}
        autoFocus={autoFocus}
        disabled={disabled}
        templates={templates}
        templatesStatus={templatesStatus}
        templateUsage={templateUsage}
        replying={replying}
        parentText={parentText}
        onTemplate={(template, range) => api.applyTemplate(index, template, range)}
        onOpenLibrary={(range) => api.openLibrary(index, range)}
        onPasteFiles={(clipboard) => api.pasteFiles(index, clipboard)}
        onDetected={(detection) => api.detected(index, post.id, detection)}
        onFocus={() => api.focus(index)}
      />

      {offerSplit && over && (
        <div className="callout split-offer" role="status">
          <Scissors size={16} aria-hidden="true" />
          <span>
            This is {count - MAX_POST_GRAPHEMES} characters over the {MAX_POST_GRAPHEMES} limit. Split it into a thread?
          </span>
          <span className="callout-actions">
            <Button size="sm" variant="primary" onClick={() => api.split(index)} disabled={disabled}>
              Split into posts
            </Button>
            <Button size="sm" variant="ghost" onClick={() => api.dismissSplit()}>
              Not now
            </Button>
          </span>
        </div>
      )}

      <ImageGrid
        images={post.images}
        processing={processing}
        requireAltText={requireAltText}
        disabled={disabled}
        onAlt={(imageId) => api.altImage(index, imageId)}
        onMove={(from, to) => api.moveImage(index, from, to)}
        onRemove={(imageId) => api.removeImage(index, imageId)}
      />
      <VideoAttachment
        video={post.video}
        disabled={disabled}
        onAlt={() => api.altVideo(index)}
        onRemove={() => api.removeVideo(index)}
        onRetry={() => api.retryVideo(index)}
        onCancel={() => api.cancelVideo(index)}
      />
      {recordLoading && !post.record && (
        <div className="embed-card embed-card--record is-loading" role="status" aria-label="Reading what you linked">
          <span className="embed-icon skeleton" />
          <span className="embed-text">
            <span className="skeleton skeleton-line" />
            <span className="skeleton skeleton-line skeleton-line--short" />
          </span>
        </div>
      )}
      <RecordCard record={post.record} disabled={disabled} onRemove={() => api.removeRecord(index)} />
      {!hasMedia && (
        <LinkCard card={post.card} loading={cardLoading && !post.card} disabled={disabled} onEdit={() => api.editCard(index)} onRemove={() => api.removeCard(index)} />
      )}

      {problems.length > 0 && (
        <ul className="post-problems" role="status">
          {problems.map((p) => (
            <li key={p.code}>{p.message}</li>
          ))}
        </ul>
      )}

      <div className="post-block-foot">
        <span className="post-block-actions">
          <Button
            variant="ghost"
            size="sm"
            icon
            aria-label="Add images"
            title="Add images"
            disabled={disabled || !!post.video || post.images.length >= 4}
            onClick={() => api.pickImages(index)}
          >
            <ImagePlus size={17} aria-hidden="true" />
          </Button>
          <Button variant="ghost" size="sm" icon aria-label="Add a video" title="Add a video" disabled={disabled || hasMedia} onClick={() => api.pickVideo(index)}>
            <Film size={17} aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon
            aria-label="Quote or attach from your library"
            title="Quote or attach from your library"
            disabled={disabled}
            onClick={() => api.openLibrary(index, null)}
          >
            <BookOpen size={17} aria-hidden="true" />
          </Button>
        </span>
        <span id={countId} className={`field-hint num post-count${over ? ' is-over' : ''}`} aria-live="polite">
          {over ? `${count} of ${MAX_POST_GRAPHEMES}, ${count - MAX_POST_GRAPHEMES} over` : `${count} of ${MAX_POST_GRAPHEMES}`}
        </span>
      </div>
    </article>
  );
}
