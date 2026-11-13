import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { deps, extractPdsEndpoint, fetchDidDocument, FetchTimeoutError, plcDirectoryUrl, resolvePdsEndpoint } from './didResolver.js';
import { SsrfError } from './safeFetch.js';

const PLC_DID = 'did:plc:ewvi7nxzyoun6zhxrhs64oiz';
const OTHER_PLC_DID = 'did:plc:z72i7hdynmk6r22z27h6tvur';

const json = (data, { ok = true, status = 200 } = {}) => ({ ok, status, headers: new Headers(), json: async () => data });

const didDoc = (id, endpoint = 'https://pds.example.com') => ({
  id,
  alsoKnownAs: ['at://someone.example.com'],
  service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: endpoint }],
});

// A fetch that only settles when its AbortSignal fires: a hung socket.
function hangingFetch() {
  return vi.fn((url, init = {}) => new Promise((_, reject) => {
    init.signal?.addEventListener('abort', () => {
      const err = new Error('This operation was aborted');
      err.name = 'AbortError';
      reject(err);
    });
  }));
}

const real = { ...deps };

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  Object.assign(deps, real);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('plcDirectoryUrl', () => {
  it('defaults to plc.directory and drops a trailing slash', () => {
    expect(plcDirectoryUrl({})).toBe('https://plc.directory');
    expect(plcDirectoryUrl({ PLC_DIRECTORY_URL: 'https://plc.mirror.example//' })).toBe('https://plc.mirror.example');
  });
});

describe('fetchDidDocument (did:plc)', () => {
  it('fetches from the configured PLC directory and returns the document', async () => {
    const fetchMock = vi.fn(async () => json(didDoc(PLC_DID)));
    vi.stubGlobal('fetch', fetchMock);
    const doc = await fetchDidDocument(PLC_DID, { env: { PLC_DIRECTORY_URL: 'https://plc.mirror.example/' } });
    expect(doc.id).toBe(PLC_DID);
    expect(fetchMock.mock.calls[0][0]).toBe(`https://plc.mirror.example/${PLC_DID}`);
    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('reads PLC_DIRECTORY_URL from process.env at call time', async () => {
    vi.stubEnv('PLC_DIRECTORY_URL', 'https://plc.other.example');
    const fetchMock = vi.fn(async () => json(didDoc(PLC_DID)));
    vi.stubGlobal('fetch', fetchMock);
    await fetchDidDocument(PLC_DID);
    expect(fetchMock.mock.calls[0][0]).toBe(`https://plc.other.example/${PLC_DID}`);
    vi.unstubAllEnvs();
  });

  it('rejects a document that describes a different DID', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(didDoc(OTHER_PLC_DID))));
    await expect(fetchDidDocument(PLC_DID)).rejects.toMatchObject({ code: 'DID_DOC_MISMATCH' });
  });

  it('rejects a response that is not a DID document', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(null)));
    await expect(fetchDidDocument(PLC_DID)).rejects.toMatchObject({ code: 'DID_DOC_MISMATCH' });
  });

  it('carries the HTTP status when the directory says no', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ message: 'DID not registered' }, { ok: false, status: 404 })));
    await expect(fetchDidDocument(PLC_DID)).rejects.toMatchObject({ status: 404 });
  });

  it('refuses a malformed did:plc without fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchDidDocument('did:plc:Ar7c4by46qjdydhdevvrndac')).rejects.toThrow(/Malformed/);
    await expect(fetchDidDocument('did:plc:abc/../../admin')).rejects.toThrow(/Malformed/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses other DID methods', async () => {
    await expect(fetchDidDocument('did:key:z6Mk')).rejects.toThrow(/Unsupported DID method/);
    await expect(fetchDidDocument(undefined)).rejects.toThrow(/A DID is required/);
  });

  it('times out on a hung PLC socket', async () => {
    vi.stubGlobal('fetch', hangingFetch());
    const err = await fetchDidDocument(PLC_DID, { timeoutMs: 20 }).catch((e) => e);
    expect(err).toBeInstanceOf(FetchTimeoutError);
    expect(err.code).toBe('TIMEOUT');
  });
});

describe('fetchDidDocument (did:web)', () => {
  it('goes through the SSRF-guarded fetch with a timeout', async () => {
    deps.safeFetchJson = vi.fn(async () => didDoc('did:web:example.com'));
    const doc = await fetchDidDocument('did:web:example.com');
    expect(doc.id).toBe('did:web:example.com');
    expect(deps.safeFetchJson).toHaveBeenCalledWith(
      'https://example.com/.well-known/did.json',
      expect.objectContaining({ timeoutMs: 8000 }),
    );
  });

  it('rejects a did:web document for another identity', async () => {
    deps.safeFetchJson = vi.fn(async () => didDoc('did:web:attacker.example'));
    await expect(fetchDidDocument('did:web:example.com')).rejects.toMatchObject({ code: 'DID_DOC_MISMATCH' });
  });

  it('bounds a document whose body stalls after the headers by the same timeout', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode('{"id":')); },
    }), { status: 200 })));
    const started = Date.now();
    // 93.184.216.34 is a public IP literal: the SSRF guard passes it without DNS.
    await expect(fetchDidDocument('did:web:93.184.216.34', { timeoutMs: 100 })).rejects.toMatchObject({ code: 'BODY_TIMEOUT' });
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('is still blocked by the SSRF guard for internal hosts', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchDidDocument('did:web:127.0.0.1')).rejects.toBeInstanceOf(SsrfError);
    await expect(fetchDidDocument('did:web:localhost')).rejects.toBeInstanceOf(SsrfError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('extractPdsEndpoint', () => {
  it('finds the #atproto_pds service, or one typed as a PDS', () => {
    expect(extractPdsEndpoint(didDoc(PLC_DID, 'https://pds.example.com'))).toBe('https://pds.example.com');
    expect(extractPdsEndpoint({ service: [{ id: '#other', type: 'AtprotoPersonalDataServer', serviceEndpoint: 'https://p.example' }] })).toBe('https://p.example');
  });

  it('is null without a PDS, or for an unsafe endpoint', () => {
    expect(extractPdsEndpoint({ service: [] })).toBeNull();
    expect(extractPdsEndpoint({})).toBeNull();
    expect(extractPdsEndpoint(null)).toBeNull();
    expect(extractPdsEndpoint(didDoc(PLC_DID, 'http://pds.example.com'))).toBeNull();
    expect(extractPdsEndpoint(didDoc(PLC_DID, 'https://169.254.169.254'))).toBeNull();
    expect(extractPdsEndpoint(didDoc(PLC_DID, 'https://localhost:2583'))).toBeNull();
  });
});

describe('resolvePdsEndpoint', () => {
  it('returns { did, pdsEndpoint, didDoc } for a DID whose document checks out', async () => {
    deps.assertPublicUrl = vi.fn(async (u) => new URL(u));
    vi.stubGlobal('fetch', vi.fn(async () => json(didDoc(PLC_DID, 'https://pds.example.com'))));
    const result = await resolvePdsEndpoint(PLC_DID);
    expect(result).toMatchObject({ did: PLC_DID, pdsEndpoint: 'https://pds.example.com' });
    expect(result.didDoc.id).toBe(PLC_DID);
    expect(deps.assertPublicUrl).toHaveBeenCalledWith('https://pds.example.com');
  });

  it("refuses to route to a PDS named by someone else's document", async () => {
    deps.assertPublicUrl = vi.fn(async (u) => new URL(u));
    vi.stubGlobal('fetch', vi.fn(async () => json(didDoc(OTHER_PLC_DID, 'https://attacker-pds.example'))));
    await expect(resolvePdsEndpoint(PLC_DID)).rejects.toMatchObject({ code: 'DID_DOC_MISMATCH' });
    expect(deps.assertPublicUrl).not.toHaveBeenCalled();
  });

  it('throws when the document names no usable PDS', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ id: PLC_DID, service: [] })));
    await expect(resolvePdsEndpoint(PLC_DID)).rejects.toMatchObject({ code: 'NO_PDS_ENDPOINT' });
  });

  it('runs the full SSRF check on the endpoint before returning it', async () => {
    // A name that looks public but resolves somewhere internal fails here.
    deps.assertPublicUrl = vi.fn(async () => { throw new SsrfError('pds.example.com resolves to blocked IP 10.0.0.1'); });
    vi.stubGlobal('fetch', vi.fn(async () => json(didDoc(PLC_DID))));
    await expect(resolvePdsEndpoint(PLC_DID)).rejects.toBeInstanceOf(SsrfError);
  });
});
