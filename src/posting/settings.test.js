import { describe, expect, it, vi } from 'vitest';
import {
  POSTING_SETTING_KEYS,
  baseLanguage,
  defaultPostingSettings,
  postingSettingsKey,
  readPostingSettings,
  resolveDefaultGates,
  writePostingSettings,
} from './settings.js';
import { POSTING_SETTINGS_EVENT, onPostingEvent } from './events.js';
import {
  DEFAULT_ADVISER_SETTINGS,
  normalizeAdviserSettings,
} from './adviser/setup.js';
import { normalizeTimer } from './timers/selfDestruct.js';
import { DEFAULT_POSTING_QUEUE } from './schedule/postingQueue.js';

const DID = 'did:plc:alice';
const OTHER = 'did:plc:bob';

function memoryStore(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

describe('posting settings defaults', () => {
  it('start from the browser language, or English', () => {
    expect(defaultPostingSettings({ language: 'pt-BR' }).langs).toEqual(['pt']);
    expect(defaultPostingSettings({ language: 'en_GB' }).langs).toEqual(['en']);
    expect(defaultPostingSettings({ language: '' }).langs).toEqual(['en']);
    expect(baseLanguage('Klingon-ish')).toBeNull();
  });

  it('hold every key, with the queue on weekday mornings and evenings', () => {
    const d = defaultPostingSettings({ language: 'en' });
    expect(Object.keys(d).sort()).toEqual([...POSTING_SETTING_KEYS].sort());
    expect(d).toMatchObject({
      gates: null,
      defaultAction: 'post',
      requireAltText: false,
      showThreadSuggestion: true,
      suggestBestTimes: true,
      adviser: { enabled: false },
    });
    expect(d.queue.timezone).toBe('');
    expect(d.queue.slots.mon).toEqual(['09:00', '17:00']);
    expect(d.queue.slots.sun).toEqual([]);
    expect(d.queue).toEqual({
      timezone: DEFAULT_POSTING_QUEUE.timezone,
      slots: { ...DEFAULT_POSTING_QUEUE.slots },
    });
    expect(d.lifespan).toMatchObject({
      enabled: false,
      deleteAt: null,
      lifespanSeconds: 86400,
    });
  });

  it('start with no default timer, a day long, and the adviser off', () => {
    const d = defaultPostingSettings({ language: 'en' });
    expect(d.lifespan).toEqual({
      ...normalizeTimer({ enabled: false, lifespanSeconds: 86400 }),
      deleteAt: null,
    });
    expect(d.adviser).toEqual(
      normalizeAdviserSettings(DEFAULT_ADVISER_SETTINGS),
    );
    expect(d.adviser.enabled).toBe(false);
  });

  it('hand out a queue the caller may edit without editing everyone’s', () => {
    const d = defaultPostingSettings({ language: 'en' });
    d.queue.slots.mon.push('12:00');
    expect(defaultPostingSettings({ language: 'en' }).queue.slots.mon).toEqual([
      '09:00',
      '17:00',
    ]);
    expect(DEFAULT_POSTING_QUEUE.slots.mon).toEqual(['09:00', '17:00']);
  });
});

describe('readPostingSettings', () => {
  it('reads each account under its own key', () => {
    const store = memoryStore({
      [postingSettingsKey(DID)]: JSON.stringify({ defaultAction: 'queue' }),
    });
    expect(postingSettingsKey(DID)).toBe('virga:posting:did:plc:alice');
    expect(readPostingSettings(DID, store).defaultAction).toBe('queue');
    expect(readPostingSettings(OTHER, store).defaultAction).toBe('post');
  });

  it('keeps what passes and defaults what doesn’t, key by key', () => {
    const store = memoryStore({
      [postingSettingsKey(DID)]: JSON.stringify({
        langs: ['en', 'not a tag'],
        requireAltText: true,
        defaultAction: 'shout',
        queue: { timezone: 'Mars/Olympus', slots: {} },
        extra: 1,
      }),
    });
    const s = readPostingSettings(DID, store, { language: 'fr' });
    expect(s.requireAltText).toBe(true);
    expect(s.langs).toEqual(['fr']);
    expect(s.defaultAction).toBe('post');
    expect(s.queue.slots.mon).toEqual(['09:00', '17:00']);
    expect(s).not.toHaveProperty('extra');
  });

  it('survives a corrupt entry and a missing store', () => {
    const store = memoryStore({ [postingSettingsKey(DID)]: '{nope' });
    expect(readPostingSettings(DID, store, { language: 'en' })).toEqual(
      defaultPostingSettings({ language: 'en' }),
    );
    expect(
      readPostingSettings(DID, null, { language: 'en' }).defaultAction,
    ).toBe('post');
  });

  it('never reads a pinned delete time into the default lifespan', () => {
    const store = memoryStore({
      [postingSettingsKey(DID)]: JSON.stringify({
        lifespan: {
          enabled: true,
          deleteAt: '2026-12-01T00:00:00.000Z',
          lifespanSeconds: 3600,
        },
      }),
    });
    expect(readPostingSettings(DID, store).lifespan).toMatchObject({
      enabled: true,
      deleteAt: null,
      lifespanSeconds: 3600,
    });
  });

  it('passes the adviser through its normalizer', () => {
    const stored = { enabled: true, reviewMode: 'always', junk: true };
    const store = memoryStore({
      [postingSettingsKey(DID)]: JSON.stringify({ adviser: stored }),
    });
    const { adviser } = readPostingSettings(DID, store);
    expect(adviser).toEqual(normalizeAdviserSettings(stored));
    expect(adviser).toMatchObject({
      enabled: true,
      reviewMode: 'always',
      checkBeforePublish: false,
    });
    expect(adviser).not.toHaveProperty('junk');
  });
});

describe('writePostingSettings', () => {
  it('merges a patch, writes only what was stored or patched, and tells the app', () => {
    const store = memoryStore();
    const target = new EventTarget();
    const heard = vi.fn();
    onPostingEvent(POSTING_SETTINGS_EVENT, heard, { target });

    writePostingSettings(DID, { requireAltText: true }, store, { target });
    const next = writePostingSettings(
      DID,
      { defaultAction: 'draft', unknown: 'x' },
      store,
      { target },
    );

    expect(JSON.parse(store.getItem(postingSettingsKey(DID)))).toEqual({
      requireAltText: true,
      defaultAction: 'draft',
    });
    expect(next).toMatchObject({
      requireAltText: true,
      defaultAction: 'draft',
    });
    expect(heard).toHaveBeenCalledTimes(2);
    expect(heard.mock.calls[1][0]).toMatchObject({
      did: DID,
      settings: { defaultAction: 'draft' },
    });
  });

  it('refuses a value it can’t take before writing anything', () => {
    const store = memoryStore();
    const target = new EventTarget();
    const error = (() => {
      try {
        writePostingSettings(
          DID,
          { requireAltText: true, langs: ['en', 'fr', 'de', 'es'] },
          store,
          { target },
        );
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect(error?.field).toBe('langs');
    expect(store.getItem(postingSettingsKey(DID))).toBeNull();
  });

  it('checks the queue, sorting and deduping each day’s times', () => {
    const store = memoryStore();
    const target = new EventTarget();
    const s = writePostingSettings(
      DID,
      {
        queue: {
          timezone: 'Europe/Paris',
          slots: { mon: ['17:00', '09:00', '09:00'], tue: [] },
        },
      },
      store,
      { target },
    );
    expect(s.queue).toEqual({
      timezone: 'Europe/Paris',
      slots: {
        mon: ['09:00', '17:00'],
        tue: [],
        wed: [],
        thu: [],
        fri: [],
        sat: [],
        sun: [],
      },
    });
    expect(() =>
      writePostingSettings(DID, { queue: { slots: { mon: ['9am'] } } }, store, {
        target,
      }),
    ).toThrow(/time like/);
    expect(() =>
      writePostingSettings(
        DID,
        { queue: { timezone: 'Nowhere/Here', slots: {} } },
        store,
        { target },
      ),
    ).toThrow(/time zone/);
  });

  it('checks reply rules and keeps null as "use my Bluesky setting"', () => {
    const store = memoryStore();
    const target = new EventTarget();
    const list = 'at://did:plc:alice/app.bsky.graph.list/3kx';
    expect(
      writePostingSettings(
        DID,
        {
          gates: {
            reply: [
              { type: 'follower' },
              { type: 'follower' },
              { type: 'list', list },
            ],
            quotes: false,
          },
        },
        store,
        { target },
      ).gates,
    ).toEqual({
      reply: [{ type: 'follower' }, { type: 'list', list }],
      quotes: false,
    });
    expect(
      writePostingSettings(DID, { gates: { reply: [], quotes: true } }, store, {
        target,
      }).gates,
    ).toEqual({ reply: [], quotes: true });
    expect(
      writePostingSettings(DID, { gates: null }, store, { target }).gates,
    ).toBeNull();
    expect(() =>
      writePostingSettings(
        DID,
        { gates: { reply: [{ type: 'everyone' }] } },
        store,
        { target },
      ),
    ).toThrow();
  });

  it('stores the lifespan and adviser as given, if they are objects', () => {
    const store = memoryStore();
    const target = new EventTarget();
    writePostingSettings(
      DID,
      { lifespan: { enabled: true, lifespanSeconds: 600, extra: 'kept' } },
      store,
      { target },
    );
    expect(JSON.parse(store.getItem(postingSettingsKey(DID))).lifespan).toEqual(
      { enabled: true, lifespanSeconds: 600, extra: 'kept' },
    );
    expect(() =>
      writePostingSettings(DID, { adviser: 'on' }, store, { target }),
    ).toThrow();
  });

  it('keeps a default timer as a length, never a pinned time', () => {
    const store = memoryStore();
    const s = writePostingSettings(
      DID,
      {
        lifespan: {
          enabled: true,
          lifespanSeconds: 3600,
          deleteAt: '2026-12-01T00:00:00.000Z',
        },
      },
      store,
      { target: null },
    );
    expect(s.lifespan).toMatchObject({
      enabled: true,
      lifespanSeconds: 3600,
      deleteAt: null,
    });
    expect(readPostingSettings(DID, store).lifespan).toEqual(s.lifespan);
    expect(
      JSON.parse(store.getItem(postingSettingsKey(DID))).lifespan
        .lifespanSeconds,
    ).toBe(3600);
  });

  it('needs an account', () => {
    expect(() =>
      writePostingSettings(null, { requireAltText: true }, memoryStore(), {
        target: null,
      }),
    ).toThrow();
  });
});

describe('resolveDefaultGates', () => {
  it('prefers the account’s posting settings', async () => {
    const read = vi.fn();
    const out = await resolveDefaultGates(
      { gates: { reply: [{ type: 'mention' }], quotes: true } },
      { agent: {}, readDefaultGates: read },
    );
    expect(out).toEqual({
      gates: { custom: false, reply: [{ type: 'mention' }], quotes: true },
      source: 'settings',
      notice: null,
    });
    expect(read).not.toHaveBeenCalled();
  });

  it('then the account’s Bluesky setting', async () => {
    const agent = { did: DID };
    const read = vi.fn(async () => ({ reply: [], quotes: false }));
    const out = await resolveDefaultGates(
      { gates: null },
      { agent, readDefaultGates: read },
    );
    expect(read).toHaveBeenCalledWith(agent);
    expect(out).toMatchObject({
      gates: { custom: false, reply: [], quotes: false },
      source: 'bluesky',
    });
  });

  it('reads the Bluesky setting from the account’s preferences by default', async () => {
    const getPreferences = vi.fn(async () => ({
      data: {
        preferences: [
          {
            $type: 'app.bsky.actor.defs#postInteractionSettingsPref',
            threadgateAllowRules: [
              { $type: 'app.bsky.feed.threadgate#followingRule' },
            ],
            postgateEmbeddingRules: [
              { $type: 'app.bsky.feed.postgate#disableRule' },
            ],
          },
        ],
      },
    }));
    const agent = { did: DID, app: { bsky: { actor: { getPreferences } } } };
    const out = await resolveDefaultGates({ gates: null }, { agent });
    expect(getPreferences).toHaveBeenCalledTimes(1);
    expect(out).toEqual({
      gates: { custom: false, reply: [{ type: 'following' }], quotes: false },
      source: 'bluesky',
      notice: null,
    });

    const unreadable = {
      did: DID,
      app: {
        bsky: {
          actor: {
            getPreferences: async () => {
              throw new Error('offline');
            },
          },
        },
      },
    };
    expect(
      (await resolveDefaultGates({ gates: null }, { agent: unreadable }))
        .source,
    ).toBe('everyone');
  });

  it('then everyone, saying why', async () => {
    const out = await resolveDefaultGates(
      { gates: null },
      { agent: {}, readDefaultGates: async () => null },
    );
    expect(out.gates).toEqual({ custom: false, reply: null, quotes: true });
    expect(out.source).toBe('everyone');
    expect(out.notice).toMatch(/anyone can reply/);
    const thrown = await resolveDefaultGates(null, {
      agent: {},
      readDefaultGates: async () => {
        throw new Error('x');
      },
    });
    expect(thrown.source).toBe('everyone');
  });
});

describe('usePostingSettings', () => {
  it('reads the account’s settings on the first render', async () => {
    const { createElement } = await import('react');
    const { renderToString } = await import('react-dom/server');
    const { usePostingSettings } = await import('./settings.js');
    const store = memoryStore({
      [postingSettingsKey(DID)]: JSON.stringify({ defaultAction: 'schedule' }),
    });
    vi.stubGlobal('localStorage', store);
    try {
      const seen = { current: null };
      function Probe() {
        seen.current = usePostingSettings(DID);
        return null;
      }
      renderToString(createElement(Probe));
      expect(seen.current.settings.defaultAction).toBe('schedule');
      expect(typeof seen.current.update).toBe('function');
      expect(typeof seen.current.reset).toBe('function');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
