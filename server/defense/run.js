// Writing Defense's lists: one pass of the run route (handlers/run.js), called
// by Vercel Cron or by the worker on the droplet. It takes nothing from its
// caller. It claims due jobs from the database, a holder at a time and paced
// (pace.js), and for each writes one batch of the decisions its owner
// approved, as the account that holds the list.
//
// The rules it keeps (docs/DEFENSE-THREATS.md):
//   1. The veto runs here, at the write, from fresh reads, and fails closed:
//      someone followed since the plan was made, kept by hand, or on one of
//      the owner's curation lists is never written, and a veto that can't be
//      read writes nothing.
//   3. Only list items, only on a list Virga made for that owner, only in the
//      repo the list's record is in. A list whose row doesn't add up is held,
//      not written.
//   6. Each decision has its record key before it is sent. A batch whose reply
//      was lost is still `sent`, and the next pass reads each key to see what
//      landed before writing the rest, so nobody is added twice.
//   7. Decisions are marked sent before the write and settled after; a failure
//      the PDS may have committed leaves them sent, for the next pass.
//   8. A rate limit holds the job for an hour; nothing is retried at once.
//   9. Nothing is written unless DEFENSE_WRITES is 'on'.
//
// Ported from bluesky-mod's writeRows (src/bot/bulkPlan.js) and applyCommand
// (src/bot/listWrite.js), for many owners.

import { Agent } from '@atproto/api';
import { isMissingScopeError } from '../../src/session/scopes.js';
import { nextTid } from '../../src/posting/lib/tid.js';
import { BATCH, BATCH_GAP_MS, RATE_LIMIT_HOLD_MS } from '../../src/defense/pace.js';
import { VetoUnreadable, vetoed as readVeto } from '../../src/defense/veto.js';
import { getOAuthClient } from '../oauth/client.js';
import { restoreWithRetry } from '../oauth/restore.js';
import { claimJobs as claimFromDb, storeFor as storeForOwner } from './store.js';

const LISTITEM = 'app.bsky.graph.listitem';

/** Jobs taken in one pass, and the time a pass may spend before it stops starting new ones. */
export const CLAIM_LIMIT = 10;
export const TIME_BUDGET_MS = 40_000;

/** How long a job waits when its veto couldn't be read, or its holder can't be written to. */
export const VETO_RETRY_MS = 10 * 60_000;
export const SIGNED_OUT_HOLD_MS = 60 * 60_000;
export const SCOPE_HOLD_MS = 6 * 60 * 60_000;
/** A list whose row doesn't add up waits this long, which is as good as for good. */
const UNSOUND_HOLD_MS = 365 * 24 * 60 * 60_000;

/** Whether Defense may write at all (rule 9). */
export function defenseWritesEnabled(env = process.env) {
  return env?.DEFENSE_WRITES === 'on';
}

const DID = /^did:[a-z]+:[a-zA-Z0-9._:%-]+$/;
const RKEY = /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/;

/**
 * Whether a claimed job's list is one Virga may write to: a record in the
 * holder's repo, held by the owner when it is their own (rule 3).
 */
export function listIsSound(job) {
  if (!job || !DID.test(job.owner_did || '') || !DID.test(job.holder_did || '')) return false;
  if (job.list_mode === 'own' && job.holder_did !== job.owner_did) return false;
  if (job.list_mode !== 'own' && job.list_mode !== 'helper') return false;
  const prefix = `at://${job.holder_did}/app.bsky.graph.list/`;
  return typeof job.list_uri === 'string' && job.list_uri.startsWith(prefix) && /^[a-zA-Z0-9._:~-]+$/.test(job.list_uri.slice(prefix.length));
}

const statusOf = (err) => Number(err?.status ?? err?.statusCode ?? NaN);
const isRateLimited = (err) => statusOf(err) === 429 || /rate ?limit/i.test(`${err?.error || ''} ${err?.message || ''}`);
const isNotFound = (err) => /RecordNotFound|could not (locate|find)|not ?found/i.test(`${err?.error || ''} ${err?.message || ''}`);
/** The PDS refused the call, so nothing in it was written. A 5xx or a lost connection may have committed. */
const isRefused = (err) => statusOf(err) >= 400 && statusOf(err) < 500;

function brief(err) {
  return String(err?.message || err || 'unknown error').replace(/\s+/g, ' ').slice(0, 200);
}

/** The default way to open a holder's session: the long session Virga's server keeps. */
async function restoreHolder(did) {
  return restoreWithRetry(getOAuthClient(), did, { tag: 'defense/run' });
}

/**
 * One pass. Returns what it did, for the route's answer and the logs.
 *
 * @param {object} [opts]
 * @param {object} [opts.deps]  stand-ins for tests: claimJobs, storeFor, restore, Agent, vetoed, fetchImpl
 */
export async function runDefense({ env = process.env, now = () => Date.now(), deps = {} } = {}) {
  if (!defenseWritesEnabled(env)) return { ran: false, reason: 'DEFENSE_WRITES is not on' };
  const d = {
    claimJobs: claimFromDb,
    storeFor: storeForOwner,
    restore: restoreHolder,
    Agent,
    vetoed: readVeto,
    fetchImpl: undefined,
    newKey: () => nextTid(),
    ...deps,
  };
  const started = now();
  const jobs = await d.claimJobs({ limit: CLAIM_LIMIT, gapSeconds: Math.round(BATCH_GAP_MS / 1000) });
  const summary = { ran: true, jobs: jobs.length, written: 0, already: 0, vetoed: 0, failed: 0, held: [], errors: [] };
  for (const job of jobs) {
    // A job left now was moved a gap on by its claim, and comes round again.
    if (now() - started > TIME_BUDGET_MS) break;
    try {
      await runJob(job, d, summary, now);
    } catch (err) {
      console.error(`[defense/run] job ${job.id} failed: ${brief(err)}`);
      summary.errors.push({ job: job.id, error: brief(err) });
    }
  }
  return summary;
}

async function hold(store, job, summary, ms, why, now) {
  await store.holdJob(job.id, now() + ms, why);
  summary.held.push({ job: job.id, why });
}

/** One batch of one job. */
async function runJob(job, d, summary, now) {
  const store = d.storeFor(job.owner_did);
  if (!listIsSound(job)) {
    await hold(store, job, summary, UNSOUND_HOLD_MS, 'This list’s record isn’t where Virga made it, so nothing is written to it.', now);
    return;
  }
  const batch = await store.jobDecisions(job.id, BATCH);
  if (!batch.length) {
    await store.settle(job.id, []);
    return;
  }
  // Keys first (rule 6): an add keeps the key it was first sent under, a
  // removal its add's. A decision without one gets a fresh TID.
  const resent = new Set(batch.filter((x) => x.state === 'sent').map((x) => x.id));
  const marked = await store.markSent(
    job.id,
    batch.map((x) => x.id),
    batch.map((x) => x.rkey || d.newKey()),
  );
  const usable = marked.filter((m) => RKEY.test(m.rkey || '') && DID.test(m.subject_did || ''));
  const results = marked.filter((m) => !usable.includes(m)).map((m) => ({ id: m.id, state: 'failed', reason: 'not a record key or a DID Virga can write' }));
  if (!usable.length) {
    await store.settle(job.id, results);
    return;
  }

  let toWrite = usable;
  if (job.kind === 'add') {
    let veto;
    try {
      veto = await d.vetoed({
        ownerDid: job.owner_did,
        holderDid: job.holder_did,
        dids: usable.map((m) => m.subject_did),
        kept: await store.keptMap(),
        fetchImpl: d.fetchImpl,
      });
    } catch (err) {
      // Nothing was written: the whole batch goes back to wait (rule 1).
      await store.settle(job.id, [...results, ...usable.map((m) => ({ id: m.id, state: 'queued' }))]);
      const why = err instanceof VetoUnreadable ? err.message : `The veto couldn’t be read (${brief(err)}), so nothing was written.`;
      await hold(store, job, summary, VETO_RETRY_MS, why, now);
      return;
    }
    for (const m of usable) {
      if (veto.has(m.subject_did)) {
        results.push({ id: m.id, state: 'vetoed', reason: veto.get(m.subject_did) });
        summary.vetoed += 1;
      }
    }
    toWrite = usable.filter((m) => !veto.has(m.subject_did));
  }
  if (!toWrite.length) {
    await store.settle(job.id, results);
    return;
  }

  const session = await d.restore(job.holder_did);
  if (!session) {
    await store.settle(job.id, [...results, ...toWrite.map((m) => ({ id: m.id, state: 'queued' }))]);
    await hold(
      store,
      job,
      summary,
      SIGNED_OUT_HOLD_MS,
      'The account that holds this list isn’t signed in to Virga’s server. Sign in with a long session and the list carries on.',
      now,
    );
    return;
  }
  const agent = new d.Agent(session);
  const outcome = job.kind === 'add' ? await writeAdds(agent, job, toWrite, resent) : await writeRemovals(agent, job, toWrite);
  for (const r of outcome.results) {
    if (r.state === 'done') summary.written += 1;
    else if (r.state === 'already') summary.already += 1;
    else if (r.state === 'failed') summary.failed += 1;
  }
  await store.settle(job.id, [...results, ...outcome.results]);
  if (outcome.hold) await hold(store, job, summary, outcome.hold.ms, outcome.hold.why, now);
}

/** A held job's reason and length, from the error that stopped a batch. */
function holdFor(err) {
  if (isRateLimited(err)) return { ms: RATE_LIMIT_HOLD_MS, why: 'The PDS’s write limit was reached. Writing carries on in an hour.' };
  if (isMissingScopeError(err)) {
    return { ms: SCOPE_HOLD_MS, why: 'This sign-in doesn’t let Virga write lists. Sign in again from Defense › Lists to let it.' };
  }
  return null;
}

/** The list item at a record key in the holder's repo, or null when there is none. */
async function readItem(agent, repo, rkey) {
  try {
    const res = await agent.com.atproto.repo.getRecord({ repo, collection: LISTITEM, rkey });
    return res?.data?.value || null;
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

function itemValue(job, did) {
  return { $type: LISTITEM, subject: did, list: job.list_uri, createdAt: new Date().toISOString() };
}

/**
 * Adds: first the decisions sent before whose reply was lost, read by their
 * keys; then the rest in one applyWrites. A refusal for the whole batch is
 * tried an item at a time, so one bad item doesn't hold the others back.
 * `results` settles what is known; anything the PDS may have committed is
 * left out, so it stays sent for the next pass.
 */
async function writeAdds(agent, job, decisions, resent) {
  const results = [];
  const fresh = [];
  for (const m of decisions) {
    if (!resent.has(m.id)) {
      fresh.push(m);
      continue;
    }
    let found;
    try {
      found = await readItem(agent, job.holder_did, m.rkey);
    } catch {
      continue; // still unknown; stays sent
    }
    if (!found) fresh.push(m);
    else if (found.subject === m.subject_did && found.list === job.list_uri) results.push({ id: m.id, state: 'done' });
    else results.push({ id: m.id, state: 'failed', reason: 'its record key holds something else' });
  }
  if (!fresh.length) return { results };

  try {
    await agent.com.atproto.repo.applyWrites({
      repo: job.holder_did,
      writes: fresh.map((m) => ({ $type: 'com.atproto.repo.applyWrites#create', collection: LISTITEM, rkey: m.rkey, value: itemValue(job, m.subject_did) })),
    });
    for (const m of fresh) results.push({ id: m.id, state: 'done' });
    return { results };
  } catch (err) {
    const hold = holdFor(err);
    if (hold) {
      for (const m of fresh) results.push({ id: m.id, state: 'queued' });
      return { results, hold };
    }
    if (!isRefused(err)) return { results, hold: { ms: BATCH_GAP_MS, why: `The PDS didn’t answer the last batch (${brief(err)}). It is checked and carried on.` } };
  }

  // The batch was refused whole: one at a time, to find which.
  for (const m of fresh) {
    try {
      await agent.com.atproto.repo.createRecord({ repo: job.holder_did, collection: LISTITEM, rkey: m.rkey, record: itemValue(job, m.subject_did) });
      results.push({ id: m.id, state: 'done' });
    } catch (err) {
      const hold = holdFor(err);
      if (hold) {
        for (const rest of fresh.slice(fresh.indexOf(m))) results.push({ id: rest.id, state: 'queued' });
        return { results, hold };
      }
      if (isRefused(err)) results.push({ id: m.id, state: 'failed', reason: brief(err) });
      // Otherwise unknown: stays sent.
    }
  }
  return { results };
}

/** Removals: each list item deleted by the key its add wrote. Already gone is what was asked. */
async function writeRemovals(agent, job, decisions) {
  const results = [];
  for (const m of decisions) {
    try {
      await agent.com.atproto.repo.deleteRecord({ repo: job.holder_did, collection: LISTITEM, rkey: m.rkey });
      results.push({ id: m.id, state: 'done' });
    } catch (err) {
      if (isNotFound(err)) {
        results.push({ id: m.id, state: 'already' });
        continue;
      }
      const hold = holdFor(err);
      if (hold) {
        for (const rest of decisions.slice(decisions.indexOf(m))) results.push({ id: rest.id, state: 'queued' });
        return { results, hold };
      }
      if (isRefused(err)) results.push({ id: m.id, state: 'failed', reason: brief(err) });
    }
  }
  return { results };
}
