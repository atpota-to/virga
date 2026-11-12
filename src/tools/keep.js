// A per-account set of DIDs a tool should leave alone ("Keep, don't
// suggest"), kept in localStorage. Only ever changes what a page suggests.

import { useCallback, useMemo, useState } from 'react';

function storage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function keepKey(did, name) {
  return `virga:keep:${name}:${did}`;
}

function read(key) {
  try {
    const list = JSON.parse(storage()?.getItem(key) || '[]');
    return new Set(Array.isArray(list) ? list.filter((d) => typeof d === 'string') : []);
  } catch {
    return new Set();
  }
}

export function useKeepList(did, name) {
  const key = keepKey(did, name);
  const [set, setSet] = useState(() => read(key));
  const save = useCallback(
    (next) => {
      setSet(next);
      try {
        storage()?.setItem(key, JSON.stringify([...next]));
      } catch {
        // Kept for this visit only.
      }
    },
    [key],
  );
  return useMemo(
    () => ({
      has: (d) => set.has(d),
      size: set.size,
      add: (dids) => save(new Set([...set, ...dids])),
      remove: (dids) => save(new Set([...set].filter((d) => !dids.includes(d)))),
      clear: () => save(new Set()),
    }),
    [set, save],
  );
}
