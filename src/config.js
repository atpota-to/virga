// App-wide constants. Nothing here is a secret. The two build flags below
// (VITE_AUTH_MODE, VITE_BACKEND_URL) only say which sign-in a new account gets
// and where Virga's server is; the server's keys never reach the browser.

export const APP_NAME = 'Virga';

// Public reads go to the public AppView; identity comes from the PLC
// directory (or the host itself, for a did:web).
export const APPVIEW = 'https://public.api.bsky.app';
export const PLC_DIRECTORY = 'https://plc.directory';

// Where the atproto OAuth flow lands on the way back. Registered as the
// client's redirect URI (api/client-metadata.js serves the same path), and
// watched for by the session provider.
export const OAUTH_CALLBACK_PATH = '/oauth/callback';

// Where a sign-in through Virga's server lands. It must not start with
// OAUTH_CALLBACK_PATH: both the app and the provider test the path with
// startsWith, and a browser-mode callback is finished by a different library.
export const OAUTH_RETURN_PATH = '/oauth/return';

// `import.meta.env` is Vite's; this module is also loaded by the server
// (api/, server/), under plain Node, where it is undefined.
const ENV = import.meta.env || {};

/**
 * The sign-in a new account gets: 'browser' (OAuth in this browser, the
 * default, and what local dev and preview deployments use) or 'backend' (a
 * long session held by Virga's server). Each account keeps the mode it signed
 * in with, so the two live side by side.
 */
export const AUTH_MODE = ENV.VITE_AUTH_MODE === 'backend' ? 'backend' : 'browser';

/**
 * Virga's server: the sign-in for long sessions, and the scheduled posts,
 * timers and the adviser, which have to run while the browser is closed. Its
 * functions are this deployment's /api/*, so the default is '' (same origin).
 * VITE_BACKEND_URL points a dev server or a preview at another deployment
 * (that server has to list this origin as a frontend). No trailing slash.
 */
export const BACKEND_URL = String(ENV.VITE_BACKEND_URL || '').replace(/\/+$/, '');

/**
 * The server's host, for the sentences that name it: this site's own unless
 * VITE_BACKEND_URL says otherwise. Read at render, so a module that imports
 * this still loads where there is no window.
 */
export function backendHost(base = BACKEND_URL) {
  try {
    if (base) return new URL(base).host;
    return typeof window !== 'undefined' && window.location ? window.location.host : '';
  } catch {
    return base;
  }
}

// The Bluesky AppView, as the service the signed-in reads are sent to. `%23`
// is `#`, encoded as the permission spec writes it in a scope string.
const BSKY_APPVIEW_AUD = 'did:web:api.bsky.app%23bsky_appview';

const appview = (nsid) => `rpc:${nsid}?aud=${BSKY_APPVIEW_AUD}`;

/**
 * What a sign-in asks for, grouped by what it's for. Settings › Permissions
 * and the README are written from this list, so a token can't be asked for
 * without a sentence saying why. The syntax is the permission spec's
 * (https://atproto.com/specs/permission).
 *
 * `repo:app.bsky.feed.post` grants create, update and delete: scheduled
 * posts are published by Virga's server with putRecord, so a retry can't
 * post twice. Virga's own screens never edit a published post.
 *
 * Every `rpc:` audience is either a service (`did#service`, written `%23`)
 * or `*`. The three `aud=*` tokens are for minting service-auth tokens
 * (getServiceAuth names a bare DID as the audience: the video service, or the
 * account's own PDS), which a service-scoped token can't match.
 *
 * Virga's server imports OAUTH_SCOPE from here for its long-session
 * sign-in, so the two can't drift apart.
 */
export const PERMISSION_GROUPS = [
  {
    key: 'identity',
    title: 'Know who you are.',
    text: 'Your DID and handle, so Virga knows whose archive to open.',
    tokens: ['atproto'],
  },
  {
    key: 'followers',
    title: 'Read your follower list, as you.',
    text: 'Only a signed-in read carries each follower’s follow record, which is what dates the growth curve.',
    tokens: [appview('app.bsky.graph.getFollowers')],
  },
  {
    key: 'notifications',
    title: 'Read your notifications.',
    text: 'Who liked, reposted, replied to, quoted and mentioned you.',
    tokens: [appview('app.bsky.notification.listNotifications')],
  },
  {
    key: 'follow',
    title: 'Follow and unfollow, when you press the button.',
    text: 'Create and delete follow records, for the Follow buttons, Follow cleanup and the Follow-back queue.',
    tokens: ['repo:app.bsky.graph.follow?action=create&action=delete'],
  },
  {
    key: 'post',
    title: 'Post, reply and delete posts, when you ask it to.',
    text: 'Write posts and threads, set who can reply and quote, and delete a post you choose or one whose timer runs out. A scheduled post is written by Virga’s server at the time you picked.',
    tokens: ['repo:app.bsky.feed.post', 'repo:app.bsky.feed.threadgate', 'repo:app.bsky.feed.postgate'],
  },
  {
    key: 'templates',
    title: 'Keep post templates in your repo.',
    text: 'Templates are records in your own repo, where anyone can read them, and where other apps that use the same format find them too.',
    tokens: ['repo:net.anisota.feed.template'],
  },
  {
    key: 'media',
    title: 'Upload images and video for your posts.',
    text: 'Pictures and videos go to your PDS, and videos through Bluesky’s video service, which needs a short-lived pass from your PDS.',
    tokens: [
      'blob:image/*',
      'blob:video/*',
      'rpc:com.atproto.repo.uploadBlob?aud=*',
      'rpc:app.bsky.video.getUploadLimits?aud=*',
      'rpc:app.bsky.video.getJobStatus?aud=*',
    ],
  },
  {
    key: 'drafts',
    title: 'Keep drafts with Bluesky.',
    text: 'Your drafts are Bluesky’s private drafts, so they’re there in any app that reads them, and only you can see them.',
    tokens: [
      appview('app.bsky.draft.getDrafts'),
      appview('app.bsky.draft.createDraft'),
      appview('app.bsky.draft.updateDraft'),
      appview('app.bsky.draft.deleteDraft'),
    ],
  },
  {
    key: 'compose',
    title: 'Read what a new post needs.',
    text: 'Your default reply settings, your saved posts (for the embed library) and post search.',
    tokens: [
      appview('app.bsky.actor.getPreferences'),
      appview('app.bsky.bookmark.getBookmarks'),
      appview('app.bsky.feed.searchPosts'),
    ],
  },
];

// The order the tokens are asked for in. Pinned by oauthClient.test.js, and
// what Virga's server requests for a long session, so it is spelled out
// rather than built from the groups above (which are ordered for reading).
export const OAUTH_SCOPE = [
  'atproto',
  appview('app.bsky.graph.getFollowers'),
  appview('app.bsky.notification.listNotifications'),
  'repo:app.bsky.graph.follow?action=create&action=delete',
  'repo:app.bsky.feed.post',
  'repo:app.bsky.feed.threadgate',
  'repo:app.bsky.feed.postgate',
  'repo:net.anisota.feed.template',
  'blob:image/*',
  'blob:video/*',
  appview('app.bsky.draft.getDrafts'),
  appview('app.bsky.draft.createDraft'),
  appview('app.bsky.draft.updateDraft'),
  appview('app.bsky.draft.deleteDraft'),
  appview('app.bsky.actor.getPreferences'),
  appview('app.bsky.bookmark.getBookmarks'),
  appview('app.bsky.feed.searchPosts'),
  'rpc:com.atproto.repo.uploadBlob?aud=*',
  'rpc:app.bsky.video.getUploadLimits?aud=*',
  'rpc:app.bsky.video.getJobStatus?aud=*',
].join(' ');

/**
 * The tokens a session must have been granted to post: without them a write
 * fails with "Missing required scope", so the app asks for a fresh sign-in
 * instead of letting it. Sessions from before posting arrived lack them.
 */
export const POSTING_TOKENS = [
  'repo:app.bsky.feed.post',
  'repo:app.bsky.feed.threadgate',
  'repo:app.bsky.feed.postgate',
  'blob:image/*',
];
