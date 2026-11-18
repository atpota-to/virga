// GET|POST /api/defense/run: one pass of the list writer (../run.js). Called
// by Vercel Cron every minute with `Authorization: Bearer <CRON_SECRET>`, or
// by the worker on the droplet with a signed X-Virga-Worker header
// (../workerAuth.js). It takes nothing else from its caller.

import { methodGuard, sendJson } from '../../http.js';
import { isCronAuthorized } from '../../cron.js';
import { isSupabaseConfigured } from '../../supabase.js';
import { runDefense } from '../run.js';
import { isWorkerAuthorized } from '../workerAuth.js';

export default async function handler(req, res, { run = runDefense } = {}) {
  if (!methodGuard(req, res, ['GET', 'POST'])) return;
  if (!isWorkerAuthorized(req) && !isCronAuthorized(req)) return sendJson(res, 401, { success: false, error: 'Unauthorized' });
  if (!isSupabaseConfigured()) return sendJson(res, 200, { success: true, data: { ran: false, reason: 'Defense isn’t set up' } });
  try {
    const summary = await run();
    if (summary.ran && (summary.written || summary.vetoed || summary.failed || summary.held.length || summary.errors.length)) {
      console.info(`[defense/run] ${JSON.stringify(summary)}`);
    }
    return sendJson(res, 200, { success: true, data: summary });
  } catch (error) {
    console.error('[defense/run]', error?.stack || error?.message || error);
    return sendJson(res, 500, { success: false, code: 'INTERNAL', error: 'The list writer stopped.' });
  }
}
