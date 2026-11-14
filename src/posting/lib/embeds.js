// The embed a post carries, built from the composer's attachments over blobs
// already uploaded as the write account. A post has one record slot (a quoted
// post, a feed, a list or a starter pack) and one media slot; when both are
// filled they go out together as recordWithMedia. Media precedence is video,
// then images, then a link card: the composer keeps only one, and this order
// decides if a loaded draft somehow holds more.
// Key order of the objects below is part of the output; keep it stable.

import { normalizeAssociatedRefs } from './linkCard.js';

export const buildRecordEmbed = ({ uri, cid }) => ({
  $type: 'app.bsky.embed.record',
  record: { uri, cid },
});

/** Wrap a record embed with media if there is any. */
export const combineRecordWithMedia = (recordEmbed, mediaEmbed) =>
  mediaEmbed
    ? {
        $type: 'app.bsky.embed.recordWithMedia',
        record: recordEmbed,
        media: mediaEmbed,
      }
    : recordEmbed;

const ratio = (aspectRatio) =>
  aspectRatio && aspectRatio.width > 0 && aspectRatio.height > 0
    ? {
        width: Math.round(aspectRatio.width),
        height: Math.round(aspectRatio.height),
      }
    : null;

/**
 * A video embed. `aspectRatio` only with both sides known: a reader's app
 * lays out a video without one, and crops one that is wrong.
 */
export const buildVideoEmbed = ({ blob, alt, aspectRatio }) => {
  const embed = { $type: 'app.bsky.embed.video', video: blob, alt: alt || '' };
  const r = ratio(aspectRatio);
  if (r) embed.aspectRatio = r;
  return embed;
};

/** One image of an images embed. Doesn't upload; `blob` is already a blob. */
export const buildImageRecord = ({ alt, blob, aspectRatio }) => {
  const rec = { alt: alt || '', image: blob };
  const r = ratio(aspectRatio);
  if (r) rec.aspectRatio = r;
  return rec;
};

export const buildImagesEmbed = (imageRecords) => ({
  $type: 'app.bsky.embed.images',
  images: imageRecords,
});

/**
 * A link card embed. `thumbBlob` is the uploaded thumbnail, or null for a
 * card without one.
 */
export function buildExternalEmbed(card, thumbBlob = null) {
  const external = {
    uri: card.url,
    title: card.title || '',
    description: card.description || '',
  };
  if (thumbBlob) external.thumb = thumbBlob;
  // Kept even on a retitled card: the refs describe the page.
  const refs = normalizeAssociatedRefs(card.associatedRefs);
  if (refs) external.associatedRefs = refs;
  return { $type: 'app.bsky.embed.external', external };
}

/**
 * A post's embed, or undefined for none.
 *
 * @param {object} post - a PostDraft
 * @param {object} [blobs] - what was uploaded for it as the write account:
 *   `{ images: blob[] (in the post's image order), video: blob|null, cardThumb: blob|null }`
 * @returns {object | undefined}
 */
export function buildPostEmbed(post, blobs = {}) {
  let media = null;
  if (post?.video && blobs.video) {
    media = buildVideoEmbed({
      blob: blobs.video,
      alt: post.video.alt,
      aspectRatio: post.video.aspectRatio,
    });
  } else if (post?.images?.length > 0 && blobs.images?.length > 0) {
    media = buildImagesEmbed(
      post.images.map((image, i) =>
        buildImageRecord({
          alt: image.alt,
          blob: blobs.images[i],
          aspectRatio: image.aspectRatio,
        }),
      ),
    );
  } else if (post?.card?.url) {
    media = buildExternalEmbed(post.card, blobs.cardThumb || null);
  }

  if (post?.record?.uri && post.record.cid) {
    return combineRecordWithMedia(buildRecordEmbed(post.record), media);
  }
  return media || undefined;
}

/**
 * Rewrite app.bsky.embed.gallery (and its #view) as the images shape, so one
 * renderer handles both; also the media side of recordWithMedia. Other
 * embeds pass through.
 */
export function normalizeImageEmbed(embed) {
  if (!embed || !embed.$type) return embed;

  if (embed.$type === 'app.bsky.embed.gallery#view') {
    return {
      ...embed,
      $type: 'app.bsky.embed.images#view',
      images: (embed.items || []).map((item) => ({
        thumb: item.thumbnail,
        fullsize: item.fullsize,
        alt: item.alt || '',
        aspectRatio: item.aspectRatio,
      })),
    };
  }

  if (embed.$type === 'app.bsky.embed.gallery') {
    return {
      ...embed,
      $type: 'app.bsky.embed.images',
      images: (embed.items || []).map((item) => ({
        image: item.image,
        alt: item.alt || '',
        aspectRatio: item.aspectRatio,
      })),
    };
  }

  if (
    (embed.$type === 'app.bsky.embed.recordWithMedia#view' ||
      embed.$type === 'app.bsky.embed.recordWithMedia') &&
    (embed.media?.$type === 'app.bsky.embed.gallery#view' ||
      embed.media?.$type === 'app.bsky.embed.gallery')
  ) {
    return { ...embed, media: normalizeImageEmbed(embed.media) };
  }

  return embed;
}
