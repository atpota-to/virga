// The ledger of who agreed to Virga's Terms of Service and Privacy Policy:
// the terms_acceptance table in Virga's schema
// (supabase/migrations/20261114000200_terms_acceptance.sql). A row is
// added once and never changed; the server's key can't change one.
//
// Which documents "current" means comes from src/legal/version.js, the same
// module the browser's gate reads, so the two can't disagree about it. A
// caller never chooses the version that gets written.
//
// Two kinds of row, written by two functions, because they are worth
// different things. recordAcceptance is a long session's: the DID is the
// session's own, and the first row is the account's record. recordClaim is a
// browser session's: the DID is whatever the browser said, so the row is a
// note, never anyone's record, and is bounded per address.

import { isIP } from 'node:net';
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
// document.
const MAX_USER_AGENT = 512;
// The longest DID a claim may name. A did:plc is 32 characters; a did:web is
// a host name and a short path.
const MAX_DID = 512;
const DAY_MS = 24 * 60 * 60 * 1000;

// did:plc is 24 base32 characters. did:web is a host name in lower case, a
// port written %3A, and path segments between colons. Exact case matters:
// the same account spelled two ways would be two rows.
const DID_PLC = /^did:plc:[a-z2-7]{24}$/;
const DID_WEB =
  /^did:web:(?=[a-z0-9])[a-z0-9.-]{1,253}(?:%3A\d{1,5})?(?::[A-Za-z0-9._~-]{1,128}){0,8}$/;

/**
 * Whether `value` is shaped like a DID an account can have. Asked only of a
 * DID a browser reports; one read from a session needs no checking.
 */
export function isAccountDid(value) {
  return (
    typeof value === 'string' &&
    value.length <= MAX_DID &&
    (DID_PLC.test(value) || DID_WEB.test(value))
  );
}

/** The documents a new agreement is to. */
export function currentTerms() {
  return { version: TERMS_VERSION, effectiveDate: TERMS_EFFECTIVE_DATE };
}

function coded(message, code) {
  return Object.assign(new Error(message), { code });
}

/**
 * True when the Data API doesn't serve Virga's schema at all: it hasn't been
 * added to the project's exposed schemas (PostgREST answers PGRST106).
 */
function isSchemaNotExposed(error) {
  return error?.code === 'PGRST106';
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

/**
 * A thrown Error for a Supabase error, coded UNAVAILABLE when the ledger
 * isn't set up yet: the schema isn't exposed, or the table isn't there.
 */
function dbError(error) {
  if (isSchemaNotExposed(error)) {
    return coded(
      `the terms ledger can't be reached: Virga's schema isn't in the project's exposed schemas: ${error.message}`,
      'UNAVAILABLE',
    );
  }
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
 * The caller's address as the ledger keeps it: an IPv4 or IPv6 address, or
 * null. Anywhere but behind Vercel's edge the header it comes from is the
 * caller's to write, so anything that isn't an address is left out rather
 * than recorded as one.
 */
export function addressText(value) {
  if (typeof value !== 'string') return null;
  // An IPv6 address may arrive in brackets, or with a zone after a %.
  const text = value
    .trim()
    .replace(/^\[|\]$/g, '')
    .split('%')[0];
  return isIP(text) ? text : null;
}

/**
 * A long session's agreement to `version`, or null when there is none.
 *
 * @param {string} did
 * @param {{ version?: number }} [opts]
 * @returns {Promise<{ id: string, acceptedAt: string }|null>}
 * @throws an Error coded UNAVAILABLE without Supabase or the table
 */
export async function findAcceptance(did, { version = TERMS_VERSION } = {}) {
  const { data, error } = await requireSupabase()
    .from(TABLE)
    .select('id, accepted_at')
    .eq('did', did)
    .eq('terms_version', version)
    .eq('identity', IDENTITY.SESSION)
    .maybeSingle();
  if (error) throw dbError(error);
  return data ? { id: data.id, acceptedAt: data.accepted_at } : null;
}

function rowFor({ did, identity, ip, userAgent }) {
  return {
    did,
    policy_version: TERMS_EFFECTIVE_DATE,
    terms_version: TERMS_VERSION,
    identity,
    ip: addressText(ip),
    user_agent: contextText(userAgent, MAX_USER_AGENT),
  };
}

/**
 * Record that the account behind a long session agreed to the current
 * documents. The first agreement stands: when a row is already there (another
 * device, a retry), that row is the answer and nothing is written, so
 * `created` is false.
 *
 * @param {object} entry
 * @param {string} entry.did  the session's own DID
 * @param {string} [entry.ip]  the address the request came from
 * @param {string} [entry.userAgent]
 * @returns {Promise<{ id: string, acceptedAt: string, created: boolean }>}
 * @throws an Error coded UNAVAILABLE without Supabase or the table
 */
export async function recordAcceptance({ did, ip, userAgent }) {
  if (!did) throw new TypeError('recordAcceptance: missing did');
  const { data, error } = await requireSupabase()
    .from(TABLE)
    .insert(rowFor({ did, identity: IDENTITY.SESSION, ip, userAgent }))
    .select('id, accepted_at')
    .single();
  if (!error) {
    return { id: data.id, acceptedAt: data.accepted_at, created: true };
  }
  // The unique index: this account has already agreed to this version.
  if (error.code === '23505') {
    const first = await findAcceptance(did);
    if (first) return { ...first, created: false };
  }
  throw dbError(error);
}

/**
 * Note that a browser on a browser session says `did` agreed. Kept once per
 * account, version and address, and at most `dailyCap` new ones from one
 * address in a day: the route that calls this takes no token, so this is
 * what keeps the table from being filled from one place. Answers
 * `{ created }` and nothing about the row, since the caller is anyone.
 *
 * @param {object} entry
 * @param {string} entry.did  as the browser reported it (checked by isAccountDid)
 * @param {string} [entry.ip]
 * @param {string} [entry.userAgent]
 * @param {number} [entry.dailyCap]
 * @param {Date} [entry.now]
 * @returns {Promise<{ created: boolean }>}
 * @throws an Error coded CLAIM_LIMIT past the cap, or UNAVAILABLE without
 *   Supabase or the table
 */
export async function recordClaim({
  did,
  ip,
  userAgent,
  dailyCap = 50,
  now = new Date(),
}) {
  if (!isAccountDid(did)) throw new TypeError('recordClaim: not a DID');
  const supabase = requireSupabase();
  const row = rowFor({ did, identity: IDENTITY.CLAIMED, ip, userAgent });

  let recent = supabase
    .from(TABLE)
    .select('id', { count: 'exact', head: true })
    .eq('identity', IDENTITY.CLAIMED)
    .gte('accepted_at', new Date(now.getTime() - DAY_MS).toISOString());
  recent = row.ip === null ? recent.is('ip', null) : recent.eq('ip', row.ip);
  const { count, error: countError } = await recent;
  if (countError) throw dbError(countError);
  if ((count || 0) >= dailyCap) {
    throw coded('too many claims from this address today', 'CLAIM_LIMIT');
  }

  const { error } = await supabase.from(TABLE).insert(row);
  if (!error) return { created: true };
  // The unique index: this address has already reported this account.
  if (error.code === '23505') return { created: false };
  throw dbError(error);
}
