// Mentions: where an @handle starts and ends (findMentions, which facet
// detection uses too), the typeahead's view of the mention being typed, and
// resolving a handle to its DID through the public AppView.

import { APPVIEW } from '../../config.js';

// The characters a handle can contain; any other character ends one.
const HANDLE_CHAR = /^[a-zA-Z0-9.-]$/;
// One dot-separated segment: 1-63 characters, no hyphen at either end.
const HANDLE_SEGMENT = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
// An '@' straight after one of these is an email address, not a mention.
const EMAIL_LOCAL_END = /^[a-zA-Z0-9]$/;

const isEmailAt = (text, at) => at > 0 && EMAIL_LOCAL_END.test(text[at - 1]);
// An '@' straight after '/' is a URL path segment (/@handle/repo).
const isUrlPathAt = (text, at) => text[at - 1] === '/';

/**
 * Every '@' in text followed by a handle, as { start, end, handle, email }:
 * start is the '@', end is just past the handle. A handle runs to the first
 * character a handle can't contain, less any trailing dots (sentence
 * punctuation, never part of a handle). An '@' right after an ASCII letter or
 * digit is an email address: returned with email: true, handle unchecked,
 * and never a mention. One right after '/' is skipped, so the URL around it
 * stays linkable. Otherwise the handle must pass isValidHandle.
 * @param {string} text
 * @returns {Array<{ start: number, end: number, handle: string, email: boolean }>}
 */
export function findMentions(text) {
  const found = [];
  for (
    let start = text.indexOf('@');
    start !== -1;
    start = text.indexOf('@', start + 1)
  ) {
    let end = start + 1;
    while (end < text.length && HANDLE_CHAR.test(text[end])) end++;
    while (end > start + 1 && text[end - 1] === '.') end--;

    const handle = text.substring(start + 1, end);
    if (!handle || isUrlPathAt(text, start)) continue;

    const email = isEmailAt(text, start);
    if (email || isValidHandle(handle)) {
      found.push({ start, end, handle, email });
    }
  }
  return found;
}

/**
 * The @-mention being typed at the cursor, for typeahead suggestions.
 * @param {string} text
 * @param {number} cursorPosition
 * @returns {{ start: number, end: number, query: string, fullText: string } | null}
 */
export function detectPartialMention(text, cursorPosition) {
  let atIndex = -1;
  for (let i = cursorPosition - 1; i >= 0; i--) {
    if (text[i] === '@') {
      atIndex = i;
      break;
    } else if (!HANDLE_CHAR.test(text[i])) {
      break;
    }
  }

  if (atIndex === -1) return null;
  if (isEmailAt(text, atIndex) || isUrlPathAt(text, atIndex)) return null;

  // Skip an @ inside a URL (scheme, www. or domain-like text right before it).
  const textBeforeAt = text.substring(Math.max(0, atIndex - 20), atIndex);
  const isLikelyInUrl =
    /https?:\/\/[^\s]*$/.test(textBeforeAt) ||
    /www\.[^\s]*$/.test(textBeforeAt) ||
    /[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}[^\s]*$/.test(textBeforeAt) ||
    /:\/\/[^\s]*$/.test(textBeforeAt);

  if (isLikelyInUrl) return null;

  let endIndex = cursorPosition;
  while (endIndex < text.length && HANDLE_CHAR.test(text[endIndex])) endIndex++;

  const mentionText = text.substring(atIndex + 1, endIndex);

  if (cursorPosition >= atIndex + 1 && cursorPosition <= endIndex) {
    return {
      start: atIndex,
      end: endIndex,
      query: mentionText,
      fullText: '@' + mentionText,
    };
  }

  return null;
}

/**
 * Mentions the cursor has left, ready to validate: a mention (findMentions)
 * with the cursor outside it and outside any dots trailing it, which may be
 * the next segment still being typed.
 * @param {string} text
 * @param {number} cursorPosition
 * @returns {Array<{ start: number, end: number, handle: string, fullText: string }>}
 */
export function detectCompletedMentions(text, cursorPosition) {
  const mentions = [];

  for (const { start, end, handle, email } of findMentions(text)) {
    if (email) continue;

    const charAfter = text[end];

    // An apostrophe not yet followed by "s" is an incomplete possessive: skip.
    if (
      (charAfter === "'" || charAfter === '\u2019') &&
      text[end + 1] !== 's'
    ) {
      continue;
    }

    let typingEnd = end;
    while (text[typingEnd] === '.') typingEnd++;

    const isCursorOutside =
      cursorPosition < start || cursorPosition > typingEnd;

    if (isCursorOutside) {
      mentions.push({
        start,
        end,
        handle,
        fullText: text.substring(start, end),
      });
    }
  }

  return mentions;
}

/**
 * A mention facet for an account picked from the typeahead.
 * @param {{ did: string }} actor
 * @param {number} start - start character index
 * @param {number} end - end character index
 * @param {number[]} byteMap - from createByteMap
 */
export function createMentionFacet(actor, start, end, byteMap) {
  return {
    $type: 'app.bsky.richtext.facet',
    features: [
      {
        $type: 'app.bsky.richtext.facet#mention',
        did: actor.did,
      },
    ],
    index: {
      byteStart: byteMap[start],
      byteEnd: byteMap[end],
    },
  };
}

/**
 * Handle syntax (AT Protocol handle spec): two or more dot-separated segments
 * of 1-63 ASCII letters, digits and hyphens, no segment starting or ending
 * with a hyphen, the last not starting with a digit, at most 253 in all.
 * @param {string} handle - without the @
 * @returns {boolean}
 */
export function isValidHandle(handle) {
  if (!handle || typeof handle !== 'string' || handle.length > 253)
    return false;

  const segments = handle.split('.');
  return (
    segments.length >= 2 &&
    segments.every((segment) => HANDLE_SEGMENT.test(segment)) &&
    !/^[0-9]/.test(segments[segments.length - 1])
  );
}

/** A debounced `fn`: only the last call in each `delay` window runs. */
export function debounce(fn, delay) {
  let timeoutId;
  return function (...args) {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn.apply(this, args), delay);
  };
}

const RESOLVE_TIMEOUT_MS = 8000;
const RESOLVE_CACHE_TTL_MS = 5 * 60_000;

/**
 * A `resolveMention` (`(handle) => Promise<did|null>`) over the public
 * AppView's `com.atproto.identity.resolveHandle`. A handle the AppView says
 * doesn't exist resolves to null and is remembered for five minutes, as is a
 * DID; a network failure resolves to null and isn't remembered, so the next
 * try asks again. Concurrent asks for one handle share a request.
 *
 * @param {{ fetch?: typeof fetch, appview?: string, ttlMs?: number, timeoutMs?: number, now?: () => number }} [options]
 */
export function createMentionResolver({
  fetch: fetchImpl,
  appview = APPVIEW,
  ttlMs = RESOLVE_CACHE_TTL_MS,
  timeoutMs = RESOLVE_TIMEOUT_MS,
  now = () => Date.now(),
} = {}) {
  const answers = new Map(); // handle -> { did, at }
  const inFlight = new Map(); // handle -> Promise

  return async function resolveMention(rawHandle) {
    const handle = String(rawHandle || '')
      .replace(/^@/, '')
      .toLowerCase();
    if (!isValidHandle(handle)) return null;

    const held = answers.get(handle);
    if (held && now() - held.at < ttlMs) return held.did;
    if (inFlight.has(handle)) return inFlight.get(handle);

    const doFetch = fetchImpl || globalThis.fetch;
    // Started on the next tick, so the entry is in place before it can settle.
    const ask = Promise.resolve().then(async () => {
      const url = `${appview}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`;
      const init =
        typeof AbortSignal !== 'undefined' && AbortSignal.timeout
          ? { signal: AbortSignal.timeout(timeoutMs) }
          : {};
      try {
        const res = await doFetch(url, init);
        if (res.ok) {
          const body = await res.json().catch(() => null);
          const did =
            typeof body?.did === 'string' && body.did.startsWith('did:')
              ? body.did
              : null;
          answers.set(handle, { did, at: now() });
          return did;
        }
        // 400 is the AppView's "Unable to resolve handle": a definite no.
        if (res.status === 400) answers.set(handle, { did: null, at: now() });
        return null;
      } catch {
        return null;
      } finally {
        inFlight.delete(handle);
      }
    });
    inFlight.set(handle, ask);
    return ask;
  };
}

/** The shared resolver posting uses when the caller doesn't supply one. */
export const resolveMention = createMentionResolver();
