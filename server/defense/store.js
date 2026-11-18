// Defense's tables, reached only through a store bound to one owner.
//
// storeFor(ownerDid) hands out the methods for that owner and no other: every
// read filters on owner_did and every SQL function takes it as its first
// argument (docs/DEFENSE-THREATS.md, rule 4). Nothing in server/defense/
// touches a Defense table any other way, and server/defense/store.test.js
// holds two owners in one database to keep it so. The one call that isn't
// bound is claimJobs, the run route's, and every job it returns names its
// owner, which the run then binds a store to.

import { getSupabaseClient } from '../supabase.js';

const DID = /^did:[a-z]+:[a-zA-Z0-9._:%-]+$/;

export class StoreUnavailable extends Error {
  constructor(message = 'Defense’s database isn’t set up.') {
    super(message);
    this.name = 'StoreUnavailable';
    this.code = 'STORE_UNAVAILABLE';
  }
}

function clientOrThrow(client) {
  const c = client ?? getSupabaseClient();
  if (!c) throw new StoreUnavailable();
  return c;
}

function unwrap({ data, error }, what) {
  if (error) {
    const err = new Error(`${what}: ${error.message || error.code || 'database error'}`);
    err.code = error.code;
    throw err;
  }
  return data;
}

/** The first row of a set-returning RPC's answer, or null. */
const first = (data) => (Array.isArray(data) ? data[0] || null : data || null);

/**
 * The store for one owner. Throws for anything that isn't a DID, so a
 * missing owner can never become "everyone".
 */
export function storeFor(ownerDid, { client = null } = {}) {
  if (typeof ownerDid !== 'string' || !DID.test(ownerDid)) throw new Error('A Defense store needs its owner’s DID.');
  const db = () => clientOrThrow(client);
  const owner = ownerDid;

  return {
    owner,

    /** The owner's lists, with how many are on each by Virga's hand and how many wait. */
    async lists() {
      return unwrap(await db().rpc('defense_list_summary', { p_owner_did: owner }), 'lists') || [];
    },

    /** One of the owner's lists still kept, or null. */
    async list(id) {
      if (!id) return null;
      return unwrap(
        await db().from('defense_list').select('*').eq('owner_did', owner).eq('id', id).is('removed_at', null).maybeSingle(),
        'list',
      );
    },

    /** Record a list Virga has just made. */
    async addList({ holderDid, mode, uri, name, purpose }) {
      return first(
        unwrap(
          await db()
            .from('defense_list')
            .insert([{ owner_did: owner, holder_did: holderDid, mode, uri, name, purpose }])
            .select('*'),
          'add list',
        ),
      );
    },

    /** Stop keeping a list (its record stays where it is). */
    async removeList(id) {
      return first(
        unwrap(
          await db().from('defense_list').update({ removed_at: new Date().toISOString() }).eq('owner_did', owner).eq('id', id).is('removed_at', null).select('id'),
          'remove list',
        ),
      );
    },

    /** The people kept by hand, newest first. */
    async kept() {
      return unwrap(await db().from('defense_protected').select('did, reason, added_at').eq('owner_did', owner).order('added_at', { ascending: false }), 'kept') || [];
    },

    /** The same, as did -> reason, for the veto. */
    async keptMap() {
      return new Map((await this.kept()).map((r) => [r.did, r.reason]));
    },

    async keep(did, reason) {
      return first(
        unwrap(
          await db()
            .from('defense_protected')
            .upsert([{ owner_did: owner, did, reason }], { onConflict: 'owner_did,did' })
            .select('did, reason, added_at'),
          'keep',
        ),
      );
    },

    async unkeep(did) {
      unwrap(await db().from('defense_protected').delete().eq('owner_did', owner).eq('did', did), 'unkeep');
    },

    /** Store a plan for one of the owner's lists; its id, or null when the list isn't theirs. */
    async createPlan({ listId, postUri = null, rows, totals = {} }) {
      return unwrap(
        await db().rpc('defense_create_plan', { p_owner_did: owner, p_list_id: listId, p_post_uri: postUri, p_rows: rows, p_totals: totals }),
        'create plan',
      );
    },

    /** Approve bands of a plan: `{ job_id, queued, kept, already }`, or null. */
    async approvePlan(planId, { bands, note = null, via = 'web' }) {
      return first(
        unwrap(await db().rpc('defense_approve_plan', { p_owner_did: owner, p_plan_id: planId, p_bands: bands, p_note: note, p_via: via }), 'approve plan'),
      );
    },

    /** Take adds back: `{ job_id, cancelled, queued }`. */
    async undo({ planId = null, ids = null, note = null, via = 'web' }) {
      return first(unwrap(await db().rpc('defense_undo', { p_owner_did: owner, p_plan_id: planId, p_ids: ids, p_note: note, p_via: via }), 'undo'));
    },

    /** One of the owner's plans, or null. */
    async plan(id) {
      return unwrap(await db().from('defense_plan').select('*').eq('owner_did', owner).eq('id', id).maybeSingle(), 'plan');
    },

    /** The owner's decisions, newest first, `limit` at a time before the id `before`. */
    async history({ limit = 100, before = null, listId = null } = {}) {
      let q = db()
        .from('defense_decision')
        .select('id, list_id, plan_id, subject_did, action, band, trust, via, note, state, reason, created_at, acted_at, undone_at, undoes')
        .eq('owner_did', owner)
        .order('id', { ascending: false })
        .limit(Math.max(1, Math.min(500, limit)));
      if (before) q = q.lt('id', before);
      if (listId) q = q.eq('list_id', listId);
      return unwrap(await q, 'history') || [];
    },

    /** The owner's plans that something was approved from, newest first. */
    async plans({ limit = 50 } = {}) {
      return (
        unwrap(
          await db()
            .from('defense_plan')
            .select('id, list_id, post_uri, created_at, approved_at, approved_bands, note, totals')
            .eq('owner_did', owner)
            .not('approved_at', 'is', null)
            .order('approved_at', { ascending: false })
            .limit(Math.max(1, Math.min(200, limit))),
          'plans',
        ) || []
      );
    },

    /** Of one job of the owner's, what to send next: those already sent first, then the queued. */
    async jobDecisions(jobId, limit) {
      const rows =
        unwrap(
          await db()
            .from('defense_decision')
            .select('*')
            .eq('owner_did', owner)
            .eq('job_id', jobId)
            .in('state', ['sent', 'queued'])
            .order('id', { ascending: true })
            .limit(Math.max(1, limit * 2)),
          'job decisions',
        ) || [];
      const sent = rows.filter((r) => r.state === 'sent');
      const queued = rows.filter((r) => r.state === 'queued');
      return [...sent, ...queued].slice(0, limit);
    },

    /** Mark decisions of a job sent under their record keys; the rows that were marked. */
    async markSent(jobId, ids, rkeys) {
      return unwrap(await db().rpc('defense_mark_sent', { p_owner_did: owner, p_job_id: jobId, p_ids: ids, p_rkeys: rkeys }), 'mark sent') || [];
    },

    /** Record what each write came to: `[{ id, state, reason? }]`. */
    async settle(jobId, results) {
      return unwrap(await db().rpc('defense_settle', { p_owner_did: owner, p_job_id: jobId, p_results: results }), 'settle');
    },

    /** Hold a job back until a time, saying why. */
    async holdJob(jobId, until, error) {
      unwrap(
        await db().rpc('defense_hold_job', { p_owner_did: owner, p_job_id: jobId, p_until: new Date(until).toISOString(), p_error: String(error || '').slice(0, 500) }),
        'hold job',
      );
    },
  };
}

/**
 * Due jobs, at most one per holder, each with its owner, list and holder.
 * The run route's only unbound call: it binds a store to each job's owner.
 */
export async function claimJobs({ limit = 10, gapSeconds = 120, client = null } = {}) {
  return unwrap(await clientOrThrow(client).rpc('defense_claim_jobs', { p_limit: limit, p_gap_seconds: gapSeconds }), 'claim jobs') || [];
}
