import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ADVISER_CHOICES,
  ADVISER_GATE_TIMEOUT_MS,
  adviserReadChoices,
  startAdviserRead,
} from './gate.js';

/**
 * One adviser read at a time, bounded and escapable, without React: the
 * hook below is a thin layer over it, and the suite (which has no DOM) tests
 * it directly.
 *
 * Holds the composer's blocking `isCheckingPost` flag for exactly one read
 * (outcomes in gate.js). `readAdviser(text, { gate })` resolves once with
 * `{ outcome, result, error, choice }`. A pre-publish check (`gate: true`)
 * gets a deadline and a "publish anyway" choice; a read from the adviser
 * button has no deadline of its own and can only be left. Answers arriving
 * after the read ended are dropped.
 *
 * `analyze` is told which kind of read it is (the pre-publish check is
 * `automatic`: a use the writer didn't ask for this time) and handed the
 * read's signal, which aborts when the read ends without its answer.
 *
 * @param {object} options
 * @param {(text: string, read: { automatic: boolean, signal: AbortSignal }) => Promise<any>} options.analyze
 * @param {(busy: boolean) => void} options.setIsCheckingPost
 * @param {(state: { adviserChoices: string[]|null, adviserReadInterrupted: boolean }) => void} [options.onChange]
 * @param {number} [options.gateTimeoutMs]
 */
export function createAdviserReader({
  analyze,
  setIsCheckingPost,
  onChange = () => {},
  gateTimeoutMs = ADVISER_GATE_TIMEOUT_MS,
}) {
  let current = null;
  let live = true;
  let analyzeFn = analyze;
  // adviserChoices: null when nothing is reading. adviserReadInterrupted: the
  // last read ended without an answer, so the surface doesn't tick its goals.
  let state = { adviserChoices: null, adviserReadInterrupted: false };

  const set = (patch) => {
    state = { ...state, ...patch };
    onChange(state);
  };

  function readAdviser(sourceText, { gate = false } = {}) {
    // A new read supersedes any still running, so two never share the flag.
    current?.cancel(ADVISER_CHOICES.EDIT);
    const read = startAdviserRead(
      (signal) => analyzeFn(sourceText, { automatic: gate, signal }),
      { timeoutMs: gate ? gateTimeoutMs : null },
    );
    current = read;
    set({
      adviserReadInterrupted: false,
      adviserChoices: adviserReadChoices(gate),
    });
    setIsCheckingPost(true);

    return read.promise.then((ended) => {
      // Only the current read lowers the flag; a superseded one already did.
      if (current === read) {
        current = null;
        if (live) {
          set({
            adviserReadInterrupted:
              ended.outcome === 'timeout' || ended.outcome === 'cancelled',
            adviserChoices: null,
          });
          setIsCheckingPost(false);
        }
      }
      return ended;
    });
  }

  function chooseAdviser(choice) {
    current?.cancel(choice);
  }

  return {
    readAdviser,
    chooseAdviser,
    getState: () => state,
    /** Keep the latest `analyze` without restarting anything. */
    setAnalyze(fn) {
      analyzeFn = fn;
    },
    /** The composer went away: end any read, and change nothing after. */
    dispose() {
      live = false;
      current?.cancel(ADVISER_CHOICES.EDIT);
    },
    revive() {
      live = true;
    },
  };
}

/**
 * The composer's adviser read: createAdviserReader in a component.
 * `readAdviser` and `chooseAdviser` stay the same across renders while
 * `analyze` changes, and unmounting ends a read in flight.
 *
 * @returns {{ readAdviser: Function, chooseAdviser: Function, adviserChoices: string[]|null, adviserReadInterrupted: boolean }}
 */
export function useAdviserRead({
  analyze,
  setIsCheckingPost,
  gateTimeoutMs = ADVISER_GATE_TIMEOUT_MS,
}) {
  const [view, setView] = useState({
    adviserChoices: null,
    adviserReadInterrupted: false,
  });
  const flagRef = useRef(setIsCheckingPost);
  flagRef.current = setIsCheckingPost;

  const readerRef = useRef(null);
  if (!readerRef.current || readerRef.current.timeout !== gateTimeoutMs) {
    readerRef.current?.reader.dispose();
    readerRef.current = {
      timeout: gateTimeoutMs,
      reader: createAdviserReader({
        analyze,
        setIsCheckingPost: (busy) => flagRef.current(busy),
        onChange: setView,
        gateTimeoutMs,
      }),
    };
  }
  const { reader } = readerRef.current;
  reader.setAnalyze(analyze);

  useEffect(() => {
    reader.revive();
    return () => reader.dispose();
  }, [reader]);

  const readAdviser = useCallback(
    (text, options) => reader.readAdviser(text, options),
    [reader],
  );
  const chooseAdviser = useCallback(
    (choice) => reader.chooseAdviser(choice),
    [reader],
  );

  return {
    readAdviser,
    chooseAdviser,
    adviserChoices: view.adviserChoices,
    adviserReadInterrupted: view.adviserReadInterrupted,
  };
}

export default useAdviserRead;
