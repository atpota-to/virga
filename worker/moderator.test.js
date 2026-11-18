// The moderator's session: kept in the worker's state between passes,
// resumed when it can be, signed in afresh when it can't.

import { describe, expect, it, vi } from 'vitest';
import { CHAT_PROXY, ModeratorError, moderatorConfigured, moderatorWanted, openModerator } from './moderator.js';

const ENV = { DEFENSE_MODERATOR_HANDLE: 'mod.virga.example', DEFENSE_MODERATOR_PASSWORD: 'app-pass' };
const SESSION = { did: 'did:plc:moderator', handle: 'mod.virga.example', accessJwt: 'a', refreshJwt: 'r', active: true };

function memoryState(session = null) {
  let saved = session;
  return { read: async () => ({ session: saved }), setSession: vi.fn(async (s) => (saved = s)), get: () => saved };
}

function fakeAgent({ resumeFails = false, loginFails = false } = {}) {
  const logins = [];
  class Agent {
    constructor({ service, persistSession }) {
      this.service = service;
      this.persist = persistSession;
      this.session = null;
    }
    async resumeSession(s) {
      if (resumeFails) throw new Error('expired');
      this.session = s;
      this.persist('update', { ...s, accessJwt: 'a2' });
    }
    async login(creds) {
      if (loginFails) throw new Error('Invalid identifier or password');
      logins.push(creds);
      this.session = SESSION;
      this.persist('create', SESSION);
    }
    withProxy(type, did) {
      return { proxied: `${did}#${type}` };
    }
  }
  return { Agent, logins };
}

describe('the moderator’s session', () => {
  it('needs an account and its app password', () => {
    expect(moderatorConfigured({})).toBe(false);
    expect(moderatorConfigured(ENV)).toBe(true);
  });

  it('isn’t read unless the moderator is turned on, as for the first release', () => {
    expect(moderatorWanted(ENV)).toBe(false);
    expect(moderatorWanted({ ...ENV, DEFENSE_MODERATOR: 'on' })).toBe(true);
    expect(moderatorWanted({ DEFENSE_MODERATOR: 'on' })).toBe(false);
  });

  it('resumes a kept session, keeps what it refreshed, and talks to the chat service', async () => {
    const { Agent, logins } = fakeAgent();
    const state = memoryState(SESSION);
    const mod = await openModerator({ env: ENV, state, Agent });
    expect(mod).toMatchObject({ did: SESSION.did, handle: SESSION.handle });
    expect(mod.chat.proxied).toBe(`${CHAT_PROXY}#bsky_chat`);
    expect(logins).toEqual([]);
    expect(state.get()).toMatchObject({ accessJwt: 'a2' });
  });

  it('signs in afresh when there is nothing to resume, or it won’t resume', async () => {
    for (const [saved, opts] of [
      [null, {}],
      [SESSION, { resumeFails: true }],
    ]) {
      const { Agent, logins } = fakeAgent(opts);
      const state = memoryState(saved);
      expect((await openModerator({ env: ENV, state, Agent })).did).toBe(SESSION.did);
      expect(logins).toEqual([{ identifier: 'mod.virga.example', password: 'app-pass' }]);
      expect(state.get()).toEqual(SESSION);
    }
  });

  it('says why it couldn’t sign in', async () => {
    await expect(openModerator({ env: ENV, state: memoryState(), Agent: fakeAgent({ loginFails: true }).Agent })).rejects.toMatchObject({ code: 'SIGN_IN' });
    await expect(openModerator({ env: {}, state: memoryState(), Agent: fakeAgent().Agent })).rejects.toBeInstanceOf(ModeratorError);
  });
});
