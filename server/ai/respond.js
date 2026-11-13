// What the three AI handlers share: the opening checks every request goes
// through, the monthly allowance read and count, and the one catch.
//
// Order matters, and the trial is counted only on success: sign-in, the
// gateway being configured, the handler's own validation (400/413), the
// monthly allowance read (429 monthly_limit), the rate limit (which takes a
// daily slot before anything is spent), the model call, and only then, for a
// usable answer, the monthly count. A failed model call costs a daily slot but
// not a monthly one.

import { methodGuard, readJson, sendJson } from '../http.js';
import { resolveAiCaller } from './caller.js';
import { monthlyLimitFor } from './allowances.js';
import { AIGatewayError, isConfigured } from './gateway.js';
import { logResolvedModelsOnce } from './models.js';
import { getUsage, incrementUsage } from './usage.js';

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
 * Check `allowance` for this month. Returns `{ limit, used }` to go on with
 * (limit null = unlimited, nothing read), or null once it has answered 429
 * `{ error: 'monthly_limit', limit, used }`. An untracked count (Supabase
 * unavailable) lets the request through.
 */
export async function checkAllowance(
  res,
  allowance,
  did,
  { env = process.env } = {},
) {
  if (monthlyLimitFor(allowance, env) === null) return { limit: null, used: 0 };
  const usage = await getUsage(allowance, did, { env });
  if (usage.limit === null) return { limit: null, used: 0 };
  if (usage.tracked && usage.used >= usage.limit) {
    sendJson(res, 429, {
      error: 'monthly_limit',
      limit: usage.limit,
      used: usage.used,
    });
    return null;
  }
  return { limit: usage.limit, used: usage.used };
}

/**
 * Count one successful use. Returns the `usage` to put in the answer, or
 * undefined when the allowance is unlimited (the answer then carries none,
 * which tells the client to drop any count it kept).
 */
export async function countUse(
  allowance,
  did,
  allowanceState,
  { env = process.env } = {},
) {
  if (!allowanceState || allowanceState.limit === null) return undefined;
  const used = await incrementUsage(allowance, did, {
    env,
    usedBefore: allowanceState.used,
  });
  return { used, limit: allowanceState.limit };
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
