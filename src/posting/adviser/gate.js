/**
 * The posting adviser's read, bounded so it can never hold the composer
 * indefinitely. A read settles exactly once, on whichever comes first:
 *
 *   result     the adviser answered
 *   error      it failed (the composer fails open)
 *   timeout    past its deadline; treated like an error
 *   cancelled  the writer chose to publish anyway or keep editing
 *
 * Anything arriving after that is dropped. Pure apart from the timer, so the
 * race can be tested with a fake clock. The composer's pre-publish check and
 * the adviser button both read through it (useAdviserRead.js).
 */

/**
 * Longest a pre-publish check may hold a post; past it the composer fails open
 * as on an error.
 */
export const ADVISER_GATE_TIMEOUT_MS = 10000;

/**
 * How long the read waits for a reply's thread context; past it the adviser
 * reads against the parent post alone, as it does when the fetch fails.
 */
export const ADVISER_CONTEXT_TIMEOUT_MS = 4000;

/** What the writer can do while the adviser reads. */
export const ADVISER_CHOICES = {
  PUBLISH: 'publish',
  EDIT: 'edit',
};

/** Busy-surface button labels. */
export const ADVISER_CHOICE_LABELS = {
  [ADVISER_CHOICES.PUBLISH]: 'Publish anyway',
  [ADVISER_CHOICES.EDIT]: 'Keep editing',
};

/**
 * Choices a read offers: the pre-publish check offers both; a read requested
 * from the adviser button has nothing to publish past, so only EDIT.
 *
 * @param {boolean} gate the read is the pre-publish check
 * @returns {string[]}
 */
export function adviserReadChoices(gate) {
  return gate
    ? [ADVISER_CHOICES.PUBLISH, ADVISER_CHOICES.EDIT]
    : [ADVISER_CHOICES.EDIT];
}

/** The error a read reports when its deadline passes. */
export const ADVISER_TIMEOUT_MESSAGE =
  'The adviser took too long to answer, so it has not read this draft. You can still publish it as it is.';

/**
 * Start a read that settles once: on its answer, its failure, its deadline, or
 * the writer's choice, whichever is first.
 *
 * `work` is handed an AbortSignal that aborts when the read ends without its
 * answer: on the deadline or the writer's choice. aiService checks it before
 * sending, so a draft the composer has moved past isn't sent; an answer that
 * still lands late is dropped here.
 *
 * @param {(signal: AbortSignal) => Promise<any>} work the read itself
 * @param {object} [options]
 * @param {number|null} [options.timeoutMs] deadline; null for none
 * @returns {{ promise: Promise<{outcome: 'result'|'error'|'timeout'|'cancelled',
 *            result?: any, error?: any, choice?: string}>,
 *            cancel: (choice: string) => boolean,
 *            isSettled: () => boolean }}
 */
export function startAdviserRead(work, { timeoutMs = null } = {}) {
  let settled = false;
  let timer = null;
  let resolveOuter;
  const promise = new Promise((resolve) => {
    resolveOuter = resolve;
  });
  const ended = new AbortController();

  const settle = (value) => {
    if (settled) return false;
    settled = true;
    if (timer != null) clearTimeout(timer);
    if (value.outcome === 'timeout' || value.outcome === 'cancelled')
      ended.abort();
    resolveOuter(value);
    return true;
  };

  if (timeoutMs != null) {
    timer = setTimeout(() => settle({ outcome: 'timeout' }), timeoutMs);
  }

  // Via a resolved promise so a synchronous throw in `work` still settles as an error.
  Promise.resolve()
    .then(() => work(ended.signal))
    .then(
      (result) => settle({ outcome: 'result', result }),
      (error) => settle({ outcome: 'error', error }),
    );

  return {
    promise,
    cancel: (choice) => settle({ outcome: 'cancelled', choice }),
    isSettled: () => settled,
  };
}

/**
 * A promise that rejects if `promise` has not settled within `ms`. For the
 * steps inside a read that have their own fallback on failure.
 *
 * @param {Promise<any>} promise
 * @param {number} ms
 * @returns {Promise<any>}
 */
export function withinMs(promise, ms) {
  let timer = null;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}
