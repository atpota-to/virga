import { ChevronLeft, ChevronRight, RotateCcw, X } from 'lucide-react';
import Button from '../../components/Button.jsx';
import { formatDuration, missingAltCount } from './media.js';

/**
 * A post's images, up to four, in the order they'll appear: each with its
 * alt text button, a move earlier / later pair and remove. Tiles for images
 * still being prepared show as placeholders the same size. `requireAltText`
 * turns the line under the grid into a count of what's left to describe.
 */
export function ImageGrid({ images, processing = 0, requireAltText = false, disabled = false, onAlt, onMove, onRemove }) {
  const count = images.length;
  if (count === 0 && processing === 0) return null;
  const left = missingAltCount({ images });
  return (
    <div className="media-block">
      <ul className="image-grid" data-count={Math.min(4, count + processing)} aria-label="Images">
        {images.map((img, i) => (
          <li key={img.id} className="image-tile">
            {img.previewUrl ? (
              <img src={img.previewUrl} alt={img.alt ? `Image ${i + 1}: ${img.alt}` : `Image ${i + 1}, not described yet`} />
            ) : (
              <span className="image-missing">
                {img.localRef && !img.file ? 'Saved on another device. Add it again.' : `Image ${i + 1}`}
              </span>
            )}
            <button
              type="button"
              className="image-alt"
              data-done={img.alt?.trim() ? true : undefined}
              disabled={disabled}
              onClick={() => onAlt?.(img.id)}
              aria-label={img.alt?.trim() ? `Edit alt text for image ${i + 1}` : `Add alt text to image ${i + 1}`}
            >
              {img.alt?.trim() ? 'ALT' : '+ ALT'}
            </button>
            <span className="image-tools">
              {count > 1 && (
                <>
                  <button type="button" className="image-tool" disabled={disabled || i === 0} aria-label={`Move image ${i + 1} earlier`} onClick={() => onMove?.(i, i - 1)}>
                    <ChevronLeft size={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="image-tool"
                    disabled={disabled || i === count - 1}
                    aria-label={`Move image ${i + 1} later`}
                    onClick={() => onMove?.(i, i + 1)}
                  >
                    <ChevronRight size={14} aria-hidden="true" />
                  </button>
                </>
              )}
              <button type="button" className="image-tool" disabled={disabled} aria-label={`Remove image ${i + 1}`} onClick={() => onRemove?.(img.id)}>
                <X size={14} aria-hidden="true" />
              </button>
            </span>
          </li>
        ))}
        {Array.from({ length: Math.min(processing, 4 - count) }, (_, i) => (
          <li key={`p${i}`} className="image-tile image-tile--busy" aria-hidden="true" />
        ))}
      </ul>
      <p className="field-hint media-hint" aria-live="polite">
        {processing > 0
          ? `Preparing ${processing === 1 ? 'an image' : `${processing} images`}: shrinking it to fit and removing its location data…`
          : requireAltText
            ? left
              ? `${left} still to describe. Alt text is required before this goes out.`
              : 'Every image is described.'
            : left
              ? `${count} of 4 images. Alt text helps people who can’t see them.`
              : `${count} of 4 images, all described.`}
      </p>
    </div>
  );
}

const VIDEO_STATUS = {
  idle: 'Uploads when you post',
  uploading: 'Uploading…',
  processing: 'Processing…',
  ready: 'Ready',
  error: 'Upload failed',
};

/** A post's video: the player, where its upload is, alt text, and remove. */
export function VideoAttachment({ video, disabled = false, onAlt, onRemove, onRetry, onCancel }) {
  if (!video) return null;
  const busy = video.status === 'uploading' || video.status === 'processing';
  const pct = Number.isFinite(video.progress) ? Math.max(0, Math.min(100, Math.round(video.progress))) : null;
  return (
    <div className="media-block video-block">
      {video.previewUrl ? (
        <video className="video-preview" src={video.previewUrl} controls preload="metadata" />
      ) : (
        <div className="video-preview video-preview--missing">The video needs to be added again.</div>
      )}
      <div className="video-meta">
        <span className="video-status" role="status">
          {VIDEO_STATUS[video.status] || ''}
          {video.duration ? ` · ${formatDuration(video.duration)}` : ''}
          {busy && pct != null && pct > 0 ? ` · ${pct}%` : ''}
        </span>
        {busy && (
          <span className="progress video-progress" aria-hidden="true">
            <span className="progress-fill" style={pct ? { width: `${pct}%` } : undefined} data-indeterminate={pct ? undefined : true} />
          </span>
        )}
        {video.status === 'error' && video.error && <span className="field-hint is-over">{video.error}</span>}
        <span className="video-actions">
          <Button size="sm" onClick={onAlt} disabled={disabled}>
            {video.alt?.trim() ? 'Edit alt text' : 'Add alt text'}
          </Button>
          {video.status === 'error' && onRetry && (
            <Button size="sm" onClick={onRetry} disabled={disabled}>
              <RotateCcw size={14} aria-hidden="true" />
              Try again
            </Button>
          )}
          {busy && onCancel ? (
            <Button size="sm" onClick={onCancel}>
              Cancel upload
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={onRemove} disabled={disabled}>
              <X size={14} aria-hidden="true" />
              Remove
            </Button>
          )}
        </span>
      </div>
    </div>
  );
}
