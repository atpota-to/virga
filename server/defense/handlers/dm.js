// GET|POST /api/defense/dm: one pass of the moderator's DMs (../dm/pass.js).
// Called by Vercel Cron every minute with `Authorization: Bearer
// <CRON_SECRET>`, or by the worker on the droplet with a signed
// X-Virga-Worker header (../workerAuth.js), more often. It takes nothing else
// from its caller: what it answers is what the chat service says was sent.

import { methodGuard, sendJson } from '../../http.js';
import { isCronAuthorized } from '../../cron.js';
import { isSupabaseConfigured } from '../../supabase.js';
import { runDmPass } from '../dm/pass.js';
import { isWorkerAuthorized } from '../workerAuth.js';

export default async function handler(req, res, { run = runDmPass } = {}) {
  if (!methodGuard(req, res, ['GET', 'POST'])) return;
  if (!isWorkerAuthorized(req) && !isCronAuthorized(req)) return sendJson(res, 401, { success: false, error: 'Unauthorized' });
  if (!isSupabaseConfigured()) return sendJson(res, 200, { success: true, data: { ran: false, reason: 'Defense isn’t set up' } });
  try {
    const summary = await run();
    if (summary.ran && (summary.answered || summary.errors?.length)) console.info(`[defense/dm] ${JSON.stringify(summary)}`);
    return sendJson(res, 200, { success: true, data: summary });
  } catch (error) {
    // The moderator's own failures (signing in, the chat service) say what
    // they are; nothing in them is anyone's message.
    console.error('[defense/dm]', error?.stack || error?.message || error);
    return sendJson(res, 500, { success: false, code: error?.code === 'UNCONFIGURED' ? 'UNCONFIGURED' : 'INTERNAL', error: 'The moderator’s pass stopped.' });
  }
}
