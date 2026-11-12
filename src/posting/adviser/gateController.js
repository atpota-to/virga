// The composer's side of the post adviser, without React: one read at a time,
// the busy state while it runs, the sheet that shows what it found, and the
// writer's way past it. ./useAdviserGate.js is a thin hook over this, and the
// suite (which has no DOM) tests it directly.
//
// `check(state, { mode })` resolves once, to what the composer should do:
//
//   'publish'  go ahead (the read found nothing worth stopping for, the writer
//              chose to publish, or the read failed, timed out or wasn't
//              needed: the pre-publish check always fails open)
//   'edit'     back to the composer
//   'draft'    save the post as a draft instead
//
// Mode 'gate' is the check before Post now. It honours the account's review
// mode, check scope and "check before posting" switch, gives up after the
// 10 s deadline, and lets the post through when there's nothing to read or
// the month's checks are known to be used up. Mode 'manual' is the composer's
// "Check this post" button: it ignores the scope and always shows the sheet,
// including when there's nothing to check. It asks even when this browser
// thinks the month is used up, because that hint can be stale (the account
// became unlimited, or its count was reset): cocoon refuses an over-limit
// request with monthly_limit before spending anything, and that refusal is
// the limit sheet.
//
// No double billing: a 'publish' from the sheet means the read already
// happened, so the composer publishes without checking again.

import { applyWritingFixesToThread } from './analysis.js';
import { analyzePost as analyzePostDefault } from './aiService.js';
import {
  READ_MIN_MS,
  adviserReadPlan,
  adviserShouldInterrupt,
  analyzePayload,
  gatherReplyContext as gatherReplyContextDefault,
} from './context.js';
import { ADVISER_CHOICES, ADVISER_GATE_TIMEOUT_MS } from './gate.js';
import { normalizeAdviserSettings } from './setup.js';
import {
  adviserUsageLine,
  isAdviserAtLimit,
  readAdviserUsage,
} from './usage.js';
import { createAdviserReader } from './useAdviserRead.js';

export const ADVISER_DECISIONS = Object.freeze({
  PUBLISH: 'publish',
  EDIT: 'edit',
  DRAFT: 'draft',
});

/** What the sheet shows instead of a read. */
export const SHEET_STATUSES = Object.freeze([
  'ready', // a read came back
  'error', // it failed
  'limit', // this month's checks are used up
  'empty', // nothing is set up to check against
  'needsText', // the post is empty
]);

/**
 * Whether the adviser can be asked at all for this account: switched on in
 * its settings, and signed in through Virga's server (D16). An account with
 * a browser session has no requester to send with.
 */
export function adviserGateEnabled({ settings, requester, canUseAi } = {}) {
  return (
    normalizeAdviserSettings(settings).enabled && !!requester && !!canUseAi
  );
}

/** The sheet's line about the month's checks, or ''. */
export function adviserUsageLineFor(
  did,
  { readUsage = readAdviserUsage, now } = {},
) {
  if (!did) return '';
  const usage = readUsage(did, { feature: 'adviser', ...(now ? { now } : {}) });
  return adviserUsageLine(usage, {
    feature: 'adviser',
    ...(now ? { now } : {}),
  });
}

const EMPTY_VIEW = Object.freeze({
  busy: null,
  sheet: null,
  usageVersion: 0,
});

export const INITIAL_ADVISER_VIEW = EMPTY_VIEW;

function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const asList = (fixes) => (Array.isArray(fixes) ? fixes : fixes ? [fixes] : []);

/**
 * @param {object} [deps] - everything with a side effect, so tests can stand in
 * @param {Function} [deps.analyzePost] - aiService.analyzePost
 * @param {Function} [deps.gatherReplyContext] - context.gatherReplyContext
 * @param {(did: string) => boolean} [deps.atLimit] - usage.isAdviserAtLimit
 * @param {(did: string, options: object) => object|null} [deps.readUsage]
 * @param {() => number} [deps.now]
 * @param {(ms: number) => Promise<void>} [deps.sleep]
 * @param {number} [deps.gateTimeoutMs]
 * @param {number} [deps.readMinMs] - a fast answer is held this long from the start
 * @param {(view: object) => void} [deps.onChange]
 */
export function createAdviserGateController({
  analyzePost = analyzePostDefault,
  gatherReplyContext = gatherReplyContextDefault,
  atLimit = (did) => isAdviserAtLimit(did),
  readUsage = readAdviserUsage,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  gateTimeoutMs = ADVISER_GATE_TIMEOUT_MS,
  readMinMs = READ_MIN_MS,
  onChange = () => {},
} = {}) {
  let config = {
    did: null,
    settings: null,
    requester: null,
    canUseAi: false,
    onApplyFixes: null,
  };
  let view = EMPTY_VIEW;
  // The check in progress: its token, how it ends, and while the busy state
  // shows, how a choice reaches it.
  let seq = 0;
  let pending = null; // { token, resolve }
  let hold = null; // deferred, while a fast answer is held
  let sheetDecision = null; // deferred, while the sheet is open

  const reader = createAdviserReader({
    analyze: () => Promise.reject(new Error('No read set up.')),
    setIsCheckingPost: () => {},
    gateTimeoutMs,
  });

  function set(patch) {
    view = { ...view, ...patch };
    onChange(view);
  }

  function enabled() {
    return adviserGateEnabled(config);
  }

  /** End whatever is in progress with 'edit', quietly. */
  function endCurrent() {
    reader.chooseAdviser(ADVISER_CHOICES.EDIT);
    if (hold) hold.resolve(ADVISER_CHOICES.EDIT);
    if (sheetDecision) sheetDecision.resolve(ADVISER_DECISIONS.EDIT);
    if (pending) {
      pending.resolve(ADVISER_DECISIONS.EDIT);
      pending = null;
    }
    hold = null;
    sheetDecision = null;
    if (view.busy || view.sheet) set({ busy: null, sheet: null });
  }

  function bumpUsage() {
    set({ usageVersion: view.usageVersion + 1 });
  }

  /** The read itself: context first (bounded), then cocoon. */
  function startRead(plan, state, { gate }) {
    const requester = config.requester;
    const found = { context: null };
    reader.setAnalyze(async (_text, { signal }) => {
      if (plan.context) {
        found.context = await gatherReplyContext(state, plan.context, {
          signal,
        });
      }
      return analyzePost(requester, analyzePayload(plan, found.context), {
        signal,
      });
    });
    const startedAt = now();
    set({
      busy: {
        mode: gate ? 'gate' : 'manual',
        goals: plan.goalItems,
        startedAt,
        choices: gate
          ? [ADVISER_CHOICES.PUBLISH, ADVISER_CHOICES.EDIT]
          : [ADVISER_CHOICES.EDIT],
      },
    });
    return reader
      .readAdviser(plan.source.text, { gate })
      .then((ended) => ({ ...ended, context: found.context, startedAt }));
  }

  /**
   * Keep the busy state up until READ_MIN_MS after the read started, so a
   * fast answer doesn't flash. Nothing is in flight; a choice still counts.
   * Resolves null when the hold ran out, else the choice.
   */
  async function holdFastAnswer(startedAt) {
    const left = readMinMs - (now() - startedAt);
    if (left <= 0) return null;
    hold = deferred();
    const choice = await Promise.race([
      sleep(left).then(() => null),
      hold.promise,
    ]);
    hold = null;
    return choice;
  }

  function openSheet(sheet) {
    sheetDecision = deferred();
    const decision = sheetDecision.promise;
    set({ busy: null, sheet });
    return decision.then((value) => {
      sheetDecision = null;
      return value;
    });
  }

  function sheetFor(mode, status, plan, state, extra = {}) {
    const posts = plan?.source?.posts || [];
    const setup = normalizeAdviserSettings(config.settings);
    return {
      mode,
      status,
      did: config.did,
      result: null,
      error: null,
      errorCode: null,
      scenario: plan?.scenario || 'post',
      context: null,
      contextKind: plan?.context || null,
      readTheRoom: setup.checkReplyContext,
      facts: plan?.facts || null,
      goalItems: plan?.goalItems || [],
      posts,
      texts: posts.slice(),
      taken: [],
      fixesTaken: false,
      // Publishing from the sheet posts now, so it isn't offered for a post
      // that's set to go out later; the gate only runs for Post now.
      canPublish: mode === 'gate' || !state?.schedule,
      canSaveDraft: true,
      state: state || null,
      usageLine: adviserUsageLineFor(config.did, { readUsage }),
      ...extra,
    };
  }

  async function check(state, { mode: asked = 'gate' } = {}) {
    const gate = asked !== 'manual';
    const mode = gate ? 'gate' : 'manual';
    endCurrent();
    const token = ++seq;
    const entry = deferred();
    pending = { token, resolve: entry.resolve };
    const live = () => pending?.token === token;
    const finish = (decision) => {
      if (!live()) return;
      pending = null;
      if (view.busy || view.sheet) set({ busy: null, sheet: null });
      entry.resolve(decision);
    };

    (async () => {
      if (!enabled()) {
        finish(gate ? ADVISER_DECISIONS.PUBLISH : ADVISER_DECISIONS.EDIT);
        return;
      }
      const did = config.did;
      // The allowance may have moved elsewhere (another tab, Settings).
      bumpUsage();
      const plan = adviserReadPlan(config.settings, state, {
        canUseAi: config.canUseAi,
        atLimit: atLimit(did),
        asDid: state?.asDid || did,
      });

      if (gate) {
        if (!plan.gate) return finish(ADVISER_DECISIONS.PUBLISH);
      } else {
        if (!plan.source.text)
          return finish(
            await openSheet(sheetFor('manual', 'needsText', plan, state)),
          );
        if (!plan.hasSomething)
          return finish(
            await openSheet(sheetFor('manual', 'empty', plan, state)),
          );
      }

      const ended = await startRead(plan, state, { gate });
      if (!live()) return;
      if (ended.outcome === 'result' || ended.outcome === 'error') bumpUsage();
      if (ended.outcome === 'cancelled') {
        return finish(
          ended.choice === ADVISER_CHOICES.PUBLISH && gate
            ? ADVISER_DECISIONS.PUBLISH
            : ADVISER_DECISIONS.EDIT,
        );
      }

      if (gate) {
        // Fail open: a failure or the deadline lets the post through.
        if (ended.outcome !== 'result' || !ended.result)
          return finish(ADVISER_DECISIONS.PUBLISH);
        if (!adviserShouldInterrupt(ended.result, plan.reviewMode))
          return finish(ADVISER_DECISIONS.PUBLISH);
      }

      const choice = await holdFastAnswer(ended.startedAt);
      if (!live()) return;
      if (choice) {
        return finish(
          choice === ADVISER_CHOICES.PUBLISH && gate
            ? ADVISER_DECISIONS.PUBLISH
            : ADVISER_DECISIONS.EDIT,
        );
      }

      const sheet =
        ended.outcome === 'result'
          ? sheetFor(gate ? 'gate' : 'manual', 'ready', plan, state, {
              result: ended.result,
              context: ended.context,
            })
          : ended.error?.code === 'monthly_limit'
            ? sheetFor(mode, 'limit', plan, state)
            : sheetFor(mode, 'error', plan, state, {
                error:
                  ended.error?.message ||
                  'The adviser couldn’t read this post. Try again.',
                errorCode: ended.error?.code || null,
              });
      finish(await openSheet(sheet));
    })().catch(() => {
      // Never hold a post on the adviser's own failure.
      finish(gate ? ADVISER_DECISIONS.PUBLISH : ADVISER_DECISIONS.EDIT);
    });

    return entry.promise;
  }

  /** A choice from the busy state: 'publish' or 'edit'. */
  function choose(choice) {
    if (!view.busy) return;
    if (hold) {
      hold.resolve(choice);
      return;
    }
    reader.chooseAdviser(choice);
  }

  /** The sheet's answer: 'publish', 'edit' or 'draft'. */
  function decide(decision) {
    if (!sheetDecision) return;
    const d = Object.values(ADVISER_DECISIONS).includes(decision)
      ? decision
      : ADVISER_DECISIONS.EDIT;
    sheetDecision.resolve(d);
  }

  /**
   * Take one or more of the sheet's fixes (`{ key, issue }` from
   * adviserSheetModel). The fixes land in the text as it stands now (earlier
   * fixes included), each in the first post holding its passage; the
   * composer gets every post's text back, by index.
   */
  function applyFix(fixes) {
    const sheet = view.sheet;
    if (!sheet || sheet.status !== 'ready') return 0;
    const fresh = asList(fixes).filter(
      (fix) => fix && fix.key && fix.issue && !sheet.taken.includes(fix.key),
    );
    if (!fresh.length) return 0;
    const { posts, applied } = applyWritingFixesToThread(
      sheet.texts.map((text) => ({ text })),
      fresh.map((fix) => fix.issue),
    );
    const texts = posts.map((post) => post.text);
    set({
      sheet: {
        ...sheet,
        texts,
        taken: [...sheet.taken, ...fresh.map((fix) => fix.key)],
        fixesTaken: sheet.fixesTaken || applied > 0,
      },
    });
    if (applied > 0) config.onApplyFixes?.(texts.slice());
    return applied;
  }

  return {
    check,
    choose,
    decide,
    applyFix,
    /** Take the composer's latest props. No side effects. */
    configure(next) {
      config = { ...config, ...next };
    },
    /** The account changed or the composer went away. */
    cancel: endCurrent,
    isEnabled: enabled,
    getView: () => view,
    usageLine: () => adviserUsageLineFor(config.did, { readUsage }),
  };
}
