// Accounts by name, for the moderator: a handle the owner typed resolved to
// its DID, and DIDs named back by their handles. Both from Bluesky's public
// AppView, without a session. A handle is only ever shown, never stored.

import { publicXrpc, resolveHandle as publicResolveHandle } from '../../../src/posting/library/sources.js';

const DID = /^did:[a-z]+:[a-zA-Z0-9._:%-]+$/;
const PROFILE_BATCH = 25;

/**
 * `{ resolve(actor) -> did|null, handles(dids) -> Map did -> handle }`.
 * Lookups that fail leave a DID unnamed; they never throw.
 */
export function namer({ fetchImpl, resolveHandle = publicResolveHandle } = {}) {
  const known = new Map();
  return {
    async resolve(actor) {
      if (!actor) return null;
      if (DID.test(actor)) return actor;
      const did = await resolveHandle(actor, fetchImpl ? { fetch: fetchImpl } : {});
      if (did) known.set(did, actor);
      return did || null;
    },
    async handles(dids) {
      const want = [...new Set(dids.filter((d) => DID.test(d || '') && !known.has(d)))];
      for (let i = 0; i < want.length; i += PROFILE_BATCH) {
        try {
          const body = await publicXrpc('app.bsky.actor.getProfiles', { actors: want.slice(i, i + PROFILE_BATCH) }, fetchImpl ? { fetch: fetchImpl } : {});
          for (const p of body?.profiles || []) if (p?.did && p.handle && p.handle !== 'handle.invalid') known.set(p.did, p.handle);
        } catch {
          // Shown by DID instead.
        }
      }
      return known;
    },
  };
}

/** "@handle", or "@did:…" when there is no handle to show. */
export const atName = (did, handles) => `@${handles?.get(did) || did}`;
