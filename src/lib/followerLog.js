// Who left and who arrived between two complete follower sweeps.
//
// An unfollow deletes the follow record, so the follower list can never say
// who used to be on it. The only record of an unfollow is a comparison: the
// list as it stood at the last complete sync against the list now. Each
// sync that has a complete list on both sides adds its differences to a log,
// newest first, kept in the archive's meta store under 'followerLog'.
//
//   entry { did, kind: 'lost' | 'gained', at, since, handle, displayName,
//           avatar, followedAt }
//
// `at` is the sync that noticed the change and `since` the one before it:
// the change happened somewhere between the two.

/** How many entries the log keeps. The oldest go first. */
export const FOLLOWER_LOG_LIMIT = 5000;

function cardOf(row) {
  return {
    did: row.did,
    handle: row.handle || '',
    displayName: row.displayName || '',
    avatar: row.avatar || '',
    followedAt: row.followedAt || null,
  };
}

/**
 * The differences between two follower lists, as log entries. Lost first,
 * then gained; each in the order its list held them.
 */
export function followerChanges(before, after, { at, since = null } = {}) {
  const was = new Set((before || []).map((f) => f.did));
  const now = new Set((after || []).map((f) => f.did));
  const lost = (before || []).filter((f) => f?.did && !now.has(f.did)).map((f) => ({ ...cardOf(f), kind: 'lost', at, since }));
  const gained = (after || []).filter((f) => f?.did && !was.has(f.did)).map((f) => ({ ...cardOf(f), kind: 'gained', at, since }));
  return [...lost, ...gained];
}

/**
 * The log with a sync's changes put in front: `{ entries, lastSyncAt }`.
 * A sync that changed nothing still moves `lastSyncAt`, so the tracker can
 * say "nothing since <then>".
 */
export function mergeFollowerLog(held, changes, at) {
  const entries = [...(changes || []), ...((held && held.entries) || [])].slice(0, FOLLOWER_LOG_LIMIT);
  return { entries, lastSyncAt: at, firstSyncAt: held?.firstSyncAt || at };
}
