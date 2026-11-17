// How close an account is to you, so a block list can't take your own people.
//
// This answers "what am I about to do, and who will notice", not "does this
// person deserve it". Nothing here reads a post or judges behaviour. It
// measures social proximity, which is a proxy for blast radius, not for harm.
//
// The bands rest on one number: how many of the people you follow also follow
// this account (a "vouch" each). Read it in one direction only. A vouch is good
// evidence to leave someone alone; no vouch is no evidence at all, because most
// harmless strangers have none either.
//
// WHERE THE VOUCHES COME FROM. bluesky-mod kept a snapshot of your follows'
// follows (up to 3 GB for someone who follows thousands) and counted from it.
// Virga stores none of that. Bluesky's AppView already counts it: asked by
// you, `app.bsky.actor.getProfiles` returns `viewer.knownFollowers.count` for
// every account in a batch of 25, the number of your follows who follow them,
// with no cap on how far down anyone's follow list it looks. So the vouches are
// read live, with your own session, from your own browser.
//
// THE CATCH, AND THE CANARY. The AppView gives that lookup 100 ms and, when it
// runs over, leaves `knownFollowers` off every profile in the batch rather than
// failing the request (`hydration/actor.js` in @atproto/bsky 0.5.13, read
// 2026-11-17: `sampleFollowsFollowing` under `AbortSignal.timeout(100)`, "Fail
// open"). An absent count then reads as zero, which turns a friend of a friend
// into an UNKNOWN stranger: the band a batch approval adds without a named
// look. So every batch carries a canary, an account you follow that is known
// to have known followers. The lookup is one call for the whole batch, so if
// the canary comes back without its count, nobody in that batch was counted:
// the batch is asked again, and if it never comes back right nothing is scored
// from it. A batch whose canary has its count was counted.
//
// What the canary can't see: a dataplane that answers for some accounts in a
// batch and not others. The open-source dataplane can't, and the production
// one isn't published. The veto that matters doesn't rest on this anyway: "you
// follow them" comes from `getRelationships`, which needs no session, and is
// checked again at the moment anything is written.
//
// Ported from bluesky-mod (src/lib/score.js): the bands, the thresholds, the
// trust key, the retries and the summary are the same; the snapshot is gone.

import { APPVIEW } from '../config.js';
import { fetchWithTimeout } from '../lib/atproto.js';
import { APPVIEW_CONCURRENCY, chunks, mapLimit, pause } from './limit.js';

/** `getRelationships` takes at most 30 `others` per call. */
const REL_BATCH = 30;

/** `getProfiles` takes at most 25 actors per call; one place is the canary's. */
export const PROFILE_BATCH = 25;

export const BANDS = ['PROTECTED', 'CONNECTED', 'PERIPHERAL', 'NOTABLE', 'UNKNOWN'];

/**
 * Default thresholds. The gate should be nearly frictionless on strangers and
 * hard to get past for people near you.
 */
export const DEFAULT_THRESHOLDS = {
  connectedVouches: 3,
  connectedVouchesWithReach: 1,
  connectedReach: 5000,
  notableReach: 10000,
  notableActivityPostsPerDay: 20,
  notableActivityReach: 2000,
  /**
   * An account that follows you is CONNECTED. Off while vouches can be
   * checked; on when they can't, so the people closest to you still stand out.
   */
  followsYouConnects: false,
};

/** Pauses before asking again: two more tries after the first. */
const RETRY_DELAYS_MS = [1000, 3000];

/** How many batches of your follows `findCanary` reads before giving up. */
const CANARY_BATCHES = 4;

export class ScoreError extends Error {
  constructor(message, { code, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ScoreError';
    this.code = code;
  }
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * A 0 to 99 sorting key. Higher means more embedded in your world.
 *
 * It orders a review list; the band does the gating. The weights are blunt on
 * purpose, since finer ones would claim a precision the data does not have.
 * PROTECTED accounts get 100 so they always sort to the top.
 */
export function trustScore({ vouches = 0, followers = 0, ageDays = 0, mutual = false, followsYou = false }) {
  const vouchTerm = 55 * Math.min(1, Math.log1p(vouches) / Math.log1p(12));
  const reachTerm = 25 * Math.min(1, Math.log10(1 + followers) / 5);
  const tenureTerm = 10 * clamp((Number(ageDays) || 0) / 365, 0, 1);
  const tieTerm = mutual ? 10 : followsYou ? 5 : 0;
  return clamp(Math.round(vouchTerm + reachTerm + tenureTerm + tieTerm), 0, 99);
}

/**
 * Assign a band. Vetoes win over everything: `protectedReason` being set is
 * the whole of PROTECTED, so there is one place to look when asking why
 * someone was spared.
 */
export function assignBand(f, thresholds = DEFAULT_THRESHOLDS) {
  if (f.protectedReason) return 'PROTECTED';
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const vouches = f.vouches || 0;
  const followers = f.followers || 0;
  if (t.followsYouConnects && f.followsYou) return 'CONNECTED';
  if (vouches >= t.connectedVouches || (vouches >= t.connectedVouchesWithReach && followers >= t.connectedReach)) {
    return 'CONNECTED';
  }
  if (vouches >= 1) return 'PERIPHERAL';
  if (
    followers >= t.notableReach ||
    ((f.postsPerDay || 0) >= t.notableActivityPostsPerDay && followers >= t.notableActivityReach)
  ) {
    return 'NOTABLE';
  }
  return 'UNKNOWN';
}

/**
 * The known-followers count on a profile, or null when the AppView left it
 * off. Null is not zero: it means "no one you follow follows them" OR "the
 * lookup ran out of time", and only a canary tells the two apart.
 */
export function knownFollowersOf(profile) {
  const known = profile?.viewer?.knownFollowers;
  if (!known) return null;
  const count = Number(known.count);
  if (Number.isFinite(count) && count > 0) return count;
  return Array.isArray(known.followers) && known.followers.length ? known.followers.length : null;
}

function retryable(err) {
  if (err?.name === 'AbortError') return false;
  const status = Number(err?.status);
  if (!Number.isFinite(status) || status === 0) return true; // no answer at all
  return status === 408 || status === 429 || status >= 500;
}

/**
 * `read()` again after each pause in `delays` while it throws something worth
 * retrying. A failed request is not an empty answer: read as one, a rate limit
 * would turn every account in the batch into a stranger with no profile.
 */
async function withRetries(read, { delays, signal, what }) {
  for (let attempt = 0; ; attempt += 1) {
    signal?.throwIfAborted();
    try {
      return await read();
    } catch (err) {
      if (signal?.aborted) throw signal.reason ?? err;
      if (!retryable(err) || attempt >= delays.length) {
        throw new ScoreError(`Couldn't read ${what} from Bluesky, so nothing was scored. Try again in a minute.`, {
          code: 'read',
          cause: err,
        });
      }
      await pause(delays[attempt], signal);
    }
  }
}

/**
 * Who you follow and who follows you, for up to 30 accounts a call, from the
 * public AppView. Needs no session: the question that matters most for the
 * veto never depends on one.
 */
export function publicRelationships({ fetchImpl = fetchWithTimeout, appview = APPVIEW } = {}) {
  return async (ownerDid, dids, { signal } = {}) => {
    const q = dids.map((d) => `others=${encodeURIComponent(d)}`).join('&');
    const url = `${appview}/xrpc/app.bsky.graph.getRelationships?actor=${encodeURIComponent(ownerDid)}&${q}`;
    const res = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal });
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} from getRelationships`);
      err.status = res.status;
      throw err;
    }
    const list = (await res.json())?.relationships;
    if (!Array.isArray(list)) throw new Error('getRelationships answered with no list');
    return list;
  };
}

/**
 * An account you follow whose known-followers count the AppView reports, to
 * ride along in every batch as the canary. `candidates` are accounts you
 * follow, best first (people you follow who are followed by others you follow
 * are the ones with a count; your mutuals and the accounts most of your circle
 * follows are good first picks). Returns null when none of the first few
 * batches has one: you follow no one, or no two of your follows follow each
 * other, or the lookup is down.
 *
 * @param {object} opts
 * @param {string} opts.ownerDid
 * @param {string[]} opts.candidates
 * @param {(dids: string[], o: {signal?: AbortSignal}) => Promise<object[]>} opts.getProfiles
 *   profiles as the owner sees them: the signed-in `getProfiles`
 */
export async function findCanary({
  ownerDid,
  candidates,
  getProfiles,
  signal,
  maxBatches = CANARY_BATCHES,
  retryDelaysMs = RETRY_DELAYS_MS,
}) {
  const pool = [...new Set(candidates || [])].filter((d) => d && d !== ownerDid);
  for (const batch of chunks(pool, PROFILE_BATCH).slice(0, maxBatches)) {
    const found = await withRetries(() => getProfiles(batch, { signal }), {
      delays: retryDelaysMs,
      signal,
      what: 'who you know in common',
    });
    let best = null;
    for (const p of found || []) {
      const n = knownFollowersOf(p);
      if (n && p?.did && (!best || n > best.n)) best = { did: p.did, n };
    }
    if (best) return best.did;
  }
  return null;
}

/**
 * Build a scorer for one owner.
 *
 * Reads are injected so the same scorer runs in the browser (the signed-in
 * agent's `getProfiles`), on Virga's server (the same call through a long
 * session), and against fixtures.
 *
 * @param {object} opts
 * @param {string} opts.ownerDid
 * @param {(dids: string[], o: {signal?: AbortSignal}) => Promise<object[]>} opts.getProfiles
 *   profiles as the owner sees them. Must be signed in as the owner: anyone
 *   else's session counts THEIR follows.
 * @param {(owner: string, dids: string[], o: {signal?: AbortSignal}) => Promise<object[]>} [opts.getRelationships]
 * @param {string|null} [opts.canary] from `findCanary`; null scores without vouch checks
 * @param {() => Promise<string|null>} [opts.refindCanary] asked once if the canary stops answering
 * @param {Map<string,string>} [opts.protectedSet] did -> reason (curation lists, kept by hand)
 * @param {string[]} [opts.selves] accounts never offered: the list's holder, the moderator account
 * @param {Set<string>} [opts.alreadyListed]
 * @param {Set<string>} [opts.blockers] accounts that block the owner
 */
export function createScorer({
  ownerDid,
  getProfiles,
  getRelationships = publicRelationships(),
  canary = null,
  refindCanary = null,
  protectedSet = new Map(),
  selves = [],
  alreadyListed = new Set(),
  blockers = new Set(),
  thresholds = DEFAULT_THRESHOLDS,
  retryDelaysMs = RETRY_DELAYS_MS,
  concurrency = APPVIEW_CONCURRENCY,
}) {
  if (!ownerDid) throw new Error('createScorer needs the owner');
  if (typeof getProfiles !== 'function') throw new Error('createScorer needs a signed-in getProfiles');
  const selfSet = new Set(selves.filter(Boolean));
  let currentCanary = canary;
  let refind = null; // the one re-pick, shared by every batch that needs it

  async function askBatch(batch, signal) {
    const withCanary = currentCanary && !batch.includes(currentCanary) ? [...batch, currentCanary] : batch;
    const used = currentCanary;
    const found = await withRetries(() => getProfiles(withCanary, { signal }), {
      delays: retryDelaysMs,
      signal,
      what: 'profiles',
    });
    const byDid = new Map();
    for (const p of found || []) if (p?.did) byDid.set(p.did, p);
    const counted = !used || knownFollowersOf(byDid.get(used)) !== null;
    if (used && !batch.includes(used)) byDid.delete(used);
    return { byDid, counted, used };
  }

  /**
   * One batch of profiles whose vouches can be trusted, or a throw. A batch
   * whose canary came back without its count is asked again; if the canary
   * never answers, it is picked again once (someone may have unfollowed),
   * and if that fails too, nothing is scored.
   */
  async function profileBatch(batch, signal) {
    for (let attempt = 0; ; attempt += 1) {
      signal?.throwIfAborted();
      const { byDid, counted, used } = await askBatch(batch, signal);
      if (counted) return byDid;
      if (attempt < retryDelaysMs.length) {
        await pause(retryDelaysMs[attempt], signal);
        continue;
      }
      if (refindCanary && used === canary) {
        refind ??= refindCanary().catch(() => null);
        const next = await refind;
        if (next && next !== used) {
          currentCanary = next;
          attempt = -1; // a fresh set of tries with the new canary
          continue;
        }
      }
      throw new ScoreError(
        "Bluesky didn't say who you know in common with these accounts, so they weren't scored. Try again in a minute.",
        { code: 'vouches' },
      );
    }
  }

  async function profiles(dids, signal, onBatch) {
    const out = new Map();
    const size = currentCanary ? PROFILE_BATCH - 1 : PROFILE_BATCH;
    await mapLimit(
      chunks(dids, size),
      concurrency,
      async (batch) => {
        const byDid = await profileBatch(batch, signal);
        for (const [did, p] of byDid) out.set(did, p);
        onBatch?.(batch.length);
      },
      { signal },
    );
    return out;
  }

  async function relationships(dids, signal) {
    const out = new Map();
    await mapLimit(
      chunks(dids, REL_BATCH),
      concurrency,
      async (batch) => {
        const found = await withRetries(() => getRelationships(ownerDid, batch, { signal }), {
          delays: retryDelaysMs,
          signal,
          what: 'who you follow',
        });
        for (const r of found) {
          if (!r?.did) continue;
          out.set(r.did, { youFollow: Boolean(r.following), followsYou: Boolean(r.followedBy) });
        }
      },
      { signal },
    );
    return out;
  }

  return {
    /** Whether vouches are being checked against a canary right now. */
    get vouchCheck() {
      return currentCanary ? 'canary' : 'unavailable';
    },

    /**
     * Score a list of DIDs. Throws a ScoreError when any batch can't be read
     * (or counted), rather than scoring part of the list from defaults.
     *
     * @returns {Promise<{ scores: Map<string, object>, vouchCheck: 'canary'|'unavailable' }>}
     */
    async score(dids, { signal, onProgress } = {}) {
      const unique = [...new Set(dids)].filter(Boolean);
      let done = 0;
      // When either half fails the whole score is thrown away, so the other
      // half stops asking rather than spending the AppView on an answer no
      // one will read.
      const inner = new AbortController();
      const forward = () => inner.abort(signal.reason);
      if (signal?.aborted) forward();
      signal?.addEventListener('abort', forward, { once: true });
      const stopOnFailure = (p) =>
        p.catch((err) => {
          inner.abort(err);
          throw err;
        });
      let profs;
      let rels;
      try {
        [profs, rels] = await Promise.all([
          stopOnFailure(
            profiles(unique, inner.signal, (n) => {
              done += n;
              onProgress?.({ done, total: unique.length });
            }),
          ),
          stopOnFailure(relationships(unique, inner.signal)),
        ]);
      } finally {
        signal?.removeEventListener('abort', forward);
      }
      // Without a canary an absent count can't be read as zero with any
      // confidence, so the one closeness sign that needs no count stands in.
      const vouchCheck = currentCanary ? 'canary' : 'unavailable';
      const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
      if (vouchCheck === 'unavailable') t.followsYouConnects = true;

      const scores = new Map();
      for (const did of unique) {
        const p = profs.get(did);
        const rel = rels.get(did) || { youFollow: false, followsYou: false };
        const youFollow = rel.youFollow || Boolean(p?.viewer?.following);
        const followsYou = rel.followsYou || Boolean(p?.viewer?.followedBy);
        const vouches = knownFollowersOf(p) ?? 0;
        const created = Date.parse(p?.createdAt ?? '');
        const ageDays = Number.isFinite(created) ? Math.max(0, Math.round((Date.now() - created) / 86400000)) : null;
        const followers = p?.followersCount ?? 0;

        // A follow counts the moment it is made, from either source, and the
        // owner and Virga's own accounts are never offered at all.
        const protectedReason =
          protectedSet.get(did) ||
          (youFollow ? 'you follow them' : null) ||
          (did === ownerDid ? 'your own account' : null) ||
          (selfSet.has(did) ? 'one of Virga’s accounts' : null);

        const features = {
          vouches,
          followers,
          follows: p?.followsCount ?? 0,
          posts: p?.postsCount ?? 0,
          ageDays,
          postsPerDay:
            ageDays && ageDays > 1 && p?.postsCount ? Number((p.postsCount / ageDays).toFixed(2)) : null,
          mutual: youFollow && followsYou,
          followsYou,
          youFollow,
          protectedReason,
        };

        scores.set(did, {
          did,
          handle: p?.handle ?? null,
          displayName: p?.displayName ?? null,
          avatar: p?.avatar ?? null,
          missing: !p,
          band: assignBand(features, t),
          trust: protectedReason ? 100 : trustScore(features),
          alreadyListed: alreadyListed.has(did),
          blocksYou: blockers.has(did) || Boolean(p?.viewer?.blockedBy),
          ...features,
        });
      }
      return { scores, vouchCheck };
    },
  };
}

/**
 * A harvest without these accounts, its totals counted again without them.
 * The owner, Virga's accounts and the post's author can all show up among a
 * post's participants; none of them is one of the people who engaged with it.
 */
export function withoutSelves(harvest, dids) {
  const skip = new Set(dids.filter(Boolean));
  const participants = harvest.participants.filter((p) => !skip.has(p.did));
  const engagements = {};
  for (const p of participants) {
    for (const [k, n] of Object.entries(p.engagements || {})) engagements[k] = (engagements[k] || 0) + n;
  }
  return {
    ...harvest,
    participants,
    totals: { ...harvest.totals, participants: participants.length, engagements },
  };
}

/**
 * Join a harvest to scores and summarise it.
 *
 * `requiresReview` is everything that is not UNKNOWN: the list a person is
 * expected to read. Keeping it short is the constraint on every threshold
 * above. If it is routinely longer than a screen the thresholds are wrong,
 * because a review nobody reads is not a review.
 */
export function summarise(harvest, scores, { vouchCheck = 'canary' } = {}) {
  const rows = harvest.participants.map((p) => ({ ...p, ...(scores.get(p.did) || { band: 'UNKNOWN' }) }));
  const byBand = Object.fromEntries(BANDS.map((b) => [b, 0]));
  for (const r of rows) byBand[r.band] = (byBand[r.band] || 0) + 1;
  const requiresReview = rows.filter((r) => r.band !== 'UNKNOWN').sort((a, b) => b.trust - a.trust);
  return {
    uri: harvest.uri,
    harvestedAt: harvest.harvestedAt,
    truncated: harvest.truncated,
    unread: harvest.unread ?? [],
    vouchCheck,
    totals: {
      ...harvest.totals,
      participants: rows.length,
      byBand,
      reviewReach: requiresReview.reduce((n, r) => n + (r.followers || 0), 0),
      alreadyListed: rows.filter((r) => r.alreadyListed).length,
      blocksYou: rows.filter((r) => r.blocksYou).length,
    },
    rows,
    requiresReview,
    autoEligible: rows.filter((r) => r.band === 'UNKNOWN'),
  };
}
