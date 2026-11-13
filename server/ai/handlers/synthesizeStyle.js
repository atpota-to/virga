/**
 * POST /api/ai/synthesize-style — a style profile from the writer's posts.
 *
 * Given a batch of the caller's own recent posts, returns a compact profile of
 * their deliberate writing conventions — all-lowercase, slang, punctuation
 * habits, and so on. The adviser's writing checks send this profile back with
 * every proofread so the writer's own norms are read as style, never flagged
 * as slips. The profile is kept by the client in the writer's settings;
 * nothing is kept here.
 *
 * POST {
 *   posts: [string | { text: string }],  // recent post texts, newest first
 *   guidance?: string,                   // the writer's own clarifications about their style —
 *                                        // authoritative, folded into the profile
 *   previousSummary?: string             // the profile being refined; kept where posts still support it
 * }
 * ->   { summary: string, analyzedCount: number, usage?: { used, limit } }
 *
 * Shares the adviser's model and reporting bucket, but has its OWN monthly
 * allowance (`style`, AI_STYLE_MONTHLY_LIMIT), so learning a profile never
 * eats the adviser's per-post reads. Over it -> 429 { error: 'monthly_limit' };
 * too few usable posts to learn from -> 400 { error: 'not_enough_posts', minimum }.
 */

import { sendJson } from '../../http.js';
import { chatJSON } from '../gateway.js';
import { modelsFor } from '../models.js';
import { buildReporting } from '../reporting.js';
import { enforce } from '../rateLimit.js';
import {
  beginAiRequest,
  checkAllowance,
  countUse,
  sendAiError,
} from '../respond.js';
import {
  MIN_STYLE_POSTS,
  MAX_STYLE_GUIDANCE,
  MAX_STYLE_SUMMARY,
  normalizeStylePosts,
  normalizeStyleText,
  buildStylePrompt,
  normalizeStyleSummary,
} from '../adviserPrompt.js';

// Same feature key as analyze-post: the style profile exists for the adviser,
// so it runs on the adviser's model and bills to the adviser's bucket.
const FEATURE = 'posting-adviser';
const ALLOWANCE = 'style';

export default async function synthesizeStyle(req, res) {
  try {
    const started = await beginAiRequest(req, res);
    if (!started) return undefined;
    const { did, body } = started;

    const texts = normalizeStylePosts(body.posts);
    if (texts.length < MIN_STYLE_POSTS) {
      return sendJson(res, 400, {
        error: 'not_enough_posts',
        minimum: MIN_STYLE_POSTS,
      });
    }
    const guidance = normalizeStyleText(body.guidance, MAX_STYLE_GUIDANCE);
    const previousSummary = normalizeStyleText(
      body.previousSummary,
      MAX_STYLE_SUMMARY,
    );

    const allowance = await checkAllowance(res, ALLOWANCE, did);
    if (!allowance) return undefined;

    // The per-account cost ceiling across every AI feature.
    const rl = await enforce(did);
    if (!rl.allowed) return sendJson(res, rl.status, rl.body);

    const { system, user } = buildStylePrompt(texts, {
      guidance,
      previousSummary,
    });

    const { model, fallbackModels } = modelsFor(FEATURE);
    const reporting = buildReporting({ feature: FEATURE, did });

    const result = await chatJSON({
      model,
      fallbackModels,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      // The profile itself is asked for at under 700 characters, but thinking
      // models (the text default, google/gemini-3-flash, among them) spend
      // reasoning tokens against max_tokens BEFORE any JSON appears, and the
      // reasoning grows with input — a 250-post synthesis blew through a cap
      // of 400 and truncated. 3000 leaves reasoning room; the summary is still
      // bounded by the prompt and normalizeStyleSummary's cap.
      maxTokens: 3000,
      temperature: 0.2,
      // The answer describes the writer's own posts; keep it out of the logs
      // even when it doesn't parse.
      logResponse: false,
      ...reporting,
    });

    const summary = normalizeStyleSummary(result);
    if (!summary) {
      // Storing an empty profile would quietly disable nothing and confuse the
      // settings UI, so fail loudly and let the writer retry. Not counted.
      return sendJson(res, 502, {
        error: 'Could not synthesize a style profile — try again.',
      });
    }

    const responseBody = { summary, analyzedCount: texts.length };

    const usage = await countUse(ALLOWANCE, did, allowance);
    if (usage) responseBody.usage = usage;

    return sendJson(res, 200, responseBody);
  } catch (error) {
    return sendAiError(res, error, {
      tag: 'synthesize-style',
      fallback: 'Style synthesis failed',
    });
  }
}
