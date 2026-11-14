// Images for posts: every image is re-encoded before it is attached, which
// shrinks it to what the PDS accepts and drops its EXIF data (camera, time and
// often the place it was taken). When re-encoding fails the image is refused,
// never uploaded as it was, because the original would carry that data out.

import { uploadBlob } from './blobs.js';

/** Up to four images per post (`app.bsky.embed.images`). */
export const MAX_IMAGES = 4;

/** What a post image is brought under: the lexicon allows 2,000,000 bytes. */
export const IMAGE_BUDGET = Object.freeze({
  maxSizeMB: 1.9,
  maxDimension: 4000,
});

/** A link card's thumbnail: the lexicon allows 1,000,000 bytes. */
export const CARD_THUMB_BUDGET = Object.freeze({
  maxSizeMB: 0.95,
  maxDimension: 1920,
});

export const IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/avif',
];

const COMPRESS_TIMEOUT_MS = 30_000;
const MB = 1024 * 1024;

/** An image that couldn't be made safe to post. */
export class ImageProcessingError extends Error {
  constructor(message, { code = 'IMAGE_PROCESSING_FAILED', cause } = {}) {
    super(message);
    this.name = 'ImageProcessingError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

/** Whether a file is something the image pipeline takes. */
export function isImageFile(file) {
  return typeof file?.type === 'string' && file.type.startsWith('image/');
}

async function defaultCompress(file, options) {
  const { default: imageCompression } =
    await import('browser-image-compression');
  return imageCompression(file, options);
}

/**
 * The pixel size of an image, from decoding it; null when it can't be
 * decoded here. A post with no aspect ratio is laid out by the reader's app;
 * a wrong one (1:1 as a fallback) would crop it.
 */
export async function decodeImageSize(file) {
  try {
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(file);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close?.();
      return size.width > 0 && size.height > 0 ? size : null;
    }
  } catch {
    // Fall through to an <img> decode, which knows more formats in some browsers.
  }
  if (
    typeof Image === 'undefined' ||
    typeof URL?.createObjectURL !== 'function'
  )
    return null;
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve) => {
      const img = new Image();
      img.onload = () =>
        resolve(
          img.naturalWidth > 0 && img.naturalHeight > 0
            ? { width: img.naturalWidth, height: img.naturalHeight }
            : null,
        );
      img.onerror = () => resolve(null);
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('Image processing timed out')),
        ms,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Re-encode an image to JPEG within `budget`, without its metadata, and read
 * its real size. A small image keeps its resolution and quality; it is
 * re-encoded only to drop the metadata.
 *
 * @param {File} file
 * @param {object} [options]
 * @param {{ maxSizeMB: number, maxDimension: number }} [options.budget]
 * @param {(file: File, options: object) => Promise<Blob>} [options.compress]
 * @param {(file: Blob) => Promise<{ width: number, height: number } | null>} [options.decode]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ file: File, mime: string, size: number, aspectRatio?: { width: number, height: number } }>}
 * @throws {ImageProcessingError}
 */
export async function prepareImage(file, options = {}) {
  const {
    budget = IMAGE_BUDGET,
    compress = defaultCompress,
    decode = decodeImageSize,
    timeoutMs = COMPRESS_TIMEOUT_MS,
  } = options;
  if (!isImageFile(file)) {
    throw new ImageProcessingError('That file isn’t an image.', {
      code: 'NOT_AN_IMAGE',
    });
  }

  const over = file.size > budget.maxSizeMB * MB;
  let output;
  try {
    output = await withTimeout(
      compress(file, {
        maxSizeMB: over ? budget.maxSizeMB : Math.max(file.size / MB, 0.01),
        maxWidthOrHeight: budget.maxDimension,
        useWebWorker: true,
        fileType: 'image/jpeg',
        initialQuality: over ? 0.8 : 1.0,
        alwaysKeepResolution: !over,
        preserveExif: false,
      }),
      timeoutMs,
    );
  } catch (cause) {
    throw new ImageProcessingError(
      'This image couldn’t be prepared for posting, so it wasn’t added. Try saving it as a JPEG or PNG first.',
      { cause },
    );
  }
  if (!output || !output.size) {
    throw new ImageProcessingError(
      'This image couldn’t be prepared for posting, so it wasn’t added.',
    );
  }
  if (output.size > budget.maxSizeMB * MB) {
    throw new ImageProcessingError(
      'This image is still too large after shrinking it, so it wasn’t added.',
      {
        code: 'IMAGE_TOO_LARGE',
      },
    );
  }

  const name = String(file.name || 'image').replace(/\.[^.]+$/, '') + '.jpg';
  const processed =
    typeof File !== 'undefined'
      ? new File([output], name, { type: 'image/jpeg' })
      : output;
  const size = await decode(processed).catch(() => null);
  const result = { file: processed, mime: 'image/jpeg', size: processed.size };
  if (size?.width > 0 && size?.height > 0) {
    result.aspectRatio = {
      width: Math.round(size.width),
      height: Math.round(size.height),
    };
  }
  return result;
}

/**
 * Upload a prepared image as the write account.
 * @param {{ did: string, agent: object }} target
 * @param {{ file: Blob, mime?: string }} image
 * @param {{ signal?: AbortSignal }} [options]
 */
export function uploadImage(target, image, { signal } = {}) {
  return uploadBlob(target, image.file, {
    encoding: image.mime || image.file?.type || 'image/jpeg',
    signal,
  });
}
