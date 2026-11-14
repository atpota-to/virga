// Record keys for new posts: TIDs (https://atproto.com/specs/tid), minted
// here so a write can be retried under the same key without posting twice.
// A TID is 64 bits — a zero, 53 bits of microseconds since the epoch, 10 bits
// of clock id — written in base32-sortable as 13 characters, so keys sort in
// the order they were minted.

const ALPHABET = '234567abcdefghijklmnopqrstuvwxyz';
const TID_PATTERN =
  /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/;

// One clock id for this page: two tabs minting in the same microsecond get
// different keys.
const CLOCK_ID = BigInt(Math.floor(Math.random() * 1024));

function encode(micros, clockId) {
  let n = (micros << 10n) | clockId;
  let out = '';
  for (let i = 0; i < 13; i++) {
    out = ALPHABET[Number(n & 31n)] + out;
    n >>= 5n;
  }
  return out;
}

/**
 * A TID minter whose keys always increase, even for the same or an earlier
 * `ms`, so a batch minted in one loop is in order. `nextTid` is the page's
 * shared one; a separate clock is for tests.
 * @returns {(ms?: number) => string}
 */
export function createTidClock() {
  let lastMicros = 0n;
  return function next(ms = Date.now()) {
    // Sub-millisecond digits come from performance.now where it exists, so
    // keys minted on a fresh page don't all sit on whole milliseconds.
    const sub =
      typeof performance !== 'undefined' &&
      typeof performance.now === 'function'
        ? BigInt(Math.floor((performance.now() % 1) * 1000))
        : 0n;
    let micros = BigInt(Math.floor(ms)) * 1000n + sub;
    if (micros <= lastMicros) micros = lastMicros + 1n;
    lastMicros = micros;
    return encode(micros, CLOCK_ID);
  };
}

/**
 * A fresh TID for the time `ms` (default now), from the page's shared clock.
 * @type {(ms?: number) => string}
 */
export const nextTid = createTidClock();

/** Whether `rkey` is a well-formed TID. */
export function isTid(rkey) {
  return typeof rkey === 'string' && TID_PATTERN.test(rkey);
}

/** The time a TID was minted, in milliseconds, or null for a non-TID. */
export function tidTimestamp(rkey) {
  if (!isTid(rkey)) return null;
  let n = 0n;
  for (const ch of rkey) n = n * 32n + BigInt(ALPHABET.indexOf(ch));
  return Number((n >> 10n) / 1000n);
}
