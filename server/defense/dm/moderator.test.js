// The moderator's session: kept sealed between passes, resumed when it can
// be, signed in afresh when it can't, and never kept in the clear in
// production.

import { describe, expect, it, vi } from 'vitest';
import { CHAT_PROXY, ModeratorError, moderatorConfigured, openModerator, readSaved, sealSession } from './moderator.js';

const KEY = 'a'.repeat(64);
const ENV = { DEFENSE_MODERATOR_HANDLE: 'mod.virga.example', DEFENSE_MODERATOR_PASSWORD: 'app-pass', SESSION_ENCRYPTION_KEY: KEY };
const SESSION = { did: 'did:plc:moderator', handle: 'mod.virga.example', accessJwt: 'a', refreshJwt: 'r', active: true };

/** An AtpAgent stand-in: resume and login, and the persistSession callback it was made with. */
function fakeAgent({ resumeFails = false, loginFails = false } = {}) {
  const made = [];
  class Agent {
    constructor({ service, persistSession }) {
      this.service = service;
      this.persist = persistSession;
      this.session = null;
      made.push(this);
    }
    async resumeSession(s) {
      if (resumeFails) throw new Error('expired');
      this.session = s;
      this.persist('update', { ...s, accessJwt: 'a2' });
    }
    async login({ identifier, password }) {
      if (loginFails) throw new Error('Invalid identifier or password');
      this.login.called = { identifier, password };
      this.session = SESSION;
      this.persist('create', SESSION);
    }
    withProxy(type, did) {
      return { proxied: `${did}#${type}`, agent: this };
    }
  }
  return { Agent, made };
}

describe('the moderator’s session', () => {
  it('needs an account and its app password', () => {
    expect(moderatorConfigured({})).toBe(false);
    expect(moderatorConfigured(ENV)).toBe(true);
  });

  it('is sealed when kept, and read back only with the key', () => {
    const text = sealSession(SESSION, ENV);
    expect(text).not.toContain('refreshJwt');
    expect(readSaved(text, ENV)).toEqual(SESSION);
    expect(readSaved(text, { ...ENV, SESSION_ENCRYPTION_KEY: 'b'.repeat(64) })).toBeNull();
    expect(readSaved('not json', ENV)).toBeNull();
    expect(readSaved(null, ENV)).toBeNull();
  });

  it('resumes a kept session and keeps what it refreshed', async () => {
    const { Agent } = fakeAgent();
    const save = vi.fn(async () => {});
    const mod = await openModerator({ env: ENV, saved: sealSession(SESSION, ENV), save, Agent });
    expect(mod.did).toBe(SESSION.did);
    expect(mod.chat.proxied).toBe(`${CHAT_PROXY}#bsky_chat`);
    expect(save).toHaveBeenCalledTimes(1);
    expect(readSaved(save.mock.calls[0][0], ENV)).toMatchObject({ accessJwt: 'a2' });
  });

  it('signs in afresh when there is nothing to resume, or it won’t resume', async () => {
    for (const [saved, opts] of [
      [null, {}],
      [sealSession(SESSION, ENV), { resumeFails: true }],
    ]) {
      const { Agent } = fakeAgent(opts);
      const save = vi.fn(async () => {});
      const mod = await openModerator({ env: ENV, saved, save, Agent });
      expect(mod.did).toBe(SESSION.did);
      expect(save).toHaveBeenCalled();
    }
  });

  it('says why it couldn’t sign in, and won’t keep tokens in the clear in production', async () => {
    const { Agent } = fakeAgent({ loginFails: true });
    await expect(openModerator({ env: ENV, Agent })).rejects.toMatchObject({ code: 'SIGN_IN' });
    await expect(openModerator({ env: {}, Agent })).rejects.toBeInstanceOf(ModeratorError);
    const prod = { ...ENV, SESSION_ENCRYPTION_KEY: '', VERCEL_ENV: 'production' };
    await expect(openModerator({ env: prod, Agent: fakeAgent().Agent })).rejects.toMatchObject({ code: 'NO_KEY' });
  });
});
