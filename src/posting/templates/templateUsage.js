/**
 * How often each post template has been used, kept in this browser so using
 * a template never rewrites its record (a write per use would churn the repo
 * for a number nobody else needs).
 *
 * Stored per account under `virga:template-usage:<did>`. Signing out keeps
 * the counts: they are the writer's own history and nothing regenerates
 * them. Removing the account from this browser can delete them
 * (src/session/accounts.js lists the key). Without a DID nothing is read or
 * written.
 */

export const TEMPLATE_USAGE_PREFIX = 'virga:template-usage:';

export function templateUsageKey(did) {
  return `${TEMPLATE_USAGE_PREFIX}${did}`;
}

// Deleted templates leave their counts behind; past this many entries the
// least recently used are dropped so the key stays small.
const MAX_ENTRIES = 500;

function localStore() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function sanitize(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const out = {};
  for (const [rkey, entry] of Object.entries(parsed)) {
    if (!rkey || !entry || typeof entry !== 'object') continue;
    const count = Number.isFinite(entry.count)
      ? Math.max(0, Math.floor(entry.count))
      : 0;
    if (!count) continue;
    const lastUsedAt =
      typeof entry.lastUsedAt === 'string' &&
      !Number.isNaN(Date.parse(entry.lastUsedAt))
        ? entry.lastUsedAt
        : null;
    out[rkey] = { count, lastUsedAt };
  }
  return out;
}

/** This account's counts: `{ [rkey]: { count, lastUsedAt } }`, `{}` when none. */
export function readTemplateUsage(did, { store = localStore() } = {}) {
  if (!did || !store) return {};
  try {
    const raw = store.getItem(templateUsageKey(did));
    return raw ? sanitize(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

const usedAtMs = (entry) =>
  entry?.lastUsedAt ? Date.parse(entry.lastUsedAt) : 0;

/**
 * Count one use of the template at `rkey`. Returns its entry after the use, or
 * null when there is no template or no account to count it for.
 */
export function recordTemplateUse(
  rkey,
  did,
  now = new Date(),
  { store = localStore() } = {},
) {
  if (!rkey || typeof rkey !== 'string' || !did) return null;
  const at =
    now instanceof Date && !Number.isNaN(now.getTime()) ? now : new Date();
  const usage = readTemplateUsage(did, { store });
  const entry = {
    count: (usage[rkey]?.count || 0) + 1,
    lastUsedAt: at.toISOString(),
  };
  usage[rkey] = entry;

  let kept = usage;
  const rkeys = Object.keys(usage);
  if (rkeys.length > MAX_ENTRIES) {
    kept = {};
    rkeys
      .sort((a, b) => usedAtMs(usage[b]) - usedAtMs(usage[a]))
      .slice(0, MAX_ENTRIES)
      .forEach((key) => {
        kept[key] = usage[key];
      });
  }
  try {
    store?.setItem(templateUsageKey(did), JSON.stringify(kept));
  } catch {
    // Counted for this visit only.
  }
  return entry;
}

const groupOf = (template) => String(template?.group || '').trim();
const nameOf = (template) => String(template?.name || '');

/**
 * Templates in shelf order: grouped (groups by name, ungrouped last), the most
 * used first within a group, then by name. Returns a new array.
 */
export function sortTemplatesForShelf(templates, usage) {
  const counts = usage && typeof usage === 'object' ? usage : {};
  const countOf = (template) => counts[template?.rkey]?.count || 0;
  return [...(templates || [])].filter(Boolean).sort((a, b) => {
    const ga = groupOf(a);
    const gb = groupOf(b);
    if (ga !== gb) {
      if (!ga) return 1;
      if (!gb) return -1;
      // Groups that differ only in case sort together but stay apart.
      return (
        ga.localeCompare(gb, undefined, { sensitivity: 'base' }) ||
        (ga < gb ? -1 : 1)
      );
    }
    return (
      countOf(b) - countOf(a) ||
      nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: 'base' }) ||
      String(a.rkey || '').localeCompare(String(b.rkey || ''))
    );
  });
}
