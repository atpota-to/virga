/**
 * POST /api/ai/analyze-post — the adviser's read of a draft.
 *
 * Given a draft post and the writer's posting goals, returns a concise,
 * non-judgmental assessment used by the composer's optional pre-publish check.
 * The check is advisory only — the client never hard-blocks publishing.
 *
 * POST {
 *   text: string,                    // required, non-blank, ≤ 8000 chars
 *   goals?: { presets?: object, customText?: string },
 *   scenario?: 'post' | 'thread' | 'selfReply' | 'reply' | 'quote',
 *                                    // what kind of draft this is, so the
 *                                    // adviser reads it in the right frame;
 *                                    // derived from context.kind when absent
 *   context?: {                      // optional conversation context
 *     kind: 'reply' | 'quote' | 'selfReply',
 *     thread?: [{ author: string, text: string }],  // ancestors, oldest→newest
 *     target?: { author: string, text: string }     // the post being replied to / quoted
 *   },
 *   writingChecks?: {                // optional proofread pass (all categories off = skipped)
 *     typos?: boolean, grammar?: boolean, clarity?: boolean,
 *     customText?: string,           // the writer's own guidance/exceptions for the proofread
 *     style?: string                 // their learned style profile (see synthesize-style)
 *   }
 * }
 * ->   { sentiment: {label, score}, checks: [{id,label,status,note,excerpt}],
 *        suggestion: string|null, overallStatus: 'ok'|'caution'|'conflict',
 *        writing?: { issues: [{type, found, replacement, note}] },  // only when requested
 *        usage?: { used, limit } }    // absent when the allowance is unlimited
 *
 * Counted against the `adviser` allowance (AI_ADVISER_MONTHLY_LIMIT); over it,
 * 429 { error: 'monthly_limit', limit, used }.
 */

import { sendJson } from '../../http.js';
import { chatJSON } from '../gateway.js';
import { modelsFor } from '../models.js';
import { buildReporting } from '../reporting.js';
import { enforce } from '../rateLimit.js';
import {
  beginAiRequest,
  checkAllowance,
  currentUse,
  keepUse,
  releaseUse,
  sendAiError,
} from '../respond.js';
import {
  buildContextBlock,
  buildGoalsList,
  normalizeScenario,
  normalizeWritingChecks,
  adviserMaxTokens,
  buildAdviserPrompt,
  normalizeChecks,
  normalizeWritingIssues,
} from '../adviserPrompt.js';

// This feature's key in models.js (which model it runs on) and in the
// Gateway's Custom Reporting (which feature the usage is billed to). One
// constant for both, so the model table and the usage dashboard can't drift.
const FEATURE = 'posting-adviser';
const ALLOWANCE = 'adviser';

export const MAX_TEXT_LENGTH = 8000;

const VALID_STATUSES = new Set(['ok', 'caution', 'conflict']);

export default async function analyzePost(req, res) {
  let allowance = null;
  try {
    const started = await beginAiRequest(req, res);
    if (!started) return undefined;
    const { did, body } = started;

    const { text, goals, context, scenario } = body;

    if (typeof text !== 'string' || !text.trim()) {
      return sendJson(res, 400, { error: 'Missing or empty "text"' });
    }
    if (text.length > MAX_TEXT_LENGTH) {
      return sendJson(res, 413, { error: 'Post text is too long to analyze' });
    }

    const goalsList = buildGoalsList(goals);
    const contextBlock = buildContextBlock(context);
    const writingChecks = normalizeWritingChecks(body.writingChecks);

    if (goalsList.length === 0 && !contextBlock && !writingChecks) {
      // Nothing to check against: an "ok" read so the composer proceeds,
      // neither counted nor rate limited. It still carries the count as it
      // stands, because an answer without `usage` tells the client the
      // allowance is unlimited and it would drop the count it keeps.
      const usage = await currentUse(ALLOWANCE, did);
      return sendJson(res, 200, {
        sentiment: { label: 'neutral', score: 0 },
        checks: [],
        suggestion: null,
        overallStatus: 'ok',
        ...(usage ? { usage } : {}),
      });
    }

    allowance = await checkAllowance(res, ALLOWANCE, did);
    if (!allowance) return undefined;

    // The per-account cost ceiling across every AI feature.
    const rl = await enforce(did);
    if (!rl.allowed) {
      await releaseUse(allowance);
      return sendJson(res, rl.status, rl.body);
    }

    const { system, user } = buildAdviserPrompt({
      text,
      goalsList,
      contextBlock,
      scenario: normalizeScenario(scenario, contextBlock),
      writingChecks,
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
      maxTokens: adviserMaxTokens(writingChecks),
      temperature: 0.2,
      // The answer quotes the draft (checks[].excerpt, writing.issues[].found),
      // and a draft is never stored server-side, not even in a parse-failure log.
      logResponse: false,
      ...reporting,
    });

    // Normalize / guard the response shape. A check's excerpt is validated
    // against the draft like a writing fix (see normalizeChecks), since the
    // client marks it in place.
    const checks = normalizeChecks(result?.checks, text);
    const overallStatus = VALID_STATUSES.has(result?.overallStatus)
      ? result.overallStatus
      : checks.some((c) => c.status === 'conflict')
        ? 'conflict'
        : checks.some((c) => c.status === 'caution')
          ? 'caution'
          : 'ok';

    const responseBody = {
      sentiment:
        result?.sentiment && typeof result.sentiment === 'object'
          ? {
              label: result.sentiment.label || 'neutral',
              score: Number(result.sentiment.score) || 0,
            }
          : { label: 'neutral', score: 0 },
      checks,
      suggestion:
        typeof result?.suggestion === 'string' ? result.suggestion : null,
      overallStatus,
    };

    // The proofread result rides the same response. Issues are validated
    // against the draft (see normalizeWritingIssues) so every `found` the
    // client is offered a one-tap fix for is a real excerpt it can replace.
    if (writingChecks) {
      responseBody.writing = normalizeWritingIssues(
        result?.writing,
        text,
        writingChecks,
      );
    }

    const usage = keepUse(allowance);
    if (usage) responseBody.usage = usage;

    return sendJson(res, 200, responseBody);
  } catch (error) {
    await releaseUse(allowance);
    return sendAiError(res, error, {
      tag: 'analyze-post',
      fallback: 'Analysis failed',
    });
  }
}
