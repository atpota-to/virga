// Suggestions under the handle field: accounts whose handle or name starts
// with what has been typed, from Bluesky's public search. What is typed there
// goes to that API as it is typed (after a pause), which the Privacy Policy
// says; nothing is sent for one character, for a DID or for an address.

import { APPVIEW } from '../config.js';
import { fetchWithTimeout } from '../lib/atproto.js';
import { classifySignInInput, normalizeSignInInput } from './identity.js';

export const SUGGEST_MIN_CHARS = 2;
export const SUGGEST_LIMIT = 5;
// Long enough that a handle typed at speed asks once, at the end.
export const SUGGEST_DEBOUNCE_MS = 250;
const SUGGEST_TIMEOUT_MS = 6_000;

/** What to search for, given what is in the field; null when there is nothing worth asking. */
export function suggestQuery(typed) {
  const value = normalizeSignInInput(typed);
  if (classifySignInInput(value) !== 'handle') return null;
  return value.length >= SUGGEST_MIN_CHARS ? value : null;
}

/**
 * Accounts matching `term`: each `{ did, handle, displayName, avatar }`. An
 * account whose handle no longer points at it is left out, since it can't be
 * signed in to by that name. Throws when the search can't be made.
 */
export async function searchAccounts(term, { signal, limit = SUGGEST_LIMIT, fetch = fetchWithTimeout, appview = APPVIEW } = {}) {
  const url = `${appview}/xrpc/app.bsky.actor.searchActorsTypeahead?q=${encodeURIComponent(term)}&limit=${limit}`;
  const res = await fetch(url, { signal }, SUGGEST_TIMEOUT_MS);
  if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
  const body = await res.json().catch(() => null);
  const actors = Array.isArray(body?.actors) ? body.actors : [];
  return actors
    .filter((actor) => typeof actor?.did === 'string' && typeof actor.handle === 'string' && actor.handle !== 'handle.invalid')
    .slice(0, limit)
    .map((actor) => ({
      did: actor.did,
      handle: actor.handle,
      displayName: typeof actor.displayName === 'string' ? actor.displayName.trim() || null : null,
      avatar: actor.avatar || null,
    }));
}

/**
 * Which suggestion a key moves to. `index` is the one marked now (-1 for
 * none, the field itself); the arrows go round through the field, so one
 * more press than there are suggestions is back to what was typed.
 */
export function moveActive(index, count, key) {
  if (count <= 0) return -1;
  if (key === 'ArrowDown') return index >= count - 1 ? -1 : index + 1;
  if (key === 'ArrowUp') return index < 0 ? count - 1 : index - 1;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return index;
}
