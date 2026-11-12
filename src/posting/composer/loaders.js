// Reading what an intent names before the composer shows it: the post being
// replied to, a record to quote, a Bluesky draft, a scheduled post. Public
// reads go to the public AppView (the write account's own agent isn't asked
// for anything its scope doesn't hold). Every dependency can be injected, so
// the tests run without a network.

import {
  getPosts as defaultGetPosts,
  publicXrpc,
  resolveHandle as defaultResolveHandle,
} from '../library/sources.js';
import { recordUri } from '../lib/postLink.js';
import { isOwnThreadRow } from '../library/model.js';

const str = (v) => (typeof v === 'string' ? v : '');

/** A coded error with a sentence to show. */
export function loadError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/** The at:// URI a target ref names, resolving a handle when it has to. */
export async function refUri(
  ref,
  { resolveHandle = defaultResolveHandle, fetch, signal } = {},
) {
  if (!ref) return null;
  if (ref.uri) return ref.uri;
  const did = ref.did || (await resolveHandle(ref.handle, { fetch, signal }));
  if (!did) return null;
  return recordUri(did, ref.kind, ref.rkey);
}

/** A post view as ComposerState.reply: the refs, and who and what it is. */
export function replyFromView(view) {
  if (!view?.uri || !view.cid) return null;
  const parentRoot = view.record?.reply?.root;
  return {
    uri: view.uri,
    cid: view.cid,
    root:
      parentRoot?.uri && parentRoot?.cid
        ? { uri: parentRoot.uri, cid: parentRoot.cid }
        : { uri: view.uri, cid: view.cid },
    author: view.author
      ? {
          did: view.author.did,
          handle: view.author.handle,
          displayName: view.author.displayName || '',
          avatar: view.author.avatar || null,
        }
      : undefined,
    text: str(view.record?.text),
    view,
  };
}

async function onePost(uri, { getPosts, fetch, signal }) {
  const { views, failed, error } = await getPosts([uri], { fetch, signal });
  if (failed)
    throw (
      error ||
      loadError(
        'READ_FAILED',
        'Couldn’t read that post. Check your connection and try again.',
      )
    );
  return views.find((v) => v?.uri === uri) || views[0] || null;
}

/** The post a reply answers, as ComposerState.reply. Throws with a sentence. */
export async function loadReplyTarget(
  ref,
  { getPosts = defaultGetPosts, resolveHandle, fetch, signal } = {},
) {
  const uri = await refUri(ref, { resolveHandle, fetch, signal });
  if (!uri) throw loadError('NOT_FOUND', 'Couldn’t find the post to reply to.');
  const view = await onePost(uri, { getPosts, fetch, signal });
  const reply = replyFromView(view);
  if (!reply)
    throw loadError(
      'GONE',
      'The post you’re replying to is gone, or can’t be seen.',
    );
  return reply;
}

/**
 * A record to attach (post, feed, list or starter pack) as a PostDraft's
 * `record`: `{ kind, uri, cid, view }`. Throws with a sentence when it can't
 * be read or is gone.
 */
export async function loadRecordTarget(
  ref,
  {
    getPosts = defaultGetPosts,
    resolveHandle,
    xrpc = publicXrpc,
    fetch,
    signal,
  } = {},
) {
  const uri = await refUri(ref, { resolveHandle, fetch, signal });
  const noun =
    { post: 'post', feed: 'feed', list: 'list', starterpack: 'starter pack' }[
      ref?.kind
    ] || 'post';
  if (!uri) throw loadError('NOT_FOUND', `Couldn’t find that ${noun}.`);
  let view = null;
  try {
    if (ref.kind === 'post')
      view = await onePost(uri, { getPosts, fetch, signal });
    else if (ref.kind === 'feed')
      view =
        (
          await xrpc(
            'app.bsky.feed.getFeedGenerator',
            { feed: uri },
            { fetch, signal },
          )
        )?.view || null;
    else if (ref.kind === 'list')
      view =
        (
          await xrpc(
            'app.bsky.graph.getList',
            { list: uri, limit: 1 },
            { fetch, signal },
          )
        )?.list || null;
    else if (ref.kind === 'starterpack')
      view =
        (
          await xrpc(
            'app.bsky.graph.getStarterPack',
            { starterPack: uri },
            { fetch, signal },
          )
        )?.starterPack || null;
  } catch (err) {
    if (err?.status === 400 || err?.status === 404) view = null;
    else
      throw loadError(
        'READ_FAILED',
        `Couldn’t read that ${noun}. Check your connection and try again.`,
      );
  }
  if (!view?.uri || !view.cid)
    throw loadError('GONE', `That ${noun} is gone, so it can’t be attached.`);
  return { kind: ref.kind, uri: view.uri, cid: view.cid, view };
}

/**
 * A Bluesky draft for the composer, as its owner: `{ state, missing }`
 * (openDraft's). Throws with a sentence when it can't be found.
 */
export async function loadDraftTarget({
  draftId,
  ownerDid,
  agentFor,
  listAllDrafts,
  openDraft,
  defaults,
}) {
  let agent;
  try {
    agent = await agentFor(ownerDid);
  } catch {
    throw loadError(
      'REAUTH_REQUIRED',
      'This draft’s account needs to sign in again before it can be opened.',
    );
  }
  let all;
  try {
    all = await listAllDrafts(agent);
  } catch {
    throw loadError(
      'READ_FAILED',
      'Couldn’t read your drafts from Bluesky. Try again.',
    );
  }
  const view = (all || []).find((d) => d?.id === draftId);
  if (!view)
    throw loadError(
      'GONE',
      'That draft is gone. It may have been posted or deleted in another app.',
    );
  return openDraft(view, { asDid: ownerDid, defaults });
}

/**
 * A scheduled post for the composer: getScheduled, its images, then
 * reconstructFromScheduled. Only Virga's own rows that haven't gone out can
 * be changed here.
 */
export async function loadScheduledTarget({
  id,
  asDid,
  req,
  getScheduled,
  getScheduledMedia,
  reconstructFromScheduled,
}) {
  if (!req)
    throw loadError(
      'NEEDS_BACKEND',
      'Scheduled posts need a long session through Virga’s server.',
    );
  let row;
  try {
    row = await getScheduled(req, id);
  } catch (err) {
    if (err?.status === 404)
      throw loadError(
        'GONE',
        'That scheduled post is gone. It may already have gone out.',
      );
    throw loadError(
      'READ_FAILED',
      'Couldn’t read that scheduled post. Try again.',
    );
  }
  if (!row)
    throw loadError(
      'GONE',
      'That scheduled post is gone. It may already have gone out.',
    );
  if ((row.clientKey || 'anisota') !== 'virga') {
    throw loadError(
      'NOT_YOURS',
      'This post was scheduled in Anisota, so it can only be changed there.',
    );
  }
  if (row.partial)
    throw loadError(
      'PARTIAL',
      'Part of this thread has already gone out, so it can’t be changed. Retry or cancel it in Scheduled posts.',
    );
  if (!['pending', 'failed'].includes(row.status)) {
    throw loadError(
      'NOT_EDITABLE',
      'This post is going out right now, so it can’t be changed.',
    );
  }
  const hasMedia =
    row.payload?.media && Object.keys(row.payload.media).length > 0;
  let media = {};
  if (hasMedia) {
    try {
      media = await getScheduledMedia(req, id);
    } catch {
      throw loadError(
        'READ_FAILED',
        'Couldn’t read this post’s images from Virga’s server. Try again.',
      );
    }
  }
  return { state: reconstructFromScheduled(row, media, { asDid }), row };
}

/**
 * The account's own latest posts to continue, newest first, from its
 * archive rows: top-level posts and continuations of its own threads.
 */
export function continueCandidates(rows, did, limit = 5) {
  const time = (r) => Date.parse(r?.at || '') || 0;
  return (rows || [])
    .filter(
      (r) =>
        r?.uri?.startsWith(`at://${did}/app.bsky.feed.post/`) &&
        isOwnThreadRow(r, did),
    )
    .sort((a, b) => time(b) - time(a))
    .slice(0, limit);
}
