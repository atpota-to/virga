// One Vercel function per area: api/<area>/[action].js hands its requests to
// createRouter, which dispatches on the [action] segment. Fewer functions keep
// the deployment inside any plan's function limit, and every handler stays its
// own module so tests import it directly.

import { applyCors, sendJson } from './http.js';

function actionOf(req) {
  const fromQuery = req?.query?.action;
  if (typeof fromQuery === 'string' && fromQuery) return fromQuery;
  if (Array.isArray(fromQuery) && typeof fromQuery[0] === 'string') return fromQuery[0];
  // A request that reached the function without Vercel's query parsing: the
  // last path segment is the action.
  try {
    const { pathname } = new URL(req?.url || '', 'http://local');
    const last = pathname.split('/').filter(Boolean).pop();
    return last ? decodeURIComponent(last) : null;
  } catch {
    return null;
  }
}

/**
 * `handlers` maps an action name to `async (req, res) => …`. An unknown action
 * is a 404; a handler that throws becomes a logged 500 (unless it had already
 * answered).
 */
export function createRouter(handlers, { name = 'api' } = {}) {
  const table = new Map(Object.entries(handlers));
  return async function route(req, res) {
    applyCors(req, res);
    const action = actionOf(req);
    const handler = action ? table.get(action) : undefined;
    if (typeof handler !== 'function') {
      return sendJson(res, 404, { success: false, error: 'Not found' });
    }
    try {
      return await handler(req, res);
    } catch (error) {
      console.error(`[${name}/${action}] unhandled error:`, error?.stack || error?.message || error);
      if (res.headersSent || res.writableEnded) return undefined;
      return sendJson(res, 500, { success: false, code: 'INTERNAL', error: 'Internal error' });
    }
  };
}
