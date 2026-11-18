// One pass of the moderator's DMs, on the droplet: read the chat log from
// where the last pass stopped, and answer each new message in a one-to-one
// conversation. main.js runs it every few seconds.
//
// Three rules hold it together:
//
//  1. Who sent a message is what the chat service says, and the droplet's
//     word for it isn't enough: Vercel reads every message back from the chat
//     service with its own key before it acts on one
//     (server/defense/moderator/verifier.js). The worker sends which message
//     (its conversation and id); what Vercel does is done as the sender it
//     read.
//  2. At most once. The cursor moves past each message before it is answered,
//     so a message that crashes its turn is dropped rather than answered again
//     and again; a pass that stops part-way leaves the rest for the next.
//  3. One-to-one conversations only. In a group, everyone reads the reply.
//
// A message is first Vercel's: linking, the one line for strangers, and the
// typed commands the grammar reads whole are answered there by code. What
// isn't goes to the agent (agent.js) when the worker has a model. A yes, a no
// or a thumbs-up to a question the agent asked runs, or drops, exactly what
// Vercel described, without the model, once Vercel has read the yes back.

import { answerTo, isDirect, sharedUri } from '../src/defense/dmMessage.js';
import { historyFrom, runTurn } from './agent.js';

export { isDirect, sharedUri };

/** Pages of the log one pass reads. */
export const MAX_PAGES = 10;
/** Pages a first pass reads looking for the end of the log. */
export const SEED_MAX_PAGES = 50;
/** A message older than this when read is not answered: the sender is told once. */
export const STALE_MS = 60 * 60_000;
/** The longest DM the chat service takes is 1,000 characters; replies are cut a little short of it. */
export const DM_CHUNK = 950;
/** How long one pass may run before it leaves the rest for the next. */
export const PASS_BUDGET_MS = 120_000;

const CREATE = 'chat.bsky.convo.defs#logCreateMessage';
const REACTION = 'chat.bsky.convo.defs#logAddReaction';

/** A reply cut into messages the chat service will take, at line ends or spaces where it can. */
export function chunkText(text, limit = DM_CHUNK) {
  const out = [];
  let rest = String(text || '').trim();
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n', limit);
    if (cut < limit / 2) cut = rest.lastIndexOf(' ', limit);
    if (cut < limit / 2) cut = limit;
    out.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * The parts of a message the worker passes on. Vercel reads the message back
 * and goes by what it read; these are used only where it has been told not to
 * (DEFENSE_MODERATOR_VERIFY=off, outside production).
 */
const forVirga = (m) => ({ text: typeof m?.text === 'string' ? m.text.slice(0, 3000) : '', facets: Array.isArray(m?.facets) ? m.facets.slice(0, 50) : [], embed: m?.embed ?? null });

/** Walk the log to its end and say where that was (null for an empty log). */
async function seekToTail(chat, { maxPages = SEED_MAX_PAGES } = {}) {
  let cursor = null;
  for (let i = 0; i < maxPages; i += 1) {
    const res = await chat.chat.bsky.convo.getLog(cursor ? { cursor } : {});
    const logs = res?.data?.logs || [];
    if (!logs.length || !res.data.cursor || res.data.cursor === cursor) break;
    cursor = res.data.cursor;
  }
  return cursor;
}

/**
 * One pass. Returns what it did: `{ answered, skipped, stale, seeded?, errors }`.
 *
 * @param {object} opts
 * @param {{ did: string, chat: object }} opts.moderator  openModerator()
 * @param {object} opts.state   fileState()
 * @param {object} opts.virga   virgaClient()
 * @param {object|null} opts.model  modelConfig(), or null for typed commands only
 * @param {object|null} [opts.atmosphere]  atmosphereTools(), for the agent to read the network with
 */
export async function runDmPass({ moderator, state, virga, model = null, atmosphere = null, fetchImpl, now = () => Date.now(), turn = runTurn }) {
  const { chat, did: botDid } = moderator;
  const started = now();
  const out = { answered: 0, skipped: 0, stale: 0, errors: [] };
  const saved = await state.read();

  // The first pass finds the end of the log and answers nothing: what was
  // sent before the moderator ran is history, not requests.
  if (!saved.seeded) {
    await state.setCursor(await seekToTail(chat));
    return { ...out, seeded: true };
  }

  let cursor = saved.cursor;
  const kinds = new Map(); // convoId -> direct?
  const staleSaid = new Set();
  const send = async (convoId, text) => {
    const ids = [];
    for (const chunk of chunkText(text)) {
      const res = await chat.chat.bsky.convo.sendMessage({ convoId, message: { text: chunk } });
      if (res?.data?.id) ids.push(res.data.id);
    }
    return ids;
  };
  const directOrNot = async (convoId) => {
    if (kinds.has(convoId)) return kinds.get(convoId);
    let direct = false;
    try {
      const res = await chat.chat.bsky.convo.getConvo({ convoId });
      direct = isDirect(res?.data?.convo);
    } catch (err) {
      // Unread conversations are left unanswered: waiting on one would hold
      // up everyone else's.
      out.errors.push(`couldn’t read a conversation: ${err?.message || err}`);
    }
    kinds.set(convoId, direct);
    return direct;
  };
  const history = async (convoId, ownerDid, beforeId) => {
    try {
      const res = await chat.chat.bsky.convo.getMessages({ convoId, limit: 30 });
      return historyFrom(res?.data?.messages || [], { ownerDid, botDid, beforeId, now: now() });
    } catch {
      return [];
    }
  };

  /**
   * A question the owner answered: run or drop it. True when this was that
   * answer. A yes is Vercel's to read back (`answer` names the message, or the
   * reaction on the question) before it runs what Vercel described.
   */
  async function answered(entry, sender, word, answer) {
    const pending = await state.pending(entry.convoId);
    if (!pending || pending.owner !== sender) return false;
    await state.setPending(entry.convoId, null);
    if (word === 'no') {
      await send(entry.convoId, 'Okay, nothing changed.');
      return true;
    }
    const out = await virga.call('confirm', {
      owner: sender,
      convoId: entry.convoId,
      name: pending.name,
      args: pending.args,
      answer,
      said: entry.message?.text || '👍',
      question: pending.question || pending.description,
    });
    const result = out?.result;
    if (out?.error || result?.error) await send(entry.convoId, `I couldn’t do that: ${out?.error || result.error}`);
    else if (result?.notDone) await send(entry.convoId, `I didn’t do that: ${result.why}`);
    else await send(entry.convoId, `Done: ${pending.description}`);
    return true;
  }

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const res = await chat.chat.bsky.convo.getLog(cursor ? { cursor } : {});
    const logs = (res?.data?.logs || []).filter((e) => !(cursor && e.rev === cursor));
    if (!logs.length) {
      if (res?.data?.cursor && res.data.cursor !== cursor) await state.setCursor(res.data.cursor);
      break;
    }
    for (const entry of logs) {
      if (now() - started > PASS_BUDGET_MS) return out;
      // Past this entry before it is answered (rule 2).
      await state.setCursor(entry.rev);
      cursor = entry.rev;

      // A thumbs-up or down from the owner on the question itself.
      if (entry.$type === REACTION) {
        const by = entry.reaction?.sender?.did;
        const pending = by && by !== botDid ? await state.pending(entry.convoId) : null;
        if (pending && pending.messageIds?.includes(entry.message?.id)) {
          const word = answerTo(entry.reaction?.value);
          if (word) await answered(entry, by, word, { reaction: { messageId: entry.message.id, value: entry.reaction?.value } }).catch((err) => out.errors.push(String(err?.message || err)));
        }
        continue;
      }

      const message = entry.message;
      const sender = message?.sender?.did;
      if (entry.$type !== CREATE || !sender || sender === botDid || typeof message?.text !== 'string') continue;
      if (!(await directOrNot(entry.convoId))) {
        out.skipped += 1;
        continue;
      }
      const sentAt = Date.parse(message.sentAt || '');
      if (Number.isFinite(sentAt) && now() - sentAt > STALE_MS) {
        out.stale += 1;
        if (!staleSaid.has(entry.convoId)) {
          staleSaid.add(entry.convoId);
          await send(entry.convoId, 'I was away, and didn’t answer messages sent more than an hour ago. Send again any that still matter.').catch(() => {});
        }
        continue;
      }
      try {
        const word = answerTo(message.text);
        if (word && (await answered(entry, sender, word, { messageId: message.id }))) {
          out.answered += 1;
          continue;
        }
        // Anything else supersedes a question still waiting.
        if (await state.pending(entry.convoId)) await state.setPending(entry.convoId, null);

        const first = await virga.call('message', {
          owner: sender,
          convoId: entry.convoId,
          messageId: message.id,
          agent: Boolean(model),
          message: forVirga(message),
          sharedUri: sharedUri(message),
        });
        if (first?.reply) await send(entry.convoId, first.reply);
        else if (first?.agent && first.turnId && model) {
          const t = await turn({
            config: model,
            virga,
            owner: sender,
            turnId: first.turnId,
            message,
            history: await history(entry.convoId, sender, message.id),
            atmosphere: atmosphere ? await atmosphere.get() : null,
            fetchImpl,
            now,
          });
          const ids = await send(entry.convoId, t.reply);
          if (t.pending) await state.setPending(entry.convoId, { ...t.pending, question: t.reply, owner: sender, messageIds: ids });
        }
        out.answered += 1;
      } catch (err) {
        out.errors.push(String(err?.message || err).slice(0, 200));
        await send(entry.convoId, 'Something went wrong on my side, and nothing was changed. Try again in a minute.').catch(() => {});
      }
    }
    if (res?.data?.cursor && res.data.cursor !== cursor) {
      await state.setCursor(res.data.cursor);
      cursor = res.data.cursor;
    }
  }
  return out;
}
