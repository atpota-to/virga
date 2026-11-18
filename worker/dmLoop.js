// One pass of the moderator's DMs, on the droplet: read the chat log from
// where the last pass stopped, and answer each new message in a one-to-one
// conversation. main.js runs it every few seconds.
//
// Three rules hold it together:
//
//  1. Who sent a message is what the chat service says, and nothing else.
//     That DID goes to Vercel with the message; everything done for it is
//     done there, as them (server/defense/handlers/moderator.js).
//  2. At most once. The cursor moves past each message before it is answered,
//     so a message that crashes its turn is dropped rather than answered again
//     and again; a pass that stops part-way leaves the rest for the next.
//  3. One-to-one conversations only. In a group, everyone reads the reply.
//
// A message is first Vercel's: linking, the one line for strangers, and the
// typed commands the grammar reads whole are answered there by code. What
// isn't goes to the agent (agent.js) when the worker has a model. A yes, a no
// or a thumbs-up to a question the agent asked runs, or drops, exactly what
// it described, without the model.

import { answerTo, historyFrom, runPending, runTurn } from './agent.js';

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
const DIRECT = 'chat.bsky.convo.defs#directConvo';

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

/** The record a message shares (a post, or anything else), as an at:// URI, or null. */
export function sharedUri(message) {
  const uri = message?.embed?.record?.uri ?? message?.embed?.record?.record?.uri;
  return typeof uri === 'string' && uri.startsWith('at://') ? uri : null;
}

/** Whether a conversation is one to one, by its kind or, failing that, its members. */
export function isDirect(convo) {
  const kind = convo?.kind?.$type;
  if (kind) return kind === DIRECT;
  return Array.isArray(convo?.members) && convo.members.length === 2;
}

/** The parts of a message Vercel reads: its text, facets and what it shares. */
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
 */
export async function runDmPass({ moderator, state, virga, model = null, fetchImpl, now = () => Date.now(), turn = runTurn }) {
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

  /** A question the owner answered: run or drop it. True when the message was that answer. */
  async function answered(entry, sender, word) {
    const pending = await state.pending(entry.convoId);
    if (!pending || pending.owner !== sender) return false;
    await state.setPending(entry.convoId, null);
    if (word === 'no') await send(entry.convoId, 'Okay, nothing changed.');
    else await send(entry.convoId, await runPending(pending, { virga, owner: sender, said: entry.message?.text || 'yes' }));
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
          if (word) await answered(entry, by, word).catch((err) => out.errors.push(String(err?.message || err)));
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
        if (word && (await answered(entry, sender, word))) {
          out.answered += 1;
          continue;
        }
        // Anything else supersedes a question still waiting.
        if (await state.pending(entry.convoId)) await state.setPending(entry.convoId, null);

        const shared = sharedUri(message);
        const first = await virga.call('message', { owner: sender, message: forVirga(message), sharedUri: shared, agent: Boolean(model) });
        if (first?.reply) await send(entry.convoId, first.reply);
        else if (first?.agent && model) {
          const t = await turn({ config: model, virga, owner: sender, message, sharedUri: shared, history: await history(entry.convoId, sender, message.id), fetchImpl, now });
          const ids = await send(entry.convoId, t.reply);
          if (t.pending) await state.setPending(entry.convoId, { ...t.pending, owner: sender, messageIds: ids });
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
