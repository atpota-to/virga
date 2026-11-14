// GET /api/schedule/media?id=<uuid>: a row's stashed images as
// { [mediaId]: { base64, encoding } }, to rebuild the post in the composer.
// An image that can no longer be read is left out.

import { methodGuard, sendJson } from '../../http.js';
import * as scheduled from '../scheduledPosts.js';
import {
  authorize,
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
    const media = await scheduled.getScheduledMediaMap(id, userDid);
    if (media === null)
      return sendJson(res, 404, { success: false, error: 'Not found' });
    return sendJson(res, 200, { success: true, data: media });
  } catch (error) {
    return sendFailure(
      res,
      'schedule/media',
      error,
      "couldn't load the images for that scheduled post. please try again.",
    );
  }
}
