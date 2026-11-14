// POST /api/terms/accept: record that an account agreed to the current Terms
// of Service and Privacy Policy.
//
//   body  { version, did? }
//   200   with a session  { success: true, version, effectiveDate, identity:
//                           'session', acceptedAt, created }
//         without one     { success: true, version, effectiveDate, identity:
//                           'claimed' }
//
// `version` is the one the page showed. If the documents have moved on since
// that page loaded, nothing is written: 409 TERMS_VERSION_MISMATCH with the
// current version, and the page asks again over the current text.
//
// With a session token the account is the session's, whatever the body says
// (identity 'session'). A token that doesn't hold is a 401; it is never
// quietly recorded as a claim instead.
//
// Without a token (an account on a browser session, which Virga's server has
// no part in) the account is the `did` in the body, taken on the browser's
// word and marked so (identity 'claimed'). That is an unauthenticated write,
// so it takes a DID only in its real shape, refuses a page on another site,
// is bounded per address in the database as well as per minute here, and can
// be turned off with TERMS_ACCEPT_CLAIMED=false. Its answer is the same
// whether or not the account had been reported before, and carries nothing
// from the row: the caller could be anyone, and whether and when an account
// agreed is not theirs to learn.
//
// Both kinds are limited per minute: by account with a session, by address
// without one.

import {
  callerAddress,
  callerUserAgent,
  isForeignOrigin,
  methodGuard,
  readJson,
  sendJson,
} from '../../http.js';
import { envInt } from '../../env.js';
import { createRateLimiter } from '../../rateLimit.js';
import { isSupabaseConfigured } from '../../supabase.js';
import { resolveUserDid } from '../../oauth/auth.js';
import {
  IDENTITY,
  currentTerms,
  isAccountDid,
  recordAcceptance,
  recordClaim,
} from '../acceptance.js';
import { sendFailure, sendUnavailable } from '../respond.js';

// A burst guard, per instance: agreeing happens once per account per version,
// so anything above a handful a minute isn't a person.
const ACCEPT_LIMIT_PER_MINUTE = 10;
const limiters = new Map();
function acceptLimiter() {
  const limit = envInt(
    process.env,
    'TERMS_ACCEPT_RATE_LIMIT',
    ACCEPT_LIMIT_PER_MINUTE,
  );
  if (!limiters.has(limit))
    limiters.set(limit, createRateLimiter({ limit, windowMs: 60 * 1000 }));
  return limiters.get(limit);
}

/** Tests only: forget every burst window. */
export function resetAcceptLimiterForTests() {
  limiters.clear();
}

// New claims taken from one address in a day, counted in the database so it
// holds across instances. A household or an office shares an address; nobody
// signs in fifty accounts from one in a day.
const CLAIMS_PER_ADDRESS_PER_DAY = 50;

/** Whether an account on a browser session may be recorded on its own word (default yes). */
function claimsAllowed(env = process.env) {
  return String(env.TERMS_ACCEPT_CLAIMED || '').toLowerCase() !== 'false';
}

function refuseBurst(res, key) {
  const rl = acceptLimiter().check(key);
  if (rl.allowed) return false;
  res.setHeader('Retry-After', String(rl.retryAfterSec));
  sendJson(res, 429, {
    success: false,
    error: 'that is a lot of agreements at once. wait a minute and try again.',
    code: 'RATE_LIMITED',
    retryAfter: rl.retryAfterSec,
  });
  return true;
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return undefined;
  if (!isSupabaseConfigured()) return sendUnavailable(res);
  try {
    const address = callerAddress(req);
    let did;
    let identity;

    if (req.headers?.authorization) {
      const auth = await resolveUserDid(req);
      if (!auth.userDid) {
        const body = { success: false, error: auth.error };
        if (auth.code) body.code = auth.code;
        return sendJson(res, auth.status || 401, body);
      }
      did = auth.userDid;
      identity = IDENTITY.SESSION;
      if (refuseBurst(res, `session:${did}`)) return undefined;
    } else {
      if (!claimsAllowed()) {
        return sendJson(res, 401, {
          success: false,
          error: 'a long session is needed to record an agreement here.',
          code: 'SESSION_REQUIRED',
        });
      }
      if (isForeignOrigin(req)) {
        return sendJson(res, 403, {
          success: false,
          error: "agreements are recorded from Virga's own pages.",
          code: 'ORIGIN_NOT_ALLOWED',
        });
      }
      // Before the body is looked at: spend as little as possible on a caller
      // that is already over the line.
      if (refuseBurst(res, `claimed:${address}`)) return undefined;
      identity = IDENTITY.CLAIMED;
    }

    const body = await readJson(req);
    const terms = currentTerms();
    if (body.version !== terms.version) {
      return sendJson(res, 409, {
        success: false,
        error:
          'the Terms of Service and Privacy Policy have changed. reload to read the current ones.',
        code: 'TERMS_VERSION_MISMATCH',
        ...terms,
      });
    }

    if (identity === IDENTITY.CLAIMED) {
      if (!isAccountDid(body.did)) {
        return sendJson(res, 400, {
          success: false,
          error: "that isn't an account's DID.",
          code: 'DID_INVALID',
        });
      }
      const claim = await recordClaim({
        did: body.did,
        ip: address,
        userAgent: callerUserAgent(req),
        dailyCap: envInt(
          process.env,
          'TERMS_CLAIMS_PER_ADDRESS_PER_DAY',
          CLAIMS_PER_ADDRESS_PER_DAY,
        ),
      });
      if (claim.created) {
        console.log(
          `[terms/accept] a browser session reported ${body.did} agreeing to version ${terms.version}`,
        );
      }
      return sendJson(res, 200, { success: true, ...terms, identity });
    }

    const row = await recordAcceptance({
      did,
      ip: address,
      userAgent: callerUserAgent(req),
    });
    if (row.created) {
      console.log(
        `[terms/accept] ${did} agreed to version ${terms.version} (session)`,
      );
    }
    return sendJson(res, 200, {
      success: true,
      ...terms,
      identity,
      acceptedAt: row.acceptedAt,
      created: row.created,
    });
  } catch (error) {
    if (error?.code === 'CLAIM_LIMIT') {
      res.setHeader('Retry-After', '3600');
      return sendJson(res, 429, {
        success: false,
        error:
          'that is a lot of agreements from one place today. try again later.',
        code: 'RATE_LIMITED',
        retryAfter: 3600,
      });
    }
    return sendFailure(
      res,
      'terms/accept',
      error,
      "couldn't record that. please try again.",
    );
  }
}
