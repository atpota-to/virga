// The window events the posting section speaks in. A service dispatches one
// after a write has succeeded; pages and the composer only listen. Every
// event's detail names the account it is about (`detail.did`), because more
// than one account can be signed in and a page must ignore the others.
//
//   virga:posting-settings   { did, settings }        settings.js
//   virga:templates-changed  { did, templates }       templates/templateService.js
//   virga:drafts-changed     { did, id, action }      drafts/drafts.js; action is
//                                                     'created' | 'updated' | 'deleted'
//   virga:scheduled-changed  { did, ... }             schedule/
//   virga:timers-changed     { did, ... }             timers/
//   virga:posts-changed      { did, added, removed }  after a publish or a delete
//
// `added` is [{ uri, cid, record }] and `removed` is [uri]; the archive
// applies both for its own account.

export const POSTING_EVENTS = Object.freeze({
  settings: 'virga:posting-settings',
  templates: 'virga:templates-changed',
  drafts: 'virga:drafts-changed',
  scheduled: 'virga:scheduled-changed',
  timers: 'virga:timers-changed',
  posts: 'virga:posts-changed',
});

export const POSTING_SETTINGS_EVENT = POSTING_EVENTS.settings;
export const TEMPLATES_CHANGED_EVENT = POSTING_EVENTS.templates;
export const DRAFTS_CHANGED_EVENT = POSTING_EVENTS.drafts;
export const SCHEDULED_CHANGED_EVENT = POSTING_EVENTS.scheduled;
export const TIMERS_CHANGED_EVENT = POSTING_EVENTS.timers;
export const POSTS_CHANGED_EVENT = POSTING_EVENTS.posts;

const NAMES = new Set(Object.values(POSTING_EVENTS));

function defaultTarget() {
  return typeof window !== 'undefined' &&
    typeof window.dispatchEvent === 'function'
    ? window
    : null;
}

function checkName(name) {
  if (!NAMES.has(name)) throw new TypeError(`Not a posting event: ${name}`);
}

/**
 * Dispatch `name` with `detail` on the window (or `target`). Throws on an
 * unknown name or a detail without a DID: both are mistakes in the caller,
 * and an event nobody can attribute to an account is worse than none.
 * Returns false when there is nowhere to dispatch (no window, as in tests).
 */
export function emitPostingEvent(name, detail, target = defaultTarget()) {
  checkName(name);
  if (!detail || typeof detail.did !== 'string' || !detail.did) {
    throw new TypeError(`${name} needs detail.did`);
  }
  if (!target) return false;
  target.dispatchEvent(new CustomEvent(name, { detail }));
  return true;
}

/**
 * Listen for `name`. `fn` gets the detail. With `did`, only that account's
 * events reach it. Returns the function that stops listening.
 */
export function onPostingEvent(
  name,
  fn,
  { did, target = defaultTarget() } = {},
) {
  checkName(name);
  if (typeof fn !== 'function' || !target) return () => {};
  const handler = (event) => {
    const detail = event?.detail;
    if (!detail || (did && detail.did !== did)) return;
    fn(detail);
  };
  target.addEventListener(name, handler);
  return () => target.removeEventListener(name, handler);
}

/**
 * `virga:posts-changed` for `did`, with `added` and `removed` always arrays
 * so a listener never has to guard them. Rows without a URI are dropped.
 */
export function emitPostsChanged(
  did,
  { added = [], removed = [] } = {},
  target,
) {
  const detail = {
    did,
    added: (added || [])
      .filter((p) => p && typeof p.uri === 'string' && p.uri)
      .map((p) => ({
        uri: p.uri,
        cid: p.cid || null,
        record: p.record || null,
      })),
    removed: (removed || []).filter((uri) => typeof uri === 'string' && uri),
  };
  return emitPostingEvent(POSTS_CHANGED_EVENT, detail, target);
}
