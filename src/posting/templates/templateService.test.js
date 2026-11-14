/**
 * Post template records (net.anisota.feed.template). The defects pinned here
 * are quiet in the UI:
 *  - a create that reads `res.uri` instead of `res.data.uri` files the
 *    template under an empty rkey, so its first edit writes a second record;
 *  - an update that restamps createdAt reorders the library;
 *  - a remove that throws on RecordNotFound strands a template that is
 *    already gone, and one that swallows a real failure hides a template that
 *    is still public;
 *  - a load per composer turns a page of composers into a page of requests;
 *  - a load or write that lands after a reset refills memory;
 *  - a load that was reading while a write landed puts its older pages back
 *    over the write, and then marks them confirmed, so nothing reads again;
 *  - a record over the lexicon's limits is stored anyway, because a PDS
 *    can't check a lexicon it doesn't have;
 *  - one account's templates show in another's composer.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  TEMPLATE_PERMISSION_MESSAGE,
  createTemplateService,
  isPermissionError,
  isRecordNotFound,
  templatesCacheKey,
} from './templateService.js';
import { TEMPLATE_COLLECTION } from './postTemplates.js';
import { TEMPLATES_CHANGED_EVENT } from '../events.js';

const DID = 'did:plc:bob';
const OTHER = 'did:plc:carol';

const uriFor = (rkey, did = DID) =>
  `at://${did}/${TEMPLATE_COLLECTION}/${rkey}`;

const value = (fields) => ({
  $type: TEMPLATE_COLLECTION,
  text: '',
  createdAt: '2026-09-01T00:00:00.000Z',
  ...fields,
});

const entry = (rkey, fields, did = DID) => ({
  uri: uriFor(rkey, did),
  cid: `cid-${rkey}`,
  value: value(fields),
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function memoryStore() {
  const data = new Map();
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    clear: () => data.clear(),
  };
}

let minted = 0;

/** An account whose repo calls are stubs the test can inspect. */
function makeAccount({ did = DID, records = [], ...handlers } = {}) {
  const repo = {
    listRecords:
      handlers.listRecords ||
      vi.fn(async () => ({ data: { records, cursor: undefined } })),
    // The top-level uri is a decoy: the XRPC response body is under `data`.
    createRecord:
      handlers.createRecord ||
      vi.fn(async ({ repo: r, collection }) => {
        minted += 1;
        return {
          uri: 'at://decoy/decoy/decoy',
          data: {
            uri: `at://${r}/${collection}/3lnew${minted}`,
            cid: `bafynew${minted}`,
          },
        };
      }),
    putRecord:
      handlers.putRecord ||
      vi.fn(async ({ repo: r, collection, rkey }) => ({
        data: {
          uri: `at://${r}/${collection}/${rkey}`,
          cid: `bafyput-${rkey}`,
        },
      })),
    deleteRecord: handlers.deleteRecord || vi.fn(async () => ({ data: {} })),
  };
  return { did, agent: { did, com: { atproto: { repo } } }, repo };
}

function recordNotFound() {
  const error = new Error('Could not locate record');
  error.error = 'RecordNotFound';
  return error;
}

const names = (templates) => templates.map((t) => t.name);

let store;
let target;
let service;

beforeEach(() => {
  store = memoryStore();
  target = new EventTarget();
  service = createTemplateService({ store, target });
  minted = 0;
});

describe('templateService.load', () => {
  it('pages listRecords to the end, a hundred at a time, and normalizes what it finds', async () => {
    const listRecords = vi.fn(async ({ cursor }) =>
      cursor
        ? {
            data: {
              records: [
                entry('3lb', { name: 'Second page', shortcut: '/Two' }),
              ],
              cursor: undefined,
            },
          }
        : {
            data: {
              records: [
                entry('3la', {
                  name: 'First page',
                  text: 'Hi {{their.firstName}}',
                  use: 'someday',
                }),
                { uri: uriFor('3lbroken'), value: null },
              ],
              cursor: 'page-2',
            },
          },
    );
    const account = makeAccount({ listRecords });

    const templates = await service.load(account);

    expect(listRecords).toHaveBeenCalledTimes(2);
    expect(listRecords.mock.calls[0][0]).toEqual({
      repo: DID,
      collection: TEMPLATE_COLLECTION,
      limit: 100,
      cursor: undefined,
    });
    expect(listRecords.mock.calls[1][0]).toMatchObject({
      cursor: 'page-2',
      limit: 100,
    });
    expect(names(templates)).toEqual(['First page', 'Second page']);
    const [first, second] = templates;
    expect(first).toMatchObject({
      uri: uriFor('3la'),
      cid: 'cid-3la',
      rkey: '3la',
      use: 'any',
      keywords: [],
      variables: [],
    });
    expect(second.shortcut).toBe('two');
    expect(service.isLoaded(DID)).toBe(true);
  });

  it('takes an agent getter, as the session’s agentFor is', async () => {
    const { agent } = makeAccount({
      records: [entry('3la', { name: 'Fetched' })],
    });
    const getAgent = vi.fn(async () => agent);
    expect(names(await service.load({ did: DID, agent: getAgent }))).toEqual([
      'Fetched',
    ]);
    expect(getAgent).toHaveBeenCalledWith(DID);
  });

  it('refuses an agent signed in as another account', async () => {
    const { agent } = makeAccount({ did: OTHER });
    await expect(service.load({ did: DID, agent })).rejects.toThrow(
      /isn’t the one signed in/,
    );
    expect(agent.com.atproto.repo.listRecords).not.toHaveBeenCalled();
  });

  it('stops when a PDS hands back the cursor it was given', async () => {
    const listRecords = vi.fn(async () => ({
      data: { records: [entry('3la', { name: 'Loop' })], cursor: 'same' },
    }));
    const templates = await service.load(makeAccount({ listRecords }));
    expect(listRecords).toHaveBeenCalledTimes(2);
    expect(names(templates)).toEqual(['Loop']);
  });

  it('lists by group, ungrouped last, then by name', async () => {
    const account = makeAccount({
      records: [
        entry('3l1', { name: 'zebra' }),
        entry('3l2', { name: 'Beta', group: 'Support' }),
        entry('3l3', { name: 'alpha', group: 'Support' }),
        entry('3l4', { name: 'Notes', group: 'Field notes' }),
        entry('3l5', { name: 'Apple' }),
      ],
    });
    expect(names(await service.load(account))).toEqual([
      'Notes',
      'alpha',
      'Beta',
      'Apple',
      'zebra',
    ]);
  });

  it('shares a load in flight for the same account, and asks again once it settles', async () => {
    const gate = deferred();
    const listRecords = vi.fn(async () => {
      await gate.promise;
      return {
        data: {
          records: [entry('3la', { name: 'Shared' })],
          cursor: undefined,
        },
      };
    });
    const account = makeAccount({ listRecords });

    const a = service.load(account);
    const b = service.load(account);
    expect(a).toBe(b);
    gate.resolve();
    expect(names(await a)).toEqual(['Shared']);
    expect(names(await b)).toEqual(['Shared']);
    expect(listRecords).toHaveBeenCalledTimes(1);

    await service.load(account);
    expect(listRecords).toHaveBeenCalledTimes(2);
  });

  it('holds each account’s templates apart', async () => {
    const bob = makeAccount({ records: [entry('3la', { name: 'Bob’s' })] });
    const carol = makeAccount({
      did: OTHER,
      records: [entry('3lc', { name: 'Carol’s' }, OTHER)],
    });
    const [fromBob, fromCarol] = await Promise.all([
      service.load(bob),
      service.load(carol),
    ]);
    expect(bob.repo.listRecords).toHaveBeenCalledTimes(1);
    expect(carol.repo.listRecords).toHaveBeenCalledTimes(1);
    expect(names(fromBob)).toEqual(['Bob’s']);
    expect(names(fromCarol)).toEqual(['Carol’s']);
    expect(names(service.list(DID))).toEqual(['Bob’s']);
    expect(names(service.list(OTHER))).toEqual(['Carol’s']);
    expect(service.isLoaded(DID) && service.isLoaded(OTHER)).toBe(true);
  });

  it('writes the cache under the account it read, and keeps it when a later read fails', async () => {
    await service.load(
      makeAccount({ records: [entry('3la', { name: 'Cached' })] }),
    );
    expect(templatesCacheKey(DID)).toBe('virga:templates:did:plc:bob');
    expect(
      JSON.parse(store.getItem(templatesCacheKey(DID)))['3la'].value.name,
    ).toBe('Cached');

    const failing = makeAccount({
      listRecords: vi.fn(async () => {
        throw new Error('network down');
      }),
    });
    const heard = vi.fn();
    const unsubscribe = service.subscribe(heard);
    await expect(service.load(failing)).rejects.toThrow('network down');
    unsubscribe();

    expect(names(service.list(DID))).toEqual(['Cached']);
    expect(heard.mock.calls.at(-1)[0]).toBe(DID);
    expect(names(heard.mock.calls.at(-1)[1])).toEqual(['Cached']);
    expect(
      JSON.parse(store.getItem(templatesCacheKey(DID)))['3la'].value.name,
    ).toBe('Cached');
  });

  it('falls back to the cache when a first read fails', async () => {
    store.setItem(
      templatesCacheKey(DID),
      JSON.stringify({ '3la': entry('3la', { name: 'From before' }) }),
    );
    const failing = makeAccount({
      listRecords: vi.fn(async () => {
        throw new Error('offline');
      }),
    });
    await expect(service.load(failing)).rejects.toThrow('offline');
    expect(names(service.list(DID))).toEqual(['From before']);
    expect(service.isLoaded(DID)).toBe(false);
  });

  it('reads nothing without an account', async () => {
    expect(await service.load(null)).toEqual([]);
    expect(await service.load({ did: DID })).toEqual([]);
    expect(service.list(null)).toEqual([]);
  });
});

describe('templateService.primeFromCache', () => {
  it('fills an empty memory from this account’s cache, and never serves another’s', () => {
    store.setItem(
      templatesCacheKey(DID),
      JSON.stringify({ '3la': entry('3la', { name: 'Bob’s' }) }),
    );
    expect(names(service.primeFromCache(DID))).toEqual(['Bob’s']);
    expect(names(service.list(DID))).toEqual(['Bob’s']);
    expect(service.primeFromCache(OTHER)).toEqual([]);
    expect(names(service.primeFromCache(DID))).toEqual(['Bob’s']);
  });

  it('reads past a corrupt cache and entries that don’t match their key', () => {
    store.setItem(templatesCacheKey(DID), '{not json');
    expect(service.primeFromCache(DID)).toEqual([]);
    service.reset();
    store.setItem(
      templatesCacheKey(DID),
      JSON.stringify({
        '3la': entry('3la', { name: 'Kept' }),
        '3lb': entry('3lother', { name: 'Misfiled' }),
        '3lc': { uri: uriFor('3lc'), value: 'nope' },
      }),
    );
    expect(names(service.primeFromCache(DID))).toEqual(['Kept']);
  });

  it('leaves memory alone once a load has confirmed it', async () => {
    await service.load(makeAccount({ records: [] }));
    store.setItem(
      templatesCacheKey(DID),
      JSON.stringify({ '3la': entry('3la', { name: 'Elsewhere' }) }),
    );
    expect(service.primeFromCache(DID)).toEqual([]);
  });
});

describe('templateService.create', () => {
  it('writes with createRecord, lets the PDS mint the key, and reads the answer from res.data', async () => {
    const account = makeAccount();
    const heard = vi.fn();
    const unsubscribe = service.subscribe(heard);
    const events = [];
    target.addEventListener(TEMPLATES_CHANGED_EVENT, (e) =>
      events.push(e.detail),
    );
    try {
      const created = await service.create(
        {
          name: 'Is there an app?',
          text: 'Not yet, {{their.firstName}}.',
          shortcut: '/App',
        },
        account,
      );

      expect(account.repo.createRecord).toHaveBeenCalledTimes(1);
      const call = account.repo.createRecord.mock.calls[0][0];
      expect(call).not.toHaveProperty('rkey');
      expect(call).toMatchObject({
        repo: DID,
        collection: TEMPLATE_COLLECTION,
      });
      expect(call.record).toMatchObject({
        $type: TEMPLATE_COLLECTION,
        name: 'Is there an app?',
        shortcut: 'app',
        use: 'any',
      });
      expect(typeof call.record.createdAt).toBe('string');
      expect(call.record).not.toHaveProperty('updatedAt');

      expect(created).toMatchObject({
        uri: uriFor('3lnew1'),
        cid: 'bafynew1',
        rkey: '3lnew1',
        name: 'Is there an app?',
      });
      expect(names(service.list(DID))).toEqual(['Is there an app?']);
      expect(names(heard.mock.calls.at(-1)[1])).toEqual(['Is there an app?']);
      expect(events.at(-1)).toMatchObject({ did: DID });
      expect(names(events.at(-1).templates)).toEqual(['Is there an app?']);
      expect(JSON.parse(store.getItem(templatesCacheKey(DID)))).toHaveProperty(
        '3lnew1',
      );
    } finally {
      unsubscribe();
    }
  });

  it('adds to the cached templates rather than replacing them', async () => {
    store.setItem(
      templatesCacheKey(DID),
      JSON.stringify({ '3la': entry('3la', { name: 'Older' }) }),
    );
    await service.create({ name: 'Newer', text: 'Hello' }, makeAccount());
    expect(names(service.list(DID))).toEqual(['Newer', 'Older']);
    expect(
      Object.keys(JSON.parse(store.getItem(templatesCacheKey(DID)))).sort(),
    ).toEqual(['3la', '3lnew1']);
  });

  it('refuses a template that doesn’t validate before any request, with the problems on fieldErrors', async () => {
    const account = makeAccount();
    const error = await service
      .create({ name: '  ', text: '' }, account)
      .catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error.fieldErrors).toMatchObject({
      name: expect.any(String),
      text: expect.any(String),
    });
    expect(error.message).toBe(error.fieldErrors.name);
    expect(account.repo.createRecord).not.toHaveBeenCalled();
  });

  it('checks a shortcut against the account’s other templates, and only that account’s', async () => {
    const account = makeAccount({
      records: [entry('3la', { name: 'Hello', text: 'Hi', shortcut: 'hi' })],
    });
    await service.load(account);
    const error = await service
      .create({ name: 'Another', text: 'Hey', shortcut: '/hi' }, account)
      .catch((e) => e);
    expect(error.fieldErrors.shortcut).toMatch(/already opens “Hello”/);
    expect(account.repo.createRecord).not.toHaveBeenCalled();

    await expect(
      service.create(
        { name: 'Carol’s', text: 'Hey', shortcut: '/hi' },
        makeAccount({ did: OTHER }),
      ),
    ).resolves.toMatchObject({ shortcut: 'hi' });
  });

  it('says what to do about a refused permission, and passes other failures through', async () => {
    const scope = makeAccount({
      createRecord: vi.fn(async () => {
        const error = new Error(
          'Missing required scope "repo:net.anisota.feed.template"',
        );
        error.error = 'ScopeMissingError';
        throw error;
      }),
    });
    const refused = await service
      .create({ name: 'A', text: 'B' }, scope)
      .catch((e) => e);
    expect(refused.message).toBe(TEMPLATE_PERMISSION_MESSAGE);
    expect(refused.permission).toBe(true);

    const down = makeAccount({
      createRecord: vi.fn(async () => {
        throw new Error('socket hang up');
      }),
    });
    const failed = await service
      .create({ name: 'A', text: 'B' }, down)
      .catch((e) => e);
    expect(failed.message).toBe('socket hang up');
    expect(failed.permission).toBeUndefined();
    expect(service.list(DID)).toEqual([]);
  });

  it('answers a frozen or non-Error refusal with a fresh error', async () => {
    const frozen = makeAccount({
      createRecord: vi.fn(async () => {
        throw Object.freeze(new Error('Forbidden'));
      }),
    });
    const a = await service
      .create({ name: 'A', text: 'B' }, frozen)
      .catch((e) => e);
    expect(a.message).toBe(TEMPLATE_PERMISSION_MESSAGE);
    expect(a.permission).toBe(true);

    const plain = makeAccount({
      createRecord: vi.fn(async () => {
        throw { error: 'Unauthorized' };
      }),
    });
    const b = await service
      .create({ name: 'A', text: 'B' }, plain)
      .catch((e) => e);
    expect(b).toBeInstanceOf(Error);
    expect(b.message).toBe(TEMPLATE_PERMISSION_MESSAGE);
    expect(b.cause).toEqual({ error: 'Unauthorized' });
  });

  it('needs an account', async () => {
    await expect(
      service.create({ name: 'A', text: 'B' }, null),
    ).rejects.toThrow('Not signed in');
  });
});

describe('templateService.update', () => {
  it('puts the record back on the same rkey, keeping its createdAt and stamping updatedAt', async () => {
    const account = makeAccount({
      records: [
        entry('3la', {
          name: 'Old name',
          text: 'Hi',
          shortcut: 'hi',
          createdAt: '2026-01-01T00:00:00.000Z',
        }),
      ],
    });
    const [loaded] = await service.load(account);

    const saved = await service.update(
      '3la',
      { ...loaded, name: 'New name', createdAt: null },
      account,
    );

    expect(account.repo.putRecord).toHaveBeenCalledTimes(1);
    const call = account.repo.putRecord.mock.calls[0][0];
    expect(call).toMatchObject({
      repo: DID,
      collection: TEMPLATE_COLLECTION,
      rkey: '3la',
    });
    expect(call.record.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(typeof call.record.updatedAt).toBe('string');
    expect(call.record.name).toBe('New name');
    // Its own shortcut is not a clash.
    expect(call.record.shortcut).toBe('hi');
    expect(saved).toMatchObject({
      rkey: '3la',
      uri: uriFor('3la'),
      cid: 'bafyput-3la',
      name: 'New name',
    });
    expect(names(service.list(DID))).toEqual(['New name']);
  });

  it('keeps the createdAt the edit carries when the record isn’t held locally', async () => {
    const account = makeAccount();
    await service.update(
      '3lz',
      { name: 'Elsewhere', text: 'Hi', createdAt: '2025-12-25T00:00:00.000Z' },
      account,
    );
    expect(account.repo.putRecord.mock.calls[0][0].record.createdAt).toBe(
      '2025-12-25T00:00:00.000Z',
    );
    expect(service.list(DID)[0].uri).toBe(uriFor('3lz'));
  });

  it('validates first, and refuses a key that isn’t a record key', async () => {
    const account = makeAccount();
    const error = await service
      .update('3la', { name: '', text: 'x' }, account)
      .catch((e) => e);
    expect(error.fieldErrors.name).toBeTruthy();
    await expect(
      service.update('../3la', { name: 'A', text: 'B' }, account),
    ).rejects.toThrow('Template not found');
    expect(account.repo.putRecord).not.toHaveBeenCalled();
  });

  it('says what to do about a refused permission', async () => {
    const account = makeAccount({
      putRecord: vi.fn(async () => {
        throw new Error('403 Forbidden');
      }),
    });
    const error = await service
      .update('3la', { name: 'A', text: 'B' }, account)
      .catch((e) => e);
    expect(error.message).toBe(TEMPLATE_PERMISSION_MESSAGE);
    expect(error.permission).toBe(true);
  });
});

describe('templateService.remove', () => {
  it('deletes the record and drops it locally', async () => {
    const account = makeAccount({
      records: [
        entry('3la', { name: 'Going' }),
        entry('3lb', { name: 'Staying' }),
      ],
    });
    await service.load(account);
    await service.remove('3la', account);
    expect(account.repo.deleteRecord).toHaveBeenCalledWith({
      repo: DID,
      collection: TEMPLATE_COLLECTION,
      rkey: '3la',
    });
    expect(names(service.list(DID))).toEqual(['Staying']);
    expect(
      Object.keys(JSON.parse(store.getItem(templatesCacheKey(DID)))),
    ).toEqual(['3lb']);
  });

  it('counts a record already gone as deleted', async () => {
    const account = makeAccount({
      records: [entry('3la', { name: 'Ghost' })],
      deleteRecord: vi.fn(async () => {
        throw recordNotFound();
      }),
    });
    await service.load(account);
    await expect(service.remove('3la', account)).resolves.toBeUndefined();
    expect(service.list(DID)).toEqual([]);
  });

  it('rethrows any other failure and keeps the template', async () => {
    const account = makeAccount({
      records: [entry('3la', { name: 'Still public' })],
      deleteRecord: vi.fn(async () => {
        throw new Error('502 Bad Gateway');
      }),
    });
    await service.load(account);
    await expect(service.remove('3la', account)).rejects.toThrow(
      '502 Bad Gateway',
    );
    expect(names(service.list(DID))).toEqual(['Still public']);
  });

  it('says what to do about a refused permission', async () => {
    const account = makeAccount({
      deleteRecord: vi.fn(async () => {
        throw new Error('Not authorized for this collection');
      }),
    });
    const error = await service.remove('3la', account).catch((e) => e);
    expect(error.message).toBe(TEMPLATE_PERMISSION_MESSAGE);
    expect(error.permission).toBe(true);
  });
});

describe('templateService writes while a load is in flight', () => {
  // A load whose single page is read now but answered when the test says.
  function slowLoad(records) {
    const gate = deferred();
    const listRecords = vi.fn(async () => {
      const snapshot = { data: { records, cursor: undefined } };
      await gate.promise;
      return snapshot;
    });
    return { gate, listRecords };
  }

  it('keeps a template created while the pages came in', async () => {
    const { gate, listRecords } = slowLoad([entry('3la', { name: 'Older' })]);
    const account = makeAccount({ listRecords });
    const pending = service.load(account);
    await service.create({ name: 'Made meanwhile', text: 'Hello' }, account);
    gate.resolve();

    expect(names(await pending)).toEqual(['Made meanwhile', 'Older']);
    expect(service.isLoaded(DID)).toBe(true);
    expect(
      Object.keys(JSON.parse(store.getItem(templatesCacheKey(DID)))).sort(),
    ).toEqual(['3la', '3lnew1']);
  });

  it('keeps a template deleted while the pages came in deleted', async () => {
    const records = [
      entry('3la', { name: 'Going' }),
      entry('3lb', { name: 'Staying' }),
    ];
    await service.load(makeAccount({ records }));
    const { gate, listRecords } = slowLoad(records);
    const account = makeAccount({ listRecords });

    const pending = service.load(account);
    await service.remove('3la', account);
    gate.resolve();

    expect(names(await pending)).toEqual(['Staying']);
    expect(
      Object.keys(JSON.parse(store.getItem(templatesCacheKey(DID)))),
    ).toEqual(['3lb']);
  });

  it('keeps the edit made while the pages came in, not the version they read', async () => {
    const records = [entry('3la', { name: 'Before', text: 'Hi' })];
    await service.load(makeAccount({ records }));
    const { gate, listRecords } = slowLoad(records);
    const account = makeAccount({ listRecords });

    const pending = service.load(account);
    await service.update(
      '3la',
      { ...service.list(DID)[0], name: 'After' },
      account,
    );
    gate.resolve();

    const [loaded] = await pending;
    expect(loaded).toMatchObject({
      rkey: '3la',
      name: 'After',
      cid: 'bafyput-3la',
    });
  });

  it('takes the next load’s word over a write made before it began', async () => {
    const account = makeAccount({ records: [] });
    await service.load(account);
    await service.create({ name: 'Deleted elsewhere', text: 'Hi' }, account);
    expect(names(service.list(DID))).toEqual(['Deleted elsewhere']);

    // Removed on another device; this load began after the write, so it knows.
    await service.load(account);
    expect(service.list(DID)).toEqual([]);
  });

  it('forgets the writes of a load the reset discarded', async () => {
    const { gate, listRecords } = slowLoad([]);
    const account = makeAccount({ listRecords });
    const pending = service.load(account);
    await service.create({ name: 'Before the reset', text: 'Hi' }, account);
    service.reset();
    store.clear();
    gate.resolve();

    expect(await pending).toEqual([]);
    expect(service.list(DID)).toEqual([]);
    expect(store.getItem(templatesCacheKey(DID))).toBeNull();
  });
});

describe('templateService lexicon limits', () => {
  const long = (n, unit = 'a') => unit.repeat(n);
  // One grapheme, 25 UTF-8 bytes.
  const FAMILY = '\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}';

  async function refused(template) {
    const account = makeAccount();
    const error = await service.create(template, account).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect(account.repo.createRecord).not.toHaveBeenCalled();
    return error.fieldErrors;
  }

  it('refuses a blank’s question over 64 characters', async () => {
    const fieldErrors = await refused({
      name: 'Ask',
      text: 'Thanks for {{idea}}',
      variables: [{ key: 'idea', label: long(65) }],
    });
    expect(fieldErrors.variables).toBe(
      'Keep the question for “idea” under 64 characters.',
    );
  });

  it('refuses a question within 64 characters but over the lexicon’s 640 bytes', async () => {
    const fieldErrors = await refused({
      name: 'Ask',
      text: 'Thanks for {{idea}}',
      variables: [{ key: 'idea', label: long(30, FAMILY) }],
    });
    expect(fieldErrors.variables).toMatch(/question for “idea”/);
  });

  it('refuses a hint over 200 characters and a choice over 300', async () => {
    expect(
      (
        await refused({
          name: 'Ask',
          text: 'Which {{device}}?',
          variables: [{ key: 'device', hint: long(201) }],
        })
      ).variables,
    ).toBe('Keep the hint for “device” under 200 characters.');
    expect(
      (
        await refused({
          name: 'Ask',
          text: 'Which {{device}}?',
          variables: [
            { key: 'device', kind: 'choice', choices: ['Phone', long(301)] },
          ],
        })
      ).variables,
    ).toBe('Keep each choice for “device” under 300 characters.');
  });

  it('reports a missing choice before a long one, as the editor expects', async () => {
    const fieldErrors = await refused({
      name: 'Ask',
      text: '{{a}} and {{b}}',
      variables: [
        { key: 'a', label: long(65) },
        { key: 'b', kind: 'choice', choices: [] },
      ],
    });
    expect(fieldErrors.variables).toBe('Add at least one choice for “b”.');
  });

  it('measures keywords in UTF-8 bytes, as written', async () => {
    // Forty code units, eighty bytes.
    expect(
      (await refused({ name: 'Ask', text: 'Hi', keywords: [long(40, 'é')] }))
        .keywords,
    ).toBe('One of the words is too long.');
    // Thirty code units and sixty bytes, but ninety once lower-cased.
    expect(
      (await refused({ name: 'Ask', text: 'Hi', keywords: [long(30, 'İ')] }))
        .keywords,
    ).toBe('One of the words is too long.');
  });

  it('refuses a name within 64 characters but over 640 bytes', async () => {
    expect((await refused({ name: long(30, FAMILY), text: 'Hi' })).name).toBe(
      'The name is too long to save.',
    );
  });

  it('cuts a pre-filled answer to 300 characters, since the editor has no field for it', async () => {
    const account = makeAccount();
    await service.create(
      {
        name: 'Ask',
        text: 'Which {{device}}?',
        variables: [{ key: 'device', default: long(320) }],
      },
      account,
    );
    const [variable] =
      account.repo.createRecord.mock.calls[0][0].record.variables;
    expect(variable.default).toBe(long(300));
  });

  it('ignores a long question for a blank the text no longer has, since it isn’t written', async () => {
    const account = makeAccount();
    await service.create(
      {
        name: 'Ask',
        text: 'No blanks now',
        variables: [{ key: 'gone', label: long(90) }],
      },
      account,
    );
    expect(account.repo.createRecord).toHaveBeenCalledTimes(1);
    expect(
      account.repo.createRecord.mock.calls[0][0].record,
    ).not.toHaveProperty('variables');
  });

  it('holds an edit to the same limits', async () => {
    const account = makeAccount();
    const error = await service
      .update(
        '3la',
        {
          name: 'Ask',
          text: 'Thanks for {{idea}}',
          variables: [{ key: 'idea', label: long(65) }],
        },
        account,
      )
      .catch((e) => e);
    expect(error.fieldErrors.variables).toMatch(/question for “idea”/);
    expect(account.repo.putRecord).not.toHaveBeenCalled();
  });
});

describe('templateService.reset and subscribe', () => {
  it('forgets the templates in memory and tells the readers', async () => {
    await service.load(
      makeAccount({ records: [entry('3la', { name: 'Bob’s' })] }),
    );
    const heard = vi.fn();
    const unsubscribe = service.subscribe(heard);
    service.reset();
    expect(service.list(DID)).toEqual([]);
    expect(service.isLoaded(DID)).toBe(false);
    expect(heard).toHaveBeenCalledWith(DID, []);
    unsubscribe();
    service.reset();
    expect(heard).toHaveBeenCalledTimes(1);
    expect(service.subscribe('not a function')()).toBeUndefined();
  });

  it('can forget one account and leave another’s load alone', async () => {
    const gate = deferred();
    const carol = makeAccount({
      did: OTHER,
      listRecords: vi.fn(async () => {
        await gate.promise;
        return {
          data: {
            records: [entry('3lc', { name: 'Carol’s' }, OTHER)],
            cursor: undefined,
          },
        };
      }),
    });
    await service.load(
      makeAccount({ records: [entry('3la', { name: 'Bob’s' })] }),
    );
    const pending = service.load(carol);
    service.reset(DID);
    gate.resolve();
    expect(names(await pending)).toEqual(['Carol’s']);
    expect(service.list(DID)).toEqual([]);
    expect(service.isLoaded(OTHER)).toBe(true);
  });

  it('keeps a load that started before the reset from refilling memory', async () => {
    const gate = deferred();
    const account = makeAccount({
      listRecords: vi.fn(async () => {
        await gate.promise;
        return {
          data: {
            records: [entry('3la', { name: 'Before' })],
            cursor: undefined,
          },
        };
      }),
    });
    const pending = service.load(account);
    service.reset();
    store.clear();
    gate.resolve();
    expect(await pending).toEqual([]);
    expect(service.list(DID)).toEqual([]);
    expect(store.getItem(templatesCacheKey(DID))).toBeNull();
    // The next load is a new request, not the discarded one.
    await service.load(account);
    expect(account.repo.listRecords).toHaveBeenCalledTimes(2);
  });

  it('keeps a write that lands after the reset out of memory and the cache', async () => {
    const gate = deferred();
    const account = makeAccount({
      createRecord: vi.fn(async () => {
        await gate.promise;
        return { data: { uri: uriFor('3llate'), cid: 'bafylate' } };
      }),
    });
    const pending = service.create({ name: 'Late', text: 'x' }, account);
    // The write waits on its agent first.
    await Promise.resolve();
    service.reset();
    store.clear();
    gate.resolve();
    expect((await pending).rkey).toBe('3llate');
    expect(service.list(DID)).toEqual([]);
    expect(store.getItem(templatesCacheKey(DID))).toBeNull();
  });

  it('keeps telling the rest when one reader throws', async () => {
    const after = vi.fn();
    const offA = service.subscribe(() => {
      throw new Error('one reader broke');
    });
    const offB = service.subscribe(after);
    await service.create({ name: 'A', text: 'B' }, makeAccount());
    expect(after).toHaveBeenCalled();
    offA();
    offB();
  });
});

describe('error helpers', () => {
  it('tell a missing record from any other failure', () => {
    expect(isRecordNotFound(recordNotFound())).toBe(true);
    expect(isRecordNotFound({ code: 'RecordNotFound' })).toBe(true);
    expect(isRecordNotFound(new Error('record not found'))).toBe(true);
    expect(isRecordNotFound(new Error('502'))).toBe(false);
    expect(isRecordNotFound(null)).toBe(false);
  });

  it('tell a refused permission from any other failure', () => {
    expect(isPermissionError({ error: 'ScopeMissingError' })).toBe(true);
    expect(isPermissionError(new Error('Forbidden'))).toBe(true);
    expect(isPermissionError(new Error('socket hang up'))).toBe(false);
  });
});
