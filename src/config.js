// App-wide constants. Nothing here is a secret: Virga has no server of its
// own and no keys.

export const APP_NAME = 'Virga';

// Public reads go to the public AppView; identity comes from the PLC
// directory (or the host itself, for a did:web).
export const APPVIEW = 'https://public.api.bsky.app';
export const PLC_DIRECTORY = 'https://plc.directory';

// Where the atproto OAuth flow lands on the way back. Registered as the
// client's redirect URI (api/client-metadata.js serves the same path), and
// watched for by the session provider.
export const OAUTH_CALLBACK_PATH = '/oauth/callback';

// The Bluesky AppView, as the service the two signed-in reads are sent to.
// `%23` is `#`, encoded as the permission spec writes it in a scope string.
const BSKY_APPVIEW_AUD = 'did:web:api.bsky.app%23bsky_appview';

/**
 * What a sign-in asks for, and nothing more:
 *
 *   atproto                       who you are
 *   rpc …graph.getFollowers       your follower list, read as you, because
 *                                 only a signed-in read carries each
 *                                 follower's follow record (which dates it)
 *   rpc …listNotifications        who liked, reposted, replied to, quoted
 *                                 and mentioned you
 *   repo app.bsky.graph.follow    the Follow buttons, Follow cleanup and the
 *                                 Follow-back queue: create and delete
 *                                 follow records
 *
 * Everything else the dashboard reads is public and fetched without the
 * session. See https://atproto.com/specs/permission for the syntax.
 *
 * Keep in step with api/client-metadata.js, which has to declare the same
 * string for a hosted sign-in to be accepted.
 */
export const OAUTH_SCOPE = [
  'atproto',
  `rpc:app.bsky.graph.getFollowers?aud=${BSKY_APPVIEW_AUD}`,
  `rpc:app.bsky.notification.listNotifications?aud=${BSKY_APPVIEW_AUD}`,
  'repo:app.bsky.graph.follow?action=create&action=delete',
].join(' ');
