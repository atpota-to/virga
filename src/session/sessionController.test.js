// The session layer's rules, with the world outside stood in for: one
// published account at a time ({ did, agent, session } in one update), a
// switch that leaves the old account up until the new one is ready, sign-out
// that falls to the next account, a long session that is only marked dead
// after the server has said so three times.

import { describe, expect, it, vi } from 'vitest';
import { Agent } from '@atproto/api';
import { OAUTH_SCOPE, POSTING_TOKENS } from '../config.js';
import { SESSION_HINT_KEY } from '../lib/sessionHint.js';
import {
  ACCOUNTS_KEY,
  ACTIVE_KEY,
  SESSION_EXPIRED_EVENT,
  backendTokenKey,
  readAccounts,
  recordSignIn,
  writeActiveDid,
  writeBackendToken,
} from './accounts.js';
import { NO_ACTIVE, capabilitiesFrom, createSessionController } from './sessionController.js';

const MIRA = 'did:plc:virgaharnessmira2zq4x';
const LAB = 'did:plc:virgaharnesslab7k2pq';
const THIRD = 'did:plc:virgaharnessthird2kq';
const TOKEN = `vg_${'ab'.repeat(32)}`;
const TOKEN2 = `vg_${'cd'.repeat(32)}`;
const COCOON = 'https://cocoon.example';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
    map,
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function oauthSession(did) {
  return {
    sub: did,
    did,
    fetchHandler: vi.fn(async () => json({})),
    signOut: vi.fn(async () => {}),
    getTokenInfo: vi.fn(async () => ({ scope: OAUTH_SCOPE })),
  };
}

function fakeBrowser({ sessions = {}, callback = null, legacy = null } = {}) {
  const dropped = [];
  return {
    sessions,
    finishCallback: vi.fn(async () => callback),
    legacySession: vi.fn(async () => legacy),
    restore: vi.fn(async (did) => {
      if (sessions[did]) return sessions[did];
      throw Object.assign(new Error('The session was deleted by another process'), { restoreFailure: 'expired' });
    }),
    signIn: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    grantedScope: vi.fn(async (s) => (s ? OAUTH_SCOPE : null)),
    onDeleted: vi.fn((fn) => dropped.push(fn)),
    drop(sub, info) {
      for (const fn of dropped) fn(sub, info);
    },
  };
}

/** A controller over a fake world. `answer(url, init)` is Virga's server. */
function setup({ storage = memoryStorage(), browser = fakeBrowser(), backendReturn = null, onCallbackPath = false, answer } = {}) {
  const state = { rows: [], statuses: {}, active: NO_ACTIVE, switching: null, error: null };
  const log = { active: [], switching: [], events: [] };
  const set = {
    rows: (v) => (state.rows = v),
    statuses: (v) => (state.statuses = v),
    active: (v) => {
      state.active = v;
      log.active.push(v.did);
    },
    switching: (v) => {
      state.switching = v;
      log.switching.push(v);
    },
    error: (v) => (state.error = v),
  };
  const fetch = vi.fn(async (url, init) => (answer ? answer(String(url), init) : json({ success: true })));
  const env = {
    storage,
    tabStorage: memoryStorage(),
    browser,
    backendUrl: COCOON,
    fetch,
    loadAgent: async () => Agent,
    backendReturn,
    onCallbackPath,
    authMode: 'browser',
    getProfile: vi.fn(async (did) => ({ did, handle: did === MIRA ? 'mira.example.com' : 'lab.example.org', displayName: 'Someone', avatar: 'https://cdn.example/a.jpg' })),
    resolvePdsUrl: vi.fn(async () => 'https://pds.example'),
    rememberPdsUrl: vi.fn(),
    resetAnalyticsStore: vi.fn(),
    deleteDatabase: vi.fn(async () => true),
    dispatch: (name, detail) => log.events.push([name, detail]),
    origin: () => 'https://virga.example',
    assign: vi.fn(),
    sleep: vi.fn(async () => {}),
  };
  const ctrl = createSessionController(set, env);
  return { ctrl, state, log, env, storage, browser, fetch };
}

function remember(storage, did, mode, { token, at = 1 } = {}) {
  recordSignIn(storage, { did, mode }, at);
  if (token) writeBackendToken(storage, did, token);
}

describe('starting up', () => {
  it('opens the remembered account, its agent acting as it', async () => {
    const storage = memoryStorage();
    remember(storage, MIRA, 'backend', { token: TOKEN, at: 2 });
    remember(storage, LAB, 'browser', { at: 1 });
    writeActiveDid(storage, MIRA);
    const { ctrl, state, log } = setup({ storage, answer: () => json({ success: true, authenticated: true, scope: OAUTH_SCOPE }) });
    await ctrl.startOnce();
    expect(state.active.did).toBe(MIRA);
    expect(state.active.agent.did).toBe(MIRA);
    expect(state.active.session).toEqual({ sub: MIRA, did: MIRA, mode: 'backend' });
    expect(state.active.mode).toBe('backend');
    expect(log.active).toEqual([MIRA]);
    expect(storage.getItem(SESSION_HINT_KEY)).toBe('1');
  });

  it('runs once, however often it’s asked', async () => {
    const storage = memoryStorage();
    remember(storage, MIRA, 'backend', { token: TOKEN });
    const { ctrl, log, browser } = setup({ storage });
    await Promise.all([ctrl.startOnce(), ctrl.startOnce()]);
    expect(log.active).toEqual([MIRA]);
    expect(browser.onDeleted).toHaveBeenCalledTimes(1);
  });

  it('takes a return from Virga’s server: the token, the account, and it opens', async () => {
    const storage = memoryStorage();
    remember(storage, LAB, 'browser');
    writeActiveDid(storage, LAB);
    const browser = fakeBrowser({ sessions: { [LAB]: oauthSession(LAB) } });
    const { ctrl, state } = setup({ storage, browser, backendReturn: { kind: 'session', did: MIRA, token: TOKEN, intent: 'add' } });
    await ctrl.startOnce();
    expect(storage.getItem(backendTokenKey(MIRA))).toBe(TOKEN);
    expect(storage.getItem(ACTIVE_KEY)).toBe(MIRA);
    expect(state.active.did).toBe(MIRA);
    expect(readAccounts(storage).map((a) => [a.did, a.mode])).toEqual([
      [MIRA, 'backend'],
      [LAB, 'browser'],
    ]);
  });

  it('ends the browser session of an account that moved to a long one', async () => {
    const storage = memoryStorage();
    remember(storage, MIRA, 'browser');
    const { ctrl, browser } = setup({ storage, backendReturn: { kind: 'session', did: MIRA, token: TOKEN, intent: 'reauth' } });
    await ctrl.startOnce();
    expect(browser.signOut).toHaveBeenCalledWith(MIRA);
  });

  it('shows a return that came back with an error, and changes nothing', async () => {
    const error = Object.assign(new Error('declined'), { params: new URLSearchParams({ error: 'access_denied' }) });
    const { ctrl, state, storage } = setup({ backendReturn: { kind: 'error', error } });
    await ctrl.startOnce();
    expect(state.error).toBe(error);
    expect(state.active).toBe(NO_ACTIVE);
    expect(storage.getItem(ACCOUNTS_KEY)).toBeNull();
  });

  it('finishes a browser sign-in on the callback, and makes it the open account', async () => {
    const session = oauthSession(LAB);
    const storage = memoryStorage();
    remember(storage, MIRA, 'backend', { token: TOKEN });
    const browser = fakeBrowser({ callback: { session, intent: 'add' } });
    const { ctrl, state } = setup({ storage, browser, onCallbackPath: true });
    await ctrl.startOnce();
    expect(state.active.did).toBe(LAB);
    expect(readAccounts(storage).find((a) => a.did === LAB)).toMatchObject({ mode: 'browser', scope: OAUTH_SCOPE });
    // The other account is still signed in, as a second one.
    expect(storage.getItem(backendTokenKey(MIRA))).toBe(TOKEN);
  });

  it('records the account of a browser that signed in before the account list', async () => {
    const storage = memoryStorage({ [SESSION_HINT_KEY]: '1' });
    const legacy = oauthSession(MIRA);
    const { ctrl, state } = setup({ storage, browser: fakeBrowser({ legacy, sessions: { [MIRA]: legacy } }) });
    await ctrl.startOnce();
    expect(state.active.did).toBe(MIRA);
    expect(readAccounts(storage)[0]).toMatchObject({ did: MIRA, mode: 'browser' });
  });

  it('moves on to the next account when the remembered one has signed out, quietly', async () => {
    const storage = memoryStorage();
    remember(storage, MIRA, 'browser', { at: 2 });
    remember(storage, LAB, 'backend', { token: TOKEN, at: 1 });
    writeActiveDid(storage, MIRA);
    const { ctrl, state, log } = setup({ storage });
    await ctrl.startOnce();
    expect(state.active.did).toBe(LAB);
    expect(readAccounts(storage).find((a) => a.did === MIRA).signedOut).toBe(true);
    expect(ctrl.statusOf(MIRA)).toBe('needsSignIn');
    // Not discovered while in use, so nobody is sent off to sign in.
    expect(log.events).toEqual([]);
  });

  it('keeps an account it couldn’t check, rather than opening another behind its back', async () => {
    const storage = memoryStorage();
    remember(storage, MIRA, 'browser', { at: 2 });
    remember(storage, LAB, 'backend', { token: TOKEN, at: 1 });
    writeActiveDid(storage, MIRA);
    const browser = fakeBrowser();
    browser.restore.mockImplementation(async () => {
      throw Object.assign(new TypeError('Failed to fetch'), { restoreFailure: 'unknown' });
    });
    const { ctrl, state, env } = setup({ storage, browser });
    await ctrl.startOnce();
    expect(browser.restore).toHaveBeenCalledTimes(2);
    expect(env.sleep).toHaveBeenCalled();
    expect(state.active).toBe(NO_ACTIVE);
    expect(ctrl.statusOf(MIRA)).toBe('unknown');
    expect(readAccounts(storage).find((a) => a.did === MIRA).signedOut).toBeUndefined();
  });
});

describe('switching', () => {
  async function twoAccounts() {
    const storage = memoryStorage();
    remember(storage, MIRA, 'backend', { token: TOKEN, at: 2 });
    remember(storage, LAB, 'backend', { token: TOKEN2, at: 1 });
    writeActiveDid(storage, MIRA);
    const ctx = setup({ storage });
    await ctx.ctrl.startOnce();
    return ctx;
  }

  it('publishes the new account in one update, with the old one up until then', async () => {
    const { ctrl, state, log, storage } = await twoAccounts();
    const before = state.active;
    let seenWhileSwitching = null;
    const done = ctrl.switchAccount(LAB);
    seenWhileSwitching = { switching: state.switching, did: state.active.did, agent: state.active.agent };
    await done;
    expect(seenWhileSwitching).toEqual({ switching: LAB, did: MIRA, agent: before.agent });
    expect(log.active).toEqual([MIRA, LAB]);
    expect(state.active.did).toBe(LAB);
    expect(state.active.agent.did).toBe(LAB);
    expect(state.switching).toBeNull();
    expect(storage.getItem(ACTIVE_KEY)).toBe(LAB);
    expect(readAccounts(storage)[0].did).toBe(LAB);
  });

  it('never pairs one account’s agent with another’s DID', async () => {
    const { ctrl, state } = await twoAccounts();
    for (const did of [LAB, MIRA, LAB]) {
      await ctrl.switchAccount(did);
      expect(state.active.did).toBe(did);
      expect(state.active.agent.did).toBe(did);
      expect(state.active.session.sub).toBe(did);
    }
  });

  it('refuses an account whose sign-in has gone, and leaves the open one as it was', async () => {
    const { ctrl, state, storage } = await twoAccounts();
    storage.removeItem(backendTokenKey(LAB));
    await expect(ctrl.switchAccount(LAB)).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' });
    expect(state.active.did).toBe(MIRA);
    expect(state.switching).toBeNull();
  });

  it('does nothing for the account already open', async () => {
    const { ctrl, log } = await twoAccounts();
    await ctrl.switchAccount(MIRA);
    expect(log.active).toEqual([MIRA]);
  });
});

describe('acting as an account without switching', () => {
  it('hands out the open agent for the open account, and another for the rest', async () => {
    const storage = memoryStorage();
    remember(storage, MIRA, 'backend', { token: TOKEN, at: 2 });
    remember(storage, LAB, 'browser', { at: 1 });
    writeActiveDid(storage, MIRA);
    const lab = oauthSession(LAB);
    const { ctrl, state, log } = setup({ storage, browser: fakeBrowser({ sessions: { [LAB]: lab } }) });
    await ctrl.startOnce();
    expect(await ctrl.agentFor(MIRA)).toBe(state.active.agent);
    const other = await ctrl.agentFor(LAB);
    expect(other.did).toBe(LAB);
    expect(await ctrl.agentFor(LAB)).toBe(other);
    expect(log.active).toEqual([MIRA]);
    expect(await ctrl.targetFor(LAB)).toEqual({ did: LAB, agent: other, pdsUrl: 'https://pds.example' });
  });

  it('never falls back to the open account for one that has to sign in again', async () => {
    const storage = memoryStorage();
    remember(storage, MIRA, 'backend', { token: TOKEN, at: 2 });
    remember(storage, LAB, 'backend', { at: 1 });
    const { ctrl } = setup({ storage });
    await ctrl.startOnce();
    await expect(ctrl.agentFor(LAB)).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' });
    await expect(ctrl.agentFor('did:plc:nobodyhere')).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' });
  });

  it('gives a requester to a long session only, bound to its own token', async () => {
    const storage = memoryStorage();
    remember(storage, MIRA, 'backend', { token: TOKEN, at: 2 });
    remember(storage, LAB, 'browser', { at: 1 });
    const { ctrl, fetch } = setup({ storage, answer: () => json({ success: true, data: [] }) });
    expect(ctrl.backendFor(LAB)).toBeNull();
    expect(ctrl.backendFor(THIRD)).toBeNull();
    const req = ctrl.backendFor(MIRA);
    expect(req.did).toBe(MIRA);
    expect(ctrl.backendFor(MIRA)).toBe(req);
    await req.request('/api/schedule/list');
    expect(fetch.mock.calls.at(-1)[1].headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });
});

describe('signing out', () => {
  it('ends this browser’s long session, drops the token, and opens the next account', async () => {
    const storage = memoryStorage();
    remember(storage, MIRA, 'backend', { token: TOKEN, at: 2 });
    remember(storage, LAB, 'backend', { token: TOKEN2, at: 1 });
    writeActiveDid(storage, MIRA);
    const { ctrl, state, fetch } = setup({ storage });
    await ctrl.startOnce();
    await ctrl.signOutAccount(MIRA);
    const logout = fetch.mock.calls.find(([url]) => String(url).endsWith('/oauth/logout'));
    expect(logout[1].headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(storage.getItem(backendTokenKey(MIRA))).toBeNull();
    expect(readAccounts(storage).find((a) => a.did === MIRA).signedOut).toBe(true);
    expect(state.active.did).toBe(LAB);
    expect(state.switching).toBeNull();
  });

  it('falls to the front page when no account is left, and clears the hint', async () => {
    const storage = memoryStorage();
    remember(storage, MIRA, 'browser');
    const session = oauthSession(MIRA);
    const browser = fakeBrowser({ sessions: { [MIRA]: session } });
    const { ctrl, state } = setup({ storage, browser });
    await ctrl.startOnce();
    await ctrl.signOutAccount(MIRA);
    expect(browser.signOut).toHaveBeenCalledWith(MIRA, session);
    expect(state.active).toBe(NO_ACTIVE);
    expect(storage.getItem(ACTIVE_KEY)).toBeNull();
    expect(storage.getItem(SESSION_HINT_KEY)).toBeNull();
    // The row stays, to come back to.
    expect(readAccounts(storage)).toHaveLength(1);
  });

  it('signs a background account out without touching the open one', async () => {
    const storage = memoryStorage();
    remember(storage, MIRA, 'backend', { token: TOKEN, at: 2 });
    remember(storage, LAB, 'backend', { token: TOKEN2, at: 1 });
    const { ctrl, state, log } = setup({ storage });
    await ctrl.startOnce();
    await ctrl.signOutAccount(LAB);
    expect(state.active.did).toBe(MIRA);
    expect(log.active).toEqual([MIRA]);
    expect(storage.getItem(backendTokenKey(MIRA))).toBe(TOKEN);
  });

  it('removes an account from this browser, with its data when asked', async () => {
    const storage = memoryStorage({ [`virga:dashboards:${LAB}`]: '[]', [`virga:keep:cleanup:${LAB}`]: '[]', [`virga:dashboards:${MIRA}`]: '[]' });
    remember(storage, MIRA, 'backend', { token: TOKEN, at: 2 });
    remember(storage, LAB, 'backend', { token: TOKEN2, at: 1 });
    const { ctrl, env } = setup({ storage });
    await ctrl.startOnce();
    await ctrl.removeAccount(LAB, { deleteData: true });
    expect(readAccounts(storage).map((a) => a.did)).toEqual([MIRA]);
    expect(storage.getItem(`virga:dashboards:${LAB}`)).toBeNull();
    expect(storage.getItem(`virga:keep:cleanup:${LAB}`)).toBeNull();
    expect(storage.getItem(`virga:dashboards:${MIRA}`)).toBe('[]');
    expect(env.deleteDatabase.mock.calls.map((c) => c[0])).toEqual([`virga-analytics:${LAB}`, `virga-posting:${LAB}`]);
    expect(env.resetAnalyticsStore).toHaveBeenCalled();
  });

  it('keeps the data of an account removed without asking', async () => {
    const storage = memoryStorage({ [`virga:dashboards:${LAB}`]: '[]' });
    remember(storage, LAB, 'backend', { token: TOKEN2 });
    const { ctrl, env } = setup({ storage });
    await ctrl.removeAccount(LAB, { deleteData: false });
    expect(storage.getItem(`virga:dashboards:${LAB}`)).toBe('[]');
    expect(env.deleteDatabase).not.toHaveBeenCalled();
  });
});

describe('noticing that a sign-in has ended', () => {
  const invalid = () => json({ success: false, code: 'FRONTEND_SESSION_INVALID' }, 401);

  async function openBackend(answer) {
    const storage = memoryStorage();
    remember(storage, MIRA, 'backend', { token: TOKEN });
    const ctx = setup({ storage, answer });
    await ctx.ctrl.startOnce();
    return ctx;
  }

  it('marks a long session dead only after three definitive answers', async () => {
    const { ctrl, log, storage, fetch, env } = await openBackend((url) => (url.includes('/oauth/session') ? invalid() : json({ success: true })));
    expect(await ctrl.checkAccount(MIRA)).toBe('expired');
    const probes = fetch.mock.calls.filter(([url]) => String(url).endsWith('/oauth/session?lite=1'));
    expect(probes).toHaveLength(3);
    expect(env.sleep).toHaveBeenCalledWith(2_500);
    expect(ctrl.statusOf(MIRA)).toBe('needsSignIn');
    expect(storage.getItem(backendTokenKey(MIRA))).toBeNull();
    expect(log.events).toContainEqual([SESSION_EXPIRED_EVENT, { did: MIRA }]);
  });

  it('never marks it dead for a server that lost the grant, or answered 503', async () => {
    for (const answer of [
      () => json({ success: true, authenticated: true, oauthSessionMissing: true }),
      () => json({ success: false, code: 'VALIDATION_TRANSIENT_ERROR' }, 503),
      () => json({ success: false, code: 'OAUTH_SESSION_MISSING' }, 401),
    ]) {
      const { ctrl, log, storage } = await openBackend((url) => (url.includes('/oauth/session') ? answer() : json({ success: true })));
      await ctrl.checkAccount(MIRA);
      expect(ctrl.statusOf(MIRA)).not.toBe('needsSignIn');
      expect(storage.getItem(backendTokenKey(MIRA))).toBe(TOKEN);
      expect(log.events).toEqual([]);
    }
  });

  it('runs the same rules when a request is refused with a 401', async () => {
    const { ctrl, log, state } = await openBackend((url) => {
      if (url.includes('/oauth/session?lite=1')) return invalid();
      if (url.includes('/oauth/proxy')) return json({ success: false, code: 'FRONTEND_SESSION_INVALID', error: 'gone' }, 401);
      return json({ success: true });
    });
    await state.active.agent.app.bsky.actor.getPreferences().catch(() => {});
    await vi.waitFor(() => expect(log.events).toContainEqual([SESSION_EXPIRED_EVENT, { did: MIRA }]));
    expect(ctrl.statusOf(MIRA)).toBe('needsSignIn');
  });

  it('follows a browser session the library dropped: quietly for a sign-out, out loud for an expiry', async () => {
    const storage = memoryStorage();
    remember(storage, MIRA, 'browser', { at: 2 });
    remember(storage, LAB, 'browser', { at: 1 });
    const browser = fakeBrowser({ sessions: { [MIRA]: oauthSession(MIRA), [LAB]: oauthSession(LAB) } });
    const { ctrl, log } = setup({ storage, browser });
    await ctrl.startOnce();
    browser.drop(LAB, { revoked: true });
    expect(ctrl.statusOf(LAB)).toBe('needsSignIn');
    expect(log.events).toEqual([]);
    browser.drop(MIRA, { revoked: false });
    expect(log.events).toEqual([[SESSION_EXPIRED_EVENT, { did: MIRA }]]);
  });

  it('learns a long session’s grant and its repo from the server', async () => {
    const { ctrl, storage, env } = await openBackend((url) =>
      url.endsWith('/oauth/session') ? json({ success: true, authenticated: true, scope: 'atproto', pds: 'https://pds.example' }) : json({ success: true }),
    );
    await vi.waitFor(() => expect(readAccounts(storage)[0].scope).toBe('atproto'));
    expect(env.rememberPdsUrl).toHaveBeenCalledWith(MIRA, 'https://pds.example');
    expect(ctrl.statusOf(MIRA)).toBe('ready');
  });
});

describe('signing in', () => {
  it('starts a long session through Virga’s server, coming back to the return path', async () => {
    const { ctrl, env, fetch } = setup({ answer: () => json({ success: true, authUrl: 'https://bsky.social/oauth/authorize?x=1' }) });
    ctrl.signIn('@mira.example.com', { mode: 'backend', intent: 'add' });
    await vi.waitFor(() => expect(env.assign).toHaveBeenCalledWith('https://bsky.social/oauth/authorize?x=1'));
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.pathname).toBe('/virga/oauth/login');
    expect(url.searchParams.get('handle')).toBe('mira.example.com');
    expect(url.searchParams.get('redirect_uri')).toMatch(/^https:\/\/virga\.example\/oauth\/return\?n=[0-9a-f]+$/);
  });

  it('starts a browser sign-in with the scope, marking that a session may exist', async () => {
    const { ctrl, browser, storage } = setup();
    await ctrl.signIn('mira.example.com', { mode: 'browser', intent: 'reauth' });
    expect(browser.signIn).toHaveBeenCalledWith('mira.example.com', { scope: OAUTH_SCOPE, intent: 'reauth' });
    expect(storage.getItem(SESSION_HINT_KEY)).toBe('1');
  });
});

describe('capabilitiesFrom', () => {
  const old = 'atproto repo:app.bsky.graph.follow?action=create&action=delete';

  it('lets a long session schedule and use the adviser, a browser one neither', () => {
    expect(capabilitiesFrom({ mode: 'backend' }, 'ready')).toEqual({ mode: 'backend', canPost: true, canSchedule: true, canUseAi: true, missing: [] });
    expect(capabilitiesFrom({ mode: 'browser' }, 'ready')).toEqual({ mode: 'browser', canPost: true, canSchedule: false, canUseAi: false, missing: [] });
    expect(capabilitiesFrom({ mode: 'backend' }, 'unknown').canSchedule).toBe(true);
    expect(capabilitiesFrom({ mode: 'backend' }, 'needsSignIn')).toMatchObject({ canPost: false, canSchedule: false, canUseAi: false });
    expect(capabilitiesFrom(null, 'needsSignIn')).toMatchObject({ mode: null, canPost: false });
  });

  it('can’t post from a grant without the posting permissions, and says what’s missing', () => {
    const caps = capabilitiesFrom({ mode: 'browser', scope: old }, 'ready');
    expect(caps.canPost).toBe(false);
    for (const token of POSTING_TOKENS) expect(caps.missing).toContain(token);
    expect(capabilitiesFrom({ mode: 'browser', scope: OAUTH_SCOPE }, 'ready')).toMatchObject({ canPost: true, missing: [] });
  });
});
