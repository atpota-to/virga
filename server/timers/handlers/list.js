// GET /api/self-destruct/list[?history=1]
//
// The caller's live timers (armed / checking), soonest first, always first and
// never crowded out (see listSelfDestructs); then the ones that gave up
// (failed), most recent first; then rules that fired without deleting in the
// last week ('acted': the post is up with a gate on it), newest first.
// `history=1` returns every settled row instead of the recent acted ones:
// acted, deleted, kept, newest first. The DID comes from the session token.

import { methodGuard, sendJson } from '../../http.js';
import { resolveUserDid } from '../../oauth/auth.js';
import { listSelfDestructs } from '../selfDestruct.js';
import { timerListShape } from '../shape.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET'])) return;

  try {
    const auth = await resolveUserDid(req);
    if (!auth.userDid) {
      return sendJson(res, auth.status, { success: false, error: auth.error, ...(auth.code ? { code: auth.code } : {}) });
    }

    const history = req.query?.history;
    const includeResolved = history === '1' || history === 'true';
    const rows = await listSelfDestructs(auth.userDid, { includeResolved });
    return sendJson(res, 200, { success: true, data: rows.map(timerListShape) });
  } catch (error) {
    if (error.code === 'UNAVAILABLE') {
      // Nobody can have a timer on a database that cannot hold one, so an
      // empty list is the truthful answer, and `unavailable` tells the page to
      // hide the feature rather than show an error.
      return sendJson(res, 200, { success: true, data: [], unavailable: true });
    }
    console.error('[self-destruct/list] failed:', error?.message || error);
    return sendJson(res, 500, {
      success: false,
      error: "couldn't load your post timers. please try again.",
      code: 'INTERNAL',
    });
  }
}
