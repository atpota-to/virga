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

    /**
     * The people kept by hand as did -> reason, for the veto: of `dids` when
     * given (a batch at the write), or all of them, read in pages so none is
     * cut off at the database's row cap.
     */
    async keptMap(dids = null) {
      const out = new Map();
      if (dids) {
        for (let i = 0; i < dids.length; i += 200) {
          const part = dids.slice(i, i + 200);
          const rows = unwrap(await db().from('defense_protected').select('did, reason').eq('owner_did', owner).in('did', part), 'kept') || [];
          for (const r of rows) out.set(r.did, r.reason);
        }
        return out;
      }
      for (let from = 0; ; from += 1000) {
        const rows =
          unwrap(
            await db().from('defense_protected').select('did, reason').eq('owner_did', owner).order('did', { ascending: true }).range(from, from + 999),
            'kept',
          ) || [];
        for (const r of rows) out.set(r.did, r.reason);
        if (rows.length < 1000) return out;
      }
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

    /** The owner's approved plans, newest first, each with what came of its adds. */
    async plans({ limit = 50 } = {}) {
      return unwrap(await db().rpc('defense_plans', { p_owner_did: owner, p_limit: limit }), 'plans') || [];
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

    /** Of the owner's adds `ids`, those whose removal is waiting (queued or sent): a Set of add ids. */
    async undoPending(ids) {
      if (!ids?.length) return new Set();
      const rows =
        unwrap(
          await db().from('defense_decision').select('undoes').eq('owner_did', owner).eq('action', 'remove').in('state', ['queued', 'sent']).in('undoes', ids),
          'undo pending',
        ) || [];
      return new Set(rows.map((r) => r.undoes));
    },

    /** The state of some of the owner's decisions: id -> { state, rkey, undone_at }. */
    async decisionStates(ids) {
      if (!ids?.length) return new Map();
      const rows = unwrap(await db().from('defense_decision').select('id, state, rkey, undone_at').eq('owner_did', owner).in('id', ids), 'decision states') || [];
      return new Map(rows.map((r) => [r.id, r]));
    },

    /** Hold every job of a job's holder until a time (a rate limit is the account's). */
    async holdHolder(jobId, until) {
      unwrap(await db().rpc('defense_hold_holder', { p_owner_did: owner, p_job_id: jobId, p_until: new Date(until).toISOString() }), 'hold holder');
    },

    /** Hold a job back until a time, saying why. */
    async holdJob(jobId, until, error) {
      unwrap(
        await db().rpc('defense_hold_job', { p_owner_did: owner, p_job_id: jobId, p_until: new Date(until).toISOString(), p_error: String(error || '').slice(0, 500) }),
        'hold job',
      );
    },

    // ─── The moderator (phase 4) ────────────────────────────────────────────

    /** The owner's link to the moderator: `{ linked_at, code_expires_at, list_id, … }`, or null. */
    async link() {
      return unwrap(await db().from('defense_link').select('owner_did, linked_at, code_expires_at, list_id, updated_at').eq('owner_did', owner).maybeSingle(), 'link');
    },

    /** Store a new linking code's hash, replacing the last. */
    async linkCode(codeHash, expiresAt) {
      return unwrap(await db().rpc('defense_link_code', { p_owner_did: owner, p_code_hash: codeHash, p_expires: new Date(expiresAt).toISOString() }), 'link code');
    },

    /** What came of the owner sending a code: 'linked', 'wrong', 'expired' or 'none'. */
    async claimLink(codeHash) {
      return unwrap(await db().rpc('defense_link_claim', { p_owner_did: owner, p_code_hash: codeHash }), 'claim link');
    },

    /** Unlink the moderator; the moderator stops answering this owner. */
    async unlink() {
      unwrap(
        await db().from('defense_link').update({ linked_at: null, code_hash: null, code_expires_at: null, code_tries: 0, updated_at: new Date().toISOString() }).eq('owner_did', owner),
        'unlink',
      );
    },

    /** The list the moderator's adds go to (null clears it); false when it isn't the owner's. */
    async setLinkList(listId) {
      return unwrap(await db().rpc('defense_link_list', { p_owner_did: owner, p_list_id: listId }), 'link list');
    },

    /** Add one named account: `{ outcome, job_id, decision_id }`. */
    async addNamed(listId, did, { note = null, via = 'dm' } = {}) {
      return first(unwrap(await db().rpc('defense_add_named', { p_owner_did: owner, p_list_id: listId, p_did: did, p_note: note, p_via: via }), 'add named'));
    },

    /** The owner's plans whose id starts with an eight-digit code (two means ambiguous). */
    async plansByCode(code) {
      return unwrap(await db().rpc('defense_plan_by_code', { p_owner_did: owner, p_code: code }), 'plan by code') || [];
    },

    /** Drop a plan nothing was approved from; whether one was dropped. */
    async cancelPlan(planId) {
      const gone = unwrap(await db().from('defense_plan').delete().eq('owner_did', owner).eq('id', planId).is('approved_at', null).select('id'), 'cancel plan');
      return Boolean(gone?.length);
    },

    /** The rows of one plan of the owner's; none for a plan that isn't theirs. */
    async planRows(planId) {
      // Through the plan, owner first: a plan id alone names nobody's rows.
      if (!(await this.plan(planId))) return [];
      return unwrap(await db().from('defense_plan_row').select('did, band, trust').eq('plan_id', planId).limit(10_000), 'plan rows') || [];
    },

    /** Adds for one account that are still live (queued, sent or written, not undone), newest first. */
    async liveAdds(did) {
      return (
        unwrap(
          await db()
            .from('defense_decision')
            .select('id, list_id, plan_id, state, created_at')
            .eq('owner_did', owner)
            .eq('subject_did', did)
            .eq('action', 'add')
            .in('state', ['queued', 'sent', 'done'])
            .is('undone_at', null)
            .order('id', { ascending: false })
            .limit(50),
          'live adds',
        ) || []
      );
    },

    /** The newest add still live, whatever it came from, or null. */
    async lastAdd() {
      const rows = unwrap(
        await db()
          .from('defense_decision')
          .select('id, list_id, plan_id, subject_did, state, created_at')
          .eq('owner_did', owner)
          .eq('action', 'add')
          .in('state', ['queued', 'sent', 'done'])
          .is('undone_at', null)
          .order('id', { ascending: false })
          .limit(1),
        'last add',
      );
      return rows?.[0] || null;
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
