/**
 * Posting adviser — prompt assembly and response normalization.
 *
 * Everything here is pure (no network, no env), kept apart from the handlers
 * (handlers/analyzePost.js, handlers/synthesizeStyle.js) so the parts that
 * decide what the model is asked and what the client is handed back can be
 * tested. The failure modes this guards are quiet ones: a scenario line that
 * never makes it into the prompt, a writing category the user didn't ask for
 * being flagged anyway, or a "fix" whose `found` text isn't actually in the
 * draft — which the composer would then silently fail to apply.
 */

import { THINKING_ALLOWANCE } from './models.js';

const MAX_CONTEXT_POSTS = 8;
const MAX_CONTEXT_TEXT = 600;
const MAX_WRITING_ISSUES = 6;
const MAX_WRITING_NOTE = 300;
// Goal checks: one per goal plus "understanding", so a small cap; the client
// draws each check's excerpt as a numbered mark in the draft.
const MAX_CHECKS = 12;
const MAX_CHECK_LABEL = 80;
const MAX_CHECK_NOTE = 300;
const MAX_CHECK_EXCERPT = 400;
const CHECK_STATUSES = new Set(['ok', 'caution', 'conflict']);

// Room for one read's answer. The proofread pass returns verbatim excerpts
// alongside the checks, so it gets more; a capped response fails JSON parsing
// outright. A thinking model thinks out of the same allowance before any JSON
// appears, so adviserMaxTokens adds THINKING_ALLOWANCE to either.
const ADVISER_TOKENS = 1600;
const ADVISER_PROOFREAD_TOKENS = 2400;

// The writer's posting goals: the topics to ease off of and their own goals in
// their own words. The same caps as the settings inputs (ADVISER_TEXT_LIMITS in
// src/posting/adviser/setup.js), held here too because the body comes from the
// client and the prompt is paid for on the deployment's key.
const MAX_LIMIT_TOPIC = 200;
const MAX_GOALS_CUSTOM = 500;
// The writer's own guidance for the proofread (matches the settings textarea)
// and their learned style profile (produced by buildStylePrompt, but accepted
// from the client, so it gets its own inbound cap).
const MAX_WRITING_CUSTOM = 500;
const MAX_STYLE_SUMMARY = 1500;
// Style synthesis input: enough recent posts to see patterns. The count cap
// allows deep sampling (the writer chooses roughly how many posts to read);
// the total-character budget is what actually bounds the call, so five hundred
// long posts can't turn one synthesis into a giant request. Below the minimum
// a "profile" would be guesswork.
const MAX_STYLE_POSTS = 500;
const MAX_STYLE_POST_TEXT = 600;
const MAX_STYLE_TOTAL_CHARS = 120000;
const MIN_STYLE_POSTS = 5;
// The writer's clarifications about their own style, echoed back to improve
// the profile ("i do capitalize names on purpose").
const MAX_STYLE_GUIDANCE = 500;

// The kinds of draft the adviser knows how to read. The scenario decides which
// guidance lines go into the prompt; 'reply' and 'quote' additionally bring the
// "Reading the room" understanding check when conversation context is present.
const SCENARIOS = new Set(['post', 'thread', 'selfReply', 'reply', 'quote']);

// One short framing per scenario, so the adviser weighs a standalone post, a
// thread, and a reply differently instead of reading everything as a broadcast.
const SCENARIO_GUIDANCE = {
  post: "This draft is a standalone post to the user's whole audience. Judge it as a first impression that has to stand on its own, with no surrounding conversation to soften or explain it.",
  thread:
    'This draft is a multi-post thread composed as one piece (posts separated by blank lines). Judge it as one piece of writing: do the posts hang together, and does the thread as a whole still fit the goals?',
  selfReply:
    'The user is adding to a thread of their own. Judge the draft as a continuation: does it follow on naturally from what they already wrote, in tone and in substance?',
  reply:
    'A reply is part of a conversation, not a broadcast. Weigh how the draft lands with the person being replied to: tone, proportion, and whether it engages with what they actually said.',
  quote:
    "Quoting re-broadcasts someone else's post to the user's own audience. Weigh how the draft frames the quoted person — is it speaking to them or about them, and could it read as inviting a pile-on?",
};

// Maps preset flags to human-readable goal descriptions for the prompt.
const PRESET_DESCRIPTIONS = {
  reduceNegativity:
    'Reduce negativity — avoid hostile, cruel, or doom-heavy tone.',
  lessConfrontational:
    'Less confrontational — avoid quote-dunking, sarcastic replies, or pointed criticism.',
};

// What each writing check asks the model to look for. Deliberately narrow: this
// is social media, where casual style is a choice, so every category is scoped
// to slips that change or muddle meaning — never to style.
const WRITING_CHECK_SPECS = {
  typos: {
    type: 'typo',
    line: 'typo: a wrong or misspelled word that slipped through — a word swapped for a near-neighbour (e.g. "out" where "our" was meant), a doubled word, or a clearly missing word.',
  },
  grammar: {
    type: 'grammar',
    line: 'grammar: broken grammar that would actually trip a reader up mid-sentence — not informal usage.',
  },
  clarity: {
    type: 'clarity',
    line: 'clarity: a sentence likely to confuse readers or be taken a different way than the user plainly meant.',
  },
};

/**
 * Build a readable transcript of the conversation the draft joins — the thread
 * being replied to, the post being quoted, or (for a self-thread) the user's
 * own earlier posts. Returns null when there's nothing usable to analyze.
 */
function buildContextBlock(context = {}) {
  const kind = context ? context.kind : null;
  if (kind !== 'reply' && kind !== 'quote' && kind !== 'selfReply') return null;

  const lines = [];
  const thread = Array.isArray(context.thread)
    ? context.thread.slice(-MAX_CONTEXT_POSTS)
    : [];
  for (const post of thread) {
    if (post && typeof post.text === 'string' && post.text.trim()) {
      const author = (post.author || 'someone').toString().slice(0, 120);
      lines.push(`${author}: ${post.text.trim().slice(0, MAX_CONTEXT_TEXT)}`);
    }
  }
  // Ensure the immediate target is present even if no thread was supplied.
  const target = context.target;
  if (target && typeof target.text === 'string' && target.text.trim()) {
    const author = (target.author || 'someone').toString().slice(0, 120);
    const line = `${author}: ${target.text.trim().slice(0, MAX_CONTEXT_TEXT)}`;
    if (!lines.includes(line)) lines.push(line);
  }

  if (lines.length === 0) return null;
  return { kind, transcript: lines.join('\n') };
}

function buildGoalsList(goals) {
  const lines = [];
  const src = goals && typeof goals === 'object' ? goals : {};
  const presets =
    src.presets && typeof src.presets === 'object' ? src.presets : {};

  for (const [key, description] of Object.entries(PRESET_DESCRIPTIONS)) {
    if (presets[key]) lines.push({ id: key, label: description });
  }

  const limitTopic = presets.limitTopic;
  if (
    limitTopic &&
    limitTopic.enabled &&
    typeof limitTopic.topic === 'string'
  ) {
    // The topic field may hold a comma-separated list of topics to ease off of.
    // Clipped before splitting, so the cap bounds the whole list.
    const topics = limitTopic.topic
      .slice(0, MAX_LIMIT_TOPIC)
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (topics.length === 1) {
      lines.push({
        id: 'limitTopic',
        label: `Limit posting about "${topics[0]}" — flag if this post is heavily about that topic.`,
      });
    } else if (topics.length > 1) {
      const list = topics.map((t) => `"${t}"`).join(', ');
      lines.push({
        id: 'limitTopic',
        label: `Limit posting about these topics: ${list} — flag if this post is heavily about any of them.`,
      });
    }
  }

  const customText =
    typeof src.customText === 'string'
      ? src.customText.trim().slice(0, MAX_GOALS_CUSTOM)
      : '';
  if (customText) {
    lines.push({
      id: 'custom',
      label: `Custom goals (in the user's own words): ${customText}`,
    });
  }

  return lines;
}

/**
 * The scenario the prompt is framed for. An explicit, known scenario from the
 * client wins; otherwise it's derived from the context block (older clients
 * send only that), falling back to a standalone post.
 */
function normalizeScenario(scenario, contextBlock) {
  if (typeof scenario === 'string' && SCENARIOS.has(scenario)) return scenario;
  if (contextBlock && SCENARIOS.has(contextBlock.kind))
    return contextBlock.kind;
  return 'post';
}

/**
 * Which writing checks the client asked for, plus the writer's own guidance:
 * `customText` (free-text notes and exceptions for the proofread) and `style`
 * (the profile learned from their recent posts — see buildStylePrompt). Both
 * only mean anything alongside a category, so the whole thing is null when no
 * category is on and callers can treat "no proofread requested" as one falsy
 * case.
 *
 * @returns {{categories: object, customText: string|null, style: string|null}|null}
 */
function normalizeWritingChecks(writingChecks) {
  if (!writingChecks || typeof writingChecks !== 'object') return null;
  const categories = {};
  for (const key of Object.keys(WRITING_CHECK_SPECS)) {
    if (writingChecks[key] === true) categories[key] = true;
  }
  if (Object.keys(categories).length === 0) return null;

  const customText =
    typeof writingChecks.customText === 'string' &&
    writingChecks.customText.trim()
      ? writingChecks.customText.trim().slice(0, MAX_WRITING_CUSTOM)
      : null;
  const style =
    typeof writingChecks.style === 'string' && writingChecks.style.trim()
      ? writingChecks.style.trim().slice(0, MAX_STYLE_SUMMARY)
      : null;

  return { categories, customText, style };
}

/**
 * The `max_tokens` ceiling for one adviser read: a ceiling, not a reservation.
 * @param {object|null} writingChecks - from normalizeWritingChecks
 * @returns {number}
 */
function adviserMaxTokens(writingChecks) {
  return (
    (writingChecks ? ADVISER_PROOFREAD_TOKENS : ADVISER_TOKENS) +
    THINKING_ALLOWANCE
  );
}

/**
 * Assemble the system + user messages for one adviser read.
 *
 * @param {object} opts
 * @param {string} opts.text - the draft post text (already validated non-empty)
 * @param {Array<{id,label}>} opts.goalsList - from buildGoalsList
 * @param {{kind,transcript}|null} opts.contextBlock - from buildContextBlock
 * @param {string} opts.scenario - from normalizeScenario
 * @param {object|null} opts.writingChecks - from normalizeWritingChecks
 * @returns {{system: string, user: string}}
 */
function buildAdviserPrompt({
  text,
  goalsList,
  contextBlock,
  scenario,
  writingChecks,
}) {
  const system = [
    'You help a social-media user keep their posts aligned with goals they set for themselves.',
    'Be concise, supportive, and non-judgmental. The user owns their post and can publish anyway —',
    'your job is to surface gentle, useful feedback, not to censor.',
    'Respond with STRICT JSON only, no prose, no code fences.',
  ].join(' ');

  const goalsText = goalsList.length
    ? goalsList.map((g) => `- [${g.id}] ${g.label}`).join('\n')
    : '(no specific goals set)';

  const userParts = [
    'The user wants their posts to follow these goals:',
    goalsText,
    '',
  ];

  const guidance = SCENARIO_GUIDANCE[scenario] || SCENARIO_GUIDANCE.post;
  userParts.push(guidance, '');

  if (contextBlock) {
    const intro =
      contextBlock.kind === 'selfReply'
        ? "Here are the user's own earlier posts in the thread (oldest to newest):"
        : `The user is ${contextBlock.kind === 'quote' ? 'quoting' : 'replying to'} someone else. Here is that conversation (oldest to newest):`;
    userParts.push(intro, '"""', contextBlock.transcript, '"""', '');
  }

  userParts.push(
    'Here is their draft post:',
    '"""',
    text,
    '"""',
    '',
    'Analyze the draft. Return JSON with this exact shape:',
    '{',
    '  "sentiment": { "label": "positive|neutral|negative", "score": <number -1..1> },',
    '  "checks": [ { "id": "<goal id>", "label": "<short goal name>", "status": "ok|caution|conflict", "note": "<one short sentence>", "excerpt": "<exact passage copied verbatim from the draft, or null>" } ],',
    '  "suggestion": "<one short, optional rewrite or tip, or null if everything is fine>",',
    '  "overallStatus": "ok|caution|conflict"',
    '}',
    'Include one check object per goal id listed above.',
    'For a check with status "caution" or "conflict", "excerpt" is the passage the judgment is about: the shortest',
    'phrase or sentence that carries it, copied character-for-character from the draft. Use null when the status is',
    '"ok" or when the judgment is about the draft as a whole rather than a particular passage.',
  );

  // "Reading the room" only makes sense against someone else's words — a
  // self-thread has context but nobody to misread.
  if (
    contextBlock &&
    (contextBlock.kind === 'reply' || contextBlock.kind === 'quote')
  ) {
    userParts.push(
      'Additionally, include a check with id "understanding" and label "Reading the room" that judges whether the draft',
      'appears to MISUNDERSTAND or misread what the other person actually said (e.g. arguing against a point they did not make,',
      'missing their tone, or answering a different question). Use status "ok" if it engages fairly, "caution" if it might be',
      'misreading them, "conflict" if it clearly misunderstands. The note should briefly say what may have been missed.',
    );
  }

  if (writingChecks) {
    const categoryLines = Object.keys(writingChecks.categories).map(
      (key) => `- ${WRITING_CHECK_SPECS[key].line}`,
    );
    userParts.push(
      '',
      'Additionally, proofread the draft — but remember this is social media, where casual style is a choice:',
      'lowercase, slang, abbreviations, sentence fragments, and informal punctuation are intentional and are NEVER issues.',
      'Flag only clear, significant slips a careful writer would want to catch before publishing. Look only for:',
      ...categoryLines,
    );
    if (writingChecks.style) {
      userParts.push(
        "The user's own writing norms, learned from their recent posts — anything consistent with these is their",
        'intentional style, never a slip:',
        '"""',
        writingChecks.style,
        '"""',
      );
    }
    if (writingChecks.customText) {
      userParts.push(
        "The user's own notes for this proofread — these take precedence over everything above:",
        '"""',
        writingChecks.customText,
        '"""',
      );
    }
    userParts.push(
      'Add a "writing" key to the JSON:',
      '"writing": { "issues": [ { "type": "typo|grammar|clarity", "found": "<exact excerpt copied verbatim from the draft>", "replacement": "<the same excerpt, corrected>", "note": "<one short reason>" } ] }',
      '"found" must be copied character-for-character from the draft, long enough to be unambiguous — include a few',
      "surrounding words when the slip is a short or common word. Keep each correction minimal; never restyle the user's voice.",
      `If nothing rises to a real problem, return an empty issues array. At most ${MAX_WRITING_ISSUES} issues.`,
    );
  }

  userParts.push('"overallStatus" should be the most severe of the checks.');

  return { system, user: userParts.join('\n') };
}

/**
 * The model's goal checks, cleaned for the client. Each keeps its id, label,
 * status and note; an unknown status reads as 'ok', which is what the client
 * already made of one. `excerpt` survives only on a check that flags something
 * and only as a verbatim passage of the draft short of the whole draft: the
 * client marks it in place, so a misquote would mark nothing, and the whole
 * draft underlined says no more than the status does.
 */
function normalizeChecks(rawChecks, draftText) {
  if (!Array.isArray(rawChecks)) return [];
  const text = typeof draftText === 'string' ? draftText : '';

  const checks = [];
  for (const raw of rawChecks) {
    if (checks.length >= MAX_CHECKS) break;
    if (!raw || typeof raw !== 'object') continue;
    const id =
      typeof raw.id === 'string' ? raw.id.trim().slice(0, MAX_CHECK_LABEL) : '';
    const label =
      typeof raw.label === 'string'
        ? raw.label.trim().slice(0, MAX_CHECK_LABEL)
        : '';
    if (!id && !label) continue;
    const status = CHECK_STATUSES.has(raw.status) ? raw.status : 'ok';
    const note =
      typeof raw.note === 'string' ? raw.note.slice(0, MAX_CHECK_NOTE) : '';
    const excerpt = typeof raw.excerpt === 'string' ? raw.excerpt : '';
    const keepExcerpt =
      status !== 'ok' &&
      excerpt.trim() !== '' &&
      excerpt.length <= MAX_CHECK_EXCERPT &&
      text.includes(excerpt) &&
      excerpt.trim() !== text.trim();
    checks.push({
      id,
      label: label || id,
      status,
      note,
      excerpt: keepExcerpt ? excerpt : null,
    });
  }
  return checks;
}

/**
 * Validate the model's writing issues against the draft they claim to be from.
 * Anything the composer couldn't act on truthfully is dropped: an unknown or
 * un-requested category, a `found` that isn't an exact excerpt of the draft
 * (the one-tap fix would silently do nothing), or a no-op "correction".
 * Returns null when no writing checks were requested, else { issues: [...] }.
 */
function normalizeWritingIssues(rawWriting, draftText, writingChecks) {
  if (!writingChecks) return null;

  const allowedTypes = new Set(
    Object.keys(writingChecks.categories).map(
      (key) => WRITING_CHECK_SPECS[key].type,
    ),
  );

  const issues = [];
  const list =
    rawWriting && Array.isArray(rawWriting.issues) ? rawWriting.issues : [];
  for (const issue of list) {
    if (issues.length >= MAX_WRITING_ISSUES) break;
    if (!issue || typeof issue !== 'object') continue;
    if (!allowedTypes.has(issue.type)) continue;
    const found = typeof issue.found === 'string' ? issue.found : '';
    if (!found.trim()) continue;
    if (!draftText.includes(found)) continue;
    const replacement =
      typeof issue.replacement === 'string' &&
      issue.replacement.trim() &&
      issue.replacement !== found
        ? issue.replacement
        : null;
    const note =
      typeof issue.note === 'string'
        ? issue.note.slice(0, MAX_WRITING_NOTE)
        : '';
    issues.push({ type: issue.type, found, replacement, note });
  }

  return { issues };
}

/**
 * Clean the post texts sent for style synthesis: strings (or {text} objects),
 * trimmed, non-empty, capped per post, in count, and in total characters.
 * Order is preserved — clients send newest first, so when the character budget
 * runs out it is the oldest posts that fall off.
 */
function normalizeStylePosts(rawPosts) {
  if (!Array.isArray(rawPosts)) return [];
  const texts = [];
  let totalChars = 0;
  for (const post of rawPosts) {
    if (texts.length >= MAX_STYLE_POSTS || totalChars >= MAX_STYLE_TOTAL_CHARS)
      break;
    const text =
      typeof post === 'string'
        ? post
        : post && typeof post.text === 'string'
          ? post.text
          : '';
    const trimmed = text.trim();
    if (!trimmed) continue;
    const clipped = trimmed.slice(0, MAX_STYLE_POST_TEXT);
    texts.push(clipped);
    totalChars += clipped.length;
  }
  return texts;
}

/** A refinement input (guidance, previous summary): trimmed and capped, or null when unusable. */
function normalizeStyleText(value, max) {
  return typeof value === 'string' && value.trim()
    ? value.trim().slice(0, max)
    : null;
}

/**
 * The prompt that turns a person's recent posts into a compact profile of
 * their deliberate writing conventions — the things the proofread must treat
 * as style, not slips. Consistency is the test: a pattern across many posts is
 * style; a one-off against their own pattern is exactly the kind of slip the
 * proofread exists to catch, so it must stay OUT of the profile.
 *
 * Refinement inputs (both optional, both already normalized by the caller):
 * `previousSummary` is the profile being improved — observations the posts
 * still support carry over; `guidance` is the writer's own clarification of
 * their style, and on their own style the writer is the authority, so it
 * outranks anything inferred from the posts.
 *
 * @param {string[]} texts - from normalizeStylePosts (length >= MIN_STYLE_POSTS)
 * @param {{guidance?: string|null, previousSummary?: string|null}} [refinement]
 * @returns {{system: string, user: string}}
 */
function buildStylePrompt(
  texts,
  { guidance = null, previousSummary = null } = {},
) {
  const system = [
    "You describe a social-media writer's personal style so a proofreader can respect it.",
    'Respond with STRICT JSON only, no prose, no code fences.',
  ].join(' ');

  const parts = [
    `Here are ${texts.length} recent posts by one person on social media, newest first, separated by --- lines:`,
    '"""',
    texts.join('\n---\n'),
    '"""',
    '',
    'Write a compact profile of their deliberate writing conventions — the norms of how this person writes, so a',
    'proofreader knows what NOT to flag as a mistake. Cover, where evident: capitalization (e.g. all-lowercase on',
    'purpose), punctuation habits, spelling and contraction quirks used consistently (e.g. "gonna", dropped',
    'apostrophes), dialect or slang, emoji or emoticon use, formatting habits, and typical register.',
    'Judge by consistency: a pattern across many posts is their style; something appearing once or twice against',
    'their own pattern is likely a slip — leave one-offs out of the profile.',
  ];

  if (previousSummary) {
    parts.push(
      'A previous version of this profile exists. Keep whatever the posts above still support, and correct or drop',
      "whatever they don't:",
      '"""',
      previousSummary,
      '"""',
    );
  }

  if (guidance) {
    parts.push(
      'The writer has clarified their own style in their own words. On their style THEY are the authority: fold',
      'these clarifications into the profile, and where they contradict something inferred from the posts, the',
      'writer wins:',
      '"""',
      guidance,
      '"""',
    );
  }

  parts.push(
    'End with one sentence on anything they clearly do keep careful (e.g. names, links, factual claims) so the',
    'proofreader stays alert there.',
    'Return JSON: { "summary": "<the profile, 3-6 short sentences, under 700 characters, in the third person>" }',
  );

  return { system, user: parts.join('\n') };
}

/** The synthesized profile out of the model response: a trimmed, capped string, or '' when unusable. */
function normalizeStyleSummary(result) {
  const summary =
    result && typeof result.summary === 'string' ? result.summary.trim() : '';
  return summary.slice(0, MAX_STYLE_SUMMARY);
}

export {
  MAX_WRITING_ISSUES,
  MAX_CHECKS,
  MAX_CHECK_EXCERPT,
  MIN_STYLE_POSTS,
  MAX_STYLE_POSTS,
  MAX_STYLE_TOTAL_CHARS,
  MAX_STYLE_GUIDANCE,
  MAX_STYLE_SUMMARY,
  SCENARIO_GUIDANCE,
  ADVISER_TOKENS,
  ADVISER_PROOFREAD_TOKENS,
  adviserMaxTokens,
  buildContextBlock,
  buildGoalsList,
  normalizeScenario,
  normalizeWritingChecks,
  buildAdviserPrompt,
  normalizeChecks,
  normalizeWritingIssues,
  normalizeStylePosts,
  normalizeStyleText,
  buildStylePrompt,
  normalizeStyleSummary,
};
