import { describe, expect, it } from 'vitest';
import {
  MAX_REPORT_TRIES,
  TERMS_ACCEPTED_PREFIX,
  acceptFailure,
  coversCurrent,
  needsReport,
  readAcceptance,
  startingStatus,
  statusFromAnswer,
  termsKey,
  writeAcceptance,
} from './acceptance.js';
import { TERMS_VERSION } from './version.js';

const DID = 'did:plc:abcdefghijklmnopqrstuvwx';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  };
}

const throwingStorage = {
  getItem() {
    throw new Error('SecurityError');
  },
  setItem() {
    throw new Error('QuotaExceededError');
  },
};

describe('the note that an account agreed', () => {
  it('is kept per account', () => {
    expect(termsKey(DID)).toBe(`${TERMS_ACCEPTED_PREFIX}${DID}`);
    expect(termsKey(DID)).toBe(`virga:terms-accepted:${DID}`);
  });

  it('round-trips', () => {
    const storage = memoryStorage();
    expect(readAcceptance(storage, DID)).toBeNull();
    writeAcceptance(storage, DID, { at: '2026-11-14T10:00:00.000Z', recorded: true });
    expect(readAcceptance(storage, DID)).toEqual({ version: TERMS_VERSION, at: '2026-11-14T10:00:00.000Z', recorded: true, tries: 0 });
    expect(readAcceptance(storage, 'did:plc:someoneelse0000000000000')).toBeNull();
  });

  it('reads nothing from a note it doesn’t understand', () => {
    const bad = ['', 'null', 'not json', '1', '"1"', '{}', '{"version":"1"}', '{"version":0}', '{"version":1.5}', '[1]'];
    for (const raw of bad) {
      expect(readAcceptance(memoryStorage({ [termsKey(DID)]: raw }), DID), raw).toBeNull();
    }
  });

  it('takes the rest of a note at its most careful reading', () => {
    const storage = memoryStorage({ [termsKey(DID)]: JSON.stringify({ version: 2, at: 42, recorded: 'yes', tries: -3 }) });
    expect(readAcceptance(storage, DID)).toEqual({ version: 2, at: null, recorded: false, tries: 0 });
  });

  it('fails soft without storage, or with one that throws', () => {
    expect(readAcceptance(null, DID)).toBeNull();
    expect(readAcceptance(throwingStorage, DID)).toBeNull();
    expect(() => writeAcceptance(throwingStorage, DID)).not.toThrow();
    expect(() => writeAcceptance(null, DID)).not.toThrow();
    expect(readAcceptance(memoryStorage(), null)).toBeNull();
    const storage = memoryStorage();
    writeAcceptance(storage, null);
    expect(storage.map.size).toBe(0);
  });
});

describe('whether a note covers the current documents', () => {
  it('does when it is for this version, or a later one', () => {
    expect(coversCurrent({ version: TERMS_VERSION })).toBe(true);
    expect(coversCurrent({ version: TERMS_VERSION + 1 })).toBe(true);
    expect(coversCurrent({ version: 3 }, 3)).toBe(true);
  });

  it('doesn’t when it is for an earlier one, or missing', () => {
    expect(coversCurrent({ version: 1 }, 2)).toBe(false);
    expect(coversCurrent(null)).toBe(false);
    expect(coversCurrent(undefined)).toBe(false);
  });
});

describe('where the agreement screen starts', () => {
  const noted = { version: TERMS_VERSION, at: null, recorded: true, tries: 0 };

  it('is out of the way for an account this browser knows agreed', () => {
    expect(startingStatus({ entry: noted, mode: 'backend', canAsk: true })).toBe('accepted');
    expect(startingStatus({ entry: noted, mode: 'browser', canAsk: false })).toBe('accepted');
  });

  it('asks the server first for a long session with no note here', () => {
    expect(startingStatus({ entry: null, mode: 'backend', canAsk: true })).toBe('checking');
  });

  it('shows the screen when there is nobody to ask', () => {
    expect(startingStatus({ entry: null, mode: 'browser', canAsk: false })).toBe('needs');
    // A long session whose token is gone can't ask either.
    expect(startingStatus({ entry: null, mode: 'backend', canAsk: false })).toBe('needs');
  });

  it('asks again after the documents change', () => {
    const old = { ...noted, version: TERMS_VERSION - 1 };
    expect(startingStatus({ entry: old, mode: 'backend', canAsk: true })).toBe('checking');
    expect(startingStatus({ entry: old, mode: 'browser', canAsk: false })).toBe('needs');
  });
});

describe('the server’s answer', () => {
  it('opens the gate only for an agreement to the documents this page holds', () => {
    expect(statusFromAnswer({ accepted: true, version: TERMS_VERSION })).toBe('accepted');
    expect(statusFromAnswer({ accepted: false, version: TERMS_VERSION })).toBe('needs');
    expect(statusFromAnswer({ accepted: true, version: TERMS_VERSION + 1 })).toBe('needs');
    expect(statusFromAnswer({ accepted: 'true', version: TERMS_VERSION })).toBe('needs');
    expect(statusFromAnswer(null)).toBe('needs');
  });
});

describe('an agreement still to be reported', () => {
  const pending = { version: TERMS_VERSION, at: null, recorded: false, tries: 0 };

  it('is one made here that the server hasn’t confirmed', () => {
    expect(needsReport(pending)).toBe(true);
    expect(needsReport({ ...pending, recorded: true })).toBe(false);
    expect(needsReport(null)).toBe(false);
  });

  it('isn’t one for documents that have since changed', () => {
    expect(needsReport({ ...pending, version: 1 }, 2)).toBe(false);
  });

  it('stops being offered after enough tries', () => {
    expect(needsReport({ ...pending, tries: MAX_REPORT_TRIES - 1 })).toBe(true);
    expect(needsReport({ ...pending, tries: MAX_REPORT_TRIES })).toBe(false);
  });
});

describe('an agreement that couldn’t be recorded', () => {
  const coded = (code, status) => Object.assign(new Error('x'), { code, status });

  it('asks for a reload when the documents changed under the page', () => {
    expect(acceptFailure(coded('TERMS_VERSION_MISMATCH', 409))).toEqual({ text: expect.stringMatching(/have changed since this page loaded/), reload: true });
  });

  it('says the connection, the limit or the sign-in was the trouble', () => {
    expect(acceptFailure(coded('NETWORK_ERROR', 0)).text).toMatch(/Couldn’t reach Virga’s server/);
    expect(acceptFailure(coded('TIMEOUT', 0)).text).toMatch(/Couldn’t reach Virga’s server/);
    expect(acceptFailure(coded('RATE_LIMITED', 429)).text).toMatch(/Wait a minute/);
    expect(acceptFailure(coded('FRONTEND_SESSION_INVALID', 401)).text).toMatch(/sign-in has ended/);
    expect(acceptFailure(coded(null, 401)).text).toMatch(/sign-in has ended/);
  });

  it('never repeats the server’s own text for anything else', () => {
    for (const error of [coded('UNAVAILABLE', 503), coded('INTERNAL', 500), new Error('relation "terms_acceptance" does not exist'), undefined]) {
      const failure = acceptFailure(error);
      expect(failure).toEqual({ text: 'Virga’s server couldn’t record your agreement just now. Try again in a little while.', reload: false });
    }
  });
});
