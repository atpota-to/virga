/*
 * startAdviserRead races answer, failure, deadline and the writer's choice;
 * the first wins and everything after is dropped, so an answer that lands
 * after the writer has published must not reopen anything.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ADVISER_CHOICES,
  ADVISER_CHOICE_LABELS,
  ADVISER_GATE_TIMEOUT_MS,
  adviserReadChoices,
  startAdviserRead,
  withinMs,
} from './gate.js';

/** A promise and the hands that settle it, for answers that arrive on cue. */
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the gate deadline', () => {
  it('is about ten seconds', () => {
    expect(ADVISER_GATE_TIMEOUT_MS).toBeGreaterThanOrEqual(8000);
    expect(ADVISER_GATE_TIMEOUT_MS).toBeLessThanOrEqual(12000);
  });
});

describe('adviserReadChoices', () => {
  it('offers publish anyway and keep editing on the pre-publish check', () => {
    expect(adviserReadChoices(true)).toEqual([
      ADVISER_CHOICES.PUBLISH,
      ADVISER_CHOICES.EDIT,
    ]);
  });

  it('offers only the way back on a read the writer asked for', () => {
    expect(adviserReadChoices(false)).toEqual([ADVISER_CHOICES.EDIT]);
  });

  it('labels both in plain words', () => {
    expect(ADVISER_CHOICE_LABELS[ADVISER_CHOICES.PUBLISH]).toBe(
      'Publish anyway',
    );
    expect(ADVISER_CHOICE_LABELS[ADVISER_CHOICES.EDIT]).toBe('Keep editing');
  });
});

describe('startAdviserRead', () => {
  it('settles on the answer', async () => {
    const read = startAdviserRead(async () => ({ overallStatus: 'aligned' }), {
      timeoutMs: 10000,
    });
    await expect(read.promise).resolves.toEqual({
      outcome: 'result',
      result: { overallStatus: 'aligned' },
    });
    expect(read.isSettled()).toBe(true);
  });

  it('settles on a failure, including one thrown before the first await', async () => {
    const boom = new Error('no');
    const read = startAdviserRead(() => {
      throw boom;
    });
    await expect(read.promise).resolves.toEqual({
      outcome: 'error',
      error: boom,
    });
  });

  it('settles on the deadline when the adviser never answers', async () => {
    const answer = deferred();
    const read = startAdviserRead(() => answer.promise, {
      timeoutMs: ADVISER_GATE_TIMEOUT_MS,
    });
    let ended = null;
    read.promise.then((value) => {
      ended = value;
    });

    await vi.advanceTimersByTimeAsync(ADVISER_GATE_TIMEOUT_MS - 1);
    expect(ended).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(ended).toEqual({ outcome: 'timeout' });
  });

  it('ignores an answer that lands after the deadline', async () => {
    const answer = deferred();
    const read = startAdviserRead(() => answer.promise, { timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(1000);
    answer.resolve({ overallStatus: 'conflict' });
    await vi.advanceTimersByTimeAsync(0);
    await expect(read.promise).resolves.toEqual({ outcome: 'timeout' });
  });

  it("settles on the writer's choice, and ignores the answer after it", async () => {
    const answer = deferred();
    const read = startAdviserRead(() => answer.promise, { timeoutMs: 10000 });
    expect(read.cancel(ADVISER_CHOICES.PUBLISH)).toBe(true);
    answer.resolve({ overallStatus: 'conflict' });
    await expect(read.promise).resolves.toEqual({
      outcome: 'cancelled',
      choice: ADVISER_CHOICES.PUBLISH,
    });
    // A second choice, or the deadline, changes nothing.
    expect(read.cancel(ADVISER_CHOICES.EDIT)).toBe(false);
    await vi.advanceTimersByTimeAsync(10000);
    await expect(read.promise).resolves.toEqual({
      outcome: 'cancelled',
      choice: ADVISER_CHOICES.PUBLISH,
    });
  });

  it('has no deadline unless it is given one', async () => {
    const answer = deferred();
    const read = startAdviserRead(() => answer.promise);
    let ended = null;
    read.promise.then((value) => {
      ended = value;
    });
    await vi.advanceTimersByTimeAsync(60000);
    expect(ended).toBeNull();
    answer.resolve('late but wanted');
    await vi.advanceTimersByTimeAsync(0);
    expect(ended).toEqual({ outcome: 'result', result: 'late but wanted' });
  });

  it('clears its timer once it has settled', async () => {
    const read = startAdviserRead(async () => 'quick', { timeoutMs: 10000 });
    await read.promise;
    expect(vi.getTimerCount()).toBe(0);
  });
});

/*
 * The read tells its work when it has ended without an answer, so a request
 * that hasn't gone yet stands down: a draft the writer has published past, or
 * gone back to editing, must not be sent.
 */
describe("the read's signal", () => {
  /** Start a read whose work keeps hold of its signal and never answers on its own. */
  function readHoldingSignal(options) {
    const answer = deferred();
    let signal = null;
    const read = startAdviserRead((s) => {
      signal = s;
      return answer.promise;
    }, options);
    return { read, answer, signal: () => signal };
  }

  it('hands the work a live signal', async () => {
    const { signal } = readHoldingSignal({
      timeoutMs: ADVISER_GATE_TIMEOUT_MS,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(signal()).toBeInstanceOf(AbortSignal);
    expect(signal().aborted).toBe(false);
  });

  it('aborts when the deadline passes', async () => {
    const { read, signal } = readHoldingSignal({
      timeoutMs: ADVISER_GATE_TIMEOUT_MS,
    });
    await vi.advanceTimersByTimeAsync(ADVISER_GATE_TIMEOUT_MS - 1);
    expect(signal().aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(read.isSettled()).toBe(true);
    expect(signal().aborted).toBe(true);
  });

  it("aborts on the writer's choice, either one", async () => {
    for (const choice of [ADVISER_CHOICES.PUBLISH, ADVISER_CHOICES.EDIT]) {
      const { read, signal } = readHoldingSignal();
      await vi.advanceTimersByTimeAsync(0);
      read.cancel(choice);
      expect(signal().aborted).toBe(true);
    }
  });

  it('stays live on an answer or a failure: there is nothing left to stop', async () => {
    const answered = readHoldingSignal({ timeoutMs: ADVISER_GATE_TIMEOUT_MS });
    answered.answer.resolve({ overallStatus: 'aligned' });
    await answered.read.promise;
    expect(answered.signal().aborted).toBe(false);

    const failed = readHoldingSignal({ timeoutMs: ADVISER_GATE_TIMEOUT_MS });
    failed.answer.reject(new Error('busy'));
    await failed.read.promise;
    expect(failed.signal().aborted).toBe(false);
  });

  it('is not aborted by a second ending that changes nothing', async () => {
    const { read, answer, signal } = readHoldingSignal({
      timeoutMs: ADVISER_GATE_TIMEOUT_MS,
    });
    answer.resolve('answered');
    await read.promise;
    expect(read.cancel(ADVISER_CHOICES.EDIT)).toBe(false);
    expect(signal().aborted).toBe(false);
  });
});

describe('withinMs', () => {
  it('passes a prompt answer through', async () => {
    await expect(withinMs(Promise.resolve('thread'), 4000)).resolves.toBe(
      'thread',
    );
  });

  it('rejects a fetch that never answers, so its own fallback can run', async () => {
    const never = new Promise(() => {});
    const raced = withinMs(never, 4000);
    const caught = raced.catch((err) => err);
    await vi.advanceTimersByTimeAsync(4000);
    expect(await caught).toBeInstanceOf(Error);
  });
});
