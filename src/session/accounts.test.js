import { describe, expect, it } from 'vitest';
import { analyticsDbName } from '../lib/analyticsStore.js';
import { keepKey } from '../tools/keep.js';
import { layoutKey } from '../dashboards/DashboardsContext.jsx';
import {
  ACCOUNTS_KEY,
  ACTIVE_KEY,
  accountHandle,
  accountName,
  accountSignInId,
  backendTokenKey,
  findAccount,
  forgetAccount,
  isBackendToken,
  isReauthRequiredError,
  lastOpenedLabel,
  localDataKeys,
  localDatabases,
  makeReauthRequiredError,
  markSignedOut,
  needsRefresh,
  nextReadyAccount,
  pickActiveAccount,
  readAccounts,
  readActiveDid,
  readBackendToken,
  reauthNoticeLabel,
  recordSignIn,
  removeLocalData,
  signedInAccounts,
  touchAccount,
  updateAccount,
  writeAccounts,
  writeActiveDid,
  writeBackendToken,
} from './accounts.js';

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

const throwingStorage = {
  getItem() {
    throw new Error('SecurityError');
  },
  setItem() {
    throw new Error('QuotaExceededError');
  },
  removeItem() {
    throw new Error('SecurityError');
  },
  key() {
    throw new Error('SecurityError');
  },
  get length() {
    throw new Error('SecurityError');
  },
};

const MIRA = 'did:plc:virgaharnessmira2zq4x';
const LAB = 'did:plc:virgaharnesslab7k2pq';
const TOKEN = `vg_${'a1'.repeat(32)}`;

describe('the account list', () => {
  it('reads most recently used first, dropping malformed rows and repeats', () => {
    const storage = memoryStorage({
      [ACCOUNTS_KEY]: JSON.stringify([
        { did: MIRA, lastUsed: 1, mode: 'browser' },
        null,
        { handle: 'nobody' },
        { did: 'not-a-did', lastUsed: 9 },
        { did: LAB, lastUsed: 5, mode: 'backend' },
        { did: MIRA, lastUsed: 99 },
      ]),
    });
    expect(readAccounts(storage).map((a) => a.did)).toEqual([LAB, MIRA]);
  });

  it('reads nothing from missing, malformed or throwing storage', () => {
    expect(readAccounts(memoryStorage())).toEqual([]);
    expect(readAccounts(memoryStorage({ [ACCOUNTS_KEY]: '{oops' }))).toEqual([]);
    expect(readAccounts(memoryStorage({ [ACCOUNTS_KEY]: '{"did":"x"}' }))).toEqual([]);
    expect(readAccounts(null)).toEqual([]);
    expect(readAccounts(throwingStorage)).toEqual([]);
    expect(() => writeAccounts(throwingStorage, [{ did: MIRA }])).not.toThrow();
  });

  it('gives an unknown mode the browser sign-in', () => {
    const storage = memoryStorage({ [ACCOUNTS_KEY]: JSON.stringify([{ did: MIRA, mode: 'pigeon' }]) });
    expect(readAccounts(storage)[0].mode).toBe('browser');
  });

  it('records a sign-in at the top, and brings a signed-out row back', () => {
    const storage = memoryStorage();
    recordSignIn(storage, { did: MIRA, mode: 'browser', handle: 'mira.example.com' }, 1000);
    recordSignIn(storage, { did: LAB, mode: 'backend' }, 2000);
    markSignedOut(storage, MIRA);
    expect(findAccount(readAccounts(storage), MIRA).signedOut).toBe(true);

    const list = recordSignIn(storage, { did: MIRA, mode: 'backend' }, 3000);
    expect(list.map((a) => a.did)).toEqual([MIRA, LAB]);
    const mira = findAccount(list, MIRA);
    expect(mira.signedOut).toBeUndefined();
    expect(mira.mode).toBe('backend');
    // What was known about the account survives a sign-in that didn't say.
    expect(mira.handle).toBe('mira.example.com');
    expect(mira.addedAt).toBe(1000);
    expect(mira.lastUsed).toBe(3000);
  });

  it('forgets a grant when the account changes how it signs in', () => {
    const storage = memoryStorage();
    recordSignIn(storage, { did: MIRA, mode: 'browser', scope: 'atproto' });
    expect(findAccount(recordSignIn(storage, { did: MIRA, mode: 'backend' }), MIRA).scope).toBeUndefined();
    expect(findAccount(recordSignIn(storage, { did: MIRA, mode: 'backend', scope: 'atproto repo:*' }), MIRA).scope).toBe('atproto repo:*');
  });

  it('merges fields into one row only, and never adds a row', () => {
    const storage = memoryStorage();
    recordSignIn(storage, { did: MIRA, mode: 'browser' }, 1);
    recordSignIn(storage, { did: LAB, mode: 'browser' }, 2);
    updateAccount(storage, MIRA, { displayName: 'Mira Okafor', did: 'did:plc:smuggled' });
    const list = readAccounts(storage);
    expect(findAccount(list, MIRA).displayName).toBe('Mira Okafor');
    expect(findAccount(list, LAB).displayName).toBeNull();
    expect(updateAccount(storage, 'did:plc:absent', { handle: 'x' }).length).toBe(2);
    touchAccount(storage, MIRA, 50);
    expect(readAccounts(storage)[0].did).toBe(MIRA);
  });

  it('forgets an account with its token and the open pointer, if it named it', () => {
    const storage = memoryStorage();
    recordSignIn(storage, { did: MIRA, mode: 'backend' });
    writeBackendToken(storage, MIRA, TOKEN);
    writeActiveDid(storage, MIRA);
    forgetAccount(storage, MIRA);
    expect(readAccounts(storage)).toEqual([]);
    expect(storage.getItem(backendTokenKey(MIRA))).toBeNull();
    expect(storage.getItem(ACTIVE_KEY)).toBeNull();

    recordSignIn(storage, { did: LAB, mode: 'browser' });
    recordSignIn(storage, { did: MIRA, mode: 'browser' });
    writeActiveDid(storage, LAB);
    forgetAccount(storage, MIRA);
    expect(readActiveDid(storage)).toBe(LAB);
  });
});

describe('the open account', () => {
  it('reads only a DID', () => {
    expect(readActiveDid(memoryStorage({ [ACTIVE_KEY]: MIRA }))).toBe(MIRA);
    expect(readActiveDid(memoryStorage({ [ACTIVE_KEY]: 'mira.example.com' }))).toBeNull();
    expect(readActiveDid(throwingStorage)).toBeNull();
  });

  it('opens the remembered account if it is signed in, else the most recent that is', () => {
    const list = [
      { did: LAB, lastUsed: 3, signedOut: true },
      { did: MIRA, lastUsed: 2 },
      { did: 'did:plc:third', lastUsed: 1 },
    ];
    expect(pickActiveAccount(list, 'did:plc:third').did).toBe('did:plc:third');
    expect(pickActiveAccount(list, LAB).did).toBe(MIRA);
    expect(pickActiveAccount(list, null).did).toBe(MIRA);
    expect(pickActiveAccount([{ did: LAB, signedOut: true }], LAB)).toBeNull();
    expect(signedInAccounts(list).map((a) => a.did)).toEqual([MIRA, 'did:plc:third']);
  });

  it('moves on to the next account that is ready, never the one being left', () => {
    const list = [{ did: MIRA }, { did: LAB }, { did: 'did:plc:third' }];
    expect(nextReadyAccount(list, MIRA).did).toBe(LAB);
    expect(nextReadyAccount(list, MIRA, (did) => (did === LAB ? 'needsSignIn' : 'ready')).did).toBe('did:plc:third');
    expect(nextReadyAccount([{ did: MIRA }], MIRA)).toBeNull();
  });
});

describe('long-session tokens', () => {
  it('keeps one token per account, and only a well-formed one', () => {
    const storage = memoryStorage();
    expect(writeBackendToken(storage, MIRA, TOKEN)).toBe(true);
    expect(writeBackendToken(storage, LAB, 'deadbeef')).toBe(false);
    expect(writeBackendToken(storage, 'nobody', TOKEN)).toBe(false);
    expect(readBackendToken(storage, MIRA)).toBe(TOKEN);
    expect(readBackendToken(storage, LAB)).toBeNull();
    expect(backendTokenKey(MIRA)).toBe(`virga:backend-token:${MIRA}`);
  });

  it('never reads another account’s token, or a tampered one', () => {
    const storage = memoryStorage({ [backendTokenKey(MIRA)]: TOKEN, [backendTokenKey(LAB)]: `${TOKEN}0` });
    expect(readBackendToken(storage, LAB)).toBeNull();
    expect(isBackendToken(TOKEN)).toBe(true);
    expect(isBackendToken(TOKEN.toUpperCase())).toBe(false);
  });
});

describe('naming an account', () => {
  it('never shows a DID as a name or a handle when something better is known', () => {
    expect(accountName({ did: MIRA, handle: 'mira.example.com', displayName: MIRA })).toBe('@mira.example.com');
    expect(accountName({ did: MIRA, handle: 'mira.example.com', displayName: 'Mira Okafor' })).toBe('Mira Okafor');
    expect(accountName({ did: MIRA, handle: MIRA })).toBe('did:plc:virg…a2zq4x');
    expect(accountHandle({ handle: MIRA })).toBeNull();
    expect(accountHandle({ handle: 'mira.example.com' })).toBe('@mira.example.com');
  });

  it('signs in again with the handle when known, else the DID', () => {
    expect(accountSignInId({ did: MIRA, handle: 'mira.example.com' })).toBe('mira.example.com');
    expect(accountSignInId({ did: MIRA, handle: null })).toBe(MIRA);
  });

  it('refreshes rows missing a handle or a picture', () => {
    expect(needsRefresh({ handle: 'a.example.com', avatar: 'https://x' })).toBe(false);
    expect(needsRefresh({ handle: MIRA, avatar: 'https://x' })).toBe(true);
    expect(needsRefresh({ handle: 'a.example.com' })).toBe(true);
  });

  it('labels the notice by @handle, then name, then DID', () => {
    expect(reauthNoticeLabel({ did: MIRA, handle: 'mira.example.com', displayName: 'Mira' })).toBe('@mira.example.com');
    expect(reauthNoticeLabel({ did: MIRA, handle: MIRA, displayName: 'Mira' })).toBe('Mira');
    expect(reauthNoticeLabel({ did: MIRA })).toBe(MIRA);
    expect(reauthNoticeLabel(null)).toBe('This account');
  });
});

describe('lastOpenedLabel', () => {
  const now = new Date(2026, 10, 12, 21, 0).getTime();
  const daysAgo = (n, hour = 12) => new Date(2026, 10, 12 - n, hour).getTime();

  it('words recent visits by calendar day', () => {
    expect(lastOpenedLabel(daysAgo(0, 8), now)).toBe('Last opened today');
    expect(lastOpenedLabel(daysAgo(1, 23), now)).toBe('Last opened yesterday');
    expect(lastOpenedLabel(daysAgo(3), now)).toBe('Last opened 3 days ago');
  });

  it('rounds older visits to weeks, months, then a year', () => {
    expect(lastOpenedLabel(daysAgo(8), now)).toBe('Last opened a week ago');
    expect(lastOpenedLabel(daysAgo(21), now)).toBe('Last opened 3 weeks ago');
    expect(lastOpenedLabel(daysAgo(40), now)).toBe('Last opened a month ago');
    expect(lastOpenedLabel(daysAgo(400), now)).toBe('Last opened over a year ago');
  });

  it('says nothing without a time', () => {
    expect(lastOpenedLabel(undefined, now)).toBeNull();
    expect(lastOpenedLabel(0, now)).toBeNull();
  });
});

describe('the re-authorization error', () => {
  it('is recognized by its code and nothing else', () => {
    const err = makeReauthRequiredError(MIRA);
    expect(isReauthRequiredError(err)).toBe(true);
    expect(err.did).toBe(MIRA);
    expect(err.message).toMatch(/sign in again/);
    expect(isReauthRequiredError(new Error('REAUTH_REQUIRED'))).toBe(false);
    expect(isReauthRequiredError(null)).toBe(false);
  });
});

describe('what an account keeps in this browser', () => {
  it('names each per-account key, as its owner spells it', () => {
    const storage = memoryStorage({
      [keepKey(MIRA, 'followback')]: '[]',
      [keepKey(MIRA, 'cleanup')]: '[]',
      [keepKey(LAB, 'cleanup')]: '[]',
      'virga:preferences': '{}',
      'virga:posting-device': 'x',
    });
    const keys = localDataKeys(storage, MIRA);
    expect(keys).toContain(layoutKey(MIRA));
    expect(keys).toContain(keepKey(MIRA, 'followback'));
    expect(keys).toContain(keepKey(MIRA, 'cleanup'));
    for (const k of ['posting', 'composer-autosave', 'templates', 'template-usage', 'adviser-usage']) {
      expect(keys).toContain(`virga:${k}:${MIRA}`);
    }
    expect(keys).not.toContain(keepKey(LAB, 'cleanup'));
    expect(keys).not.toContain('virga:preferences');
    expect(keys).not.toContain('virga:posting-device');
    expect(keys).not.toContain(backendTokenKey(MIRA));
  });

  it('removes them and leaves everyone else’s', () => {
    const storage = memoryStorage({
      [layoutKey(MIRA)]: '[]',
      [layoutKey(LAB)]: '[]',
      [keepKey(MIRA, 'cleanup')]: '[]',
      'virga:preferences': '{}',
    });
    removeLocalData(storage, MIRA);
    expect([...storage.map.keys()].sort()).toEqual([layoutKey(LAB), 'virga:preferences'].sort());
    expect(() => removeLocalData(throwingStorage, MIRA)).not.toThrow();
  });

  it('names the account’s databases, the archive’s as the store does', () => {
    expect(localDatabases(MIRA)).toEqual([analyticsDbName(MIRA), `virga-posting:${MIRA}`]);
    expect(localDatabases('nope')).toEqual([]);
  });
});
