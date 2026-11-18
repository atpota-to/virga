// POST /api/defense/moderator: the worker's calls for the moderator. The
// worker on the droplet reads the moderator account's DMs and runs its agent;
// everything that reads or changes an owner's rows is done here, as the
// owner, through the store (docs/DEFENSE.md, "Phase 4, as built").
//
// Two keys, so the droplet alone is not enough (docs/DEFENSE-THREATS.md,
// rule 16):
//
//  1. The call is signed with DEFENSE_WORKER_SECRET over the method, the path
//     and the exact body (../workerAuth.js), sent as application/octet-stream
//     so those bytes arrive as signed. That says the worker sent it.
//  2. What the worker says an owner sent is read back from Bluesky's chat
//     service with Vercel's own key to the moderator account
//     (../moderator/verifier.js), and only what was read back is acted on.
//     The agent's tool calls carry a turn: a message read back, good for ten
//     minutes and a few writes. Every write the agent asks for goes past the
//     write check here (../moderator/check.js), with Vercel's own model call,
//     over the owner's words as read back.
//
//   { op: 'message', owner, convoId, messageId, agent }      what to do with a DM:
//                                                           { reply } or { agent: true, turnId }
//   { op: 'describe', owner, turnId, name, args }            what a write would do
//   { op: 'tool', owner, turnId, name, args }                one of the agent's tools
//   { op: 'confirm', owner, convoId, name, args, answer }    a yes to a question:
//                                                           answer { messageId } or { reaction: { messageId, value } }
//
// `owner` is the DID the worker says the chat service gave; it is believed
// only as far as the message read back bears it out.

import { methodGuard, readRaw, sendJson } from '../../http.js';
import { isSupabaseConfigured } from '../../supabase.js';
import { answerTo, composeMessage, sharedUri } from '../../../src/defense/dmMessage.js';
import { answerMessage } from '../moderator/answer.js';
import { checkIntent, sourcesLine } from '../moderator/check.js';
import { OP_NAMES, OpError, WRITE_OPS, opsFor } from '../moderator/ops.js';
import { VerifyError, openVerifier, verifierOver, verifyOff } from '../moderator/verifier.js';
import { storeFor } from '../store.js';
import { didOrNull, moderatorEnabled, sendFailure } from '../respond.js';
import { isWorkerAuthorized } from '../workerAuth.js';

const MAX_BODY = 64 * 1024;
export const DEFAULT_AGENT_MONTHLY_LIMIT = 300;
/** How long a turn's tool calls may come after its message, and how many writes it may make. */
export const TURN_MINUTES = 10;
export const MAX_WRITES_PER_MESSAGE = 6;
/** How long a yes may come after the question it answers. */
const CONFIRM_MAX_AGE_MS = 30 * 60_000;
/** Writes that only ever add fewer people: no check. */
const UNCHECKED = new Set(['keep']);

/** The agent turns an owner gets a month: DEFENSE_AGENT_MONTHLY_LIMIT, null for unlimited. */
export function agentMonthlyLimit(env = process.env) {
  const raw = String(env?.DEFENSE_AGENT_MONTHLY_LIMIT ?? '').trim().toLowerCase();
  if (raw === 'unlimited' || raw === 'none') return null;
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= 0 ? n : DEFAULT_AGENT_MONTHLY_LIMIT;
}

/** The reply when the allowance is spent. */
function allowanceReply(limit) {
  if (limit === 0) return 'Answering in sentences is off on this server. Typed commands still work: send “help”.';
  return `You’ve used this month’s ${Number.isInteger(limit) ? `${limit} ` : ''}replies from me in sentences. Typed commands still work, and cost nothing: send “help”.`;
}

const str = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');

export default async function handler(req, res, { deps = {}, env = process.env } = {}) {
  if (!methodGuard(req, res, ['POST'])) return;
  // Off for the first release (DEFENSE_MODERATOR=on turns it on): nothing a
  // worker sends is read.
  if (!moderatorEnabled(env)) return sendJson(res, 503, { success: false, code: 'MODERATOR_OFF', error: 'Defense’s moderator isn’t turned on on Virga’s server.' });
  let raw;
  try {
    raw = await readRaw(req, { maxBytes: MAX_BODY });
  } catch {
    return sendJson(res, 413, { success: false, error: 'Too large' });
  }
  if (!isWorkerAuthorized(req, env, Date.now(), { body: raw })) return sendJson(res, 401, { success: false, error: 'Unauthorized' });
  if (!isSupabaseConfigured()) return sendJson(res, 503, { success: false, code: 'UNAVAILABLE', error: 'Defense isn’t set up on Virga’s server yet.' });
  let body;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    return sendJson(res, 400, { success: false, code: 'INVALID', error: 'Not JSON' });
  }
  const owner = didOrNull(body?.owner);
  if (!owner) return sendJson(res, 400, { success: false, code: 'INVALID', error: 'No sender' });
  const store = (deps.storeFor || storeFor)(owner);
  const trusting = verifyOff(env);

  // Vercel's own read of the moderator's DMs, opened once a call and only when needed.
  let verifier = null;
  const readBack = async () => {
    verifier ??= deps.verifier || verifierOver(await openVerifier({ env }));
    return verifier;
  };
  const check = (input) => checkIntent(input, { env, owner, ...(deps.chat ? { chat: deps.chat } : {}) });

  try {
    if (body.op === 'message') {
      const convoId = str(body.convoId);
      const messageId = str(body.messageId);
      let message;
      if (trusting) message = body.message && typeof body.message === 'object' ? body.message : {};
      else message = (await (await readBack()).message({ convoId, messageId, owner })).message;
      const out = await answerMessage({ sender: owner, message, sharedUri: sharedUri(message), agent: body.agent === true, env, deps: deps.answer });
      if (!out.agent) return sendJson(res, 200, { success: true, data: { reply: out.reply ?? null } });
      const limit = agentMonthlyLimit(env);
      const turnId = await store.openTurn({ convoId, messageId, limit });
      if (!turnId) return sendJson(res, 200, { success: true, data: { reply: allowanceReply(limit) } });
      return sendJson(res, 200, { success: true, data: { agent: true, turnId } });
    }

    // From here, only for an owner who linked the moderator.
    if (!(await store.link())?.linked_at) return sendJson(res, 403, { success: false, code: 'NOT_LINKED', error: 'Not linked' });
    const name = typeof body.name === 'string' ? body.name : '';
    const args = body.args && typeof body.args === 'object' && !Array.isArray(body.args) ? body.args : {};
    if (!OP_NAMES.includes(name)) return sendJson(res, 400, { success: false, code: 'INVALID', error: `No tool ${name.slice(0, 40)}` });
    const { ops, describe } = opsFor(owner, { ...deps.ops, env });

    /** A checked write: the change described by code, judged against the owner's words as read back, then run. */
    async function checkedWrite({ said, earlier, ownerEarlier, shared, note }) {
      if (!UNCHECKED.has(name)) {
        const described = await describe(name, args);
        const verdict = await check({ said, earlier, action: `${described.text}${sourcesLine(described.accounts, { said, ownerEarlier, sharedUri: shared })}` });
        if (!verdict.allow) return { notDone: true, why: `The write check refused it: ${verdict.why}` };
      }
      return ops[name]({ ...args, said: note });
    }

    if (body.op === 'describe' || body.op === 'tool') {
      const turn = await store.turn(str(body.turnId, 64));
      const fresh = turn && Date.now() - Date.parse(turn.created_at) <= TURN_MINUTES * 60_000;
      if (!fresh) return sendJson(res, 200, { success: true, data: { error: 'That message is too old to act on now. Ask again.', code: 'STALE' } });
      if (body.op === 'describe') {
        if (!WRITE_OPS.has(name)) return sendJson(res, 400, { success: false, code: 'INVALID', error: `${name} isn’t a write` });
        return sendJson(res, 200, { success: true, data: await describe(name, args) });
      }
      if (!WRITE_OPS.has(name)) return sendJson(res, 200, { success: true, data: { result: await ops[name](args) } });
      if (!(await store.turnWrite(turn.id, { minutes: TURN_MINUTES, max: MAX_WRITES_PER_MESSAGE }))) {
        return sendJson(res, 200, { success: true, data: { result: { notDone: true, why: `One message makes at most ${MAX_WRITES_PER_MESSAGE} changes. Say what was done, and ask the owner before more.` } } });
      }
      let said;
      let earlier = '';
      let ownerEarlier = '';
      let shared = null;
      let note;
      if (trusting) {
        said = str(body.said, 2000);
        note = said;
      } else {
        const read = await (await readBack()).message({ convoId: turn.convo_id, messageId: turn.message_id, owner, maxAgeMs: TURN_MINUTES * 60_000 + 60 * 60_000 });
        said = composeMessage(read.message);
        ({ earlier, ownerEarlier } = read);
        shared = sharedUri(read.message);
        note = read.message.text || '';
      }
      return sendJson(res, 200, { success: true, data: { result: await checkedWrite({ said, earlier, ownerEarlier, shared, note }) } });
    }

    if (body.op === 'confirm') {
      if (!WRITE_OPS.has(name)) return sendJson(res, 400, { success: false, code: 'INVALID', error: `${name} isn’t a write` });
      const convoId = str(body.convoId);
      const answer = body.answer && typeof body.answer === 'object' ? body.answer : {};
      let said;
      let earlier;
      let ref;
      if (trusting) {
        said = str(body.said, 200) || 'yes';
        earlier = str(body.question, 2000);
        ref = str(answer.messageId) || `react:${str(answer.reaction?.messageId)}`;
      } else if (answer.reaction) {
        const r = await (await readBack()).reaction({ convoId, messageId: str(answer.reaction.messageId), owner, values: ['👍'] });
        said = '👍 (a thumbs-up on the moderator’s question)';
        earlier = r.question;
        ref = `react:${str(answer.reaction.messageId)}`;
      } else {
        const read = await (await readBack()).message({ convoId, messageId: str(answer.messageId), owner, maxAgeMs: CONFIRM_MAX_AGE_MS });
        if (answerTo(read.message.text) !== 'yes') return sendJson(res, 200, { success: true, data: { result: { notDone: true, why: 'That wasn’t a yes.' } } });
        said = read.message.text;
        earlier = read.earlier;
        ref = str(answer.messageId);
      }
      const turnId = await store.openTurn({ convoId, messageId: ref, count: false });
      if (!turnId || !(await store.turnWrite(turnId, { minutes: TURN_MINUTES, max: 1 }))) {
        return sendJson(res, 200, { success: true, data: { result: { notDone: true, why: 'That yes has been used.' } } });
      }
      return sendJson(res, 200, { success: true, data: { result: await checkedWrite({ said, earlier, ownerEarlier: '', shared: null, note: `${said} (to: ${earlier.slice(0, 300)})` }) } });
    }

    return sendJson(res, 400, { success: false, code: 'INVALID', error: 'No such op' });
  } catch (error) {
    // A message that doesn't read back is refused, and says why to the worker only.
    if (error instanceof VerifyError) return sendJson(res, error.code === 'NO_VERIFIER' ? 503 : 403, { success: false, code: error.code, error: error.message });
    // A refusal is the tool's answer, for the agent to word.
    if (error instanceof OpError) return sendJson(res, 200, { success: true, data: { error: error.message, code: error.code } });
    return sendFailure(res, 'defense/moderator', error, 'The moderator’s call failed.');
  }
}
