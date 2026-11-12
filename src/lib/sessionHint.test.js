import { describe, expect, it } from 'vitest';
import {
  SESSION_HINT_KEY,
  clearSessionHint,
  readSessionHint,
  restoresAtStartup,
  writeSessionHint,
} from './sessionHint.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
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
};

describe('session hint', () => {
  it('round-trips', () => {
    const storage = memoryStorage();
    expect(readSessionHint(storage)).toBe(false);
    writeSessionHint(storage);
    expect(readSessionHint(storage)).toBe(true);
    clearSessionHint(storage);
    expect(readSessionHint(storage)).toBe(false);
  });

  it('reads anything but its own mark as no hint', () => {
    expect(readSessionHint(memoryStorage({ [SESSION_HINT_KEY]: 'yes' }))).toBe(false);
    expect(readSessionHint(memoryStorage({ other: '1' }))).toBe(false);
  });

  it('fails soft when storage is missing or throws', () => {
    expect(readSessionHint(null)).toBe(false);
    expect(readSessionHint(throwingStorage)).toBe(false);
    expect(() => writeSessionHint(throwingStorage)).not.toThrow();
    expect(() => clearSessionHint(throwingStorage)).not.toThrow();
    expect(() => writeSessionHint(undefined)).not.toThrow();
  });
});

describe('restoresAtStartup', () => {
  it('loads the OAuth stack only when a session may exist or one is being finished', () => {
    expect(restoresAtStartup({ hint: false, onCallback: false })).toBe(false);
    expect(restoresAtStartup({ hint: true, onCallback: false })).toBe(true);
    expect(restoresAtStartup({ hint: false, onCallback: true })).toBe(true);
  });
});
