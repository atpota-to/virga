// The ledger of who agreed to Virga's Terms of Service and Privacy Policy:
// the terms_acceptance table
// (supabase/migrations/20261114000100_terms_acceptance.sql). A row is added
// once and never changed; the server's key can't change one.
//
// Which documents "current" means comes from src/legal/version.js, the same
// module the browser's gate reads, so the two can't disagree about it. A
// caller never chooses the version that gets written.

import {
  TERMS_EFFECTIVE_DATE,
  TERMS_VERSION,
} from '../../src/legal/version.js';
import { getSupabaseClient } from '../supabase.js';

const TABLE = 'terms_acceptance';

/** How the account in a row was known (the table's `identity` column). */
export const IDENTITY = Object.freeze({
  // Read from the caller's long session, which the account's host vouched for.
  SESSION: 'session',
  // Reported by a browser on a browser session, which the server can't check.
  CLAIMED: 'claimed',
});

// What is kept of the request, at most. A User-Agent is a sentence, not a
// document; an address is at most an IPv6 one with a zone.
const MAX_USER_AGENT = 512;
const MAX_ADDRESS = 64;

// did:plc is 24 base32 characters. did:web is a host name, a port written
// %3A, and path segments between colons.
const DID_PLC = /^did:plc:[a-z2-7]{24}$/;
const DID_WEB =
  /^did:web:(?=[a-z0-9])[a-z0-9.-]{1,253}(?:%3A\d{1,5})?(?::[A-Za-z0-9._~-]{1,128}){0,16}$/i;

/**
 * Whether `value` is shaped like a DID an account can have. Asked only of a
 * DID a browser reports; one read from a session needs no checking.
 */
export function isAccountDid(value) {
  return (
    typeof value === 'string' && (DID_PLC.test(value) || DID_WEB.test(value))
  );
}

/** The documents a new agreement is to. */
export function currentTerms() {
  return { version: TERMS_VERSION, effectiveDate: TERMS_EFFECTIVE_DATE };
}

function coded(message, code) {
  return Object.assign(new Error(message), { code });
}

/** True when the database has no such table: the migration hasn't been applied. */
function isMissingTable(error) {
  return (
    error?.code === 'PGRST205' ||
    error?.code === '42P01' ||
    (typeof error?.message === 'string' &&
      /^(could not find the table|relation "[^"]+" does not exist)/i.test(
        error.message,
      ))
  );
}

/** A thrown Error for a Supabase error, coded UNAVAILABLE when the table is missing. */
function dbError(error) {
  if (isMissingTable(error)) {
    return coded(
      `the terms ledger needs its database migration: ${error.message}`,
      'UNAVAILABLE',
    );
  }
  return new Error(error?.message || 'database error');
}

function requireSupabase() {
  const supabase = getSupabaseClient();
  if (!supabase) throw coded('Supabase is not configured', 'UNAVAILABLE');
  return supabase;
}

/** One line of request context: control characters out, trimmed, cut to `max`; null when empty. */
export function contextText(value, max) {
  if (typeof value !== 'string') return null;
  const text = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, max);
  return text || null;
}

/**
 * The account's agreement to `version`, or null when there is none.
 *
 * @param {string} did
 * @param {{ identity?: 'session'|'claimed', version?: number }} [opts]
 * @returns {Promise<{ id: string, acceptedAt: string }|null>}
 * @throws an Error coded UNAVAILABLE without Supabase or the table
 */
export async function findAcceptance(
  did,
  { identity = IDENTITY.SESSION, version = TERMS_VERSION } = {},
) {
  const { data, error } = await requireSupabase()
    .from(TABLE)
    .select('id, accepted_at')
    .eq('did', did)
    .eq('terms_version', version)
    .eq('identity', identity)
    .maybeSingle();
  if (error) throw dbError(error);
  return data ? { id: data.id, acceptedAt: data.accepted_at } : null;
}

/**
 * Record that `did` agreed to the current documents. The first agreement
 * stands: when a row is already there (another device, a retry), that row is
 * the answer and nothing is written, so `created` is false.
 *
 * @param {object} entry
 * @param {string} entry.did
 * @param {'session'|'claimed'} entry.identity
 * @param {string} [entry.ip]  the address the request came from
 * @param {string} [entry.userAgent]
 * @returns {Promise<{ id: string, acceptedAt: string, created: boolean }>}
 * @throws an Error coded UNAVAILABLE without Supabase or the table
 */
export async function recordAcceptance({ did, identity, ip, userAgent }) {
  if (!did) throw new TypeError('recordAcceptance: missing did');
  if (identity !== IDENTITY.SESSION && identity !== IDENTITY.CLAIMED) {
    throw new TypeError('recordAcceptance: unknown identity');
  }
  const address = contextText(ip, MAX_ADDRESS);
  const { data, error } = await requireSupabase()
    .from(TABLE)
    .insert({
      did,
      terms_version: TERMS_VERSION,
      effective_date: TERMS_EFFECTIVE_DATE,
      identity,
      // 'unknown' is what callerAddress answers when there was nothing to read.
      ip: address === 'unknown' ? null : address,
      user_agent: contextText(userAgent, MAX_USER_AGENT),
    })
    .select('id, accepted_at')
    .single();
  if (!error) {
    return { id: data.id, acceptedAt: data.accepted_at, created: true };
  }
  // The unique index: this account has already agreed to this version.
  if (error.code === '23505') {
    const first = await findAcceptance(did, { identity });
    if (first) return { ...first, created: false };
  }
  throw dbError(error);
}
