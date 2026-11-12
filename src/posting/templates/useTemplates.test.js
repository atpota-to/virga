/*
 * The templates hook's first render, through react-dom/server (no DOM in the
 * suite, so effects don't run): the cached copy shows at once, for the
 * account asked for and no other.
 */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// The session hook only works inside its provider, which starts signing in;
// the hook under test needs nothing from it but agentFor and the accounts.
vi.mock('../../session/useAtprotoSession.jsx', () => ({
  useAtprotoSession: () => ({ agentFor: async () => null }),
}));

const { useTemplates } = await import('./useTemplates.js');
const { createTemplateService, templatesCacheKey } =
  await import('./templateService.js');

const DID = 'did:plc:bob';
const OTHER = 'did:plc:carol';

function memoryStore(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

function render(did, opts) {
  const seen = { current: null };
  function Probe() {
    seen.current = useTemplates(did, opts);
    return null;
  }
  renderToString(createElement(Probe));
  return seen.current;
}

const cached = {
  '3la': {
    uri: `at://${DID}/net.anisota.feed.template/3la`,
    cid: 'c',
    value: {
      name: 'Cached',
      text: 'Hi',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  },
};

describe('useTemplates', () => {
  it('shows the account’s cached templates on the first render, loading', () => {
    const service = createTemplateService({
      store: memoryStore({ [templatesCacheKey(DID)]: JSON.stringify(cached) }),
      target: null,
    });
    const value = render(DID, { service });
    expect(value.templates.map((t) => t.name)).toEqual(['Cached']);
    expect(value).toMatchObject({ loading: true, ready: false, error: null });
    expect(render(OTHER, { service }).templates).toEqual([]);
  });

  it('reads nothing when disabled or without an account', () => {
    const service = createTemplateService({
      store: memoryStore({ [templatesCacheKey(DID)]: JSON.stringify(cached) }),
      target: null,
    });
    expect(render(DID, { service, enabled: false })).toMatchObject({
      templates: [],
      loading: false,
      ready: false,
    });
    expect(render(null, { service })).toMatchObject({
      templates: [],
      loading: false,
    });
    expect(service.list(DID)).toEqual([]);
  });
});
