// Timers on posts: the pure model (no side effects; `now` is injectable
// everywhere). A post published with a lifespan is acted on by Virga's server
// (cocoon) when it comes due: deleted, or its replies limited, or its quotes
// turned off, subject to optional conditions read from its public counts.
// Sense 'unless' spares the post when the clauses hold, 'onlyIf' acts only when
// they hold.
//
// Wire shape sent to cocoon (cocoon's lib/self-destruct.js is the authority; it
// re-normalizes everything it is sent and refuses what it can't read):
//
//   { lifespanSeconds, deleteAt?, conditions: {
//       logic:  'any' | 'all',
//       clauses: [{ metric, op, value }],   // likes replies reposts quotes selfReplies
//       sense:  'unless' | 'onlyIf',
//       onSpare: 'keep' | 'extend', maxExtensions },
//     effects: [{ action: 'limitReplies', allow } | { action: 'disableQuotes' } | { action: 'delete' }] }
//
// The duration and the optional pinned `deleteAt` instant are held side by side,
// never folded together: the duration survives pinning and unpinning, and
// deriving it from a pin would bake in publish latency (10 minutes stored as
// 8m35s). Only extendWindowSeconds reads a window out of a pin.

// Must match MIN/MAX_LIFESPAN_SECONDS in the cocoon library, which refuses
// anything outside the range.
export const MIN_LIFESPAN_SECONDS = 5 * 60;
export const MAX_LIFESPAN_SECONDS = 30 * 24 * 60 * 60;
export const MAX_EXTENSIONS_CAP = 10;

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Deliberately short; longer durations go through the custom box or the
// exact-time picker.
export const LIFESPAN_PRESETS = [
  { seconds: 5 * MINUTE, label: '5 minutes' },
  { seconds: 30 * MINUTE, label: '30 minutes' },
  { seconds: HOUR, label: '1 hour' },
  { seconds: 6 * HOUR, label: '6 hours' },
  { seconds: 12 * HOUR, label: '12 hours' },
  { seconds: DAY, label: '24 hours' },
  { seconds: 3 * DAY, label: '3 days' },
  { seconds: 7 * DAY, label: '1 week' },
];

export const DEFAULT_LIFESPAN_SECONDS = DAY;

// Units for the custom box. No "weeks": within the 30-day ceiling it would only
// ever be 1-4.
export const LIFESPAN_UNITS = [
  { key: 'minutes', seconds: MINUTE, label: 'minutes' },
  { key: 'hours', seconds: HOUR, label: 'hours' },
  { key: 'days', seconds: DAY, label: 'days' },
];

export function isPresetLifespan(seconds) {
  return LIFESPAN_PRESETS.some(
    (preset) => preset.seconds === normalizeLifespan(seconds),
  );
}

/**
 * A lifespan as { amount, unit } for the custom box, in the largest unit that
 * divides evenly (7200 → 2 hours, 5400 → 90 minutes) so "2 hours" doesn't come
 * back as "120 minutes". Falls back to minutes.
 */
export function splitLifespan(seconds) {
  const s = normalizeLifespan(seconds);
  for (let i = LIFESPAN_UNITS.length - 1; i > 0; i -= 1) {
    const unit = LIFESPAN_UNITS[i];
    if (s % unit.seconds === 0)
      return { amount: s / unit.seconds, unit: unit.key };
  }
  return { amount: Math.round(s / MINUTE), unit: 'minutes' };
}

/**
 * Seconds from the custom box, or null when empty or out of range. Not clamped:
 * this runs on every keystroke, and clamping a half-typed "1" up to the minimum
 * would fight someone typing "15".
 */
export function lifespanFromParts(amount, unitKey) {
  const unit =
    LIFESPAN_UNITS.find((u) => u.key === unitKey) || LIFESPAN_UNITS[0];
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return null;
  const seconds = Math.floor(n) * unit.seconds;
  if (seconds < MIN_LIFESPAN_SECONDS || seconds > MAX_LIFESPAN_SECONDS)
    return null;
  return seconds;
}

/** Largest whole amount of `unitKey` a timer may run for (bounds the custom box input). */
export function maxAmountForUnit(unitKey) {
  const unit =
    LIFESPAN_UNITS.find((u) => u.key === unitKey) || LIFESPAN_UNITS[0];
  return Math.floor(MAX_LIFESPAN_SECONDS / unit.seconds);
}

export const CONDITION_MODES = ['any', 'all'];
export const SPARE_ACTIONS = ['keep', 'extend'];

//   'unless'  the clauses SPARE the post ("delete in an hour unless it has 5 likes").
//   'onlyIf'  the clauses DOOM it ("delete in an hour only if >5 replies").
// Not an operator flip of each other: with no clauses, 'unless' deletes and
// 'onlyIf' keeps.
export const CONDITION_SENSES = ['unless', 'onlyIf'];

// The counts a clause can test, in editor order. selfReplies counts the author's
// own replies in the thread; cocoon reads it from the thread, not the post's
// counters.
export const METRICS = [
  { key: 'likes', label: 'Likes', noun: 'like' },
  { key: 'replies', label: 'Replies', noun: 'reply' },
  { key: 'reposts', label: 'Reposts', noun: 'repost' },
  { key: 'quotes', label: 'Quotes', noun: 'quote' },
  { key: 'selfReplies', label: 'Your replies', noun: 'reply of your own' },
];
export const METRIC_KEYS = METRICS.map((m) => m.key);
const METRIC_BY_KEY = Object.fromEntries(METRICS.map((m) => [m.key, m]));

// Two operators suffice for non-negative counts given the sense switch: "keep it
// if under 5" is "unless it reaches 5".
export const OPERATORS = [
  { key: 'gte', symbol: '≥', label: 'at least', phrase: '' },
  { key: 'gt', symbol: '>', label: 'more than', phrase: 'more than ' },
];
export const OPERATOR_KEYS = OPERATORS.map((o) => o.key);
const OPERATOR_BY_KEY = Object.fromEntries(OPERATORS.map((o) => [o.key, o]));

// Legacy threshold fields, still present on posting records written before
// clauses existed. Migrated on read; not a supported shape.
const LEGACY_THRESHOLDS = {
  minLikes: 'likes',
  minReplies: 'replies',
  minReposts: 'reposts',
};

export const MAX_CLAUSES = METRICS.length;

// Who the count is about. Quotes only: cocoon reads quoting posts with their
// authors, whereas a like count has no actors attached.
export const FILTERABLE_METRICS = ['quotes'];

export const ACTOR_TESTS = [
  {
    key: 'notFollowed',
    label: "People you don't follow",
    phrase: "you don't follow",
  },
  { key: 'followersOver', label: 'People with over…', phrase: 'with over' },
];

export const DEFAULT_FOLLOWERS_OVER = 10000;

/** Who a clause's count is about, or null for anyone (a filter that tests nothing is null). */
export function normalizeActorFilter(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {
    match: CONDITION_MODES.includes(src.match) ? src.match : 'any',
    notFollowed: !!src.notFollowed,
    followersOver: normalizeThreshold(src.followersOver),
  };
  if (!out.notFollowed && out.followersOver === null) return null;
  return out;
}

/**
 * Key for a clause's count. Must match cocoon's clauseCountKey exactly, since
 * cocoon writes the counts this reads.
 */
export function clauseCountKey(clause) {
  if (!clause || !clause.from) return clause ? clause.metric : '';
  const f = clause.from;
  const bits = [clause.metric, f.match];
  if (f.notFollowed) bits.push('notFollowed');
  if (f.followersOver !== null && f.followersOver !== undefined)
    bits.push(`followersOver:${f.followersOver}`);
  return bits.join('|');
}

/** "from people you don't follow", or nothing for a clause about everyone. */
export function describeFrom(clause) {
  const f = clause?.from;
  if (!f) return '';
  const parts = [];
  if (f.notFollowed) parts.push("you don't follow");
  if (f.followersOver)
    parts.push(`with over ${f.followersOver.toLocaleString()} followers`);
  if (parts.length === 0) return '';
  return ` from people ${parts.join(f.match === 'all' ? ' and ' : ' or ')}`;
}

export function plural(n, noun) {
  if (noun === 'reply') return n === 1 ? '1 reply' : `${n} replies`;
  // The self-replies noun is a phrase, so the plural is not on the last word.
  if (noun === 'reply of your own')
    return n === 1 ? '1 reply of your own' : `${n} replies of your own`;
  return n === 1 ? `1 ${noun}` : `${n} ${noun}s`;
}

/** A positive whole threshold, or null for "not part of the test". */
export function normalizeThreshold(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.floor(n);
  if (rounded <= 0) return null;
  return Math.min(rounded, 1_000_000);
}

/** A lifespan clamped into the range cocoon will accept. */
export function normalizeLifespan(value) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return DEFAULT_LIFESPAN_SECONDS;
  return Math.min(Math.max(n, MIN_LIFESPAN_SECONDS), MAX_LIFESPAN_SECONDS);
}

/** One clause, or null when it has no metric or threshold (an empty box is no clause, not ">= 0"). */
export function normalizeClause(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const metric = METRIC_BY_KEY[src.metric] ? src.metric : null;
  const value = normalizeThreshold(src.value);
  if (!metric || value === null) return null;
  const clause = {
    metric,
    op: OPERATOR_BY_KEY[src.op] ? src.op : 'gte',
    value,
  };
  const from = normalizeActorFilter(src.from);
  if (from && FILTERABLE_METRICS.includes(metric)) clause.from = from;
  return clause;
}

/**
 * Canonical condition shape from a settings record or modal state. Also migrates
 * the legacy `{ minLikes, minReplies, minReposts }` shape ("at least", sparing),
 * which still exists in synced posting settings on users' PDSes. No usable
 * clauses normalizes to an unconditional timer.
 */
export function normalizeConditions(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};

  // Deduped by clauseCountKey (same metric and same actor filter); first wins,
  // capped at MAX_CLAUSES.
  const seen = new Set();
  const clauses = [];
  const take = (clause) => {
    if (!clause || clauses.length >= MAX_CLAUSES) return;
    const key = clauseCountKey(clause);
    if (seen.has(key)) return;
    seen.add(key);
    clauses.push(clause);
  };
  for (const item of Array.isArray(src.clauses) ? src.clauses : [])
    take(normalizeClause(item));
  for (const [legacy, metric] of Object.entries(LEGACY_THRESHOLDS)) {
    if (legacy in src)
      take(normalizeClause({ metric, op: 'gte', value: src[legacy] }));
  }

  const out = {
    // `mode` was the legacy name for the same idea.
    logic: CONDITION_MODES.includes(src.logic)
      ? src.logic
      : CONDITION_MODES.includes(src.mode)
        ? src.mode
        : 'any',
    clauses,
    sense: CONDITION_SENSES.includes(src.sense) ? src.sense : 'unless',
    onSpare: SPARE_ACTIONS.includes(src.onSpare) ? src.onSpare : 'keep',
    maxExtensions: 0,
  };
  if (out.onSpare === 'extend') {
    const wanted = Number(src.maxExtensions);
    out.maxExtensions = Number.isFinite(wanted)
      ? Math.min(Math.max(Math.floor(wanted), 1), MAX_EXTENSIONS_CAP)
      : 1;
  }
  return out;
}

export function hasClauses(conditions) {
  return (normalizeConditions(conditions).clauses || []).length > 0;
}

export function clauseFor(conditions, metric) {
  return (
    (normalizeConditions(conditions).clauses || []).find(
      (c) => c.metric === metric,
    ) || null
  );
}

/**
 * Set, change or remove (null/zero value) one metric's clause, returning whole
 * conditions. The existing `from` actor filter is carried over unless the patch
 * has a `from` key (null included); the number box and op toggle don't know
 * about it and would otherwise widen the clause to everyone.
 */
export function withClause(conditions, metric, patch = {}) {
  const c = normalizeConditions(conditions);
  const existing = c.clauses.find((clause) => clause.metric === metric) || null;
  const { op, value } = patch;
  const from = Object.prototype.hasOwnProperty.call(patch, 'from')
    ? patch.from
    : existing?.from;
  const rest = c.clauses.filter((clause) => clause.metric !== metric);
  const next = normalizeClause({ metric, op, value, from });
  // Kept in metric order so a cleared-and-retyped row doesn't move.
  const clauses = next ? [...rest, next] : rest;
  clauses.sort(
    (a, b) => METRIC_KEYS.indexOf(a.metric) - METRIC_KEYS.indexOf(b.metric),
  );
  return { ...c, clauses };
}

// What a rule does when it fires, in apply order: reversible gate changes
// first, deletion always last.
export const EFFECTS = [
  { key: 'limitReplies', label: 'Limit replies', verb: 'Limits replies' },
  { key: 'disableQuotes', label: 'Turn off quotes', verb: 'Turns off quotes' },
  { key: 'delete', label: 'Delete the post', verb: 'Deletes itself' },
];
export const EFFECT_KEYS = EFFECTS.map((e) => e.key);

// Threadgate allow rules, in Bluesky's order.
export const ALLOW_OPTIONS = [
  { key: 'follower', label: 'Your followers', phrase: 'your followers' },
  { key: 'following', label: 'People you follow', phrase: 'people you follow' },
  {
    key: 'mention',
    label: 'People you mentioned',
    phrase: 'people you mentioned',
  },
];
export const ALLOW_KEYS = ALLOW_OPTIONS.map((a) => a.key);
const ALLOW_BY_KEY = Object.fromEntries(ALLOW_OPTIONS.map((a) => [a.key, a]));

// The threadgate lexicon caps `allow` at five rules.
export const MAX_ALLOW_RULES = 5;

/**
 * One allow entry: a known key, or `{ list, name? }` for one of the writer's
 * lists. The name is client-side only, for sentences; toWireSpec strips it.
 */
export function normalizeAllowEntry(entry) {
  if (ALLOW_KEYS.includes(entry)) return entry;
  if (
    entry &&
    typeof entry === 'object' &&
    typeof entry.list === 'string' &&
    entry.list.trim().startsWith('at://') &&
    entry.list.includes('/app.bsky.graph.list/')
  ) {
    const out = { list: entry.list.trim() };
    if (typeof entry.name === 'string' && entry.name.trim())
      out.name = entry.name.trim().slice(0, 64);
    return out;
  }
  return null;
}

/** Dedup/toggle key; list entries match by URI. */
export function allowEntryKey(entry) {
  return typeof entry === 'string' ? entry : `list:${entry.list}`;
}

// Effects that write a threadgate or postgate. The fitting functions take a
// `gatesSupported` flag for records that have neither; every post Virga writes
// is an app.bsky.feed.post, so composerTimerFit always says yes.
export const BLUESKY_ONLY_EFFECTS = ['limitReplies', 'disableQuotes'];

export function normalizeEffect(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  if (!EFFECT_KEYS.includes(src.action)) return null;
  if (src.action !== 'limitReplies') return { action: src.action };
  // Absent allow = followers; empty allow = nobody (a real choice, not defaulted).
  if (!Array.isArray(src.allow))
    return { action: 'limitReplies', allow: ['follower'] };
  const seen = new Set();
  const allow = [];
  for (const entry of src.allow) {
    const norm = normalizeAllowEntry(entry);
    if (!norm) continue;
    const key = allowEntryKey(norm);
    if (seen.has(key) || allow.length >= MAX_ALLOW_RULES) continue;
    seen.add(key);
    allow.push(norm);
  }
  return { action: 'limitReplies', allow };
}

/** Effects in apply order. Empty or unreadable means delete, matching cocoon's fallback. */
export function normalizeEffects(raw) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const effect = normalizeEffect(item);
    if (!effect || seen.has(effect.action)) continue;
    seen.add(effect.action);
    out.push(effect);
  }
  if (out.length === 0) return [{ action: 'delete' }];
  out.sort(
    (a, b) => EFFECT_KEYS.indexOf(a.action) - EFFECT_KEYS.indexOf(b.action),
  );
  return out;
}

export function effectsDelete(effects) {
  return normalizeEffects(effects).some((e) => e.action === 'delete');
}

export function effectFor(effects, action) {
  return normalizeEffects(effects).find((e) => e.action === action) || null;
}

/**
 * Toggle a gate effect on the timer from the reply-settings (thread
 * restrictions) side. Turning a gate on with no armed rule arms a gate-only rule
 * (never a delete); turning the last effect off disarms the timer instead of
 * falling back to deletion as the Lifespan editor would.
 *
 * Arming from disarmed starts clean: conditions cleared, spare action defaulted,
 * pinned deleteAt dropped. A disarmed timer can still carry an old rule that
 * this section never shows.
 */
export function withScheduledGateChange(timer, action, on) {
  const t = normalizeTimer(timer);
  if (!BLUESKY_ONLY_EFFECTS.includes(action)) return t;
  if (on) {
    if (t.enabled)
      return normalizeTimer({
        ...t,
        effects: withEffect(t.effects, action, true),
      });
    return normalizeTimer({
      ...t,
      enabled: true,
      deleteAt: null,
      conditions: normalizeConditions({}),
      effects: [normalizeEffect({ action })],
    });
  }
  const kept = normalizeEffects(t.effects).filter((e) => e.action !== action);
  if (kept.length === 0) return normalizeTimer({ ...t, enabled: false });
  return normalizeTimer({ ...t, effects: kept });
}

/** Set the deadline from the reply-settings side; drops any pinned instant, which would otherwise win. */
export function withScheduledGateLifespan(timer, seconds) {
  const t = normalizeTimer(timer);
  return normalizeTimer({
    ...t,
    lifespanSeconds: normalizeLifespan(seconds),
    deleteAt: null,
  });
}

/** The timer's gate effects seen from the reply-settings side. */
export function scheduledGateChange(timer) {
  const t = normalizeTimer(timer);
  if (!t.enabled) return { limitReplies: null, disableQuotes: false };
  return {
    limitReplies: effectFor(t.effects, 'limitReplies'),
    disableQuotes: !!effectFor(t.effects, 'disableQuotes'),
  };
}

export function withEffect(effects, action, on, extra = {}) {
  const rest = normalizeEffects(effects).filter((e) => e.action !== action);
  if (!on) return rest.length === 0 ? [] : rest;
  const next = normalizeEffect({ action, ...extra });
  if (!next) return rest;
  const out = [...rest, next];
  out.sort(
    (a, b) => EFFECT_KEYS.indexOf(a.action) - EFFECT_KEYS.indexOf(b.action),
  );
  return out;
}

/**
 * The timer without gate effects, for a record with no threadgate or postgate;
 * cocoon refuses gate effects on those. A rule left with no effects disarms
 * rather than falling back to delete.
 */
export function withoutGateEffects(timer) {
  return withoutEffects(timer, BLUESKY_ONLY_EFFECTS);
}

/** The timer without the named effects; disarms rather than deleting when nothing is left. */
export function withoutEffects(timer, actions) {
  const t = normalizeTimer(timer);
  if (!t.enabled) return t;
  const all = normalizeEffects(t.effects);
  const kept = all.filter((e) => !actions.includes(e.action));
  if (kept.length === all.length) return t;
  if (kept.length === 0) return normalizeTimer({ ...t, enabled: false });
  return normalizeTimer({ ...t, effects: kept });
}

/**
 * The timer without conditions, for a record with no public counts (cocoon
 * only evaluates app.bsky.feed.post).
 *   'unless'  clauses dropped; the rule runs on time unconditionally.
 *   'onlyIf'  the rule disarms, since dropping the clauses would turn "delete
 *             only if" into "delete".
 */
export function withoutConditions(timer) {
  const t = normalizeTimer(timer);
  if (!t.enabled || t.conditions.clauses.length === 0) return t;
  if (t.conditions.sense === 'onlyIf')
    return normalizeTimer({ ...t, enabled: false });
  return normalizeTimer({ ...t, conditions: normalizeConditions({}) });
}

/**
 * The timer a particular post can actually carry, derived from the writer's
 * rule. Fitting is lossy, so callers keep the rule as set and derive this for
 * display and sending; never store the result back over the rule.
 *
 *   gatesSupported        only an app.bsky.feed.post has a threadgate/postgate
 *   conditionsSupported   only an app.bsky.feed.post has counts to read
 *                         (both always true for what Virga posts; kept so the
 *                         rule model matches cocoon's)
 *   replyLimitSupported   Bluesky honours a threadgate only on a thread's root,
 *                         so replies drop limitReplies (disableQuotes is a
 *                         postgate and stays)
 *   available             whether cocoon can hold a timer at all
 */
export function fitTimerToPost(
  timer,
  {
    gatesSupported = true,
    conditionsSupported = true,
    replyLimitSupported = true,
    available = true,
  } = {},
) {
  let t = normalizeTimer(timer);
  if (!available)
    return t.enabled ? normalizeTimer({ ...t, enabled: false }) : t;
  if (!gatesSupported) t = withoutEffects(t, BLUESKY_ONLY_EFFECTS);
  else if (!replyLimitSupported) t = withoutEffects(t, ['limitReplies']);
  if (!conditionsSupported) t = withoutConditions(t);
  return t;
}

/** Whether two timers would do the same thing (any two disarmed ones do). */
export function sameTimer(a, b) {
  const x = normalizeTimer(a);
  const y = normalizeTimer(b);
  if (!x.enabled && !y.enabled) return true;
  return JSON.stringify(x) === JSON.stringify(y);
}

/**
 * The rule to keep after an edit in an editor that showed the fitted timer.
 * Parts the fit hid (conditions, gate effects) are carried over from the stored
 * rule, but only if doing so doesn't change the timer for this post (e.g. a
 * hidden 'onlyIf' clause would disarm it, so it gives way to the edit).
 */
export function keepHiddenRuleParts(edited, stored, fit = {}) {
  const e = normalizeTimer(edited);
  const s = normalizeTimer(stored);
  if (!s.enabled) return e;
  const {
    gatesSupported = true,
    conditionsSupported = true,
    replyLimitSupported = true,
  } = fit;
  let merged = e;
  if (!conditionsSupported && s.conditions.clauses.length > 0)
    merged = { ...merged, conditions: s.conditions };
  const hiddenActions = !gatesSupported
    ? BLUESKY_ONLY_EFFECTS
    : !replyLimitSupported
      ? ['limitReplies']
      : [];
  const hidden = s.effects.filter((effect) =>
    hiddenActions.includes(effect.action),
  );
  if (hidden.length > 0) {
    merged = {
      ...merged,
      effects: [
        ...e.effects.filter((effect) => !hiddenActions.includes(effect.action)),
        ...hidden,
      ],
    };
  }
  merged = normalizeTimer(merged);
  return sameTimer(fitTimerToPost(merged, fit), fitTimerToPost(e, fit))
    ? merged
    : e;
}

/** What fitting did to the writer's rule on this post, as an editor note; '' when it applies as written. */
export function describeFitChange(rule, fit = {}) {
  const r = normalizeTimer(rule);
  const {
    gatesSupported = true,
    conditionsSupported = true,
    replyLimitSupported = true,
    available = true,
  } = fit;
  if (!r.enabled || !available) return '';
  const isGate = (e) => BLUESKY_ONLY_EFFECTS.includes(e.action);
  const isReplyLimit = (e) => e.action === 'limitReplies';
  const gatesDropped = !gatesSupported && r.effects.some(isGate);
  const replyLimitDropped =
    gatesSupported && !replyLimitSupported && r.effects.some(isReplyLimit);
  const conditionsDropped =
    !conditionsSupported && r.conditions.clauses.length > 0;
  const parts = [];
  if (!fitTimerToPost(r, fit).enabled) {
    // Why it has no lifespan here at all.
    if (gatesDropped && r.effects.every(isGate)) {
      parts.push(
        'Your rule only changes reply and quote settings, which this post can’t have, so it has no lifespan here.',
      );
    } else if (replyLimitDropped && r.effects.every(isReplyLimit)) {
      parts.push(
        'Your rule only limits replies, which a reply can’t do, so this reply has no lifespan.',
      );
    } else if (conditionsDropped && r.conditions.sense === 'onlyIf') {
      parts.push(
        'Your “only if” rule can’t be checked on this post, so it has no lifespan here.',
      );
    }
  } else {
    if (gatesDropped)
      parts.push('Its reply and quote changes don’t apply to this post.');
    if (replyLimitDropped)
      parts.push('Limiting replies doesn’t apply to a reply.');
    if (conditionsDropped)
      parts.push('The conditions you set don’t apply here.');
  }
  if (parts.length === 0) return '';
  return `${parts.join(' ')} Your rule is kept as you set it, and applies again where it can.`;
}

/** 'your followers' / 'people you follow and people you mentioned' / 'nobody'. */
export function describeAllow(entries) {
  const parts = [];
  for (const entry of entries || []) {
    if (typeof entry === 'string') {
      const phrase = ALLOW_BY_KEY[entry]?.phrase;
      if (phrase) parts.push(phrase);
    } else if (entry && entry.list) {
      parts.push(
        entry.name ? `people in ${entry.name}` : 'people in a list you chose',
      );
    }
  }
  if (parts.length === 0) return 'nobody';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** e.g. 'Deletes itself', 'Limits replies to your followers', 'Turns off quotes and deletes itself'. */
export function describeEffects(effects) {
  const list = normalizeEffects(effects);
  const parts = list.map((effect, i) => {
    const meta = EFFECTS.find((e) => e.key === effect.action);
    // Only the first verb is capitalized, so the parts read as one sentence.
    const verb = i === 0 ? meta.verb : meta.verb.toLowerCase();
    if (effect.action !== 'limitReplies') return verb;
    return `${verb} to ${describeAllow(effect.allow)}`;
  });
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * An instant that may be picked right now (at least MIN_LIFESPAN ahead, within
 * MAX_LIFESPAN), or null. For the picker; a pin chosen earlier is judged at
 * publish time by pinnedDeadlineStatus.
 */
export function normalizeDeleteAt(value, now = Date.now()) {
  const iso = parseDeleteAt(value);
  if (!iso) return null;
  const at = new Date(iso).getTime();
  if (at <= now + MIN_LIFESPAN_SECONDS * 1000) return null;
  if (at > now + MAX_LIFESPAN_SECONDS * 1000) return null;
  return iso;
}

/**
 * A pinned instant as the timer holds it: any readable moment, or null.
 * Deliberately not bounded by the clock: dropping a near pin would silently fall
 * back to the duration (often 24h), and scheduled posts measure from publish
 * time. settleForPublish and scheduledTimerProblem judge it at publish.
 */
export function parseDeleteAt(value) {
  if (!value) return null;
  const at = new Date(value).getTime();
  if (!Number.isFinite(at)) return null;
  return new Date(at).toISOString();
}

// How long a picked time may have passed and still mean "as soon as allowed"
// rather than be refused. Must match PAST_DEADLINE_GRACE_MS in cocoon.
export const PAST_DEADLINE_GRACE_SECONDS = 60;

/**
 * Where a timer's pinned instant stands against the publish moment.
 *
 *   'none'     no pin (or no timer): the duration decides
 *   'ok'       between MIN_LIFESPAN and MAX_LIFESPAN after publish
 *   'tooSoon'  under MIN_LIFESPAN after publish, or passed within
 *              PAST_DEADLINE_GRACE_SECONDS (means "as soon as allowed")
 *   'passed'   passed longer ago than the grace; refused
 *   'tooLate'  more than MAX_LIFESPAN after publish
 */
export function pinnedDeadlineStatus(timer, publishAt = Date.now()) {
  const t = normalizeTimer(timer);
  if (!t.enabled || !t.deleteAt) return 'none';
  const at = new Date(t.deleteAt).getTime();
  const from = new Date(publishAt).getTime();
  if (at < from - PAST_DEADLINE_GRACE_SECONDS * 1000) return 'passed';
  if (at < from + MIN_LIFESPAN_SECONDS * 1000) return 'tooSoon';
  if (at > from + MAX_LIFESPAN_SECONDS * 1000) return 'tooLate';
  return 'ok';
}

/**
 * Why a post going out now can't keep its pinned time, as a composer error;
 * '' when it can. Checked before anything is written so a 'passed' or 'tooLate'
 * pin is refused rather than rewritten into a timer nobody picked.
 */
export function immediateTimerProblem(timer, now = Date.now()) {
  const status = pinnedDeadlineStatus(timer, now);
  if (status === 'passed') {
    return 'The delete time you picked for this post has already passed. Pick a new time or a length in its lifespan, then post again.';
  }
  if (status === 'tooLate') {
    return `The delete time you picked is more than ${formatLifespan(MAX_LIFESPAN_SECONDS)} away. Pick an earlier time or a length in its lifespan, then post again.`;
  }
  return '';
}

/**
 * The timer a just-published post actually gets. Runs after
 * immediateTimerProblem cleared the pin, so any staleness is publish latency:
 * a 'tooSoon'/'passed' pin becomes the MIN_LIFESPAN floor (never the duration
 * behind it). A pin past the ceiling is left for cocoon to refuse.
 *
 * @returns {{ timer: Object, adjusted: null | 'floor' }}
 */
export function settleForPublish(timer, now = Date.now()) {
  const t = normalizeTimer(timer);
  const status = pinnedDeadlineStatus(t, now);
  if (status === 'tooSoon' || status === 'passed') {
    return {
      timer: { ...t, deleteAt: null, lifespanSeconds: MIN_LIFESPAN_SECONDS },
      adjusted: 'floor',
    };
  }
  return { timer: t, adjusted: null };
}

/** Suffix for the "Posted." toast when settleForPublish moved the timer, or ''. Keep short. */
export function timerAdjustmentNote(adjusted, effects) {
  const deletes = effectsDelete(effects);
  if (adjusted === 'floor') {
    return deletes
      ? `The time you picked had passed, so it comes down in ${formatLifespan(MIN_LIFESPAN_SECONDS)}.`
      : `The time you picked had passed, so its timer runs in ${formatLifespan(MIN_LIFESPAN_SECONDS)}.`;
  }
  return '';
}

/**
 * The timer an immediate publish arms: fitTimerToPost, then settleForPublish.
 * The composer's arm step is exactly this.
 *
 * @returns {{ timer: Object, adjusted: null | 'floor', spec: Object|null }}
 */
export function immediateTimerToSend(rule, fit = {}, now = Date.now()) {
  const { timer, adjusted } = settleForPublish(fitTimerToPost(rule, fit), now);
  return { timer, adjusted, spec: toWireSpec(timer, now) };
}

/**
 * What a scheduled post carries: the rule fitted as the composer shows it
 * (`fit`), checked and measured against publishAt (the scheduled time, since a
 * scheduled post's window runs from when it goes out).
 *
 * @returns {{ problem: string, spec: Object|null }}
 */
export function scheduledTimerToSend(rule, { fit = {} } = {}, publishAt) {
  const timer = fitTimerToPost(rule, fit);
  const problem = scheduledTimerProblem(timer, publishAt);
  return { problem, spec: problem ? null : toWireSpec(timer, publishAt) };
}

/** Why moving a scheduled row to `whenISO` would break its pinned delete time, or ''. Catches reorders cocoon would refuse. */
export function scheduledRowTimerProblem(row, whenISO) {
  const spec = row?.payload?.selfDestruct;
  if (!spec || !spec.deleteAt) return '';
  return scheduledTimerProblem(
    { ...spec, enabled: true },
    new Date(whenISO).getTime(),
  );
}

/** Where a scheduled row's pinned delete time stands against `whenISO` (pinnedDeadlineStatus). */
export function scheduledRowDeadlineStatus(row, whenISO) {
  const spec = row?.payload?.selfDestruct;
  if (!spec || !spec.deleteAt) return 'none';
  return pinnedDeadlineStatus(
    { ...spec, enabled: true },
    new Date(whenISO).getTime(),
  );
}

/**
 * The `fit` (see fitTimerToPost) for the post in the composer; every surface and
 * both sends use it.
 *
 *   reply            the post is a reply (Bluesky honours a threadgate only on
 *                    a thread's root)
 *   unavailable      cocoon said it cannot hold a timer, or the account isn't
 *                    signed in through it
 *   editingExisting  no timer: changing an existing post isn't publishing one
 *
 * `available` means "can this post carry a timer", not just "is cocoon up";
 * otherwise a hidden, stale pin would still block a publish.
 */
export function composerTimerFit({
  editingExisting = false,
  unavailable = false,
  reply = false,
} = {}) {
  return {
    gatesSupported: true,
    conditionsSupported: true,
    replyLimitSupported: !reply,
    available: !unavailable && !editingExisting,
  };
}

/**
 * Why a post scheduled for `publishAt` can't keep its pinned instant, as a
 * sentence for the writer; '' when it can. The schedule is refused rather than
 * silently swapping the pin for the duration behind it.
 */
export function scheduledTimerProblem(timer, publishAt) {
  const t = normalizeTimer(timer);
  const status = pinnedDeadlineStatus(t, publishAt);
  const when = t.deleteAt ? describeDeleteAt(t.deleteAt) : '';
  const verb = effectsDelete(t.effects) ? 'delete it' : 'act on it';
  if (status === 'tooSoon' || status === 'passed') {
    return `This post’s lifespan is set to ${verb} ${when}, which is less than ${formatLifespan(MIN_LIFESPAN_SECONDS)} after it would go out. Pick a later delete time in its lifespan, or give it a length instead.`;
  }
  if (status === 'tooLate') {
    return `This post’s lifespan is set to ${verb} ${when}, more than ${formatLifespan(MAX_LIFESPAN_SECONDS)} after it would go out. Pick an earlier delete time in its lifespan, or give it a length instead.`;
  }
  return '';
}

/**
 * The parts of a stored rule this build cannot read, as sentences.
 *
 * The normalizers are lenient in a harsh direction: an unrecognised clause is
 * dropped (turning a conditional timer into an unconditional delete) and an
 * unrecognised effect falls back to delete. cocoon's validateArm refuses
 * unknown parts, but it only ever sees the normalized rule, so the check has to
 * happen here. Happens when an open tab of an older build reads posting
 * defaults written by a newer one.
 *
 * Not flagged: a threshold of 0, the stored encoding for "not part of the
 * test"; toWireSpec drops those clauses before cocoon sees them.
 *
 * @returns {string[]} empty when the whole rule was understood
 */
export function unreadableRuleParts(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = [];
  const conditions =
    src.conditions && typeof src.conditions === 'object' ? src.conditions : {};

  // A silent fallback on sense would invert the rule.
  if (
    conditions.sense !== undefined &&
    !CONDITION_SENSES.includes(conditions.sense)
  ) {
    out.push('which way its conditions point');
  }
  if (
    conditions.logic !== undefined &&
    !CONDITION_MODES.includes(conditions.logic)
  ) {
    out.push('whether its conditions need one match or all of them');
  }

  for (const item of Array.isArray(conditions.clauses)
    ? conditions.clauses
    : []) {
    if (!item || typeof item !== 'object') {
      out.push('a condition that could not be read');
      continue;
    }
    if (item.metric !== undefined && !METRIC_BY_KEY[item.metric]) {
      out.push(`a condition about “${String(item.metric)}”`);
      continue;
    }
    // An unknown op falls back to "at least", which can invert the clause.
    if (item.op !== undefined && !OPERATOR_BY_KEY[item.op]) {
      out.push('how one of its conditions compares its number');
      continue;
    }
    // A who-filter that normalizes away would widen the clause to everyone.
    if (
      item.from !== undefined &&
      item.from !== null &&
      !normalizeActorFilter(item.from)
    ) {
      out.push('who one of its conditions is about');
    }
  }

  for (const item of Array.isArray(src.effects) ? src.effects : []) {
    if (!item || typeof item !== 'object') {
      out.push('something it was set to do');
      continue;
    }
    if (item.action !== undefined && !EFFECT_KEYS.includes(item.action)) {
      out.push(`what “${String(item.action)}” was meant to do`);
    }
  }

  return out;
}

/**
 * Read a stored rule; anything unreadable disarms it (a kept post can be deleted
 * by hand, a wrongly deleted one can't be restored).
 *
 * @returns {{ timer: Object, unreadable: string[] }}
 */
export function readStoredTimer(raw) {
  const unreadable = unreadableRuleParts(raw);
  const timer = normalizeTimer(raw);
  return {
    timer: unreadable.length ? { ...timer, enabled: false } : timer,
    unreadable,
  };
}

// Drafts. A saved draft (a Bluesky private draft) has no field for a timer, so
// saving drops it and the composer resets to the default. The composer's local
// autosave does carry it.

/**
 * The posting default as a rule, from the account's posting settings
 * (`settings.lifespan`, whose `enabled` means "new posts get this timer"):
 * always a length, never a pinned instant. Read via readStoredTimer, so
 * unreadable parts disarm it. `defaultOn` is the same switch under the name
 * Anisota's settings record uses.
 */
export function defaultRuleFromSettings(lifespan) {
  const src = lifespan && typeof lifespan === 'object' ? lifespan : {};
  const enabled = src.enabled === undefined ? !!src.defaultOn : !!src.enabled;
  return readStoredTimer({ ...src, deleteAt: null, enabled }).timer;
}

/**
 * What the draft-saved confirmation says about the dropped timer, or '' when
 * the timer matches the default (which comes back on reopen anyway).
 */
export function draftTimerNote(rule, touched, defaults) {
  if (!touched || sameTimer(rule, defaults)) return '';
  return normalizeTimer(defaults).enabled
    ? 'Lifespan settings aren’t kept with drafts, so the default applies when you open it.'
    : 'Its lifespan isn’t kept with drafts.';
}

/** The timer as the session draft keeps it. Only a `touched` timer is restored; an untouched one follows the default. */
export function sessionDraftTimer(timer, touched) {
  return { timer: normalizeTimer(timer), touched: !!touched };
}

/** Said when cocoon reports timers unavailable while the writer has one set for the post. */
export const TIMERS_UNAVAILABLE_NOTE =
  'Post timers aren’t available right now, so this post will go out without the lifespan you set.';

/** Said when a restored timer's picked time had passed while the composer was closed. */
export const EXPIRED_DRAFT_TIMER_NOTE =
  'The delete time you picked for this post passed while it was closed, so its lifespan is off. Set a new one if you still want it.';

/**
 * The timer to put back from a session draft, or null to leave the default.
 * A pin that has 'passed' comes back disarmed and unpinned with `expired: true`
 * (still the writer's; the default doesn't take its place).
 *
 * @returns {{ timer: Object, expired: boolean } | null}
 */
export function restoreSessionDraftTimer(saved, now = Date.now()) {
  if (!saved || typeof saved !== 'object' || !saved.touched) return null;
  const timer = normalizeTimer(saved.timer);
  if (pinnedDeadlineStatus(timer, now) === 'passed') {
    return {
      timer: normalizeTimer({ ...timer, enabled: false, deleteAt: null }),
      expired: true,
    };
  }
  return { timer, expired: false };
}

/**
 * The whole timer, normalized. `enabled` is client-only and never sent; a
 * disabled timer is simply not sent.
 */
export function normalizeTimer(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: !!src.enabled,
    // Kept as picked, stale or not (see parseDeleteAt).
    deleteAt: parseDeleteAt(src.deleteAt),
    // Independent of deleteAt; a pin never overwrites it.
    lifespanSeconds: normalizeLifespan(src.lifespanSeconds),
    conditions: normalizeConditions(src.conditions),
    effects: normalizeEffects(src.effects),
  };
}

/**
 * The window a spared post gets again under `onSpare: 'extend'`: the duration,
 * or for a pinned instant, now → the pin. Mirrors what cocoon stores in
 * lifespan_seconds (cocoon's lib/self-destruct.js, validateArm).
 */
export function extendWindowSeconds(timer, now = Date.now()) {
  const t = normalizeTimer(timer);
  if (!t.deleteAt) return t.lifespanSeconds;
  return normalizeLifespan(
    Math.round((new Date(t.deleteAt).getTime() - now) / 1000),
  );
}

/**
 * The wire shape cocoon expects, or null when disarmed. `lifespanSeconds` is the
 * extend window measured client-side (server-side derivation would include
 * publish latency); cocoon uses it as given and `deleteAt` only as the deadline.
 * `now` is the publish moment (the scheduled time for a scheduled post).
 */
export function toWireSpec(timer, now = Date.now()) {
  const { timer: t } = settleForPublish(timer, now);
  if (!t.enabled) return null;
  const spec = {
    lifespanSeconds: extendWindowSeconds(t, now),
    conditions: t.conditions,
    // List display names are client-only; send just the URIs.
    effects: t.effects.map((effect) =>
      effect.action === 'limitReplies'
        ? {
            action: 'limitReplies',
            allow: effect.allow.map((a) =>
              typeof a === 'string' ? a : { list: a.list },
            ),
          }
        : effect,
    ),
  };
  if (t.deleteAt) spec.deleteAt = t.deleteAt;
  return spec;
}

// Sentences

/** A lifespan as a phrase: '30 minutes', '6 hours', '1 week'. */
export function formatLifespan(seconds) {
  const s = normalizeLifespan(seconds);
  const preset = LIFESPAN_PRESETS.find((p) => p.seconds === s);
  if (preset) return preset.label;
  // Unit by magnitude, not exact division (a pin-derived window is rarely
  // whole); rounding to the nearest unit is fine here.
  if (s < 90 * MINUTE) return plural(Math.round(s / MINUTE), 'minute');
  if (s < 2 * DAY) return plural(Math.round(s / HOUR), 'hour');
  return plural(Math.round(s / DAY), 'day');
}

/** The clauses as a phrase joined by the logic: '5 likes or more than 2 replies'. */
export function describeClauses(conditions) {
  const c = normalizeConditions(conditions);
  const parts = c.clauses.map((clause) => {
    const metric = METRIC_BY_KEY[clause.metric];
    const op = OPERATOR_BY_KEY[clause.op];
    return `${op.phrase}${plural(clause.value, metric.noun)}${describeFrom(clause)}`;
  });
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  const joiner = c.logic === 'all' ? ' and ' : ' or ';
  return `${parts.slice(0, -1).join(', ')}${joiner}${parts[parts.length - 1]}`;
}

/** e.g. 'today at 11:30 PM', 'tomorrow at 9:00 AM', 'Friday at 6:00 PM', '12 Sept at 6:00 PM'. */
export function describeDeleteAt(iso, now = Date.now()) {
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return '';
  const today = new Date(now);
  const days = Math.round(
    (new Date(at.getFullYear(), at.getMonth(), at.getDate()) -
      new Date(today.getFullYear(), today.getMonth(), today.getDate())) /
      86400000,
  );
  const time = at.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  if (days === 0) return `today at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  if (days > 1 && days <= 6)
    return `${at.toLocaleDateString(undefined, { weekday: 'long' })} at ${time}`;
  return `${at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} at ${time}`;
}

/** '1 hour' for a duration, or the pinned instant ('tomorrow at 9:00 AM'). */
export function describeWhen(timer, now = Date.now()) {
  const t = normalizeTimer(timer);
  return t.deleteAt
    ? describeDeleteAt(t.deleteAt, now)
    : formatLifespan(t.lifespanSeconds);
}

/** How a length is counted, for describeTimer: the post isn't out yet, or is. */
const COUNTED_FROM = {
  goesUp: 'after it goes up',
  wentUp: 'after it went up',
  now: 'from now',
};

/**
 * The full rule as one sentence for the composer, including what happens to
 * a spared post. `from` says where a length is counted from: 'goesUp' (a post
 * not out yet, the default), or for a post already out, 'wentUp' or 'now'.
 */
export function describeTimer(
  timer,
  now = Date.now(),
  { from = 'goesUp' } = {},
) {
  const t = normalizeTimer(timer);
  const c = t.conditions;
  const at = t.deleteAt
    ? describeDeleteAt(t.deleteAt, now)
    : `${formatLifespan(t.lifespanSeconds)} ${COUNTED_FROM[from] || COUNTED_FROM.goesUp}`;
  const does = describeEffects(t.effects);
  if (c.clauses.length === 0) return `${does} ${at}.`;

  const clauses = describeClauses(c);
  // "Stays up for good" only applies when the rule would have deleted.
  const deletes = effectsDelete(t.effects);
  const kept = deletes ? 'it stays up for good.' : 'nothing happens.';
  const spared =
    c.onSpare === 'extend'
      ? `${deletes ? 'it gets another' : 'this runs again in'} ${formatLifespan(extendWindowSeconds(t, now))}, up to ${plural(c.maxExtensions, 'time')}.`
      : kept;

  if (c.sense === 'onlyIf') {
    return `${does} ${at}, but only if it has ${clauses} by then. Otherwise ${spared}`;
  }
  return `${does} ${at}, unless it has ${clauses} by then. If it does, ${spared}`;
}

/** A compact label for the composer indicator: '1 hour', '1 hour · unless 5 likes'. */
export function timerChipLabel(timer, now = Date.now()) {
  const t = normalizeTimer(timer);
  const when = describeWhen(t, now);
  // Only name the action when it isn't delete.
  const does = effectsDelete(t.effects)
    ? when
    : `${describeEffects(t.effects).toLowerCase()} · ${when}`;
  if (t.conditions.clauses.length === 0) return does;
  const lead = t.conditions.sense === 'onlyIf' ? 'only if' : 'unless';
  return `${does} · ${lead} ${describeClauses(t.conditions)}`;
}

// Evaluation: preview only (e.g. "2 of 5 likes" in the timer list). cocoon
// makes the real decision against counts it reads itself.

export function evaluateConditions(conditions, counts) {
  const c = normalizeConditions(conditions);
  const got = readCounts(counts);
  if (c.clauses.length === 0)
    return { matched: false, spare: false, met: [], set: [] };

  const met = c.clauses.filter((clause) =>
    clause.op === 'gt'
      ? got[clause.metric] > clause.value
      : got[clause.metric] >= clause.value,
  );
  const matched =
    c.logic === 'all' ? met.length === c.clauses.length : met.length > 0;
  return {
    matched,
    spare: c.sense === 'onlyIf' ? !matched : matched,
    met: met.map((clause) => clause.metric),
    set: c.clauses.map((clause) => clause.metric),
  };
}

/** Counts in the evaluator's shape; absent reads as zero. */
export function readCounts(counts) {
  const src = counts || {};
  return {
    likes: Number(src.likes) || 0,
    replies: Number(src.replies) || 0,
    reposts: Number(src.reposts) || 0,
    quotes: Number(src.quotes) || 0,
    selfReplies: Number(src.selfReplies) || 0,
  };
}

// Countdown

/**
 * e.g. 'in 4 minutes', 'in 3 hours'. Past due reads 'any moment now': a due
 * timer has been claimed by the worker and is about to run.
 */
export function timeUntil(iso, now = Date.now()) {
  const at = new Date(iso).getTime();
  if (!Number.isFinite(at)) return '';
  const ms = at - now;
  if (ms <= 30 * 1000) return 'any moment now';
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `in ${plural(minutes, 'minute')}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `in ${plural(hours, 'hour')}`;
  return `in ${plural(Math.round(hours / 24), 'day')}`;
}

/**
 * The timer list grouped, each group sorted by compareTimers and dropped when empty:
 *
 *   live     still counting down (or mid-check)
 *   failed   gave up; the post is still up
 *   settled  default view: rules that fired without deleting in the last week
 *            (cocoon sends those after the live rows); with history, everything
 *            that has settled
 */
export function groupTimers(rows, { history = false } = {}) {
  const sorted = [...(rows || [])].sort(compareTimers);
  const live = sorted.filter(
    (row) => row?.status === 'armed' || row?.status === 'checking',
  );
  const failed = sorted.filter((row) => row?.status === 'failed');
  const settled = sorted.filter(
    (row) => !live.includes(row) && !failed.includes(row),
  );
  return [
    { key: 'live', title: 'Counting down', rows: live },
    { key: 'failed', title: 'Gave up, post still up', rows: failed },
    {
      key: 'settled',
      title: history ? 'Settled' : 'Changed this week',
      rows: settled,
    },
  ].filter((group) => group.rows.length > 0);
}

/**
 * Which of an account's two timer slots a timer takes: 'conditional' when
 * it reads counts before acting or does anything other than delete, else
 * 'plain'. Mirrors cocoon's lib/timer-limits.js timerBucket, which decides.
 */
export function timerBucket(timer) {
  const hasClauses = normalizeConditions(timer?.conditions).clauses.length > 0;
  const onlyDeletes = normalizeEffects(timer?.effects).every(
    (e) => e.action === 'delete',
  );
  return hasClauses || !onlyDeletes ? 'conditional' : 'plain';
}

/** cocoon's limit feature behind each bucket (`/api/limits/status`, a 402's `feature`). */
export const TIMER_BUCKET_FEATURE = {
  plain: 'postTimers',
  conditional: 'conditionalTimers',
};

/** The bucket behind each of cocoon's refusal features (a 402's `feature`). */
export const TIMER_SLOT_FEATURE_BUCKET = {
  postTimers: 'plain',
  conditionalTimers: 'conditional',
};

/**
 * What an account's timer slots hold, per bucket: live timers (cocoon's list)
 * plus scheduled and queued posts waiting with one, which hold theirs from
 * the moment they are scheduled. `exceptScheduledId` leaves out the row an
 * edit is rewriting.
 */
export function timerUsage({
  liveRows = [],
  scheduledRows = [],
  exceptScheduledId = null,
} = {}) {
  const usage = { plain: 0, conditional: 0 };
  for (const row of liveRows || []) {
    if (row?.status === 'armed' || row?.status === 'checking')
      usage[timerBucket(row)] += 1;
  }
  for (const row of scheduledRows || []) {
    if (exceptScheduledId && row?.id === exceptScheduledId) continue;
    if (
      (row?.status === 'pending' || row?.status === 'publishing') &&
      row?.payload?.selfDestruct
    ) {
      usage[timerBucket(row.payload.selfDestruct)] += 1;
    }
  }
  return usage;
}

/**
 * The sentence an account with a timer limit sees when the slot a timer needs
 * is taken, or '' when it is free. `limit` null means unlimited.
 */
export function timerSlotProblem({ bucket, limit, usage }) {
  if (limit == null || !usage || (usage[bucket] || 0) < limit) return '';
  return timerSlotSentence(bucket, limit);
}

/**
 * "This account can keep one … at a time …": the slot sentence on its own.
 * Plain, with no offer attached: the limit is cocoon's, shared with Anisota.
 */
export function timerSlotSentence(bucket, limit = 1) {
  const kind = bucket === 'conditional' ? 'conditional timer' : 'plain timer';
  const count = limit === 1 ? `one ${kind}` : `${limit} ${kind}s`;
  const taken = limit === 1 ? 'it’s in use' : 'all of them are in use';
  return `This account can keep ${count} at a time, counting scheduled posts, and ${taken}. Limits are shared with Anisota.`;
}

/**
 * The slot sentence for a cocoon refusal (`err.payload` of a 402/409 naming
 * `postTimers` or `conditionalTimers`), or '' for any other refusal.
 */
export function timerSlotRefusal(payload) {
  const bucket = TIMER_SLOT_FEATURE_BUCKET[payload?.feature];
  return bucket ? timerSlotSentence(bucket, payload?.limit ?? 1) : '';
}

/**
 * Why `rule` can't be armed right now under the account's limits, or '' when
 * it can (or when nothing is known: cocoon decides). `limits` is getLimits'
 * answer (`features[feature].limit`, `usage[feature]`). `holds` is the timer
 * a write already holds a slot for (the scheduled row being edited: its
 * `payload.selfDestruct`), which frees that slot for this one.
 */
export function timerRoomProblem(rule, limits, { holds = null } = {}) {
  const t = normalizeTimer(rule);
  if (!t.enabled || !limits) return '';
  const bucket = timerBucket(t);
  const feature = TIMER_BUCKET_FEATURE[bucket];
  const limit = limits.features?.[feature]?.limit;
  let used = limits.usage?.[feature];
  if (limit == null || !Number.isFinite(limit) || !Number.isFinite(used))
    return '';
  if (holds && typeof holds === 'object' && timerBucket(holds) === bucket)
    used -= 1;
  return used >= limit ? timerSlotSentence(bucket, limit) : '';
}

/**
 * Scheduled and queued posts that carry a lifespan and haven't gone out yet,
 * soonest first. Their timer is armed when they publish, so cocoon's timer
 * list doesn't hold them until then. Takes listScheduled's `rows`.
 */
export function waitingTimerRows(rows = []) {
  const at = (row) => new Date(row?.scheduledFor).getTime() || 0;
  return (rows || [])
    .filter(
      (row) =>
        row?.payload?.selfDestruct &&
        (row.status === 'pending' || row.status === 'publishing'),
    )
    .sort((a, b) => at(a) - at(b));
}

/** Live timers first (soonest first), then settled (most recent first). */
export function compareTimers(a, b) {
  const liveA = a?.status === 'armed' || a?.status === 'checking';
  const liveB = b?.status === 'armed' || b?.status === 'checking';
  if (liveA !== liveB) return liveA ? -1 : 1;
  const at = new Date(
    (liveA ? a?.checkAt : a?.resolvedAt) || a?.checkAt || 0,
  ).getTime();
  const bt = new Date(
    (liveB ? b?.checkAt : b?.resolvedAt) || b?.checkAt || 0,
  ).getTime();
  if (!Number.isFinite(at) || !Number.isFinite(bt)) return 0;
  return liveA ? at - bt : bt - at;
}
