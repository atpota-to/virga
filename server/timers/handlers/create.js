// POST /api/self-destruct/create
//
// Arm a timer on a post that has already been published. Body:
//   {
//     postUri: 'at://did:plc:…/app.bsky.feed.post/…',
//     postCid?: string,
//     extraUris?: string[],      // the rest of a thread, deleted with the root (≤100)
//     snippet?: string,          // a line of the post, for the timer list
//     postedAt?: ISO-8601,       // when the post went out (defaults to now)
//     lifespanSeconds: number,   // 5 minutes … 30 days
//     deleteAt?: ISO-8601,       // a pinned deadline instead of a duration
//     conditions?: object,       // what would spare the post, or doom it
//     effects?: array,           // what the rule does when it fires
//   }
//
// The caller's DID comes from the session token, and the post URI must name
// that same repo: a timer ends in a delete, and the only PDS a session may be
// pointed at is its own.
//
// Idempotent per live post: arming a post that already has a live timer
// answers that timer (200, rewritten to the new rule while it is still armed)
// rather than racing two deletes, so a retry after a lost answer is safe. A new
// timer answers 201. A timer being checked can't be rewritten: a different rule
// for it answers 409 NOT_REARMABLE, the same rule 200.

import { envInt } from '../../env.js';
import { methodGuard, readJson, sendJson } from '../../http.js';
import { createRateLimiter } from '../../rateLimit.js';
import { resolveUserDid } from '../../oauth/auth.js';
import { armSelfDestruct, sameTimerRule, validateArm } from '../selfDestruct.js';
import { enforceTimerLimit, settleArmedTimer } from '../timerUsage.js';
import { timerShape } from '../shape.js';

// A coarse per-DID burst guard. Not a quota: the real ceiling is counted in the
// database under a per-user lock. Well above anyone posting by hand, and below
// what a runaway retry loop does in a second. One limiter per configured rate,
// so a changed SELF_DESTRUCT_CREATE_PER_MIN takes effect without a cold start.
const limiters = new Map();
function createLimiter() {
  const limit = envInt(process.env, 'SELF_DESTRUCT_CREATE_PER_MIN', 60);
  if (!limiters.has(limit)) limiters.set(limit, createRateLimiter({ limit, windowMs: 60 * 1000 }));
  return limiters.get(limit);
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;

  try {
    const auth = await resolveUserDid(req);
    if (!auth.userDid) {
      return sendJson(res, auth.status, { success: false, error: auth.error, ...(auth.code ? { code: auth.code } : {}) });
    }

    const rl = createLimiter().check(auth.userDid);
    if (!rl.allowed) {
      res.setHeader('Retry-After', String(rl.retryAfterSec));
      return sendJson(res, 429, {
        success: false,
        error: 'that is a lot of timers at once. wait a moment and try again.',
        code: 'RATE_LIMITED',
        retryAfter: rl.retryAfterSec,
      });
    }

    const {
      postUri, postCid, snippet, postedAt, lifespanSeconds, conditions, extraUris, deleteAt, effects,
    } = await readJson(req);
    // A deadline sent from the composer that has already gone by is refused
    // with a sentence the writer can act on, rather than floored into a
    // five-minute timer nobody asked for. The publish worker arms with the
    // floor instead (see validateArm).
    const validation = validateArm({
      userDid: auth.userDid, postUri, postCid, snippet, lifespanSeconds, conditions, postedAt, extraUris,
      deleteAt, effects,
    }, { refusePastDeadline: true });
    if (!validation.ok) return sendJson(res, 400, { success: false, error: validation.error });

    // A re-arm of the same post replaces its timer, so that post isn't
    // counted against its own slot.
    const verdict = await enforceTimerLimit({
      userDid: auth.userDid,
      conditions: validation.value.conditions,
      effects: validation.value.effects,
      exceptPostUri: validation.value.postUri,
    });

    const { row, existing, updated } = await armSelfDestruct({ userDid: auth.userDid, ...validation.value });
    // The timer there is being checked, so the new rule was not written. A 200
    // would tell the author their change was taken while the old rule runs. A
    // retry carrying the rule the row already has is still answered 200.
    if (existing && updated === false && !sameTimerRule(row, validation.value)) {
      return sendJson(res, 409, {
        success: false,
        error: "that timer is being checked right now, so it wasn't changed. try again in a minute.",
        code: 'NOT_REARMABLE',
      });
    }
    if (!existing) await settleArmedTimer({ userDid: auth.userDid, row, verdict });

    return sendJson(res, existing ? 200 : 201, { success: true, data: timerShape(row) });
  } catch (error) {
    if (error.code === 'UNAVAILABLE') {
      // The database isn't set up for timers here. The client treats this as
      // "the feature isn't on" rather than an error the writer did something about.
      return sendJson(res, 503, { success: false, error: error.message, code: 'UNAVAILABLE' });
    }
    if (error.code === 'QUOTA_EXCEEDED') {
      // A per-kind limit names its feature; the flat ceiling names none, which
      // the client words as the general cap.
      return sendJson(res, 409, {
        success: false,
        error: error.message,
        code: 'QUOTA_EXCEEDED',
        ...(error.feature ? { feature: error.feature } : {}),
        ...(Number.isFinite(error.limit) ? { limit: error.limit } : {}),
      });
    }
    console.error('[self-destruct/create] failed:', error?.message || error);
    // The raw message is a PostgREST string naming tables and columns; it
    // belongs in the log, not in the composer.
    return sendJson(res, 500, {
      success: false,
      error: "couldn't set that timer. the post is up, but it won't delete itself.",
      code: 'INTERNAL',
    });
  }
}
