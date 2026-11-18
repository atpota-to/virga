// GET /api/defense/link: the caller's link to the moderator: whether it is
// linked, whether a code is waiting, and the list "block @someone" adds to.
// The moderator's handle comes with it, for the page to say who to DM.

import { methodGuard, sendJson } from '../../http.js';
import { storeFor } from '../store.js';
import { authorize, requireStore, sendFailure, requireModerator } from '../respond.js';

/**
 * The moderator's handle, as Settings names it, or null when there is none.
 * Only the handle is set on Vercel; the account's password is the droplet's.
 */
export function moderatorHandle(env = process.env) {
  const h = String(env.DEFENSE_MODERATOR_HANDLE || '').replace(/^@/, '').trim();
  return /^[a-z0-9.-]+\.[a-z]+$/i.test(h) ? h.toLowerCase() : null;
}

export const publicLink = (link, env = process.env) => ({
  moderator: moderatorHandle(env),
  linked: Boolean(link?.linked_at),
  linkedAt: link?.linked_at ?? null,
  codeExpiresAt: link?.code_expires_at && Date.parse(link.code_expires_at) > Date.now() ? link.code_expires_at : null,
  listId: link?.list_id ?? null,
});

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET'])) return;
  if (!requireModerator(res) || !requireStore(res)) return;
  try {
    const owner = await authorize(req, res);
    if (!owner) return;
    return sendJson(res, 200, { success: true, data: publicLink(await storeFor(owner).link()) });
  } catch (error) {
    return sendFailure(res, 'defense/link', error, 'Couldn’t read the moderator’s link. Try again in a moment.');
  }
}
