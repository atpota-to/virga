// Whether the moderator answers someone who hasn't linked it: its one line,
// the same for everyone, at most once a day. Kept by a hash of the sender's
// DID (../linking.js), so no list of who wrote to the moderator is kept. Not
// bound to an owner: a stranger isn't one.

import { getSupabaseClient } from '../../supabase.js';
import { StoreUnavailable } from '../store.js';

export async function strangerDue(senderHash, { client = null } = {}) {
  const c = client ?? getSupabaseClient();
  if (!c) throw new StoreUnavailable();
  const { data, error } = await c.rpc('defense_dm_stranger_due', { p_sender_hash: senderHash });
  if (error) throw new Error(`dm stranger: ${error.message || error.code || 'database error'}`);
  return Boolean(data);
}
