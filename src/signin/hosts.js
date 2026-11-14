// The hosts offered to someone who has no account yet. An account's handle
// and posts live on a host (a PDS); Virga doesn't run one, so making an
// account means choosing one of these and making it on their page.
//
// `url` is what a sign-in is started with: the host's address in place of a
// handle, with `prompt: 'create'`, which opens the host's page on making an
// account. Each host here listed `create` among its
// `prompt_values_supported` (/.well-known/oauth-authorization-server) when
// this was last checked, on 2026-11-14. `region` is where the host keeps its
// accounts' data, as the host describes itself.
//
// The same five that Anisota offers, in the same order.
export const SIGNUP_HOSTS = Object.freeze([
  { id: 'bluesky', name: 'Bluesky', domain: 'bsky.social', url: 'https://bsky.social', region: 'United States', recommended: true },
  { id: 'blacksky', name: 'Blacksky', domain: 'blacksky.app', url: 'https://blacksky.app', region: 'United States', recommended: false },
  { id: 'eurosky', name: 'Eurosky', domain: 'eurosky.social', url: 'https://eurosky.social', region: 'Germany', recommended: false },
  { id: 'selfhosted', name: 'self-hosted.social', domain: 'selfhosted.social', url: 'https://selfhosted.social', region: 'United States', recommended: false },
  { id: 'npmx', name: 'npmx', domain: 'npmx.social', url: 'https://npmx.social', region: 'Germany', recommended: false },
]);

// What a host's refusal can't be put down to: Virga's own server, the
// connection, a limit, or the reader calling it off. Trying again without
// the prompt wouldn't help, and after a cancel it would send the browser
// somewhere it was just told not to go.
const NOT_THE_HOST = new Set(['NETWORK_ERROR', 'RATE_LIMITED', 'VIRGA_CLIENT_UNAVAILABLE', 'REDIRECT_NOT_ALLOWED', 'CANCELLED', 'INTERNAL']);

/** Whether a failed sign-in is something other than the host saying no. */
export function notTheHosts(error) {
  if (NOT_THE_HOST.has(error?.code)) return true;
  if (error?.name === 'AbortError') return true;
  const message = String(error?.message || '');
  if (/navigated back|aborted/i.test(message)) return true;
  // A request that never arrived, as a browser sign-in's library reports it.
  return error?.name === 'TypeError' && /fetch|network|load failed/i.test(message);
}

/**
 * Send someone to `hostUrl` to make an account. A host that turns down the
 * request for its make-an-account page (older software doesn't know the
 * prompt) is asked again for its ordinary sign-in page, which has its own way
 * to make one. `signIn` is the session's; the promise normally never settles,
 * because the browser leaves. `options.signal` calls the whole thing off,
 * the second try included.
 */
export async function signUpAt(signIn, hostUrl, options = {}) {
  try {
    return await signIn(hostUrl, { ...options, intent: 'add', prompt: 'create' });
  } catch (error) {
    if (options.signal?.aborted || notTheHosts(error)) throw error;
    return signIn(hostUrl, { ...options, intent: 'add' });
  }
}
