// What one adviser read is about: which account is writing, what kind of
// draft it is, whether the pre-publish check covers it, and the conversation
// it answers, read from the public AppView.
//
// Everything is keyed to the posting account (`state.asDid`), not to the
// account Virga is showing: "a reply to someone else" means someone other
// than the account the post goes out as, and that account's setup, requester
// and allowance are the ones used.

import { publicXrpc } from '../library/sources.js';
import { parseRecordUri } from '../lib/postLink.js';
import {
  adviserScenarioFor,
  adviserScopeAllowsDraft,
  enabledWritingChecks,
} from './analysis.js';
import { ADVISER_CONTEXT_TIMEOUT_MS, withinMs } from './gate.js';
import { normalizeAdviserSettings } from './setup.js';

/**
 * A fast answer is held until this long after the read started, so the busy
 * state doesn't flash.
 */
export const READ_MIN_MS = 1200;

/** Past this the busy state says the read is slower than usual. */
export const SLOW_READ_AFTER_MS = 8000;

/** How many posts above the one replied to are read for context. */
export const CONTEXT_PARENT_HEIGHT = 6;

/**
 * The goals and checks a read covers, for the busy state's list. Empty when
 * nothing is set up (the pre-publish check then doesn't run).
 *
 * @returns {Array<{ key: string, label: string, detail: string|null }>}
 */
export function adviserGoalItems(adviser) {
  const a = adviser || {};
  const goals = a.goals || {};
  const presets = goals.presets || {};
  const items = [];
  if (presets.reduceNegativity) {
    items.push({
      key: 'reduceNegativity',
      label: 'Reduce negativity',
      detail: null,
    });
  }
  if (presets.lessConfrontational) {
    items.push({
      key: 'lessConfrontational',
      label: 'Less confrontational',
      detail: null,
    });
  }
  const limitTopic = presets.limitTopic || {};
  if (
    limitTopic.enabled &&
    typeof limitTopic.topic === 'string' &&
    limitTopic.topic.trim()
  ) {
    items.push({
      key: 'limitTopic',
      label: 'Limit topics',
      detail: limitTopic.topic.trim(),
    });
  }
  if (typeof goals.customText === 'string' && goals.customText.trim()) {
    items.push({ key: 'customText', label: 'Your own goals', detail: null });
  }
  const writing = a.writingChecks || {};
  const checks = ['typos', 'grammar', 'clarity'].filter(
    (key) => writing[key] === true,
  );
  if (checks.length) {
    items.push({
      key: 'writing',
      label: 'Writing check',
      detail: checks.join(', '),
    });
  }
  return items;
}

/** How many goals the setup has (writing checks aside). */
export function adviserGoalCount(adviser) {
  return adviserGoalItems(adviser).filter((item) => item.key !== 'writing')
    .length;
}

/** The busy state's line under the goals. */
export function readExpectation(elapsedMs) {
  return Number(elapsedMs) >= SLOW_READ_AFTER_MS
    ? 'Taking a little longer than usual'
    : 'Usually a few seconds';
}

const didOf = (uri) => parseRecordUri(uri)?.did || null;

/** The post the first post quotes, when it quotes a post. */
function quotedPost(state) {
  const record = state?.posts?.[0]?.record;
  return record?.uri && (record.kind || 'post') === 'post' ? record : null;
}

/**
 * The draft as the adviser frames it, for the posting account `asDid`
 * (default `state.asDid`).
 *
 * @returns {{ repliesToOther: boolean, quotesOther: boolean, repliesToSelf: boolean, isThread: boolean }}
 */
export function adviserDraftFacts(state, { asDid = state?.asDid } = {}) {
  const reply = state?.reply;
  const replyAuthor = reply ? reply.author?.did || didOf(reply.uri) : null;
  const quote = quotedPost(state);
  const quoteAuthor = quote
    ? quote.view?.author?.did || didOf(quote.uri)
    : null;
  return {
    repliesToOther: !!replyAuthor && replyAuthor !== asDid,
    quotesOther: !!quoteAuthor && quoteAuthor !== asDid,
    repliesToSelf: !!replyAuthor && replyAuthor === asDid,
    isThread: (state?.posts?.length || 0) > 1,
  };
}

/** The draft as read: one string per post, and the whole as one text. */
export function adviserSource(state) {
  const posts = (state?.posts || []).map((post) =>
    typeof post?.text === 'string' ? post.text : '',
  );
  return { posts, text: posts.join('\n\n').trim() };
}

/**
 * Everything one read needs to decide and to send.
 *
 *   available   the adviser can be asked at all: it's on, and the account is
 *               signed in through Virga's server (an account signed in only
 *               in the browser has no requester to send with)
 *   gate        the pre-publish check should run for this draft: available,
 *               "check before publishing" on, the scope covers it, there is
 *               something to check, there is text, and this month's checks
 *               aren't known to be used up
 *   context     which conversation to read ('reply' | 'quote' | 'selfReply'),
 *               or null
 *
 * @param {object} adviser - the account's adviser setup (normalized here)
 * @param {object} state - the ComposerState
 * @param {{ canUseAi: boolean, atLimit?: boolean, asDid?: string }} options
 */
export function adviserReadPlan(
  adviser,
  state,
  { canUseAi = false, atLimit = false, asDid = state?.asDid } = {},
) {
  const setup = normalizeAdviserSettings(adviser);
  const facts = adviserDraftFacts(state, { asDid });
  const writingChecks = enabledWritingChecks(setup.writingChecks);
  const goalItems = adviserGoalItems(setup);
  const goalCount = goalItems.filter((item) => item.key !== 'writing').length;
  const readTheRoom = setup.checkReplyContext;
  const otherContext =
    readTheRoom && (facts.repliesToOther || facts.quotesOther);
  const context = !readTheRoom
    ? null
    : facts.repliesToOther
      ? 'reply'
      : facts.quotesOther
        ? 'quote'
        : facts.repliesToSelf
          ? 'selfReply'
          : null;
  const hasSomething = goalCount > 0 || !!otherContext || !!writingChecks;
  const source = adviserSource(state);
  const available = setup.enabled && !!canUseAi;
  return {
    available,
    gate:
      available &&
      setup.checkBeforePublish &&
      adviserScopeAllowsDraft(setup.checkScope, facts) &&
      hasSomething &&
      !!source.text &&
      !atLimit,
    reviewMode: setup.reviewMode,
    hasSomething,
    scenario: adviserScenarioFor(facts),
    goals: setup.goals,
    goalItems,
    writingChecks,
    context,
    // The busy state's rows: each goal, reading the room, the proofread.
    expectedChecks:
      goalCount + (otherContext ? 1 : 0) + (writingChecks ? 1 : 0),
    source,
    facts,
  };
}

function lineFrom(post) {
  const text =
    typeof post?.record?.text === 'string'
      ? post.record.text
      : typeof post?.value?.text === 'string'
        ? post.value.text
        : typeof post?.text === 'string'
          ? post.text
          : '';
  const trimmed = text.trim();
  if (!trimmed) return null;
  const a = post?.author || {};
  const author =
    (typeof a.displayName === 'string' && a.displayName.trim()) ||
    (a.handle ? `@${a.handle}` : 'someone');
  return { author, text: trimmed };
}

/**
 * The conversation a draft answers, for "read the room": the post replied to
 * or quoted and up to six posts above it, oldest first, from the public
 * AppView. Bounded by ADVISER_CONTEXT_TIMEOUT_MS; on a failure or a timeout
 * the post alone stands in for the thread. Null when the plan reads none.
 *
 * @param {object} state - the ComposerState
 * @param {'reply'|'quote'|'selfReply'|null} kind - adviserReadPlan's `context`
 * @param {{ fetch?: typeof fetch, signal?: AbortSignal, timeoutMs?: number }} [options]
 * @returns {Promise<{ kind: string, thread: Array<{author, text}>, target: {author, text}|null } | null>}
 */
export async function gatherReplyContext(
  state,
  kind,
  { fetch, signal, timeoutMs = ADVISER_CONTEXT_TIMEOUT_MS } = {},
) {
  if (!kind) return null;
  let uri = null;
  let target = null;
  if (kind === 'quote') {
    const quote = quotedPost(state);
    uri = quote?.uri || null;
    target = quote?.view ? lineFrom(quote.view) : null;
  } else {
    const reply = state?.reply;
    uri = reply?.uri || null;
    target = reply
      ? lineFrom({ author: reply.author, text: reply.text })
      : null;
  }
  if (!uri) return null;

  let thread = [];
  try {
    const body = await withinMs(
      publicXrpc(
        'app.bsky.feed.getPostThread',
        { uri, depth: 0, parentHeight: CONTEXT_PARENT_HEIGHT },
        { ...(fetch ? { fetch } : {}), signal },
      ),
      timeoutMs,
    );
    const collected = [];
    let node = body?.thread;
    while (node && node.post) {
      const line = lineFrom(node.post);
      if (line) collected.push(line);
      node = node.parent;
    }
    thread = collected.reverse();
    // The thread read also has the target's own text when the composer
    // didn't (a reply opened from a bare link).
    if (!target && collected.length) target = collected[collected.length - 1];
  } catch {
    // The post alone, below.
  }
  if (thread.length === 0 && target) thread = [target];
  return { kind, thread, target };
}

/**
 * The analyze-post body for a plan and the context gathered for it. The text
 * is trimmed: cocoon checks each excerpt it returns against exactly what it
 * was sent.
 */
export function analyzePayload(plan, context = null) {
  const body = {
    text: plan?.source?.text || '',
    goals: plan?.goals,
    scenario: plan?.scenario,
  };
  if (context) body.context = context;
  if (plan?.writingChecks) body.writingChecks = plan.writingChecks;
  return body;
}

/**
 * Whether the pre-publish check stops the publish to show what it found.
 * 'always' shows every read; 'significant' only a conflict with a goal or
 * any writing issue (a caution lets the post through).
 */
export function adviserShouldInterrupt(result, reviewMode = 'significant') {
  if (!result) return false;
  if (reviewMode === 'always') return true;
  const issues = Array.isArray(result?.writing?.issues)
    ? result.writing.issues
    : [];
  return result.overallStatus === 'conflict' || issues.length > 0;
}
