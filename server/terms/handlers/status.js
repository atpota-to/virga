// GET /api/terms/status: whether the caller's account has agreed to the
// current Terms of Service and Privacy Policy.
//
//   { success: true, version, effectiveDate, accepted, acceptedAt }
//
// Asked by a browser that holds a long session for the account and no note of
// its own that the account agreed (another device, cleared storage), so the
// agreement follows the account rather than the browser. Only an agreement
// made with a session counts here: a row a browser merely claimed opens the
// gate for nobody.

import { methodGuard, sendJson } from '../../http.js';
import { isSupabaseConfigured } from '../../supabase.js';
import { resolveUserDid } from '../../oauth/auth.js';
import { currentTerms, findAcceptance } from '../acceptance.js';
import { sendFailure, sendUnavailable } from '../respond.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET'])) return undefined;
  if (!isSupabaseConfigured()) return sendUnavailable(res);
  try {
    const auth = await resolveUserDid(req);
    if (!auth.userDid) {
      const body = { success: false, error: auth.error };
      if (auth.code) body.code = auth.code;
      return sendJson(res, auth.status || 401, body);
    }
    const found = await findAcceptance(auth.userDid);
    return sendJson(res, 200, {
      success: true,
      ...currentTerms(),
      accepted: Boolean(found),
      acceptedAt: found?.acceptedAt || null,
    });
  } catch (error) {
    return sendFailure(
      res,
      'terms/status',
      error,
      "couldn't check whether this account has agreed. please try again.",
    );
  }
}
