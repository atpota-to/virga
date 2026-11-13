// Who may run the workers. Vercel Cron calls the production deployment with
// `Authorization: Bearer <CRON_SECRET>` whenever the project has that variable.

import { createHash, timingSafeEqual } from 'node:crypto';
import { isProduction } from './env.js';
import { sendJson } from './http.js';

// Both sides are hashed first so the comparison takes the same time whatever
// the lengths, and a wrong guess can't be narrowed by timing.
function sameSecret(a, b) {
  const x = createHash('sha256').update(String(a)).digest();
  const y = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(x, y);
}

/**
 * True when the request may run a worker. With CRON_SECRET set it must carry
 * exactly `Bearer <CRON_SECRET>`. Without one, production refuses everything
 * and anywhere else allows (local runs and tests).
 */
export function isCronAuthorized(req, env = process.env) {
  const secret = env?.CRON_SECRET;
  if (!secret) {
    if (isProduction(env)) {
      console.error('[cron] CRON_SECRET is not set; refusing the run in production.');
      return false;
    }
    console.warn('[cron] CRON_SECRET is not set; allowing the run outside production.');
    return true;
  }
  const raw = req?.headers?.authorization;
  const given = Array.isArray(raw) ? raw[0] : raw;
  if (typeof given !== 'string' || !given) return false;
  return sameSecret(given, `Bearer ${secret}`);
}

/** isCronAuthorized, answering 401 itself when the request may not run. */
export function requireCron(req, res, env = process.env) {
  if (isCronAuthorized(req, env)) return true;
  sendJson(res, 401, { success: false, error: 'Unauthorized' });
  return false;
}
