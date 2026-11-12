import { describe, expect, it } from 'vitest';
import {
  PENDING_COMPOSE_KEY,
  PENDING_COMPOSE_TTL_MS,
  isComposePath,
  rememberPendingCompose,
  takePendingCompose,
} from './pendingCompose.js';

function memoryStore() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    map,
  };
}

describe('isComposePath', () => {
  it('knows the two addresses that open the composer', () => {
    expect(isComposePath('/intent/compose')).toBe(true);
    expect(isComposePath('/posting/compose')).toBe(true);
    expect(isComposePath('/posting/compose/')).toBe(true);
    expect(isComposePath('/posting')).toBe(false);
    expect(isComposePath('/intent/compose/extra')).toBe(false);
    expect(isComposePath('')).toBe(false);
    expect(isComposePath(undefined)).toBe(false);
  });
});

describe('remember and take a compose link', () => {
  it('gives the link back once, with its query', () => {
    const store = memoryStore();
    expect(rememberPendingCompose('/intent/compose', '?text=hello%20there&tags=a,b', { store, now: 1000 })).toBe(true);
    expect(takePendingCompose({ store, now: 2000 })).toBe('/intent/compose?text=hello%20there&tags=a,b');
    expect(takePendingCompose({ store, now: 2000 })).toBe(null);
    expect(store.map.has(PENDING_COMPOSE_KEY)).toBe(false);
  });

  it('keeps a link with no query as just its path', () => {
    const store = memoryStore();
    rememberPendingCompose('/posting/compose', '', { store, now: 0 });
    expect(takePendingCompose({ store, now: 1 })).toBe('/posting/compose');
  });

  it('ignores any other address', () => {
    const store = memoryStore();
    expect(rememberPendingCompose('/reports', '?x=1', { store })).toBe(false);
    expect(store.map.size).toBe(0);
  });

  it('drops a stale link, and one from the future', () => {
    const store = memoryStore();
    rememberPendingCompose('/intent/compose', '?text=old', { store, now: 0 });
    expect(takePendingCompose({ store, now: PENDING_COMPOSE_TTL_MS + 1 })).toBe(null);
    rememberPendingCompose('/intent/compose', '?text=skewed', { store, now: 5000 });
    expect(takePendingCompose({ store, now: 1000 })).toBe(null);
  });

  it('refuses anything that does not read back as a compose link', () => {
    const store = memoryStore();
    store.setItem(PENDING_COMPOSE_KEY, '{not json');
    expect(takePendingCompose({ store, now: 0 })).toBe(null);
    store.setItem(PENDING_COMPOSE_KEY, JSON.stringify({ path: 'https://elsewhere.example/', search: '', at: 0 }));
    expect(takePendingCompose({ store, now: 0 })).toBe(null);
    store.setItem(PENDING_COMPOSE_KEY, JSON.stringify({ path: '/intent/compose', search: '//elsewhere.example', at: 0 }));
    expect(takePendingCompose({ store, now: 0 })).toBe('/intent/compose');
  });

  it('copes with storage that throws or is missing', () => {
    const throwing = {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
      removeItem() {
        throw new Error('blocked');
      },
    };
    expect(rememberPendingCompose('/intent/compose', '?text=x', { store: throwing })).toBe(false);
    expect(takePendingCompose({ store: throwing })).toBe(null);
    expect(rememberPendingCompose('/intent/compose', '?text=x', { store: null })).toBe(false);
    expect(takePendingCompose({ store: null })).toBe(null);
  });
});
