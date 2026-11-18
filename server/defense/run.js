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
//   6. Each decision has its record key before it is sent, and keeps it. A
//      decision with a key may have landed, so the next pass reads the key
//      before anything else is decided about it: nobody is added twice, and
//      someone found on the list is recorded as on it (and taken off again if
//      the veto now keeps them off).
//   7. The veto and the holder's session are read before anything is marked;
//      a batch that can't go on is left as it was. Decisions are marked sent
//      just before the write and settled after; a failure the PDS may have
//      committed leaves them sent, for the next pass. A removal waits while
//      the add it takes back is unconfirmed, or the add's resend would put the
//      person back.
//   8. A rate limit holds the holder for an hour, whichever of its lists met
//      it; nothing is retried at once.
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
/** How long the veto may take to read before a batch gives up on it, and waits. */
export const VETO_DEADLINE_MS = 15_000;
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
/** The PDS's own answer for a record that isn't there, and nothing that merely says "not found". */
const isRecordNotFound = (err) => err?.error === 'RecordNotFound' || /\bRecordNotFound\b|Could not locate record/.test(`${err?.error || ''} ${err?.message || ''}`);
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
  const bad = batch.filter((m) => !DID.test(m.subject_did || '') || (m.rkey && !RKEY.test(m.rkey)));
  const good = batch.filter((m) => !bad.includes(m));
  const results = bad.map((m) => ({ id: m.id, state: 'failed', reason: 'not a record key or a DID Virga can write' }));
  if (!good.length) {
    await store.settle(job.id, results);
    return;
  }
  if (job.kind === 'add') await runAdds(job, good, results, { d, store, summary, now });
  else await runRemovals(job, good, results, { d, store, summary, now });
}

/**
 * Adds. Everything is read before anything changes: the veto (rule 1), then
 * the holder's session, so a batch that can't go on is left exactly as it was.
 * Then each decision that has a record key (it was sent before, and may have
 * landed) is read by it, before the veto's answer is applied: someone found
 * on the list is recorded as on it, and taken off again if they are now kept
 * off. Only then are the rest written, under keys chosen before they are sent
 * (rule 6). An add whose removal is waiting is read, never written.
 */
async function runAdds(job, batch, results, { d, store, summary, now }) {
  let veto;
  try {
    veto = await d.vetoed({
      ownerDid: job.owner_did,
      holderDid: job.holder_did,
      dids: batch.map((m) => m.subject_did),
      kept: await store.keptMap(batch.map((m) => m.subject_did)),
      fetchImpl: d.fetchImpl,
      signal: AbortSignal.timeout(VETO_DEADLINE_MS),
    });
  } catch (err) {
    const why =
      err instanceof VetoUnreadable
        ? err.message
        : err?.name === 'TimeoutError' || err?.name === 'AbortError'
          ? 'The veto took too long to read, so nothing was written.'
          : `The veto couldn’t be read (${brief(err)}), so nothing was written.`;
    if (results.length) await store.settle(job.id, results);
    await hold(store, job, summary, VETO_RETRY_MS, why, now);
    return;
  }
  const agent = await openHolder(job, results, { d, store, summary, now });
  if (!agent) return;

  const undoing = await store.undoPending(batch.map((m) => m.id));
  const takenBack = (m) => Boolean(m.undone_at) || undoing.has(m.id);
  const toCreate = [];
  const removeAgain = [];
  const known = batch.filter((m) => m.rkey);
  for (const m of known) {
    let found;
    try {
      found = await readItem(agent, job.holder_did, m.rkey);
    } catch {
      continue; // unknown: left as it is for the next pass
    }
    if (found) {
      if (found.subject !== m.subject_did || found.list !== job.list_uri) {
        results.push({ id: m.id, state: 'failed', reason: 'its record key holds something else' });
        continue;
      }
      results.push({ id: m.id, state: 'done' });
      summary.written += 1;
      // On the list already, and kept off now: taken off again, saying why.
      if (veto.has(m.subject_did) && !takenBack(m)) removeAgain.push({ id: m.id, why: veto.get(m.subject_did) });
    } else if (takenBack(m)) {
      results.push({ id: m.id, state: 'cancelled', reason: 'undone before it was written' });
    } else if (veto.has(m.subject_did)) {
      results.push({ id: m.id, state: 'vetoed', reason: veto.get(m.subject_did) });
      summary.vetoed += 1;
    } else {
      toCreate.push(m);
    }
  }
  for (const m of batch.filter((x) => !x.rkey)) {
    if (takenBack(m)) results.push({ id: m.id, state: 'cancelled', reason: 'undone before it was written' });
    else if (veto.has(m.subject_did)) {
      results.push({ id: m.id, state: 'vetoed', reason: veto.get(m.subject_did) });
      summary.vetoed += 1;
    } else toCreate.push(m);
  }

  let outcome = { results: [] };
  if (toCreate.length) {
    const marked = await store.markSent(
      job.id,
      toCreate.map((m) => m.id),
      toCreate.map((m) => m.rkey || d.newKey()),
    );
    const sendable = marked.filter((m) => RKEY.test(m.rkey || ''));
    outcome = await writeAdds(agent, job, sendable);
  }
  count(summary, outcome.results);
  await store.settle(job.id, [...results, ...outcome.results]);
  for (const r of removeAgain) {
    await store.undo({ ids: [r.id], note: `Taken off at the write: ${r.why}.`.slice(0, 500), via: 'web' });
  }
  if (outcome.hold) await holdOn(store, job, summary, outcome.hold, now);
}

/**
 * Removals, each by the key its add wrote. One whose add is still being
 * confirmed waits for it: removed first, the add's resend would put the
 * person back. One whose add never landed has nothing to remove.
 */
async function runRemovals(job, batch, results, { d, store, summary, now }) {
  const adds = await store.decisionStates(batch.map((m) => m.undoes).filter(Boolean));
  const waiting = [];
  const toDelete = [];
  for (const m of batch) {
    const add = adds.get(m.undoes);
    if (add && (add.state === 'queued' || add.state === 'sent')) waiting.push(m);
    else if (add && (add.state === 'vetoed' || add.state === 'failed' || add.state === 'cancelled')) results.push({ id: m.id, state: 'already' });
    else toDelete.push(m);
  }
  if (!toDelete.length) {
    if (results.length) await store.settle(job.id, results);
    if (waiting.length) await hold(store, job, summary, BATCH_GAP_MS, 'Waiting for the add it takes back to be confirmed.', now);
    return;
  }
  const agent = await openHolder(job, results, { d, store, summary, now });
  if (!agent) return;
  const marked = await store.markSent(
    job.id,
    toDelete.map((m) => m.id),
    toDelete.map((m) => m.rkey),
  );
  const outcome = await writeRemovals(
    agent,
    job,
    marked.filter((m) => RKEY.test(m.rkey || '')),
  );
  count(summary, outcome.results);
  await store.settle(job.id, [...results, ...outcome.results]);
  if (outcome.hold) await holdOn(store, job, summary, outcome.hold, now);
}

/** The holder's agent, or null after holding the job (nothing changed). */
async function openHolder(job, results, { d, store, summary, now }) {
  const session = await d.restore(job.holder_did);
  if (session) return new d.Agent(session);
  if (results.length) await store.settle(job.id, results);
  await hold(
    store,
    job,
    summary,
    SIGNED_OUT_HOLD_MS,
    'The account that holds this list isn’t signed in to Virga’s server. Sign in with a long session and the list carries on.',
    now,
  );
  return null;
}

function count(summary, results) {
  for (const r of results) {
    if (r.state === 'done') summary.written += 1;
    else if (r.state === 'already') summary.already += 1;
    else if (r.state === 'failed') summary.failed += 1;
  }
}

/** Hold the job, and for a rate limit its holder too: the limit is the account's. */
async function holdOn(store, job, summary, { ms, why, holder = false }, now) {
  await hold(store, job, summary, ms, why, now);
  if (holder) await store.holdHolder(job.id, now() + ms);
}

/** A held job's reason and length, from the error that stopped a batch. */
function holdFor(err) {
  if (isRateLimited(err)) return { ms: RATE_LIMIT_HOLD_MS, why: 'The PDS’s write limit was reached. Writing carries on in an hour.', holder: true };
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
    if (isRecordNotFound(err)) return null;
    throw err;
  }
}

function itemValue(job, did) {
  return { $type: LISTITEM, subject: did, list: job.list_uri, createdAt: new Date().toISOString() };
}

/**
 * Adds not yet on the list, in one applyWrites. A refusal for the whole batch
 * is tried an item at a time, so one bad item doesn't hold the others back,
 * and an item refused because its key is taken is read: a write whose reply
 * was lost is the likeliest reason. `results` settles what is known; anything
 * the PDS may have committed is left out, so it stays sent for the next pass.
 */
async function writeAdds(agent, job, fresh) {
  const results = [];
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
      if (!isRefused(err)) continue; // unknown: stays sent
      // Refused: perhaps because it is there already, from a write whose
      // reply was lost. What is at the key says.
      let found;
      try {
        found = await readItem(agent, job.holder_did, m.rkey);
      } catch {
        continue;
      }
      if (found && found.subject === m.subject_did && found.list === job.list_uri) results.push({ id: m.id, state: 'done' });
      else results.push({ id: m.id, state: 'failed', reason: brief(err) });
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
      if (isRecordNotFound(err)) {
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
