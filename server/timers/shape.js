// The timer rows the API answers with. Every row carries `clientKey: 'virga'`:
// the client treats it as "this app's row" and gates its actions on it, and
// with one app on this server every row is.

const CLIENT_KEY = 'virga';

/** A timer as create answers it. */
export function timerShape(row) {
  return {
    id: row.id,
    postUri: row.post_uri,
    collection: row.collection,
    snippet: row.snippet || null,
    postedAt: row.posted_at,
    checkAt: row.check_at,
    status: row.status,
    conditions: row.conditions || {},
    lifespanSeconds: row.lifespan_seconds,
    extensions: row.extensions || 0,
    // What the rule does when it fires, and once it has, what it actually did.
    // A gate applied at 3am with nothing saying why is unnerving; this is what
    // the page reads to say what happened.
    effects: row.effects || null,
    acted: row.acted || null,
    createdAt: row.created_at,
    clientKey: CLIENT_KEY,
  };
}

/** A timer as list answers it: the create shape plus how it settled and how its attempts went. */
export function timerListShape(row) {
  return {
    id: row.id,
    postUri: row.post_uri,
    collection: row.collection,
    snippet: row.snippet || null,
    postedAt: row.posted_at,
    checkAt: row.check_at,
    status: row.status,
    conditions: row.conditions || {},
    lifespanSeconds: row.lifespan_seconds,
    extensions: row.extensions || 0,
    lastCounts: row.last_counts || null,
    effects: row.effects || null,
    acted: row.acted || null,
    // A short sentence about how it settled ("kept, 7 likes", "deleted on
    // time"), written when the timer resolved. Null while it is still armed,
    // unless it carries the missed-deadline note.
    resolution: row.resolution || null,
    resolvedAt: row.resolved_at || null,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    lastError: row.last_error || null,
    lastErrorCode: row.last_error_code || null,
    createdAt: row.created_at,
    clientKey: CLIENT_KEY,
  };
}
