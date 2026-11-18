// One DM, answered: what the moderator says back to the account that sent it,
// and what it does for them on the way. Parsed by the grammar
// (src/defense/command.js), never interpreted; no model is involved.
//
// Who the sender is comes from the chat service (pass.js), and everything
// here runs as them: storeFor(sender), and nothing else. Someone who hasn't
// linked the moderator gets one line, the same whoever they are, at most once
// a day, so a DM can't tell anyone whether a handle uses Virga. A linked
// owner's commands touch only their own lists, and the replies name only
// their own lists, plans and decisions (docs/DEFENSE-THREATS.md, phase 4).

import { HELP, KINDS, facetLinks, facetMentions, parseCommand, parsePostScan, shortCode } from '../../../src/defense/command.js';
import { decisionPhrase } from '../../../src/defense/historyModel.js';
import { BAND_COUNTED } from '../../../src/defense/bandWords.js';
import { APPROVABLE_BANDS, PLAN_MAX, estimateWords, planRows } from '../../../src/defense/plan.js';
import { ScanError } from '../../../src/defense/scan.js';
import { fmtInt } from '../../../src/lib/locale.js';
import { publicUrl } from '../../origins.js';
import { publicDecision } from '../handlers/history.js';
import { hashLinkCode, hashSender } from '../linking.js';
import { ListError, NAME_MAX, createOwnList } from '../lists.js';
import { defenseWritesEnabled } from '../run.js';
import { storeFor as storeForOwner } from '../store.js';
import { atName, namer } from './names.js';
import { DmScanError, scanForOwner } from './scan.js';
import { dmState } from './state.js';

const DID = /^did:[a-z]+:[a-zA-Z0-9._:%-]+$/;

/** What anyone who hasn't linked is told: the same, whoever they are. */
export const STRANGER =
  'This is Virga’s moderator. It answers only accounts that have linked it from Virga, under Defense › Lists.';
export const LINK_HOW = 'Send “link” and the code Virga shows under Defense › Lists, like “link ABCD-EFGH”.';
export const LINK_FAILED =
  'That code didn’t link anything. A code lasts fifteen minutes and works only from the account that made it. Make a new one in Virga, under Defense › Lists, and send it here.';
export const NOT_A_COMMAND = 'I didn’t read that as something I do. Send “help” for what I answer to.';
export const WRITES_OFF =
  'Defense’s lists aren’t turned on on Virga’s server yet, so I can’t add anyone. “lists”, “history” and “undo” still work.';
const WHO =
  'Who? Name them with a full handle (“block @someone.bsky.social”), a DID or a profile link. I don’t work out who you mean from anything else.';

const dateOf = (iso) => {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : '';
};

/**
 * The reply to one message, or null for none.
 *
 * @param {object} opts
 * @param {string} opts.sender    the DID the chat service says sent it
 * @param {object} opts.message   the chat service's message view
 * @param {string|null} opts.sharedUri  the record the message shares, if any
 * @param {object} [opts.deps]    stand-ins for tests: storeFor, state, names, createList, scan
 */
export async function answerMessage({ sender, message, sharedUri = null, env = process.env, deps = {} }) {
  if (!DID.test(sender || '')) return null;
  const d = { storeFor: storeForOwner, state: dmState(), names: namer(), createList: createOwnList, scan: scanForOwner, ...deps };
  const store = d.storeFor(sender);
  const text = typeof message?.text === 'string' ? message.text : '';
  const opts = { embedUri: sharedUri, links: facetLinks(message), mentions: facetMentions(message) };
  let cmd = parseCommand(text, opts);
  if (!cmd) {
    const post = parsePostScan(text, opts);
    if (post) cmd = { action: 'plan', kind: 'everyone', target: post, needsTarget: false, raw: text };
  }

  // Linking is the one thing anyone may send. What comes back is the same
  // for a wrong code, an expired one, and an account with none.
  if (cmd?.action === 'link') {
    if (!cmd.code) return LINK_HOW;
    const out = await store.claimLink(hashLinkCode(sender, cmd.code));
    if (out !== 'linked') return LINK_FAILED;
    const lists = await store.lists();
    return [
      'Linked. I answer this account now, and only this one. Send “help” for what I do.',
      lists.length === 1 ? `When you send “block @someone”, they go on “${lists[0].name}”.` : lists.length ? 'Choose the list “block @someone” adds to in Virga, under Defense › Lists.' : '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  const link = await store.link();
  if (!link?.linked_at) return (await d.state.strangerDue(hashSender(sender))) ? STRANGER : null;
  if (!cmd) return NOT_A_COMMAND;

  const ctx = { d, store, link, cmd, env, sender };
  if (cmd.needsTarget) return askBack(cmd);
  switch (cmd.action) {
    case 'help':
      return HELP;
    case 'lists':
      return listsReply(ctx);
    case 'status':
      return statusReply(ctx);
    case 'history':
      return historyReply(ctx);
    case 'undo':
      return undoReply(ctx);
    case 'keep':
    case 'unkeep':
      return keepReply(ctx);
    case 'list_add':
      return addReply(ctx);
    case 'list_remove':
      return removeReply(ctx);
    case 'approve':
      return approveReply(ctx);
    case 'review':
      return reviewReply(ctx);
    case 'cancel':
      return cancelReply(ctx);
    case 'new_list':
      return newListReply(ctx);
    case 'plan':
      return scanReply(ctx);
    default:
      return NOT_A_COMMAND;
  }
}

/** What a command that names nothing (or two things) is answered with. */
function askBack(cmd) {
  if (cmd.refusal) return cmd.refusal;
  switch (cmd.action) {
    case 'approve':
      return 'Which approval? Send its code and the bands, like “approve 3f9a2c1b UNKNOWN”.';
    case 'review':
    case 'cancel':
      return `Which plan? Send its code, like “${cmd.action} 3f9a2c1b”.`;
    case 'undo':
      return 'Which? Send “undo” for the last thing added, or “undo” and an approval’s code.';
    case 'new_list':
      return 'What should it be called? Send “new list” and its name, like “new list Pile-ons”.';
    case 'plan':
      return 'Which post? Paste its link, or share it to me.';
    default:
      return WHO;
  }
}

/** The list "block @someone" adds to: the one chosen, or the only one. `{ list }` or `{ why }`. */
async function dmList({ store, link }) {
  const lists = await store.lists();
  const chosen = link.list_id && lists.find((l) => l.id === link.list_id);
  if (chosen) return { list: chosen, lists };
  if (lists.length === 1) return { list: lists[0], lists };
  if (!lists.length) return { why: 'You have no list yet. Make one in Virga under Defense › Lists, or send “new list” and a name.', lists };
  return { why: 'You have more than one list. Choose the one I add to in Virga, under Defense › Lists.', lists };
}

async function listsReply(ctx) {
  const { list, lists } = await dmList(ctx);
  if (!lists.length) return 'You have no lists yet. Make one in Virga under Defense › Lists, or send “new list” and a name.';
  const lines = lists.map((l) => {
    const parts = [`“${l.name}” (${l.purpose === 'mute' ? 'mute' : 'block'}): ${fmtInt(l.listed || 0)} on it by Virga`];
    if (l.waiting) parts.push(`${fmtInt(l.waiting)} waiting`);
    if (list && l.id === list.id) parts.push('“block” adds here');
    return `• ${parts.join(', ')}`;
  });
  return lines.join('\n');
}

async function statusReply({ store }) {
  const lists = await store.lists();
  const busy = lists.filter((l) => l.waiting);
  if (!busy.length) return lists.length ? 'Nothing is waiting to be written.' : 'You have no lists yet.';
  return busy
    .map((l) => {
      const held = l.held_until && Date.parse(l.held_until) > Date.now() && l.last_error ? ` Held: ${l.last_error}` : '';
      return `• “${l.name}”: ${fmtInt(l.waiting)} waiting, ${estimateWords(l.waiting)} at Virga’s pace.${held}`;
    })
    .join('\n');
}

async function historyReply({ d, store, cmd }) {
  const lists = new Map((await store.lists()).map((l) => [l.id, l.name]));
  let rows;
  let did = null;
  if (cmd.actor) {
    did = await d.names.resolve(cmd.actor);
    if (!did) return `I couldn’t find @${cmd.actor}.`;
    rows = await store.historyOf(did, { limit: 10 });
  } else {
    rows = await store.history({ limit: 10 });
  }
  if (!rows.length) return did ? `Nothing about ${atName(did, await d.names.handles([did]))} in your lists’ history.` : 'Nobody has been added or taken off yet.';
  const handles = await d.names.handles(rows.map((r) => r.subject_did));
  return rows
    .map((r) => {
      const decision = publicDecision(r);
      const parts = [`${atName(r.subject_did, handles)}: ${decisionPhrase(decision)}`];
      if (lists.get(r.list_id)) parts.push(`“${lists.get(r.list_id)}”`);
      parts.push(dateOf(r.acted_at || r.created_at));
      if (r.note) parts.push(`“${r.note.slice(0, 120)}”`);
      return `• ${parts.filter(Boolean).join(' · ')}`;
    })
    .join('\n');
}

/** The one plan of the owner's a code names, or a sentence saying why not. */
async function planFor(store, code) {
  const plans = await store.plansByCode(code);
  if (!plans.length) return { why: `You have no plan ${code}.` };
  if (plans.length > 1) return { why: `Two of your plans start ${code}. Do this one from Virga, under Defense › History.` };
  return { plan: plans[0] };
}

async function undoReply({ store, cmd }) {
  let planId = null;
  let ids = null;
  let what;
  if (cmd.code) {
    const { plan, why } = await planFor(store, cmd.code);
    if (!plan) return why;
    planId = plan.id;
    what = `approval ${cmd.code}`;
  } else {
    const last = await store.lastAdd();
    if (!last) return 'Nothing is on your lists by Virga’s hand to take back.';
    if (last.plan_id) {
      planId = last.plan_id;
      what = `your last approval, ${shortCode(last.plan_id)}`;
    } else {
      ids = [last.id];
      what = 'the last account added';
    }
  }
  const out = await store.undo({ planId, ids, note: cmd.raw.slice(0, 500), via: 'dm' });
  const cancelled = out?.cancelled || 0;
  const queued = out?.queued || 0;
  if (!cancelled && !queued) return `Nothing from ${what} is left to take back.`;
  const parts = [];
  if (cancelled) parts.push(`${fmtInt(cancelled)} not written yet, cancelled`);
  if (queued) parts.push(`${fmtInt(queued)} to be taken off, a batch at a time`);
  return `Taking back ${what}: ${parts.join('; ')}.`;
}

async function keepReply({ d, store, cmd }) {
  const did = await d.names.resolve(cmd.actor);
  if (!did) return `I couldn’t find @${cmd.actor}.`;
  const name = atName(did, await d.names.handles([did]));
  if (cmd.action === 'unkeep') {
    await store.unkeep(did);
    return `${name} isn’t kept by hand any more. Someone you follow, or have on a curation list, is still never added.`;
  }
  await store.keep(did, cmd.reason || 'kept by DM');
  const live = await store.liveAdds(did);
  return `Kept ${name}: Virga won’t add them to any of your lists.${live.length ? ` They’re on one already; “unblock ${name}” takes them off.` : ''}`;
}

async function addReply({ d, store, cmd, env, sender }) {
  if (!defenseWritesEnabled(env)) return WRITES_OFF;
  const did = await d.names.resolve(cmd.actor);
  if (!did) return `I couldn’t find @${cmd.actor}.`;
  const name = atName(did, await d.names.handles([did]));
  // A shared post names its author; a message with more words than "block
  // this" might mean someone else in it, and is asked rather than acted on.
  if (cmd.fromPost && cmd.confirm) return `Do you mean ${name}, who wrote that post? Send “block ${name}” to add them.`;
  if (did === sender) return 'That’s you.';
  const { list, why } = await dmList({ store, link: await store.link() });
  if (!list) return why;
  const out = await store.addNamed(list.id, did, { note: cmd.raw.slice(0, 500), via: 'dm' });
  switch (out?.outcome) {
    case 'queued':
      return `Adding ${name} to “${list.name}”. The veto checks again as it’s written: if you follow them, keep them, or have them on a curation list, they’re left off. “undo” takes it back.`;
    case 'kept':
      return `You keep ${name} by hand, so I won’t add them. Send “unkeep ${name}” first if you mean it.`;
    case 'already':
      return `${name} is on “${list.name}” already, or waiting to be.`;
    case 'self':
      return 'That’s you.';
    default:
      return 'That list isn’t kept any more. Choose another in Virga, under Defense › Lists.';
  }
}

async function removeReply({ d, store, cmd }) {
  const did = await d.names.resolve(cmd.actor);
  if (!did) return `I couldn’t find @${cmd.actor}.`;
  const name = atName(did, await d.names.handles([did]));
  const adds = await store.liveAdds(did);
  if (!adds.length) return `Virga hasn’t put ${name} on any of your lists. Anyone added another way is taken off in Bluesky.`;
  const out = await store.undo({ ids: adds.map((a) => Number(a.id)), note: cmd.raw.slice(0, 500), via: 'dm' });
  return (out?.cancelled || 0) && !(out?.queued || 0) ? `${name} wasn’t written yet, and won’t be.` : `Taking ${name} off, by the record their add wrote.`;
}

async function approveReply({ store, cmd, env }) {
  if (!defenseWritesEnabled(env)) return WRITES_OFF;
  const { plan, why } = await planFor(store, cmd.code);
  if (!plan) return why;
  if (cmd.actors.length) return `Approving by name isn’t here yet. Approve by band (“approve ${cmd.code} UNKNOWN”), or “block @someone” one at a time.`;
  if (cmd.kinds.length) return `Approving by engagement isn’t here yet. Approve by band, like “approve ${cmd.code} UNKNOWN”.`;
  const bands = cmd.bands.filter((b) => APPROVABLE_BANDS.includes(b));
  if (!bands.length) return `Which of them? Name a band, like “approve ${cmd.code} UNKNOWN”.`;
  const out = await store.approvePlan(plan.id, { bands, note: cmd.raw.slice(0, 500), via: 'dm' });
  if (!out) return `Plan ${cmd.code} can’t be approved: it has expired, or its list isn’t kept any more.`;
  const list = (await store.lists()).find((l) => l.id === plan.list_id);
  const parts = [out.queued ? `${fmtInt(out.queued)} queued for “${list?.name || 'the list'}”, ${estimateWords(out.queued)} at Virga’s pace` : 'Nobody new to add'];
  if (out.kept) parts.push(`${fmtInt(out.kept)} you keep by hand left off`);
  if (out.already) parts.push(`${fmtInt(out.already)} on it already`);
  return `Approved ${cmd.code}: ${parts.join('; ')}. “undo ${cmd.code}” takes it back.`;
}

async function reviewReply({ d, store, cmd }) {
  const { plan, why } = await planFor(store, cmd.code);
  if (!plan) return why;
  const rows = await store.planRows(plan.id);
  const by = {};
  for (const r of rows) by[r.band] = (by[r.band] || 0) + 1;
  const counts = APPROVABLE_BANDS.filter((b) => by[b]).map((b) => `${fmtInt(by[b])} ${BAND_COUNTED[b]}`);
  const near = rows.filter((r) => r.band === 'CONNECTED' || r.band === 'PERIPHERAL').slice(0, 10);
  const handles = await d.names.handles(near.map((r) => r.did));
  const lines = [
    `Plan ${cmd.code}, ${dateOf(plan.created_at)}: ${counts.join(', ') || 'nobody'}.`,
    plan.approved_at ? `Approved: ${(plan.approved_bands || []).map((b) => BAND_COUNTED[b] || b).join(', ')}.` : 'Not approved yet.',
  ];
  if (near.length) lines.push(`Near you: ${near.map((r) => atName(r.did, handles)).join(', ')}.`);
  return lines.join('\n');
}

async function cancelReply({ store, cmd }) {
  const { plan, why } = await planFor(store, cmd.code);
  if (!plan) return why;
  if (plan.approved_at) return `Plan ${cmd.code} is approved. “undo ${cmd.code}” takes back what it added.`;
  return (await store.cancelPlan(plan.id)) ? `Dropped plan ${cmd.code}. Nothing was added from it.` : `Plan ${cmd.code} is gone already.`;
}

/** The bands a scan's counts are said in, farthest first, and PROTECTED last. */
const SAID = ['UNKNOWN', 'NOTABLE', 'PERIPHERAL', 'CONNECTED'];

/**
 * A post, scanned, and stored as a plan for the owner to approve by its code.
 * Read-only until they do: nothing is added from a scan by DM without an
 * "approve".
 */
async function scanReply({ d, store, cmd, env, sender }) {
  const only = cmd.kind && cmd.kind !== 'everyone' ? KINDS[cmd.kind] : null;
  let summary;
  try {
    summary = await d.scan({ ownerDid: sender, input: cmd.target, only, kept: await store.keptMap() });
  } catch (err) {
    if (err instanceof DmScanError && err.code === 'TOO_BIG') {
      const web = publicUrl(env);
      return `${err.message} Scan it on the web, where there’s no time limit: ${web ? `${web}/defense` : 'Defense › Scan a post, in Virga'}`;
    }
    if (err instanceof DmScanError || err instanceof ScanError) return err.message;
    throw err;
  }
  const by = summary.totals.byBand || {};
  const said = SAID.filter((b) => by[b]).map((b) => `${fmtInt(by[b])} ${BAND_COUNTED[b]}`);
  if (by.PROTECTED) said.push(`${fmtInt(by.PROTECTED)} protected, never added`);
  const who = cmd.kind && cmd.kind !== 'everyone' ? cmd.kind : 'who engaged';
  const line = summary.totals.participants
    ? `Scanned ${fmtInt(summary.totals.participants)} ${who}: ${said.join(', ')}.${summary.truncated ? ' The post has more than one scan reads; this is the start of it.' : ''}`
    : `Nobody has engaged with that post${cmd.kind && cmd.kind !== 'everyone' ? ` as ${cmd.kind}` : ''} yet.`;
  if (!summary.totals.participants) return line;
  if (summary.vouchCheck !== 'canary') {
    return `${line} Bluesky didn’t say who you know in common with them, so nothing from this scan can be approved. Try again in a few minutes.`;
  }
  const rows = planRows(summary, APPROVABLE_BANDS).slice(0, PLAN_MAX);
  if (!rows.length) return `${line} Nobody to add: everyone is protected.`;
  const { list, why } = await dmList({ store, link: await store.link() });
  if (!list) return `${line} ${why}`;
  const planId = await store.createPlan({ listId: list.id, postUri: summary.post?.uri || null, rows, totals: { participants: summary.totals.participants, ...by } });
  if (!planId) return `${line} That list isn’t kept any more. Choose another in Virga, under Defense › Lists.`;
  const code = shortCode(planId);
  const strangers = rows.filter((r) => r.band === 'UNKNOWN').length;
  return [
    line,
    strangers
      ? `Plan ${code}, for “${list.name}”: “approve ${code} UNKNOWN” adds the ${fmtInt(strangers)} with no connection.`
      : `Plan ${code}, for “${list.name}”: nobody with no connection; name a band to add, like “approve ${code} NOTABLE”.`,
    `“review ${code}” names the ones near you; “cancel ${code}” drops it.`,
  ].join('\n');
}

async function newListReply({ d, store, cmd, env, sender }) {
  if (!defenseWritesEnabled(env)) return WRITES_OFF;
  const name = cmd.name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  try {
    const list = await d.createList({ ownerDid: sender, name, purpose: 'block' });
    const link = await store.link();
    if (!link?.list_id) await store.setLinkList(list.id);
    return `Made “${list.name}” in your repo. Open it in Bluesky and block it, so its members are blocked for you.${link?.list_id ? '' : ' “block @someone” adds to it from now on.'}`;
  } catch (err) {
    if (err instanceof ListError) return err.message;
    throw err;
  }
}
