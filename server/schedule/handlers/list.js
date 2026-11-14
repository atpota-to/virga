// GET /api/schedule/list: the account's queue, ordered by scheduled time.
// Pending, publishing and failed rows, plus published rows still carrying a
// TIMER_NOT_ARMED note. Without the table it answers an empty list marked
// `unavailable`, which the client shows as "scheduling isn't set up".

import { methodGuard, sendJson } from '../../http.js';
import { isSupabaseConfigured } from '../../supabase.js';
import * as scheduled from '../scheduledPosts.js';
import { authorize, publicRow, sendFailure } from '../respond.js';

const UNAVAILABLE = { success: true, data: [], unavailable: true };

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET'])) return;
  if (!isSupabaseConfigured()) return sendJson(res, 200, UNAVAILABLE);
  try {
    const userDid = await authorize(req, res);
    if (!userDid) return;
    let rows;
    try {
      rows = await scheduled.listScheduledPosts(userDid);
    } catch (error) {
      if (error?.code !== 'UNAVAILABLE') throw error;
      console.warn(`[schedule/list] unavailable: ${error.message}`);
      return sendJson(res, 200, UNAVAILABLE);
    }
    const data = rows.map((row) => publicRow(row, { partial: true }));
    return sendJson(res, 200, { success: true, data });
  } catch (error) {
    return sendFailure(
      res,
      'schedule/list',
      error,
      "couldn't load your scheduled posts. please try again.",
    );
  }
}
