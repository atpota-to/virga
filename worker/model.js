// The moderator's model calls, through the Vercel AI Gateway's
// OpenAI-compatible chat completions, as Virga's server makes its own
// (server/ai/gateway.js): one request per step, tools described as functions.
// The key (AI_GATEWAY_API_KEY) lives on the droplet with the agent.
//
//   DEFENSE_AGENT_MODEL  the model that answers DMs; it must call tools.
//                        DeepSeek V4.1 Flash by default, as bluesky-mod's is
//
// The write check isn't run here: Vercel runs it, with its own key
// (server/defense/moderator/check.js).
//
// Every call asks the gateway to route only to providers that don't train on
// prompts: the DMs and the handles in them are the owners'.

export const DEFAULT_BASE_URL = 'https://ai-gateway.vercel.sh/v1';
export const DEFAULT_AGENT_MODEL = 'deepseek/deepseek-v4.1-flash';

export class ModelError extends Error {
  constructor(message, { status = 0 } = {}) {
    super(message);
    this.name = 'ModelError';
    this.status = status;
  }
}

/** The model settings from the worker's environment, or null when there is no key (typed commands only). */
export function modelConfig(env = process.env) {
  const apiKey = String(env.AI_GATEWAY_API_KEY || '').trim();
  if (!apiKey) return null;
  return {
    apiKey,
    baseUrl: (String(env.AI_GATEWAY_BASE_URL || '').trim() || DEFAULT_BASE_URL).replace(/\/+$/, ''),
    agent: String(env.DEFENSE_AGENT_MODEL || '').trim() || DEFAULT_AGENT_MODEL,
    zeroDataRetention: env.DEFENSE_AGENT_ZDR === 'on',
  };
}

/**
 * One completion: `{ message, finishReason, usage }`, where `message` has
 * `content` and, when the model called tools, `tool_calls`.
 */
export async function complete(config, { model, messages, tools = null, maxTokens = 1200, signal, user = null, fetchImpl = globalThis.fetch }) {
  const gateway = { disallowPromptTraining: true, tags: ['app:virga', 'feature:moderator'] };
  if (config.zeroDataRetention) gateway.zeroDataRetention = true;
  if (user) gateway.user = String(user).slice(0, 200);
  const body = { model, messages, max_tokens: maxTokens, temperature: 0.2, providerOptions: { gateway } };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }
  let res;
  try {
    res = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    throw new ModelError(err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'The model took too long.' : `The model couldn’t be reached: ${err?.message || err}`);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new ModelError(`The AI Gateway answered ${res.status}: ${detail.slice(0, 300)}`, { status: res.status });
  }
  const data = await res.json().catch(() => null);
  const choice = data?.choices?.[0];
  if (!choice?.message) throw new ModelError('The AI Gateway answered with no message.');
  return { message: choice.message, finishReason: choice.finish_reason || null, usage: data.usage || null };
}
