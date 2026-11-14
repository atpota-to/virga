// Which files a pick, a paste or a drop brings into a post, and what is left
// out and why. The pipeline itself (compression, uploads) is lib/images.js
// and lib/video.js; this only sorts.

import { MAX_IMAGES } from '../lib/composerModel.js';
import { VIDEO_SUPPORTED_MIME_TYPES } from '../lib/video.js';

export const IMAGE_INPUT_ACCEPT =
  'image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,image/avif';

const isImage = (f) =>
  typeof f?.type === 'string' && f.type.startsWith('image/');
const isVideo = (f) =>
  typeof f?.type === 'string' && f.type.startsWith('video/');

/**
 * The image files a paste should attach. Empty means leave the paste alone:
 * a copy often puts text, HTML and a picture of the selection on the
 * clipboard at once (phones especially), and any text means a text paste.
 * Call preventDefault only when files come back.
 */
export function pastedImageFiles(
  clipboardData,
  { now = () => new Date() } = {},
) {
  if (!clipboardData?.items) return [];
  const pastedText = clipboardData.getData?.('text/plain');
  if (pastedText && pastedText.trim()) return [];
  const files = [];
  for (const item of Array.from(clipboardData.items)) {
    if (item?.kind !== 'file' || !item.type?.startsWith('image/')) continue;
    const file = item.getAsFile?.();
    if (!file) continue;
    // Clipboard images arrive nameless; give them something legible.
    const stamp = now().toISOString().replace(/[:.]/g, '-');
    const extension = file.type.split('/')[1] || 'png';
    files.push(
      typeof File === 'function'
        ? new File([file], `pasted-image-${stamp}.${extension}`, {
            type: file.type,
            lastModified: now().getTime(),
          })
        : file,
    );
  }
  return files;
}

/**
 * What a pick or a drop adds to a post: `{ images, video, notes }`. A post
 * holds up to four images or one video. A video is taken only when the post
 * holds no images and it's the only video offered; `allowVideo: false` (a
 * drop) refuses video. `notes` are sentences for what was left out.
 *
 * @param {File[]} files
 * @param {{ imageCount?: number, hasVideo?: boolean, allowVideo?: boolean }} post
 */
export function sortIncomingFiles(
  files,
  { imageCount = 0, hasVideo = false, allowVideo = true } = {},
) {
  const list = Array.from(files || []).filter(Boolean);
  const images = list.filter(isImage);
  const videos = list.filter(isVideo);
  const other = list.length - images.length - videos.length;
  const notes = [];

  if (videos.length && allowVideo && images.length === 0 && imageCount === 0) {
    const video = videos[0];
    if (videos.length > 1)
      notes.push('A post holds one video, so only the first was added.');
    if (!VIDEO_SUPPORTED_MIME_TYPES.includes(video.type)) {
      return {
        images: [],
        video: null,
        notes: ['Videos can be MP4, MOV, WebM or MPEG.'],
      };
    }
    if (other)
      notes.push(
        other === 1
          ? 'One file wasn’t an image or a video.'
          : `${other} files weren’t images or videos.`,
      );
    return { images: [], video, notes };
  }
  if (videos.length) {
    notes.push(
      !allowVideo
        ? 'Drop images here; add a video with the video button.'
        : 'A post holds images or a video, not both, so the video wasn’t added.',
    );
  }

  const room = hasVideo ? 0 : Math.max(0, MAX_IMAGES - imageCount);
  if (images.length && hasVideo) {
    notes.push(
      'This post has a video, so images can’t be added. Remove the video first.',
    );
  } else if (images.length > room) {
    notes.push(
      room === 0
        ? `A post holds up to ${MAX_IMAGES} images, and this one is full.`
        : `A post holds up to ${MAX_IMAGES} images, so only ${room} more ${room === 1 ? 'was' : 'were'} added.`,
    );
  }
  if (other)
    notes.push(
      other === 1
        ? 'One file wasn’t an image.'
        : `${other} files weren’t images.`,
    );
  return { images: images.slice(0, room), video: null, notes };
}

/** "1:23" for a duration in seconds. */
export function formatDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** How many of a post's images still need alt text. */
export function missingAltCount(post) {
  return (post?.images || []).filter((img) => !img.alt?.trim()).length;
}
