// POST /api/schedule/cancel { id }: cancel one of the account's pending rows,
// or dismiss a failed one, and drop its stashed images. A row already
// publishing may be mid-write and is left alone (409 NOT_CANCELLABLE).

import { methodGuard, readJson, sendJson } from '../../http.js';
import * as scheduled from '../scheduledPosts.js';
import {
  authorize,
  queryId,
  requireScheduling,
  sendFailure,
} from '../respond.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;
  if (!requireScheduling(res)) return;
  try {
    const userDid = await authorize(req, res);
    if (!userDid) return;
    const body = await readJson(req);
    const id = (typeof body.id === 'string' && body.id.trim()) || queryId(req);
    if (!id) return sendJson(res, 400, { success: false, error: 'Missing id' });

    const row = await scheduled.cancelScheduledPost(id, userDid);
    if (!row) {
      // Not the account's, not there, or past cancelling: publishing,
      // published or already cancelled.
      return sendJson(res, 409, {
        success: false,
        error:
          'that post can no longer be cancelled. it may already be publishing.',
        code: 'NOT_CANCELLABLE',
      });
    }
    return sendJson(res, 200, {
      success: true,
      data: { id: row.id, status: row.status },
    });
  } catch (error) {
    return sendFailure(
      res,
      'schedule/cancel',
      error,
      "couldn't cancel that scheduled post. please try again.",
    );
  }
}
