/**
 * Vercel AI Gateway client
 *
 * Thin wrapper around the AI Gateway's OpenAI-compatible chat completions
 * endpoint. Keeps the gateway API key server-side and centralizes timeout +
 * error handling for the AI help while posting (adviser, style reading, alt
 * text). The key and base URL are read from the environment on every call.
 *
 * Docs: https://vercel.com/docs/ai-gateway
 */

import { normalizeUser, normalizeTags } from './reporting.js';

// Under the client's own 30 s wait, so an answer that arrives is one the
// client is still waiting for.
export const DEFAULT_TIMEOUT_MS = 25000;
export const DEFAULT_BASE_URL = 'https://ai-gateway.vercel.sh/v1';

export class AIGatewayError extends Error {
  constructor(message, { status, cause } = {}) {
    super(message);
    this.name = 'AIGatewayError';
    this.status = status;
    if (cause) this.cause = cause;
  }
}

function apiKey(env) {
  const key = env.AI_GATEWAY_API_KEY;
  return typeof key === 'string' && key.trim() ? key.trim() : null;
}

function baseUrl(env) {
  const raw =
    typeof env.AI_GATEWAY_BASE_URL === 'string'
      ? env.AI_GATEWAY_BASE_URL.trim()
      : '';
  return (raw || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

export function isConfigured(env = process.env) {
  return Boolean(apiKey(env));
}

/**
 * Low-level chat completion call.
 * @param {Object} opts
 * @param {string} opts.model - Gateway model id, from modelsFor(feature)
 * @param {string[]} [opts.fallbackModels] - ordered fallback model ids the gateway
 *        tries if the primary fails/unavailable (providerOptions.gateway.models)
 * @param {Array}  opts.messages - OpenAI-style messages array
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.temperature]
 * @param {number} [opts.timeoutMs]
 * @param {string} [opts.user]  - Custom Reporting user id (the requester's DID)
 * @param {string[]} [opts.tags] - Custom Reporting tags (app / env / feature)
 * @param {boolean} [opts.zeroDataRetention] - route only to providers with zero
 *        data retention agreements
 * @param {boolean} [opts.disallowPromptTraining] - never route to a provider
 *        that trains on prompts
 * @param {string} [opts.reasoning] - a reasoning effort to send
 * @param {{type: string}} [opts.responseFormat] - e.g. { type: 'json_object' }
 * @param {Object} [opts.env] - the environment (process.env by default)
 * @returns {Promise<{content: string, finishReason: string|null, usage: Object|null, servedModel: string|null}>}
 *          the assistant message, why generation stopped ('length' means it was
 *          cut off), the provider's token counts, and which model actually
 *          answered.
 */
export async function chatDetailed({
  model,
  fallbackModels,
  messages,
  maxTokens = 1024,
  temperature = 0.2,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  user,
  tags,
  zeroDataRetention,
  disallowPromptTraining,
  reasoning,
  responseFormat,
  env = process.env,
} = {}) {
  const key = apiKey(env);
  if (!key) {
    throw new AIGatewayError(
      'AI Gateway is not configured (missing AI_GATEWAY_API_KEY)',
      { status: 503 },
    );
  }

  // Every caller resolves its model from models.js first, so a missing one is
  // a coding mistake rather than a configuration gap; defaulting here would
  // let a caller that forgot to pass one silently run on another feature's
  // model.
  if (!model) {
    throw new AIGatewayError(
      'No model supplied to the AI Gateway (see server/ai/models.js)',
      { status: 500 },
    );
  }

  const requestBody = {
    model,
    messages,
    max_tokens: maxTokens,
    temperature,
  };
  if (typeof reasoning === 'string' && reasoning)
    requestBody.reasoning = { effort: reasoning };
  if (responseFormat && typeof responseFormat === 'object')
    requestBody.response_format = responseFormat;

  // providerOptions.gateway carries several unrelated things the gateway reads
  // off the same object: native model fallbacks, privacy routing, and the
  // Custom Reporting metadata (user + tags) used to attribute usage. Build it
  // up and only attach it if there's something to send.
  const gateway = {};

  // Native AI Gateway model fallbacks: if the primary model fails or is
  // unavailable, the gateway retries these in order within the same request.
  // https://vercel.com/docs/ai-gateway/models-and-providers/model-fallbacks
  if (Array.isArray(fallbackModels) && fallbackModels.length > 0) {
    gateway.models = fallbackModels;
  }

  // Privacy routing. With no provider that qualifies, the gateway answers 400
  // instead of routing anywhere else.
  // https://vercel.com/docs/ai-gateway/security-and-compliance
  if (zeroDataRetention === true) gateway.zeroDataRetention = true;
  if (disallowPromptTraining === true) gateway.disallowPromptTraining = true;

  // Custom Reporting attribution (who/what made the call). Normalized again
  // here so a call stays within the gateway's limits however it was built.
  // https://vercel.com/docs/ai-gateway/observability/custom-reporting
  const reportingUser = normalizeUser(user);
  if (reportingUser) gateway.user = reportingUser;
  const reportingTags = normalizeTags(tags);
  if (reportingTags.length > 0) gateway.tags = reportingTags;

  if (Object.keys(gateway).length > 0) {
    requestBody.providerOptions = { gateway };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(`${baseUrl(env)}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new AIGatewayError('AI Gateway request timed out', {
        status: 504,
        cause: error,
      });
    }
    throw new AIGatewayError('AI Gateway request failed', {
      status: 502,
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    let detail = '';
    try {
      detail = await response.text();
    } catch {
      /* the status says enough */
    }
    throw new AIGatewayError(
      `AI Gateway returned ${response.status}: ${detail.slice(0, 500)}`,
      {
        status: response.status === 429 ? 429 : 502,
      },
    );
  }

  let data;
  try {
    data = await response.json();
  } catch (error) {
    throw new AIGatewayError(
      'AI Gateway returned an unexpected response shape',
      { status: 502, cause: error },
    );
  }
  const choice = data?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content !== 'string') {
    throw new AIGatewayError(
      'AI Gateway returned an unexpected response shape',
      { status: 502 },
    );
  }
  // A response cut off at max_tokens is not a malformed one. Carrying the
  // finish reason lets callers tell "raise max_tokens" apart from "the model
  // wrote something unparseable".
  const finishReason = choice?.finish_reason || null;
  // The gateway echoes the model that actually answered, which is NOT the one
  // requested when a fallback fired.
  const servedModel = typeof data?.model === 'string' ? data.model : null;
  if (finishReason === 'length') {
    // Counts only, never content. Reasoning tokens near the ceiling mean a
    // thinking model spent the budget before answering: a model question,
    // not a budget one.
    const used = data?.usage?.completion_tokens;
    const thought = data?.usage?.completion_tokens_details?.reasoning_tokens;
    const spent = Number.isFinite(used)
      ? `; ${used} completion tokens${Number.isFinite(thought) ? `, ${thought} of them reasoning` : ''}`
      : '';
    console.warn(
      `[ai-gateway] ${servedModel || model} hit max_tokens (${maxTokens})${spent}; response was truncated`,
    );
  }
  return { content, finishReason, usage: data?.usage || null, servedModel };
}

/**
 * Slice the balanced JSON value starting at `start`, or null if it never closes.
 * Tracks string state and escapes, so a brace inside a string value can't end
 * the scan early.
 */
function balancedSlice(text, start) {
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      if (inString) escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Extract a JSON object/array from a model response that may be wrapped in
 * prose or ```json fences. Throws AIGatewayError if nothing parseable is found.
 */
export function parseJSONResponse(content) {
  const trimmed = content.trim();

  // Try direct parse first.
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }

  // Strip code fences and retry.
  const fenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '');
  try {
    return JSON.parse(fenced);
  } catch {
    /* fall through */
  }

  // Last resort: find an embedded JSON value.
  //
  // A single greedy /[{[][\s\S]*[}\]]/ would match from the first bracket to
  // the LAST one anywhere in the response, so any commentary after the JSON
  // containing a bracket — "…is not in the catalog [see effects]" — would be
  // swallowed into the match and break the parse. Models are most likely to
  // add exactly that kind of caveat when part of a request cannot be honoured.
  //
  // Scan balanced instead, and try each candidate start: prose BEFORE the JSON
  // can contain a brace too, so the first bracket is not necessarily the one
  // that opens the value we want.
  const MAX_CANDIDATES = 20;
  let tried = 0;
  for (let i = 0; i < fenced.length && tried < MAX_CANDIDATES; i++) {
    const ch = fenced[i];
    if (ch !== '{' && ch !== '[') continue;
    tried++;
    const slice = balancedSlice(fenced, i);
    // A candidate that never closes means the response ends mid-value — it was
    // cut off. STOP rather than scanning on: every later bracket is nested
    // inside this unterminated one, and an inner fragment that happens to be
    // complete ("conditions":[] out of a truncated object) would parse and be
    // returned as if it were the whole answer. Handing back a fragment is worse
    // than failing, because nothing downstream can tell it apart from a real,
    // sparse response.
    if (!slice) break;
    try {
      return JSON.parse(slice);
    } catch {
      /* prose that merely looked like JSON — try the next */
    }
  }

  throw new AIGatewayError('Failed to parse JSON from AI Gateway response', {
    status: 502,
  });
}

/**
 * The JSON in a chatDetailed answer. Takes `logResponse: false` to keep an
 * unparseable answer out of the logs when it was drawn from someone's own
 * writing.
 */
export function jsonFromAnswer(
  { content, finishReason },
  { logResponse } = {},
) {
  // Truncated JSON can never parse, and saying so plainly is the difference
  // between "raise max_tokens" and an afternoon spent on the prompt.
  if (finishReason === 'length') {
    throw new AIGatewayError(
      'The AI response was cut off before it finished (max_tokens reached)',
      { status: 502 },
    );
  }
  try {
    return parseJSONResponse(content);
  } catch (error) {
    // The unparseable text is the only thing that identifies WHY, and it is
    // never shown to the user, so a bounded sample of it is logged
    // server-side, unless the caller's output is drawn from someone's own
    // writing.
    if (logResponse === false) {
      console.warn(
        `[ai-gateway] Unparseable JSON response (${content.length} chars, not logged)`,
      );
    } else {
      console.warn(
        '[ai-gateway] Unparseable JSON response (first 400 chars):',
        content.slice(0, 400),
      );
    }
    throw error;
  }
}

/**
 * Chat completion that returns parsed JSON. Takes chatDetailed's options, plus
 * jsonFromAnswer's `logResponse`.
 */
export async function chatJSON(opts) {
  return jsonFromAnswer(await chatDetailed(opts), opts);
}

/**
 * Build an OpenAI-compatible user message with an inline image (data URL).
 * @param {string} text - the instruction/prompt text
 * @param {string} imageBase64 - base64 (no data: prefix)
 * @param {string} mimeType - e.g. 'image/jpeg'
 */
export function buildVisionMessage(text, imageBase64, mimeType) {
  return {
    role: 'user',
    content: [
      { type: 'text', text },
      {
        type: 'image_url',
        image_url: { url: `data:${mimeType};base64,${imageBase64}` },
      },
    ],
  };
}
