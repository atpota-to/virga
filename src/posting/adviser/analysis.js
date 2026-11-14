/**
 * Pure decisions around one adviser read: which drafts the pre-publish check
 * covers, the draft scenario, which writing checks are on, and applying
 * suggested fixes. Shapes mirror the account's adviser setup (./setup.js) and
 * the server's /api/ai/analyze-post payload.
 */

export const ADVISER_CHECK_SCOPES = ['all', 'topLevel', 'replies'];

/** Unknown or legacy values become 'all'. */
export function normalizeAdviserScope(scope) {
  return ADVISER_CHECK_SCOPES.includes(scope) ? scope : 'all';
}

/**
 * Whether the automatic pre-publish check covers this draft. 'replies' means
 * replies to someone else; a reply to your own post counts as 'topLevel' (as do
 * fresh posts and quotes). The manual adviser button ignores scope.
 *
 * @param {string} scope the setup's checkScope
 * @param {{repliesToOther: boolean}} draft
 * @returns {boolean}
 */
export function adviserScopeAllowsDraft(scope, { repliesToOther }) {
  const normalized = normalizeAdviserScope(scope);
  if (normalized === 'all') return true;
  return normalized === 'replies' ? !!repliesToOther : !repliesToOther;
}

/**
 * Draft scenario for the backend's tailored prompt, in priority order: replying
 * to someone else (a thread that starts as a reply is still a reply), quoting,
 * a multi-post thread, continuing your own thread, a standalone post.
 *
 * @param {object} draft
 * @param {boolean} draft.repliesToOther replying to someone else's post
 * @param {boolean} draft.quotesOther    quoting someone else's post
 * @param {boolean} draft.repliesToSelf  replying to the writer's own post
 * @param {boolean} draft.isThread      composing a multi-post thread
 * @returns {'reply'|'quote'|'thread'|'selfReply'|'post'}
 */
export function adviserScenarioFor({
  repliesToOther,
  quotesOther,
  repliesToSelf,
  isThread,
}) {
  if (repliesToOther) return 'reply';
  if (quotesOther) return 'quote';
  if (isThread) return 'thread';
  if (repliesToSelf) return 'selfReply';
  return 'post';
}

/**
 * The enabled writing checks in the analyze-post shape, or null when none are
 * on. While any is on, `customText` (the writer's notes) and `style` (the
 * learned style profile, so their norms aren't flagged as slips) ride along.
 *
 * @param {object} writingChecks the setup's writingChecks (may be undefined)
 * @returns {{typos?: true, grammar?: true, clarity?: true, customText?: string, style?: string}|null}
 */
export function enabledWritingChecks(writingChecks) {
  if (!writingChecks || typeof writingChecks !== 'object') return null;
  const out = {};
  for (const key of ['typos', 'grammar', 'clarity']) {
    if (writingChecks[key] === true) out[key] = true;
  }
  if (Object.keys(out).length === 0) return null;
  const customText =
    typeof writingChecks.customText === 'string'
      ? writingChecks.customText.trim()
      : '';
  if (customText) out.customText = customText;
  const style =
    typeof writingChecks.styleProfile?.summary === 'string'
      ? writingChecks.styleProfile.summary.trim()
      : '';
  if (style) out.style = style;
  return out;
}

/** Issues the one-tap fix can act on: a real excerpt and a correction for it. */
export function fixableWritingIssues(issues) {
  if (!Array.isArray(issues)) return [];
  return issues.filter(
    (issue) =>
      issue &&
      typeof issue.found === 'string' &&
      issue.found.trim() &&
      typeof issue.replacement === 'string' &&
      issue.replacement.trim() &&
      issue.replacement !== issue.found,
  );
}

/**
 * Apply suggested fixes to one draft's text. Each replaces the first occurrence
 * of its `found` excerpt; an excerpt no longer present is skipped. Returns the
 * new text and how many fixes landed.
 *
 * @param {string} text
 * @param {Array<{found: string, replacement: string}>} issues
 * @returns {{text: string, applied: number}}
 */
export function applyWritingFixes(text, issues) {
  let next = typeof text === 'string' ? text : '';
  let applied = 0;
  for (const issue of fixableWritingIssues(issues)) {
    const at = next.indexOf(issue.found);
    if (at === -1) continue;
    next =
      next.slice(0, at) +
      issue.replacement +
      next.slice(at + issue.found.length);
    applied++;
  }
  return { text: next, applied };
}

/**
 * Apply fixes across a thread's posts. The adviser read the posts joined, so
 * each fix lands in the first post containing its excerpt; one spanning two
 * posts is skipped. Returns the same array reference when nothing applied, so
 * a state setter can no-op.
 *
 * @param {Array<{text: string}>} posts
 * @param {Array<{found: string, replacement: string}>} issues
 * @returns {{posts: Array<{text: string}>, applied: number}}
 */
export function applyWritingFixesToThread(posts, issues) {
  if (!Array.isArray(posts)) return { posts, applied: 0 };
  const texts = posts.map((post) =>
    typeof post?.text === 'string' ? post.text : '',
  );
  let applied = 0;
  for (const issue of fixableWritingIssues(issues)) {
    const index = texts.findIndex((t) => t.includes(issue.found));
    if (index === -1) continue;
    const result = applyWritingFixes(texts[index], [issue]);
    texts[index] = result.text;
    applied += result.applied;
  }
  if (applied === 0) return { posts, applied: 0 };
  return {
    posts: posts.map((post, i) =>
      texts[i] === post.text ? post : { ...post, text: texts[i] },
    ),
    applied,
  };
}
