/**
 * POST /api/ai/alt-text — an image description.
 *
 * Given an uploaded image, returns a concise accessibility description suitable
 * for the `alt` field of an ATProto image embed. Uses a vision-capable model
 * through the Vercel AI Gateway.
 *
 * POST {
 *   imageBase64: string,      // no data: prefix, ≤ MAX_BASE64_BYTES
 *   mimeType: string,         // image/jpeg | image/png | image/webp | image/gif
 *   context?: string,         // the post's text, for disambiguation
 *   followUp?: string,        // a note steering a revision of a prior result
 *   previousAltText?: string, // the description being refined (paired with followUp)
 *   presets?: string[],       // the composer's quick notes, by id (altTextPrompt.js)
 *   kind?: string             // what the author says the image is: photo | interface | chart | text
 * }
 * ->   { altText: string, usage?: { used, limit } }
 *
 * When `followUp` is present the request is a refinement: the model revises
 * `previousAltText` per the note instead of describing from scratch. Each call
 * (fresh or follow-up) counts once against the `altText` allowance
 * (AI_ALT_TEXT_MONTHLY_LIMIT). `presets` and `kind` only change how text in
 * the image is treated; unknown values are ignored.
 */

import { sendJson } from '../../http.js';
import {
  buildVisionMessage,
  chatDetailed,
  DEFAULT_TIMEOUT_MS,
} from '../gateway.js';
import { modelsFor } from '../models.js';
import { buildReporting } from '../reporting.js';
import { enforce } from '../rateLimit.js';
import {
  beginAiRequest,
  checkAllowance,
  keepUse,
  releaseUse,
  sendAiError,
} from '../respond.js';
import {
  MAX_BASE64_BYTES,
  ALLOWED_MIME,
  buildAltTextInstruction,
  toAltText,
} from '../altTextPrompt.js';

// This feature's key in models.js (which model it runs on) and in the
// Gateway's Custom Reporting (which feature the usage is billed to). One
// constant for both, so the model table and the usage dashboard can't drift.
const FEATURE = 'alt-text';
const ALLOWANCE = 'altText';

// The client stops waiting at 30 s. A retry on a fallback that could only
// finish after that would be counted against an answer nobody sees, so the
// retries share what is left of this budget and are skipped once too little
// of it remains to be worth a call.
export const ALT_TEXT_BUDGET_MS = 28000;
export const MIN_FALLBACK_MS = 5000;

// A description cut off at max_tokens ends mid-sentence, and a screen reader
// would read it out as if it were whole, so it counts as no answer.
function altTextFrom({ content, finishReason }) {
  return finishReason === 'length' ? '' : toAltText(content);
}

export default async function altText(req, res) {
  const deadline = Date.now() + ALT_TEXT_BUDGET_MS;
  let allowance = null;
  try {
    const started = await beginAiRequest(req, res);
    if (!started) return undefined;
    const { did, body } = started;

    const {
      imageBase64,
      mimeType,
      context,
      followUp,
      previousAltText,
      presets,
      kind,
    } = body;

    if (typeof imageBase64 !== 'string' || !imageBase64) {
      return sendJson(res, 400, { error: 'Missing "imageBase64"' });
    }
    if (typeof mimeType !== 'string' || !ALLOWED_MIME.has(mimeType)) {
      return sendJson(res, 400, { error: 'Missing or unsupported "mimeType"' });
    }
    if (imageBase64.length > MAX_BASE64_BYTES) {
      return sendJson(res, 413, { error: 'Image is too large to analyze' });
    }

    allowance = await checkAllowance(res, ALLOWANCE, did);
    if (!allowance) return undefined;

    // The per-account cost ceiling across every AI feature.
    const rl = await enforce(did);
    if (!rl.allowed) {
      await releaseUse(allowance);
      return sendJson(res, rl.status, rl.body);
    }

    const { instruction, maxTokens, temperature } = buildAltTextInstruction({
      context,
      followUp,
      previousAltText,
      presets,
      kind,
    });

    const message = buildVisionMessage(instruction, imageBase64, mimeType);

    const { model, fallbackModels } = modelsFor(FEATURE);
    const reporting = buildReporting({ feature: FEATURE, did });

    let description = altTextFrom(
      await chatDetailed({
        model,
        fallbackModels,
        messages: [message],
        maxTokens,
        temperature,
        timeoutMs: Math.min(
          DEFAULT_TIMEOUT_MS,
          Math.max(1, deadline - Date.now()),
        ),
        ...reporting,
      }),
    );

    // The gateway's model fallback only fires on a hard failure, not on a
    // successful-but-empty or cut-off response (some vision models occasionally
    // return nothing). If the primary gave no usable answer, retry on each
    // configured fallback model directly while time remains.
    if (!description) {
      for (const fb of fallbackModels) {
        const remaining = deadline - Date.now();
        if (remaining < MIN_FALLBACK_MS) break;
        try {
          description = altTextFrom(
            await chatDetailed({
              model: fb,
              messages: [message],
              maxTokens,
              temperature,
              timeoutMs: Math.min(DEFAULT_TIMEOUT_MS, remaining),
              ...reporting,
            }),
          );
          if (description) break;
        } catch {
          /* try the next fallback */
        }
      }
    }

    if (!description) {
      await releaseUse(allowance);
      return sendJson(res, 502, {
        error:
          'Could not describe this image. Please try again, or write your own.',
      });
    }

    const responseBody = { altText: description };
    const usage = keepUse(allowance);
    if (usage) responseBody.usage = usage;

    return sendJson(res, 200, responseBody);
  } catch (error) {
    await releaseUse(allowance);
    return sendAiError(res, error, {
      tag: 'alt-text',
      fallback: 'Alt text generation failed',
    });
  }
}
