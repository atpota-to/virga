// Virga's server (cocoon), in memory: the endpoints the posting pages call,
// answered in cocoon's own request and response shapes (anisota-cocoon
// api/schedule/*, api/self-destruct/*, api/limits/status, api/ai/* and
// api/oauth/session, logout), with the rules that matter to a reader of those
// pages: rows belong to a client (`clientKey`), a Virga token sees every row
// of its account and may cancel another client's, but changes only its own
// (403 NOT_YOUR_CLIENT); limits are counted across clients; a scheduled post
// can't carry a reply or a video. A couple of Anisota rows are seeded so the
// cross-client rules can be seen.
//
// `runCron()` stands in for cocoon's two workers: due scheduled posts are
// written into the account's world (harness/repo.js), as putRecord at the
// record keys reserved when they were scheduled, and due timers read the
// post's counts and delete it, limit its replies or turn off its quotes.
//
// It is a stand-in, not a port: validation is the shape checks a writer can
// trip over, not every check cocoon makes.

import {
  parseAtUri,
  readRecord,
  removeRecord,
  storeBlob,
  writeRecord,
} from './repo.js';
import { createViews } from './views.js';
import { hashOf, tidAt } from './world.js';

const DAY = 86_400_000;
const MINUTE = 60_000;

export const MAX_PENDING_SCHEDULED = 50;
export const MAX_LIVE_TIMERS = 200;
export const MAX_HORIZON_DAYS = 90;
export const MIN_LIFESPAN_SECONDS = 5 * 60;
export const MAX_LIFESPAN_SECONDS = 30 * 24 * 60 * 60;

/** Free accounts' limits, as cocoon's FEATURE_LIMITS has them. */
export const FREE_LIMITS = Object.freeze({
  scheduledPosts: 3,
  postTimers: 1,
  conditionalTimers: 1,
});
const FEATURE_LABELS = {
  scheduledPosts: 'posts scheduled at a time',
  postTimers: 'post on a timer at a time',
  conditionalTimers: 'conditional timer at a time',
};

/** The AI trials, per account per month (cocoon lib/*-usage.js). */
export const AI_LIMITS = Object.freeze({ adviser: 30, style: 3, altText: 15 });

const METRICS = ['likes', 'replies', 'reposts', 'quotes', 'selfReplies'];
const EFFECT_ORDER = ['limitReplies', 'disableQuotes', 'delete'];
const ALLOW_WORDS = {
  follower: 'followerRule',
  following: 'followingRule',
  mention: 'mentionRule',
};
const SESSION_UNAVAILABLE =
  "couldn't reach your account session. reconnect your account if this keeps happening.";

function codedError(status, body) {
  return Object.assign(new Error(body.error), { httpStatus: status, body });
}

function hex(n) {
  const bytes = new Uint8Array(n);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function uuid() {
  return globalThis.crypto.randomUUID();
}

/** A UUID that stays the same between page loads, for the seeded rows. */
function seededUuid(name) {
  const h = (k) => hashOf(`${name}:${k}`).toString(16).padStart(8, '0');
  const a = `${h(1)}${h(2)}${h(3)}${h(4)}`;
  return `${a.slice(0, 8)}-${a.slice(8, 12)}-4${a.slice(13, 16)}-8${a.slice(17, 20)}-${a.slice(20, 32)}`;
}

const iso = (ms) => new Date(ms).toISOString();

/* ---- timer rules ----------------------------------------------------- */

function normalizeAllow(allow) {
  if (!Array.isArray(allow)) return ['follower'];
  const out = [];
  for (const a of allow) {
    if (typeof a === 'string' && ALLOW_WORDS[a]) out.push(a);
    else if (
      a &&
      typeof a === 'object' &&
      typeof a.list === 'string' &&
      a.list.startsWith('at://')
    )
      out.push({ list: a.list });
    else return null;
  }
  return out.slice(0, 5);
}

/** cocoon's parseEffects: absent means delete; anything unreadable is refused, never read as delete. */
export function parseEffects(raw) {
  if (raw == null || (Array.isArray(raw) && raw.length === 0))
    return { value: [{ action: 'delete' }] };
  if (!Array.isArray(raw))
    return { error: 'selfDestruct.effects must be a list' };
  const byAction = new Map();
  for (const item of raw) {
    if (!item || !EFFECT_ORDER.includes(item.action)) {
      return {
        error:
          'that rule asks for something this server does not know how to do. update, or set a plain delete timer.',
      };
    }
    if (item.action === 'limitReplies') {
      const allow = normalizeAllow(item.allow);
      if (!allow)
        return {
          error: 'that reply rule names someone this server cannot read.',
        };
      byAction.set(item.action, { action: item.action, allow });
    } else byAction.set(item.action, { action: item.action });
  }
  return {
    value: [...byAction.values()].sort(
      (a, b) => EFFECT_ORDER.indexOf(a.action) - EFFECT_ORDER.indexOf(b.action),
    ),
  };
}

/** cocoon's parseConditions, with legacy `mode` / `minLikes` keys read the same way. */
export function parseConditions(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const clauses = [];
  const items = Array.isArray(src.clauses) ? [...src.clauses] : [];
  for (const [legacy, metric] of [
    ['minLikes', 'likes'],
    ['minReplies', 'replies'],
    ['minReposts', 'reposts'],
  ]) {
    if (legacy in src) items.push({ metric, op: 'gte', value: src[legacy] });
  }
  for (const c of items) {
    if (!c || !METRICS.includes(c.metric))
      return { error: 'that rule counts something this server does not know.' };
    const value = Math.min(1_000_000, Math.floor(Number(c.value)));
    if (!Number.isFinite(value) || value < 1)
      return { error: 'a rule needs a number of at least one.' };
    if (c.from && c.metric !== 'quotes')
      return { error: 'only quotes can be counted from some people.' };
    if (clauses.some((x) => x.metric === c.metric && !x.from && !c.from))
      continue;
    clauses.push({
      metric: c.metric,
      op: c.op === 'gt' ? 'gt' : 'gte',
      value,
      ...(c.from ? { from: c.from } : {}),
    });
  }
  if (clauses.length > 5)
    return { error: 'a rule can have at most five parts.' };
  clauses.sort((a, b) => METRICS.indexOf(a.metric) - METRICS.indexOf(b.metric));
  const logic = ['any', 'all'].includes(src.logic)
    ? src.logic
    : ['any', 'all'].includes(src.mode)
      ? src.mode
      : 'any';
  const onSpare = src.onSpare === 'extend' ? 'extend' : 'keep';
  const wanted = Number(src.maxExtensions);
  return {
    value: {
      logic,
      clauses,
      sense: src.sense === 'onlyIf' ? 'onlyIf' : 'unless',
      onSpare,
      maxExtensions:
        onSpare === 'extend'
          ? Number.isFinite(wanted)
            ? Math.min(Math.max(Math.floor(wanted), 1), 10)
            : 1
          : 0,
    },
  };
}

/** Which limit a timer counts against: anything but a plain delete is conditional. */
export function timerBucket({ conditions, effects } = {}) {
  const clauses = conditions?.clauses || [];
  const gentle = (effects || []).some((e) => e.action !== 'delete');
  return clauses.length > 0 || gentle ? 'conditional' : 'plain';
}

const BUCKET_FEATURE = {
  plain: 'postTimers',
  conditional: 'conditionalTimers',
};

function describeCounts(c) {
  const n = (v, one, many) => `${v} ${v === 1 ? one : many}`;
  return `${n(c.likes, 'like', 'likes')}, ${n(c.replies, 'reply', 'replies')}, ${n(c.reposts, 'repost', 'reposts')}`;
}

/** Whether the rule spares the post on these counts, and why. */
export function evaluateConditions(conditions, counts) {
  const clauses = conditions?.clauses || [];
  const met = clauses.filter((c) =>
    c.op === 'gt' ? counts[c.metric] > c.value : counts[c.metric] >= c.value,
  );
  const matched =
    conditions.logic === 'all' ? met.length === clauses.length : met.length > 0;
  const spare = conditions.sense === 'onlyIf' ? !matched : matched;
  const reason = clauses
    .map((c) => `${counts[c.metric]} of ${c.value} ${c.metric}`)
    .join(', ');
  return {
    spare,
    matched,
    reason: matched ? `matched with ${reason}` : `short of ${reason}`,
  };
}

/* ---- the store ------------------------------------------------------- */

/**
 * @param {object} options
 * @param {object[]} options.worlds - every account's world
 * @param {'membership'|'flat'} [options.policy] - VIRGA_FEATURE_LIMITS
 * @param {Record<string, string|null>} [options.tiers] - DID → membership tier ('member', or null for free)
 * @param {boolean} [options.seed] - seed a few rows, some of them Anisota's
 * @param {number} [options.aiDelayMs] - how long an AI answer takes
 * @param {'ok'|'slow'|'down'} [options.ai] - slow takes longer than the adviser waits; down answers 503
 * @param {() => number} [options.now]
 */
export function createCocoon({
  worlds,
  policy = 'membership',
  tiers = {},
  seed = true,
  aiDelayMs = 900,
  ai = 'ok',
  now = () => Date.now(),
} = {}) {
  const list = Array.isArray(worlds) ? worlds : [worlds];
  const views = createViews(list);
  const worldOf = (did) => views.byDid.get(did) || null;

  const tokens = new Map(); // token → { did, client }
  const grants = new Set(); // `${client}:${did}`: the OAuth grant the workers act with
  const scheduled = []; // snake_case rows, as the table holds them
  const timers = [];
  const media = new Map(); // `${rowId}/${mediaId}` → { base64, encoding }
  const aiUsage = new Map(); // `${did}:${kind}:${month}` → count
  const log = [];

  const note = (line) => {
    log.push({ at: iso(now()), line });
    if (log.length > 200) log.shift();
  };

  /* ---- sessions ---- */

  function mintToken(did, client = 'virga') {
    const token = client === 'virga' ? `vg_${hex(32)}` : hex(32);
    tokens.set(token, { did, client });
    grants.add(`${client}:${did}`);
    return token;
  }

  function signOutToken(token) {
    const found = tokens.get(token);
    if (!found) return { found: false, grantRevoked: false };
    tokens.delete(token);
    // Per device (D3): the grant goes only with the account's last token.
    const left = [...tokens.values()].some(
      (t) => t.did === found.did && t.client === found.client,
    );
    if (!left) grants.delete(`${found.client}:${found.did}`);
    return { found: true, grantRevoked: !left };
  }

  /** Make every token of an account stop working, as an expired session would. */
  function expireAccount(did) {
    for (const [token, t] of tokens) if (t.did === did) tokens.delete(token);
    grants.delete(`virga:${did}`);
  }

  function authOf(headers) {
    const header = headers.authorization || '';
    const m = /^Bearer\s+(\S+)$/i.exec(header);
    if (!m)
      throw codedError(401, {
        success: false,
        error: 'Missing or invalid authorization header',
      });
    const found = tokens.get(m[1]);
    if (!found)
      throw codedError(401, {
        success: false,
        error: 'Invalid or expired session',
      });
    return { ...found, token: m[1] };
  }

  /* ---- limits ---- */

  const isMember = (did) => tiers[did] === 'member';
  const policyFor = (client) => (client === 'virga' ? policy : 'membership');

  function limitFor(did, client, feature) {
    if (policyFor(client) === 'flat' || isMember(did)) return null;
    return FREE_LIMITS[feature];
  }

  const activeScheduled = (did, exceptId = null) =>
    scheduled.filter(
      (r) =>
        r.user_did === did &&
        r.id !== exceptId &&
        (r.status === 'pending' || r.status === 'publishing'),
    );
  const liveTimers = (did) =>
    timers.filter(
      (t) =>
        t.user_did === did && (t.status === 'armed' || t.status === 'checking'),
    );

  /** Timers in use per bucket: live ones plus scheduled posts waiting with one. */
  function timerUsage(
    did,
    { exceptScheduledId = null, exceptPostUri = null } = {},
  ) {
    const used = { plain: 0, conditional: 0 };
    for (const t of liveTimers(did))
      if (t.post_uri !== exceptPostUri) used[timerBucket(t)] += 1;
    for (const r of activeScheduled(did, exceptScheduledId)) {
      if (r.status === 'pending' && r.payload?.selfDestruct)
        used[timerBucket(r.payload.selfDestruct)] += 1;
    }
    return used;
  }

  function enforceTimerLimit(did, client, rule, except) {
    const bucket = timerBucket(rule);
    const feature = BUCKET_FEATURE[bucket];
    const limit = limitFor(did, client, feature);
    if (limit != null && timerUsage(did, except)[bucket] >= limit) {
      throw codedError(402, {
        success: false,
        error: `free accounts are limited to ${limit} ${FEATURE_LABELS[feature]}`,
        code: 'QUOTA_EXCEEDED',
        feature,
        limit,
      });
    }
    if (liveTimers(did).length >= MAX_LIVE_TIMERS) {
      throw codedError(409, {
        success: false,
        error: `you can have at most ${MAX_LIVE_TIMERS} timers running`,
        code: 'QUOTA_EXCEEDED',
      });
    }
  }

  function enforceScheduledLimit(did, client, exceptId = null) {
    const count = activeScheduled(did, exceptId).length;
    if (count >= MAX_PENDING_SCHEDULED) {
      throw codedError(409, {
        success: false,
        error: `you can have at most ${MAX_PENDING_SCHEDULED} scheduled posts`,
        code: 'QUOTA_EXCEEDED',
        feature: 'scheduledPosts',
        limit: MAX_PENDING_SCHEDULED,
      });
    }
    const limit = limitFor(did, client, 'scheduledPosts');
    if (limit != null && count >= limit) {
      throw codedError(409, {
        success: false,
        error: `free accounts are limited to ${limit} ${FEATURE_LABELS.scheduledPosts}`,
        code: 'QUOTA_EXCEEDED',
        feature: 'scheduledPosts',
        limit,
      });
    }
  }

  /* ---- scheduled posts ---- */

  function validateTime(scheduledFor) {
    if (!scheduledFor) return 'scheduledFor is required';
    const when = Date.parse(scheduledFor);
    if (!Number.isFinite(when)) return 'scheduledFor is not a valid datetime';
    if (when <= now()) return 'scheduledFor must be in the future';
    if (when > now() + MAX_HORIZON_DAYS * DAY)
      return `scheduledFor must be within ${MAX_HORIZON_DAYS} days`;
    return null;
  }

  function validateEmbed(embed, nested = false) {
    if (!embed) return null;
    switch (embed.type) {
      case 'images':
        if (!Array.isArray(embed.images) || embed.images.length === 0)
          return 'images embed needs at least one image';
        if (embed.images.length > 10)
          return 'a post can have at most 10 images';
        if (embed.images.some((i) => !i.mediaId))
          return 'each image needs a mediaId';
        return null;
      case 'external':
        return embed.uri ? null : 'external embed needs a uri';
      case 'record':
        return embed.uri && embed.cid ? null : 'record embed needs uri and cid';
      case 'recordWithMedia':
        if (nested) return 'nested recordWithMedia is not allowed';
        if (!embed.uri || !embed.cid)
          return 'recordWithMedia needs the quoted uri and cid';
        return validateEmbed(embed.media, true);
      default:
        return `unknown embed type: ${embed.type}`;
    }
  }

  function mediaIdsOf(embed, out = []) {
    if (!embed) return out;
    if (embed.type === 'images')
      for (const i of embed.images) out.push(i.mediaId);
    else if (embed.type === 'external' && embed.thumbMediaId)
      out.push(embed.thumbMediaId);
    else if (embed.type === 'recordWithMedia') mediaIdsOf(embed.media, out);
    return out;
  }

  function validateSelfDestructSpec(raw, scheduledForMs) {
    if (raw == null) return { value: null };
    if (typeof raw !== 'object')
      return { error: 'selfDestruct must be an object' };
    const seconds = Math.floor(Number(raw.lifespanSeconds));
    if (!Number.isFinite(seconds))
      return { error: 'selfDestruct.lifespanSeconds is required' };
    if (seconds < MIN_LIFESPAN_SECONDS)
      return { error: 'a post has to stand for at least 5 minutes' };
    if (seconds > MAX_LIFESPAN_SECONDS)
      return { error: 'a timer can run for at most 30 days' };
    let deleteAt = null;
    if (raw.deleteAt) {
      const at = Date.parse(raw.deleteAt);
      if (!Number.isFinite(at))
        return { error: 'selfDestruct.deleteAt is not a valid datetime' };
      if (at < scheduledForMs + MIN_LIFESPAN_SECONDS * 1000) {
        return {
          error:
            'the delete time is before this post would even publish. pick a later delete time, or use a duration instead.',
        };
      }
      deleteAt = iso(at);
    }
    const effects = parseEffects(raw.effects);
    if (effects.error) return { error: effects.error };
    const conditions = parseConditions(raw.conditions);
    if (conditions.error) return { error: conditions.error };
    return {
      value: {
        lifespanSeconds: seconds,
        deleteAt,
        conditions: conditions.value,
        effects: effects.value,
      },
    };
  }

  function validateCreate(
    client,
    { scheduledFor, target = 'bluesky', payload, queued },
  ) {
    const timeError = validateTime(scheduledFor);
    if (timeError) return { error: timeError };
    const allowed = client === 'virga' ? ['bluesky'] : ['bluesky', 'anisota'];
    if (!allowed.includes(target))
      return { error: `target must be one of: ${allowed.join(', ')}` };
    if (!payload || typeof payload !== 'object')
      return { error: 'payload is required' };
    const posts = payload.posts;
    if (!Array.isArray(posts) || posts.length === 0)
      return { error: 'payload.posts must be a non-empty array' };
    if (posts.length > 25)
      return { error: 'a thread can have at most 25 posts' };
    for (const [i, p] of posts.entries()) {
      if (!p || typeof p.record !== 'object')
        return { error: `posts[${i}].record is required` };
      const text = typeof p.record.text === 'string' ? p.record.text : '';
      if (text.length > 3000)
        return { error: `posts[${i}] text exceeds 3000 characters` };
      if (!text.trim() && !p.embed)
        return { error: `posts[${i}] needs text or an embed` };
      // cocoon's payload has no reply and no video: the composer refuses both first.
      if (p.record.reply)
        return { error: `posts[${i}]: a scheduled post can't be a reply` };
      if (p.embed?.type === 'video')
        return { error: `posts[${i}]: unknown embed type: video` };
      const embedError = validateEmbed(p.embed);
      if (embedError) return { error: `posts[${i}]: ${embedError}` };
    }
    const sd = validateSelfDestructSpec(
      payload.selfDestruct,
      Date.parse(scheduledFor),
    );
    if (sd.error) return { error: sd.error };
    const gates = payload.gates || {};
    return {
      value: {
        scheduledFor: iso(Date.parse(scheduledFor)),
        target,
        posts,
        gates: {
          threadgate: gates.threadgate ?? null,
          postgate: gates.postgate ?? null,
        },
        queued: !!queued,
        selfDestruct: sd.value,
        tz: typeof payload.tz === 'string' ? payload.tz : undefined,
      },
    };
  }

  /** Record keys for each post of a row, minted from its time and kept clear of every other row's. */
  function assignRkeys(did, scheduledFor, count, exceptId = null) {
    const taken = new Set();
    for (const r of scheduled)
      if (r.user_did === did && r.id !== exceptId)
        for (const k of r.payload?.rkeys || []) taken.add(k);
    const base = Date.parse(scheduledFor);
    let clock = hashOf(`${did}${scheduledFor}`) % 1024;
    // Every clock id is tried before giving up on a collision; 1024 rows at
    // one minute is more than any account schedules.
    for (let tries = 0; tries < 1024; tries++, clock = (clock + 7) % 1024) {
      const keys = Array.from({ length: count }, (_, i) =>
        tidAt(base + i, clock),
      );
      if (keys.every((k) => !taken.has(k))) return keys;
    }
    throw new Error('no free record keys at that time');
  }

  function stashMedia(rowId, posts, mediaBytes) {
    const map = {};
    for (const p of posts) {
      for (const id of mediaIdsOf(p.embed)) {
        const bytes = mediaBytes?.[id];
        if (!bytes?.base64)
          throw codedError(400, {
            success: false,
            error: `missing bytes for media "${id}"`,
          });
        const storagePath = `${rowId}/${String(id).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
        media.set(storagePath, {
          base64: bytes.base64,
          encoding: bytes.encoding,
        });
        map[id] = { storagePath, encoding: bytes.encoding };
      }
    }
    return map;
  }

  function dropMedia(row) {
    for (const m of Object.values(row.payload?.media || {}))
      media.delete(m.storagePath);
  }

  function rowShape(row, { list = false } = {}) {
    const out = {
      id: row.id,
      scheduledFor: row.scheduled_for,
      status: row.status,
      target: row.target,
      queued: !!row.queued,
      payload: row.payload,
      clientKey: row.client_key,
      createdAt: row.created_at,
    };
    if (list) out.partial = row.progress.length > 0;
    Object.assign(out, {
      resultUri: row.result_uri || null,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      lastError: row.last_error || null,
      lastErrorCode: row.last_error_code || null,
    });
    return out;
  }

  /** The rows a caller can see: Anisota sees only its own, Virga every row of the account. */
  function visibleRows(auth) {
    return scheduled.filter(
      (r) =>
        r.user_did === auth.did &&
        (auth.client === 'virga' || r.client_key === auth.client),
    );
  }

  function ownedRow(auth, id) {
    const row = visibleRows(auth).find((r) => r.id === id) || null;
    if (row && row.client_key !== auth.client) {
      throw codedError(403, {
        success: false,
        error:
          'this post was scheduled from another app, so it can only be changed there.',
        code: 'NOT_YOUR_CLIENT',
      });
    }
    return row;
  }

  function insertScheduled({
    did,
    client,
    value,
    mediaBytes,
    id = uuid(),
    status = 'pending',
    extra = {},
  }) {
    const rkeys = assignRkeys(did, value.scheduledFor, value.posts.length);
    const row = {
      id,
      user_did: did,
      client_key: client,
      scheduled_for: value.scheduledFor,
      status,
      target: value.target,
      queued: value.queued,
      payload: {
        posts: value.posts,
        gates: value.gates,
        media: {},
        rkeys,
        tz: value.tz,
        selfDestruct: value.selfDestruct,
      },
      progress: [],
      result_uri: null,
      result_cid: null,
      attempts: 0,
      max_attempts: 5,
      next_attempt_at: null,
      last_error: null,
      last_error_code: null,
      created_at: iso(now()),
      updated_at: iso(now()),
      ...extra,
    };
    row.payload.media = stashMedia(row.id, value.posts, mediaBytes || {});
    scheduled.push(row);
    return row;
  }

  const api = {};

  api['POST /api/schedule/create'] = (auth, { body }) => {
    const v = validateCreate(auth.client, body || {});
    if (v.error) throw codedError(400, { success: false, error: v.error });
    if (v.value.selfDestruct)
      enforceTimerLimit(auth.did, auth.client, v.value.selfDestruct, {});
    enforceScheduledLimit(auth.did, auth.client);
    const row = insertScheduled({
      did: auth.did,
      client: auth.client,
      value: v.value,
      mediaBytes: body.payload.mediaBytes,
    });
    note(`scheduled ${row.id} for ${row.scheduled_for} (${auth.client})`);
    return [201, { success: true, data: rowShape(row) }];
  };

  api['GET /api/schedule/list'] = (auth) => {
    const rows = visibleRows(auth)
      .filter(
        (r) =>
          ['pending', 'publishing', 'failed'].includes(r.status) ||
          (r.status === 'published' && r.last_error_code === 'TIMER_NOT_ARMED'),
      )
      .sort((a, b) => (a.scheduled_for < b.scheduled_for ? -1 : 1));
    return [
      200,
      { success: true, data: rows.map((r) => rowShape(r, { list: true })) },
    ];
  };

  api['GET /api/schedule/get'] = (auth, { query }) => {
    if (!query.get('id'))
      throw codedError(400, { success: false, error: 'Missing id' });
    const row = visibleRows(auth).find((r) => r.id === query.get('id'));
    if (!row) throw codedError(404, { success: false, error: 'Not found' });
    return [200, { success: true, data: rowShape(row) }];
  };

  api['GET /api/schedule/media'] = (auth, { query }) => {
    const row = visibleRows(auth).find((r) => r.id === query.get('id'));
    if (!row) throw codedError(404, { success: false, error: 'Not found' });
    const out = {};
    for (const [id, m] of Object.entries(row.payload.media || {})) {
      const stored = media.get(m.storagePath);
      if (stored)
        out[id] = { base64: stored.base64, encoding: stored.encoding };
    }
    return [200, { success: true, data: out }];
  };

  api['POST /api/schedule/update'] = (auth, { body = {} }) => {
    const { id, scheduledFor, payload, retry, acknowledgeTimer } = body;
    if (!id) throw codedError(400, { success: false, error: 'Missing id' });
    const row = ownedRow(auth, id);
    const refuse = (error, code, extra = {}) =>
      codedError(409, { success: false, error, code, ...extra });
    if (acknowledgeTimer) {
      if (
        !row ||
        row.status !== 'published' ||
        row.last_error_code !== 'TIMER_NOT_ARMED'
      ) {
        throw refuse(
          'there is no timer note on that post to clear.',
          'NOT_ACKNOWLEDGEABLE',
        );
      }
      Object.assign(row, {
        last_error: null,
        last_error_code: null,
        updated_at: iso(now()),
      });
    } else if (retry) {
      if (!row || row.status !== 'failed') {
        throw refuse(
          'this post can no longer be retried — it may have been dismissed, or already be back in the queue.',
          'NOT_RETRIABLE',
        );
      }
      if (row.payload.selfDestruct)
        enforceTimerLimit(auth.did, auth.client, row.payload.selfDestruct, {
          exceptScheduledId: id,
        });
      enforceScheduledLimit(auth.did, auth.client, id);
      Object.assign(row, {
        status: 'pending',
        attempts: 0,
        next_attempt_at: null,
        updated_at: iso(now()),
      });
    } else if (payload) {
      const v = validateCreate(auth.client, body);
      if (v.error) throw codedError(400, { success: false, error: v.error });
      if (!row || !['pending', 'failed'].includes(row.status)) {
        throw refuse(
          'This post can no longer be rescheduled — it may already be publishing.',
          'NOT_RESCHEDULABLE',
        );
      }
      if (row.progress.length)
        throw refuse(
          'part of this thread is already posted. the rest will follow on its own — cancel it here if you would rather finish by hand.',
          'PARTIALLY_PUBLISHED',
        );
      if (v.value.selfDestruct)
        enforceTimerLimit(auth.did, auth.client, v.value.selfDestruct, {
          exceptScheduledId: id,
        });
      if (row.status === 'failed')
        enforceScheduledLimit(auth.did, auth.client, id);
      dropMedia(row);
      const fresh = stashMedia(row.id, v.value.posts, payload.mediaBytes || {});
      Object.assign(row, {
        scheduled_for: v.value.scheduledFor,
        target: v.value.target,
        queued: v.value.queued,
        status: 'pending',
        attempts: 0,
        next_attempt_at: null,
        last_error: null,
        last_error_code: null,
        payload: {
          posts: v.value.posts,
          gates: v.value.gates,
          media: fresh,
          rkeys: assignRkeys(
            auth.did,
            v.value.scheduledFor,
            v.value.posts.length,
            row.id,
          ),
          tz: v.value.tz,
          selfDestruct: v.value.selfDestruct,
        },
        updated_at: iso(now()),
      });
    } else {
      const timeError = validateTime(scheduledFor);
      if (timeError)
        throw codedError(400, { success: false, error: timeError });
      if (!row || row.status !== 'pending')
        throw refuse(
          'This post can no longer be rescheduled — it may already be publishing.',
          'NOT_RESCHEDULABLE',
        );
      if (row.progress.length)
        throw refuse(
          'part of this thread is already posted. the rest will follow on its own — cancel it here if you would rather finish by hand.',
          'PARTIALLY_PUBLISHED',
        );
      const stranded = strandsDeleteTime(row.payload, scheduledFor);
      if (stranded) {
        throw refuse(
          "this post's delete time would come before it goes out, or within five minutes of it. pick an earlier slot, or change its lifespan first.",
          'DELETE_TIME_TOO_EARLY',
          { deleteAt: stranded },
        );
      }
      row.scheduled_for = iso(Date.parse(scheduledFor));
      row.payload = {
        ...row.payload,
        rkeys: assignRkeys(
          auth.did,
          row.scheduled_for,
          row.payload.posts.length,
          row.id,
        ),
      };
      row.updated_at = iso(now());
    }
    note(`updated ${row.id}`);
    return [200, { success: true, data: rowShape(row) }];
  };

  function strandsDeleteTime(payload, scheduledFor) {
    const deleteAt = payload?.selfDestruct?.deleteAt;
    if (!deleteAt) return null;
    return Date.parse(scheduledFor) >
      Date.parse(deleteAt) - MIN_LIFESPAN_SECONDS * 1000
      ? deleteAt
      : null;
  }

  api['POST /api/schedule/reorder'] = (auth, { body = {} }) => {
    const moves = body.moves;
    const bad = (error) =>
      codedError(400, { success: false, error, code: 'BAD_REQUEST' });
    if (!Array.isArray(moves))
      throw bad('a reorder needs a list of posts to move.');
    if (moves.length === 0 || moves.length > 50)
      throw bad('a reorder carries between one and 50 posts.');
    const wanted = new Map();
    for (const m of moves) {
      if (!m?.id || wanted.has(m.id))
        throw bad('a post appears twice in that reorder.');
      if (validateTime(m.scheduledFor))
        throw bad(
          `a reorder needs a new time for every post — in the future, and within ${MAX_HORIZON_DAYS} days.`,
        );
      wanted.set(m.id, iso(Date.parse(m.scheduledFor)));
    }
    const rows = [...wanted.keys()].map((id) =>
      visibleRows(auth).find((r) => r.id === id),
    );
    if (rows.some((r) => r && r.client_key !== auth.client)) {
      throw codedError(403, {
        success: false,
        error:
          'one of these posts was scheduled from another app, so it can only be moved there. your queue is unchanged.',
        code: 'NOT_YOUR_CLIENT',
      });
    }
    if (rows.some((r) => !r || r.status !== 'pending' || r.progress.length)) {
      throw codedError(409, {
        success: false,
        error:
          'one of these posts can no longer be moved — it may already be publishing, or part of it may already be posted. your queue is unchanged.',
        code: 'NOT_REORDERABLE',
      });
    }
    for (const r of rows) {
      const stranded = strandsDeleteTime(r.payload, wanted.get(r.id));
      if (stranded) {
        throw codedError(409, {
          success: false,
          error:
            'the delete time on one of these posts would come before it goes out in this order, or within five minutes of it. move it earlier, or change its lifespan first. your queue is unchanged.',
          code: 'DELETE_TIME_TOO_EARLY',
          id: r.id,
          deleteAt: stranded,
        });
      }
    }
    for (const r of rows) {
      r.scheduled_for = wanted.get(r.id);
      r.payload = {
        ...r.payload,
        rkeys: assignRkeys(
          auth.did,
          r.scheduled_for,
          r.payload.posts.length,
          r.id,
        ),
      };
      r.updated_at = iso(now());
    }
    return [200, { success: true, moved: rows.length }];
  };

  api['POST /api/schedule/cancel'] = (auth, { body = {}, query }) => {
    const id = body.id || query.get('id');
    if (!id) throw codedError(400, { success: false, error: 'Missing id' });
    // Virga may cancel any row of the account; Anisota only sees its own.
    const row = visibleRows(auth).find((r) => r.id === id);
    if (!row || !['pending', 'failed'].includes(row.status)) {
      throw codedError(409, {
        success: false,
        error:
          'that post can no longer be cancelled. it may already be publishing.',
        code: 'NOT_CANCELLABLE',
      });
    }
    row.status = 'cancelled';
    row.updated_at = iso(now());
    dropMedia(row);
    note(`cancelled ${row.id}`);
    return [200, { success: true, data: { id: row.id, status: row.status } }];
  };

  /* ---- timers ---- */

  function timerShape(t, { list = false } = {}) {
    const out = {
      id: t.id,
      postUri: t.post_uri,
      collection: t.collection,
      snippet: t.snippet || null,
      postedAt: t.posted_at,
      checkAt: t.check_at,
      status: t.status,
      conditions: t.conditions || {},
      lifespanSeconds: t.lifespan_seconds,
      extensions: t.extensions || 0,
      effects: t.effects || null,
      acted: t.acted || null,
      clientKey: t.client_key,
      createdAt: t.created_at,
    };
    if (list) {
      Object.assign(out, {
        lastCounts: t.last_counts || null,
        resolution: t.resolution || null,
        resolvedAt: t.resolved_at || null,
        attempts: t.attempts,
        maxAttempts: t.max_attempts,
        lastError: t.last_error || null,
        lastErrorCode: t.last_error_code || null,
      });
    }
    return out;
  }

  /** cocoon's validateArm, for the parts a writer can get wrong. */
  function validateArm(
    did,
    body,
    { refusePastDeadline = false, missedDeadline = 'floor' } = {},
  ) {
    const uri = parseAtUri(body.postUri);
    if (!uri || !uri.did.startsWith('did:'))
      return { error: 'postUri must be an at:// URI of a post' };
    if (uri.did !== did)
      return { error: 'you can only set a timer on your own post' };
    if (uri.collection !== 'app.bsky.feed.post')
      return { error: 'timers are for Bluesky posts' };
    const effects = parseEffects(body.effects);
    if (effects.error) return { error: effects.error };
    const conditions = parseConditions(body.conditions);
    if (conditions.error) return { error: conditions.error };
    const seconds = Math.floor(Number(body.lifespanSeconds));
    if (
      !Number.isFinite(seconds) ||
      seconds < MIN_LIFESPAN_SECONDS ||
      seconds > MAX_LIFESPAN_SECONDS
    ) {
      return { error: 'a timer runs for between five minutes and thirty days' };
    }
    const extras = Array.isArray(body.extraUris) ? body.extraUris : [];
    if (extras.length > 100)
      return { error: 'a timer can take at most 100 more posts of a thread' };
    const extra = [];
    for (const e of extras) {
      const p = parseAtUri(typeof e === 'string' ? e : e?.uri);
      if (!p || p.did !== did || p.collection !== uri.collection)
        return { error: 'every post of the thread has to be yours' };
      extra.push({
        uri: `at://${p.did}/${p.collection}/${p.rkey}`,
        collection: p.collection,
        rkey: p.rkey,
      });
    }
    const t = now();
    const floor = t + MIN_LIFESPAN_SECONDS * 1000;
    const posted = Date.parse(body.postedAt);
    const startedAt =
      Number.isFinite(posted) && posted <= t && t - posted < seconds * 1000
        ? posted
        : t;
    let checkAt = Math.max(startedAt + seconds * 1000, floor);
    let resolution = null;
    if (body.deleteAt) {
      const at = Date.parse(body.deleteAt);
      if (!Number.isFinite(at))
        return { error: 'deleteAt is not a valid datetime' };
      if (at > t + 30 * DAY)
        return { error: 'a delete time can be at most thirty days away' };
      if (refusePastDeadline && at < t - 60_000)
        return {
          error:
            'that delete time has already passed, so no timer was set. pick a later time.',
        };
      if (
        missedDeadline === 'window' &&
        at < startedAt + MIN_LIFESPAN_SECONDS * 1000
      ) {
        resolution =
          'the delete time had passed by the time this went out, so it runs for its length instead';
      } else checkAt = Math.max(at, floor);
    }
    return {
      value: {
        uri: `at://${uri.did}/${uri.collection}/${uri.rkey}`,
        collection: uri.collection,
        rkey: uri.rkey,
        cid: typeof body.postCid === 'string' ? body.postCid : null,
        extra,
        snippet:
          typeof body.snippet === 'string' ? body.snippet.slice(0, 200) : null,
        postedAt: iso(startedAt),
        checkAt: iso(checkAt),
        seconds,
        conditions: conditions.value,
        effects: effects.value,
        resolution,
      },
    };
  }

  function armTimer(did, client, v, { id = uuid(), extra = {} } = {}) {
    const existing = liveTimers(did).find((t) => t.post_uri === v.uri);
    if (existing) return { row: existing, existing: true };
    const row = {
      id,
      user_did: did,
      client_key: client,
      post_uri: v.uri,
      post_cid: v.cid,
      collection: v.collection,
      rkey: v.rkey,
      extra_uris: v.extra,
      snippet: v.snippet,
      posted_at: v.postedAt,
      check_at: v.checkAt,
      status: 'armed',
      conditions: v.conditions,
      effects: v.effects,
      acted: null,
      lifespan_seconds: v.seconds,
      extensions: 0,
      last_counts: null,
      resolution: v.resolution,
      resolved_at: null,
      attempts: 0,
      max_attempts: 5,
      last_error: null,
      last_error_code: null,
      created_at: iso(now()),
      ...extra,
    };
    timers.push(row);
    return { row, existing: false };
  }

  api['POST /api/self-destruct/create'] = (auth, { body = {} }) => {
    const v = validateArm(auth.did, body, { refusePastDeadline: true });
    if (v.error) throw codedError(400, { success: false, error: v.error });
    enforceTimerLimit(auth.did, auth.client, v.value, {
      exceptPostUri: v.value.uri,
    });
    const { row, existing } = armTimer(auth.did, auth.client, v.value);
    if (!existing)
      note(`timer ${row.id} on ${row.post_uri} for ${row.check_at}`);
    return [existing ? 200 : 201, { success: true, data: timerShape(row) }];
  };

  api['GET /api/self-destruct/list'] = (auth, { query }) => {
    const history =
      query.get('history') === '1' || query.get('history') === 'true';
    const mine = timers.filter(
      (t) =>
        t.user_did === auth.did &&
        (auth.client === 'virga' || t.client_key === auth.client),
    );
    const by = (key, dir) => (a, b) =>
      dir * String(a[key] || '').localeCompare(String(b[key] || ''));
    const live = mine
      .filter((t) => t.status === 'armed' || t.status === 'checking')
      .sort(by('check_at', 1));
    const failed = mine
      .filter((t) => t.status === 'failed')
      .sort(by('resolved_at', -1));
    const settled = history
      ? mine
          .filter((t) => ['acted', 'deleted', 'spared'].includes(t.status))
          .sort(by('resolved_at', -1))
      : mine
          .filter(
            (t) =>
              t.status === 'acted' &&
              Date.parse(t.resolved_at) > now() - 7 * DAY,
          )
          .sort(by('resolved_at', -1));
    return [
      200,
      {
        success: true,
        data: [...live, ...failed, ...settled]
          .slice(0, 100)
          .map((t) => timerShape(t, { list: true })),
      },
    ];
  };

  api['POST /api/self-destruct/cancel'] = (auth, { body = {}, query }) => {
    const id = body.id || query.get('id');
    if (!id) throw codedError(400, { success: false, error: 'Missing id' });
    const row = timers.find(
      (t) =>
        t.id === id &&
        t.user_did === auth.did &&
        (auth.client === 'virga' || t.client_key === auth.client),
    );
    if (!row || !['armed', 'failed'].includes(row.status)) {
      throw codedError(409, {
        success: false,
        error:
          'that timer is no longer waiting. it is running now, or it has already settled.',
        code: 'NOT_CANCELLABLE',
      });
    }
    Object.assign(row, {
      status: 'cancelled',
      resolution: 'called off',
      resolved_at: iso(now()),
    });
    note(`timer ${row.id} called off`);
    return [200, { success: true, data: { id: row.id, status: row.status } }];
  };

  /* ---- limits ---- */

  api['GET /api/limits/status'] = (auth) => {
    const member = isMember(auth.did);
    const features = {};
    for (const key of Object.keys(FREE_LIMITS)) {
      const limit = limitFor(auth.did, auth.client, key);
      features[key] = {
        isUnlimited: limit == null,
        limit,
        freeLimit: FREE_LIMITS[key],
        countSource: 'cocoon',
      };
    }
    const usage = timerUsage(auth.did);
    return [
      200,
      {
        success: true,
        tier: member ? 'member' : null,
        isMember: member,
        policy: policyFor(auth.client),
        features,
        usage: {
          scheduledPosts: activeScheduled(auth.did).length,
          postTimers: usage.plain,
          conditionalTimers: usage.conditional,
        },
        // cocoon reports the flat ceilings to Virga callers beside the policy.
        ...(auth.client === 'virga'
          ? {
              caps: {
                scheduledPosts: MAX_PENDING_SCHEDULED,
                timers: MAX_LIVE_TIMERS,
              },
            }
          : {}),
      },
    ];
  };

  /* ---- the adviser and alt text ---- */

  const month = () => iso(now()).slice(0, 7);
  function takeTrial(did, kind) {
    if (isMember(did)) return null;
    const key = `${did}:${kind}:${month()}`;
    const used = aiUsage.get(key) || 0;
    if (used >= AI_LIMITS[kind])
      throw codedError(429, {
        error: 'monthly_limit',
        limit: AI_LIMITS[kind],
        used,
      });
    return {
      commit() {
        aiUsage.set(key, used + 1);
        return { used: used + 1, limit: AI_LIMITS[kind] };
      },
    };
  }

  async function aiPause() {
    if (ai === 'down')
      throw codedError(503, {
        error: 'The AI gateway is unavailable right now.',
      });
    const ms = ai === 'slow' ? 14_000 : aiDelayMs;
    if (ms > 0) await new Promise((r) => setTimeout(r, ms));
  }

  api['POST /api/ai/analyze-post'] = async (auth, { body = {} }) => {
    if (typeof body.text !== 'string' || !body.text.trim())
      throw codedError(400, { error: 'Missing or empty "text"' });
    if (body.text.length > 3000)
      throw codedError(413, { error: 'Post text is too long to analyze' });
    const result = analyzePost(body);
    if (!result)
      return [
        200,
        {
          sentiment: { label: 'neutral', score: 0 },
          checks: [],
          suggestion: null,
          overallStatus: 'ok',
        },
      ];
    const trial = takeTrial(auth.did, 'adviser');
    await aiPause();
    if (trial) result.usage = trial.commit();
    return [200, result];
  };

  api['POST /api/ai/synthesize-style'] = async (auth, { body = {} }) => {
    const posts = (Array.isArray(body.posts) ? body.posts : [])
      .map((p) => (typeof p === 'string' ? p : p?.text))
      .filter((t) => typeof t === 'string' && t.trim())
      .slice(0, 500);
    if (posts.length < 5)
      throw codedError(400, { error: 'not_enough_posts', minimum: 5 });
    const trial = takeTrial(auth.did, 'style');
    await aiPause();
    const out = {
      summary: styleSummary(posts, body.guidance),
      analyzedCount: posts.length,
    };
    if (trial) out.usage = trial.commit();
    return [200, out];
  };

  api['POST /api/ai/alt-text'] = async (auth, { body = {} }) => {
    if (!body.imageBase64)
      throw codedError(400, { error: 'Missing "imageBase64"' });
    if (!/^image\/(jpeg|png|webp|gif)$/.test(body.mimeType || ''))
      throw codedError(400, { error: 'Missing or unsupported "mimeType"' });
    if (body.imageBase64.length > 7_000_000)
      throw codedError(413, { error: 'Image is too large to analyze' });
    const trial = takeTrial(auth.did, 'altText');
    await aiPause();
    const out = { altText: altTextFor(body) };
    if (trial) out.usage = trial.commit();
    return [200, out];
  };

  /* ---- sessions ---- */

  function sessionRoute(headers, query) {
    const m = /^Bearer\s+(\S+)$/i.exec(headers.authorization || '');
    const found = m ? tokens.get(m[1]) : null;
    if (!found)
      return [
        401,
        {
          success: false,
          error: 'Invalid or expired session',
          authenticated: false,
          code: 'FRONTEND_SESSION_INVALID',
        },
      ];
    const granted = grants.has(`${found.client}:${found.did}`);
    const world = worldOf(found.did);
    const body = {
      success: true,
      authenticated: true,
      client: found.client,
      oauthSessionMissing: !granted,
      ...(granted && world?.scope ? { scope: world.scope } : {}),
      user: { did: found.did },
    };
    if (query.get('lite') === '1' || query.get('lite') === 'true')
      body.lite = true;
    else if (granted && world?.pdsUrl) body.pds = world.pdsUrl;
    return [200, body];
  }

  /* ---- the workers ---- */

  function bytesFromBase64(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function blobFor(world, row, mediaId) {
    const m = row.payload.media?.[mediaId];
    const stored = m && media.get(m.storagePath);
    if (!stored)
      throw Object.assign(
        new Error(
          'the images for this scheduled post are missing. edit it and re-attach them.',
        ),
        { code: 'MEDIA_MISSING', terminal: true },
      );
    return storeBlob(world, bytesFromBase64(stored.base64), stored.encoding);
  }

  async function buildEmbed(world, row, spec) {
    if (!spec) return undefined;
    switch (spec.type) {
      case 'images': {
        const images = [];
        for (const img of spec.images) {
          images.push({
            alt: img.alt || '',
            image: await blobFor(world, row, img.mediaId),
            ...(img.aspectRatio ? { aspectRatio: img.aspectRatio } : {}),
          });
        }
        return images.length > 4
          ? {
              $type: 'app.bsky.embed.gallery',
              items: images.map((i) => ({
                $type: 'app.bsky.embed.gallery#image',
                ...i,
              })),
            }
          : { $type: 'app.bsky.embed.images', images };
      }
      case 'external': {
        const external = {
          uri: spec.uri,
          title: spec.title || '',
          description: spec.description || '',
        };
        if (spec.thumbMediaId)
          external.thumb = await blobFor(world, row, spec.thumbMediaId);
        if (Array.isArray(spec.associatedRefs) && spec.associatedRefs.length)
          external.associatedRefs = spec.associatedRefs;
        return { $type: 'app.bsky.embed.external', external };
      }
      case 'record':
        return {
          $type: 'app.bsky.embed.record',
          record: { uri: spec.uri, cid: spec.cid },
        };
      case 'recordWithMedia':
        return {
          $type: 'app.bsky.embed.recordWithMedia',
          record: {
            $type: 'app.bsky.embed.record',
            record: { uri: spec.uri, cid: spec.cid },
          },
          media: await buildEmbed(world, row, spec.media),
        };
      default:
        return undefined;
    }
  }

  async function publishRow(row) {
    const world = worldOf(row.user_did);
    if (!world || !grants.has(`${row.client_key}:${row.user_did}`)) {
      throw Object.assign(new Error(SESSION_UNAVAILABLE), {
        code: 'SESSION_UNAVAILABLE',
      });
    }
    const posts = row.payload.posts;
    const base = Date.parse(row.scheduled_for);
    for (let i = row.progress.length; i < posts.length; i++) {
      const spec = posts[i];
      const record = {
        $type: 'app.bsky.feed.post',
        text: spec.record.text || '',
        createdAt: iso(base + i),
      };
      for (const k of ['facets', 'langs', 'labels', 'tags'])
        if (spec.record[k]) record[k] = spec.record[k];
      const embed = await buildEmbed(world, row, spec.embed);
      if (embed) record.embed = embed;
      if (i > 0)
        record.reply = { root: row.progress[0], parent: row.progress[i - 1] };
      const rkey = row.payload.rkeys?.[i] || tidAt(base + i);
      const written = await writeRecord(world, {
        collection: 'app.bsky.feed.post',
        rkey,
        record,
      });
      if (i === 0) {
        const { threadgate, postgate } = row.payload.gates || {};
        if (Array.isArray(threadgate)) {
          await writeRecord(world, {
            collection: 'app.bsky.feed.threadgate',
            rkey,
            record: {
              $type: 'app.bsky.feed.threadgate',
              post: written.uri,
              createdAt: record.createdAt,
              allow: threadgate,
              hiddenReplies: [],
            },
          });
        }
        if (Array.isArray(postgate) && postgate.length) {
          await writeRecord(world, {
            collection: 'app.bsky.feed.postgate',
            rkey,
            record: {
              $type: 'app.bsky.feed.postgate',
              post: written.uri,
              createdAt: record.createdAt,
              detachedEmbeddingUris: [],
              embeddingRules: postgate,
            },
          });
        }
      }
      row.progress.push({ uri: written.uri, cid: written.cid });
    }
    return row.progress;
  }

  async function runSchedule() {
    const t = now();
    const due = scheduled.filter(
      (r) =>
        r.status === 'pending' &&
        Date.parse(r.scheduled_for) <= t &&
        (!r.next_attempt_at || Date.parse(r.next_attempt_at) <= t),
    );
    const published = [];
    for (const row of due) {
      row.status = 'publishing';
      row.attempts += 1;
      try {
        const progress = await publishRow(row);
        Object.assign(row, {
          status: 'published',
          result_uri: progress[0].uri,
          result_cid: progress[0].cid,
          last_error: null,
          last_error_code: null,
          updated_at: iso(now()),
        });
        dropMedia(row);
        published.push(row);
        note(`published ${row.id} as ${row.result_uri}`);
        const sd = row.payload.selfDestruct;
        if (sd) {
          const v = validateArm(
            row.user_did,
            {
              postUri: progress[0].uri,
              postCid: progress[0].cid,
              extraUris: progress.slice(1).map((p) => p.uri),
              snippet: row.payload.posts[0]?.record?.text,
              postedAt: iso(now()),
              ...sd,
            },
            { missedDeadline: 'window' },
          );
          if (v.error) {
            row.last_error = `this post published, but its self-destruct timer could not be set: ${v.error}. set a timer by hand from the posted page.`;
            row.last_error_code = 'TIMER_NOT_ARMED';
          } else armTimer(row.user_did, row.client_key, v.value);
        }
      } catch (err) {
        const exhausted = err.terminal || row.attempts >= row.max_attempts;
        Object.assign(row, {
          status: exhausted ? 'failed' : 'pending',
          next_attempt_at: exhausted
            ? null
            : iso(now() + Math.min(2 ** row.attempts, 60) * MINUTE),
          last_error: String(err.message).slice(0, 500),
          last_error_code: err.code || 'UNKNOWN',
          updated_at: iso(now()),
        });
        note(`couldn't publish ${row.id}: ${err.message}`);
      }
    }
    return published;
  }

  function selfReplyChain(world, uri) {
    const out = [];
    const walk = (parent) => {
      for (const p of world.posts) {
        const rec = p.record || {};
        if (rec.reply?.parent?.uri === parent) {
          const child = `at://${world.me.did}/app.bsky.feed.post/${p.rkey}`;
          out.push(child);
          walk(child);
        }
      }
    };
    walk(uri);
    return out;
  }

  async function settleTimer(row) {
    const world = worldOf(row.user_did);
    const t = now();
    const resolve = (status, resolution, acted = null) =>
      Object.assign(row, {
        status,
        resolution,
        acted,
        resolved_at: iso(t),
        attempts: row.attempts + 1,
      });
    const post = world && readRecord(world, row.collection, row.rkey);
    if (!post) {
      resolve('deleted', 'the post was already gone');
      return;
    }
    if (!grants.has(`${row.client_key}:${row.user_did}`)) {
      Object.assign(row, {
        attempts: row.attempts + 1,
        check_at: iso(t + 2 * MINUTE),
        last_error:
          "couldn't reach your account session, so this post was left up. reconnect your account if this keeps happening.",
        last_error_code: 'SESSION_UNAVAILABLE',
      });
      if (row.attempts >= row.max_attempts)
        resolve('failed', 'the post is still up');
      return;
    }
    const view = views.postView(row.post_uri, { now: now() });
    const counts = {
      likes: view?.likeCount || 0,
      replies: view?.replyCount || 0,
      reposts: view?.repostCount || 0,
      quotes: view?.quoteCount || 0,
      selfReplies: selfReplyChain(world, row.post_uri).length,
    };
    row.last_counts = counts;
    let why = 'on time';
    if (row.conditions?.clauses?.length) {
      const verdict = evaluateConditions(row.conditions, counts);
      if (verdict.spare) {
        if (
          row.conditions.onSpare === 'extend' &&
          row.extensions < row.conditions.maxExtensions
        ) {
          Object.assign(row, {
            check_at: iso(t + row.lifespan_seconds * 1000),
            extensions: row.extensions + 1,
            attempts: 0,
          });
          note(
            `timer ${row.id} spared for now (${verdict.reason}), runs again`,
          );
          return;
        }
        resolve('spared', `kept: ${verdict.reason}`);
        return;
      }
      why = describeCounts(counts);
    }
    const acted = [];
    for (const effect of row.effects?.length
      ? row.effects
      : [{ action: 'delete' }]) {
      if (effect.action === 'limitReplies') {
        const allow = (effect.allow || ['follower']).map((a) =>
          typeof a === 'string'
            ? { $type: `app.bsky.feed.threadgate#${ALLOW_WORDS[a]}` }
            : { $type: 'app.bsky.feed.threadgate#listRule', list: a.list },
        );
        const existing = readRecord(
          world,
          'app.bsky.feed.threadgate',
          row.rkey,
        );
        await writeRecord(world, {
          collection: 'app.bsky.feed.threadgate',
          rkey: row.rkey,
          record: {
            $type: 'app.bsky.feed.threadgate',
            post: row.post_uri,
            createdAt: iso(t),
            allow,
            hiddenReplies: existing?.value?.hiddenReplies || [],
          },
        });
        acted.push({
          action: 'limitReplies',
          ok: true,
          detail: allow.length ? 'replies limited' : 'replies turned off',
        });
      } else if (effect.action === 'disableQuotes') {
        const existing = readRecord(world, 'app.bsky.feed.postgate', row.rkey);
        await writeRecord(world, {
          collection: 'app.bsky.feed.postgate',
          rkey: row.rkey,
          record: {
            $type: 'app.bsky.feed.postgate',
            post: row.post_uri,
            createdAt: iso(t),
            detachedEmbeddingUris: existing?.value?.detachedEmbeddingUris || [],
            embeddingRules: [{ $type: 'app.bsky.feed.postgate#disableRule' }],
          },
        });
        acted.push({
          action: 'disableQuotes',
          ok: true,
          detail: 'quotes turned off',
        });
      } else {
        const chain = [
          ...new Set([
            ...row.extra_uris.map((e) => e.uri),
            ...selfReplyChain(world, row.post_uri),
          ]),
        ].reverse();
        for (const uri of [...chain, row.post_uri]) {
          const p = parseAtUri(uri);
          removeRecord(world, p.collection, p.rkey);
          removeRecord(world, 'app.bsky.feed.threadgate', p.rkey);
          removeRecord(world, 'app.bsky.feed.postgate', p.rkey);
        }
        acted.push({
          action: 'delete',
          ok: true,
          detail: chain.length
            ? `deleted with ${chain.length} more`
            : 'deleted',
        });
      }
    }
    const deleted = acted.some((a) => a.action === 'delete');
    resolve(
      deleted ? 'deleted' : 'acted',
      deleted
        ? `deleted, ${why}`
        : `${acted.map((a) => a.detail).join(', ')}, ${why}`,
      acted,
    );
    note(`timer ${row.id} ${row.resolution}`);
  }

  async function runTimers() {
    const due = timers.filter(
      (tm) => tm.status === 'armed' && Date.parse(tm.check_at) <= now(),
    );
    for (const row of due) {
      row.status = 'checking';
      try {
        await settleTimer(row);
        if (row.status === 'checking') row.status = 'armed';
      } catch (err) {
        Object.assign(row, {
          status: 'failed',
          resolution: 'the post is still up',
          resolved_at: iso(now()),
          last_error: err.message,
          last_error_code: 'UNKNOWN',
        });
      }
    }
    return due;
  }

  /** One run of both workers. Resolves to `{ published, settled }` rows. */
  async function runCron() {
    const published = await runSchedule();
    const settled = await runTimers();
    return { published, settled };
  }

  /* ---- routing ---- */

  async function handle({ method, path, query, headers, body }) {
    try {
      if (method === 'OPTIONS') return [200, {}];
      if (path === '/oauth/session') return sessionRoute(headers, query);
      if (path === '/oauth/logout' && method === 'POST') {
        const m = /^Bearer\s+(\S+)$/i.exec(headers.authorization || '');
        const out = m ? signOutToken(m[1]) : { found: false };
        if (!out.found)
          return [
            401,
            {
              success: false,
              error: 'Invalid or expired session',
              code: 'FRONTEND_SESSION_INVALID',
            },
          ];
        return [200, { success: true, grantRevoked: out.grantRevoked }];
      }
      const fn = api[`${method} ${path}`];
      if (!fn) {
        const known = Object.keys(api).some((k) => k.endsWith(` ${path}`));
        return known
          ? [405, { success: false, error: 'Method not allowed' }]
          : [404, { success: false, error: 'Not found' }];
      }
      const auth = authOf(headers);
      return await fn(auth, { query, body });
    } catch (err) {
      if (err.httpStatus) return [err.httpStatus, err.body];
      console.error('[harness] fake cocoon failed:', err);
      return [
        500,
        {
          success: false,
          error: 'something went wrong. please try again.',
          code: 'INTERNAL',
        },
      ];
    }
  }

  /* ---- seeds ---- */

  function seedRows() {
    const mira = list.find((w) => w.me.handle === 'mira.example.com');
    if (!mira) return;
    const did = mira.me.did;
    const t = now();
    const at = (days, hour) => {
      const d = new Date(t + days * DAY);
      d.setHours(hour, 0, 0, 0);
      return iso(d.getTime());
    };
    const text = (s) => ({ record: { text: s, langs: ['en'] } });
    const value = (scheduledFor, posts, extra = {}) => ({
      scheduledFor,
      target: 'bluesky',
      posts,
      gates: { threadgate: null, postgate: null },
      queued: false,
      selfDestruct: null,
      tz: 'Europe/London',
      ...extra,
    });
    grants.add(`anisota:${did}`);
    // Scheduled from Anisota: listed here, cancellable, not editable.
    insertScheduled({
      did,
      client: 'anisota',
      id: seededUuid('anisota-seed-swap'),
      value: value(at(1, 10), [
        text(
          'Seed swap at the library on Saturday morning. Bring envelopes and labels.',
        ),
      ]),
    });
    insertScheduled({
      did,
      client: 'virga',
      id: seededUuid('virga-queued'),
      value: value(
        at(2, 9),
        [
          text(
            'Repair café this Sunday, 11 till 3. Lamps, zips, bikes, anything with one thing wrong with it.',
          ),
        ],
        { queued: true },
      ),
    });
    insertScheduled({
      did,
      client: 'virga',
      id: seededUuid('virga-failed'),
      value: value(at(-3, 18), [
        text('A thread on what the tool library lent out this year.'),
        text(
          'Most borrowed: the long ladder. Least returned: the good secateurs.',
        ),
      ]),
      status: 'failed',
      extra: {
        attempts: 5,
        last_error: SESSION_UNAVAILABLE,
        last_error_code: 'SESSION_UNAVAILABLE',
        created_at: at(-5, 12),
      },
    });
    const recent = mira.posts.filter((p) => !p.replyTo).slice(0, 3);
    if (recent[0]) {
      insertScheduled({
        did,
        client: 'virga',
        id: seededUuid('virga-timer-note'),
        value: value(at(-1, 8), [text(recent[0].text || 'Morning.')]),
        status: 'published',
        extra: {
          result_uri: `at://${did}/app.bsky.feed.post/${recent[0].rkey}`,
          result_cid: 'bafyharness',
          last_error:
            'this post published, but its self-destruct timer could not be set: a free account keeps one timer of this kind at a time. set a timer by hand from the posted page.',
          last_error_code: 'TIMER_NOT_ARMED',
        },
      });
    }
    if (recent[1]) {
      const conditions = parseConditions({
        clauses: [{ metric: 'likes', op: 'gte', value: 20 }],
        sense: 'unless',
      }).value;
      armTimer(
        did,
        'anisota',
        {
          uri: `at://${did}/app.bsky.feed.post/${recent[1].rkey}`,
          collection: 'app.bsky.feed.post',
          rkey: recent[1].rkey,
          cid: 'bafyharness',
          extra: [],
          snippet: recent[1].text.slice(0, 200),
          postedAt: recent[1].at,
          checkAt: iso(t + 2 * DAY),
          seconds: 3 * 86400,
          conditions,
          effects: [{ action: 'delete' }],
          resolution: null,
        },
        { id: seededUuid('anisota-timer') },
      );
    }
    timers.push({
      id: seededUuid('virga-timer-done'),
      user_did: did,
      client_key: 'virga',
      post_uri: `at://${did}/app.bsky.feed.post/${tidAt(t - 4 * DAY, 77)}`,
      post_cid: null,
      collection: 'app.bsky.feed.post',
      rkey: tidAt(t - 4 * DAY, 77),
      extra_uris: [],
      snippet: 'Lost a glove on the towpath. Black, left hand, very loved.',
      posted_at: iso(t - 4 * DAY),
      check_at: iso(t - 3 * DAY),
      status: 'deleted',
      conditions: parseConditions({}).value,
      effects: [{ action: 'delete' }],
      acted: [{ action: 'delete', ok: true, detail: 'deleted' }],
      lifespan_seconds: 86400,
      extensions: 0,
      last_counts: {
        likes: 3,
        replies: 1,
        reposts: 0,
        quotes: 0,
        selfReplies: 0,
      },
      resolution: 'deleted, on time',
      resolved_at: iso(t - 3 * DAY),
      attempts: 1,
      max_attempts: 5,
      last_error: null,
      last_error_code: null,
      created_at: iso(t - 4 * DAY),
    });
  }

  if (seed) seedRows();

  return {
    mintToken,
    signOutToken,
    expireAccount,
    handle,
    runCron,
    runSchedule,
    runTimers,
    /** What's held, for tests and the console: `{ scheduled, timers, tokens, log }`. */
    inspect: () => ({ scheduled, timers, tokens: [...tokens.entries()], log }),
  };
}

/* ---- the adviser's stand-in judgement --------------------------------- */

const NEGATIVE =
  /\b(hate|awful|terrible|worst|stupid|idiot|disgusting|doomed|pathetic|useless)\b/i;
const CONFRONTATIONAL =
  /\b(actually|ratio|you people|imagine thinking|cope)\b|\?!/i;
const WARM = /\b(thank|thanks|love|glad|great|lovely|welcome|happy)\b/i;

/**
 * What /api/ai/analyze-post answers, decided by a few word lists so the
 * harness gives the same read every time: the writer's presets, their topics
 * to ease off, their own goals (always fine here), and the writing checks
 * (a doubled word is a typo, a lone lowercase "i" is grammar, a sentence over
 * forty words is unclear). Null when there's nothing to check against, which
 * cocoon answers with an "ok" and doesn't count.
 */
export function analyzePost({ text, goals = {}, writingChecks }) {
  const presets = goals?.presets || {};
  const checks = [];
  const excerptOf = (re) => {
    const m = re.exec(text);
    if (!m) return null;
    const start = text.lastIndexOf(' ', Math.max(0, m.index - 12)) + 1;
    const end = text.indexOf(' ', m.index + m[0].length + 12);
    const out = text.slice(start, end === -1 ? text.length : end);
    return out.trim() === text.trim() ? null : out;
  };
  if (presets.reduceNegativity) {
    const hit = NEGATIVE.test(text);
    checks.push({
      id: 'reduceNegativity',
      label: 'Reduce negativity',
      status: hit ? 'caution' : 'ok',
      note: hit
        ? 'This reads as harsher than you asked to be.'
        : 'Nothing harsh here.',
      excerpt: hit ? excerptOf(NEGATIVE) : null,
    });
  }
  if (presets.lessConfrontational) {
    const hit = CONFRONTATIONAL.test(text);
    checks.push({
      id: 'lessConfrontational',
      label: 'Less confrontational',
      status: hit ? 'caution' : 'ok',
      note: hit ? 'This could land as a dig at someone.' : 'No digs here.',
      excerpt: hit ? excerptOf(CONFRONTATIONAL) : null,
    });
  }
  const topics = presets.limitTopic?.enabled
    ? String(presets.limitTopic.topic || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  if (topics.length) {
    const found = topics.find((topic) =>
      text.toLowerCase().includes(topic.toLowerCase()),
    );
    checks.push({
      id: 'limitTopic',
      label: 'Limit topics',
      status: found ? 'conflict' : 'ok',
      note: found
        ? `This is about ${found}, which you wanted to post less about.`
        : 'None of your topics come up.',
      excerpt: null,
    });
  }
  if (typeof goals?.customText === 'string' && goals.customText.trim()) {
    checks.push({
      id: 'custom',
      label: 'Your goals',
      status: 'ok',
      note: 'Nothing here goes against what you wrote.',
      excerpt: null,
    });
  }
  const categories =
    writingChecks && typeof writingChecks === 'object' ? writingChecks : null;
  const wantsWriting =
    categories &&
    (categories.typos || categories.grammar || categories.clarity);
  if (!checks.length && !wantsWriting) return null;

  const out = {
    sentiment: NEGATIVE.test(text)
      ? { label: 'negative', score: -0.6 }
      : WARM.test(text)
        ? { label: 'positive', score: 0.6 }
        : { label: 'neutral', score: 0 },
    checks,
    suggestion: checks.some((c) => c.status !== 'ok')
      ? 'Try saying what you want to happen instead of what went wrong.'
      : null,
    overallStatus: checks.some((c) => c.status === 'conflict')
      ? 'conflict'
      : checks.some((c) => c.status === 'caution')
        ? 'caution'
        : 'ok',
  };
  if (wantsWriting) {
    const issues = [];
    const doubled = /\b(\w+)\s+\1\b/i.exec(text);
    if (categories.typos && doubled)
      issues.push({
        type: 'typo',
        found: doubled[0],
        replacement: doubled[1],
        note: 'The same word twice.',
      });
    const lone = /(^|\s)i(\s|')/.exec(text);
    if (categories.grammar && lone)
      issues.push({
        type: 'grammar',
        found: lone[0],
        replacement: lone[0].replace('i', 'I'),
        note: '“I” is always a capital.',
      });
    const long = text
      .split(/(?<=[.!?])\s+/)
      .find((s) => s.split(/\s+/).length > 40);
    if (categories.clarity && long)
      issues.push({
        type: 'clarity',
        found: long,
        replacement: null,
        note: 'A long sentence; it may read more easily as two.',
      });
    out.writing = { issues };
  }
  return out;
}

function styleSummary(posts, guidance) {
  const all = posts.join(' ');
  const letters = all.replace(/[^A-Za-z]/g, '');
  const lower = letters && letters === letters.toLowerCase();
  const avg = Math.round(
    posts.reduce((n, p) => n + p.length, 0) / posts.length,
  );
  const lines = [
    lower
      ? 'Writes in all lowercase on purpose.'
      : 'Uses ordinary capitalisation.',
    avg < 80
      ? 'Short posts, often a single line.'
      : 'Posts run to a few sentences.',
    /!/.test(all)
      ? 'Uses exclamation marks now and then.'
      : 'Rarely uses exclamation marks.',
    /[—–]/.test(all)
      ? 'Likes a dash for an aside.'
      : 'Keeps punctuation simple.',
  ];
  if (typeof guidance === 'string' && guidance.trim())
    lines.push(`In their words: ${guidance.trim().slice(0, 300)}`);
  return lines.join(' ');
}

function altTextFor({ imageBase64, kind, followUp, previousAltText, context }) {
  if (followUp && previousAltText)
    return `${previousAltText.replace(/\.$/, '')}, ${followUp.trim().replace(/\.$/, '').toLowerCase()}.`;
  if (kind === 'chart')
    return 'A bar chart with five bars rising from left to right; the last bar is about twice the first.';
  if (kind === 'interface')
    return 'A screenshot of an app screen with a list of settings and a button at the bottom.';
  if (kind === 'text')
    return 'A note in neat handwriting that reads: back in ten minutes.';
  const options = [
    'A wooden bench under a street tree, in late afternoon sun.',
    'Rows of seed jars on a kitchen shelf, each with a handwritten label.',
    'A heron standing in shallow water by a canal towpath.',
    'A table at a repair café with a lamp, a toaster and a box of tools.',
  ];
  const line =
    options[hashOf(String(imageBase64).slice(0, 2000)) % options.length];
  return context
    ? `${line.replace(/\.$/, '')}, for a post about ${String(context).slice(0, 60)}.`
    : line;
}

/**
 * The router for the fake cocoon, given its origin: `route(url, init)`
 * answers a Response for requests to that host, or null for any other.
 */
export function createCocoonRouter(cocoon, origin) {
  return async function route(url, init = {}) {
    if (url.origin !== origin) return null;
    const headers = {};
    new Headers(init.headers || {}).forEach((v, k) => (headers[k] = v));
    let body;
    if (typeof init.body === 'string' && init.body) {
      try {
        body = JSON.parse(init.body);
      } catch {
        return jsonResponse(400, {
          success: false,
          error: 'Invalid JSON body',
        });
      }
    }
    const [status, payload] = await cocoon.handle({
      method: (init.method || 'GET').toUpperCase(),
      path: url.pathname.replace(/\/+$/, ''),
      query: url.searchParams,
      headers,
      body,
    });
    return jsonResponse(status, payload);
  };
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
