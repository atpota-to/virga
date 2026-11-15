// What both /api/terms/* handlers share: the answer when the ledger isn't set
// up, and how an unexpected error becomes a sentence that leaks nothing.

import { sendJson } from '../http.js';

export const UNAVAILABLE_ERROR =
  "agreements can't be recorded on Virga's server yet.";

/** 503 UNAVAILABLE: no Supabase here, or the ledger's migration isn't applied. */
export function sendUnavailable(res) {
  return sendJson(res, 503, {
    success: false,
    error: UNAVAILABLE_ERROR,
    code: 'UNAVAILABLE',
  });
}

/**
 * Answer an error a handler didn't expect. A missing table is 503
 * UNAVAILABLE; anything else is a fixed sentence, because the raw message is
 * a Supabase string naming tables and columns.
 */
export function sendFailure(res, tag, error, sentence) {
  if (error?.code === 'UNAVAILABLE') {
    console.warn(`[${tag}] unavailable: ${error.message}`);
    return sendUnavailable(res);
  }
  console.error(`[${tag}] error:`, error?.message || error);
  return sendJson(res, 500, {
    success: false,
    error: sentence,
    code: 'INTERNAL',
  });
}
