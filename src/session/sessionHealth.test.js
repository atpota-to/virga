// The lite check's answers, read so that a flaky network never marks a live
// account as signed out: only explicit rejections read as expired, only
// FRONTEND_SESSION_INVALID is definitive, and even that only counts after
// it has come back three times, 2.5 s apart.

import { describe, expect, it, vi } from 'vitest';
import {
  CONFIRM_GAP_MS,
  CONFIRM_ROUNDS,
  LITE_CHECK_TTL_MS,
  REAUTH_ATTEMPTS_KEY,
  REAUTH_LOOP_MAX,
  REAUTH_LOOP_WINDOW_MS,
  SESSION_CHECK_STATUS,
  clearReauthAttempts,
  confirmSessionDead,
  createSessionChecker,
  interpretLiteSessionResponse,
  reauthLooping,
  recordReauthAttempt,
  statusFromCheck,
} from './sessionHealth.js';

const { VALID, EXPIRED, UNKNOWN } = SESSION_CHECK_STATUS;
const dead = { status: EXPIRED, definitive: true };
const alive = { status: VALID, definitive: false };
const unsure = { status: UNKNOWN, definitive: false };

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  };
}

describe('interpretLiteSessionResponse', () => {
  it('reads a healthy answer as valid', () => {
    expect(
      interpretLiteSessionResponse({ ok: true, status: 200, data: { success: true, authenticated: true, lite: true, oauthSessionMissing: false } }),
    ).toEqual(alive);
  });

  it('reads a 401 with FRONTEND_SESSION_INVALID as definitively expired', () => {
    expect(interpretLiteSessionResponse({ ok: false, status: 401, data: { success: false, code: 'FRONTEND_SESSION_INVALID' } })).toEqual(dead);
  });

  it('reads any other 401 or 403 as expired, but not definitively', () => {
    for (const status of [401, 403]) {
      expect(interpretLiteSessionResponse({ ok: false, status, data: null })).toEqual({ status: EXPIRED, definitive: false });
    }
    expect(interpretLiteSessionResponse({ ok: false, status: 401, data: { code: 'OAUTH_SESSION_MISSING' } })).toEqual({
      status: EXPIRED,
      definitive: false,
    });
  });

  it('reads oauthSessionMissing as expired but not definitive (a row read can miss)', () => {
    expect(interpretLiteSessionResponse({ ok: true, status: 200, data: { success: true, authenticated: true, oauthSessionMissing: true } })).toEqual({
      status: EXPIRED,
      definitive: false,
    });
  });

  it('reads transient failures and odd bodies as unknown, never expired', () => {
    const answers = [
      { ok: false, status: 503, data: { code: 'VALIDATION_TRANSIENT_ERROR' } },
      { ok: false, status: 500, data: null },
      { ok: false, status: 502, data: null },
      { ok: false, status: 0, data: null },
      { ok: true, status: 200, data: null },
      { ok: true, status: 200, data: { success: true, authenticated: false } },
    ];
    for (const a of answers) expect(interpretLiteSessionResponse(a)).toEqual(unsure);
  });
});

describe('statusFromCheck', () => {
  it('needs a sign-in only after a definitive answer', () => {
    expect(statusFromCheck(dead)).toBe('needsSignIn');
    expect(statusFromCheck({ status: EXPIRED, definitive: false })).toBe('unknown');
    expect(statusFromCheck(alive)).toBe('ready');
    expect(statusFromCheck(unsure)).toBe('unknown');
  });
});

describe('confirmSessionDead', () => {
  const noSleep = vi.fn(async () => {});

  it('is dead only when every round is definitive, spaced by the gap', async () => {
    const sleep = vi.fn(async () => {});
    const probe = vi.fn(async () => dead);
    expect(await confirmSessionDead(probe, { sleep })).toBe('dead');
    expect(probe).toHaveBeenCalledTimes(CONFIRM_ROUNDS);
    expect(sleep).toHaveBeenCalledTimes(CONFIRM_ROUNDS - 1);
    expect(sleep).toHaveBeenCalledWith(CONFIRM_GAP_MS);
    expect(CONFIRM_ROUNDS).toBe(3);
    expect(CONFIRM_GAP_MS).toBe(2_500);
  });

  it('is alive the moment a round comes back valid', async () => {
    const probe = vi.fn().mockResolvedValueOnce(dead).mockResolvedValueOnce(alive);
    expect(await confirmSessionDead(probe, { sleep: noSleep })).toBe('alive');
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it('is unknown for anything that isn’t definitive, or a probe that throws', async () => {
    expect(await confirmSessionDead(vi.fn().mockResolvedValueOnce(dead).mockResolvedValueOnce(unsure), { sleep: noSleep })).toBe('unknown');
    expect(await confirmSessionDead(async () => ({ status: EXPIRED, definitive: false }), { sleep: noSleep })).toBe('unknown');
    expect(
      await confirmSessionDead(
        async () => {
          throw new Error('offline');
        },
        { sleep: noSleep },
      ),
    ).toBe('unknown');
  });
});

describe('createSessionChecker', () => {
  it('probes an account at most once a minute, and shares a probe under way', async () => {
    let t = 1_000;
    const probe = vi.fn(async () => alive);
    const checker = createSessionChecker({ probe, now: () => t });
    const [a, b] = await Promise.all([checker.check('did:plc:a'), checker.check('did:plc:a')]);
    expect(a).toEqual(alive);
    expect(b).toEqual(alive);
    expect(probe).toHaveBeenCalledTimes(1);
    t += LITE_CHECK_TTL_MS - 1;
    await checker.check('did:plc:a');
    expect(probe).toHaveBeenCalledTimes(1);
    t += 2;
    await checker.check('did:plc:a');
    expect(probe).toHaveBeenCalledTimes(2);
    await checker.check('did:plc:a', { force: true });
    expect(probe).toHaveBeenCalledTimes(3);
    await checker.check('did:plc:b');
    expect(probe).toHaveBeenCalledTimes(4);
  });

  it('confirms a definitive answer twice more before reporting it', async () => {
    const sleep = vi.fn(async () => {});
    const onResult = vi.fn();
    const probe = vi.fn(async () => dead);
    const checker = createSessionChecker({ probe, sleep, onResult });
    expect(await checker.check('did:plc:a')).toEqual(dead);
    expect(probe).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(onResult).toHaveBeenCalledWith('did:plc:a', dead);
  });

  it('downgrades a definitive answer that didn’t hold', async () => {
    const sleep = vi.fn(async () => {});
    const flaky = vi.fn().mockResolvedValueOnce(dead).mockResolvedValueOnce(unsure);
    expect(await createSessionChecker({ probe: flaky, sleep }).check('did:plc:a')).toEqual({ status: EXPIRED, definitive: false });
    const healed = vi.fn().mockResolvedValueOnce(dead).mockResolvedValueOnce(alive);
    expect(await createSessionChecker({ probe: healed, sleep }).check('did:plc:a')).toEqual(alive);
  });

  it('reads a probe that throws as unknown', async () => {
    const checker = createSessionChecker({
      probe: async () => {
        throw new Error('offline');
      },
    });
    expect(await checker.check('did:plc:a')).toEqual(unsure);
  });

  it('can be told to forget an account', async () => {
    const probe = vi.fn(async () => alive);
    const checker = createSessionChecker({ probe });
    await checker.check('did:plc:a');
    expect(checker.peek('did:plc:a')).toEqual(alive);
    checker.forget('did:plc:a');
    expect(checker.peek('did:plc:a')).toBeNull();
    await checker.check('did:plc:a');
    expect(probe).toHaveBeenCalledTimes(2);
  });
});

describe('the automatic sign-in loop breaker', () => {
  it('trips after three redirects in five minutes, and resets with time', () => {
    const s = memoryStorage();
    const t0 = 1_000_000;
    expect(REAUTH_LOOP_MAX).toBe(3);
    expect(REAUTH_LOOP_WINDOW_MS).toBe(300_000);
    for (let i = 0; i < 2; i++) recordReauthAttempt(s, t0 + i);
    expect(reauthLooping(s, t0 + 10)).toBe(false);
    recordReauthAttempt(s, t0 + 2);
    expect(reauthLooping(s, t0 + 10)).toBe(true);
    expect(reauthLooping(s, t0 + REAUTH_LOOP_WINDOW_MS + 5)).toBe(false);
    clearReauthAttempts(s);
    expect(s.map.has(REAUTH_ATTEMPTS_KEY)).toBe(false);
  });

  it('fails soft on bad or throwing storage', () => {
    expect(reauthLooping(memoryStorage({ [REAUTH_ATTEMPTS_KEY]: '{oops' }))).toBe(false);
    expect(reauthLooping(null)).toBe(false);
    const throwing = {
      getItem() {
        throw new Error('x');
      },
      setItem() {
        throw new Error('x');
      },
      removeItem() {
        throw new Error('x');
      },
    };
    expect(() => recordReauthAttempt(throwing)).not.toThrow();
    expect(() => clearReauthAttempts(throwing)).not.toThrow();
  });
});
