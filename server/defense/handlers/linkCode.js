// POST /api/defense/link-code: a new code to send the moderator, shown once.
// Only its hash is kept, bound to the caller's DID (../linking.js), so it
// links this account whoever sends it, and lasts fifteen minutes.

import { methodGuard, sendJson } from '../../http.js';
import { LINK_TTL_MS, displayLinkCode, hashLinkCode, newLinkCode } from '../linking.js';
import { storeFor } from '../store.js';
import { authorize, requireStore, sendFailure, requireModerator } from '../respond.js';
import { moderatorHandle } from './link.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;
  if (!requireModerator(res) || !requireStore(res)) return;
  try {
    const owner = await authorize(req, res);
    if (!owner) return;
    const moderator = moderatorHandle();
    if (!moderator) return sendJson(res, 503, { success: false, code: 'NO_MODERATOR', error: 'Virga’s moderator isn’t set up on this server yet.' });
    const code = newLinkCode();
    const expiresAt = new Date(Date.now() + LINK_TTL_MS).toISOString();
    await storeFor(owner).linkCode(hashLinkCode(owner, code), expiresAt);
    return sendJson(res, 200, { success: true, data: { code: displayLinkCode(code), expiresAt, moderator } });
  } catch (error) {
    return sendFailure(res, 'defense/link-code', error, 'Couldn’t make a code. Try again in a moment.');
  }
}
