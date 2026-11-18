// The moderator account, signed in: one Bluesky account, with an app password
// that may read and send DMs, held by the worker on the droplet and by
// nothing else (docs/DEFENSE.md, "Phase 4, as built").
//
// The session is kept in the worker's state file between passes and
// restarts, because signing in afresh every time would run into
// createSession's limits within the hour. The worker is the only process that
// uses it (state.js holds a lock), so one refresh token is never spent twice.

import { AtpAgent } from '@atproto/api';

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

/** A kept session, or null when it isn't one. */
const usable = (s) => (s && typeof s === 'object' && s.did && s.refreshJwt && s.accessJwt ? s : null);

/**
 * The moderator, signed in: `{ did, handle, chat }`, where `chat` is the
 * agent proxied to Bluesky's chat service. `state` keeps the session
 * (state.js); `Agent` is a stand-in for tests.
 */
export async function openModerator({ env = process.env, state, Agent = AtpAgent } = {}) {
  if (!moderatorConfigured(env)) throw new ModeratorError('The moderator account isn’t set up.', 'UNCONFIGURED');
  let pending = Promise.resolve();
  const agent = new Agent({
    service: env.DEFENSE_MODERATOR_SERVICE || 'https://bsky.social',
    persistSession: (event, session) => {
      if (!session || (event !== 'create' && event !== 'update')) return;
      pending = pending.then(() => state.setSession(session)).catch((err) => console.warn('[worker] couldn’t keep the moderator’s session:', err?.message || err));
    },
  });
  const old = usable((await state.read()).session);
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
  return { did, handle: agent.session?.handle || null, chat: agent.withProxy('bsky_chat', CHAT_PROXY), flush: () => pending };
}
