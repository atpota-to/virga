// What the moderator's passes share, in defense_dm_state: how far the chat log
// has been read, the lease one pass holds at a time, and the moderator's
// session. Not bound to an owner: none of it is anyone's but the moderator's,
// and nothing here reads a Defense table that is (docs/DEFENSE-THREATS.md,
// rule 4). Owners' rows are reached only through storeFor.

import { getSupabaseClient } from '../../supabase.js';
import { StoreUnavailable } from '../store.js';

function unwrap({ data, error }, what) {
  if (error) {
    const err = new Error(`${what}: ${error.message || error.code || 'database error'}`);
    err.code = error.code;
    throw err;
  }
  return data;
}

/** The pass state, through `client` (the service-role client by default). */
export function dmState({ client = null } = {}) {
  const db = () => {
    const c = client ?? getSupabaseClient();
    if (!c) throw new StoreUnavailable();
    return c;
  };
  return {
    /** Take the lease for `seconds`: `{ log_cursor, seeded, session, session_did }`, or null while another pass holds it. */
    async lease(holder, seconds) {
      const rows = unwrap(await db().rpc('defense_dm_lease', { p_holder: holder, p_seconds: seconds }), 'dm lease');
      return (Array.isArray(rows) ? rows[0] : rows) || null;
    },
    /** Move the cursor; false once the lease is lost. */
    async advance(holder, cursor) {
      return Boolean(unwrap(await db().rpc('defense_dm_advance', { p_holder: holder, p_cursor: cursor ?? null }), 'dm advance'));
    },
    /** Keep the moderator's session (already encrypted); false once the lease is lost. */
    async saveSession(holder, session, did) {
      return Boolean(unwrap(await db().rpc('defense_dm_save_session', { p_holder: holder, p_session: session, p_did: did }), 'dm session'));
    },
    async release(holder) {
      unwrap(await db().rpc('defense_dm_release', { p_holder: holder }), 'dm release');
    },
    /** Whether someone who hasn't linked is due the moderator's one line (at most daily). */
    async strangerDue(senderHash) {
      return Boolean(unwrap(await db().rpc('defense_dm_stranger_due', { p_sender_hash: senderHash }), 'dm stranger'));
    },
  };
}
