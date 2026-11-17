// A scan of one post: who engaged with it, and how close each of them is to
// you. The pieces are harvest.js (who did what, from Constellation) and
// score.js (how close, from the AppView, checked by a canary); this puts them
// in order for the page, says how far along it is, and words what went wrong.
//
// Nothing here writes anything. A scan is read-only and free (docs/DEFENSE.md,
// phase 2): what it finds is shown, and kept in memory until it is replaced.
//
// The canary comes from the archive. score.js wants accounts you follow that
// other people you follow also follow, best first; the archive knows who you
// follow, who follows you and who engages with you, so the people you follow
// who follow you back and talk to you most are asked first. They are the
// likeliest to sit inside your circle, which is what gives them a count.

import { isMissingScopeError } from '../session/scopes.js';
import { parsePostLink } from '../posting/lib/postLink.js';
import { resolveHandle as publicResolveHandle } from '../posting/library/sources.js';
import { harvestPost } from './harvest.js';
import { pause } from './limit.js';
import { PROFILE_BATCH, ScoreError, createScorer, findCanary, publicRelationships, summarise, withoutSelves } from './score.js';

const POST = 'app.bsky.feed.post';

/**
 * How many of your follows are offered to `findCanary`. It reads at most a few
 * batches of them; past that the lookup is down or nobody you follow is
 * followed by anyone else you follow, and more candidates won't change it.
 */
export const CANARY_CANDIDATES = PROFILE_BATCH * 6;

/** The pause before looking for a canary a second time. */
const SECOND_LOOK_MS = 1500;

/** What went wrong, as a code the page can word and a sentence it can show. */
export class ScanError extends Error {
  constructor(message, { code, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ScanError';
    this.code = code;
  }
}

/** The stages a scan goes through, in order, with the words for each. */
export const STAGES = Object.freeze([
  { key: 'post', label: 'Finding the post' },
  { key: 'harvest', label: 'Reading who engaged' },
  { key: 'canary', label: 'Checking the AppView counts' },
  { key: 'score', label: 'Sorting by who you know' },
]);

/**
 * The post a pasted link names: a bsky.app link, an aturi.to link or an
 * at:// URI. `{ did }` or `{ handle }`, with `rkey`; null for anything else.
 */
export function readPostInput(input) {
  const text = typeof input === 'string' ? input.trim() : '';
  if (!text) return null;
  const link = parsePostLink(text);
  if (!link || !link.rkey) return null;
  return link.did ? { did: link.did, rkey: link.rkey } : { handle: link.handle, rkey: link.rkey };
}

/**
 * The post's URI and its author, resolving a handle if the link has one.
 * Throws a ScanError with code 'link' (not a post link) or 'author' (a handle
 * nobody has).
 */
export async function resolvePost(input, { resolveHandle = publicResolveHandle, signal } = {}) {
  const ref = readPostInput(input);
  if (!ref) {
    throw new ScanError('That isn’t a link to a post. Paste a bsky.app link to a post, or its at:// address.', { code: 'link' });
  }
  const did = ref.did || (await resolveHandle(ref.handle, { signal }));
  signal?.throwIfAborted();
  if (!did) throw new ScanError(`Couldn’t find @${ref.handle}. Check the link and try again.`, { code: 'author' });
  return { uri: `at://${did}/${POST}/${ref.rkey}`, authorDid: did };
}

/**
 * Accounts you follow, best canary first: the ones who follow you back,
 * those who engage with you most leading, then the rest of your follows,
 * the most recently followed first. At most `limit`.
 *
 * @param {{ following?: {did: string, followedAt?: string}[], followers?: {did: string}[], inbound?: {did: string}[] }} archive
 */
export function canaryCandidates({ following = [], followers = [], inbound = [] } = {}, { ownerDid = null, limit = CANARY_CANDIDATES } = {}) {
  const followsMe = new Set(followers.map((f) => f.did));
  const talk = new Map();
  for (const e of inbound) if (e?.did) talk.set(e.did, (talk.get(e.did) || 0) + 1);
  const seen = new Set();
  const follows = [];
  for (const f of following) {
    if (!f?.did || f.did === ownerDid || seen.has(f.did)) continue;
    seen.add(f.did);
    follows.push({ did: f.did, at: Date.parse(f.followedAt || '') || 0 });
  }
  const rank = (f) => (followsMe.has(f.did) ? 0 : 1);
  follows.sort((a, b) => rank(a) - rank(b) || (talk.get(b.did) || 0) - (talk.get(a.did) || 0) || b.at - a.at || (a.did < b.did ? -1 : 1));
  return follows.slice(0, limit).map((f) => f.did);
}

/**
 * The signed-in `getProfiles`, asked of Bluesky's AppView as the owner. The
 * owner's own session is the point: `knownFollowers` counts THEIR follows.
 */
export function signedInProfiles(agent) {
  const appview = typeof agent?.withProxy === 'function' ? agent.withProxy('bsky_appview', 'did:web:api.bsky.app') : agent;
  return async (dids, { signal } = {}) => {
    const res = await appview.app.bsky.actor.getProfiles({ actors: dids }, signal ? { signal } : undefined);
    return Array.isArray(res?.data?.profiles) ? res.data.profiles : [];
  };
}

/** A failure from any stage, as a ScanError the page can word. */
export function scanErrorFrom(err, signal) {
  if (signal?.aborted || err?.name === 'AbortError') return new ScanError('The scan was stopped.', { code: 'aborted', cause: err });
  if (err instanceof ScanError) return err;
  if (isMissingScopeError(err) || isMissingScopeError(err?.cause)) {
    return new ScanError('This session wasn’t given the permission a scan needs. Turn Defense on to ask for it.', { code: 'permission', cause: err });
  }
  if (err instanceof ScoreError) return new ScanError(err.message, { code: err.code === 'vouches' ? 'vouches' : 'read', cause: err });
  return new ScanError(err?.message || 'The scan stopped. Try again in a minute.', { code: 'harvest', cause: err });
}

/**
 * Scan a post. Resolves to the summary score.js gives (`rows`,
 * `requiresReview`, `totals`, `vouchCheck`, …) with the post, the canary, and
 * when it started and finished; throws a ScanError.
 *
 * @param {object} opts
 * @param {string} opts.input          what was pasted (or a post's at:// URI)
 * @param {string} opts.ownerDid
 * @param {Function} opts.getProfiles  the owner's signed-in getProfiles (signedInProfiles)
 * @param {string[]} opts.candidates   canaryCandidates(archive)
 * @param {(s: {stage: string, done?: number, total?: number}) => void} [opts.onStage]
 * @param {AbortSignal} [opts.signal]
 */
export async function runScan({
  input,
  ownerDid,
  getProfiles,
  candidates = [],
  onStage,
  signal,
  resolveHandle,
  harvest = harvestPost,
  getRelationships = publicRelationships(),
  retryDelaysMs,
  now = () => Date.now(),
}) {
  const startedAt = new Date(now()).toISOString();
  const say = (stage, progress = {}) => onStage?.({ stage, ...progress });
  try {
    say('post');
    const post = await resolvePost(input, { resolveHandle, signal });

    say('harvest', { done: 0, total: 0 });
    const harvested = await harvest(post.uri, { signal, onProgress: (p) => say('harvest', p) });
    // You, and whoever wrote the post, are in its thread too; neither is one
    // of the people who engaged with it.
    const people = withoutSelves(harvested, [ownerDid, post.authorDid]);

    say('canary');
    const retry = retryDelaysMs ? { retryDelaysMs } : {};
    let canary = await findCanary({ ownerDid, candidates, getProfiles, signal, ...retry });
    if (!canary && candidates.length) {
      // From here a lookup that failed open looks just like follows nobody
      // else you follow follows. Once more after a pause, before taking it
      // for the second and scoring without vouches.
      await pause(retryDelaysMs?.[0] ?? SECOND_LOOK_MS, signal);
      canary = await findCanary({ ownerDid, candidates, getProfiles, signal, ...retry });
    }
    const scorer = createScorer({
      ownerDid,
      getProfiles,
      getRelationships,
      canary,
      // Asked once, if the canary stops answering (it may have been unfollowed
      // since the archive's last sync): the next best, without it.
      refindCanary: () => findCanary({ ownerDid, candidates: candidates.filter((d) => d !== canary), getProfiles, signal, ...retry }),
      selves: [ownerDid, post.authorDid],
      ...retry,
    });

    const dids = people.participants.map((p) => p.did);
    say('score', { done: 0, total: dids.length });
    const { scores, vouchCheck } = await scorer.score(dids, { signal, onProgress: (p) => say('score', p) });
    const summary = summarise(people, scores, { vouchCheck });
    return { ...summary, post, canary, startedAt, finishedAt: new Date(now()).toISOString() };
  } catch (err) {
    throw scanErrorFrom(err, signal);
  }
}
