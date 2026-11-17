// The latest scan of each account, in memory. A scan keeps running when the
// page that started it is left, and is there when it is opened again; a
// reload or a new tab starts with none. Nothing is written to storage: a scan
// holds other people's handles and names, and docs/DEFENSE.md keeps those in
// memory unless there is a reason to keep them longer.
//
// One scan at a time per account. Starting another stops the one under way.

export const IDLE = Object.freeze({ status: 'idle' });

const scans = new Map(); // did -> state
const controllers = new Map(); // did -> AbortController
const listeners = new Set();

function set(did, state) {
  scans.set(did, Object.freeze(state));
  for (const listener of listeners) listener();
}

/** The account's scan: `{ status: 'idle' | 'running' | 'done' | 'failed', … }`. */
export function scanFor(did) {
  return scans.get(did) || IDLE;
}

/** Hear about every change. Returns the way to stop. */
export function subscribeScans(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Start a scan for `did`. `run(signal, onStage)` does the work (runScan) and
 * resolves to its result. The state goes `running` (with the stage and its
 * progress), then `done` (with `result`) or `failed` (with `error`); a scan
 * that was stopped or replaced leaves no trace of its own.
 */
export function startScan(did, { input, run, now = () => Date.now() }) {
  controllers.get(did)?.abort();
  const controller = new AbortController();
  controllers.set(did, controller);
  const startedAt = now();
  const current = () => controllers.get(did) === controller;
  set(did, { status: 'running', input, startedAt, stage: null, progress: null });

  const onStage = ({ stage, done = null, total = null }) => {
    if (!current()) return;
    const progress = done != null && total ? { done, total } : null;
    set(did, { ...scanFor(did), stage, progress });
  };

  const settled = Promise.resolve()
    .then(() => run(controller.signal, onStage))
    .then(
      (result) => {
        if (current()) set(did, { status: 'done', input, startedAt, result });
      },
      (error) => {
        if (!current()) return;
        if (error?.code === 'aborted' || controller.signal.aborted) set(did, IDLE);
        else set(did, { status: 'failed', input, startedAt, error });
      },
    )
    .finally(() => {
      if (current()) controllers.delete(did);
    });
  return settled;
}

/** Stop the scan under way, if there is one. What it found so far is dropped. */
export function stopScan(did) {
  const controller = controllers.get(did);
  if (!controller) return;
  controllers.delete(did);
  controller.abort();
  set(did, IDLE);
}

/** Forget the account's scan, stopping it first if it is running. */
export function clearScan(did) {
  stopScan(did);
  if (scans.has(did)) set(did, IDLE);
}

/** Tests only. */
export function resetScansForTests() {
  for (const c of controllers.values()) c.abort();
  controllers.clear();
  scans.clear();
  listeners.clear();
}
