// POST /api/schedule/reorder { moves: [{ id, scheduledFor }, …] }: apply a
// whole permutation of the account's pending queue in one transaction, so a
// refusal or a dropped connection can't leave half a drag behind.
//
//   200 { success: true, moved }
//   400 BAD_REQUEST              the body couldn't be read
//   409 NOT_REORDERABLE          a row isn't the account's, isn't pending, or
//                                is partly published; nothing was written
//   409 DELETE_TIME_TOO_EARLY    a post's new slot would come after its
//       { id, deleteAt }         pinned delete time; `error` names the post
//   404 UNAVAILABLE              no reorder function in the database; the
//                                client then moves rows one at a time

import { methodGuard, readJson, sendJson } from '../../http.js';
import * as scheduled from '../scheduledPosts.js';
import { authorize, requireScheduling, sendFailure } from '../respond.js';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;
  if (!requireScheduling(res)) return;
  try {
    const userDid = await authorize(req, res);
    if (!userDid) return;

    const { moves } = await readJson(req);
    // Named here: the lib's length check would answer a missing list with a
    // sentence about how many posts a reorder carries.
    if (!Array.isArray(moves)) {
      return sendJson(res, 400, {
        success: false,
        error: 'a reorder needs a list of posts to move.',
        code: 'BAD_REQUEST',
      });
    }

    const result = await scheduled.reorderScheduledPosts({ userDid, moves });
    if (result.ok)
      return sendJson(res, 200, { success: true, moved: result.moved });
    if (result.code === 'BAD_REQUEST') {
      return sendJson(res, 400, {
        success: false,
        error: result.error,
        code: 'BAD_REQUEST',
      });
    }
    if (result.code === 'DELETE_TIME_TOO_EARLY') {
      return sendJson(res, 409, {
        success: false,
        error: result.error,
        code: 'DELETE_TIME_TOO_EARLY',
        id: result.id,
        deleteAt: result.deleteAt,
      });
    }
    if (result.code === 'UNAVAILABLE') {
      return sendJson(res, 404, {
        success: false,
        error: 'reordering the whole queue at once is not available here yet.',
        code: 'UNAVAILABLE',
      });
    }
    return sendJson(res, 409, {
      success: false,
      error:
        'one of these posts can no longer be moved — it may already be publishing, or part of it may already be posted. your queue is unchanged.',
      code: 'NOT_REORDERABLE',
    });
  } catch (error) {
    return sendFailure(
      res,
      'schedule/reorder',
      error,
      "couldn't reorder your queue. please try again.",
    );
  }
}
