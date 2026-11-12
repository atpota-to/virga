// Reading atproto permission strings: what a token says, whether it is well
// formed, and whether what a session was granted covers what Virga asks for.
// The grammar is https://atproto.com/specs/permission (read 2026-11-12):
//
//   resource[:positional][?name=value&name=value…]
//
// An authorization server may hand back the granted scope in its own spelling
// (the positional as a parameter, parameters in another order, a broader
// token than the one asked for), so comparisons are made on parsed tokens,
// never on the raw strings.

const NSID = /^[a-zA-Z](?:[a-zA-Z0-9-]{0,62})(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,62})?)+\.[a-zA-Z][a-zA-Z0-9]{0,62}$/;
const REPO_ACTIONS = ['create', 'delete', 'update'];
// A service reference: a DID, then `#` and the service id. In the scope
// string the `#` is percent-encoded, and URLSearchParams has decoded it here.
const SERVICE_REF = /^did:[a-z]+:[a-zA-Z0-9._:%-]+#[a-zA-Z0-9_-]+$/;
const MIME_PATTERN = /^(?:\*\/\*|[a-z0-9][a-z0-9.+-]*\/(?:\*|[a-z0-9][a-z0-9.+-]*))$/i;
const TRANSITION = ['generic', 'email', 'chat.bsky'];

function isNsidOrStar(value) {
  return value === '*' || NSID.test(value);
}

/**
 * Parse one scope token. Returns a normalized description, or null when the
 * token doesn't follow the grammar (or names a resource Virga has no reading
 * for, which for these purposes is the same thing).
 *
 *   { resource: 'atproto' }
 *   { resource: 'transition', kind }
 *   { resource: 'repo', collection, actions: string[] }
 *   { resource: 'rpc', lxm, aud }
 *   { resource: 'blob', accept: string[] }
 */
export function parseScopeToken(token) {
  if (typeof token !== 'string' || !token || /\s/.test(token)) return null;
  // A raw `#` would end a URL's query; the spec writes it as %23.
  if (token.includes('#')) return null;
  const q = token.indexOf('?');
  const head = q < 0 ? token : token.slice(0, q);
  const params = new URLSearchParams(q < 0 ? '' : token.slice(q + 1));
  const colon = head.indexOf(':');
  const resource = colon < 0 ? head : head.slice(0, colon);
  let positional = null;
  try {
    positional = colon < 0 ? null : decodeURIComponent(head.slice(colon + 1));
  } catch {
    return null;
  }
  const names = new Set(params.keys());
  const only = (...allowed) => [...names].every((n) => allowed.includes(n));

  switch (resource) {
    case 'atproto':
      return positional === null && names.size === 0 ? { resource } : null;

    case 'transition':
      return TRANSITION.includes(positional) && names.size === 0 ? { resource, kind: positional } : null;

    case 'repo': {
      if (!only('collection', 'action')) return null;
      const collections = positional !== null ? [positional] : params.getAll('collection');
      if (positional !== null && names.has('collection')) return null;
      if (collections.length !== 1 || !isNsidOrStar(collections[0])) return null;
      const actions = params.getAll('action');
      if (actions.some((a) => !REPO_ACTIONS.includes(a))) return null;
      return { resource, collection: collections[0], actions: actions.length ? [...new Set(actions)].sort() : [...REPO_ACTIONS] };
    }

    case 'rpc': {
      if (!only('lxm', 'aud')) return null;
      const lxms = positional !== null ? [positional] : params.getAll('lxm');
      if (positional !== null && names.has('lxm')) return null;
      const auds = params.getAll('aud');
      if (lxms.length !== 1 || !isNsidOrStar(lxms[0])) return null;
      if (auds.length !== 1) return null;
      const aud = auds[0];
      if (aud !== '*' && !SERVICE_REF.test(aud)) return null;
      // A token that reaches every method of every service is refused by
      // the spec; it would be a blank cheque.
      if (aud === '*' && lxms[0] === '*') return null;
      return { resource, lxm: lxms[0], aud };
    }

    case 'blob': {
      if (!only('accept')) return null;
      const accept = positional !== null ? [positional] : params.getAll('accept');
      if (positional !== null && names.has('accept')) return null;
      if (!accept.length || accept.some((m) => !MIME_PATTERN.test(m))) return null;
      return { resource, accept: accept.map((m) => m.toLowerCase()) };
    }

    default:
      return null;
  }
}

/** Whether a token follows the permission grammar. */
export function isValidScopeToken(token) {
  return parseScopeToken(token) !== null;
}

function mimeCovers(have, want) {
  if (have === '*/*') return true;
  const [ht, hs] = have.split('/');
  const [wt, ws] = want.split('/');
  if (ht !== wt) return false;
  return hs === '*' || hs === ws;
}

/** Does one granted (parsed) token cover one wanted (parsed) token? */
function tokenCovers(have, want) {
  if (have.resource === 'transition' && have.kind === 'generic') {
    // The broad transitional grant reaches repo writes, blobs and service
    // calls, though Virga never asks for it.
    return want.resource === 'repo' || want.resource === 'blob' || want.resource === 'rpc';
  }
  if (have.resource !== want.resource) return false;
  switch (want.resource) {
    case 'atproto':
      return true;
    case 'repo':
      return (have.collection === '*' || have.collection === want.collection) && want.actions.every((a) => have.actions.includes(a));
    case 'rpc':
      return (have.lxm === '*' || have.lxm === want.lxm) && (have.aud === '*' || have.aud === want.aud);
    case 'blob':
      return want.accept.every((w) => have.accept.some((h) => mimeCovers(h, w)));
    case 'transition':
      return have.kind === want.kind;
    default:
      return false;
  }
}

/**
 * The tokens in `wanted` that `granted` doesn't cover. Only well-formed
 * wanted tokens are considered: a malformed one can't be granted by anyone,
 * and reporting it as missing would send people round a sign-in that can
 * never fix it. Granted tokens that don't parse are ignored.
 *
 * @param {string|string[]} granted the session's scope (space-separated, or a list)
 * @param {string|string[]} wanted
 */
export function missingScopes(granted, wanted) {
  const list = (v) => (Array.isArray(v) ? v : String(v || '').split(/\s+/)).filter(Boolean);
  const have = list(granted).map(parseScopeToken).filter(Boolean);
  return list(wanted).filter((token) => {
    const want = parseScopeToken(token);
    if (!want) return false;
    return !have.some((h) => tokenCovers(h, want));
  });
}

/** A write refused because the session wasn't granted the permission for it. */
export function isMissingScopeError(err) {
  const text = `${err?.error || ''} ${err?.message || ''}`;
  return /missing required scope|insufficient.?scope|ScopeMissing/i.test(text);
}
