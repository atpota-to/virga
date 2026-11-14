// What the three AI handlers share: the opening checks every request goes
// through, the monthly allowance, and the one catch.
//
// Order matters: sign-in, the gateway being configured, the handler's own
// validation (400/413), a use taken from the monthly allowance (429
// monthly_limit), the rate limit (which takes a daily slot before anything is
// spent), the model call. The monthly use is taken before the call, so
// requests sent together can't all pass at the last one, and given back when
// the request ends without a usable answer: a refused daily slot, a failed
// model call or an empty answer costs no monthly use. A failed model call
// still costs its daily slot.

import { methodGuard, readJson, sendJson } from '../http.js';
import { resolveAiCaller } from './caller.js';
import { monthlyLimitFor } from './allowances.js';
import { AIGatewayError, isConfigured } from './gateway.js';
import { logResolvedModelsOnce } from './models.js';
import { getUsage, releaseUsage, reserveUsage } from './usage.js';

export const UNAVAILABLE = Object.freeze({
  error: 'AI help isn’t available right now.',
  code: 'AI_UNAVAILABLE',
});

/**
 * The opening of every AI request. Answers the request itself (and returns
 * null) for OPTIONS, a wrong method, a caller without a valid session, or a
 * deployment with no AI_GATEWAY_API_KEY; otherwise returns the caller's DID and
 * the JSON body.
 */
export async function beginAiRequest(req, res, { env = process.env } = {}) {
  if (!methodGuard(req, res, 'POST')) return null;
  logResolvedModelsOnce(env);

  const caller = await resolveAiCaller(req);
  if (!caller.ok) {
    sendJson(res, caller.status, {
      error: caller.error,
      ...(caller.code ? { code: caller.code } : {}),
    });
    return null;
  }

  // Before anything is read or counted: without a key every request would
  // spend a daily slot only to fail.
  if (!isConfigured(env)) {
    sendJson(res, 503, UNAVAILABLE);
    return null;
  }

  return { did: caller.did, body: await readJson(req) };
}

/**
 * Take one use of `allowance` for this month. Returns the reservation to go on
 * with, or null once it has answered 429 `{ error: 'monthly_limit', limit,
 * used }`. A limit of null (unlimited) reads and writes nothing; a limit of 0
 * refuses without a read. An untracked count (Supabase unavailable) lets the
 * request through.
 *
 * Every way out after this either keeps the use (`keepUse`, on a usable
 * answer) or gives it back (`releaseUse`), before the response is sent: the
 * function may be frozen once it has answered.
 */
export async function checkAllowance(
  res,
  allowance,
  did,
  { env = process.env } = {},
) {
  const taken = await reserveUsage(allowance, did, { env });
  if (!taken.allowed) {
    sendJson(res, 429, {
      error: 'monthly_limit',
      limit: taken.limit,
      used: taken.used,
    });
    return null;
  }
  return {
    allowance,
    did,
    env,
    limit: taken.limit,
    used: taken.used,
    month: taken.month,
    held: taken.held,
  };
}

/**
 * Keep the use a reservation took: the request has a usable answer. Returns
 * the `usage` to put in the answer, or undefined when the allowance is
 * unlimited (the answer then carries none, which tells the client to drop any
 * count it kept).
 */
export function keepUse(reservation) {
  if (!reservation) return undefined;
  reservation.held = false;
  if (reservation.limit === null) return undefined;
  return { used: reservation.used, limit: reservation.limit };
}

/**
 * Give back the use a reservation took, if it still holds one. Safe to call
 * on any way out, more than once, and with no reservation. Never throws.
 */
export async function releaseUse(reservation) {
  if (!reservation?.held) return;
  reservation.held = false;
  await releaseUsage(reservation.allowance, reservation.did, {
    env: reservation.env,
    month: reservation.month,
  });
}

/**
 * The allowance as it stands, without taking a use, for an answer that costs
 * nothing (analyze-post with nothing to check). Returns the `usage` to put in
 * it, or undefined when the allowance is unlimited or the count can't be read:
 * an answer without `usage` is read as unlimited, so only a count that was
 * read goes out.
 */
export async function currentUse(allowance, did, { env = process.env } = {}) {
  if (monthlyLimitFor(allowance, env) === null) return undefined;
  const usage = await getUsage(allowance, did, { env });
  if (usage.limit === null || !usage.tracked) return undefined;
  return { used: usage.used, limit: usage.limit };
}

// What the writer is told for each gateway failure. The gateway's own error
// text can carry provider detail, so it goes to the log, not the answer.
const GATEWAY_MESSAGES = {
  429: 'The AI service is busy. Try again in a moment.',
  502: 'The AI service didn’t give a usable answer. Try again.',
  504: 'The AI service took too long to answer. Try again.',
};

// A line for the log: the gateway's status and its error type, never the body
// it sent back, which can quote the request.
function describeForLog(error) {
  const message =
    typeof error?.message === 'string' ? error.message : String(error);
  const upstream = /^AI Gateway returned (\d+):/.exec(message);
  if (upstream) {
    const type = /"type"\s*:\s*"([a-z_]+)"/.exec(message)?.[1];
    return `AI Gateway returned ${upstream[1]}${type ? ` (${type})` : ''}`;
  }
  return message.slice(0, 200);
}

/** The shared catch: logs what went wrong and answers with a status the client can read. */
export function sendAiError(res, error, { tag, fallback }) {
  const status =
    Number.isInteger(error?.status) && error.status >= 400 && error.status < 600
      ? error.status
      : 500;
  console.error(`[ai/${tag}] ${status}: ${describeForLog(error)}`);
  if (res.headersSent || res.writableEnded) return undefined;
  if (status === 503) return sendJson(res, 503, UNAVAILABLE);
  if (error instanceof AIGatewayError && GATEWAY_MESSAGES[status]) {
    return sendJson(res, status, { error: GATEWAY_MESSAGES[status] });
  }
  return sendJson(res, status, { error: fallback });
}
