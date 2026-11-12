// Who can reply and who can quote. The composer holds them as
//   { reply: null | [] | ReplyRule[], quotes: boolean }
// where `reply: null` is everyone (no threadgate record), `[]` is nobody (a
// threadgate with an empty allow list: a real record, never skipped), and a
// list is "these people"; `quotes: false` is a postgate with the disable rule.
// ReplyRule = { type: 'mention' } | { type: 'follower' } | { type: 'following' }
//           | { type: 'list', list: <at-uri> }

const THREADGATE = 'app.bsky.feed.threadgate';
const POSTGATE = 'app.bsky.feed.postgate';
const DISABLE_RULE = `${POSTGATE}#disableRule`;

const RULE_TYPES = {
  mention: `${THREADGATE}#mentionRule`,
  follower: `${THREADGATE}#followerRule`,
  following: `${THREADGATE}#followingRule`,
  list: `${THREADGATE}#listRule`,
};
const TYPE_BY_LEXICON = Object.fromEntries(
  Object.entries(RULE_TYPES).map(([type, lex]) => [lex, type]),
);

/** A threadgate holds at most five allow rules. */
export const MAX_REPLY_RULES = 5;

/** Bluesky's default: anyone can reply and quote. */
export const EVERYONE_GATES = Object.freeze({ reply: null, quotes: true });

/** How long reading an account's default gates may take before giving up. */
export const DEFAULT_GATES_TIMEOUT_MS = 7000;

function replyRulesToLexicon(reply) {
  const out = [];
  const seen = new Set();
  for (const rule of reply) {
    const $type = RULE_TYPES[rule?.type];
    if (!$type) continue;
    if (rule.type === 'list') {
      if (typeof rule.list !== 'string' || !rule.list.startsWith('at://'))
        continue;
      const key = `list:${rule.list}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ $type, list: rule.list });
    } else {
      if (seen.has(rule.type)) continue;
      seen.add(rule.type);
      out.push({ $type });
    }
  }
  return out;
}

/**
 * Gates as lexicon rules: `threadgateAllow` is null (no threadgate), `[]`
 * (nobody) or the allow rules; `postgateEmbeddingRules` is null (no postgate)
 * or `[disableRule]`. Drafts store these as they are, and scheduling sends
 * them as cocoon's `gates.threadgate` / `gates.postgate`.
 * @param {{ reply?: null | Array, quotes?: boolean } | null} gates
 * @returns {{ threadgateAllow: null | object[], postgateEmbeddingRules: null | object[] }}
 */
export function gatesToRules(gates) {
  const reply = gates?.reply;
  return {
    threadgateAllow: Array.isArray(reply) ? replyRulesToLexicon(reply) : null,
    postgateEmbeddingRules:
      gates?.quotes === false ? [{ $type: DISABLE_RULE }] : null,
  };
}

/**
 * The inverse: lexicon rules back to gates. Takes the names a draft, a
 * threadgate/postgate pair or Bluesky's `postInteractionSettingsPref` uses
 * (`threadgateAllow`, `threadgateAllowRules` or `allow`;
 * `postgateEmbeddingRules` or `embeddingRules`). An absent allow list is
 * everyone. A list made only of rules this app doesn't know reads as nobody,
 * the narrower of the two, rather than opening a post the writer closed.
 * @returns {{ reply: null | Array, quotes: boolean }}
 */
export function gatesFromRules(rules) {
  const src = rules && typeof rules === 'object' ? rules : {};
  const allow = src.threadgateAllow ?? src.threadgateAllowRules ?? src.allow;
  const embedding = src.postgateEmbeddingRules ?? src.embeddingRules;

  let reply = null;
  if (Array.isArray(allow)) {
    reply = [];
    for (const rule of allow) {
      const type = TYPE_BY_LEXICON[rule?.$type];
      if (!type) continue;
      if (type === 'list') {
        if (typeof rule.list === 'string')
          reply.push({ type, list: rule.list });
      } else if (!reply.some((r) => r.type === type)) {
        reply.push({ type });
      }
    }
  }
  const quotes = !(
    Array.isArray(embedding) && embedding.some((r) => r?.$type === DISABLE_RULE)
  );
  return { reply, quotes };
}

/** Whether two gates say the same thing (rule order aside). */
export function gatesEqual(a, b) {
  const key = (g) => {
    const { threadgateAllow, postgateEmbeddingRules } = gatesToRules(g);
    return JSON.stringify([
      threadgateAllow === null
        ? null
        : threadgateAllow.map((r) => `${r.$type}|${r.list || ''}`).sort(),
      postgateEmbeddingRules === null,
    ]);
  };
  return key(a) === key(b);
}

/**
 * The gates an account set as its Bluesky default, from its preferences
 * (`app.bsky.actor.defs#postInteractionSettingsPref`); everyone when it set
 * none. `preferences` is the getPreferences array.
 * @returns {{ reply: null | Array, quotes: boolean }}
 */
export function defaultGatesFromPreferences(preferences) {
  const pref = Array.isArray(preferences)
    ? preferences.find(
        (p) => p?.$type === 'app.bsky.actor.defs#postInteractionSettingsPref',
      )
    : null;
  if (!pref) return { ...EVERYONE_GATES };
  // A key that is absent means Bluesky's default; present but empty means none.
  const has = (k) => Object.prototype.hasOwnProperty.call(pref, k);
  return gatesFromRules({
    threadgateAllowRules: has('threadgateAllowRules')
      ? pref.threadgateAllowRules || []
      : undefined,
    postgateEmbeddingRules: has('postgateEmbeddingRules')
      ? pref.postgateEmbeddingRules || []
      : undefined,
  });
}

/**
 * The write account's Bluesky default gates, read with its own agent, or
 * null when they couldn't be read in time (the caller says so and falls back
 * to everyone). Never throws.
 * @param {object} agent - the write account's agent
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<{ reply: null | Array, quotes: boolean } | null>}
 */
export async function readDefaultGates(
  agent,
  { timeoutMs = DEFAULT_GATES_TIMEOUT_MS } = {},
) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  const read = (async () => {
    try {
      const res = await agent.app.bsky.actor.getPreferences({});
      const preferences = res?.data?.preferences;
      return Array.isArray(preferences)
        ? defaultGatesFromPreferences(preferences)
        : null;
    } catch {
      return null;
    }
  })();
  try {
    return await Promise.race([read, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

function parsePostUri(uri) {
  const m = /^at:\/\/(did:[^/]+)\/app\.bsky\.feed\.post\/([^/?#]+)$/.exec(
    String(uri || ''),
  );
  if (!m) throw new Error(`Not a post URI: ${uri}`);
  return { did: m[1], rkey: m[2] };
}

const isNotFound = (err) =>
  err?.error === 'RecordNotFound' ||
  /RecordNotFound|Could not locate record/i.test(String(err?.message || ''));

async function readGate(agent, repo, collection, rkey) {
  try {
    const res = await agent.com.atproto.repo.getRecord({
      repo,
      collection,
      rkey,
    });
    return res?.data?.value || null;
  } catch (err) {
    if (isNotFound(err)) return null;
    // Never write a gate over one that couldn't be read: it would drop the
    // writer's hidden replies or detached quotes.
    throw err;
  }
}

async function deleteGate(agent, repo, collection, rkey) {
  try {
    await agent.com.atproto.repo.deleteRecord({ repo, collection, rkey });
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }
}

/**
 * Change who can reply to and quote a published post, keeping what the
 * gates already hold besides the rules: the threadgate's `hiddenReplies` and
 * the postgate's `detachedEmbeddingUris`. A gate that would say nothing but
 * Bluesky's default is deleted, unless it still holds one of those lists.
 *
 * @param {object} agent - the post author's agent
 * @param {{ uri: string, reply: null | Array, quotes: boolean, now?: Date }} change
 * @returns {Promise<{ reply: null | Array, quotes: boolean }>}
 */
export async function updatePostGates(
  agent,
  { uri, reply, quotes, now = new Date() },
) {
  const { did: repo, rkey } = parsePostUri(uri);
  const [threadgate, postgate] = await Promise.all([
    readGate(agent, repo, THREADGATE, rkey),
    readGate(agent, repo, POSTGATE, rkey),
  ]);
  const createdAt = (existing) =>
    existing?.createdAt || new Date(now).toISOString();
  const hiddenReplies = Array.isArray(threadgate?.hiddenReplies)
    ? threadgate.hiddenReplies
    : [];
  const detached = Array.isArray(postgate?.detachedEmbeddingUris)
    ? postgate.detachedEmbeddingUris
    : [];
  const { threadgateAllow, postgateEmbeddingRules } = gatesToRules({
    reply,
    quotes,
  });

  if (threadgateAllow === null) {
    if (hiddenReplies.length > 0) {
      // No `allow` is everyone, per the lexicon.
      await agent.com.atproto.repo.putRecord({
        repo,
        collection: THREADGATE,
        rkey,
        record: {
          $type: THREADGATE,
          post: uri,
          createdAt: createdAt(threadgate),
          hiddenReplies,
        },
      });
    } else if (threadgate) {
      await deleteGate(agent, repo, THREADGATE, rkey);
    }
  } else {
    await agent.com.atproto.repo.putRecord({
      repo,
      collection: THREADGATE,
      rkey,
      record: {
        $type: THREADGATE,
        post: uri,
        createdAt: createdAt(threadgate),
        allow: threadgateAllow,
        hiddenReplies,
      },
    });
  }

  if (postgateEmbeddingRules === null) {
    if (detached.length > 0) {
      await agent.com.atproto.repo.putRecord({
        repo,
        collection: POSTGATE,
        rkey,
        record: {
          $type: POSTGATE,
          post: uri,
          createdAt: createdAt(postgate),
          detachedEmbeddingUris: detached,
          embeddingRules: [],
        },
      });
    } else if (postgate) {
      await deleteGate(agent, repo, POSTGATE, rkey);
    }
  } else {
    await agent.com.atproto.repo.putRecord({
      repo,
      collection: POSTGATE,
      rkey,
      record: {
        $type: POSTGATE,
        post: uri,
        createdAt: createdAt(postgate),
        detachedEmbeddingUris: detached,
        embeddingRules: postgateEmbeddingRules,
      },
    });
  }

  return gatesFromRules({ threadgateAllow, postgateEmbeddingRules });
}
