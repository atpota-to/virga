import { describe, expect, it, vi } from 'vitest';
import { SUGGEST_LIMIT, SUGGEST_MIN_CHARS, moveActive, searchAccounts, suggestQuery } from './suggest.js';

const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe('what is searched for', () => {
  it('is the handle as typed so far, tidied', () => {
    expect(suggestQuery(' @Mir')).toBe('mir');
    expect(suggestQuery('mira.example')).toBe('mira.example');
  });

  it('is nothing for too little, a DID or an address', () => {
    expect(SUGGEST_MIN_CHARS).toBe(2);
    expect(suggestQuery('')).toBeNull();
    expect(suggestQuery('m')).toBeNull();
    expect(suggestQuery('@m')).toBeNull();
    expect(suggestQuery('did:plc:abcdefghijklmnopqrstuvwx')).toBeNull();
    expect(suggestQuery('https://pds.example.com')).toBeNull();
  });
});

describe('searching for accounts', () => {
  it('asks Bluesky’s public search, and keeps what a row needs', async () => {
    const fetch = vi.fn(async () =>
      json({
        actors: [
          { did: 'did:plc:a', handle: 'mira.example.com', displayName: ' Mira Okafor ', avatar: 'https://cdn.test/m.jpg', labels: [] },
          { did: 'did:plc:b', handle: 'mirror.example.org' },
        ],
      }),
    );
    const found = await searchAccounts('mir', { fetch, appview: 'https://appview.test' });
    expect(fetch.mock.calls[0][0]).toBe(`https://appview.test/xrpc/app.bsky.actor.searchActorsTypeahead?q=mir&limit=${SUGGEST_LIMIT}`);
    expect(found).toEqual([
      { did: 'did:plc:a', handle: 'mira.example.com', displayName: 'Mira Okafor', avatar: 'https://cdn.test/m.jpg' },
      { did: 'did:plc:b', handle: 'mirror.example.org', displayName: null, avatar: null },
    ]);
  });

  it('encodes what was typed, and passes the signal on', async () => {
    const fetch = vi.fn(async () => json({ actors: [] }));
    const controller = new AbortController();
    await searchAccounts('a&limit=100', { fetch, appview: 'https://appview.test', signal: controller.signal });
    expect(fetch.mock.calls[0][0]).toContain('q=a%26limit%3D100&limit=5');
    expect(fetch.mock.calls[0][1].signal).toBe(controller.signal);
  });

  it('leaves out an account that can’t be signed in to by its handle, and anything malformed', async () => {
    const fetch = vi.fn(async () => json({ actors: [{ did: 'did:plc:a', handle: 'handle.invalid' }, { handle: 'no-did.example' }, null, { did: 'did:plc:c', handle: 'ok.example' }] }));
    expect((await searchAccounts('ok', { fetch })).map((a) => a.handle)).toEqual(['ok.example']);
  });

  it('never returns more than it was asked for', async () => {
    const actors = Array.from({ length: 9 }, (_, i) => ({ did: `did:plc:${i}`, handle: `a${i}.example` }));
    expect(await searchAccounts('a', { fetch: async () => json({ actors }), limit: 3 })).toHaveLength(3);
  });

  it('is empty for an answer with no list, and throws when the search fails', async () => {
    expect(await searchAccounts('mir', { fetch: async () => json({}) })).toEqual([]);
    expect(await searchAccounts('mir', { fetch: async () => ({ ok: true, status: 200, json: async () => { throw new Error('not json'); } }) })).toEqual([]);
    await expect(searchAccounts('mir', { fetch: async () => json({}, 502) })).rejects.toMatchObject({ status: 502 });
  });
});

describe('moving through the suggestions', () => {
  it('goes down from the field, and round to it again', () => {
    expect(moveActive(-1, 3, 'ArrowDown')).toBe(0);
    expect(moveActive(0, 3, 'ArrowDown')).toBe(1);
    expect(moveActive(2, 3, 'ArrowDown')).toBe(-1);
  });

  it('goes up from the field to the last, and back up to the field', () => {
    expect(moveActive(-1, 3, 'ArrowUp')).toBe(2);
    expect(moveActive(2, 3, 'ArrowUp')).toBe(1);
    expect(moveActive(0, 3, 'ArrowUp')).toBe(-1);
  });

  it('jumps to either end, and stays put for any other key', () => {
    expect(moveActive(1, 3, 'Home')).toBe(0);
    expect(moveActive(1, 3, 'End')).toBe(2);
    expect(moveActive(1, 3, 'a')).toBe(1);
  });

  it('marks nothing when there is nothing to mark', () => {
    expect(moveActive(0, 0, 'ArrowDown')).toBe(-1);
    expect(moveActive(-1, 0, 'ArrowUp')).toBe(-1);
  });
});
