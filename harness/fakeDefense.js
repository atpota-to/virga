// Virga's Defense routes, in the shapes server/defense/handlers/* answer with,
// over memory, for the harness's fake server (fakeServer.js mounts them).
// `run()` stands in for the run route: on each tick of the server's workers it
// writes one batch per holder into the account's world, as list items in its
// repo, with the same veto the real one reads: the owner and the holder, the
// people kept by hand, everyone the account follows, and the members of its
// curation lists.
//
// What it doesn't do: talk to a database, open a session or check a PDS's
// limits. The real thing is tested on PGlite (server/defense/*.pglite.test.js);
// this is for clicking through.

import { LIST_TOKENS } from '../src/config.js';
import { APPROVABLE_BANDS, NOTE_MAX, PLAN_MAX } from '../src/defense/plan.js';
import { BATCH } from '../src/defense/pace.js';
import { createTidClock } from '../src/posting/lib/tid.js';
import { missingScopes } from '../src/session/scopes.js';
import { removeRecord, writeRecord } from './repo.js';

const DID = /^did:[a-z]+:[a-zA-Z0-9._:%-]+$/;
const LISTITEM = 'app.bsky.graph.listitem';
const CURATELIST = 'app.bsky.graph.defs#curatelist';

const coded = (status, body) => Object.assign(new Error(body.error), { httpStatus: status, body: { success: false, ...body } });
const text = (v, max) => (typeof v === 'string' && v.replace(/\s+/g, ' ').trim() ? v.replace(/\s+/g, ' ').trim().slice(0, max) : null);

/**
 * @param {object} opts
 * @param {object[]} opts.worlds   every account's world
 * @param {boolean} [opts.writes]  whether "DEFENSE_WRITES" is on
 * @param {() => number} [opts.now]
 * @param {(line: string) => void} [opts.note]  the server's log
 */
export function createDefense({ worlds, writes = true, moderator = 'on', now = () => Date.now(), note = () => {} }) {
  const worldOf = (did) => worlds.find((w) => w.me.did === did) || null;
  const nextKey = createTidClock();
  const iso = (ms = now()) => new Date(ms).toISOString();
  let seq = 0;

  const lists = []; // { id, owner_did, holder_did, mode, uri, name, purpose, created_at }
  const kept = []; // { owner_did, did, reason, added_at }
  const plans = []; // { id, owner_did, list_id, post_uri, rows, approved_at, approved_bands, note, totals, created_at }
  const decisions = []; // as defense_decision
  const jobs = []; // { id, owner_did, list_id, kind, state, next_at, last_error }
  // The moderator's links: did -> { linked_at, code, code_at, list_id }. A
  // code "lands" ten seconds after it is made, as if the owner DMed it.
  const links = new Map(moderator === 'linked' ? worlds.map((w) => [w.me.did, { linked_at: iso(), code: null, code_at: null, list_id: null }]) : []);
  const MODERATOR = moderator === 'off' ? null : 'mod.virga.example';

  const id = () => `${(++seq).toString(16).padStart(8, '0')}-0000-4000-8000-${now().toString(16).padStart(12, '0').slice(-12)}`;
  const mine = (auth) => (row) => row.owner_did === auth.did;
  const requireWrites = () => {
    if (!writes) throw coded(503, { code: 'WRITES_OFF', error: 'Defense’s lists aren’t turned on on Virga’s server yet.' });
  };

  function summary(list) {
    const on = decisions.filter((d) => d.list_id === list.id);
    const job = jobs.filter((j) => j.list_id === list.id && j.state === 'pending' && j.last_error).sort((a, b) => b.next_at - a.next_at)[0];
    return {
      id: list.id,
      holderDid: list.holder_did,
      mode: list.mode,
      uri: list.uri,
      name: list.name,
      purpose: list.purpose,
      createdAt: list.created_at,
      listed: on.filter((d) => d.action === 'add' && (d.state === 'done' || d.state === 'already') && !d.undone_at).length,
      waiting: on.filter((d) => d.state === 'queued' || d.state === 'sent').length,
      heldUntil: job && job.next_at > now() ? iso(job.next_at) : null,
      lastError: job?.last_error || null,
    };
  }

  const publicDecision = (d) => ({
    id: d.id,
    listId: d.list_id,
    planId: d.plan_id,
    did: d.subject_did,
    action: d.action,
    band: d.band,
    trust: d.trust,
    via: d.via,
    note: d.note,
    state: d.state,
    reason: d.reason,
    createdAt: d.created_at,
    actedAt: d.acted_at,
    undoneAt: d.undone_at,
    undoes: d.undoes ?? null,
  });

  const live = (listId, did) => decisions.some((d) => d.list_id === listId && d.subject_did === did && d.action === 'add' && ['queued', 'sent', 'done', 'already'].includes(d.state) && !d.undone_at);

  const api = {};

  api['GET /api/defense/lists'] = (auth) => [
    200,
    {
      success: true,
      data: {
        lists: lists.filter(mine(auth)).map(summary),
        kept: kept.filter(mine(auth)).map((k) => ({ did: k.did, reason: k.reason, addedAt: k.added_at })),
        writes,
      },
    },
  ];

  api['POST /api/defense/list-create'] = async (auth, { body }) => {
    requireWrites();
    const name = text(body?.name, 64);
    const purpose = body?.purpose === 'mute' ? 'mute' : body?.purpose === 'block' ? 'block' : null;
    if (!name || !purpose) throw coded(400, { code: 'INVALID', error: 'A list needs a name and to be for blocking or muting.' });
    const world = worldOf(auth.did);
    if (missingScopes(world.scope, LIST_TOKENS).length) {
      throw coded(403, { code: 'NO_SCOPE', error: 'This sign-in doesn’t let Virga make lists. Sign in again from Defense to let it.' });
    }
    const rkey = nextKey();
    await writeRecord(world, {
      collection: 'app.bsky.graph.list',
      rkey,
      record: { $type: 'app.bsky.graph.list', purpose: 'app.bsky.graph.defs#modlist', name, description: 'Kept with Virga.', createdAt: iso() },
      createOnly: true,
    });
    const row = { id: id(), owner_did: auth.did, holder_did: auth.did, mode: 'own', uri: `at://${auth.did}/app.bsky.graph.list/${rkey}`, name, purpose, created_at: iso() };
    lists.push(row);
    note(`defense: made the list “${name}” for ${auth.did}`);
    return [200, { success: true, data: { list: summary(row) } }];
  };

  api['POST /api/defense/keep'] = (auth, { body }) => {
    if (!DID.test(body?.did || '')) throw coded(400, { code: 'INVALID', error: 'That isn’t an account’s DID.' });
    const reason = text(body.reason, 200) || 'kept by hand';
    const found = kept.find((k) => k.owner_did === auth.did && k.did === body.did);
    if (found) found.reason = reason;
    else kept.unshift({ owner_did: auth.did, did: body.did, reason, added_at: iso() });
    return [200, { success: true, data: { did: body.did, reason } }];
  };

  api['POST /api/defense/unkeep'] = (auth, { body }) => {
    const i = kept.findIndex((k) => k.owner_did === auth.did && k.did === body?.did);
    if (i !== -1) kept.splice(i, 1);
    return [200, { success: true, data: { did: body?.did } }];
  };

  api['POST /api/defense/plan'] = (auth, { body }) => {
    const list = lists.find((l) => l.id === body?.listId && l.owner_did === auth.did);
    const raw = Array.isArray(body?.rows) ? body.rows : [];
    if (!raw.length || raw.length > PLAN_MAX) throw coded(400, { code: 'INVALID', error: 'A plan needs between one and ten thousand accounts.' });
    for (const r of raw) {
      if (!DID.test(r?.did || '') || !APPROVABLE_BANDS.includes(r.band)) throw coded(400, { code: 'INVALID', error: 'A plan can’t hold anyone protected, or a row without a DID.' });
    }
    if (!list) throw coded(404, { code: 'NO_LIST', error: 'That list isn’t one of yours, or isn’t kept any more.' });
    const plan = { id: id(), owner_did: auth.did, list_id: list.id, post_uri: body.postUri || null, rows: raw.map((r) => ({ did: r.did, band: r.band, trust: r.trust ?? null })), approved_at: null, approved_bands: [], note: null, totals: body.totals || {}, created_at: iso() };
    plans.push(plan);
    return [200, { success: true, data: { planId: plan.id, rows: plan.rows.length } }];
  };

  api['POST /api/defense/approve'] = (auth, { body }) => {
    requireWrites();
    const plan = plans.find((p) => p.id === body?.planId && p.owner_did === auth.did);
    const bands = (Array.isArray(body?.bands) ? body.bands : []).filter((b) => APPROVABLE_BANDS.includes(b));
    if (!bands.length) throw coded(400, { code: 'INVALID', error: 'Approve a plan by naming at least one band.' });
    if (!plan) throw coded(404, { code: 'NO_PLAN', error: 'That plan isn’t yours, has expired, or its list is gone.' });
    const noteText = text(body.note, NOTE_MAX);
    const keptSet = new Set(kept.filter(mine(auth)).map((k) => k.did));
    const chosen = plan.rows.filter((r) => bands.includes(r.band));
    const keptOut = chosen.filter((r) => keptSet.has(r.did)).length;
    const already = chosen.filter((r) => !keptSet.has(r.did) && live(plan.list_id, r.did)).length;
    const fresh = chosen.filter((r) => !keptSet.has(r.did) && !live(plan.list_id, r.did));
    let jobId = null;
    if (fresh.length) {
      const job = { id: id(), owner_did: auth.did, list_id: plan.list_id, kind: 'add', state: 'pending', next_at: now(), last_error: null };
      jobs.push(job);
      jobId = job.id;
      for (const r of fresh) {
        decisions.push({ id: decisions.length + 1, owner_did: auth.did, list_id: plan.list_id, plan_id: plan.id, job_id: job.id, subject_did: r.did, action: 'add', band: r.band, trust: r.trust, via: 'web', note: noteText, state: 'queued', rkey: null, reason: null, created_at: iso(), acted_at: null, undone_at: null, undoes: null });
      }
    }
    plan.approved_at = iso();
    plan.approved_bands = [...new Set([...plan.approved_bands, ...bands])].sort();
    plan.note = noteText ?? plan.note;
    note(`defense: queued ${fresh.length} for ${auth.did}`);
    return [200, { success: true, data: { jobId, queued: fresh.length, kept: keptOut, already } }];
  };

  api['GET /api/defense/history'] = (auth, { query }) => {
    const before = Number(query?.get?.('before')) || Infinity;
    const out = decisions.filter((d) => d.owner_did === auth.did && d.id < before).sort((a, b) => b.id - a.id).slice(0, 200);
    return [
      200,
      {
        success: true,
        data: {
          decisions: out.map(publicDecision),
          plans: plans
            .filter((p) => p.owner_did === auth.did && p.approved_at)
            .sort((a, b) => (a.approved_at < b.approved_at ? 1 : -1))
            .map((p) => {
              const adds = decisions.filter((d) => d.plan_id === p.id && d.action === 'add');
              const n = (f) => adds.filter(f).length;
              return {
                id: p.id,
                listId: p.list_id,
                postUri: p.post_uri,
                createdAt: p.created_at,
                approvedAt: p.approved_at,
                bands: p.approved_bands,
                note: p.note,
                totals: p.totals,
                counts: {
                  added: n((d) => (d.state === 'done' || d.state === 'already') && !d.undone_at),
                  waiting: n((d) => (d.state === 'queued' || d.state === 'sent') && !d.undone_at),
                  kept: n((d) => d.state === 'vetoed'),
                  failed: n((d) => d.state === 'failed'),
                  undone: n((d) => Boolean(d.undone_at)),
                  live: n((d) => ['queued', 'sent', 'done'].includes(d.state) && !d.undone_at),
                },
              };
            }),
        },
      },
    ];
  };

  // Undo isn't stopped by writes being off, as on the server.
  api['POST /api/defense/undo'] = (auth, { body }) => {
    const ids = Array.isArray(body?.ids) ? body.ids : [];
    const inScope = (d) => d.owner_did === auth.did && d.action === 'add' && !d.undone_at && ((body?.planId && d.plan_id === body.planId) || ids.includes(d.id));
    let cancelled = 0;
    let queued = 0;
    for (const d of decisions.filter((x) => inScope(x) && x.state === 'queued')) {
      d.state = 'cancelled';
      d.undone_at = iso();
      d.reason = 'undone before it was written';
      cancelled += 1;
    }
    const byList = new Map();
    for (const d of decisions.filter((x) => inScope(x) && (x.state === 'sent' || x.state === 'done') && x.rkey)) {
      if (decisions.some((x) => x.undoes === d.id && (x.state === 'queued' || x.state === 'sent'))) continue;
      if (!byList.has(d.list_id)) {
        const job = { id: id(), owner_did: auth.did, list_id: d.list_id, kind: 'remove', state: 'pending', next_at: now(), last_error: null };
        jobs.push(job);
        byList.set(d.list_id, job);
      }
      decisions.push({ id: decisions.length + 1, owner_did: auth.did, list_id: d.list_id, plan_id: null, job_id: byList.get(d.list_id).id, subject_did: d.subject_did, action: 'remove', band: null, trust: null, via: 'web', note: text(body?.note, NOTE_MAX), state: 'queued', rkey: d.rkey, reason: null, created_at: iso(), acted_at: null, undone_at: null, undoes: d.id });
      queued += 1;
    }
    return [200, { success: true, data: { jobId: [...byList.values()][0]?.id ?? null, cancelled, queued } }];
  };

  const linkOf = (did) => {
    const l = links.get(did);
    if (l?.code && !l.linked_at && now() - l.code_at > 10_000) {
      l.linked_at = iso();
      l.code = null;
      note(`the moderator was linked by ${did}`);
    }
    return l || null;
  };
  api['GET /api/defense/link'] = (auth) => {
    const l = linkOf(auth.did);
    const live = l?.code && now() - l.code_at < 15 * 60_000;
    return [200, { success: true, data: { moderator: MODERATOR, linked: Boolean(l?.linked_at), linkedAt: l?.linked_at ?? null, codeExpiresAt: live ? iso(l.code_at + 15 * 60_000) : null, listId: l?.list_id ?? null } }];
  };
  api['POST /api/defense/link-code'] = (auth) => {
    if (!MODERATOR) return [503, { success: false, code: 'NO_MODERATOR', error: 'Virga’s moderator isn’t set up on this server yet.' }];
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const code = Array.from({ length: 8 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
    const l = links.get(auth.did) || { linked_at: null, list_id: null };
    links.set(auth.did, { ...l, code, code_at: now() });
    return [200, { success: true, data: { code: `${code.slice(0, 4)}-${code.slice(4)}`, expiresAt: iso(now() + 15 * 60_000), moderator: MODERATOR } }];
  };
  api['POST /api/defense/unlink'] = (auth) => {
    const l = links.get(auth.did);
    if (l) Object.assign(l, { linked_at: null, code: null, code_at: null });
    return [200, { success: true, data: { linked: false } }];
  };
  api['POST /api/defense/link-list'] = (auth, { body }) => {
    const listId = body?.listId || null;
    if (listId && !lists.some((x) => x.id === listId && x.owner_did === auth.did && !x.removed_at)) return [404, { success: false, code: 'NOT_FOUND', error: 'That list isn’t one of yours.' }];
    const l = links.get(auth.did) || { linked_at: null, code: null, code_at: null };
    links.set(auth.did, { ...l, list_id: listId });
    return [200, { success: true, data: { listId } }];
  };

  /** Who the owner may never add: did -> why. */
  function vetoFor(owner, holder, dids) {
    const world = worldOf(owner);
    const follows = new Set(world.follows.map((r) => r.value.subject));
    const keptBy = new Map(kept.filter((k) => k.owner_did === owner).map((k) => [k.did, k.reason]));
    const curated = new Map();
    for (const l of world.ownLists || []) if (l.purpose === CURATELIST) for (const m of l.members || []) curated.set(m, l.name);
    const out = new Map();
    for (const did of dids) {
      if (did === owner) out.set(did, 'your own account');
      else if (did === holder) out.set(did, 'the account that holds the list');
      else if (keptBy.has(did)) out.set(did, keptBy.get(did));
      else if (follows.has(did)) out.set(did, 'you follow them');
      else if (curated.has(did)) out.set(did, `on your list “${curated.get(did)}”`);
    }
    return out;
  }

  /** One pass: a batch per holder. Returns how many were written. */
  async function run() {
    if (!writes) return 0;
    let written = 0;
    const holders = new Set();
    for (const job of jobs.filter((j) => j.state === 'pending' && j.next_at <= now())) {
      const list = lists.find((l) => l.id === job.list_id);
      if (!list || holders.has(list.holder_did)) continue;
      holders.add(list.holder_did);
      const world = worldOf(list.holder_did);
      const batch = decisions.filter((d) => d.job_id === job.id && (d.state === 'queued' || d.state === 'sent')).slice(0, BATCH);
      if (!batch.length) {
        job.state = 'done';
        continue;
      }
      if (job.kind === 'add' && missingScopes(world.scope, LIST_TOKENS).length) {
        job.last_error = 'This sign-in doesn’t let Virga write lists. Sign in again from Defense › Lists to let it.';
        job.next_at = now() + 60_000;
        continue;
      }
      const veto = job.kind === 'add' ? vetoFor(list.owner_did, list.holder_did, batch.map((d) => d.subject_did)) : new Map();
      for (const d of batch) {
        d.rkey ||= nextKey();
        if (veto.has(d.subject_did)) {
          d.state = 'vetoed';
          d.reason = veto.get(d.subject_did);
          continue;
        }
        if (job.kind === 'add') {
          await writeRecord(world, { collection: LISTITEM, rkey: d.rkey, record: { $type: LISTITEM, subject: d.subject_did, list: list.uri, createdAt: iso() } });
          d.state = 'done';
          written += 1;
        } else {
          const found = removeRecord(world, LISTITEM, d.rkey);
          d.state = found === false ? 'already' : 'done';
          const add = decisions.find((x) => x.id === d.undoes);
          if (add) add.undone_at = iso();
        }
        d.acted_at = iso();
      }
      if (!decisions.some((d) => d.job_id === job.id && (d.state === 'queued' || d.state === 'sent'))) job.state = 'done';
      job.last_error = null;
    }
    if (written) note(`defense: wrote ${written} list items`);
    return written;
  }

  return { api, run, inspect: () => ({ lists, kept, plans, decisions, jobs, links }) };
}
