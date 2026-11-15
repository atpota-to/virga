// The terms ledger on a real Postgres (PGlite) with the migrations applied:
// the table of 20261114000200_terms_acceptance.sql, the store, and both
// handlers end to end. The session is mocked; everything below it is real.

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import { createTestDatabase, readMigration } from '../test/pglite.js';
import { createReq, createRes } from '../test/http.js';
import {
  resetSupabaseClientForTests,
  setSupabaseClientForTests,
} from '../supabase.js';
import {
  TERMS_EFFECTIVE_DATE,
  TERMS_VERSION,
} from '../../src/legal/version.js';
import {
  addressText,
  contextText,
  currentTerms,
  findAcceptance,
  isAccountDid,
  recordAcceptance,
  recordClaim,
} from './acceptance.js';

const auth = vi.hoisted(() => ({ resolveUserDid: vi.fn() }));
vi.mock('../oauth/auth.js', () => auth);

const { default: status } = await import('./handlers/status.js');
const { default: accept, resetAcceptLimiterForTests } =
  await import('./handlers/accept.js');

const MIGRATION = '20261114000200_terms_acceptance.sql';
const DID = 'did:plc:abcdefghijklmnopqrstuvwx';
const OTHER = 'did:plc:zyxwvutsrqponmlkjihgfedc';
const TOKEN = `Bearer vg_${'a'.repeat(64)}`;
const OAUTH_ENV = {
  OAUTH_PUBLIC_URL: 'https://virga.example.com',
  OAUTH_EXTRA_RETURN_ORIGINS: 'http://127.0.0.1:5173',
};

let t;

beforeAll(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t?.close();
});

beforeEach(async () => {
  await t.exec('TRUNCATE terms_acceptance');
  setSupabaseClientForTests(t.supabase);
  resetAcceptLimiterForTests();
  for (const [name, value] of Object.entries(OAUTH_ENV))
    vi.stubEnv(name, value);
  auth.resolveUserDid.mockReset();
  auth.resolveUserDid.mockResolvedValue({
    userDid: DID,
    status: 200,
    error: null,
    code: null,
  });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  resetSupabaseClientForTests();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const rows = async () =>
  (
    await t.query(
      'SELECT * FROM terms_acceptance ORDER BY accepted_at, identity',
    )
  ).rows;

async function call(handler, options) {
  const res = createRes();
  await handler(createReq(options), res);
  return res;
}

const signedIn = (extra = {}) => ({
  method: 'POST',
  headers: {
    authorization: TOKEN,
    'x-real-ip': '203.0.113.7',
    'user-agent': 'Vitest/1.0 (terms)',
    ...extra.headers,
  },
  body: { version: TERMS_VERSION, ...extra.body },
});

const unsigned = (extra = {}) => ({
  method: 'POST',
  headers: {
    'x-real-ip': '198.51.100.20',
    'user-agent': 'Vitest/1.0 (browser session)',
    ...extra.headers,
  },
  body: { version: TERMS_VERSION, did: DID, ...extra.body },
});

describe('the terms acceptance migration', () => {
  it('applies a second time unchanged', async () => {
    await expect(t.exec(readMigration(MIGRATION))).resolves.toBeDefined();
  });

  it('keeps the table to the service role, to read and add to only', async () => {
    const { rows: tables } = await t.query(
      `SELECT c.relrowsecurity AS rls,
              has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS anon,
              has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS authed,
              has_table_privilege('service_role', c.oid, 'SELECT') AS service_select,
              has_table_privilege('service_role', c.oid, 'INSERT') AS service_insert,
              has_table_privilege('service_role', c.oid, 'UPDATE,DELETE,TRUNCATE') AS service_change
         FROM pg_class c WHERE c.relname = 'terms_acceptance'`,
    );
    expect(tables).toEqual([
      {
        rls: true,
        anon: false,
        authed: false,
        service_select: true,
        service_insert: true,
        service_change: false,
      },
    ]);
  });

  it('refuses the service role an update or a delete, and lets it add and read', async () => {
    await recordAcceptance({ did: DID });
    // As on Supabase, where the service role is exempt from RLS and so held
    // back by its table privileges alone.
    await t.exec('ALTER ROLE service_role BYPASSRLS');
    const asService = async (sql) => {
      await t.exec('SET ROLE service_role');
      try {
        return await t.query(sql);
      } finally {
        await t.exec('RESET ROLE');
      }
    };
    await expect(
      asService(
        `UPDATE terms_acceptance SET accepted_at = NOW() - INTERVAL '1 year'`,
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asService('DELETE FROM terms_acceptance'),
    ).rejects.toThrow(/permission denied/);
    await expect(asService('TRUNCATE terms_acceptance')).rejects.toThrow(
      /permission denied/,
    );
    const added = await asService(
      `INSERT INTO terms_acceptance (did, terms_version, policy_version, identity)
       VALUES ('${OTHER}', 1, '2026-11-14', 'session') RETURNING did`,
    );
    expect(added.rows).toEqual([{ did: OTHER }]);
    expect(
      (await asService('SELECT did FROM terms_acceptance')).rows,
    ).toHaveLength(2);
  });

  it('holds a row to a known identity and a version above zero', async () => {
    const insert = (version, identity) =>
      t.query(
        `INSERT INTO terms_acceptance (did, terms_version, policy_version, identity)
         VALUES ($1, $2, '2026-11-14', $3)`,
        [DID, version, identity],
      );
    await expect(insert(1, 'guessed')).rejects.toThrow(/check constraint/);
    await expect(insert(0, 'session')).rejects.toThrow(/check constraint/);
    await expect(insert(1, 'session')).resolves.toBeDefined();
  });
});

describe('the ledger', () => {
  it('names the documents from the shared version module', () => {
    expect(currentTerms()).toEqual({
      version: TERMS_VERSION,
      effectiveDate: TERMS_EFFECTIVE_DATE,
    });
  });

  it('records a session’s agreement once, with where it came from', async () => {
    const first = await recordAcceptance({
      did: DID,
      ip: '203.0.113.7',
      userAgent: 'Vitest/1.0',
    });
    expect(first.created).toBe(true);
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(first.acceptedAt))).toBe(false);

    const [row] = await rows();
    expect(row).toMatchObject({
      did: DID,
      terms_version: TERMS_VERSION,
      policy_version: TERMS_EFFECTIVE_DATE,
      document: 'tos+privacy',
      identity: 'session',
      ip: '203.0.113.7',
      user_agent: 'Vitest/1.0',
    });
  });

  it('answers a second agreement with the first, and writes nothing', async () => {
    const first = await recordAcceptance({ did: DID, ip: '203.0.113.7' });
    const second = await recordAcceptance({
      did: DID,
      ip: '192.0.2.99',
      userAgent: 'Another/2.0',
    });
    expect(second).toEqual({ ...first, created: false });
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0].ip).toBe('203.0.113.7');
  });

  it('finds an agreement only for its own account and version, and never a claim', async () => {
    await recordClaim({ did: DID, ip: '198.51.100.20' });
    expect(await findAcceptance(DID)).toBeNull();

    await recordAcceptance({ did: DID });
    expect(await findAcceptance(OTHER)).toBeNull();
    expect(
      await findAcceptance(DID, { version: TERMS_VERSION + 1 }),
    ).toBeNull();
    expect(await findAcceptance(DID)).toMatchObject({
      acceptedAt: expect.any(String),
    });
    expect((await rows()).map((r) => r.identity).sort()).toEqual([
      'claimed',
      'session',
    ]);
  });

  it('keeps one line of context, cut to length', async () => {
    await recordAcceptance({
      did: DID,
      ip: 'unknown',
      userAgent: `Mozilla/5.0\r\nX-Injected: 1 ${'a'.repeat(600)}`,
    });
    const [row] = await rows();
    expect(row.ip).toBeNull();
    expect(row.user_agent).toHaveLength(512);
    expect(row.user_agent.startsWith('Mozilla/5.0 X-Injected: 1 aaa')).toBe(
      true,
    );
    expect(contextText('   ', 10)).toBeNull();
    expect(contextText(undefined, 10)).toBeNull();
  });

  it('keeps an address only when it is one', () => {
    expect(addressText('203.0.113.7')).toBe('203.0.113.7');
    expect(addressText(' 2001:db8::1 ')).toBe('2001:db8::1');
    expect(addressText('[2001:db8::1]')).toBe('2001:db8::1');
    expect(addressText('fe80::1%eth0')).toBe('fe80::1');
    for (const not of [
      'unknown',
      '',
      'not an address <b>hi</b>',
      '203.0.113.7, 10.0.0.1',
      '999.1.1.1',
      undefined,
      null,
      42,
    ])
      expect(addressText(not), String(not)).toBeNull();
  });

  it('refuses an entry with no account, or a claim that isn’t a DID', async () => {
    await expect(recordAcceptance({})).rejects.toThrow(TypeError);
    await expect(recordClaim({ did: 'mira.example.com' })).rejects.toThrow(
      TypeError,
    );
    expect(await rows()).toEqual([]);
  });

  it('says UNAVAILABLE without Supabase, and without the table', async () => {
    setSupabaseClientForTests(null);
    await expect(findAcceptance(DID)).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    await expect(recordAcceptance({ did: DID })).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
    await expect(recordClaim({ did: DID })).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });

    const before = await createTestDatabase({ upTo: '20261113000400' });
    try {
      setSupabaseClientForTests(before.supabase);
      await expect(findAcceptance(DID)).rejects.toMatchObject({
        code: 'UNAVAILABLE',
      });
      await expect(recordAcceptance({ did: DID })).rejects.toMatchObject({
        code: 'UNAVAILABLE',
      });
      await expect(recordClaim({ did: DID })).rejects.toMatchObject({
        code: 'UNAVAILABLE',
      });
    } finally {
      await before.close();
    }
  });

  it('says UNAVAILABLE while Virga’s schema isn’t among the project’s exposed schemas', async () => {
    // What the Data API answers every call with until the schema is exposed.
    const refused = {
      data: null,
      error: {
        code: 'PGRST106',
        message: 'The schema must be one of the following: public, graphql_public',
      },
    };
    const chain = new Proxy(function () {}, {
      get: (_target, key) => (key === 'then' ? (resolve) => resolve(refused) : chain),
      apply: () => chain,
    });
    setSupabaseClientForTests({ from: () => chain });
    for (const attempt of [findAcceptance(DID), recordAcceptance({ did: DID }), recordClaim({ did: DID })]) {
      await expect(attempt).rejects.toMatchObject({
        code: 'UNAVAILABLE',
        message: expect.stringContaining('exposed schemas'),
      });
    }
  });
});

describe('a browser session’s claim', () => {
  it('is kept once for an account from one address', async () => {
    expect(await recordClaim({ did: DID, ip: '198.51.100.20' })).toEqual({
      created: true,
    });
    expect(
      await recordClaim({ did: DID, ip: '198.51.100.20', userAgent: 'Again' }),
    ).toEqual({ created: false });
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ identity: 'claimed', ip: '198.51.100.20' });
  });

  it('can’t be pre-empted: a stranger naming an account first leaves room for its own', async () => {
    await recordClaim({ did: DID, ip: '192.0.2.66', userAgent: 'curl/8' });
    expect(
      await recordClaim({
        did: DID,
        ip: '198.51.100.20',
        userAgent: 'Firefox',
      }),
    ).toEqual({ created: true });
    const kept = (await rows()).map((r) => [r.ip, r.user_agent]).sort();
    expect(kept).toEqual([
      ['192.0.2.66', 'curl/8'],
      ['198.51.100.20', 'Firefox'],
    ]);
  });

  it('says nothing about the row it found or made', async () => {
    const made = await recordClaim({ did: DID, ip: '198.51.100.20' });
    const found = await recordClaim({ did: DID, ip: '198.51.100.20' });
    expect(Object.keys(made)).toEqual(['created']);
    expect(Object.keys(found)).toEqual(['created']);
  });

  it('stops taking new ones from an address that has made its share today', async () => {
    const from = { ip: '198.51.100.20', dailyCap: 2 };
    await recordClaim({ did: DID, ...from });
    await recordClaim({ did: OTHER, ...from });
    await expect(
      recordClaim({ did: 'did:web:third.example', ...from }),
    ).rejects.toMatchObject({ code: 'CLAIM_LIMIT' });
    // Another address has its own count, and yesterday's don't count.
    expect(
      await recordClaim({
        did: 'did:web:third.example',
        ip: '198.51.100.99',
        dailyCap: 2,
      }),
    ).toEqual({ created: true });
    await t.exec(
      `UPDATE terms_acceptance SET accepted_at = NOW() - INTERVAL '25 hours' WHERE ip = '198.51.100.20'`,
    );
    expect(
      await recordClaim({ did: 'did:web:third.example', ...from }),
    ).toEqual({ created: true });
  });

  it('counts callers with no address as one address', async () => {
    await recordClaim({ did: DID, ip: 'unknown', dailyCap: 1 });
    await expect(
      recordClaim({ did: OTHER, ip: 'also not an address', dailyCap: 1 }),
    ).rejects.toMatchObject({ code: 'CLAIM_LIMIT' });
    expect((await rows()).map((r) => r.ip)).toEqual([null]);
  });

  it('doesn’t count a session’s agreements against an address', async () => {
    await recordAcceptance({ did: DID, ip: '198.51.100.20' });
    expect(
      await recordClaim({ did: OTHER, ip: '198.51.100.20', dailyCap: 1 }),
    ).toEqual({ created: true });
  });
});

describe('an account’s DID', () => {
  it('is a did:plc of 24 base32 characters, or a did:web', () => {
    for (const did of [
      DID,
      'did:web:example.com',
      'did:web:pds.example.co.uk',
      'did:web:localhost%3A3000',
      'did:web:example.com:users:mira',
    ])
      expect(isAccountDid(did), did).toBe(true);
  });

  it('is nothing else, and is spelled one way', () => {
    for (const did of [
      '',
      null,
      undefined,
      42,
      'mira.example.com',
      'did:plc:short',
      'did:plc:ABCDEFGHIJKLMNOPQRSTUVWX',
      `did:plc:${'a'.repeat(25)}`,
      'did:plc:abcdefghijklmnopqrstuvw1',
      'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
      'did:web:',
      'did:web:.example.com',
      'did:web:example.com/path',
      'did:web:example.com?x=1',
      // The same account in another case would be another row.
      'DID:WEB:example.com',
      'did:web:Example.com',
      'did:web:localhost%3a3000',
      `did:web:${'a'.repeat(300)}`,
      `did:web:example.com${':segment'.repeat(80)}`,
      'did:plc:abcdefghijklmnopqrstuvwx\n',
      ' did:plc:abcdefghijklmnopqrstuvwx',
    ])
      expect(isAccountDid(did), String(did)).toBe(false);
  });
});

describe('GET /api/terms/status', () => {
  it('says an account that hasn’t agreed hasn’t', async () => {
    const res = await call(status, { headers: { authorization: TOKEN } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      version: TERMS_VERSION,
      effectiveDate: TERMS_EFFECTIVE_DATE,
      accepted: false,
      acceptedAt: null,
    });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('says one that has, has, and when', async () => {
    const first = await recordAcceptance({ did: DID });
    const res = await call(status, { headers: { authorization: TOKEN } });
    expect(res.body).toMatchObject({
      success: true,
      accepted: true,
      acceptedAt: first.acceptedAt,
    });
  });

  it('doesn’t count a browser’s claim, or another account’s agreement', async () => {
    await recordClaim({ did: DID, ip: '198.51.100.20' });
    await recordAcceptance({ did: OTHER });
    const res = await call(status, { headers: { authorization: TOKEN } });
    expect(res.body).toMatchObject({ accepted: false, acceptedAt: null });
  });

  it('answers with the session’s own refusal when there is no session', async () => {
    auth.resolveUserDid.mockResolvedValue({
      userDid: null,
      status: 401,
      error: 'Invalid or expired session',
      code: 'FRONTEND_SESSION_INVALID',
    });
    const res = await call(status, {});
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      success: false,
      error: 'Invalid or expired session',
      code: 'FRONTEND_SESSION_INVALID',
    });
  });

  it('is 503 UNAVAILABLE without Supabase, before the session is looked at', async () => {
    setSupabaseClientForTests(null);
    const res = await call(status, { headers: { authorization: TOKEN } });
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ success: false, code: 'UNAVAILABLE' });
    expect(auth.resolveUserDid).not.toHaveBeenCalled();
  });

  it('takes GET only', async () => {
    const res = await call(status, {
      method: 'POST',
      headers: { authorization: TOKEN },
    });
    expect(res.statusCode).toBe(405);
  });
});

describe('POST /api/terms/accept, with a session', () => {
  it('records the session’s account, with the request’s address and browser', async () => {
    const res = await call(accept, signedIn());
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      version: TERMS_VERSION,
      effectiveDate: TERMS_EFFECTIVE_DATE,
      identity: 'session',
      acceptedAt: expect.any(String),
      created: true,
    });
    expect(await rows()).toEqual([
      expect.objectContaining({
        did: DID,
        terms_version: TERMS_VERSION,
        identity: 'session',
        ip: '203.0.113.7',
        user_agent: 'Vitest/1.0 (terms)',
      }),
    ]);
  });

  it('ignores a DID in the body: the account is the session’s', async () => {
    const res = await call(accept, signedIn({ body: { did: OTHER } }));
    expect(res.statusCode).toBe(200);
    expect((await rows()).map((r) => r.did)).toEqual([DID]);
  });

  it('answers a repeat with the first agreement', async () => {
    const first = await call(accept, signedIn());
    const again = await call(
      accept,
      signedIn({ headers: { 'x-real-ip': '192.0.2.1' } }),
    );
    expect(again.statusCode).toBe(200);
    expect(again.body).toMatchObject({
      created: false,
      acceptedAt: first.body.acceptedAt,
    });
    expect(await rows()).toHaveLength(1);
  });

  it('never records a token that doesn’t hold as a claim', async () => {
    auth.resolveUserDid.mockResolvedValue({
      userDid: null,
      status: 401,
      error: 'Invalid or expired session',
      code: 'FRONTEND_SESSION_INVALID',
    });
    const res = await call(accept, signedIn({ body: { did: DID } }));
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({
      success: false,
      code: 'FRONTEND_SESSION_INVALID',
    });
    expect(await rows()).toEqual([]);
  });

  it('passes on a session store that can’t be read as 503, to try again', async () => {
    auth.resolveUserDid.mockResolvedValue({
      userDid: null,
      status: 503,
      error: 'Session validation temporarily unavailable, please retry',
      code: 'VALIDATION_TRANSIENT_ERROR',
    });
    const res = await call(accept, signedIn());
    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe('VALIDATION_TRANSIENT_ERROR');
    expect(await rows()).toEqual([]);
  });

  it('writes nothing for a version that isn’t the current one', async () => {
    for (const version of [
      TERMS_VERSION + 1,
      0,
      String(TERMS_VERSION),
      null,
      undefined,
    ]) {
      const res = await call(accept, signedIn({ body: { version } }));
      expect(res.statusCode, String(version)).toBe(409);
      expect(res.body).toMatchObject({
        success: false,
        code: 'TERMS_VERSION_MISMATCH',
        version: TERMS_VERSION,
        effectiveDate: TERMS_EFFECTIVE_DATE,
      });
    }
    expect(await rows()).toEqual([]);
  });

  it('limits an account’s agreements per minute', async () => {
    vi.stubEnv('TERMS_ACCEPT_RATE_LIMIT', '2');
    expect((await call(accept, signedIn())).statusCode).toBe(200);
    expect((await call(accept, signedIn())).statusCode).toBe(200);
    const res = await call(accept, signedIn());
    expect(res.statusCode).toBe(429);
    expect(res.body).toMatchObject({ success: false, code: 'RATE_LIMITED' });
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);

    // Another account has its own window.
    auth.resolveUserDid.mockResolvedValue({
      userDid: OTHER,
      status: 200,
      error: null,
      code: null,
    });
    expect((await call(accept, signedIn())).statusCode).toBe(200);
  });

  it('is 503 UNAVAILABLE without Supabase, and when the table is missing', async () => {
    setSupabaseClientForTests(null);
    const none = await call(accept, signedIn());
    expect(none.statusCode).toBe(503);
    expect(none.body).toMatchObject({ success: false, code: 'UNAVAILABLE' });

    const before = await createTestDatabase({ upTo: '20261113000400' });
    try {
      setSupabaseClientForTests(before.supabase);
      const missing = await call(accept, signedIn());
      expect(missing.statusCode).toBe(503);
      expect(missing.body).toMatchObject({
        success: false,
        code: 'UNAVAILABLE',
      });
    } finally {
      await before.close();
    }
  });

  it('answers a database fault with a fixed sentence, and logs the real one', async () => {
    setSupabaseClientForTests({
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: null,
              error: {
                code: 'XX000',
                message: 'relation internals: secret_column',
              },
            }),
          }),
        }),
      }),
    });
    const res = await call(accept, signedIn());
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({
      success: false,
      error: "couldn't record that. please try again.",
      code: 'INTERNAL',
    });
    expect(JSON.stringify(res.body)).not.toContain('secret_column');
    expect(console.error).toHaveBeenCalled();
  });

  it('takes POST only', async () => {
    const res = await call(accept, {
      method: 'GET',
      headers: { authorization: TOKEN },
    });
    expect(res.statusCode).toBe(405);
    expect(await rows()).toEqual([]);
  });
});

describe('POST /api/terms/accept, without a session', () => {
  const CLAIMED_ANSWER = {
    success: true,
    version: TERMS_VERSION,
    effectiveDate: TERMS_EFFECTIVE_DATE,
    identity: 'claimed',
  };

  it('records the DID the browser reports, marked as a claim', async () => {
    const res = await call(accept, unsigned());
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(CLAIMED_ANSWER);
    expect(auth.resolveUserDid).not.toHaveBeenCalled();
    expect(await rows()).toEqual([
      expect.objectContaining({
        did: DID,
        identity: 'claimed',
        ip: '198.51.100.20',
        user_agent: 'Vitest/1.0 (browser session)',
      }),
    ]);
  });

  it('tells a caller nothing about an account: the same answer whether or not it had agreed', async () => {
    const first = await call(accept, unsigned());
    // Someone else, somewhere else, asking about the same account.
    const probe = await call(
      accept,
      unsigned({ headers: { 'x-real-ip': '192.0.2.66' } }),
    );
    const again = await call(accept, unsigned());
    for (const res of [first, probe, again]) {
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual(CLAIMED_ANSWER);
      expect(res.body).not.toHaveProperty('acceptedAt');
      expect(res.body).not.toHaveProperty('created');
    }
    // And the same for an account with a session's agreement on record.
    await recordAcceptance({ did: OTHER });
    const known = await call(accept, unsigned({ body: { did: OTHER } }));
    expect(known.body).toEqual(CLAIMED_ANSWER);
  });

  it('takes a DID only in its real shape', async () => {
    for (const did of [
      undefined,
      '',
      'mira.example.com',
      'did:plc:short',
      'DID:WEB:Example.COM',
      { $ne: null },
      ['did:plc:x'],
    ]) {
      const res = await call(accept, unsigned({ body: { did } }));
      expect(res.statusCode, JSON.stringify(did)).toBe(400);
      expect(res.body).toMatchObject({ success: false, code: 'DID_INVALID' });
    }
    expect(await rows()).toEqual([]);
  });

  it('checks the version before the DID', async () => {
    const res = await call(
      accept,
      unsigned({ body: { version: 99, did: 'nonsense' } }),
    );
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('TERMS_VERSION_MISMATCH');
  });

  it('refuses a page on another site, and takes Virga’s own origins', async () => {
    const foreign = await call(
      accept,
      unsigned({ headers: { origin: 'https://evil.example' } }),
    );
    expect(foreign.statusCode).toBe(403);
    expect(foreign.body).toMatchObject({
      success: false,
      code: 'ORIGIN_NOT_ALLOWED',
    });

    const opaque = await call(
      accept,
      unsigned({ headers: { origin: 'null' } }),
    );
    expect(opaque.statusCode).toBe(403);
    expect(await rows()).toEqual([]);

    const own = await call(
      accept,
      unsigned({
        headers: { origin: 'https://deploy.example', host: 'deploy.example' },
      }),
    );
    expect(own.statusCode).toBe(200);

    const frontend = await call(
      accept,
      unsigned({
        headers: { origin: 'http://127.0.0.1:5173' },
        body: { did: OTHER },
      }),
    );
    expect(frontend.statusCode).toBe(200);
    expect(await rows()).toHaveLength(2);
  });

  it('limits claims by address per minute, whatever DIDs they name', async () => {
    vi.stubEnv('TERMS_ACCEPT_RATE_LIMIT', '2');
    expect((await call(accept, unsigned())).statusCode).toBe(200);
    expect(
      (await call(accept, unsigned({ body: { did: OTHER } }))).statusCode,
    ).toBe(200);
    const third = await call(
      accept,
      unsigned({ body: { did: 'did:web:third.example' } }),
    );
    expect(third.statusCode).toBe(429);
    expect(third.body.code).toBe('RATE_LIMITED');

    const elsewhere = await call(
      accept,
      unsigned({
        headers: { 'x-real-ip': '198.51.100.99' },
        body: { did: 'did:web:third.example' },
      }),
    );
    expect(elsewhere.statusCode).toBe(200);
  });

  it('limits new claims by address per day, in the database', async () => {
    vi.stubEnv('TERMS_CLAIMS_PER_ADDRESS_PER_DAY', '2');
    expect((await call(accept, unsigned())).statusCode).toBe(200);
    expect(
      (await call(accept, unsigned({ body: { did: OTHER } }))).statusCode,
    ).toBe(200);
    // A fresh window on every instance wouldn't get past this one.
    resetAcceptLimiterForTests();
    const third = await call(
      accept,
      unsigned({ body: { did: 'did:web:third.example' } }),
    );
    expect(third.statusCode).toBe(429);
    expect(third.body).toMatchObject({ success: false, code: 'RATE_LIMITED' });
    expect(third.headers['retry-after']).toBe('3600');
    expect(await rows()).toHaveLength(2);
  });

  it('keeps an address only when the request’s is one', async () => {
    await call(
      accept,
      unsigned({ headers: { 'x-real-ip': 'not an address <b>hi</b>' } }),
    );
    expect((await rows()).map((r) => r.ip)).toEqual([null]);
  });

  it('can be turned off, leaving sessions as the only way to agree', async () => {
    vi.stubEnv('TERMS_ACCEPT_CLAIMED', 'false');
    const res = await call(accept, unsigned());
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({
      success: false,
      code: 'SESSION_REQUIRED',
    });
    expect(await rows()).toEqual([]);

    expect((await call(accept, signedIn())).statusCode).toBe(200);
  });

  it('doesn’t stand in for a session: status still says not agreed', async () => {
    await call(accept, unsigned());
    const res = await call(status, { headers: { authorization: TOKEN } });
    expect(res.body).toMatchObject({ accepted: false });
  });
});
