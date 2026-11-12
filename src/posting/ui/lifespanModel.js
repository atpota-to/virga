// The timer editor's decisions, apart from React: which length is picked,
// what pressing an effect does, the reply rules of "Limit replies", and the
// notes under the rule. The rule model itself is timers/selfDestruct.js;
// everything here goes through it and hands back a whole TimerRule.

import {
  LIFESPAN_PRESETS,
  MAX_ALLOW_RULES,
  MAX_LIFESPAN_SECONDS,
  MIN_LIFESPAN_SECONDS,
  composerTimerFit,
  describeFitChange,
  describeTimer,
  effectFor,
  fitTimerToPost,
  immediateTimerProblem,
  normalizeConditions,
  normalizeEffects,
  normalizeTimer,
  pinnedDeadlineStatus,
  scheduledTimerProblem,
  timerRoomProblem,
  withClause,
  withEffect,
  allowEntryKey,
  normalizeAllowEntry,
} from '../timers/selfDestruct.js';

/** The rule with `patch` merged in, normalised. */
export function patchRule(rule, patch) {
  return normalizeTimer({ ...normalizeTimer(rule), ...patch });
}

/**
 * Which length button is pressed: `'exact'` for a pinned time, the preset's
 * seconds as a string, or `'custom'`.
 */
export function lengthChoice(rule) {
  const t = normalizeTimer(rule);
  if (t.deleteAt) return 'exact';
  return LIFESPAN_PRESETS.some((p) => p.seconds === t.lifespanSeconds)
    ? String(t.lifespanSeconds)
    : 'custom';
}

/** A preset or typed length: drops any pinned time, which would otherwise win. */
export function withLength(rule, seconds) {
  return patchRule(rule, { lifespanSeconds: seconds, deleteAt: null });
}

/** A pinned time (ISO), keeping the length behind it for when the pin is taken off. */
export function withPin(rule, iso) {
  return patchRule(rule, { deleteAt: iso || null });
}

/**
 * The effects after pressing one. Picking a gate while the rule only deletes
 * replaces the delete (it can be added back); turning the last effect off
 * falls back to delete, since a rule has to do something.
 */
export function toggleEffect(rule, action, { allow = ['follower'] } = {}) {
  const t = normalizeTimer(rule);
  const on = !!effectFor(t.effects, action);
  const deleteOnly = t.effects.length === 1 && t.effects[0].action === 'delete';
  let effects;
  if (!on && action !== 'delete' && deleteOnly) {
    effects = normalizeEffects([
      action === 'limitReplies' ? { action, allow } : { action },
    ]);
  } else {
    effects = withEffect(
      t.effects,
      action,
      !on,
      action === 'limitReplies' ? { allow } : {},
    );
  }
  return patchRule(t, { effects: normalizeEffects(effects) });
}

/** Who may still reply once replies are limited: keys and lists, ≤5; `[]` is nobody. */
export function withAllow(rule, allow) {
  const t = normalizeTimer(rule);
  if (!effectFor(t.effects, 'limitReplies')) return t;
  return patchRule(t, {
    effects: withEffect(t.effects, 'limitReplies', true, { allow }),
  });
}

/** The allow list with one key or list turned on or off (and "nobody" emptying it). */
export function toggleAllow(allow = [], entry) {
  const norm = normalizeAllowEntry(entry);
  if (!norm) return allow;
  const key = allowEntryKey(norm);
  const has = allow.some((a) => allowEntryKey(a) === key);
  if (has) return allow.filter((a) => allowEntryKey(a) !== key);
  if (allow.length >= MAX_ALLOW_RULES) return allow;
  return [...allow, norm];
}

/** One metric's clause set, changed or (empty value) removed. */
export function withMetric(rule, metric, patch) {
  const t = normalizeTimer(rule);
  return patchRule(t, { conditions: withClause(t.conditions, metric, patch) });
}

/** The conditions with `patch` merged (sense, logic, onSpare, maxExtensions). */
export function withConditions(rule, patch) {
  const t = normalizeTimer(rule);
  const next = { ...t.conditions, ...patch };
  if (
    patch.onSpare === 'extend' &&
    !(t.conditions.maxExtensions > 0) &&
    patch.maxExtensions === undefined
  )
    next.maxExtensions = 1;
  return patchRule(t, { conditions: normalizeConditions(next) });
}

/** The quote clause's "count quotes from" filter with `patch` merged; null clears it. */
export function withQuoteFilter(rule, patch) {
  const t = normalizeTimer(rule);
  const clause = t.conditions.clauses.find((c) => c.metric === 'quotes');
  if (!clause) return t;
  const from =
    patch === null
      ? null
      : {
          match: 'any',
          notFollowed: false,
          followersOver: null,
          ...(clause.from || {}),
          ...patch,
        };
  return withMetric(t, 'quotes', { op: clause.op, value: clause.value, from });
}

/** The bounds of an exact time, for the picker: from 5 minutes after `from` to 30 days after. */
export function pinBounds(from = Date.now()) {
  return {
    min: new Date(from + MIN_LIFESPAN_SECONDS * 1000 + 60_000).toISOString(),
    max: new Date(from + MAX_LIFESPAN_SECONDS * 1000).toISOString(),
  };
}

/**
 * The notes the editor shows under the rule, for the post it's on:
 *
 *   summary   the rule as it would run here, in a sentence ('' when off)
 *   fitNote   what fitting changed (a reply can't limit replies…)
 *   pin       why a pinned time can't be kept against when the post goes out
 *             (`pinBlocks` when it can't go out with it at all)
 *   room      why the account has no free timer for it
 *   thread    that a thread goes with its first post
 *
 * `fit` is the editor's `{ editingExisting?, reply?, thread? }`; `publishAt`
 * the scheduled time, else the post goes out now. `countFrom` is for a post
 * already out: 'now' or 'wentUp', where its length is counted from
 * (timerStart's `from`); left out, the post is still to go up.
 */
export function editorNotes(
  rule,
  {
    fit = {},
    publishAt = null,
    limits = null,
    holds = null,
    countFrom = 'goesUp',
    now = Date.now(),
  } = {},
) {
  const t = normalizeTimer(rule);
  const timerFit = composerTimerFit({
    editingExisting: !!fit.editingExisting,
    reply: !!fit.reply,
  });
  const fitted = fitTimerToPost(t, timerFit);
  const at = publishAt ? Date.parse(publishAt) : NaN;
  let pin = '';
  let pinBlocks = false;
  if (fitted.enabled && fitted.deleteAt) {
    pin = Number.isFinite(at)
      ? scheduledTimerProblem(fitted, at)
      : immediateTimerProblem(fitted, now);
    pinBlocks = Boolean(pin);
    if (
      !pin &&
      pinnedDeadlineStatus(fitted, Number.isFinite(at) ? at : now) === 'tooSoon'
    ) {
      pin = `That time is less than ${MIN_LIFESPAN_SECONDS / 60} minutes after it goes out, so it acts ${MIN_LIFESPAN_SECONDS / 60} minutes after instead.`;
    }
  }
  const deletes = fitted.effects.some((e) => e.action === 'delete');
  return {
    fitted,
    summary: fitted.enabled
      ? describeTimer(fitted, now, { from: countFrom })
      : '',
    fitNote: t.enabled ? describeFitChange(t, timerFit) : '',
    pin,
    pinBlocks,
    room: t.enabled ? timerRoomProblem(fitted, limits, { holds }) : '',
    thread:
      fitted.enabled && fit.thread && deletes
        ? 'The whole thread goes with its first post.'
        : '',
    unavailable:
      t.enabled && fit.editingExisting
        ? 'A post that’s already out can’t take a timer from here.'
        : '',
  };
}

/** The followersOver choices the quote filter offers. */
export const FOLLOWER_THRESHOLDS = [1000, 10000, 100000];

/** The maxExtensions choices "give it another…" offers. */
export const EXTENSION_CHOICES = [1, 2, 3, 5, 10];

/** Curate lists from app.bsky.graph.getLists, as `{ list, name }` entries. */
export function curateLists(lists = []) {
  return (lists || [])
    .filter(
      (l) =>
        l &&
        l.purpose === 'app.bsky.graph.defs#curatelist' &&
        typeof l.uri === 'string',
    )
    .map((l) => ({
      list: l.uri,
      name: String(l.name || 'A list').slice(0, 64),
    }));
}

/**
 * When a timer started at `startedAt` would first act: its pinned time, else
 * the start plus its length, and never sooner than five minutes from now
 * (cocoon's floor). Null when the rule is off.
 */
export function firstActAt(
  rule,
  { startedAt = Date.now(), now = Date.now() } = {},
) {
  const t = normalizeTimer(rule);
  if (!t.enabled) return null;
  const due = t.deleteAt
    ? Date.parse(t.deleteAt)
    : startedAt + t.lifespanSeconds * 1000;
  return new Date(Math.max(due, now + MIN_LIFESPAN_SECONDS * 1000));
}

/**
 * Where a timer on a post that's already out starts counting, as cocoon will
 * count it (validateArm): from when the post went up only while that's
 * inside the rule's length, otherwise from now. A start in the future (a
 * clock off) or one that can't be read also counts from now.
 *
 *   startedAt  the start to send as `postedAt`, in ms
 *   from       'wentUp' or 'now', the start that will actually be used
 *   passed     '' or, when 'posted' was asked for:
 *              'floor'    its time comes within five minutes, so it acts at
 *                         cocoon's five-minute floor
 *              'elapsed'  the whole length has already gone by, so cocoon
 *                         counts it again from now
 *
 * A pinned time doesn't depend on the start; it counts from now.
 */
export function timerStart(
  rule,
  { start = 'now', postedAt = null, now = Date.now() } = {},
) {
  const fromNow = { startedAt: now, from: 'now', passed: '' };
  const t = normalizeTimer(rule);
  if (start !== 'posted' || !t.enabled || t.deleteAt) return fromNow;
  const at = Date.parse(postedAt || '');
  if (!Number.isFinite(at) || at > now) return fromNow;
  const length = t.lifespanSeconds * 1000;
  if (now - at >= length) return { ...fromNow, passed: 'elapsed' };
  return {
    startedAt: at,
    from: 'wentUp',
    passed: at + length <= now + MIN_LIFESPAN_SECONDS * 1000 ? 'floor' : '',
  };
}
