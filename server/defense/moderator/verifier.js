// Vercel's own read of the moderator's DMs: the second key.
//
// The worker on the droplet holds the moderator account and says, for each
// DM, who sent it. Taken alone, that claim is all a stolen droplet would need
// to act as any linked owner. So Vercel doesn't take it: it signs in to the
// same account with an app password of its own
// (DEFENSE_MODERATOR_VERIFY_PASSWORD), which the droplet never holds, and
// reads each message back from Bluesky's chat service before acting on it:
// in a one-to-one conversation between the owner and the moderator, sent by
// the owner, within the hour. What Vercel acts on is the text it read, not
// the text the worker sent. Nobody but the owner can put a message in that
// conversation under the owner's name, so a droplet on its own can't either
// (docs/DEFENSE-THREATS.md, rule 16).
//
// Outside production, DEFENSE_MODERATOR_VERIFY=off trusts the worker instead,
// for running the worker locally without a second password. Production
// refuses to.

import { AtpAgent } from '@atproto/api';
import { isProduction } from '../../env.js';
import { decryptSession, encryptSession, sessionEncryptionEnabled } from '../../oauth/sessionCrypto.js';
import { getSupabaseClient } from '../../supabase.js';
import { isDirect } from '../../../src/defense/dmMessage.js';
import { StoreUnavailable } from '../store.js';

export const CHAT_PROXY = 'did:web:api.bsky.chat';
/** How old a message may be and still be acted on. */
export const MESSAGE_MAX_AGE_MS = 60 * 60_000;
/** How far back the conversation is read for what came before a message. */
export const CONTEXT_MS = 30 * 60_000;
const PAGE = 50;

export class VerifyError extends Error {
  constructor(message, code = 'UNVERIFIED') {
    super(message);
    this.name = 'VerifyError';
    this.code = code;
  }
}

/** Whether Vercel has its own key to the moderator's DMs. */
export const verifierConfigured = (env = process.env) => Boolean(env?.DEFENSE_MODERATOR_HANDLE && env?.DEFENSE_MODERATOR_VERIFY_PASSWORD);

/** Whether the worker's word is taken without reading back: only outside production, and only when asked for. */
export const verifyOff = (env = process.env) => env?.DEFENSE_MODERATOR_VERIFY === 'off' && !isProduction(env);

function sessionTable(client) {
  const db = () => {
    const c = client ?? getSupabaseClient();
    if (!c) throw new StoreUnavailable();
    return c;
  };
  return {
    async read(env) {
      const { data, error } = await db().from('defense_verifier').select('session').eq('id', 1).maybeSingle();
      if (error || !data?.session) return null;
      try {
        const s = decryptSession(JSON.parse(data.session), env);
        return s?.did && s?.refreshJwt ? s : null;
      } catch {
        return null;
      }
    },
    async save(session, env) {
      const sealed = JSON.stringify(encryptSession(session, env));
      await db().from('defense_verifier').upsert([{ id: 1, session: sealed, updated_at: new Date().toISOString() }], { onConflict: 'id' });
    },
  };
}

/**
 * Vercel's session for the moderator: `{ did, chat }`. Kept sealed in
 * defense_verifier between calls, resumed when it can be, signed in afresh
 * when it can't. Two calls refreshing at once is survivable: the PDS keeps a
 * refreshed token usable for a grace period.
 */
export async function openVerifier({ env = process.env, Agent = AtpAgent, client = null } = {}) {
  if (!verifierConfigured(env)) throw new VerifyError('Vercel has no key of its own to the moderator’s DMs (DEFENSE_MODERATOR_VERIFY_PASSWORD).', 'NO_VERIFIER');
  if (isProduction(env) && !sessionEncryptionEnabled(env)) throw new VerifyError('SESSION_ENCRYPTION_KEY is needed before Vercel can keep the moderator’s session.', 'NO_VERIFIER');
  const table = sessionTable(client);
  const saves = [];
  const agent = new Agent({
    service: env.DEFENSE_MODERATOR_SERVICE || 'https://bsky.social',
    persistSession: (event, session) => {
      if (session && (event === 'create' || event === 'update')) saves.push(table.save(session, env).catch(() => {}));
    },
  });
  const old = await table.read(env).catch(() => null);
  let ok = false;
  if (old) {
    try {
      await agent.resumeSession(old);
      ok = Boolean(agent.session?.did);
    } catch {
      ok = false;
    }
  }
  if (!ok) {
    try {
      await agent.login({ identifier: env.DEFENSE_MODERATOR_HANDLE, password: env.DEFENSE_MODERATOR_VERIFY_PASSWORD });
    } catch (err) {
      throw new VerifyError(`Vercel couldn’t sign in to the moderator account to read its DMs: ${err?.message || err}`, 'NO_VERIFIER');
    }
  }
  await Promise.all(saves);
  if (!agent.session?.did) throw new VerifyError('Vercel signed in to the moderator account without an account.', 'NO_VERIFIER');
  return { did: agent.session.did, chat: agent.withProxy('bsky_chat', CHAT_PROXY) };
}

/**
 * Reading back, over a chat client signed in as the moderator (`did`).
 * `now` for tests.
 */
export function verifierOver({ did: moderatorDid, chat }, { now = () => Date.now() } = {}) {
  const convos = new Map();
  async function directWith(convoId, owner) {
    if (!convos.has(convoId)) {
      const res = await chat.chat.bsky.convo.getConvo({ convoId }).catch(() => null);
      convos.set(convoId, res?.data?.convo || null);
    }
    const convo = convos.get(convoId);
    const members = new Set((convo?.members || []).map((m) => m?.did));
    if (!convo || !isDirect(convo) || members.size !== 2 || !members.has(owner) || !members.has(moderatorDid)) {
      throw new VerifyError('That isn’t a one-to-one conversation between this owner and the moderator.');
    }
  }
  async function page(convoId) {
    const res = await chat.chat.bsky.convo.getMessages({ convoId, limit: PAGE });
    return (res?.data?.messages || []).filter((m) => m && typeof m.id === 'string');
  }

  return {
    moderatorDid,
    /**
     * A message, read back: `{ message, earlier, ownerEarlier }`, where
     * `earlier` is the moderator's last message before it and `ownerEarlier`
     * the owner's own messages in the half hour before it. Throws a
     * VerifyError when it isn't the owner's, in a one-to-one conversation
     * with the moderator, from within the hour.
     */
    async message({ convoId, messageId, owner, maxAgeMs = MESSAGE_MAX_AGE_MS }) {
      if (typeof convoId !== 'string' || typeof messageId !== 'string' || !convoId || !messageId) throw new VerifyError('Which message?');
      await directWith(convoId, owner);
      const messages = await page(convoId);
      const message = messages.find((m) => m.id === messageId);
      if (!message) throw new VerifyError('That message isn’t in the conversation.');
      if (message.sender?.did !== owner) throw new VerifyError('That message wasn’t sent by this owner.');
      const sentAt = Date.parse(message.sentAt || '');
      if (!Number.isFinite(sentAt) || now() - sentAt > maxAgeMs) throw new VerifyError('That message is too old to act on.');
      const before = messages.filter((m) => Date.parse(m.sentAt || '') < sentAt).sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt));
      const earlier = before.find((m) => m.sender?.did === moderatorDid)?.text || '';
      const ownerEarlier = before
        .filter((m) => m.sender?.did === owner && sentAt - Date.parse(m.sentAt) <= CONTEXT_MS && typeof m.text === 'string')
        .map((m) => m.text)
        .join('\n');
      return { message, earlier, ownerEarlier };
    },

    /**
     * A reaction of the owner's on one of the moderator's messages, read
     * back: `{ question }`, the text it reacted to, when the owner put one of
     * `values` on it. Throws a VerifyError otherwise.
     */
    async reaction({ convoId, messageId, owner, values }) {
      await directWith(convoId, owner);
      const message = (await page(convoId)).find((m) => m.id === messageId);
      if (!message || message.sender?.did !== moderatorDid) throw new VerifyError('That isn’t a message of the moderator’s.');
      const sentAt = Date.parse(message.sentAt || '');
      if (!Number.isFinite(sentAt) || now() - sentAt > MESSAGE_MAX_AGE_MS) throw new VerifyError('That question is too old to answer.');
      const reacted = (message.reactions || []).some((r) => r?.sender?.did === owner && values.includes(String(r.value || '').replace(/(?:[\u{1F3FB}-\u{1F3FF}]|\uFE0F)/gu, '')));
      if (!reacted) throw new VerifyError('The owner didn’t react to that question.');
      return { question: message.text || '' };
    },
  };
}
