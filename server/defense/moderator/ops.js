// What the moderator's agent can do, as operations on one owner's rows. The
// agent runs on the droplet; each of its tools is a signed call to Vercel's
// moderator route, which runs the operation here, as the owner the chat
// service said sent the message (../handlers/moderator.js).
//
// Every operation answers with data, not sentences: the agent words it. Every
// one is bound to its owner (storeFor(owner)), and every write goes where the
// web's and the typed commands' writes go, so the veto at the write still
// decides for each account. What an operation may touch is capped here, below
// the model, whatever it asks for: ten accounts to a call, a plan by its code
// only, bands and never PROTECTED.
//
// `describe` is the other half of the write check (worker/check.js): what a
// write would do, worked out here by code from its arguments, so the check
// reads what the change is rather than what the agent says it is.

import { KINDS, parseActor, shortCode } from '../../../src/defense/command.js';
import { decisionPhrase } from '../../../src/defense/historyModel.js';
import { BAND_COUNTED } from '../../../src/defense/bandWords.js';
import { APPROVABLE_BANDS, PLAN_MAX, planRows } from '../../../src/defense/plan.js';
import { ScanError } from '../../../src/defense/scan.js';
import { publicDecision } from '../handlers/history.js';
import { defenseWritesEnabled } from '../run.js';
import { storeFor as storeForOwner } from '../store.js';
import { dateOf, dmList, planFor } from './answer.js';
import { namer } from './names.js';
import { DmScanError, lookUpForOwner, scanForOwner } from './scan.js';

/** The most accounts one call adds, removes or approves by name. The agent can call again. */
export const MAX_NAMED = 10;
/** The most decisions or plans one read hands back. */
const READ_MAX = 20;

const CODE = /^[0-9a-f]{8}$/;

export class OpError extends Error {
  constructor(message, code = 'REFUSED') {
    super(message);
    this.name = 'OpError';
    this.code = code;
  }
}

/** The tools that change something; each goes past the write check first. */
export const WRITE_OPS = new Set(['approve_plan', 'add_to_list', 'remove_from_list', 'undo', 'keep', 'unkeep']);

const str = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const codeOf = (v) => {
  const c = str(v, 16).toLowerCase();
  if (!CODE.test(c)) throw new OpError(`“${str(v, 20)}” isn’t a plan code: eight letters and digits, like 3f9a2c1b.`, 'INVALID');
  return c;
};
/** A list of accounts as the agent gave them, each read as a handle, DID or profile link. */
function accountsOf(v) {
  const list = (Array.isArray(v) ? v : [v]).map((a) => str(a, 300)).filter(Boolean);
  if (!list.length) throw new OpError('Name the accounts: handles, DIDs or profile links.', 'INVALID');
  if (list.length > MAX_NAMED) throw new OpError(`At most ${MAX_NAMED} accounts to a call. Call again for the rest.`, 'INVALID');
  return list.map((given) => ({ given, actor: parseActor(given) }));
}
const bandsOf = (v) => [...new Set((Array.isArray(v) ? v : [v]).map((b) => str(b, 20).toUpperCase()))].filter((b) => APPROVABLE_BANDS.includes(b));

/** The owner's latest message as a decision's note: their words, marked as read by the agent. */
const noteFrom = (said) => `${str(said, 460)} [agent]`.trim();

/**
 * The operations for one owner. `deps` are stand-ins for tests: storeFor,
 * names, scan, lookUp, env.
 */
export function opsFor(owner, deps = {}) {
  const d = { storeFor: storeForOwner, names: namer(), scan: scanForOwner, lookUp: lookUpForOwner, env: process.env, ...deps };
  const store = d.storeFor(owner);
  const writes = () => {
    if (!defenseWritesEnabled(d.env)) throw new OpError('Defense’s lists aren’t turned on on Virga’s server yet, so nobody can be added.', 'WRITES_OFF');
  };
  const listName = async () => new Map((await store.lists()).map((l) => [l.id, l.name]));

  /** Accounts resolved to DIDs, with their handles: `[{ given, did, handle }]`; a name nobody has comes back with no DID. */
  async function resolveAll(given) {
    const out = [];
    for (const g of accountsOf(given)) out.push({ given: g.given, did: g.actor ? await d.names.resolve(g.actor) : null });
    const handles = await d.names.handles(out.map((a) => a.did).filter(Boolean));
    return out.map((a) => ({ ...a, handle: a.did ? handles.get(a.did) || null : null }));
  }
  async function onePlan(code) {
    const { plan, why } = await planFor(store, codeOf(code));
    if (!plan) throw new OpError(why, 'NOT_FOUND');
    return plan;
  }
  async function planCounts(plan) {
    const rows = await store.planRows(plan.id);
    const by = {};
    for (const r of rows) by[r.band] = (by[r.band] || 0) + 1;
    return { rows, by };
  }

  const ops = {
    async lists() {
      const link = await store.link();
      const { list } = await dmList({ store, link: link || {} });
      return {
        lists: (await store.lists()).map((l) => ({
          name: l.name,
          purpose: l.purpose,
          onItByVirga: l.listed || 0,
          waiting: l.waiting || 0,
          held: l.held_until && Date.parse(l.held_until) > Date.now() ? l.last_error || 'held' : null,
          namedAddsGoHere: Boolean(list && l.id === list.id),
        })),
      };
    },

    async recent_plans() {
      const names = await listName();
      const outcome = new Map((await store.plans({ limit: READ_MAX })).map((p) => [p.id, p]));
      return {
        plans: (await store.recentPlans({ limit: READ_MAX })).map((p) => ({
          code: shortCode(p.id),
          made: p.created_at,
          approved: p.approved_at ? p.approved_bands || [] : null,
          list: names.get(p.list_id) || null,
          post: p.post_uri || null,
          added: outcome.get(p.id)?.added || 0,
          waiting: outcome.get(p.id)?.waiting || 0,
          undone: outcome.get(p.id)?.undone || 0,
        })),
      };
    },

    async history({ account } = {}) {
      const names = await listName();
      let rows;
      let who = null;
      if (account) {
        [who] = await resolveAll([account]);
        if (!who.did) throw new OpError(`Nobody has the name ${who.given}.`, 'NOT_FOUND');
        rows = await store.historyOf(who.did, { limit: READ_MAX });
      } else {
        rows = await store.history({ limit: READ_MAX });
      }
      const handles = await d.names.handles(rows.map((r) => r.subject_did));
      return {
        account: who ? { handle: who.handle, did: who.did } : null,
        decisions: rows.map((r) => ({
          account: handles.get(r.subject_did) ? `@${handles.get(r.subject_did)}` : r.subject_did,
          what: decisionPhrase(publicDecision(r)),
          list: names.get(r.list_id) || null,
          plan: r.plan_id ? shortCode(r.plan_id) : null,
          when: dateOf(r.acted_at || r.created_at),
          note: r.note ? r.note.slice(0, 160) : null,
        })),
      };
    },

    async scan_post({ post, engagement } = {}) {
      const input = str(post, 600);
      if (!input) throw new OpError('Which post? Give its link or at:// address.', 'INVALID');
      const kind = str(engagement, 20).toLowerCase() || 'everyone';
      if (!Object.hasOwn(KINDS, kind)) throw new OpError(`“${kind}” isn’t one of ${Object.keys(KINDS).join(', ')}.`, 'INVALID');
      let summary;
      try {
        summary = await d.scan({ ownerDid: owner, input, only: KINDS[kind], kept: await store.keptMap() });
      } catch (err) {
        if (err instanceof DmScanError || err instanceof ScanError) throw new OpError(err.message, err.code === 'TOO_BIG' ? 'TOO_BIG' : 'SCAN');
        throw err;
      }
      const by = summary.totals?.byBand || {};
      const out = { engagement: kind, participants: summary.totals?.participants || 0, byBand: by, truncated: Boolean(summary.truncated), vouchesCounted: summary.vouchCheck === 'canary', code: null, list: null };
      if (!out.participants || !out.vouchesCounted) return out;
      const rows = planRows(summary, APPROVABLE_BANDS).slice(0, PLAN_MAX);
      if (!rows.length) return out;
      const { list, why } = await dmList({ store, link: (await store.link()) || {} });
      if (!list) return { ...out, noList: why };
      const planId = await store.createPlan({ listId: list.id, postUri: summary.post?.uri || null, rows, totals: { participants: out.participants, ...by } });
      return { ...out, code: planId ? shortCode(planId) : null, list: list.name };
    },

    async review_plan({ code, band } = {}) {
      const plan = await onePlan(code);
      const { rows, by } = await planCounts(plan);
      const wanted = band ? bandsOf([band]) : ['CONNECTED', 'PERIPHERAL', 'NOTABLE'];
      const shown = rows.filter((r) => wanted.includes(r.band)).sort((a, b) => (b.trust ?? 0) - (a.trust ?? 0)).slice(0, READ_MAX);
      const handles = await d.names.handles(shown.map((r) => r.did));
      const names = await listName();
      return {
        code: shortCode(plan.id),
        made: plan.created_at,
        post: plan.post_uri || null,
        list: names.get(plan.list_id) || null,
        approved: plan.approved_at ? (plan.approved_bands || []) : null,
        byBand: by,
        accounts: shown.map((r) => ({ account: handles.get(r.did) ? `@${handles.get(r.did)}` : r.did, band: r.band })),
        more: Math.max(0, rows.filter((r) => wanted.includes(r.band)).length - shown.length),
      };
    },

    async look_up_account({ account } = {}) {
      const [who] = await resolveAll([account]);
      if (!who.did) throw new OpError(`Nobody has the name ${who.given}.`, 'NOT_FOUND');
      const kept = await store.keptMap([who.did]);
      const live = await store.liveAdds(who.did);
      let score = null;
      try {
        score = await d.lookUp({ ownerDid: owner, did: who.did, kept });
      } catch (err) {
        if (err instanceof DmScanError || err instanceof ScanError) throw new OpError(err.message, 'SCAN');
        throw err;
      }
      return {
        account: who.handle ? `@${who.handle}` : who.did,
        band: score?.band || null,
        bandMeans: score?.band ? BAND_COUNTED[score.band] : null,
        knownFollowers: score?.vouches ?? null,
        youFollow: Boolean(score?.youFollow),
        followsYou: Boolean(score?.followsYou),
        keptByHand: kept.has(who.did) ? kept.get(who.did) || true : false,
        onYourListsByVirga: live.length,
      };
    },

    async approve_plan({ code, bands, said } = {}) {
      writes();
      const plan = await onePlan(code);
      const ticked = bandsOf(bands);
      if (!ticked.length) throw new OpError('Name the bands to approve: UNKNOWN, NOTABLE, PERIPHERAL or CONNECTED. PROTECTED is never added.', 'INVALID');
      const out = await store.approvePlan(plan.id, { bands: ticked, note: noteFrom(said), via: 'dm' });
      if (!out) throw new OpError(`Plan ${shortCode(plan.id)} can’t be approved: it has expired, or its list isn’t kept any more.`, 'REFUSED');
      return { code: shortCode(plan.id), bands: ticked, queued: out.queued, keptByHand: out.kept, alreadyOnIt: out.already, list: (await listName()).get(plan.list_id) || null };
    },

    async add_to_list({ accounts, said } = {}) {
      writes();
      const who = await resolveAll(accounts);
      const { list, why } = await dmList({ store, link: (await store.link()) || {} });
      if (!list) throw new OpError(why, 'NO_LIST');
      const results = [];
      for (const a of who) {
        if (!a.did) {
          results.push({ account: a.given, outcome: 'no such account' });
          continue;
        }
        const out = await store.addNamed(list.id, a.did, { note: noteFrom(said), via: 'dm' });
        results.push({ account: a.handle ? `@${a.handle}` : a.did, outcome: out?.outcome || 'refused' });
      }
      return { list: list.name, results };
    },

    async remove_from_list({ accounts, said } = {}) {
      const who = await resolveAll(accounts);
      const results = [];
      for (const a of who) {
        if (!a.did) {
          results.push({ account: a.given, outcome: 'no such account' });
          continue;
        }
        const adds = await store.liveAdds(a.did);
        if (!adds.length) {
          results.push({ account: a.handle ? `@${a.handle}` : a.did, outcome: 'not on any list by Virga' });
          continue;
        }
        const out = await store.undo({ ids: adds.map((x) => Number(x.id)), note: noteFrom(said), via: 'dm' });
        results.push({ account: a.handle ? `@${a.handle}` : a.did, outcome: out?.queued ? 'being taken off' : 'cancelled before it was written' });
      }
      return { results };
    },

    async undo({ code, said } = {}) {
      let planId = null;
      let ids = null;
      let what;
      if (code) {
        const plan = await onePlan(code);
        planId = plan.id;
        what = `plan ${shortCode(plan.id)}`;
      } else {
        const last = await store.lastAdd();
        if (!last) return { what: null, cancelled: 0, takingOff: 0 };
        if (last.plan_id) {
          planId = last.plan_id;
          what = `plan ${shortCode(last.plan_id)}`;
        } else {
          ids = [Number(last.id)];
          const handles = await d.names.handles([last.subject_did]);
          what = handles.get(last.subject_did) ? `@${handles.get(last.subject_did)}` : last.subject_did;
        }
      }
      const out = await store.undo({ planId, ids, note: noteFrom(said), via: 'dm' });
      return { what, cancelled: out?.cancelled || 0, takingOff: out?.queued || 0 };
    },

    async keep({ account, reason } = {}) {
      const [who] = await resolveAll([account]);
      if (!who.did) throw new OpError(`Nobody has the name ${who.given}.`, 'NOT_FOUND');
      await store.keep(who.did, str(reason, 200) || 'kept by DM');
      return { account: who.handle ? `@${who.handle}` : who.did, kept: true, onYourListsByVirga: (await store.liveAdds(who.did)).length };
    },

    async unkeep({ account } = {}) {
      const [who] = await resolveAll([account]);
      if (!who.did) throw new OpError(`Nobody has the name ${who.given}.`, 'NOT_FOUND');
      await store.unkeep(who.did);
      return { account: who.handle ? `@${who.handle}` : who.did, kept: false };
    },
  };

  /**
   * What a write would do, worked out by code: `{ text, accounts: [{ given,
   * did, handle }] }`. The write check reads this, not the agent's account
   * of it. Nothing is changed.
   */
  async function describe(name, args = {}) {
    switch (name) {
      case 'approve_plan': {
        const plan = await onePlan(args.code);
        const { by } = await planCounts(plan);
        const ticked = bandsOf(args.bands);
        const parts = ticked.map((b) => `${by[b] || 0} ${BAND_COUNTED[b]} (${b})`);
        const list = (await listName()).get(plan.list_id) || 'a list';
        return {
          text: `Approve plan ${shortCode(plan.id)}, a scan of ${plan.post_uri || 'a post'} made ${dateOf(plan.created_at)}: add ${parts.join(', ') || 'nobody'} to the block list “${list}”.`,
          accounts: [],
        };
      }
      case 'add_to_list':
      case 'remove_from_list': {
        const who = await resolveAll(args.accounts);
        const named = who.map((a) => (a.handle ? `@${a.handle}` : a.did || a.given)).join(', ');
        if (name === 'remove_from_list') return { text: `Take ${who.length === 1 ? 'this account' : `these ${who.length} accounts`} off the owner’s lists: ${named}.`, accounts: who };
        const { list } = await dmList({ store, link: (await store.link()) || {} });
        return { text: `Add ${who.length === 1 ? 'this account' : `these ${who.length} accounts`} to the block list “${list?.name || 'the owner’s list'}”: ${named}.`, accounts: who };
      }
      case 'undo': {
        if (args.code) {
          const plan = await onePlan(args.code);
          return { text: `Take back everything plan ${shortCode(plan.id)} added (a scan of ${plan.post_uri || 'a post'}, made ${dateOf(plan.created_at)}).`, accounts: [] };
        }
        const last = await store.lastAdd();
        if (!last) return { text: 'Take back the last thing added (there is nothing to take back).', accounts: [] };
        if (last.plan_id) return { text: `Take back the last approval, plan ${shortCode(last.plan_id)}, and everyone it added.`, accounts: [] };
        const handles = await d.names.handles([last.subject_did]);
        return { text: `Take back the last account added: ${handles.get(last.subject_did) ? `@${handles.get(last.subject_did)}` : last.subject_did}.`, accounts: [] };
      }
      case 'keep':
      case 'unkeep': {
        const [who] = await resolveAll([args.account]);
        const named = who.handle ? `@${who.handle}` : who.did || who.given;
        return {
          text: name === 'keep' ? `Keep ${named} off every list by hand, so Virga never adds them.` : `Stop keeping ${named} off the lists by hand, so a scan may add them again.`,
          accounts: [who],
        };
      }
      default:
        throw new OpError(`${name} isn’t a write.`, 'INVALID');
    }
  }

  return { ops, describe };
}

/** The operations' names, for the route to check what it was asked. */
export const OP_NAMES = Object.freeze(['lists', 'recent_plans', 'history', 'scan_post', 'review_plan', 'look_up_account', 'approve_plan', 'add_to_list', 'remove_from_list', 'undo', 'keep', 'unkeep']);
