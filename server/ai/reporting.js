/**
 * AI Gateway Custom Reporting metadata
 *
 * Builds the `{ user, tags }` attached to every Vercel AI Gateway request so
 * usage is attributed in the gateway's Custom Reporting dashboard / API:
 *
 *   - user: the requester's DID, so the accounts that drove the most requests
 *     or spend can be seen (group_by=user).
 *   - tags: `app:virga`, the deployment environment when Vercel names one
 *     (`env:production` | `env:preview` | `env:development`), and the feature
 *     that made the call (`feature:alt-text`, `feature:posting-adviser`), so
 *     cost can be attributed per feature.
 *
 * The gateway accepts these via `providerOptions.gateway.{user,tags}` on the
 * OpenAI-compatible chat completions body (see gateway.js). Reporting is on by
 * default; set AI_GATEWAY_REPORTING=false to disable it (the API bills a small
 * per-write charge for each unique user/tag).
 *
 * Docs: https://vercel.com/docs/ai-gateway/observability/custom-reporting
 * Limits enforced here: user <= 256 chars; <= 10 tags; each tag 1-64 chars.
 */

export const APP_TAG = 'app:virga';
const ENV_TAGS = new Set(['production', 'preview', 'development']);

const MAX_TAGS = 10;
const MAX_TAG_LEN = 64;
const MAX_USER_LEN = 256;

/** Trim + length-cap a user id (DID). Returns undefined when there's nothing usable. */
export function normalizeUser(user) {
  if (typeof user !== 'string') return undefined;
  const trimmed = user.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, MAX_USER_LEN);
}

/** Trim, length-cap, dedupe and bound a list of tags to the gateway's limits. */
export function normalizeTags(tags) {
  const out = [];
  const seen = new Set();
  for (const tag of Array.isArray(tags) ? tags : []) {
    if (typeof tag !== 'string') continue;
    const t = tag.trim().slice(0, MAX_TAG_LEN);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_TAGS) break;
  }
  return out;
}

/** Whether reporting is enabled (default true; AI_GATEWAY_REPORTING=false opts out). */
export function isEnabled(env = process.env) {
  return (
    String(env.AI_GATEWAY_REPORTING || 'true')
      .trim()
      .toLowerCase() !== 'false'
  );
}

/**
 * Build the `{ user, tags }` reporting metadata for an AI Gateway call.
 * Safe to spread straight into chatDetailed()/chatJSON().
 *
 * @param {Object} opts
 * @param {string} [opts.feature] - feature label, e.g. 'alt-text' (becomes `feature:<label>`)
 * @param {string} [opts.did] - the requester's DID; only attached when it looks like a DID
 * @param {Object} [opts.env] - the environment (process.env by default)
 * @returns {{ user?: string, tags: string[] }}
 */
export function buildReporting({ feature, did, env = process.env } = {}) {
  if (!isEnabled(env)) return { tags: [] };

  const tags = [APP_TAG];

  // Preview traffic is the team trying things; keeping it apart keeps the
  // production numbers honest.
  const deployment =
    typeof env.VERCEL_ENV === 'string' ? env.VERCEL_ENV.trim() : '';
  if (ENV_TAGS.has(deployment)) tags.push(`env:${deployment}`);

  if (typeof feature === 'string' && feature.trim()) {
    tags.push(`feature:${feature.trim()}`);
  }

  // Only attach a `user` when it's actually a DID — keeps junk out of the
  // per-user report.
  const user =
    typeof did === 'string' && did.startsWith('did:')
      ? normalizeUser(did)
      : undefined;

  const out = { tags: normalizeTags(tags) };
  if (user) out.user = user;
  return out;
}
