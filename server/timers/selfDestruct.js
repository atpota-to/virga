/**
 * Post timers (self-destructing posts): store + executor.
 *
 * A post published with a lifespan: after the time the author chose, it is
 * deleted from their PDS. Unless it earned its keep: a timer can carry
 * conditions ("keep it if it reached five likes"), read from the AppView at the
 * moment the timer comes due, and effects other than deleting (limit replies,
 * turn quoting off).
 *
 * The mirror image of the scheduled-posts worker, and shaped like it on
 * purpose. A scheduled post is a record that does not exist yet and will be
 * written at a known time; a timed post is a record that already exists and
 * will be deleted at a known time. Both restore the user's OAuth session and
 * act on their PDS from a cron worker, and both keep their queue state
 * (status / attempts / locked_at) in Postgres rather than in the user's repo.
 *
 * Two responsibilities:
 *
 *   1. CRUD against the `self_destruct_posts` table (service role, bypasses
 *      RLS; every helper here is given an already-trusted user_did).
 *   2. resolveSelfDestruct(row): read the post's engagement, decide whether the
 *      author's conditions spare it, and either act on the post, extend the
 *      timer, or retire it as kept.
 *
 * ─── The safety bias ────────────────────────────────────────────────────────
 * Everything uncertain resolves toward KEEPING the post. A post can be
 * un-deleted by nobody, so a timer that cannot read the counts it was told to
 * check does not guess: it retries, and if it never manages, it fails with the
 * post still standing. The only thing a bug here should ever cost is a post that
 * outlived its timer.
 *
 * ─── Seams ──────────────────────────────────────────────────────────────────
 * Every network, database and OAuth call goes through `deps`, so tests can
 * stand in for any of them (ESM namespaces are frozen; this object is not).
 */

import { Agent } from '@atproto/api';
import { getSupabaseClient } from '../supabase.js';
import { getOAuthClient } from '../oauth/client.js';
import { safeFetchJson, safeFetch, readXrpcErrorBody } from '../net/safeFetch.js';
import { resolvePdsEndpoint } from '../net/didResolver.js';
import { envInt } from '../env.js';

export const deps = {
  getSupabaseClient: () => getSupabaseClient(),
  restoreSession: (did, options) => getOAuthClient().restoreSession(did, options),
  Agent,
  safeFetchJson,
  safeFetch,
  readXrpcErrorBody,
  resolvePdsEndpoint: (did) => resolvePdsEndpoint(did),
};

const TABLE = 'self_destruct_posts';

// ─── Guardrails ─────────────────────────────────────────────────────────────

// Five minutes is the shortest window the feature offers. Below that the cron's
// one-minute granularity is a large share of the lifespan, and a post that
// vanishes while its author is still looking at it reads as a bug rather than a
// choice.
const MIN_LIFESPAN_SECONDS = 5 * 60;
// Thirty days. Past a month "self-destructing" stops describing what is
// happening — that is an archive policy, and wants a different feature.
const MAX_LIFESPAN_SECONDS = 30 * 24 * 60 * 60;
// How far in the past a pinned deadline sent from the composer may be and still
// be read as the time the author picked (and floored), rather than refused. One
// minute: the round trip of a publish and an arm, with room for a retry.
const PAST_DEADLINE_GRACE_MS = 60 * 1000;
// What the row says when a pinned deadline had gone by before the post went out
// (or within its first five minutes) and the timer ran for the length the
// writer was shown instead. Written as the armed row's resolution, and carried
// into the sentence it settles with.
const MISSED_DEADLINE_NOTE =
  'the delete time you picked had passed before this post went out, so the timer ran for its original length instead';
// A flat anti-abuse ceiling on live timers per account
// (TIMER_MAX_ACTIVE_PER_USER). Not a tier: taking your own words back down is
// not something to charge for. Read at call time so a deploy can change it
// without a cold start, and passed to the arming RPC, which counts under a lock.
const DEFAULT_MAX_ACTIVE_PER_USER = 200;
function maxActivePerUser(env = process.env) {
  return envInt(env, 'TIMER_MAX_ACTIVE_PER_USER', DEFAULT_MAX_ACTIVE_PER_USER);
}
// How many times a spared post may be given its window again before it is kept
// for good. Bounded so an 'extend' rule cannot keep a row cycling forever.
const MAX_EXTENSIONS_CAP = 10;
// How deep a thread is walked for the author's own replies — both for the
// selfReplies metric and for taking late self-replies down with their root. A
// shallow cap silently made selfReplies thresholds above it unreachable on
// chain threads (each reply one level deeper), which read as "the rule never
// fired" when the truth was "we stopped counting". Deep enough for any real
// self-thread; the AppView accepts far more.
const THREAD_DEPTH = 50;
// The AppView caps app.bsky.feed.getPosts at 25 URIs per call.
const ENGAGEMENT_BATCH = 25;
// A thread deletes as a unit, so one timer may own this many records BEYOND
// the root. Wider than the scheduled-post thread cap (25), because
// the composer's IMMEDIATE thread length is unbounded and a timer that
// silently covered only the first stretch of a long thread would orphan the
// tail mid-thread when it fired. Past this ceiling the arm is REFUSED (the
// author hears "post went out, but without its timer") rather than sliced —
// partial coverage is the one thing this constant must never mean.
const MAX_THREAD_RECORDS = 100;

// Virga writes Bluesky posts only, so that is the only record a timer may act on.
const VALID_COLLECTIONS = ['app.bsky.feed.post'];
const CONDITION_MODES = ['any', 'all'];
const SPARE_ACTIONS = ['keep', 'extend'];

// Where public engagement counts are read from (BSKY_APPVIEW_URL). Read at call
// time, like every other setting here.
function appviewBase(env = process.env) {
  return (env.BSKY_APPVIEW_URL || 'https://public.api.bsky.app').replace(/\/+$/, '');
}

// ─── Failure codes ──────────────────────────────────────────────────────────
// The closed vocabulary written to self_destruct_posts.last_error_code, next to
// the human sentence in last_error, so the frontend can decide what to offer a
// reader without matching English prose. Same contract as scheduled_posts.
const FAILURE_CODES = Object.freeze([
  'SESSION_UNAVAILABLE',
  'ENGAGEMENT_UNAVAILABLE',
  'TIMED_OUT',
  'RATE_LIMITED',
  'REFUSED',
  'UNKNOWN',
]);
const FAILURE_CODE_SET = new Set(FAILURE_CODES);

function normalizeFailureCode(code) {
  return typeof code === 'string' && FAILURE_CODE_SET.has(code) ? code : null;
}

function codedError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/** Best guess at the machine-readable reason an attempt failed. */
function classifyFailure(err) {
  if (!err) return 'UNKNOWN';

  if (typeof err !== 'string') {
    const own = normalizeFailureCode(err.code);
    if (own) return own;
    const status = err.status ?? err.statusCode;
    const kind = err.error || '';
    if (status === 429 || kind === 'RateLimitExceeded') return 'RATE_LIMITED';
    if (status === 401 || status === 403 || kind === 'ExpiredToken' || kind === 'InvalidToken') return 'SESSION_UNAVAILABLE';
    if (kind === 'InvalidRequest' || kind === 'BlockedActor' || status === 400) return 'REFUSED';
  }

  const text = String((typeof err === 'string' ? err : err.message) || '').toLowerCase();
  if (!text) return 'UNKNOWN';
  if (/rate.?limit|too many requests|\b429\b/.test(text)) return 'RATE_LIMITED';
  if (/ran out of time|timed out|timeout|etimedout|socket hang up|aborted/.test(text)) return 'TIMED_OUT';
  if (/account session|invalid token|expired token|not authenticated|unauthorized/.test(text)) return 'SESSION_UNAVAILABLE';
  if (/engagement|read the counts|appview/.test(text)) return 'ENGAGEMENT_UNAVAILABLE';
  if (/invalidrequest|invalid request|rejected|refused|not allowed/.test(text)) return 'REFUSED';
  return 'UNKNOWN';
}

function isInvalidToken(err) {
  return err?.message === 'Invalid token' ||
    err?.message?.includes('Invalid token') ||
    err?.error === 'InvalidToken';
}

// A deployment without a database (a preview) has no timers, which the client
// reads as "the feature isn't on here", the same as a missing table.
function requireSupabase() {
  const supabase = deps.getSupabaseClient();
  if (!supabase) throw new SelfDestructUnavailableError();
  return supabase;
}

/**
 * Restore the DID's session, or null. The client wrapper answers null when the
 * grant is missing or a refresh fails, but rethrows when the client itself
 * never started (a missing or broken keyset), and that library message would
 * be stored on the row as an UNKNOWN failure the reader can do nothing with.
 * Both mean "couldn't reach the session", so both take the caller's
 * SESSION_UNAVAILABLE path; the real cause goes to the log.
 */
async function restoreSessionSafe(userDid, options) {
  try {
    return await deps.restoreSession(userDid, options);
  } catch (error) {
    console.error(`[self-destruct] couldn't restore the session for ${userDid}:`, error?.message || error);
    return null;
  }
}

/**
 * True when the database has never heard of this table or function: the
 * migration has not been applied to this project yet. Callers answer "not
 * available" rather than reporting a fault, which the client reads as "the
 * feature isn't on here".
 */
function isMissingSchema(error) {
  if (!error) return false;
  // PGRST202/205: unknown function/table in the schema cache. 42883/42P01: the
  // same as raw Postgres errors. PGRST204/42703: a column this code writes that
  // the table does not have.
  const code = error.code;
  if (['PGRST202', 'PGRST205', 'PGRST204', '42883', '42P01', '42703'].includes(code)) return true;
  return typeof error.message === 'string' &&
    /could not find the (function|table)|relation .* does not exist/i.test(error.message);
}

class SelfDestructUnavailableError extends Error {
  constructor() {
    super('self-destructing posts are not available on this server yet.');
    this.name = 'SelfDestructUnavailableError';
    this.code = 'UNAVAILABLE';
  }
}

// ─── at:// URIs ─────────────────────────────────────────────────────────────

/**
 * Split an at:// URI into its parts, or null if it isn't one we can act on.
 * Deliberately strict: the rkey it returns is handed to deleteRecord, so a URI
 * that doesn't parse cleanly must never make it into a row.
 */
function parseAtUri(uri) {
  if (typeof uri !== 'string') return null;
  const match = /^at:\/\/(did:[a-z0-9:._%-]+)\/([a-zA-Z0-9.-]+)\/([a-zA-Z0-9._~-]+)$/.exec(uri.trim());
  if (!match) return null;
  return { did: match[1], collection: match[2], rkey: match[3] };
}

// ─── Conditions ─────────────────────────────────────────────────────────────

// The counts a clause can test.
//
// Quotes are their own metric rather than part of reposts. They were folded in
// at first, on the argument that "3 people reposted it" means the same either
// way; a post being quoted five times is a different social event from being
// reposted five times, and usually the one worth reacting to.
//
// selfReplies counts the AUTHOR'S OWN continuations of the thread, which is the
// only metric here about what the author did rather than what anyone else did.
// It answers "did I actually finish this thread?", and it is read from the
// thread rather than from the post's counters (see readSelfReplies). Answers
// the author left under other people's replies are not continuations and do
// not count.
const METRIC_KEYS = ['likes', 'replies', 'reposts', 'quotes', 'selfReplies'];
const METRIC_NOUNS = {
  likes: 'like', replies: 'reply', reposts: 'repost',
  quotes: 'quote', selfReplies: 'reply of your own',
};
// The only metric that is not in the AppView's post view.
const THREAD_METRICS = new Set(['selfReplies']);

// Metrics whose count can be narrowed to particular people. Quotes only, for
// now: getQuotes hands back the quoting posts with their authors, so the people
// behind the number are reachable. Likes and reposts have their own endpoints
// and could follow the same shape; replies would need the thread walked.
const FILTERABLE_METRICS = new Set(['quotes']);

// How deep a filtered count reads. Five pages of 100 covers essentially every
// post; past that the rule reports that it stopped counting rather than
// quietly under-counting, because "the rule did not fire" and "we did not
// finish looking" must not look the same to a reader.
const FILTER_SCAN_PAGES = 5;
const FILTER_SCAN_PAGE_SIZE = 100;

// A follow list changes slowly and is read for every filtered check, so it is
// worth holding on to. Long enough to save the repeated read, short enough that
// following someone takes effect the same day.
const FOLLOWS_CACHE_MS = 6 * 60 * 60 * 1000;
// Nobody's follow list is walked forever. Past this the "not followed" test is
// answered from what was read, which can only over-count strangers; the rule
// errs toward firing, and the row says the list was truncated.
const FOLLOWS_MAX_PAGES = 25;
// How many accounts' follow lists one warm instance holds at a time.
const FOLLOWS_CACHE_MAX = 50;
// Filtered clauses are the only ones that cost more than one read, so a row
// cannot stack an unbounded number of them. The editor allows three clauses in
// total, so this is a backstop against a hand-written spec, not a limit anyone
// meets in the app.
const MAX_FILTERED_CLAUSES = 2;

/** did -> { at, dids:Set, truncated }. Per warm instance; empty is correct. */
const followsCache = new Map();
const nowMs = () => Date.now();

const OPERATOR_KEYS = ['gte', 'gt'];
const OPERATOR_PHRASES = { gte: '', gt: 'more than ' };

// Which way the clauses point. 'unless' spares the post, 'onlyIf' dooms it.
const CONDITION_SENSES = ['unless', 'onlyIf'];

// The pre-clause field names, still arriving from any posting record written
// before clauses existed. A migration table, not a supported shape.
const LEGACY_THRESHOLDS = { minLikes: 'likes', minReplies: 'replies', minReposts: 'reposts' };

const MAX_CLAUSES = METRIC_KEYS.length;

// ─── Effects ────────────────────────────────────────────────────────────────
//
// What a rule does when it fires. Until now there was one, implied by the
// table's name. Deleting is the heaviest thing an author can ask for and often
// not the thing they want: "ten people I don't follow quoted this, limit replies
// to my followers" leaves the post up and changes who can answer it.
//
// An array rather than one action, because gating replies AND disabling quotes
// is one decision. Order is fixed by EFFECT_ORDER at apply time, not by the
// array: gating a post that is about to be deleted is wasted work, and deleting
// one that was just gated throws the gate away with it.
const EFFECT_ACTIONS = ['limitReplies', 'disableQuotes', 'delete'];

// Deletion last, always. Everything else is a change to a post that stays up,
// and doing those first means a rule that dies partway through has still done
// the reversible half rather than the irreversible one.
const EFFECT_ORDER = EFFECT_ACTIONS;

// Who a threadgate may be narrowed to. Three named keys, plus list entries —
// `{ list: 'at://…/app.bsky.graph.list/…' }` — now that the composer has a
// picker for them.
const ALLOW_RULES = {
  follower: 'app.bsky.feed.threadgate#followerRule',
  following: 'app.bsky.feed.threadgate#followingRule',
  mention: 'app.bsky.feed.threadgate#mentionRule',
};
const ALLOW_KEYS = Object.keys(ALLOW_RULES);
const LIST_RULE = 'app.bsky.feed.threadgate#listRule';
// The threadgate lexicon caps `allow` at five rules.
const MAX_ALLOW_RULES = 5;

/**
 * One allow entry — a known key string, or `{ list }` naming an
 * app.bsky.graph.list record — or null for anything else. Extra fields (the
 * client keeps a display `name` beside the URI) are stripped, not refused:
 * only the URI travels to the PDS.
 */
function normalizeAllowEntry(entry) {
  if (ALLOW_KEYS.includes(entry)) return entry;
  const uri = entry && typeof entry === 'object' && typeof entry.list === 'string'
    ? entry.list.trim() : null;
  if (uri) {
    const parsed = parseAtUri(uri);
    if (parsed && parsed.collection === 'app.bsky.graph.list') return { list: uri };
  }
  return null;
}

/** Identity for dedup and intersection: two list entries match by URI. */
function allowEntryKey(entry) {
  return typeof entry === 'string' ? entry : `list:${entry.list}`;
}

/** The threadgate rule record one allow entry stands for. */
function allowRuleRecord(entry) {
  return typeof entry === 'string'
    ? { $type: ALLOW_RULES[entry] }
    : { $type: LIST_RULE, list: entry.list };
}

/** Identity of a rule record already ON a gate, for intersection. */
function allowRecordKey(record) {
  if (!record || typeof record.$type !== 'string') return null;
  return record.$type === LIST_RULE ? `list:${record.list}` : record.$type;
}

/**
 * The allow entry a rule record stands for — allowRuleRecord read backwards —
 * or null for a rule this module has no word for. Used to describe what was
 * actually WRITTEN, which after narrowAllow is not always what was asked.
 */
function allowEntryFromRecord(record) {
  if (!record || typeof record.$type !== 'string') return null;
  if (record.$type === LIST_RULE) return typeof record.list === 'string' ? { list: record.list } : null;
  return ALLOW_KEYS.find((key) => ALLOW_RULES[key] === record.$type) || null;
}

/**
 * One effect, or null when it says nothing.
 *
 * `allow: []` on limitReplies is meaningful — it is "nobody can reply" — so the
 * absent case has to be told apart from the empty one. An allow list that is
 * not an array at all is the absent case.
 */
function normalizeEffect(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  if (!EFFECT_ACTIONS.includes(src.action)) return null;
  if (src.action !== 'limitReplies') return { action: src.action };
  if (!Array.isArray(src.allow)) return { action: 'limitReplies', allow: ['follower'] };
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

/**
 * What a rule does when it fires, in apply order.
 *
 * An empty or unreadable list means delete: that is what every row written
 * before effects existed meant, and it is the only outcome the feature had.
 */
function normalizeEffects(raw) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    const effect = normalizeEffect(item);
    if (!effect || seen.has(effect.action)) continue;
    seen.add(effect.action);
    out.push(effect);
  }
  if (out.length === 0) return [{ action: 'delete' }];
  out.sort((a, b) => EFFECT_ORDER.indexOf(a.action) - EFFECT_ORDER.indexOf(b.action));
  return out;
}

/** Whether any effect removes the post. Decides the row's terminal status. */
function effectsDelete(effects) {
  return normalizeEffects(effects).some((e) => e.action === 'delete');
}

/** A positive integer threshold, or null for "not part of the test". */
function normalizeThreshold(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.floor(n);
  if (rounded <= 0) return null;
  // A threshold nobody could plausibly mean is a typo, not an instruction to
  // keep the post forever. Clamp rather than refuse: the post still goes.
  return Math.min(rounded, 1_000_000);
}

/** One clause, or null when it says nothing. */
function normalizeClause(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const metric = METRIC_KEYS.includes(src.metric) ? src.metric : null;
  const value = normalizeThreshold(src.value);
  if (!metric || value === null) return null;
  const clause = { metric, op: OPERATOR_KEYS.includes(src.op) ? src.op : 'gte', value };
  const from = normalizeActorFilter(src.from);
  if (from && FILTERABLE_METRICS.has(metric)) clause.from = from;
  return clause;
}

/**
 * Who the people behind a count have to be, or null for anyone.
 *
 * "Ten quotes" and "ten quotes from people I don't follow" are different
 * questions about the same number, and the second is usually the one worth
 * reacting to: a post travelling inside your own circle is not the thing that
 * makes you want to close the replies.
 *
 * Both tests are about the quoter, not the quote. `match` decides whether a
 * quoter has to satisfy one or all of them.
 */
function normalizeActorFilter(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {
    match: CONDITION_MODES.includes(src.match) ? src.match : 'any',
    notFollowed: !!src.notFollowed,
    followersOver: normalizeThreshold(src.followersOver),
  };
  // A filter that tests nothing is not a filter; it would silently count
  // everyone and read as though it were doing something.
  if (!out.notFollowed && out.followersOver === null) return null;
  return out;
}

/**
 * Canonical condition shape, from whatever the client sent, and the migration
 * from the shape this feature shipped with (minLikes / minReplies / minReposts,
 * always "at least", always sparing). Those live in posting settings records on
 * people's PDSes, so reading them is not optional.
 *
 * Always returns an object the evaluator can read. An input with no usable
 * clauses normalizes to a plain unconditional timer.
 */
function normalizeConditions(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};

  const seen = new Set();
  const clauses = [];
  // Two clauses about the same metric are the same clause twice, unless they
  // ask about different people: "10 quotes from strangers" and "3 quotes from
  // big accounts" are two rules, not one written twice.
  const take = (clause) => {
    if (!clause || clauses.length >= MAX_CLAUSES) return;
    const key = clauseCountKey(clause);
    if (seen.has(key)) return;
    seen.add(key);
    clauses.push(clause);
  };
  for (const item of Array.isArray(src.clauses) ? src.clauses : []) take(normalizeClause(item));
  for (const [legacy, metric] of Object.entries(LEGACY_THRESHOLDS)) {
    if (legacy in src) take(normalizeClause({ metric, op: 'gte', value: src[legacy] }));
  }
  clauses.sort((a, b) => METRIC_KEYS.indexOf(a.metric) - METRIC_KEYS.indexOf(b.metric));

  const out = {
    // `mode` was the legacy name for the same idea.
    logic: CONDITION_MODES.includes(src.logic) ? src.logic
      : CONDITION_MODES.includes(src.mode) ? src.mode
        : 'any',
    clauses,
    sense: CONDITION_SENSES.includes(src.sense) ? src.sense : 'unless',
    onSpare: SPARE_ACTIONS.includes(src.onSpare) ? src.onSpare : 'keep',
    maxExtensions: 0,
  };
  if (out.onSpare === 'extend') {
    const wanted = Number(src.maxExtensions);
    // An 'extend' rule with no usable count still has to stop somewhere; one
    // extension is the smallest thing that word can mean.
    out.maxExtensions = Number.isFinite(wanted)
      ? Math.min(Math.max(Math.floor(wanted), 1), MAX_EXTENSIONS_CAP)
      : 1;
  }
  return out;
}

/**
 * STRICT reading of an effects list, for the validation boundary.
 *
 * normalizeEffects is deliberately forgiving — a stored row from before effects
 * existed has to keep meaning "delete". But forgiveness is wrong at ARM time:
 * an effect this server does not recognise (a newer app against an older
 * server, a typo in a hand-written spec) would be silently replaced with
 * delete, and "delete" is never an acceptable stand-in for a rule the writer
 * meant to be gentler. Absent/empty still means delete — that is the feature's
 * original vocabulary, not an unknown word.
 */
function parseEffects(raw) {
  if (raw === null || raw === undefined) return { value: normalizeEffects(raw) };
  if (!Array.isArray(raw)) return { error: 'selfDestruct.effects must be a list' };
  for (const item of raw) {
    if (!normalizeEffect(item)) {
      return { error: 'that rule asks for something this server does not know how to do. update, or set a plain delete timer.' };
    }
    // Who a gate lets reply is refused when unreadable, not dropped: dropping
    // only ever narrows (safe), but the author asked for something specific
    // and should hear that it could not be read while they can act.
    if (item && item.action === 'limitReplies' && Array.isArray(item.allow)) {
      for (const entry of item.allow) {
        if (!normalizeAllowEntry(entry)) {
          return { error: 'who that rule lets reply could not be read. update, or choose again.' };
        }
      }
      if (item.allow.length > MAX_ALLOW_RULES) {
        return { error: `replies can be limited to at most ${MAX_ALLOW_RULES} groups.` };
      }
    }
  }
  return { value: normalizeEffects(raw) };
}

/**
 * STRICT reading of a conditions block, for the validation boundary.
 *
 * Same reasoning as parseEffects: a clause that normalizes away (unknown
 * metric, unusable threshold) silently turns "delete it unless…" into "delete
 * it, full stop", which is the harshest possible misreading. Legacy
 * minLikes/minReplies/minReposts shapes still pass — they are a known
 * vocabulary, not an unknown one. Also holds the filtered-clause ceiling the
 * evaluator enforces: arming a rule the evaluator will refuse to compute every
 * time is a timer that can only ever burn out.
 */
function parseConditions(raw) {
  if (raw === null || raw === undefined) return { value: normalizeConditions(raw) };
  if (typeof raw !== 'object') return { error: 'selfDestruct.conditions must be an object' };
  if (raw.sense !== undefined && !CONDITION_SENSES.includes(raw.sense)) {
    return { error: 'that rule\'s direction could not be read. update, or set a plain delete timer.' };
  }
  if (raw.logic !== undefined && !CONDITION_MODES.includes(raw.logic)) {
    return { error: 'that rule\'s any/all setting could not be read. update, or set a plain delete timer.' };
  }
  for (const item of Array.isArray(raw.clauses) ? raw.clauses : []) {
    if (!normalizeClause(item)) {
      return { error: 'a condition in that rule could not be read. update, or set a plain delete timer.' };
    }
    // A who-filter that normalizes away would quietly widen "quotes from
    // strangers" into "quotes from anyone" — a different rule, not a default.
    if (item && item.from !== undefined && item.from !== null && !normalizeActorFilter(item.from)) {
      return { error: 'who a condition is about could not be read. update, or set a plain delete timer.' };
    }
  }
  const value = normalizeConditions(raw);
  if (value.clauses.filter((c) => !!c.from).length > MAX_FILTERED_CLAUSES) {
    return { error: `at most ${MAX_FILTERED_CLAUSES} conditions can ask about particular people.` };
  }
  return { value };
}

/**
 * Where this clause's number lives in the counts object.
 *
 * A plain clause reads its metric. A filtered one reads a number nobody else
 * computed, so it gets its own key derived from what it asked for: two clauses
 * about different people are two different numbers, and two clauses asking the
 * same thing share one read.
 */
function clauseCountKey(clause) {
  if (!clause || !clause.from) return clause ? clause.metric : '';
  const f = clause.from;
  const bits = [clause.metric, f.match];
  if (f.notFollowed) bits.push('notFollowed');
  if (f.followersOver !== null) bits.push(`followersOver:${f.followersOver}`);
  return bits.join('|');
}

/** Clauses whose count has to be worked out person by person. */
function filteredClauses(conditions) {
  return normalizeConditions(conditions).clauses.filter((c) => !!c.from);
}

/** Whether anything would change the outcome. */
function hasClauses(conditions) {
  return normalizeConditions(conditions).clauses.length > 0;
}

/**
 * Whether any clause needs the thread read rather than the post's counters.
 *
 * selfReplies has no counter at all. `replies` HAS one, but it counts the
 * author's own thread continuations along with everyone else's answers, and a
 * clause about replies means other people — so it needs the thread too, to
 * subtract the author's own direct replies from the number. Without that, a
 * five-post thread arms "delete it unless anyone answered" already answered.
 */
function needsThread(conditions) {
  return normalizeConditions(conditions).clauses.some(
    (c) => THREAD_METRICS.has(c.metric) || c.metric === 'replies'
  );
}

/** Which post-view field each readable metric comes from. */
const VIEW_COUNT_FIELDS = {
  likes: 'likeCount',
  replies: 'replyCount',
  reposts: 'repostCount',
  quotes: 'quoteCount',
};

/**
 * Counts in the shape the evaluator reads, from an AppView post view.
 *
 * Every count on app.bsky.feed.defs#postView is OPTIONAL in the lexicon, and a
 * field that isn't there is silence, not a zero. The reference AppView sends
 * all four on every post, zeros included, so in practice `__absent` is always
 * empty — but BSKY_APPVIEW_URL is configurable, and the difference between
 * "nobody quoted this" and "this AppView doesn't report quotes" is the
 * difference between deleting the post and keeping it. Recorded rather than
 * flattened, so resolveSelfDestruct can refuse to fire on a metric nobody sent.
 * `__`-prefixed keys are ignored by readCounts, the same as `__truncated`.
 */
function countsFromPostView(view) {
  // One definition of "readable", used for both the value and the presence
  // test. Two definitions three lines apart is how a count ends up stored
  // correctly AND listed as missing — a numeric string reads perfectly through
  // Number() but is not `typeof 'number'`, and the rule would then be held
  // back forever on a number it actually had.
  const read = (field) => {
    const raw = view?.[field];
    if (raw === null || raw === undefined || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const out = { selfReplies: 0 };
  const absent = [];
  for (const [metric, field] of Object.entries(VIEW_COUNT_FIELDS)) {
    const n = read(field);
    out[metric] = n ?? 0;
    if (n === null) absent.push(metric);
  }
  if (absent.length) out.__absent = absent;
  return out;
}

/**
 * Metrics a clause depends on that the AppView never sent.
 *
 * The counts a rule fires on have to have come from somewhere. `__absent`
 * records which of the four view counters were silent rather than zero, and a
 * rule must not fire on silence.
 *
 * Only clauses that actually READ the view's number are held back, though. A
 * clause carrying a `from` filter gets its count from readFilteredQuotes, which
 * walks getQuotes and getProfiles itself and reports its own completeness
 * through __truncated — it never looks at counts.quotes. Keying this on the
 * bare metric would let an absent quoteCount block a rule whose number was read
 * perfectly well, and block it every time until the row ran out of attempts.
 */
function unreportedMetricsFor(conditions, counts) {
  const absent = Array.isArray(counts?.__absent) ? counts.__absent : [];
  if (absent.length === 0) return [];
  const clauses = normalizeConditions(conditions).clauses;
  return absent.filter(
    (metric) => clauses.some((clause) => clause.metric === metric && !clause.from)
  );
}

/**
 * What happens to this post, given its counts.
 *
 * 'any'  one clause met is enough (the forgiving reading, and the default).
 * 'all'  every clause has to be met.
 *
 * Then the sense decides what "met" costs the post: under 'unless' the clauses
 * spare it, under 'onlyIf' they are the reason it goes. A timer with no clauses
 * is never spared; that is what "delete it in an hour" means.
 *
 * @returns {{spare: boolean, matched: boolean, reason: string, met: string[]}}
 */
function evaluateConditions(conditions, counts) {
  const c = normalizeConditions(conditions);
  const got = readCounts(counts);
  if (c.clauses.length === 0) return { spare: false, matched: false, reason: 'no conditions', met: [] };

  const met = c.clauses.filter((clause) => {
    const key = clauseCountKey(clause);
    const value = got[key];
    if (value === undefined) {
      // A filtered clause whose count was never worked out. Reading it as zero
      // would answer "no" to a question nobody asked, and falling back to the
      // unfiltered count would answer with a larger number than the clause
      // means. Neither is safe in both senses, so this is a retry.
      throw codedError(
        `couldn't work out who quoted this post, so it was left up.`,
        'ENGAGEMENT_UNAVAILABLE'
      );
    }
    return clause.op === 'gt' ? value > clause.value : value >= clause.value;
  });
  const matched = c.logic === 'all' ? met.length === c.clauses.length : met.length > 0;
  const spare = c.sense === 'onlyIf' ? !matched : matched;

  return {
    spare,
    matched,
    met: met.map((clause) => clause.metric),
    reason: matched ? describeMet(got, met) : describeShortfall(c, got, met),
  };
}

/**
 * Counts in the evaluator's shape, with anything absent read as zero.
 *
 * Keys beyond the plain metrics are carried through as they are: a filtered
 * clause's count is computed elsewhere and lives under its own key. Absent is
 * left absent rather than zeroed, so the evaluator can tell "nobody" from "we
 * never worked it out".
 */
function readCounts(counts) {
  const src = counts || {};
  const out = {};
  for (const key of METRIC_KEYS) out[key] = Number(src[key]) || 0;
  for (const [key, value] of Object.entries(src)) {
    if (key.startsWith('__') || key in out) continue;
    out[key] = Number(value) || 0;
  }
  return out;
}

function plural(n, noun) {
  if (noun === 'reply') return n === 1 ? '1 reply' : `${n} replies`;
  if (noun === 'reply of your own') return n === 1 ? '1 reply of your own' : `${n} replies of your own`;
  return n === 1 ? `1 ${noun}` : `${n} ${noun}s`;
}

/** "from people you don't follow", or nothing for a clause about everyone. */
function describeFrom(clause) {
  const f = clause.from;
  if (!f) return '';
  const parts = [];
  if (f.notFollowed) parts.push("you don't follow");
  if (f.followersOver !== null) parts.push(`with over ${f.followersOver.toLocaleString('en-US')} followers`);
  if (parts.length === 0) return '';
  return ` from people ${parts.join(f.match === 'all' ? ' and ' : ' or ')}`;
}

function describeMet(got, met) {
  const parts = met.map((clause) => (
    plural(got[clauseCountKey(clause)], METRIC_NOUNS[clause.metric]) + describeFrom(clause)
  ));
  return `matched with ${parts.join(' and ')}`;
}

function describeShortfall(conditions, got, met) {
  const set = conditions.clauses;
  if (conditions.logic === 'all' && met.length > 0) {
    const missing = set.filter((clause) => !met.includes(clause));
    return `short of ${missing.map((clause) => plural(clause.value, METRIC_NOUNS[clause.metric]) + describeFrom(clause)).join(' and ')}`;
  }
  const parts = set.map((clause) => (
    `${got[clauseCountKey(clause)]} of ${OPERATOR_PHRASES[clause.op]}` +
    plural(clause.value, METRIC_NOUNS[clause.metric]) + describeFrom(clause)
  ));
  return `below ${parts.join(', ')}`;
}

// ─── Validation ─────────────────────────────────────────────────────────────

/**
 * Validate an arm request. Returns { ok, value } or { ok:false, error }.
 *
 * `userDid` is the already-trusted caller. The post URI must name that same
 * repo: a timer is a delete on someone's PDS, and the only PDS a session may
 * ever be pointed at is its own.
 *
 * `refusePastDeadline` is for the composer's own endpoint, where a deadline
 * that has already gone by is a request nobody at the keyboard meant: refuse
 * it and say so, rather than quietly turning "delete it at 1:40" into "delete
 * it five minutes from now". The publish worker leaves it off, because a
 * scheduled post that went out after its own deadline is exactly the case the
 * floor exists for — nobody is there to ask, and the post deserves its five
 * minutes.
 *
 * `missedDeadline` says what a pinned deadline that falls before the post has
 * stood its minimum (deleteAt < startedAt + 5 min) turns into:
 *
 *   'window' — the publish worker's default. The deadline was missed before or
 *              at publish: a late run, or a queued post dragged to a later
 *              slot after its delete time was picked. Nobody chose "five
 *              minutes", so the post gets the length the writer was shown —
 *              `lifespanSeconds`, which the composer sets to the window from
 *              the scheduled slot to the picked time — measured from when it
 *              actually went up. A post queued for Thursday 9am with a 6pm
 *              delete, moved to Friday 9am, stands until Friday 6pm rather
 *              than 9:05. `value.deadlineMissed` says this happened, and
 *              `value.note` is the sentence to record.
 *   'floor'  — the composer's (the default when refusePastDeadline is on). The
 *              author is at the keyboard and picked a time a few minutes out:
 *              "delete it at 1:40", set at 1:37, means as soon as it may.
 *
 * The floor holds either way: nothing is ever due sooner than five minutes
 * from now.
 */
function validateArm(
  { userDid, postUri, postCid, snippet, lifespanSeconds, conditions, postedAt, extraUris, deleteAt, effects },
  { refusePastDeadline = false, missedDeadline = refusePastDeadline ? 'floor' : 'window' } = {}
) {
  const parsed = parseAtUri(postUri);
  if (!parsed) return { ok: false, error: 'postUri must be an at:// URI' };
  if (parsed.did !== userDid) return { ok: false, error: 'you can only set a timer on your own post' };
  if (!VALID_COLLECTIONS.includes(parsed.collection)) {
    return { ok: false, error: 'a timer can only be set on a Bluesky post here' };
  }

  // What the rule says, read strictly: an effect or clause this server does
  // not recognise is refused here, while the author can act — the lenient
  // normalizers would default it to an unconditional delete.
  const parsedEffects = parseEffects(effects);
  if (parsedEffects.error) return { ok: false, error: parsedEffects.error };
  const parsedConditions = parseConditions(conditions);
  if (parsedConditions.error) return { ok: false, error: parsedConditions.error };
  const seconds = Math.floor(Number(lifespanSeconds));
  if (!Number.isFinite(seconds)) return { ok: false, error: 'lifespanSeconds is required' };
  if (seconds < MIN_LIFESPAN_SECONDS) {
    return { ok: false, error: `a post has to stand for at least ${MIN_LIFESPAN_SECONDS / 60} minutes` };
  }
  if (seconds > MAX_LIFESPAN_SECONDS) {
    return { ok: false, error: `a timer can run for at most ${MAX_LIFESPAN_SECONDS / 86400} days` };
  }

  // The clock starts when the post went out, not when the timer was written —
  // a scheduled post arms its timer from the worker, moments after publishing,
  // and an immediate one arms it from a device that may have been offline for a
  // minute. Anything unreadable, in the future, or older than the window itself
  // falls back to now, so a bad clock can never make a post due on arrival.
  const now = Date.now();
  let startedAt = now;
  if (postedAt) {
    const parsedAt = new Date(postedAt).getTime();
    if (Number.isFinite(parsedAt) && parsedAt <= now && now - parsedAt < seconds * 1000) {
      startedAt = parsedAt;
    }
  }

  // The rest of a thread. Every one has to be this user's, in a collection we
  // are willing to delete from — a timer must never become a way to point a
  // delete at a record the caller only named. Refused, never sliced, past the
  // ceiling: a timer that quietly covered part of a thread would fire and
  // orphan the tail mid-thread.
  const rawExtras = Array.isArray(extraUris) ? extraUris : [];
  if (rawExtras.length > MAX_THREAD_RECORDS) {
    return { ok: false, error: `a timer can cover a thread of at most ${MAX_THREAD_RECORDS + 1} posts` };
  }
  const extras = [];
  for (const uri of rawExtras) {
    const part = parseAtUri(uri);
    if (!part) return { ok: false, error: 'a post in that thread could not be read' };
    if (part.did !== userDid) return { ok: false, error: 'you can only set a timer on your own posts' };
    if (part.collection !== parsed.collection) {
      return { ok: false, error: 'every post in a thread has to be the same kind of record' };
    }
    if (uri.trim() === postUri.trim()) continue; // the root, named twice
    extras.push({ uri: uri.trim(), collection: part.collection, rkey: part.rkey });
  }

  // The floor: whatever the clock says, a post stands for at least the minimum
  // from NOW, the moment this timer is written. Measured from now rather than
  // from startedAt because startedAt is a claim about the past — a scheduled
  // post's slot, a device's clock — and a claim can be most of a window stale.
  // A fifteen-minute timer on a post that published fourteen minutes late was
  // due in sixty seconds when the floor was measured from the slot, which is
  // the "gone before anyone saw it" this floor exists to prevent. Applied to
  // both paths below, the duration as much as the pinned deadline.
  const floor = now + MIN_LIFESPAN_SECONDS * 1000;

  // A pinned deadline, when the author picked a particular evening rather than
  // a duration. It wins over the derived one — but never at the cost of the
  // floor: a post published later than its own deadline (a scheduled post that
  // went out late) would otherwise be due the moment it exists, and vanish
  // before anyone saw it. The same reasoning as the postedAt fallback above.
  const windowAt = Math.max(startedAt + seconds * 1000, floor);
  let checkAt = windowAt;
  let deadlineMissed = false;
  if (deleteAt) {
    const pinned = new Date(deleteAt).getTime();
    if (!Number.isFinite(pinned)) return { ok: false, error: 'deleteAt is not a valid datetime' };
    if (pinned > now + MAX_LIFESPAN_SECONDS * 1000) {
      return { ok: false, error: `a timer can run for at most ${MAX_LIFESPAN_SECONDS / 86400} days` };
    }
    // From the composer, a deadline already behind us is a mistake to report,
    // not a timer to invent. A minute of grace covers the round trip between
    // the composer reading the clock and this line running (a slow publish, a
    // retried request); anything older than that the author would not
    // recognise as the time they picked. A deadline in the near FUTURE is
    // still taken and floored below: "delete it at 1:40", set at 1:37, means
    // as soon as it may, and that is five minutes from now.
    if (refusePastDeadline && pinned < now - PAST_DEADLINE_GRACE_MS) {
      return {
        ok: false,
        error: 'that delete time has already passed, so no timer was set. pick a later time, or use a duration instead.',
      };
    }
    // A deadline the post missed before it had stood its minimum. Flooring it
    // would turn "Thursday 6pm" on a post moved to Friday 9am into "Friday
    // 9:05": the floor keeps the post from vanishing on arrival, but five
    // minutes is a length nobody picked. The publish worker gives it the window
    // the writer was shown instead (see `missedDeadline` above); the composer
    // still floors.
    if (missedDeadline === 'window' && pinned < startedAt + MIN_LIFESPAN_SECONDS * 1000) {
      deadlineMissed = true;
      checkAt = windowAt;
    } else {
      checkAt = Math.max(pinned, floor);
    }
  }

  return {
    ok: true,
    value: {
      postUri: postUri.trim(),
      postCid: typeof postCid === 'string' && postCid ? postCid : null,
      collection: parsed.collection,
      rkey: parsed.rkey,
      extraUris: extras,
      // A line of the post so the list can show what is on a timer. Never the
      // whole thing — the post itself lives on the PDS.
      snippet: typeof snippet === 'string' ? snippet.slice(0, 200) : null,
      // What an 'extend' spare hands the post again: the window the author was
      // shown, taken as the client sent it.
      //
      // Deliberately NOT re-derived from a pinned deadline. That subtracted the
      // publish from the window — a ten-minute timer set at 1:30 for 1:40, on a
      // post that landed at 1:31:24, was stored as 8m35s, and an extend would
      // then hand back the latency rather than the promise. The composer is the
      // only place that knows what the author actually read (the client's
      // toWireSpec), and `deleteAt` below still decides the deadline itself.
      lifespanSeconds: seconds,
      checkAt: new Date(checkAt).toISOString(),
      conditions: parsedConditions.value,
      // What happens when the rule fires. Parsed STRICTLY here rather than
      // normalized: an unknown action must be refused while the author can be
      // told, never silently replaced with the delete it would default to.
      effects: parsedEffects.value,
      // Set when a pinned deadline had already gone by before the post stood
      // its minimum, and the timer runs for its original length instead.
      // armSelfDestruct records `note` on the row.
      deadlineMissed,
      note: deadlineMissed ? MISSED_DEADLINE_NOTE : null,
    },
  };
}

// ─── CRUD ───────────────────────────────────────────────────────────────────

const LIST_COLUMNS = [
  'id', 'post_uri', 'post_cid', 'collection', 'rkey', 'snippet', 'extra_uris', 'posted_at',
  'check_at', 'status', 'conditions', 'lifespan_seconds', 'extensions',
  'last_counts', 'resolution', 'resolved_at', 'attempts', 'max_attempts',
  'last_error', 'last_error_code', 'effects', 'acted', 'created_at',
].join(', ');

/**
 * Arm a timer on an already-published post.
 *
 * Idempotent per live post: arming the same post twice hands back the timer
 * that is already there instead of racing two deletes. Throws
 * SelfDestructUnavailableError when the table or its function is missing, so
 * the caller can answer "not available" rather than "something broke", and a
 * QUOTA_EXCEEDED error when the account is at the live-timer ceiling.
 *
 * `note` (validateArm's, when a pinned deadline had already gone by) is written
 * as the armed row's resolution, so the row says why it is running longer than
 * the time that was picked, and resolveSelfDestruct carries it into the
 * sentence the row settles with.
 *
 * An existing timer comes back with `updated`: true when it was rewritten to
 * the new rule, false when it was left as it was (it is being checked).
 *
 * @returns {Promise<{ row: object, existing: boolean, updated?: boolean }>}
 */
async function armSelfDestruct({ userDid, postUri, postCid, collection, rkey, snippet, extraUris, lifespanSeconds, checkAt, conditions, effects, note = null }) {
  const supabase = requireSupabase();
  const max = maxActivePerUser();
  const wanted = normalizeEffects(effects);
  // A plain delete stores NULL effects, which is what "absent" has always
  // meant; anything else stores the normalized list.
  const custom = !effectsDelete(wanted) || wanted.length > 1;
  const { data, error } = await supabase.rpc('create_self_destruct_capped', {
    p_user_did: userDid,
    p_post_uri: postUri,
    p_post_cid: postCid ?? null,
    p_collection: collection,
    p_rkey: rkey,
    p_snippet: snippet ?? null,
    p_extra_uris: Array.isArray(extraUris) ? extraUris : [],
    p_check_at: checkAt,
    p_lifespan_seconds: lifespanSeconds,
    p_conditions: conditions,
    p_max_active: max,
    p_effects: custom ? wanted : null,
  });

  if (error) {
    if (isMissingSchema(error)) throw new SelfDestructUnavailableError();
    throw new Error(error.message);
  }
  if (data && data.ok === false) {
    const limit = Number.isFinite(Number(data.limit)) ? Number(data.limit) : max;
    throw Object.assign(codedError(`you can have at most ${limit} posts on a timer`, 'QUOTA_EXCEEDED'), { limit });
  }
  if (!data || !data.row) throw new Error('the timer could not be saved');

  // Arming a post that already has a live timer hands that timer back, but a
  // re-arm that carries a DIFFERENT rule is the author changing their mind,
  // and silently keeping the old rule made "Update timer" a button that did
  // nothing. An 'armed' row is rewritten to the new ask (a retry with the
  // identical spec rewrites it to itself, which is harmless); a 'checking' row
  // is mid-evaluation and left alone, exactly like cancel.
  if (data.existing && data.row.status === 'armed') {
    const { data: updated, error: updErr } = await supabase
      .from(TABLE)
      .update({
        conditions,
        // Written explicitly, plain delete included, so the row says what it
        // means rather than leaning on the absent-means-delete default.
        effects: wanted,
        lifespan_seconds: lifespanSeconds,
        check_at: checkAt,
        snippet: snippet ?? null,
        post_cid: postCid ?? null,
        extra_uris: Array.isArray(extraUris) ? extraUris : [],
        // A new rule is a fresh start, and nothing the OLD rule decided or
        // suffered may carry across to it.
        //
        // `acted` is the one that matters. On an armed row it can only hold the
        // pending verdict an earlier attempt pinned before its effects were cut
        // short (every write of a real outcome also writes a terminal status, so
        // a settled `acted` never sits on an armed row). Left in place, the next
        // claim resumes that verdict (counts read under the old rule, acted on
        // under the new one) and resolveSelfDestruct deletes on numbers the new
        // rule never looked at. Cleared outright rather than only-if-pending:
        // the row may have been claimed, pinned and requeued since the RPC read
        // it, and a decision made from that stale copy would miss exactly the
        // marker it exists to clear.
        acted: null,
        // What the row says about itself while armed: the missed-deadline note
        // when this arm has one, and otherwise nothing the old rule left (an
        // extension's "kept for now", an earlier note).
        resolution: note || null,
        // And the failures were the old rule's. A new rule that inherits four
        // spent attempts has one try left before it gives up, and a backoff
        // timestamp from the old rule would hold the new deadline back.
        attempts: 0,
        next_attempt_at: null,
        last_error: null,
        last_error_code: null,
        // Extensions spent under the old rule would come off the new rule's
        // maxExtensions, so a new "extend once" could be spent before it ran.
        extensions: 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', data.row.id).eq('status', 'armed')
      .select().single();
    // A row claimed between the RPC and this write (PGRST116), or any other
    // hiccup: the timer that is there stands, which is what `existing` means.
    if (!updErr && updated) return { row: updated, existing: true, updated: true };
  }

  // An existing timer that was not rewritten: mid-check, or claimed under the
  // rewrite. `updated: false` lets the caller tell "this is already your rule"
  // from "your new rule was not taken" (sameTimerRule).
  if (data.existing) return { row: data.row, existing: true, updated: false };

  if (note && !data.existing && data.row.id) {
    // The insert RPC takes no resolution, so the note is a second, best-effort
    // write. Losing it costs the row a sentence, not its timer (the timer is
    // already armed with the right deadline), so a failure is logged, not
    // thrown.
    const { data: noted, error: noteErr } = await supabase
      .from(TABLE)
      .update({ resolution: note, updated_at: new Date().toISOString() })
      .eq('id', data.row.id).eq('status', 'armed')
      .select().single();
    if (noteErr) {
      console.warn(`[self-destruct] could not note the missed deadline on ${data.row.id}: ${noteErr.message}`);
    } else if (noted) {
      return { row: noted, existing: false };
    }
  }

  return { row: data.row, existing: false };
}

/** JSON with object keys sorted, so two readings of one rule compare equal. */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort()
      .filter((k) => value[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/**
 * Whether a stored timer already carries the rule a re-arm asks for: what
 * spares or dooms the post, what it does, and the window. The deadline is left
 * out on purpose. This is asked of a row armSelfDestruct could not rewrite
 * (one being checked), whose deadline has by definition arrived, so it never
 * equals a new one, and comparing it would refuse the retry of an arm that
 * already landed.
 */
function sameTimerRule(row, { conditions, effects, lifespanSeconds }) {
  if (!row) return false;
  if (Number(row.lifespan_seconds) !== Number(lifespanSeconds)) return false;
  if (canonicalJson(normalizeEffects(row.effects)) !== canonicalJson(normalizeEffects(effects))) return false;
  return canonicalJson(normalizeConditions(row.conditions)) === canonicalJson(normalizeConditions(conditions));
}

// Statuses whose post is still waiting on its timer. Read first and given the
// whole cap: these are the timers that will act on a post.
const COUNTING_STATUSES = ['armed', 'checking'];
// Settled with the post gone or kept, shown only when the reader asks for
// history. 'acted' is settled too, but the default list shows a recent one.
const SETTLED_STATUSES = ['acted', 'deleted', 'spared'];
// How long a rule that fired without deleting stays on the default list. The
// gate it applied is still on the post and the reader may want it off, but an
// 'acted' row cannot be dismissed, and with no horizon they would accumulate
// until they pushed live timers off the end of the page.
const RECENT_ACTED_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The caller's timers, for the timers page.
 *
 * Three reads, each into the room the one before it left, so nothing lower
 * down can push anything higher up off the end of the cap:
 *
 *   1. Timers still counting down (armed, checking), soonest first. These are
 *      the ones that will act on a post, and they get the whole cap first.
 *   2. Timers that gave up (failed), most recently first.
 *   3. By default, rules that fired without deleting in the last week (acted),
 *      newest first; with `includeResolved` (?history=1), every settled row
 *      (acted, deleted, spared), newest first.
 *
 * One read sorted by check_at would let 'acted' and 'failed' rows (both with a
 * check_at in the past) sort to the top until a reader with enough of them
 * could not see the timer about to delete their post. Cancelled rows are never
 * listed.
 */
async function listSelfDestructs(userDid, { includeResolved = false, limit = 100 } = {}) {
  const supabase = requireSupabase();
  const cap = Math.min(Math.max(Number(limit) || 100, 1), 200);

  const read = async (narrow) => {
    const { data, error } = await narrow(supabase.from(TABLE).select(LIST_COLUMNS).eq('user_did', userDid));
    if (error) {
      if (isMissingSchema(error)) throw new SelfDestructUnavailableError();
      throw new Error(error.message);
    }
    return data || [];
  };

  const counting = await read((query) => query
    .in('status', COUNTING_STATUSES)
    .order('check_at', { ascending: true })
    .limit(cap));
  if (counting.length >= cap) return counting;

  const failed = await read((query) => query
    .eq('status', 'failed')
    .order('resolved_at', { ascending: false, nullsFirst: false })
    .limit(cap - counting.length));
  const live = [...counting, ...failed];
  if (live.length >= cap) return live;

  const room = cap - live.length;
  const settled = includeResolved
    ? await read((query) => query
      .in('status', SETTLED_STATUSES)
      .order('resolved_at', { ascending: false, nullsFirst: false })
      .limit(room))
    : await read((query) => query
      .eq('status', 'acted')
      .gte('resolved_at', new Date(Date.now() - RECENT_ACTED_MS).toISOString())
      .order('resolved_at', { ascending: false, nullsFirst: false })
      .limit(room));
  return [...live, ...settled];
}

/**
 * Call off a timer the user owns, leaving the post where it is.
 *
 * Accepts 'armed' and 'failed' (dismissing a timer that gave up is this same
 * call). A 'checking' row may be mid-delete and is left alone: there is
 * nothing useful to promise about a post whose deletion is already in flight.
 *
 * @returns {Promise<object|null>} the cancelled row, or null when there is no
 *   such timer of this DID's in a status that can be called off.
 */
async function cancelSelfDestruct(id, userDid) {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from(TABLE)
    .update({
      status: 'cancelled',
      resolution: 'called off',
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id).eq('user_did', userDid).in('status', ['armed', 'failed'])
    .select().single();
  if (error) {
    if (error.code === 'PGRST116') return null;
    if (isMissingSchema(error)) throw new SelfDestructUnavailableError();
    throw new Error(error.message);
  }
  return data;
}

async function claimDueSelfDestructs(runId, limit = 25) {
  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc('claim_self_destruct_posts', { p_run_id: runId, p_limit: limit });
  if (error) {
    if (isMissingSchema(error)) throw new SelfDestructUnavailableError();
    throw new Error(`claim failed: ${error.message}`);
  }
  return data || [];
}

async function reclaimStuck(olderThanSeconds = 180) {
  const supabase = requireSupabase();
  const { data, error } = await supabase.rpc('reclaim_stuck_self_destructs', { p_older_than_seconds: olderThanSeconds });
  if (error) {
    if (isMissingSchema(error)) throw new SelfDestructUnavailableError();
    console.warn(`[self-destruct] reclaim failed: ${error.message}`);
    return 0;
  }
  return data || 0;
}

/** Write a row's bookkeeping. Throws on a failed write, so a caller never claims an outcome it did not store. */
async function writeBookkeeping(id, fields) {
  const supabase = requireSupabase();
  const { error } = await supabase.from(TABLE).update(fields).eq('id', id);
  if (error) throw new Error(error.message);
}

async function markDeleted(id, { counts, reason, acted }) {
  await writeBookkeeping(id, {
    status: 'deleted',
    last_counts: counts || null,
    acted: acted || null,
    resolution: reason || 'deleted on time',
    resolved_at: new Date().toISOString(),
    locked_at: null, locked_by: null, last_error: null, last_error_code: null,
    updated_at: new Date().toISOString(),
  });
}

/**
 * The rule fired and the post is still up: a gate went on, quoting went off.
 * Neither 'deleted' nor 'spared' describes that, so it has its own word.
 */
async function markActed(id, { counts, reason, acted }) {
  await writeBookkeeping(id, {
    status: 'acted',
    last_counts: counts || null,
    acted: acted || null,
    resolution: reason || 'the rule ran',
    resolved_at: new Date().toISOString(),
    locked_at: null, locked_by: null, last_error: null, last_error_code: null,
    updated_at: new Date().toISOString(),
  });
}

async function markSpared(id, { counts, reason }) {
  await writeBookkeeping(id, {
    status: 'spared',
    last_counts: counts || null,
    // A spare is only ever decided fresh, never resumed, so anything in
    // `acted` is a marker pinnedVerdict refused — not a record of anything
    // done. A settled row should not carry it.
    acted: null,
    resolution: reason || 'kept',
    resolved_at: new Date().toISOString(),
    locked_at: null, locked_by: null, last_error: null, last_error_code: null,
    updated_at: new Date().toISOString(),
  });
}

/** Give a spared post the same window again, and put the timer back in the queue. */
async function extendTimer(row, { counts, reason }) {
  const nextCheck = new Date(Date.now() + row.lifespan_seconds * 1000).toISOString();
  await writeBookkeeping(row.id, {
    status: 'armed',
    check_at: nextCheck,
    extensions: (row.extensions || 0) + 1,
    last_counts: counts || null,
    resolution: reason || 'kept for now',
    // A fresh window is a fresh start: an attempt spent on the last evaluation
    // must not count against the next one, or a long-lived post would run out
    // of attempts having never actually failed at anything.
    attempts: 0,
    next_attempt_at: null,
    // Same for a marker: an extension is decided fresh, so anything in `acted`
    // is one pinnedVerdict refused, and the new window should not inherit it.
    acted: null,
    locked_at: null, locked_by: null, last_error: null, last_error_code: null,
    updated_at: new Date().toISOString(),
  });
  return nextCheck;
}

/**
 * Record a failed attempt: either back in the queue with backoff, or retired.
 *
 * A retired timer leaves the post exactly where it is. That is the whole
 * safety bias of this module — a timer that cannot do its job keeps quiet
 * rather than deleting on incomplete information.
 */
async function markFailedOrRetry(row, errMessage, { terminal = false, code, partial = false } = {}) {
  const attempts = row.attempts; // already incremented at claim time
  const exhausted = terminal || attempts >= row.max_attempts;
  const failureCode = normalizeFailureCode(code) || classifyFailure(errMessage);
  // Part of the thread may already be gone — this attempt's work (`partial`)
  // or an earlier one's, pinned on the row. The first post comes down last, so
  // it is still up either way; saying only that would tell the reader nothing
  // happened, when some of their thread did come down.
  const someDeleted = partial || pinnedDeleted(row).length > 0;

  if (exhausted) {
    await writeBookkeeping(row.id, {
      status: 'failed',
      last_error: errMessage?.slice(0, 500),
      last_error_code: failureCode,
      resolution: someDeleted
        ? 'part of the thread was deleted, but the first post is still up'
        : 'the post is still up',
      resolved_at: new Date().toISOString(),
      locked_at: null, locked_by: null, updated_at: new Date().toISOString(),
    });
    return 'failed';
  }

  const backoffMin = Math.min(2 ** attempts, 60);
  await writeBookkeeping(row.id, {
    status: 'armed',
    next_attempt_at: new Date(Date.now() + backoffMin * 60 * 1000).toISOString(),
    last_error: errMessage?.slice(0, 500),
    last_error_code: failureCode,
    locked_at: null, locked_by: null, updated_at: new Date().toISOString(),
  });
  return 'retry';
}

// ─── Engagement ─────────────────────────────────────────────────────────────

/**
 * Read like / reply / repost counts for up to 25 Bluesky post URIs.
 *
 * Unauthenticated AppView read — the counts are public, and going through a
 * user's session would tie one person's timer to another's rate limit. Returns
 * a Map of uri → counts; a URI the AppView does not return is simply absent,
 * which the caller reads as "that post is gone", NOT as zero engagement.
 *
 * Throws on a transport or HTTP failure, which is the important distinction: an
 * absent post means there is nothing to delete, a failed request means we do not
 * know, and those two must never be confused.
 */
async function fetchEngagement(uris) {
  const out = new Map();
  const wanted = (uris || []).filter(Boolean).slice(0, ENGAGEMENT_BATCH);
  if (wanted.length === 0) return out;

  const url = new URL(`${appviewBase()}/xrpc/app.bsky.feed.getPosts`);
  for (const uri of wanted) url.searchParams.append('uris', uri);

  const data = await deps.safeFetchJson(url.toString(), { timeoutMs: 10000 });
  for (const view of data?.posts || []) {
    if (view?.uri) out.set(view.uri, countsFromPostView(view));
  }
  return out;
}

/**
 * The author's own posts in this thread, beyond the root.
 *
 * Two jobs, both about a thread outliving its root:
 *
 *   1. The `selfReplies` metric. "Delete it unless I actually continued the
 *      thread" is a question about what the author did, and no counter on the
 *      post answers it.
 *   2. Deletion completeness. A row's `extra_uris` are the thread as it stood
 *      when the timer was armed, which for a post published from the composer
 *      is the thread as written. A self-reply added an hour later is not in
 *      there, and deleting the root without it would leave exactly the orphan
 *      the feature promises not to leave.
 *
 * Only the author's CONTINUATION CHAIN counts: a descendant qualifies when
 * every post between it and the root is the author's too. The walk only steps
 * into the author's own replies, so it never looks inside a sub-thread somebody
 * else started.
 *
 * Collecting everything the author wrote anywhere below the root would make
 * both jobs above wrong in the same way. Answering a stranger's question under
 * your post is a conversation, not the thread you wrote: it would inflate
 * selfReplies ("did I finish my thread?" answered yes because you replied to
 * somebody), and worse, the deletion would take those answers down with the
 * root, reaching into other people's conversations and removing their half of
 * them. The tree below shows what counts:
 *
 *   root (author)
 *   ├── author ✓            a continuation
 *   │   ├── author ✓        still a continuation
 *   │   └── stranger        not the author's, and the walk stops here…
 *   │       └── author ✗    …so this answer stays where it is
 *   └── stranger            somebody else's reply
 *       └── author ✗        the author answering them, not continuing
 *
 * Someone else replying to your thread is a reply, which is already its own
 * metric.
 *
 * Returns { uris, count, ownDirect }. Throws on a failed read, which the caller
 * treats the same way as a failed count read: retry, and leave the post up.
 */
async function readSelfReplies(userDid, rootUri, { depth = THREAD_DEPTH } = {}) {
  const url = new URL(`${appviewBase()}/xrpc/app.bsky.feed.getPostThread`);
  url.searchParams.set('uri', rootUri);
  url.searchParams.set('depth', String(depth));
  url.searchParams.set('parentHeight', '0');

  const data = await deps.safeFetchJson(url.toString(), { timeoutMs: 10000 });
  const uris = [];
  const seen = new Set([rootUri]);

  // The thread arrives as nested #threadViewPost. Anything else in the union
  // (#notFoundPost, #blockedPost) has no replies to walk and no author to read.
  //
  // Only the author's own replies are stepped into. A reply by anyone else
  // ends that branch: whatever hangs below it is a conversation the author
  // joined, not the thread they wrote, however many of its posts are theirs.
  const walk = (node) => {
    if (!node || !Array.isArray(node.replies)) return;
    for (const child of node.replies) {
      const uri = child?.post?.uri;
      if (!uri || seen.has(uri)) continue;
      seen.add(uri);
      if (child?.post?.author?.did !== userDid) continue;
      uris.push(uri);
      walk(child);
    }
  };
  walk(data?.thread);

  // The author's own DIRECT replies to the root. The root's replyCount includes
  // these — a thread's own continuation is a "reply" to the AppView — and a
  // clause about replies means OTHER people answering, so the evaluator
  // subtracts this from the counter (see resolveSelfDestruct).
  let ownDirect = 0;
  for (const child of data?.thread?.replies || []) {
    if (child?.post?.author?.did === userDid) ownDirect += 1;
  }

  return { uris, count: uris.length, ownDirect };
}

/**
 * How many of the people this clause cares about quoted the post.
 *
 * "Ten quotes" and "ten quotes from people I don't follow" are different
 * questions about the same number, and usually the second is the one worth
 * reacting to: a post travelling inside your own circle is not what makes you
 * want to close the replies.
 *
 * PEOPLE, not quote posts. A filtered clause is a question about who is
 * talking about the post, so each quoter counts once however many times they
 * quoted it — one stranger quoting five times is not five strangers, and used
 * to fire a "five strangers" rule on their own. And the author is never one of
 * them: quoting your own post is not the post getting out of your circle, and
 * a "not followed" test would otherwise count it (nobody follows themselves).
 * An UNFILTERED quotes clause still reads the AppView's quoteCount, which is a
 * count of quote posts with both of those in it; that is the number the app
 * shows beside the post, and a clause with nobody in it is a question about
 * that number.
 *
 * Read anonymously, on purpose. The AppView's public host is cached and does
 * not take authentication; an authenticated read would go through the author's
 * PDS instead, into a bucket limited by IP that this whole backend shares.
 * Follower counts and follow lists are public, so nothing here needs a session.
 *
 * Stops as soon as the clause's target is reached, which is what keeps the
 * common case to a single page: a rule waiting for ten matching quotes has its
 * answer long before the scan cap matters. When it stops early the count is the
 * target rather than the true total, which is all the comparison needs.
 *
 * @returns {{count: number, truncated: boolean}} `truncated` means the scan hit
 *   a cap before the target, so the count is a floor and the rule may be
 *   under-counting. The caller records it; it never silently reads as "no".
 */
async function readFilteredQuotes(row, clause, ctx = {}) {
  const filter = clause.from;
  const target = clause.op === 'gt' ? clause.value + 1 : clause.value;
  const profiles = ctx.profiles || new Map();
  const follows = filter.notFollowed ? await readFollowSet(row.user_did) : null;

  let matched = 0;
  let cursor = null;
  let truncated = false;
  let pages = 0;

  // A quoter who has not been looked up yet, held until there are enough of
  // them to fill a batch. getProfiles takes 25 actors per call, so asking one
  // at a time would cost twenty calls where one would do.
  let pending = [];
  // Everyone already counted or waiting to be, so a second quote from the same
  // person is passed over (see above: people, not posts).
  const quoters = new Set();

  const decideKnown = (did) => {
    // Returns true, false, or null for "the follower count would settle it".
    const strangerTest = filter.notFollowed ? !follows.dids.has(did) : null;
    const followerTest = filter.followersOver === null
      ? null
      // Strictly over, as the composer words it ("people with over 10,000
      // followers"); an account sitting on exactly the number is not over it.
      : (profiles.has(did) ? profiles.get(did) > filter.followersOver : undefined);

    if (filter.match === 'all') {
      if (strangerTest === false) return false;
      if (followerTest === null) return true;
      if (followerTest === undefined) return null;
      return followerTest;
    }
    if (strangerTest === true) return true;
    if (followerTest === null) return false;
    if (followerTest === undefined) return null;
    return followerTest;
  };

  const drain = async (force) => {
    while (pending.length >= 25 || (force && pending.length > 0)) {
      const batch = pending.slice(0, 25);
      pending = pending.slice(25);
      await readFollowerCounts(batch.map((q) => q.did), profiles);
      for (const quote of batch) {
        // Anyone the AppView would not describe stays uncounted. Treating an
        // unreadable profile as a match would let a blocked or deleted account
        // push a rule over its threshold.
        if (decideKnown(quote.did) === true) matched += 1;
      }
    }
  };

  while (pages < FILTER_SCAN_PAGES && matched < target) {
    const url = new URL(`${appviewBase()}/xrpc/app.bsky.feed.getQuotes`);
    url.searchParams.set('uri', row.post_uri);
    url.searchParams.set('limit', String(FILTER_SCAN_PAGE_SIZE));
    if (cursor) url.searchParams.set('cursor', cursor);

    const data = await deps.safeFetchJson(url.toString(), { timeoutMs: 10000 });
    const posts = Array.isArray(data?.posts) ? data.posts : [];
    pages += 1;

    for (const view of posts) {
      const did = view?.author?.did;
      if (!did || did === row.user_did || quoters.has(did)) continue;
      quoters.add(did);
      const known = decideKnown(did);
      if (known === true) matched += 1;
      else if (known === null) pending.push({ did });
    }
    await drain(false);
    if (matched >= target) break;

    cursor = data?.cursor || null;
    // Two different reasons to stop, and only one of them means the count is
    // finished. No cursor is the AppView saying there is nothing after this.
    // An EMPTY page that still carries a cursor is the AppView saying it hid
    // everything on that page — blocks, mutes, takedowns — and there is more
    // behind it. Both end the walk, but the second leaves ground unread, so
    // the cursor has to survive: it is the only thing the truncation test
    // below can tell them apart by. Clearing it here read an unfinished count
    // as a complete one, and a complete count is what fires the rule.
    if (!cursor || posts.length === 0) break;
  }
  await drain(true);

  // A cursor still in hand means the scan stopped with quotes left unread —
  // at the page cap, or at a page the AppView emptied. Reaching the target is
  // not truncation for the SCAN: the count can only grow. A truncated FOLLOW
  // list is different — it errs the other way, counting people the author
  // follows as strangers — so it taints the number even when the target was
  // reached: a rule must not fire on it.
  if (cursor && matched < target) truncated = true;
  if (follows && follows.truncated && filter.notFollowed) truncated = true;

  return { count: matched, truncated };
}

/** Follower counts for a batch of DIDs, into `into`. Unreadable ones stay out. */
async function readFollowerCounts(dids, into) {
  const wanted = dids.filter((did) => !into.has(did)).slice(0, 25);
  if (wanted.length === 0) return into;

  const url = new URL(`${appviewBase()}/xrpc/app.bsky.actor.getProfiles`);
  for (const did of wanted) url.searchParams.append('actors', did);

  const data = await deps.safeFetchJson(url.toString(), { timeoutMs: 10000 });
  for (const profile of data?.profiles || []) {
    if (profile?.did) into.set(profile.did, Number(profile.followersCount) || 0);
  }
  return into;
}

/**
 * The DIDs this account follows, cached across checks.
 *
 * A follow list changes slowly and is read for every filtered clause, so it is
 * held for a few hours rather than fetched again per post. It is also the one
 * unbounded read here: someone following fifty thousand accounts would cost
 * five hundred pages, so it stops at a cap and says it stopped.
 *
 * Truncation can only over-count strangers, never under-count them, so a rule
 * errs toward firing on a partial list. That is the wrong direction for a rule
 * whose effect is deletion, which is why the row records that the list was cut
 * short instead of letting the number pass as complete.
 */
async function readFollowSet(userDid) {
  const cached = followsCache.get(userDid);
  if (cached && nowMs() - cached.at < FOLLOWS_CACHE_MS) return cached;

  const dids = new Set();
  let cursor = null;
  let truncated = false;

  for (let page = 0; page < FOLLOWS_MAX_PAGES; page += 1) {
    const url = new URL(`${appviewBase()}/xrpc/app.bsky.graph.getFollows`);
    url.searchParams.set('actor', userDid);
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('cursor', cursor);

    const data = await deps.safeFetchJson(url.toString(), { timeoutMs: 10000 });
    for (const follow of data?.follows || []) {
      if (follow?.did) dids.add(follow.did);
    }
    cursor = data?.cursor || null;
    // An empty page that still carries a cursor is the AppView hiding a page
    // of follows it won't describe, with more behind it (as on getQuotes). The
    // walk stops, but the cursor survives so the list is marked partial: a
    // list read as complete when it isn't counts followed people as strangers.
    if (!cursor || (data?.follows || []).length === 0) break;
  }
  if (cursor) truncated = true;

  const entry = { at: nowMs(), dids, truncated };
  // The cache is per warm serverless instance and holds one Set of DIDs per
  // account that used a filtered rule recently. Bounded so a long-lived
  // instance cannot accumulate every account it has ever checked.
  if (followsCache.size >= FOLLOWS_CACHE_MAX) {
    followsCache.delete(followsCache.keys().next().value);
  }
  followsCache.set(userDid, entry);
  return entry;
}

/**
 * Fill in the counts that the post's own counters cannot answer.
 *
 * Every filtered clause is read separately, because two clauses asking about
 * different people are two different numbers. They share a profile cache within
 * the row, so a person who quoted twice is looked up once.
 *
 * A read that fails throws, which is a retry: the post stays up while we do not
 * know. There is no safe fallback to the unfiltered count, since it is always
 * the larger number and which direction that errs in depends on the sense.
 */
async function readFilteredCounts(row, conditions) {
  const clauses = filteredClauses(conditions);
  const out = {};
  if (clauses.length === 0) return out;

  const ctx = { profiles: new Map() };
  for (const clause of clauses.slice(0, MAX_FILTERED_CLAUSES)) {
    const read = await readFilteredQuotes(row, clause, ctx).catch((err) => {
      throw codedError(
        `couldn't read who quoted this post, so it was left up. ${err.message}`,
        'ENGAGEMENT_UNAVAILABLE'
      );
    });
    out[clauseCountKey(clause)] = read.count;
    if (read.truncated) out.__truncated = true;
  }
  return out;
}

/**
 * Whether a failed getPostThread is the AppView saying the root does not exist.
 *
 * app.bsky.feed.getPostThread declares one error, NotFound, which the reference
 * AppView sends as HTTP 400 `{ error: 'NotFound' }` for a root it cannot find.
 * That name — carried on the error by safe-fetch — is the only thing that
 * makes a 4xx an answer rather than a failure; the status alone is shared with
 * rate limits and malformed requests.
 */
function isThreadNotFound(err) {
  const status = Number(err?.status);
  return err?.error === 'NotFound' && Number.isFinite(status) && status >= 400 && status < 500;
}

/**
 * Everything this timer should take down, root last.
 *
 * The row's own `extra_uris` (the thread as written) plus anything the author
 * added since, de-duplicated. A thread read that fails throws — the row goes
 * back in the queue rather than taking the root down without the replies it
 * could not see — unless the AppView's answer was that the root does not exist
 * (isThreadNotFound), in which case there are no replies to find and the
 * records named on the row are the whole job.
 */
async function collectThreadRecords(row, { selfReplyUris } = {}) {
  const parts = [];
  const seen = new Set([row.post_uri]);
  const add = (uri, collection, rkey) => {
    if (!uri || seen.has(uri)) return;
    seen.add(uri);
    parts.push({ uri, collection: collection || row.collection, rkey });
  };

  for (const part of Array.isArray(row.extra_uris) ? row.extra_uris : []) {
    if (part && part.rkey) add(part.uri, part.collection, part.rkey);
  }

  let late = selfReplyUris;
  if (!late) {
    // An empty list reads downstream as "this post has no replies", which is
    // indistinguishable from the truth: the root would come down on its own
    // and the row be marked done, leaving replies standing under a missing
    // root, exactly the shape deleteThreadRecords orders itself to avoid.
    //
    // The usual reason there is no thread is that the root is already gone,
    // which a plain unconditional timer reaches without any earlier existence
    // check, and the AppView says so as a 400 with error NotFound. There are no
    // replies to walk in that case, an empty list is the honest answer, and the
    // deletes that follow are idempotent no-ops. But a 429 is a 4xx too, and so
    // is a 400 for a request the AppView did not like; neither says anything
    // about the thread.
    //
    // So only the AppView's own NotFound is an answer. Anything else — a rate
    // limit, a timeout, a 5xx, a network error, a 4xx with no error name — is
    // not knowing, and not knowing must not be spent as knowledge. That throws,
    // the row goes back in the queue with its verdict already pinned, and the
    // next pass takes the whole thread.
    late = await readSelfReplies(row.user_did, row.post_uri)
      .then((r) => r.uris)
      .catch((err) => {
        if (isThreadNotFound(err)) {
          console.warn(`[self-destruct] no thread to walk for ${row.post_uri}: ${err.message}`);
          return [];
        }
        throw codedError(
          `couldn't read this thread, so the post was left up. ${err.message}`,
          'ENGAGEMENT_UNAVAILABLE'
        );
      });
  }
  for (const uri of late || []) {
    const parsed = parseAtUri(uri);
    if (parsed && parsed.did === row.user_did) add(uri, parsed.collection, parsed.rkey);
  }

  return parts;
}

// ─── Deletion ───────────────────────────────────────────────────────────────

/**
 * Run an XRPC write, retrying once on "Invalid token" (token-rotation race).
 *
 * Several of these run at once now — a record's three deletes together, and a
 * few records at a time — so a rotated token is usually discovered by all of
 * them in the same instant. Each restoring a fresh session of its own would
 * be several refreshes racing for one grant; instead the first caller to see
 * the stale session refreshes it, and everyone else waits for that one and
 * retries on its result. A caller whose session was already replaced while
 * its request was in flight simply retries on the replacement.
 */
async function callWithTokenRetry(userDid, sessionRef, fn) {
  const used = sessionRef.session;
  try {
    return await fn(new deps.Agent(used));
  } catch (err) {
    if (!isInvalidToken(err)) throw err;
    const fresh = await refreshSessionOnce(userDid, sessionRef, used);
    if (!fresh) throw err;
    return await fn(new deps.Agent(fresh));
  }
}

/** One fresh restore per stale session, shared by every caller that hit it. */
function refreshSessionOnce(userDid, sessionRef, stale) {
  if (sessionRef.session !== stale) return Promise.resolve(sessionRef.session);
  if (!sessionRef.refreshing) {
    sessionRef.refreshing = restoreSessionSafe(userDid, { fresh: true })
      .then((fresh) => {
        if (fresh) sessionRef.session = fresh;
        return fresh;
      })
      .finally(() => { sessionRef.refreshing = null; });
  }
  return sessionRef.refreshing;
}

// The gates that share a post's record key, cleared alongside it.
const GATE_COLLECTIONS = ['app.bsky.feed.threadgate', 'app.bsky.feed.postgate'];

/**
 * Delete one record, and the threadgate / postgate that shared its record key.
 *
 * deleteRecord is idempotent — deleting a record that is already gone is a
 * no-op — which is what makes a reclaimed row safe to re-run. The gates are
 * best-effort: an orphaned threadgate pointing at a post that no longer exists
 * is untidy rather than harmful, and must not turn a completed deletion into a
 * retry that re-deletes the post.
 *
 * The three go out TOGETHER. They are independent records, none of them
 * depends on another being gone first, and sending them one after the other
 * made every post in a thread cost three proxied round trips back to back — a
 * hundred-post thread was three hundred of them in a row, which does not fit
 * in a sixty-second function. (Not applyWrites: one delete of a record that is
 * not there fails the whole batch, and most posts have no gates, so the batch
 * would fail far more often than it saved.) Settled, not raced: the function
 * returns only when every request has answered, so nothing is left in flight
 * behind a thrown error.
 */
async function deletePostRecord(userDid, sessionRef, collection, rkey) {
  const post = callWithTokenRetry(userDid, sessionRef, (agent) =>
    agent.com.atproto.repo.deleteRecord({ repo: userDid, collection, rkey })
  );
  const gates = collection !== 'app.bsky.feed.post' ? [] : GATE_COLLECTIONS.map((gate) =>
    callWithTokenRetry(userDid, sessionRef, (agent) =>
      agent.com.atproto.repo.deleteRecord({ repo: userDid, collection: gate, rkey })
    ).catch((err) => {
      console.warn(`[self-destruct] could not clear ${gate} for ${rkey}: ${err.message}`);
    })
  );
  const [outcome] = await Promise.allSettled([post, ...gates]);
  if (outcome.status === 'rejected') throw outcome.reason;
}

/**
 * Read the gate record currently at a post's rkey, or null when there is none.
 *
 * Public, so it goes to the AppView-adjacent PDS read rather than costing a
 * session. Anything other than "not found" propagates: not knowing what is
 * there is exactly the case where a gate must not be written.
 */
async function readGate(userDid, sessionRef, collection, rkey) {
  try {
    const res = await callWithTokenRetry(userDid, sessionRef, (agent) =>
      agent.com.atproto.repo.getRecord({ repo: userDid, collection, rkey })
    );
    return res?.data?.value || null;
  } catch (err) {
    // The PDS says RecordNotFound for a gate that was never written.
    const kind = err?.error || '';
    if (kind === 'RecordNotFound' || err?.status === 404 || /not found/i.test(err?.message || '')) {
      return null;
    }
    throw err;
  }
}

/**
 * What a "limit replies" rule may write over the gate that is already there.
 *
 * A threadgate is one record per post, so writing one REPLACES it. A rule that
 * wrote `follower` over an author's existing `mention` rule would not narrow
 * anything; it would open the replies to every follower. So the rule may only
 * ever intersect: the result is the rules both agree on, and when they agree on
 * nothing the gate is left exactly as the author set it.
 *
 * Closing replies to nobody is the exception, and not really one: it is the
 * strictest setting there is, so it narrows whatever it lands on.
 *
 * @returns {{allow: string[]}} to write, or {skip, ok, detail} to leave it be.
 */
function narrowAllow(wantedEntries, existingAllow) {
  const wanted = (wantedEntries || [])
    .map(normalizeAllowEntry)
    .filter(Boolean)
    .map(allowRuleRecord);
  if (!Array.isArray(existingAllow)) return { allow: wanted };

  if (existingAllow.length === 0) {
    return { skip: true, ok: true, detail: 'replies were already closed to everyone' };
  }
  if (wanted.length === 0) return { allow: [] };

  // Identity, not just $type: two listRules are the same rule only when they
  // point at the same list.
  const had = new Set(existingAllow.map(allowRecordKey).filter(Boolean));
  const allow = wanted.filter((record) => had.has(allowRecordKey(record)));
  if (allow.length === 0) {
    return { skip: true, ok: false, detail: 'left the reply settings alone; the rule would have opened them up' };
  }
  if (allow.length === existingAllow.length) {
    return { skip: true, ok: true, detail: 'replies were already limited this way' };
  }
  return { allow };
}

/**
 * The post record itself, read from the author's repo through their session,
 * or null when the repo says there is no such record.
 *
 * Anything else — a timeout, a 5xx, a session hiccup, an answer with no record
 * in it — throws. The caller is about to decide what to WRITE based on this
 * record, and not being able to read it is exactly the case where nothing
 * should be written on a guess.
 */
async function readOwnPost(userDid, sessionRef, row) {
  let res;
  try {
    res = await callWithTokenRetry(userDid, sessionRef, (agent) =>
      agent.com.atproto.repo.getRecord({ repo: userDid, collection: row.collection, rkey: row.rkey })
    );
  } catch (err) {
    // Only the repo's own "no such record" is an answer; the same strictness
    // probePostExists applies, for the same reason.
    if (err?.error === 'RecordNotFound') return null;
    const wrapped = new Error(
      `couldn't read this post to check whether it starts a thread, so its replies were left as they were. ${err?.message || ''}`.trim()
    );
    // Keep what classifyFailure reads, so the row's code says what went wrong
    // rather than UNKNOWN.
    if (err?.status !== undefined) wrapped.status = err.status;
    if (err?.error) wrapped.error = err.error;
    if (normalizeFailureCode(err?.code)) wrapped.code = err.code;
    throw wrapped;
  }
  const value = res?.data?.value;
  if (!value || typeof value !== 'object') {
    throw new Error("couldn't read this post to check whether it starts a thread, so its replies were left as they were.");
  }
  return value;
}

/**
 * Narrow who can reply to this post.
 *
 * Reads the gate that is there first, because writing one is a replace and the
 * author may have set their own. See narrowAllow for what that allows.
 *
 * And reads the POST first of all, because a threadgate only means anything
 * on the first post of a thread. The app.bsky.feed.threadgate lexicon keys a
 * gate by the thread ROOT's record key: one written at a reply's rkey names
 * the reply in its `post` field, and the AppView ignores it, because a gate
 * governs a whole thread from its root or nothing. Writing it anyway would
 * record "replies limited to your followers" on a post whose replies were as
 * open as ever. A reply records that it could not be limited, and why. (A
 * postgate is keyed by its own post, so "turn quotes off" still works on a
 * reply and is left alone.)
 */
async function applyLimitReplies(userDid, sessionRef, row, effect, createdAt) {
  const post = await readOwnPost(userDid, sessionRef, row);
  if (post === null) {
    // The repo says it is gone — deleted by hand since the timer was set.
    // There is nothing to gate, and a retry would not change that.
    return { ok: false, detail: 'the post was already gone, so there were no replies to limit' };
  }
  if (post.reply) {
    return {
      ok: false,
      detail: 'replies can only be limited on the first post of a thread, and this post is a reply, so its replies were left as they were',
    };
  }

  const existing = await readGate(userDid, sessionRef, 'app.bsky.feed.threadgate', row.rkey);
  const narrowed = narrowAllow(effect.allow || [], existing?.allow);
  if (narrowed.skip) return { ok: narrowed.ok, detail: narrowed.detail };

  await callWithTokenRetry(userDid, sessionRef, (agent) =>
    agent.com.atproto.repo.putRecord({
      repo: userDid,
      collection: 'app.bsky.feed.threadgate',
      rkey: row.rkey,
      record: {
        $type: 'app.bsky.feed.threadgate',
        post: row.post_uri,
        createdAt,
        allow: narrowed.allow,
        // Whatever the author had hidden stays hidden. Dropping it would be a
        // second, silent edit to a record the rule was only asked to narrow.
        hiddenReplies: Array.isArray(existing?.hiddenReplies) ? existing.hiddenReplies : [],
      },
    })
  );
  // What was WRITTEN, which after narrowing is the intersection rather than
  // the ask: a rule asking for followers and people you follow, over a gate
  // that already said followers and mentions, wrote followers alone, and the
  // timers page has to say that rather than repeat the request.
  return { ok: true, detail: describeAllow(narrowed.allow.map(allowEntryFromRecord).filter(Boolean)) };
}

async function applyDisableQuotes(userDid, sessionRef, row, createdAt) {
  const existing = await readGate(userDid, sessionRef, 'app.bsky.feed.postgate', row.rkey);
  const already = Array.isArray(existing?.embeddingRules) &&
    existing.embeddingRules.some((r) => r?.$type === 'app.bsky.feed.postgate#disableRule');
  if (already) return { ok: true, detail: 'quoting was already off' };

  await callWithTokenRetry(userDid, sessionRef, (agent) =>
    agent.com.atproto.repo.putRecord({
      repo: userDid,
      collection: 'app.bsky.feed.postgate',
      rkey: row.rkey,
      record: {
        $type: 'app.bsky.feed.postgate',
        post: row.post_uri,
        createdAt,
        detachedEmbeddingUris: Array.isArray(existing?.detachedEmbeddingUris)
          ? existing.detachedEmbeddingUris : [],
        embeddingRules: [{ $type: 'app.bsky.feed.postgate#disableRule' }],
      },
    })
  );
  return { ok: true, detail: 'quoting turned off' };
}

/** 'your followers' / 'people you follow and people in 2 of your lists' / 'nobody'. */
function describeAllow(entries) {
  const words = { follower: 'your followers', following: 'people you follow', mention: 'people you mentioned' };
  const parts = [];
  let lists = 0;
  for (const entry of entries || []) {
    if (typeof entry === 'string') {
      if (words[entry]) parts.push(words[entry]);
    } else if (entry && entry.list) {
      lists += 1;
    }
  }
  // The server only holds the URIs; the names live with the client, so the
  // sentence counts rather than guesses.
  if (lists === 1) parts.push('people in a list you chose');
  else if (lists > 1) parts.push(`people in ${lists} lists you chose`);
  if (parts.length === 0) return 'replies limited to nobody';
  if (parts.length === 1) return `replies limited to ${parts[0]}`;
  return `replies limited to ${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * Run a rule's effects against the post, in the fixed order.
 *
 * Reversible effects go first so a run that dies partway has done the half that
 * can be undone rather than the half that cannot. A failure in any effect
 * throws: the row goes back in the queue, and the effects already applied are
 * idempotent (putRecord is an upsert, and both gate writers check what is there
 * before writing), so re-running is safe.
 *
 * `selfReplyUris` is the thread as the conditions read it moments ago, passed
 * in so the delete does not read it a second time.
 *
 * `alreadyDone` and `alreadyDeleted` are what an earlier, interrupted attempt
 * got through (from the pending marker; see recordInterruptedEffects). An
 * effect already done is not run again — its entry is carried over, so the row
 * says "replies limited to your followers" rather than the "already limited
 * this way" a second run would find — and the records already deleted are not
 * asked for again, which is what lets a long thread finish across runs rather
 * than starting over each time. `deadline` is the worker's wall-clock budget;
 * see deleteThreadRecords.
 *
 * A thrown error carries `effectsDone` (every entry so far, carried-over ones
 * included) so the caller can pin that progress before the row is requeued.
 *
 * @returns {Promise<Array<{action: string, ok: boolean, detail: string}>>}
 */
async function applyEffects(userDid, sessionRef, row, effects, {
  selfReplyUris, deadline, alreadyDone, alreadyDeleted,
} = {}) {
  const createdAt = new Date().toISOString();
  const done = [];
  const finished = new Map(
    (Array.isArray(alreadyDone) ? alreadyDone : [])
      .filter((entry) => entry && typeof entry.action === 'string' && entry.action !== 'delete')
      .map((entry) => [entry.action, entry])
  );
  try {
    for (const effect of effects) {
      if (finished.has(effect.action)) {
        done.push(finished.get(effect.action));
      } else if (effect.action === 'limitReplies') {
        done.push({ action: effect.action, ...await applyLimitReplies(userDid, sessionRef, row, effect, createdAt) });
      } else if (effect.action === 'disableQuotes') {
        done.push({ action: effect.action, ...await applyDisableQuotes(userDid, sessionRef, row, createdAt) });
      } else if (effect.action === 'delete') {
        await deleteThreadRecords(userDid, sessionRef, row, {
          parts: await collectThreadRecords(row, { selfReplyUris }),
          deadline,
          alreadyDeleted,
        });
        done.push({ action: 'delete', ok: true, detail: 'the post was deleted' });
      }
    }
  } catch (err) {
    if (err && typeof err === 'object') err.effectsDone = done;
    throw err;
  }
  return done;
}

// How many records of a thread are deleted at once. Each one is three
// concurrent requests (the post and its two gates), so five is fifteen in
// flight per row — enough to take a hundred-post thread down in twenty rounds
// rather than a hundred, without pointing a burst at one PDS.
const THREAD_DELETE_CONCURRENCY = 5;

/** The budget ran out partway through a deletion. Not a failure. */
class DeletionOutOfTimeError extends Error {
  constructor(deleted) {
    super('ran out of time partway through deleting this thread; the rest comes down on the next run.');
    this.name = 'DeletionOutOfTimeError';
    this.code = 'TIMED_OUT';
    this.outOfTime = true;
    this.threadDeleted = deleted;
  }
}

function pastDeadline(deadline) {
  return Number.isFinite(deadline) && Date.now() >= deadline;
}

/**
 * Delete everything one timer owns: the post, and the rest of its thread.
 *
 * Replies go FIRST and the root last. Either order leaves the PDS correct, but
 * this one never leaves a thread whose root is missing while its replies are
 * still up — a shape that reads to anyone looking as though the post was
 * deleted by a moderator rather than by its author. If the run dies partway, the
 * reclaim hands the row back and the remaining records go on the next pass;
 * re-deleting the ones already gone is a no-op.
 *
 * The replies go a few at a time (THREAD_DELETE_CONCURRENCY), in batches taken
 * from the deep end: every batch finishes before the next starts, so a run cut
 * off between batches has taken down the deepest posts and left the shallowest
 * — the root above all — standing, never the other way round. One after the
 * other, a long thread could not finish inside the function's sixty seconds,
 * and each retry started again from the top.
 *
 * `deadline` (epoch ms) is checked before every batch and before the root. Past
 * it, nothing new is started: a DeletionOutOfTimeError carries what this run
 * deleted, so the row can be requeued with that progress pinned and finish on
 * the next run. `alreadyDeleted` (URIs) is the progress an earlier run pinned;
 * those are skipped. Any other failure is annotated with `threadDeleted` the
 * same way, so a row that gives up can say part of the thread already went.
 *
 * @returns {Promise<{deleted: string[]}>} the reply URIs this call deleted.
 */
async function deleteThreadRecords(userDid, sessionRef, row, { parts, deadline, alreadyDeleted } = {}) {
  const records = parts || await collectThreadRecords(row);
  const skip = new Set(Array.isArray(alreadyDeleted) ? alreadyDeleted : []);
  const keyOf = (part) => part.uri || `${part.collection || row.collection}/${part.rkey}`;
  const queue = [...records].reverse().filter((part) => part && part.rkey && !skip.has(keyOf(part)));
  const deleted = [];

  for (let i = 0; i < queue.length; i += THREAD_DELETE_CONCURRENCY) {
    if (pastDeadline(deadline)) throw new DeletionOutOfTimeError(deleted);
    const batch = queue.slice(i, i + THREAD_DELETE_CONCURRENCY);
    const results = await Promise.allSettled(batch.map((part) => (
      deletePostRecord(userDid, sessionRef, part.collection || row.collection, part.rkey)
    )));
    let failure = null;
    results.forEach((result, j) => {
      if (result.status === 'fulfilled') deleted.push(keyOf(batch[j]));
      else if (!failure) failure = result.reason;
    });
    // A batch with a failure in it ends the walk: the next batch is shallower,
    // and taking it down over a deeper post that is still standing is the
    // inside-out shape this order exists to prevent.
    if (failure) throw annotateDeleted(failure, deleted);
  }

  if (pastDeadline(deadline)) throw new DeletionOutOfTimeError(deleted);
  try {
    await deletePostRecord(userDid, sessionRef, row.collection, row.rkey);
  } catch (err) {
    throw annotateDeleted(err, deleted);
  }
  return { deleted };
}

function annotateDeleted(err, deleted) {
  if (err && typeof err === 'object') err.threadDeleted = deleted;
  return err;
}

/**
 * Whether the post still exists in its author's own repo, asked of the PDS
 * directly. Used only when the AppView OMITS a post from its answer: omission
 * does cover "genuinely deleted", but it also covers a deactivated or
 * taken-down ACCOUNT, whose posts all still exist and would outlive their
 * timers forever while the row reported them deleted.
 *
 * Returns true (it exists), false (the repo itself says RecordNotFound), or
 * null (could not find out — an unknown, never a verdict).
 */
async function probePostExists(did, collection, rkey) {
  try {
    // resolvePdsEndpoint answers { did, pdsEndpoint, didDoc } and throws when
    // there is no endpoint.
    const { pdsEndpoint } = (await deps.resolvePdsEndpoint(did)) || {};
    if (!pdsEndpoint) return null;
    const url = new URL(`${String(pdsEndpoint).replace(/\/+$/, '')}/xrpc/com.atproto.repo.getRecord`);
    url.searchParams.set('repo', did);
    url.searchParams.set('collection', collection);
    url.searchParams.set('rkey', rkey);
    const res = await deps.safeFetch(url.toString(), { timeoutMs: 10000 });
    if (res.ok) return true;
    // The PDS is the account's own and may be hostile: read at most a small,
    // capped error body rather than whatever res.json() would buffer.
    const kind = (await deps.readXrpcErrorBody(res))?.error || '';
    // Only the repo's own "no such record" counts as gone. AccountDeactivated,
    // RepoTakendown, rate limits, 5xx — the record may well still exist.
    if (kind === 'RecordNotFound') return false;
    return null;
  } catch {
    return null;
  }
}

// How many times in a row a deletion may be put back for running out of time
// WITHOUT having deleted anything, before that stops being free. A deferral
// that made progress is always free: the thread is shorter each time, so it
// ends. One that made none is only free because the worker started it late,
// and a deferred row is claimed first on the next run — so this is a backstop
// against a row that can never reach its first batch in time cycling forever
// with its attempts untouched.
const MAX_IDLE_DEFERRALS = 3;

/**
 * Put a claimed row back in the queue as though this run had never claimed it.
 *
 * The claim spent an attempt (claim_self_destruct_posts increments it); this
 * gives it back. For a row the worker never got to, and for one whose deletion
 * was cut off by the worker's own budget — neither is the row failing, and a
 * long thread that needs three runs to come down must not burn three of its
 * five attempts doing it. `acted`, when given, is the progress to pin.
 */
async function requeueUnspent(row, { acted } = {}) {
  const fields = {
    status: 'armed',
    attempts: Math.max(0, (Number(row.attempts) || 0) - 1),
    next_attempt_at: null,
    locked_at: null, locked_by: null,
    updated_at: new Date().toISOString(),
  };
  if (acted !== undefined) fields.acted = acted;
  await writeBookkeeping(row.id, fields);
  return true;
}

/**
 * The verdict an earlier attempt pinned in `acted`, or null when there is none
 * — or when the marker there is not a verdict at all.
 *
 * Resuming a pin skips the reads, the probe and the evaluation and goes
 * straight to the rule's effects, so a marker that is mistaken for one is a
 * rule fired without ever being asked. Two shapes are refused:
 *
 *   * A countless marker on a row whose rule has clauses. That rule only ever
 *     fires on counts it read, and every verdict it pins carries them; a pin
 *     with none is something else.
 *   * A countless marker whose reason says the post was already gone
 *     (`{ pending, counts: null, reason: 'the post was already gone' }`). The
 *     gone path runs before the rule is evaluated, so nothing was decided;
 *     resumed as a verdict, the next run would write the gates, read the
 *     thread and delete the root. Nothing here writes one, and a row that
 *     carries one is re-evaluated from scratch, which for a root that really
 *     is gone ends in the same no-delete retirement.
 *
 * The worker asks this too, so the two never disagree about whether a row may
 * go ahead without its batch read.
 */
function pinnedVerdict(row) {
  const marker = row?.acted;
  if (!marker || typeof marker !== 'object' || Array.isArray(marker) || marker.pending !== true) return null;
  if (marker.counts === null || marker.counts === undefined) {
    const conditional = hasClauses(row.conditions);
    if (conditional) return null;
    if (typeof marker.reason === 'string' && /already gone/i.test(marker.reason)) return null;
  }
  return marker;
}

/** The reply URIs an earlier attempt pinned as already deleted. */
function pinnedDeleted(row) {
  const marker = row?.acted;
  if (!marker || typeof marker !== 'object' || Array.isArray(marker) || marker.pending !== true) return [];
  return Array.isArray(marker.deleted) ? marker.deleted : [];
}

/**
 * An error that says part of the thread already came down. The first post is
 * deleted last, so whatever stopped the walk, it is still up — but "the post is
 * still up" alone would let a reader think nothing happened, and some of it
 * did. Keeps what classifyFailure reads off the original.
 */
function partialDeletionError(err, deletedCount) {
  const wrapped = new Error(
    `couldn't finish deleting this thread: ${plural(deletedCount, 'reply')} came down, but the first post is still up. ${err?.message || ''}`.trim()
  );
  for (const key of ['status', 'error', 'code', 'nonRetryable']) {
    if (err && err[key] !== undefined) wrapped[key] = err[key];
  }
  wrapped.partialDeletion = true;
  return wrapped;
}

/**
 * The effects stopped partway. Pin what got done, then either put the row back
 * for free (the budget ran out) or let the failure through to be retried.
 *
 * The pin is the same pending marker a conditional verdict already uses, now
 * carrying `effects` (entries finished) and `deleted` (reply URIs gone). On an
 * unconditional row it is written fresh, which changes nothing about what the
 * next attempt decides — "on time" with no counts is what that row would have
 * concluded anyway — and lets it skip what is already done.
 */
async function recordInterruptedEffects(row, err, { pinned, counts, why }) {
  const before = {
    effects: Array.isArray(pinned?.effects) ? pinned.effects : [],
    deleted: Array.isArray(pinned?.deleted) ? pinned.deleted : [],
  };
  const effectsDone = Array.isArray(err?.effectsDone) ? err.effectsDone : before.effects;
  const deletedNow = Array.isArray(err?.threadDeleted) ? err.threadDeleted : [];
  const deleted = [...new Set([...before.deleted, ...deletedNow])];
  const progressed = deletedNow.length > 0 || effectsDone.length > before.effects.length;

  const marker = { pending: true, counts: counts || null, reason: why };
  if (effectsDone.length) marker.effects = effectsDone;
  if (deleted.length) marker.deleted = deleted;

  if (err?.outOfTime) {
    const idle = progressed ? 0 : (Number(pinned?.idleDeferrals) || 0) + 1;
    if (idle <= MAX_IDLE_DEFERRALS) {
      if (idle) marker.idleDeferrals = idle;
      if (await requeueUnspent(row, { acted: marker })) {
        console.log(`[self-destruct] ${row.id} ran out of time with ${deleted.length} replies down; requeued without spending an attempt`);
        return { outcome: 'deferred', counts, deleted: deletedNow.length };
      }
    }
    // Out of free passes: spend the attempt like any other timeout.
  }

  if (progressed) {
    // Best-effort. Losing it costs the next attempt some repeated deletes,
    // which are no-ops; letting it replace the real failure would cost the
    // reader the reason their timer stopped.
    try {
      await writeBookkeeping(row.id, { acted: marker, updated_at: new Date().toISOString() });
    } catch (bookErr) {
      console.warn(`[self-destruct] could not pin progress for ${row.id}: ${bookErr.message}`);
    }
  }
  if (deleted.length) throw partialDeletionError(err, deleted.length);
  throw err;
}

/**
 * The root is confirmed gone — its own repo says so. Retire the timer and touch
 * nothing.
 *
 * The rest of the thread (`extra_uris`) is left standing, even though leaving
 * it under a missing root is the orphan the deletion order exists to prevent.
 * This path is only reached from the conditional branch, BEFORE the rule is
 * evaluated (the counts it would be evaluated on are exactly what the missing
 * root took with it), so no rule that arrives here has fired. "Would this rule
 * delete if it fired" (effectsDelete) is not "did it fire": an "only if more
 * than fifty people replied" rule whose author deleted the first post by hand
 * would have every reply deleted on a condition that never matched. A root the
 * repo calls RecordNotFound after a takedown lands in the same place. Not
 * knowing whether the rule would have fired is the safety bias's case exactly,
 * and it resolves toward keeping the posts.
 *
 * Nor is the root asked for again. The probe saying it is gone is what brought
 * us here; if the probe was wrong, a second delete would remove a post that was
 * standing.
 *
 * Nothing here can be interrupted partway, so nothing here pins a marker: a
 * pending marker is a verdict, and no verdict was reached.
 */
async function retireGone(row) {
  const extras = (Array.isArray(row.extra_uris) ? row.extra_uris : []).filter((part) => part && part.rkey);
  const reason = extras.length
    ? 'the first post was already gone, and the rest of its thread was left as it is'
    : 'the post was already gone';
  await markDeleted(row.id, { counts: null, reason });
  return { outcome: 'gone' };
}

/**
 * Resolve one due timer.
 *
 * The order matters, and each step is chosen so that a failure keeps the post:
 *
 *   1. A decision an earlier attempt already reached and pinned (see below) →
 *      resume it. Re-deciding from fresh counts would re-read a thread that
 *      attempt half-deleted, and the shrunken numbers could flip the verdict.
 *   2. No conditions → act. There is nothing to evaluate, and the author
 *      asked for a plain timer.
 *   3. Conditions → read the counts, and the thread too when a clause asks
 *      about replies (the author's own, or the counter that includes them). A
 *      failed READ is a retry, never a delete: we do not delete a post on
 *      information we could not get. The same rule covers counts a capped scan
 *      could not finish — a rule never FIRES on a number flagged incomplete.
 *   4. The post is not in the AppView's answer → ask its own PDS. Only the
 *      repo's word that the record is gone retires the timer; anything else is
 *      an unknown and a retry.
 *   5. Conditions met → keep it, or hand it the same window again.
 *   6. Otherwise → pin the decision to the row, then act on it.
 *
 * Throws on failure (`.nonRetryable` when it should not be retried). Returns the
 * outcome so the worker can report it: 'deleted' | 'acted' | 'spared' |
 * 'extended' | 'gone' | 'deferred' — the last when the worker's budget ran out
 * partway through a deletion and the row was put back, progress pinned and no
 * attempt spent, to finish on the next run.
 *
 * @param {object} row
 * @param {{engagement?: Map<string, object>, deadline?: number}} [deps]
 *   pre-fetched counts, so a worker can read a whole batch of posts in one
 *   AppView call; and the wall-clock time (epoch ms) past which no new deletion
 *   is started.
 */
async function resolveSelfDestruct(row, { engagement, deadline } = {}) {
  const userDid = row.user_did;
  const conditions = normalizeConditions(row.conditions);
  const conditional = hasClauses(conditions);
  const effects = normalizeEffects(row.effects);

  // The thread, read once and used twice: for the reply metrics, and for the
  // deletion, so a reply added after the timer was armed comes down with the
  // root rather than being orphaned by it.
  let selfReplyUris = null;
  let counts = null;
  let why = 'on time';

  // The missed-deadline note armSelfDestruct left on the row, if any, so the
  // sentence it settles with still says why it ran longer than the time that
  // was picked.
  const armNote = row.resolution === MISSED_DEADLINE_NOTE ? MISSED_DEADLINE_NOTE : null;
  const noted = (reason) => (armNote ? `${reason}. ${armNote}` : reason);

  // A verdict an earlier attempt reached and pinned before its effects were
  // cut short. The marker lives in `acted`, overwritten with the real outcome
  // on completion. Only a marker that IS a verdict counts; see pinnedVerdict
  // for the one that looked like one and was not.
  const pinned = pinnedVerdict(row);

  if (pinned) {
    counts = pinned.counts || null;
    why = pinned.reason || why;
  } else if (conditional) {
    let seen = engagement;
    if (!seen) {
      // Let the failure propagate: markFailedOrRetry will put the timer back,
      // and the post stays up in the meantime. This is the one place where
      // getting it wrong would be irreversible.
      seen = await fetchEngagement([row.post_uri]).catch((err) => {
        throw codedError(
          `couldn't read the counts for this post, so it was left up. ${err.message}`,
          'ENGAGEMENT_UNAVAILABLE'
        );
      });
    }
    if (!seen.has(row.post_uri)) {
      // The AppView answered without this post. That usually means it is
      // already deleted — but the same silence covers a deactivated or
      // taken-down account whose posts all still stand, so only the author's
      // own PDS gets to confirm the record is really gone. Anything short of
      // that confirmation is an unknown, and unknowns retry.
      const exists = await probePostExists(userDid, row.collection, row.rkey);
      if (exists !== false) {
        throw codedError(
          "couldn't confirm this post is really gone, so its timer was left to try again.",
          'ENGAGEMENT_UNAVAILABLE'
        );
      }
      return retireGone(row);
    }
    counts = { ...seen.get(row.post_uri) };

    // Only when a clause asks. A plain "5 likes" rule never pays for this.
    if (needsThread(conditions)) {
      const thread = await readSelfReplies(userDid, row.post_uri).catch((err) => {
        throw codedError(
          `couldn't read this thread, so the post was left up. ${err.message}`,
          'ENGAGEMENT_UNAVAILABLE'
        );
      });
      selfReplyUris = thread.uris;
      counts.selfReplies = thread.count;
      // The root's replyCount includes the author's own thread continuations,
      // and a clause about replies means OTHER people answering — without
      // this, a five-post thread arms "unless anyone answered" pre-answered.
      counts.replies = Math.max(0, counts.replies - (thread.ownDirect || 0));
    }

    // Clauses about particular people cost their own reads, so like the thread
    // read above they only happen when a clause asks.
    Object.assign(counts, await readFilteredCounts(row, conditions));

    // A count the AppView never sent is not a zero, and a clause that reads it
    // as one would fire an irreversible rule on a number nobody reported. Only
    // metrics this rule actually asks about matter: a missing quoteCount is
    // nothing to a rule about likes. Same treatment as a truncated scan below —
    // the post stays up and the timer asks again.
    const verdict = evaluateConditions(conditions, counts);
    if (verdict.spare) {
      const canExtend = conditions.onSpare === 'extend' &&
        (row.extensions || 0) < conditions.maxExtensions;
      if (canExtend) {
        const nextCheck = await extendTimer(row, { counts, reason: verdict.reason });
        return { outcome: 'extended', counts, reason: verdict.reason, nextCheck };
      }
      await markSpared(row.id, { counts, reason: noted(verdict.reason) });
      return { outcome: 'spared', counts, reason: verdict.reason };
    }

    // The rule wants to fire. Both checks below belong HERE rather than before
    // the spare branch above, for the same reason: a number we are unsure of
    // must not fire an irreversible effect, but sparing on one is fine — that
    // errs toward the post, which is the whole bias of this module. Checking
    // earlier would turn a rule that was about to keep the post into a retry,
    // and eventually into a 'failed' row on a post nobody was going to touch.

    // A count the AppView never sent is silence, not a zero, and this rule
    // depends on it.
    const unreported = unreportedMetricsFor(conditions, counts);
    if (unreported.length) {
      throw codedError(
        `the counts for this post came back without ${unreported.join(' or ')}, so it was left up.`,
        'ENGAGEMENT_UNAVAILABLE'
      );
    }

    // A count a capped scan could not finish is a floor, not an answer.
    if (counts.__truncated) {
      throw codedError(
        "couldn't finish counting who engaged with this post, so it was left up.",
        'ENGAGEMENT_UNAVAILABLE'
      );
    }

    why = describeCounts(counts);
    // Pin the verdict BEFORE acting on it. If the effects are cut short
    // partway (a killed worker, a slow PDS), the reclaimed row resumes THIS
    // decision instead of re-deriving one from counts its own half-applied
    // effects have since changed — deleting a thread's replies shrinks the
    // very numbers the verdict came from.
    await writeBookkeeping(row.id, {
      acted: { pending: true, counts, reason: why },
      updated_at: new Date().toISOString(),
    });
  }

  const session = await restoreSessionSafe(userDid);
  if (!session) {
    // Null covers both "the grant is gone" and "the session store hiccupped",
    // so this must not be terminal — the same reasoning as the scheduled-posts
    // publisher. A grant that really is gone runs out its attempts and lands on
    // 'failed', with the post still up.
    throw codedError(
      "couldn't reach your account session, so this post was left up. reconnect your account if this keeps happening.",
      'SESSION_UNAVAILABLE'
    );
  }
  const sessionRef = { session };

  // The thread read, if one happened, is handed down so a reply added after the
  // timer was armed comes down with its root rather than being read for twice.
  // What an interrupted earlier attempt got through rides in on the pin, so a
  // long thread picks up where it stopped instead of starting over.
  let acted;
  try {
    acted = await applyEffects(userDid, sessionRef, row, effects, {
      selfReplyUris,
      deadline,
      alreadyDone: pinned?.effects,
      alreadyDeleted: pinned?.deleted,
    });
  } catch (err) {
    return recordInterruptedEffects(row, err, { pinned, counts, why });
  }

  if (effectsDelete(effects)) {
    await markDeleted(row.id, { counts, reason: noted(`deleted, ${why}`), acted });
    return { outcome: 'deleted', counts, acted };
  }
  // The rule fired and the post is still up. A different outcome from deleting
  // and a different one from being spared, so it says so rather than borrowing
  // either word.
  // Just the counts. What was done is in `acted`, one entry per effect, and
  // repeating it here would print the same sentence twice on the timers page.
  await markActed(row.id, { counts, reason: noted(why), acted });
  return { outcome: 'acted', counts, acted };
}

/**
 * A line of the post, for the timer list. The first post's text is the one a
 * reader would recognise the thread by.
 */
function snippetFromScheduledPayload(payload) {
  const text = payload?.posts?.[0]?.record?.text;
  return typeof text === 'string' ? text.slice(0, 200) : null;
}

// Arming is one Supabase RPC and it is idempotent, so a couple of quick retries
// cover essentially every transient failure. Kept short: this runs inside the
// publish worker's 60s budget, behind a post that is already out.
const ARM_ATTEMPTS = 3;
const ARM_BACKOFF_MS = 400;

/**
 * Arm the timer a scheduled post asked for, now that it has published.
 *
 * Called by the scheduled-posts worker with the row and the refs of everything
 * it wrote, which is what makes "schedule it for Thursday, and take it down an
 * hour later unless anyone answered" one action rather than two.
 *
 * The lifespan is measured from when the post ACTUALLY went out — now, by
 * default, since the worker arms the timer moments after the last write, not
 * from the scheduled slot. The slot is only a promise about when the post
 * would appear: measured from it, a publish that ran fourteen minutes late
 * against a fifteen-minute timer would leave the post standing for one minute.
 * A post's lifespan is how long people could see it,
 * and nobody saw it before it published. (The record's createdAt is no help
 * here: it is stamped with the slot on purpose, to match the rkey's TID.)
 *
 * `publishedAt` lets a caller that knows better say so. A row whose writes
 * finished on an earlier run that was killed before its bookkeeping did not
 * know when they landed, and now is the conservative answer: it can only give
 * the post more time, never less.
 *
 * Returns the armed row, or null when the post did not ask for a timer. Throws
 * only after its retries are spent — the caller treats that as something to log
 * beside a publish that has already succeeded, never as a failed publish.
 */
async function armForPublishedSchedule(row, refs, { publishedAt } = {}) {
  const spec = row?.payload?.selfDestruct;
  if (!spec) return null;

  const written = (Array.isArray(refs) ? refs : []).filter((ref) => ref && ref.uri);
  if (written.length === 0) return null;

  const validation = validateArm({
    userDid: row.user_did,
    postUri: written[0].uri,
    postCid: written[0].cid,
    snippet: snippetFromScheduledPayload(row.payload),
    lifespanSeconds: spec.lifespanSeconds,
    deleteAt: spec.deleteAt,
    conditions: spec.conditions,
    effects: spec.effects,
    postedAt: publishedAt || new Date().toISOString(),
    // The rest of the thread, so it comes down with its root rather than
    // leaving replies hanging off a post that no longer exists.
    extraUris: written.slice(1).map((ref) => ref.uri),
  });
  if (!validation.ok) {
    // The payload was validated when the post was scheduled, so reaching here
    // means something about the published record surprised us. Nothing to
    // retry; report it.
    throw new Error(`the timer for this post was refused: ${validation.error}`);
  }
  if (validation.value.deadlineMissed) {
    // The pinned delete time had gone by before the post went out — a late
    // run, or a queued post moved past it before the move was refused (see
    // the scheduler's strandsDeleteTime). The timer runs for its original
    // length instead of five minutes; the row's resolution says so too.
    console.warn(`[self-destruct] scheduled post ${row.id} published after its pinned delete time (${spec.deleteAt}); arming for its original ${validation.value.lifespanSeconds}s instead`);
  }

  let lastErr;
  for (let attempt = 0; attempt < ARM_ATTEMPTS; attempt++) {
    try {
      const { row: armed } = await armSelfDestruct({ userDid: row.user_did, ...validation.value });
      return armed;
    } catch (err) {
      // A schema that has not caught up, or an account at its ceiling, will not
      // be different in 400ms.
      if (err.code === 'UNAVAILABLE' || err.code === 'QUOTA_EXCEEDED') throw err;
      lastErr = err;
      if (attempt < ARM_ATTEMPTS - 1) {
        await new Promise((resolve) => setTimeout(resolve, ARM_BACKOFF_MS * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

function describeCounts(counts) {
  if (!counts) return 'on time';
  // A count the AppView never sent is not a zero — that conflation is the
  // whole reason __absent exists — so the sentence the author reads about
  // their own post does not get to claim it was. The marker rides along on
  // the stored row for the same reason: "0 replies" and "nobody told us"
  // must not read the same in the record either.
  const absent = new Set(Array.isArray(counts.__absent) ? counts.__absent : []);
  const parts = [];
  for (const [metric, noun] of [['likes', 'like'], ['replies', 'reply'], ['reposts', 'repost']]) {
    if (absent.has(metric)) continue;
    parts.push(plural(counts[metric] || 0, noun));
  }
  return parts.length ? parts.join(', ') : 'on time';
}

export {
  SelfDestructUnavailableError,
  FAILURE_CODES,
  MIN_LIFESPAN_SECONDS,
  MAX_LIFESPAN_SECONDS,
  MISSED_DEADLINE_NOTE,
  maxActivePerUser,
  unreportedMetricsFor,
  MAX_EXTENSIONS_CAP,
  MAX_THREAD_RECORDS,
  ENGAGEMENT_BATCH,
  classifyFailure,
  isMissingSchema,
  parseAtUri,
  normalizeConditions,
  normalizeActorFilter,
  clauseCountKey,
  filteredClauses,
  normalizeEffect,
  normalizeEffects,
  parseEffects,
  parseConditions,
  probePostExists,
  effectsDelete,
  describeAllow,
  describeCounts,
  narrowAllow,
  hasClauses,
  needsThread,
  evaluateConditions,
  countsFromPostView,
  readCounts,
  readSelfReplies,
  readFilteredQuotes,
  readFilteredCounts,
  readFollowSet,
  collectThreadRecords,
  validateArm,
  armSelfDestruct,
  sameTimerRule,
  listSelfDestructs,
  cancelSelfDestruct,
  claimDueSelfDestructs,
  reclaimStuck,
  markDeleted,
  markActed,
  markSpared,
  extendTimer,
  markFailedOrRetry,
  requeueUnspent,
  pinnedVerdict,
  fetchEngagement,
  deletePostRecord,
  deleteThreadRecords,
  resolveSelfDestruct,
  armForPublishedSchedule,
  snippetFromScheduledPayload,
};

/** Tests only: forget every cached follow list. */
export function _resetFollowsCache() {
  followsCache.clear();
}
