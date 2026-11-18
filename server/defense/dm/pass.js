// One pass of the moderator's DMs, on Vercel: read the chat log from where the
// last pass stopped, answer each new message in a one-to-one conversation, and
// move on. Vercel Cron calls it every minute and the worker on the droplet
// more often, signed; either way it takes nothing from its caller
// (docs/DEFENSE-THREATS.md, rule 2).
//
// Three rules hold it together:
//
//  1. Who sent a message is what the chat service says, and nothing else.
//     A command acts for its sender, only if they linked the moderator, and
//     only on their own rows (storeFor(sender)).
//  2. At most once. The cursor moves past each message before it is answered,
//     so a message that crashes its turn is dropped rather than answered again
//     and again; a pass that stops part-way leaves the rest for the next.
//  3. One-to-one conversations only. In a group, everyone reads the reply.
//
// The lease (dm/state.js) keeps it to one pass at a time.

import { randomUUID } from 'node:crypto';
import { moderatorConfigured, openModerator } from './moderator.js';
import { dmState } from './state.js';
import { answerMessage } from './answer.js';

export const LEASE_SECONDS = 55;
export const DM_TIME_BUDGET_MS = 40_000;
/** Pages of the log one pass reads. */
export const MAX_PAGES = 10;
/** Pages a first pass reads looking for the end of the log. */
export const SEED_MAX_PAGES = 50;
/** A message older than this when read is not answered: the sender is told once. */
export const STALE_MS = 60 * 60_000;
/** The longest DM the chat service takes is 1,000 characters; replies are cut a little short of it. */
export const DM_CHUNK = 950;

const CREATE = 'chat.bsky.convo.defs#logCreateMessage';
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
 * One pass. Returns what it did: `{ ran, answered, skipped, seeded?, reason? }`.
 *
 * @param {object} [opts]
 * @param {object} [opts.deps]  stand-ins for tests: state, open, answer, holder
 */
export async function runDmPass({ env = process.env, now = () => Date.now(), deps = {} } = {}) {
  if (!moderatorConfigured(env)) return { ran: false, reason: 'unconfigured', answered: 0, skipped: 0 };
  const d = { state: dmState(), open: openModerator, answer: answerMessage, holder: randomUUID(), ...deps };
  const started = now();
  const out = { ran: true, answered: 0, skipped: 0, stale: 0, errors: [] };
  const leased = await d.state.lease(d.holder, LEASE_SECONDS);
  if (!leased) return { ran: false, reason: 'busy', answered: 0, skipped: 0 };

  try {
    const mod = await d.open({ env, saved: leased.session, save: (text, did) => d.state.saveSession(d.holder, text, did) });
    const { chat } = mod;

    // The first pass finds the end of the log and answers nothing: what was
    // sent before the moderator ran is history, not requests.
    if (!leased.seeded) {
      const tail = await seekToTail(chat);
      await d.state.advance(d.holder, tail);
      return { ...out, seeded: true };
    }

    let cursor = leased.log_cursor;
    const kinds = new Map(); // convoId -> direct?
    const staleSaid = new Set();
    const send = async (convoId, text) => {
      for (const chunk of chunkText(text)) await chat.chat.bsky.convo.sendMessage({ convoId, message: { text: chunk } });
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

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const res = await chat.chat.bsky.convo.getLog(cursor ? { cursor } : {});
      const logs = (res?.data?.logs || []).filter((e) => !(cursor && e.rev === cursor));
      if (!logs.length) {
        if (res?.data?.cursor && res.data.cursor !== cursor) await d.state.advance(d.holder, res.data.cursor);
        break;
      }
      for (const entry of logs) {
        if (now() - started > DM_TIME_BUDGET_MS) return out;
        const message = entry.message;
        const sender = message?.sender?.did;
        const isAsk = entry.$type === CREATE && sender && sender !== mod.did && typeof message?.text === 'string';
        // Past this entry before it is answered (rule 2). A lost lease stops the pass.
        if (!(await d.state.advance(d.holder, entry.rev))) return { ...out, reason: 'lease lost' };
        cursor = entry.rev;
        if (!isAsk) continue;
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
          const reply = await d.answer({ sender, message, sharedUri: sharedUri(message), env, now });
          if (reply) await send(entry.convoId, reply);
          out.answered += 1;
        } catch (err) {
          out.errors.push(String(err?.message || err).slice(0, 200));
          await send(entry.convoId, 'Something went wrong on my side, and nothing was changed. Try again in a minute.').catch(() => {});
        }
      }
      if (res?.data?.cursor && res.data.cursor !== cursor) {
        if (!(await d.state.advance(d.holder, res.data.cursor))) return { ...out, reason: 'lease lost' };
        cursor = res.data.cursor;
      }
    }
    return out;
  } finally {
    await d.state.release(d.holder).catch(() => {});
  }
}
