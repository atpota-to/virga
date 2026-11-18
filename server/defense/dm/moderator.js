// The moderator account's session: one Bluesky account, signed in with an app
// password that may read and send DMs, used by the DM pass on Vercel and by
// nothing else. The droplet never holds it (docs/DEFENSE.md, "Phase 4, as
// built").
//
// A session is kept between passes, sealed with SESSION_ENCRYPTION_KEY as
// users' sessions are, because signing in afresh every pass would run into
// createSession's limits in an hour. The pass that holds the lease is the only
// one that refreshes it, so two passes never spend one refresh token.

import { AtpAgent } from '@atproto/api';
import { isProduction } from '../../env.js';
import { decryptSession, encryptSession, sessionEncryptionEnabled } from '../../oauth/sessionCrypto.js';

export const CHAT_PROXY = 'did:web:api.bsky.chat';

/** Whether the moderator is configured: an account and its app password. */
export function moderatorConfigured(env = process.env) {
  return Boolean(env?.DEFENSE_MODERATOR_HANDLE && env?.DEFENSE_MODERATOR_PASSWORD);
}

export class ModeratorError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ModeratorError';
    this.code = code;
  }
}

/** A saved session, as defense_dm_state.session holds it, or null when it can't be read. */
export function readSaved(text, env = process.env) {
  if (!text) return null;
  try {
    const session = decryptSession(JSON.parse(text), env);
    return session?.did && session?.refreshJwt ? session : null;
  } catch {
    return null;
  }
}

/** A session sealed for defense_dm_state.session. */
export const sealSession = (session, env = process.env) => JSON.stringify(encryptSession(session, env));

/**
 * The moderator, signed in: `{ did, chat }`, where `chat` is the agent proxied
 * to Bluesky's chat service. `saved` is the stored session text; `save(text,
 * did)` keeps a new or refreshed one.
 */
export async function openModerator({ env = process.env, saved = null, save = async () => {}, Agent = AtpAgent } = {}) {
  if (!moderatorConfigured(env)) throw new ModeratorError('The moderator account isn’t set up.', 'UNCONFIGURED');
  if (isProduction(env) && !sessionEncryptionEnabled(env)) {
    // Its tokens would sit in the database as they are.
    throw new ModeratorError('SESSION_ENCRYPTION_KEY is needed before the moderator can keep its session.', 'NO_KEY');
  }
  let pending = Promise.resolve();
  const agent = new Agent({
    service: env.DEFENSE_MODERATOR_SERVICE || 'https://bsky.social',
    persistSession: (event, session) => {
      if (!session || (event !== 'create' && event !== 'update')) return;
      pending = pending.then(() => save(sealSession(session, env), session.did)).catch((err) => console.warn('[defense/dm] couldn’t keep the moderator’s session:', err?.message || err));
    },
  });
  const old = readSaved(saved, env);
  let resumed = false;
  if (old) {
    try {
      await agent.resumeSession(old);
      resumed = Boolean(agent.session?.did);
    } catch {
      resumed = false;
    }
  }
  if (!resumed) {
    try {
      await agent.login({ identifier: env.DEFENSE_MODERATOR_HANDLE, password: env.DEFENSE_MODERATOR_PASSWORD });
    } catch (err) {
      throw new ModeratorError(`The moderator couldn’t sign in: ${err?.message || err}`, 'SIGN_IN');
    }
  }
  await pending;
  const did = agent.session?.did;
  if (!did) throw new ModeratorError('The moderator signed in without an account.', 'SIGN_IN');
  return { did, chat: agent.withProxy('bsky_chat', CHAT_PROXY), flush: () => pending };
}
