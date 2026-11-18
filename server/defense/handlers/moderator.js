// POST /api/defense/moderator: the worker's calls for the moderator. The
// worker on the droplet reads the moderator account's DMs and runs its agent;
// everything that reads or changes an owner's rows is done here, as the
// owner, through the store (docs/DEFENSE.md, "Phase 4, as built").
//
// Signed with DEFENSE_WORKER_SECRET over the method, the path and the exact
// body (../workerAuth.js), and sent as application/octet-stream so those bytes
// arrive as they were signed. `owner` is the DID the chat service said sent
// the message; nothing else in a body says who anyone is.
//
//   { op: 'message', owner, message, sharedUri, agent }  what to do with a DM:
//                                                       { reply } or { agent: true }
//   { op: 'turn', owner }                               count an agent turn: { ok, used, limit }
//   { op: 'describe', owner, name, args }               what a write would do, for the write check
//   { op: 'tool', owner, name, args, said }             run one of the agent's tools
//
// Every op but 'message' is for a linked owner only.

import { methodGuard, readRaw, sendJson } from '../../http.js';
import { isSupabaseConfigured } from '../../supabase.js';
import { answerMessage } from '../moderator/answer.js';
import { OP_NAMES, OpError, WRITE_OPS, opsFor } from '../moderator/ops.js';
import { storeFor } from '../store.js';
import { didOrNull, sendFailure } from '../respond.js';
import { isWorkerAuthorized } from '../workerAuth.js';

const MAX_BODY = 64 * 1024;
export const DEFAULT_AGENT_MONTHLY_LIMIT = 300;

/** The agent turns an owner gets a month: DEFENSE_AGENT_MONTHLY_LIMIT, null for unlimited. */
export function agentMonthlyLimit(env = process.env) {
  const raw = String(env?.DEFENSE_AGENT_MONTHLY_LIMIT ?? '').trim().toLowerCase();
  if (raw === 'unlimited' || raw === 'none') return null;
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= 0 ? n : DEFAULT_AGENT_MONTHLY_LIMIT;
}

export default async function handler(req, res, { deps = {}, env = process.env } = {}) {
  if (!methodGuard(req, res, ['POST'])) return;
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

  try {
    if (body.op === 'message') {
      const out = await answerMessage({
        sender: owner,
        message: body.message && typeof body.message === 'object' ? body.message : {},
        sharedUri: typeof body.sharedUri === 'string' ? body.sharedUri : null,
        agent: body.agent === true,
        env,
        deps: deps.answer,
      });
      return sendJson(res, 200, { success: true, data: out });
    }

    // From here, only for an owner who linked the moderator.
    if (!(await store.link())?.linked_at) return sendJson(res, 403, { success: false, code: 'NOT_LINKED', error: 'Not linked' });

    if (body.op === 'turn') {
      const limit = agentMonthlyLimit(env);
      const used = await store.agentTurn(limit);
      return sendJson(res, 200, { success: true, data: { ok: used != null, used, limit } });
    }

    const name = typeof body.name === 'string' ? body.name : '';
    const args = body.args && typeof body.args === 'object' && !Array.isArray(body.args) ? body.args : {};
    if (!OP_NAMES.includes(name)) return sendJson(res, 400, { success: false, code: 'INVALID', error: `No tool ${name.slice(0, 40)}` });
    const { ops, describe } = opsFor(owner, { ...deps.ops, env });

    if (body.op === 'describe') {
      if (!WRITE_OPS.has(name)) return sendJson(res, 400, { success: false, code: 'INVALID', error: `${name} isn’t a write` });
      return sendJson(res, 200, { success: true, data: await describe(name, args) });
    }
    if (body.op === 'tool') {
      const said = typeof body.said === 'string' ? body.said.slice(0, 2000) : '';
      return sendJson(res, 200, { success: true, data: { result: await ops[name]({ ...args, said }) } });
    }
    return sendJson(res, 400, { success: false, code: 'INVALID', error: 'No such op' });
  } catch (error) {
    // A refusal is the tool's answer, for the agent to word.
    if (error instanceof OpError) return sendJson(res, 200, { success: true, data: { error: error.message, code: error.code } });
    return sendFailure(res, 'defense/moderator', error, 'The moderator’s call failed.');
  }
}
