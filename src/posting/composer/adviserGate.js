// The composer's way to the post adviser's gate (adviser/useAdviserGate.js).
// While that hook isn't there, the composer gets a gate that is off: every
// check lets the post through and nothing is shown.

import { useMemo } from 'react';

const found = import.meta.glob('../adviser/useAdviserGate.js', { eager: true });
const mod = Object.values(found)[0] || null;

const CLOSED_SHEET = Object.freeze({
  open: false,
  onClose() {},
  read: null,
  state: null,
  onApplyFix() {},
  busy: false,
});

function useAdviserOff() {
  return useMemo(
    () => ({
      enabled: false,
      check: async () => 'publish',
      busyProps: null,
      sheetProps: CLOSED_SHEET,
      usageLine: '',
    }),
    [],
  );
}

export const useAdviserGate =
  mod?.useAdviserGate || mod?.default || useAdviserOff;
