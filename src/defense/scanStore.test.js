import { afterEach, describe, expect, it, vi } from 'vitest';
import { IDLE, clearScan, keepScansFor, resetScansForTests, scanFor, startScan, stopScan, subscribeScans } from './scanStore.js';

const MIRA = 'did:plc:mira';
const LAB = 'did:plc:lab';

afterEach(() => resetScansForTests());

/** A run that waits for `release()` and reports a stage on the way. */
function held(result = { rows: [] }) {
  let release;
  let fail;
  const run = vi.fn(
    (signal, onStage) =>
      new Promise((resolve, reject) => {
        onStage({ stage: 'harvest', done: 1, total: 4 });
        release = () => resolve(result);
        fail = (e) => reject(e);
        signal.addEventListener('abort', () => reject(Object.assign(new Error('stopped'), { code: 'aborted' })));
      }),
  );
  return { run, release: () => release(), fail: (e) => fail(e) };
}

describe('an account’s scan', () => {
  it('runs, says how far it is, and keeps what it found', async () => {
    const seen = [];
    subscribeScans(() => seen.push(scanFor(MIRA).status));
    const h = held({ rows: [1, 2] });
    const done = startScan(MIRA, { input: 'link', run: h.run, now: () => 5 });
    await vi.waitFor(() => expect(scanFor(MIRA).stage).toBe('harvest'));
    expect(scanFor(MIRA)).toMatchObject({ status: 'running', input: 'link', startedAt: 5, progress: { done: 1, total: 4 } });
    h.release();
    await done;
    expect(scanFor(MIRA)).toMatchObject({ status: 'done', input: 'link', result: { rows: [1, 2] } });
    expect(seen).toContain('running');
    expect(seen.at(-1)).toBe('done');
    // Another account's is its own.
    expect(scanFor(LAB)).toBe(IDLE);
  });

  it('keeps a failure to show, with its error', async () => {
    const h = held();
    const done = startScan(MIRA, { input: 'link', run: h.run });
    await vi.waitFor(() => expect(h.run).toHaveBeenCalled());
    const error = Object.assign(new Error('no counts'), { code: 'vouches' });
    h.fail(error);
    await done;
    expect(scanFor(MIRA)).toMatchObject({ status: 'failed', error });
  });

  it('leaves nothing behind when stopped', async () => {
    const h = held();
    const done = startScan(MIRA, { input: 'link', run: h.run });
    await vi.waitFor(() => expect(scanFor(MIRA).stage).toBe('harvest'));
    stopScan(MIRA);
    await done;
    expect(scanFor(MIRA)).toBe(IDLE);
    expect(h.run.mock.calls[0][0].aborted).toBe(true);
  });

  it('shows a failure that only looks like a stop', async () => {
    const h = held();
    const done = startScan(MIRA, { input: 'link', run: h.run });
    await vi.waitFor(() => expect(h.run).toHaveBeenCalled());
    // A fetch timing out throws an AbortError of its own; nobody pressed Stop.
    h.fail(Object.assign(new Error('The operation timed out'), { name: 'AbortError' }));
    await done;
    expect(scanFor(MIRA).status).toBe('failed');
  });

  it('forgets the scans of accounts no longer signed in', async () => {
    const a = held();
    const b = held();
    const one = startScan(MIRA, { input: 'one', run: a.run });
    const two = startScan(LAB, { input: 'two', run: b.run });
    await vi.waitFor(() => expect(b.run).toHaveBeenCalled());
    a.release();
    await one;
    keepScansFor([LAB]);
    expect(scanFor(MIRA)).toBe(IDLE);
    expect(scanFor(LAB).status).toBe('running');
    keepScansFor([]);
    await two;
    expect(scanFor(LAB)).toBe(IDLE);
  });

  it('lets a new scan replace one under way, without the old one’s answer landing late', async () => {
    const first = held({ rows: ['old'] });
    const second = held({ rows: ['new'] });
    const a = startScan(MIRA, { input: 'one', run: first.run });
    await vi.waitFor(() => expect(first.run).toHaveBeenCalled());
    const b = startScan(MIRA, { input: 'two', run: second.run });
    await vi.waitFor(() => expect(second.run).toHaveBeenCalled());
    second.release();
    await Promise.all([a, b]);
    expect(scanFor(MIRA)).toMatchObject({ status: 'done', input: 'two', result: { rows: ['new'] } });
  });

  it('forgets a finished scan when cleared', async () => {
    const h = held();
    const done = startScan(MIRA, { input: 'link', run: h.run });
    await vi.waitFor(() => expect(h.run).toHaveBeenCalled());
    h.release();
    await done;
    clearScan(MIRA);
    expect(scanFor(MIRA)).toBe(IDLE);
  });
});
