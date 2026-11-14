// GET /api/schedule/get?id=<uuid>: one of the account's rows, or 404.

import { methodGuard, sendJson } from '../../http.js';
import * as scheduled from '../scheduledPosts.js';
import {
  authorize,
  publicRow,
  queryId,
  requireScheduling,
  sendFailure,
} from '../respond.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET'])) return;
  if (!requireScheduling(res)) return;
  try {
    const userDid = await authorize(req, res);
    if (!userDid) return;
    const id = queryId(req);
    if (!id) return sendJson(res, 400, { success: false, error: 'Missing id' });
    const row = await scheduled.getScheduledPost(id, userDid);
    if (!row) return sendJson(res, 404, { success: false, error: 'Not found' });
    return sendJson(res, 200, { success: true, data: publicRow(row) });
  } catch (error) {
    return sendFailure(
      res,
      'schedule/get',
      error,
      "couldn't load that scheduled post. please try again.",
    );
  }
}
