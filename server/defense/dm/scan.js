// A scan started by DM: the same scan the web runs (src/defense/scan.js), run
// on Vercel inside a DM pass, for the owner who sent the post. Read-only: what
// it finds becomes a plan, and nothing is added until the owner approves it.
//
// Two things the browser has that a pass doesn't, and where they come from:
//   - The owner's signed-in getProfiles, whose vouches count THEIR follows:
//     their long session, opened here for that one call and nothing else
//     (the same restore the list writer uses).
//   - The canary's candidates, which the web takes from the archive: here,
//     the owner's follows and followers from the public AppView, the ones who
//     follow back first.
//
// It has to fit in a pass, so it has a deadline; a post too big for one is
// answered with a link to scan it on the web.

import { Agent } from '@atproto/api';
import { APPVIEW } from '../../../src/config.js';
import { harvestPost } from '../../../src/defense/harvest.js';
import { CANARY_CANDIDATES, canaryCandidates, runScan, signedInProfiles } from '../../../src/defense/scan.js';
import { fetchWithTimeout } from '../../../src/lib/atproto.js';
import { getOAuthClient } from '../../oauth/client.js';
import { restoreWithRetry } from '../../oauth/restore.js';

/** How long a scan by DM may take before it gives up and points at the web. */
export const DM_SCAN_DEADLINE_MS = 25_000;
/** Pages of the owner's follows and followers read for canary candidates. */
const GRAPH_PAGES = 2;

export class DmScanError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'DmScanError';
    this.code = code;
  }
}

/** Up to `pages` pages of the owner's follows or followers, from the public AppView, as `{ did }`. */
async function publicGraph(method, actor, { pages = GRAPH_PAGES, fetchImpl = fetchWithTimeout, signal } = {}) {
  const out = [];
  let cursor;
  for (let i = 0; i < pages; i += 1) {
    const q = new URLSearchParams({ actor, limit: '100' });
    if (cursor) q.set('cursor', cursor);
    const res = await fetchImpl(`${APPVIEW}/xrpc/${method}?${q}`, { headers: { Accept: 'application/json' }, signal });
    if (!res.ok) break;
    const body = await res.json();
    const people = method === 'app.bsky.graph.getFollows' ? body?.follows : body?.followers;
    for (const p of people || []) if (p?.did) out.push({ did: p.did });
    cursor = body?.cursor;
    if (!cursor) break;
  }
  return out;
}

/** The owner's canary candidates, from the public graph: follows who follow back first. */
export async function publicCandidates(ownerDid, { fetchImpl, signal } = {}) {
  const [following, followers] = await Promise.all([
    publicGraph('app.bsky.graph.getFollows', ownerDid, { fetchImpl, signal }).catch(() => []),
    publicGraph('app.bsky.graph.getFollowers', ownerDid, { fetchImpl, signal }).catch(() => []),
  ]);
  return canaryCandidates({ following, followers }, { ownerDid, limit: CANARY_CANDIDATES });
}

/**
 * Scan a post for an owner: the summary runScan gives. Throws a DmScanError
 * with code SIGNED_OUT (no long session to read vouches with) or TOO_BIG (past
 * the deadline), or runScan's ScanError.
 *
 * @param {object} opts
 * @param {string} opts.ownerDid
 * @param {string} opts.input     the post: a link or an at:// URI, from the owner's message
 * @param {string[]|null} [opts.only]  engagement kinds to read (null: all)
 * @param {Map<string,string>} [opts.kept]  the people the owner keeps by hand
 * @param {object} [opts.deps]   stand-ins for tests: restore, Agent, fetchImpl, harvest, scan, candidates
 */
export async function scanForOwner({ ownerDid, input, only = null, kept = new Map(), deadlineMs = DM_SCAN_DEADLINE_MS, deps = {} }) {
  const d = {
    restore: (did) => restoreWithRetry(getOAuthClient(), did, { tag: 'defense/dm-scan' }),
    Agent,
    harvest: harvestPost,
    scan: runScan,
    candidates: publicCandidates,
    fetchImpl: undefined,
    ...deps,
  };
  const session = await d.restore(ownerDid);
  if (!session) throw new DmScanError('Scanning by DM needs your long session on Virga’s server. Sign in to Virga again with a long session, and send the post again.', 'SIGNED_OUT');
  const signal = AbortSignal.timeout(deadlineMs);
  try {
    const candidates = await d.candidates(ownerDid, { fetchImpl: d.fetchImpl, signal });
    return await d.scan({
      input,
      ownerDid,
      getProfiles: signedInProfiles(new d.Agent(session)),
      candidates,
      kept,
      signal,
      harvest: (uri, opts) => d.harvest(uri, { ...opts, ...(only ? { only } : {}) }),
    });
  } catch (err) {
    if (signal.aborted) throw new DmScanError('That post has more engagement than I can read in a DM.', 'TOO_BIG');
    throw err;
  }
}
