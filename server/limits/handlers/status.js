// GET /api/limits/status: the caller's limits and what they have in use.
//
//   { success: true, policy: 'flat', tier: null, isMember: false,
//     features: { scheduledPosts, postTimers, conditionalTimers }:
//       { isUnlimited: true, limit: null } | { isUnlimited: false, limit: N },
//     usage: { scheduledPosts, postTimers, conditionalTimers },  // null = unreadable
//     caps: { scheduledPosts, timers } }                        // the ceilings everyone has
//
// There are no tiers: `policy`, `tier` and `isMember` are constants the
// client reads.

import { methodGuard, sendJson } from '../../http.js';
import { resolveUserDid } from '../../oauth/auth.js';
import {
  featureStatus,
  featureUsage,
  maxLiveTimers,
  maxPending,
} from '../limits.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET'])) return;
  try {
    const auth = await resolveUserDid(req);
    if (!auth.userDid) {
      const body = { success: false, error: auth.error };
      if (auth.code) body.code = auth.code;
      return sendJson(res, auth.status || 401, body);
    }
    return sendJson(res, 200, {
      success: true,
      policy: 'flat',
      tier: null,
      isMember: false,
      features: featureStatus(),
      usage: await featureUsage(auth.userDid),
      caps: { scheduledPosts: maxPending(), timers: maxLiveTimers() },
    });
  } catch (error) {
    console.error('[limits/status] error:', error?.message || error);
    return sendJson(res, 500, {
      success: false,
      error: "couldn't read this account's limits. please try again.",
      code: 'INTERNAL',
    });
  }
}
