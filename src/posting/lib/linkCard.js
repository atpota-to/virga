// Link cards: the preview a post shows for an external link. The page's
// title, description and image come from Bluesky's card service (cardyb); the
// image is fetched, shrunk under the thumbnail limit and uploaded as the write
// account when the post is published.

import { CARD_THUMB_BUDGET, prepareImage } from './images.js';
import { uploadBlob } from './blobs.js';
import { safeExternalUrl } from './richText.js';

export const CARDYB_ORIGIN = 'https://cardyb.bsky.app';

export const CARD_TITLE_MAX = 200;
export const CARD_DESCRIPTION_MAX = 500;

const CARD_TIMEOUT_MS = 10_000;

// getEmbedExternalView resolves at most four AT-URIs per card.
export const MAX_ASSOCIATED_REFS = 4;

/**
 * `external.associatedRefs`: strongRefs to the records behind a linked page
 * (standard.site documents and publications), which the AppView hydrates
 * into a richer card. Coerced to `at://` URIs with a CID, deduped, capped;
 * null when there are none.
 * @param {unknown} raw
 * @returns {Array<{ $type: string, uri: string, cid: string }> | null}
 */
export function normalizeAssociatedRefs(raw) {
  if (!Array.isArray(raw)) return null;
  const refs = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const uri = typeof item.uri === 'string' ? item.uri.trim() : '';
    const cid = typeof item.cid === 'string' ? item.cid.trim() : '';
    if (!uri.startsWith('at://') || !cid) continue;
    if (refs.some((ref) => ref.uri === uri)) continue;
    refs.push({ $type: 'com.atproto.repo.strongRef', uri, cid });
    if (refs.length === MAX_ASSOCIATED_REFS) break;
  }
  return refs.length > 0 ? refs : null;
}

function timeoutSignal(signal, ms) {
  if (
    typeof AbortSignal === 'undefined' ||
    typeof AbortSignal.timeout !== 'function'
  )
    return signal;
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  return typeof AbortSignal.any === 'function'
    ? AbortSignal.any([signal, timeout])
    : signal;
}

/**
 * The card for `url`, in the composer's card shape
 * (`{ url, title, description, thumb, associatedRefs? }`, `thumb` the image
 * URL or null), or null when the service has nothing or can't be reached.
 * `url` stays the address the writer gave, not the one the service settled on.
 *
 * @param {string} url
 * @param {{ fetch?: typeof fetch, signal?: AbortSignal }} [options]
 */
export async function fetchLinkCard(url, { fetch: fetchImpl, signal } = {}) {
  const safe = safeExternalUrl(url);
  if (!safe) return null;
  const doFetch = fetchImpl || globalThis.fetch;
  try {
    const res = await doFetch(
      `${CARDYB_ORIGIN}/v1/extract?url=${encodeURIComponent(url)}`,
      {
        signal: timeoutSignal(signal, CARD_TIMEOUT_MS),
      },
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || data.error) return null;
    const card = {
      url,
      title: String(data.title || '').slice(0, CARD_TITLE_MAX),
      description: String(data.description || '').slice(
        0,
        CARD_DESCRIPTION_MAX,
      ),
      thumb: safeExternalUrl(data.image) || null,
    };
    const refs = normalizeAssociatedRefs(data.associated_refs);
    if (refs) card.associatedRefs = refs;
    return card;
  } catch (err) {
    if (signal?.aborted) throw err;
    return null;
  }
}

/**
 * Fetch a card's image and shrink it under the thumbnail limit (0.95 MB,
 * 1920 px), without its metadata.
 * @param {string} imageUrl
 * @param {{ fetch?: typeof fetch, signal?: AbortSignal, compress?: Function, decode?: Function }} [options]
 * @returns {Promise<File>}
 */
export async function fetchCardThumbnail(
  imageUrl,
  { fetch: fetchImpl, signal, compress, decode } = {},
) {
  const safe = safeExternalUrl(imageUrl);
  if (!safe) throw new Error('The card image address isn’t a web address.');
  const doFetch = fetchImpl || globalThis.fetch;
  const res = await doFetch(safe, {
    signal: timeoutSignal(signal, CARD_TIMEOUT_MS),
  });
  if (!res.ok)
    throw new Error(`The card image couldn’t be fetched (${res.status}).`);
  const blob = await res.blob();
  const type =
    blob.type && blob.type.startsWith('image/') ? blob.type : 'image/jpeg';
  const file = new File([blob], 'thumbnail', { type });
  const prepared = await prepareImage(file, {
    budget: CARD_THUMB_BUDGET,
    compress,
    decode,
  });
  return prepared.file;
}

/**
 * The thumbnail blob for a card, uploaded as the write account: the writer's
 * own image (`thumbFile`) or the page's (`thumb`), both shrunk to the
 * thumbnail limit. A blob already uploaded as this account is reused. Null
 * when there is no image or it couldn't be fetched or uploaded: the card
 * goes out without one rather than holding the post back.
 *
 * @param {{ did: string, agent: object }} target
 * @param {object} card
 * @param {{ fetch?: typeof fetch, signal?: AbortSignal, compress?: Function, decode?: Function }} [options]
 * @returns {Promise<object | null>}
 */
export async function uploadCardThumb(target, card, options = {}) {
  if (!card) return null;
  if (card.thumbBlob && card.thumbBlobDid === target.did) return card.thumbBlob;
  const { signal } = options;
  try {
    let file;
    if (card.thumbFile) {
      file = (
        await prepareImage(card.thumbFile, {
          budget: CARD_THUMB_BUDGET,
          ...options,
        })
      ).file;
    } else if (card.thumb) {
      file = await fetchCardThumbnail(card.thumb, options);
    } else {
      return null;
    }
    return await uploadBlob(target, file, {
      encoding: file.type || 'image/jpeg',
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    return null;
  }
}
