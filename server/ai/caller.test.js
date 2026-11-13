// Who the AI endpoints count a request against: the DID behind the session
// token, through the real token check (server/oauth/auth.js) over the
// Supabase fake. Nothing in the body names the account.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createFakeSupabase } from '../test/fakeSupabase.js';
import { createReq } from '../test/http.js';
import {
  resetSupabaseClientForTests,
  setSupabaseClientForTests,
} from '../supabase.js';
import { resetStorageForTests, tokenKey } from '../oauth/storage.js';
import { resolveAiCaller } from './caller.js';

const DID = 'did:plc:callerfixture';
const TOKEN = `vg_${'a1'.repeat(32)}`;

let fake;

beforeEach(() => {
  resetStorageForTests();
  fake = createFakeSupabase();
  setSupabaseClientForTests(fake);
  fake.rowsOf('frontend_sessions').push({
    token_hash: tokenKey(TOKEN),
    user_did: DID,
    expires_at: new Date(Date.now() + 20 * 86400000).toISOString(),
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  resetSupabaseClientForTests();
  resetStorageForTests();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const withToken = (token, body) =>
  createReq({
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body,
  });

describe('resolveAiCaller', () => {
  it('names the DID behind a valid session', async () => {
    expect(await resolveAiCaller(withToken(TOKEN, {}))).toEqual({
      ok: true,
      did: DID,
    });
  });

  it('ignores a DID or a membership claim in the body', async () => {
    const caller = await resolveAiCaller(
      withToken(TOKEN, { did: 'did:plc:someoneelse', member: true }),
    );
    expect(caller).toEqual({ ok: true, did: DID });
  });

  it('answers 401 with no Authorization header, and never trusts the body', async () => {
    const caller = await resolveAiCaller(
      createReq({ method: 'POST', body: { did: DID, member: true } }),
    );
    expect(caller).toEqual({
      ok: false,
      status: 401,
      error: 'Missing or invalid authorization header',
      code: 'FRONTEND_SESSION_INVALID',
    });
  });

  it('answers 401 for a token it does not know, so the client signs in again', async () => {
    const caller = await resolveAiCaller(withToken(`vg_${'0'.repeat(64)}`, {}));
    expect(caller).toEqual({
      ok: false,
      status: 401,
      error: 'Invalid or expired session',
      code: 'FRONTEND_SESSION_INVALID',
    });
  });

  it('answers 401 for an expired token', async () => {
    fake.rowsOf('frontend_sessions')[0].expires_at = new Date(
      Date.now() - 1000,
    ).toISOString();
    expect((await resolveAiCaller(withToken(TOKEN, {}))).status).toBe(401);
  });

  it('answers 503 when the session store cannot be read, so the client retries rather than signing out', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    fake.failNext('frontend_sessions', 'select', {
      code: 'XX000',
      message: 'connection reset',
    });
    const pending = resolveAiCaller(withToken(TOKEN, {}));
    await vi.runAllTimersAsync();
    expect(await pending).toEqual({
      ok: false,
      status: 503,
      error: 'Session validation temporarily unavailable, please retry',
      code: 'VALIDATION_TRANSIENT_ERROR',
    });
  });
});
