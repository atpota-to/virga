/*
 * The adviser read holds `isCheckingPost` (the composer's blocking busy
 * state) for exactly one read. It lets go on the answer, a failure, the
 * pre-publish deadline or the writer's choice, and an answer arriving after
 * the read ended changes nothing.
 */

import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADVISER_CHOICES, ADVISER_GATE_TIMEOUT_MS } from './gate.js';
import { createAdviserReader, useAdviserRead } from './useAdviserRead.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let api;
let flag;
let flagLog;
let answers;

function mount() {
  const analyze = vi.fn(() => {
    const answer = deferred();
    answers.push(answer);
    return answer.promise;
  });
  api = createAdviserReader({
    analyze,
    setIsCheckingPost: (value) => {
      flag = value;
      flagLog.push(value);
    },
  });
  return analyze;
}

// The read starts on a microtask (a work function that throws synchronously
// still settles as an error), so give it one before looking.
async function startRead(text, options) {
  const ended = { value: null };
  api.readAdviser(text, options).then((value) => {
    ended.value = value;
  });
  await vi.advanceTimersByTimeAsync(0);
  return ended;
}

const flush = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => {
  vi.useFakeTimers();
  flag = false;
  flagLog = [];
  answers = [];
});

afterEach(() => {
  api?.dispose();
  vi.useRealTimers();
});

describe('createAdviserReader', () => {
  it('holds the flag for the read and offers both ways out of a pre-publish check', async () => {
    const analyze = mount();
    const ended = await startRead('a draft', { gate: true });
    expect(analyze).toHaveBeenCalledWith('a draft', {
      automatic: true,
      signal: expect.any(AbortSignal),
    });
    expect(flag).toBe(true);
    expect(api.getState().adviserChoices).toEqual([
      ADVISER_CHOICES.PUBLISH,
      ADVISER_CHOICES.EDIT,
    ]);

    answers[0].resolve({ overallStatus: 'ok' });
    await flush();
    expect(ended.value).toEqual({
      outcome: 'result',
      result: { overallStatus: 'ok' },
    });
    expect(flag).toBe(false);
    expect(api.getState().adviserChoices).toBeNull();
    expect(api.getState().adviserReadInterrupted).toBe(false);
  });

  it('offers only "keep editing" on a read the writer asked for', async () => {
    const analyze = mount();
    await startRead('a draft', { gate: false });
    expect(api.getState().adviserChoices).toEqual([ADVISER_CHOICES.EDIT]);
    expect(analyze).toHaveBeenCalledWith('a draft', {
      automatic: false,
      signal: expect.any(AbortSignal),
    });
  });

  it('tells the analysis when the read has ended without it', async () => {
    const analyze = mount();
    await startRead('a draft', { gate: true });
    const { signal } = analyze.mock.calls[0][1];
    expect(signal.aborted).toBe(false);
    await flush(ADVISER_GATE_TIMEOUT_MS);
    expect(signal.aborted).toBe(true);

    await startRead('another', { gate: false });
    const second = analyze.mock.calls[1][1].signal;
    api.chooseAdviser(ADVISER_CHOICES.EDIT);
    expect(second.aborted).toBe(true);
  });

  it('gives the composer back when the pre-publish check runs past its deadline', async () => {
    mount();
    const ended = await startRead('a draft', { gate: true });
    await flush(ADVISER_GATE_TIMEOUT_MS - 1);
    expect(flag).toBe(true);
    await flush(1);
    expect(ended.value).toEqual({ outcome: 'timeout' });
    expect(flag).toBe(false);
    expect(api.getState().adviserReadInterrupted).toBe(true);
  });

  it('does not put a deadline on a read the writer asked for', async () => {
    mount();
    const ended = await startRead('a draft', { gate: false });
    await flush(ADVISER_GATE_TIMEOUT_MS * 2);
    expect(ended.value).toBeNull();
    expect(flag).toBe(true);
  });

  it('ends on "Publish anyway" at once', async () => {
    mount();
    const ended = await startRead('a draft', { gate: true });
    api.chooseAdviser(ADVISER_CHOICES.PUBLISH);
    await flush();
    expect(ended.value).toEqual({
      outcome: 'cancelled',
      choice: ADVISER_CHOICES.PUBLISH,
    });
    expect(flag).toBe(false);
    expect(api.getState().adviserReadInterrupted).toBe(true);
  });

  it('ends on "Keep editing" at once', async () => {
    mount();
    const ended = await startRead('a draft', { gate: true });
    api.chooseAdviser(ADVISER_CHOICES.EDIT);
    await flush();
    expect(ended.value).toEqual({
      outcome: 'cancelled',
      choice: ADVISER_CHOICES.EDIT,
    });
    expect(flag).toBe(false);
  });

  it('ignores an answer that arrives after the read has ended', async () => {
    mount();
    const ended = await startRead('a draft', { gate: true });
    api.chooseAdviser(ADVISER_CHOICES.EDIT);
    await flush();
    const flips = flagLog.length;

    answers[0].resolve({ overallStatus: 'conflict' });
    await flush();
    expect(ended.value.outcome).toBe('cancelled');
    expect(flagLog.length).toBe(flips);
    expect(flag).toBe(false);
  });

  it('does not let a late answer put down the flag a newer read is holding', async () => {
    mount();
    await startRead('first', { gate: true });
    api.chooseAdviser(ADVISER_CHOICES.EDIT);
    await flush();
    const second = await startRead('second', { gate: true });
    expect(flag).toBe(true);

    answers[0].resolve({ overallStatus: 'ok' });
    await flush();
    expect(flag).toBe(true);
    expect(second.value).toBeNull();

    answers[1].resolve({ overallStatus: 'ok' });
    await flush();
    expect(second.value.outcome).toBe('result');
    expect(flag).toBe(false);
  });

  it('cancels a read still running when a new one starts', async () => {
    mount();
    const first = await startRead('first', { gate: false });
    await startRead('second', { gate: false });
    await flush();
    expect(first.value).toEqual({
      outcome: 'cancelled',
      choice: ADVISER_CHOICES.EDIT,
    });
    expect(flag).toBe(true);
  });

  it('reports a failure as an error and gives the composer back', async () => {
    mount();
    const ended = await startRead('a draft', { gate: true });
    answers[0].reject(Object.assign(new Error('busy'), { code: 'overloaded' }));
    await flush();
    expect(ended.value.outcome).toBe('error');
    expect(ended.value.error.message).toBe('busy');
    expect(flag).toBe(false);
  });

  it('does nothing when there is no read to end', () => {
    mount();
    expect(() => api.chooseAdviser(ADVISER_CHOICES.PUBLISH)).not.toThrow();
    expect(flagLog).toEqual([]);
  });

  it('ends a read when disposed, and changes nothing after', async () => {
    mount();
    const ended = await startRead('a draft', { gate: true });
    api.dispose();
    await flush();
    expect(ended.value).toEqual({
      outcome: 'cancelled',
      choice: ADVISER_CHOICES.EDIT,
    });
    // Disposed: the flag isn't touched again by a component that's gone.
    expect(flagLog).toEqual([true]);
    expect(api.getState().adviserChoices).not.toBeNull();
  });

  it('reads with the latest analyze it was given', async () => {
    mount();
    const later = vi.fn(async () => ({ overallStatus: 'caution' }));
    api.setAnalyze(later);
    const ended = await startRead('a draft', { gate: false });
    await flush();
    expect(later).toHaveBeenCalledOnce();
    expect(ended.value.result).toEqual({ overallStatus: 'caution' });
  });

  it('tells its listener each time the state changes', async () => {
    const seen = [];
    api = createAdviserReader({
      analyze: async () => ({}),
      setIsCheckingPost: () => {},
      onChange: (s) => seen.push(s),
    });
    await startRead('a draft', { gate: true });
    await flush();
    expect(seen).toEqual([
      {
        adviserChoices: [ADVISER_CHOICES.PUBLISH, ADVISER_CHOICES.EDIT],
        adviserReadInterrupted: false,
      },
      { adviserChoices: null, adviserReadInterrupted: false },
    ]);
  });
});

describe('useAdviserRead', () => {
  it('starts with nothing reading', () => {
    let seen = null;
    function Probe() {
      seen = useAdviserRead({
        analyze: async () => null,
        setIsCheckingPost: () => {},
      });
      return null;
    }
    renderToString(createElement(Probe));
    expect(seen.adviserChoices).toBeNull();
    expect(seen.adviserReadInterrupted).toBe(false);
    expect(typeof seen.readAdviser).toBe('function');
    expect(typeof seen.chooseAdviser).toBe('function');
  });
});
