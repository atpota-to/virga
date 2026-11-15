import { describe, expect, it, vi } from 'vitest';
import {
  IdentityLookupError,
  IdentityNotFoundError,
  classifySignInInput,
  cleanTyped,
  createIdentityResolver,
  handleFromDidDocument,
  hostLabelForPds,
  hostnameOf,
  normalizeSignInInput,
} from './identity.js';

const DID = 'did:plc:abcdefghijklmnopqrstuvwx';
const APPVIEW = 'https://appview.test';
const PDS = 'https://puffball.us-east.host.bsky.network';

const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const didDocument = (pds = PDS, handle = 'mira.example.com') => ({
  id: DID,
  alsoKnownAs: [`at://${handle}`],
  service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: pds }],
});

/**
 * A resolver over canned answers. `routes` maps a piece of the address to an
 * answer (a response, an Error to throw, or a function of the address).
 */
function resolver(routes, { document = didDocument() } = {}) {
  const fetch = vi.fn(async (url) => {
    for (const [piece, answer] of Object.entries(routes)) {
      if (!String(url).includes(piece)) continue;
      const value = typeof answer === 'function' ? answer(url) : answer;
      if (value instanceof Error) throw value;
      return value;
    }
    throw new Error(`no answer for ${url}`);
  });
  const getDidDocument = vi.fn(async () => {
    if (document instanceof Error) throw document;
    return document;
  });
  return { fetch, getDidDocument, ...createIdentityResolver({ fetch, getDidDocument, appview: APPVIEW }) };
}

const PROFILE = { did: DID, handle: 'mira.example.com', displayName: '  Mira Okafor ', avatar: 'https://cdn.test/a.jpg' };
const PROTECTED = { resource: PDS, authorization_servers: ['https://bsky.social'] };

describe('what was typed', () => {
  it('loses invisible characters as it is typed, and nothing else', () => {
    expect(cleanTyped('mi\u200Bra.example\u202E.com\uFEFF')).toBe('mira.example.com');
    expect(cleanTyped(' Mira.Example.com ')).toBe(' Mira.Example.com ');
    expect(cleanTyped(null)).toBe('');
  });

  it('becomes a handle: trimmed, lower case, without its @', () => {
    expect(normalizeSignInInput('  @Mira.Example.COM ')).toBe('mira.example.com');
    expect(normalizeSignInInput('@@mira.example.com')).toBe('mira.example.com');
    expect(normalizeSignInInput('mi\u200Bra.example.com')).toBe('mira.example.com');
    // Full-width letters, as an input method can leave them.
    expect(normalizeSignInInput('ｍｉｒａ.example.com')).toBe('mira.example.com');
    expect(normalizeSignInInput('')).toBe('');
    expect(normalizeSignInInput('   ')).toBe('');
    expect(normalizeSignInInput(undefined)).toBe('');
  });

  it('keeps a DID as it was written', () => {
    expect(normalizeSignInInput(` ${DID} `)).toBe(DID);
    expect(normalizeSignInInput('did:web:Example.com')).toBe('did:web:Example.com');
  });

  it('takes the handle out of a pasted profile link', () => {
    expect(normalizeSignInInput('https://bsky.app/profile/Mira.example.com')).toBe('mira.example.com');
    expect(normalizeSignInInput('https://www.bsky.app/profile/mira.example.com/post/3kabc?ref=x')).toBe('mira.example.com');
    expect(normalizeSignInInput(`https://bsky.app/profile/${DID}/lists`)).toBe(DID);
    expect(normalizeSignInInput('https://bsky.app/profile/%E0%A4%A')).toBe('%e0%a4%a');
  });

  it('leaves a host’s address alone', () => {
    expect(normalizeSignInInput(' https://PDS.Example.com/ ')).toBe('https://PDS.Example.com/');
    expect(normalizeSignInInput('https://bsky.app/about')).toBe('https://bsky.app/about');
  });

  it('is told apart: a handle, a DID, a host’s address, or nothing', () => {
    expect(classifySignInInput('')).toBe('empty');
    expect(classifySignInInput('mira.example.com')).toBe('handle');
    expect(classifySignInInput(DID)).toBe('did');
    expect(classifySignInInput('https://pds.example.com')).toBe('url');
    expect(classifySignInInput('HTTP://pds.example.com')).toBe('url');
  });
});

describe('naming a host', () => {
  it('reads the host name out of an address', () => {
    expect(hostnameOf('https://pds.example.com:8443/x')).toBe('pds.example.com');
    expect(hostnameOf('not an address')).toBeNull();
    expect(hostnameOf(null)).toBeNull();
  });

  it('calls Bluesky’s PDSes by the page their accounts sign in on', () => {
    expect(hostLabelForPds(PDS)).toBe('bsky.social');
    expect(hostLabelForPds('https://bsky.network')).toBe('bsky.social');
    expect(hostLabelForPds('https://notbsky.network.example')).toBe('notbsky.network.example');
  });

  it('calls any other PDS by its own name, and nothing by none', () => {
    expect(hostLabelForPds('https://pds.example.com')).toBe('pds.example.com');
    expect(hostLabelForPds('garbage')).toBeNull();
  });

  it('reads the handle a DID document claims', () => {
    expect(handleFromDidDocument(didDocument())).toBe('mira.example.com');
    expect(handleFromDidDocument({ alsoKnownAs: ['https://example.com', 'at://Mira.Example.com'] })).toBe('mira.example.com');
    expect(handleFromDidDocument({ alsoKnownAs: ['at://nodot'] })).toBeNull();
    expect(handleFromDidDocument({})).toBeNull();
    expect(handleFromDidDocument(null)).toBeNull();
  });
});

describe('where an account signs in', () => {
  it('is the authorization server its PDS names', async () => {
    const { resolveSignInHost, fetch } = resolver({ 'oauth-protected-resource': json(PROTECTED) });
    expect(await resolveSignInHost(DID)).toEqual({ host: 'bsky.social', pds: PDS });
    expect(fetch.mock.calls[0][0]).toBe(`${PDS}/.well-known/oauth-protected-resource`);
  });

  it('is the PDS’s own name when it names no server, or can’t be asked', async () => {
    const quiet = resolver({ 'oauth-protected-resource': json({}, 404) }, { document: didDocument('https://pds.example.com') });
    expect(await quiet.resolveSignInHost(DID)).toEqual({ host: 'pds.example.com', pds: 'https://pds.example.com' });

    const down = resolver({ 'oauth-protected-resource': new TypeError('Failed to fetch') });
    expect(await down.resolveSignInHost(DID)).toEqual({ host: 'bsky.social', pds: PDS });

    const odd = resolver({ 'oauth-protected-resource': json({ authorization_servers: [42] }) });
    expect(await odd.resolveSignInHost(DID)).toEqual({ host: 'bsky.social', pds: PDS });
  });

  it('is unknown, not an error, when the DID document can’t be read or lists no PDS', async () => {
    const gone = resolver({}, { document: new Error('HTTP 404') });
    expect(await gone.resolveSignInHost(DID)).toEqual({ host: null, pds: null });
    expect(gone.fetch).not.toHaveBeenCalled();

    const bare = resolver({}, { document: { id: DID, service: [] } });
    expect(await bare.resolveSignInHost(DID)).toEqual({ host: null, pds: null });
  });

  it('stops when the lookup is cancelled', async () => {
    const controller = new AbortController();
    const { resolveSignInHost } = resolver({
      'oauth-protected-resource': () => {
        controller.abort();
        return new TypeError('aborted');
      },
    });
    await expect(resolveSignInHost(DID, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('who a handle belongs to', () => {
  it('is the public profile, with where it signs in', async () => {
    const { resolveSignInIdentity, fetch } = resolver({ getProfile: json(PROFILE), 'oauth-protected-resource': json(PROTECTED) });
    expect(await resolveSignInIdentity('mira.example.com')).toEqual({
      did: DID,
      handle: 'mira.example.com',
      displayName: 'Mira Okafor',
      avatar: 'https://cdn.test/a.jpg',
      host: 'bsky.social',
      pds: PDS,
    });
    expect(fetch.mock.calls[0][0]).toBe(`${APPVIEW}/xrpc/app.bsky.actor.getProfile?actor=mira.example.com`);
  });

  it('falls back to what was typed when the profile’s handle no longer points at it', async () => {
    const { resolveSignInIdentity } = resolver({
      getProfile: json({ did: DID, handle: 'handle.invalid', displayName: '' }),
      'oauth-protected-resource': json(PROTECTED),
    });
    expect(await resolveSignInIdentity('mira.example.com')).toMatchObject({ handle: 'mira.example.com', displayName: null, avatar: null });
  });

  it('still finds an account the AppView hasn’t indexed', async () => {
    const { resolveSignInIdentity, fetch } = resolver({
      getProfile: json({ error: 'InvalidRequest', message: 'Profile not found' }, 400),
      resolveHandle: json({ did: DID }),
      'oauth-protected-resource': json(PROTECTED),
    });
    expect(await resolveSignInIdentity('new.example.com')).toEqual({ did: DID, handle: 'new.example.com', displayName: null, avatar: null, host: 'bsky.social', pds: PDS });
    expect(fetch.mock.calls[1][0]).toBe(`${APPVIEW}/xrpc/com.atproto.identity.resolveHandle?handle=new.example.com`);
  });

  it('says a handle nobody has is not found', async () => {
    const { resolveSignInIdentity } = resolver({
      getProfile: json({ error: 'InvalidRequest', message: 'Profile not found' }, 400),
      resolveHandle: json({ error: 'InvalidRequest', message: 'Unable to resolve handle' }, 400),
    });
    const error = await resolveSignInIdentity('nobody.example.com').catch((e) => e);
    expect(error).toBeInstanceOf(IdentityNotFoundError);
    expect(error.input).toBe('nobody.example.com');
  });

  it('says a lookup that couldn’t be made is that, not a missing account', async () => {
    const offline = resolver({ getProfile: new TypeError('Failed to fetch'), resolveHandle: new TypeError('Failed to fetch') });
    await expect(offline.resolveSignInIdentity('mira.example.com')).rejects.toBeInstanceOf(IdentityLookupError);

    const down = resolver({ getProfile: json({}, 502), resolveHandle: json({}, 503) });
    await expect(down.resolveSignInIdentity('mira.example.com')).rejects.toBeInstanceOf(IdentityLookupError);

    const busy = resolver({ getProfile: json({}, 429), resolveHandle: json({}, 429) });
    await expect(busy.resolveSignInIdentity('mira.example.com')).rejects.toBeInstanceOf(IdentityLookupError);
  });

  it('finds an account by its DID, with the handle its document claims', async () => {
    const { resolveSignInIdentity, getDidDocument } = resolver({
      getProfile: json({ error: 'InvalidRequest', message: 'Profile not found' }, 400),
      'oauth-protected-resource': json(PROTECTED),
    });
    expect(await resolveSignInIdentity(DID)).toEqual({ did: DID, handle: 'mira.example.com', displayName: null, avatar: null, host: 'bsky.social', pds: PDS });
    // Read once: the host lookup uses the same document.
    expect(getDidDocument).toHaveBeenCalledTimes(1);
  });

  it('doesn’t show a DID as a handle when the profile has no usable one', async () => {
    const { resolveSignInIdentity } = resolver({
      getProfile: json({ did: DID, handle: 'handle.invalid' }),
      'oauth-protected-resource': json(PROTECTED),
    });
    expect((await resolveSignInIdentity(DID)).handle).toBeNull();
  });

  it('says a DID the directory has never heard of is not found', async () => {
    const { resolveSignInIdentity } = resolver(
      { getProfile: json({}, 400) },
      { document: Object.assign(new Error('HTTP 404'), { status: 404 }) },
    );
    await expect(resolveSignInIdentity(DID)).rejects.toBeInstanceOf(IdentityNotFoundError);

    const down = resolver({ getProfile: json({}, 400) }, { document: Object.assign(new Error('HTTP 503'), { status: 503 }) });
    await expect(down.resolveSignInIdentity(DID)).rejects.toBeInstanceOf(IdentityLookupError);
  });

  it('never fails for want of a host', async () => {
    const { resolveSignInIdentity } = resolver({ getProfile: json(PROFILE) }, { document: new Error('directory down') });
    expect(await resolveSignInIdentity('mira.example.com')).toMatchObject({ did: DID, host: null, pds: null });
  });

  it('stops, as a cancel, when the reader gives up', async () => {
    const controller = new AbortController();
    const { resolveSignInIdentity } = resolver({
      getProfile: () => {
        controller.abort();
        return new TypeError('aborted');
      },
    });
    await expect(resolveSignInIdentity('mira.example.com', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
