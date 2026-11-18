// The veto: who no automated path may ever add to a list.
//
// One module, run in two places. The scan reads it to put people in
// PROTECTED; Virga's server reads it again at the moment of every write
// (server/defense/run.js), because a plan's bands date from when it was made
// and anyone can be followed since. The write is what matters, so there the
// rule is: read everything fresh, and if anything can't be read, write nothing
// (docs/DEFENSE-THREATS.md, rule 1).
//
// Who is protected:
//   - the owner's own account, and the account that holds the list;
//   - anyone the owner kept by hand (defense_protected);
//   - anyone the owner follows, asked of the public AppView at the write. No
//     session: the answer that matters most never depends on one;
//   - anyone on a curation list the owner made.
//
// Isomorphic: plain fetch, no Node and no React, so the browser and the
// server run the same code and the same tests.

import { APPVIEW } from '../config.js';
import { fetchWithTimeout } from '../lib/atproto.js';
import { APPVIEW_CONCURRENCY, chunks, mapLimit } from './limit.js';

/** `getRelationships` takes at most 30 `others` per call. */
const REL_BATCH = 30;

const CURATELIST = 'app.bsky.graph.defs#curatelist';

/** How far a read of the owner's curation lists goes before it gives up. */
export const CURATION_LIMITS = Object.freeze({ lists: 20, membersPerList: 5000 });

/** The veto couldn't be read, so nothing may be written. */
export class VetoUnreadable extends Error {
  constructor(message, { cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'VetoUnreadable';
    this.code = 'veto-unreadable';
  }
}

async function getJson(url, { fetchImpl, signal }) {
  const res = await fetchImpl(url, { headers: { Accept: 'application/json' }, signal });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} from ${new URL(url).pathname}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/**
 * Which of `dids` the owner follows, from the public AppView, read now.
 * Throws VetoUnreadable when any batch can't be read.
 */
export async function followedNow(ownerDid, dids, { fetchImpl = fetchWithTimeout, appview = APPVIEW, signal } = {}) {
  const out = new Set();
  try {
    await mapLimit(
      chunks([...new Set(dids)], REL_BATCH),
      APPVIEW_CONCURRENCY,
      async (batch) => {
        const q = batch.map((d) => `others=${encodeURIComponent(d)}`).join('&');
        const body = await getJson(`${appview}/xrpc/app.bsky.graph.getRelationships?actor=${encodeURIComponent(ownerDid)}&${q}`, { fetchImpl, signal });
        if (!Array.isArray(body?.relationships)) throw new Error('getRelationships answered with no list');
        for (const r of body.relationships) if (r?.did && r.following) out.add(r.did);
      },
      { signal },
    );
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new VetoUnreadable('Couldn’t check who you follow, so nothing was written.', { cause: err });
  }
  return out;
}

/**
 * Everyone on a curation list the owner made: did -> the list's name. Read
 * from the public AppView. Throws VetoUnreadable when it can't be read, or
 * when there is more than CURATION_LIMITS allows, rather than leaving anyone
 * out.
 */
export async function curationMembers(ownerDid, { fetchImpl = fetchWithTimeout, appview = APPVIEW, signal, limits = CURATION_LIMITS } = {}) {
  const out = new Map();
  try {
    const lists = [];
    let cursor;
    do {
      const q = new URLSearchParams({ actor: ownerDid, limit: '100' });
      if (cursor) q.set('cursor', cursor);
      const body = await getJson(`${appview}/xrpc/app.bsky.graph.getLists?${q}`, { fetchImpl, signal });
      for (const l of body?.lists || []) if (l?.purpose === CURATELIST && l.uri) lists.push(l);
      cursor = body?.cursor;
    } while (cursor && lists.length <= limits.lists);
    if (lists.length > limits.lists) throw new Error(`more than ${limits.lists} curation lists`);
    for (const list of lists) {
      let seen = 0;
      let next;
      do {
        const q = new URLSearchParams({ list: list.uri, limit: '100' });
        if (next) q.set('cursor', next);
        const body = await getJson(`${appview}/xrpc/app.bsky.graph.getList?${q}`, { fetchImpl, signal });
        for (const item of body?.items || []) {
          const did = item?.subject?.did;
          if (did && !out.has(did)) out.set(did, list.name || 'a curation list');
          seen += 1;
        }
        if (seen > limits.membersPerList) throw new Error(`a curation list with more than ${limits.membersPerList} members`);
        next = body?.cursor;
      } while (next);
    }
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new VetoUnreadable('Couldn’t read the curation lists you made, so nothing was written.', { cause: err });
  }
  return out;
}

/**
 * Of `dids`, everyone who may not be added, with why: a Map did -> reason.
 * `kept` is did -> reason for the people kept by hand (the owner's rows of
 * defense_protected). `curation` is curationMembers' answer, or a function
 * that reads it (so a caller can cache it across batches). Throws
 * VetoUnreadable when the follows or the curation lists can't be read.
 *
 * @param {object} opts
 * @param {string} opts.ownerDid
 * @param {string} [opts.holderDid]  the account that holds the list
 * @param {string[]} opts.dids
 * @param {Map<string,string>} [opts.kept]
 * @param {Map<string,string>|(() => Promise<Map<string,string>>)} [opts.curation]
 * @param {(owner: string, dids: string[], o: object) => Promise<Set<string>>} [opts.follows]
 */
export async function vetoed({ ownerDid, holderDid = null, dids, kept = new Map(), curation = null, follows = followedNow, signal, ...read }) {
  if (!ownerDid) throw new VetoUnreadable('A veto needs the owner.');
  const wanted = [...new Set((dids || []).filter(Boolean))];
  const out = new Map();
  const others = [];
  for (const did of wanted) {
    if (did === ownerDid) out.set(did, 'your own account');
    else if (holderDid && did === holderDid) out.set(did, 'the account that holds the list');
    else if (kept.has(did)) out.set(did, kept.get(did) || 'kept by hand');
    else others.push(did);
  }
  if (!others.length) return out;
  const [followed, members] = await Promise.all([
    follows(ownerDid, others, { signal, ...read }),
    typeof curation === 'function' ? curation() : curation ? Promise.resolve(curation) : curationMembers(ownerDid, { signal, ...read }),
  ]);
  for (const did of others) {
    if (followed.has(did)) out.set(did, 'you follow them');
    else if (members.has(did)) out.set(did, `on your list “${members.get(did)}”`);
  }
  return out;
}
