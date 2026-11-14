import { describe, expect, it, vi } from 'vitest';
import { createPdsResolver, pdsFromDidDocument } from './pds.js';

const DID = 'did:plc:virgaharnessmira2zq4x';
const doc = (endpoint, id = '#atproto_pds') => ({
  id: DID,
  service: [
    { id: '#bsky_notif', type: 'BskyNotificationService', serviceEndpoint: 'https://notify.example' },
    { id, type: 'AtprotoPersonalDataServer', serviceEndpoint: endpoint },
  ],
});

describe('pdsFromDidDocument', () => {
  it('finds the #atproto_pds service, written short or long, without a trailing slash', () => {
    expect(pdsFromDidDocument(doc('https://morel.us-east.host.bsky.network/'))).toBe('https://morel.us-east.host.bsky.network');
    expect(pdsFromDidDocument(doc('https://pds.example', `${DID}#atproto_pds`), DID)).toBe('https://pds.example');
  });

  it('never guesses from another service, or takes a non-http endpoint', () => {
    expect(pdsFromDidDocument({ service: [{ id: '#bsky_notif', serviceEndpoint: 'https://notify.example' }] })).toBeNull();
    expect(pdsFromDidDocument(doc('javascript:alert(1)'))).toBeNull();
    expect(pdsFromDidDocument(doc('not a url'))).toBeNull();
    expect(pdsFromDidDocument(null)).toBeNull();
  });
});

describe('createPdsResolver', () => {
  it('asks once per account, sharing a lookup under way', async () => {
    const getDidDocument = vi.fn(async () => doc('https://pds.example'));
    const { resolvePdsUrl } = createPdsResolver({ getDidDocument });
    const [a, b] = await Promise.all([resolvePdsUrl(DID), resolvePdsUrl(DID)]);
    expect(a).toBe('https://pds.example');
    expect(b).toBe('https://pds.example');
    await resolvePdsUrl(DID);
    expect(getDidDocument).toHaveBeenCalledTimes(1);
  });

  it('forgets a failure, so the next caller asks again', async () => {
    const getDidDocument = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(doc('https://pds.example'));
    const { resolvePdsUrl } = createPdsResolver({ getDidDocument });
    await expect(resolvePdsUrl(DID)).rejects.toThrow('offline');
    expect(await resolvePdsUrl(DID)).toBe('https://pds.example');
  });

  it('refuses a document with no PDS, and a missing DID', async () => {
    const { resolvePdsUrl } = createPdsResolver({ getDidDocument: async () => ({ service: [] }) });
    await expect(resolvePdsUrl(DID)).rejects.toThrow(/No PDS/);
    await expect(resolvePdsUrl('')).rejects.toThrow(/missing did/);
  });

  it('takes a PDS learned elsewhere without a lookup', async () => {
    const getDidDocument = vi.fn();
    const r = createPdsResolver({ getDidDocument });
    r.remember(DID, 'https://pds.example/');
    expect(await r.resolvePdsUrl(DID)).toBe('https://pds.example');
    r.remember(DID, 'ftp://nope');
    expect(await r.resolvePdsUrl(DID)).toBe('https://pds.example');
    expect(getDidDocument).not.toHaveBeenCalled();
  });
});
