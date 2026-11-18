// What every /api/defense/* handler shares: the caller's DID, the answer when
// Defense's database isn't set up or its writes are off, and how an
// unexpected error becomes a sentence that leaks nothing.

import { sendJson } from '../http.js';
import { isSupabaseConfigured } from '../supabase.js';
import { resolveUserDid } from '../oauth/auth.js';
import { defenseWritesEnabled } from './run.js';

/** True when Supabase is configured; otherwise answers 503 and returns false. */
export function requireStore(res) {
  if (isSupabaseConfigured()) return true;
  sendJson(res, 503, { success: false, code: 'UNAVAILABLE', error: 'Defense isn’t set up on Virga’s server yet.' });
  return false;
}

/** True when Defense may write; otherwise answers 503 WRITES_OFF and returns false. */
export function requireWrites(res, env = process.env) {
  if (defenseWritesEnabled(env)) return true;
  sendJson(res, 503, { success: false, code: 'WRITES_OFF', error: 'Defense’s lists aren’t turned on on Virga’s server yet.' });
  return false;
}

/**
 * Whether Defense's moderator is on: DEFENSE_MODERATOR=on. Off for the first
 * release (docs/DEFENSE.md, phase 4): its routes answer 503 MODERATOR_OFF and
 * the worker reads no DMs.
 */
export const moderatorEnabled = (env = process.env) => env?.DEFENSE_MODERATOR === 'on';

/** True when the moderator is on; otherwise answers 503 MODERATOR_OFF and returns false. */
export function requireModerator(res, env = process.env) {
  if (moderatorEnabled(env)) return true;
  sendJson(res, 503, { success: false, code: 'MODERATOR_OFF', error: 'Defense’s moderator isn’t turned on on Virga’s server.' });
  return false;
}

/** The caller's DID, or null after answering 401/503 with the auth's code. */
export async function authorize(req, res) {
  const auth = await resolveUserDid(req);
  if (auth.userDid) return auth.userDid;
  const body = { success: false, error: auth.error };
  if (auth.code) body.code = auth.code;
  sendJson(res, auth.status || 401, body);
  return null;
}

/** A logged 500 with a sentence of the handler's own, never the error's. */
export function sendFailure(res, tag, error, sentence) {
  console.error(`[${tag}]`, error?.stack || error?.message || error);
  if (res.headersSent || res.writableEnded) return undefined;
  if (error?.code === 'STORE_UNAVAILABLE') return requireStore(res);
  return sendJson(res, 500, { success: false, code: 'INTERNAL', error: sentence });
}

const DID = /^did:[a-z]+:[a-zA-Z0-9._:%-]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A DID, or null for anything else. */
export const didOrNull = (v) => (typeof v === 'string' && v.length <= 512 && DID.test(v) ? v : null);

/** A UUID, or null for anything else. */
export const uuidOrNull = (v) => (typeof v === 'string' && UUID.test(v) ? v.toLowerCase() : null);

/** A short text from a body, trimmed to one line and `max` characters, or null. */
export function textOrNull(v, max) {
  const t = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
  return t ? t.slice(0, max) : null;
}
