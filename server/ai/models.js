/**
 * AI model selection
 *
 * One table mapping each AI feature to the Gateway model it runs on, plus that
 * feature's fallback chain. Every entry is env-driven: pointing a feature at a
 * different model is an environment-variable change on the Vercel project
 * followed by a redeploy — no code change, no release.
 *
 * Per feature (suffixes are the `env` field below):
 *   AI_MODEL_<FEATURE>            - the model that feature runs on
 *   AI_MODEL_<FEATURE>_FALLBACKS  - comma-separated models the Gateway retries,
 *                                   in order, if that one fails. Empty or
 *                                   'none' disables fallback for the feature.
 *
 * Unset features inherit the kind-wide defaults:
 *   AI_MODEL_DEFAULT / AI_MODEL_DEFAULT_FALLBACKS                (text)
 *   AI_MODEL_VISION_DEFAULT / AI_MODEL_VISION_DEFAULT_FALLBACKS  (vision)
 *
 * Fallbacks have to be declared here rather than in the Vercel dashboard: the
 * Gateway executes a fallback chain but never stores one — the model list
 * travels in the request body (providerOptions.gateway.models). What the
 * Gateway does resolve on its own is which *provider* serves a given model.
 *   https://vercel.com/docs/ai-gateway/models-and-providers/model-fallbacks
 *
 * Note what this module does NOT do: read the request body. Any signed-in
 * account can call /api/ai/*, so a caller-supplied model id would let it point
 * the Gateway key at the most expensive model on the platform and bill it to
 * the deployment. Models are operator configuration, never request input.
 */

// Last-resort defaults, used only when no env var names a model (a local dev
// machine with a bare .env, mostly).
const BASE = {
  text: {
    model: 'google/gemini-3-flash',
    fallbacks: ['anthropic/claude-sonnet-5'],
  },
  vision: {
    model: 'anthropic/claude-haiku-4.5',
    fallbacks: ['anthropic/claude-sonnet-5'],
  },
};

// Output headroom for thinking. A thinking model thinks out of the same
// max_tokens allowance as its answer, before any of the answer appears, so the
// adviser and alt text add this to their budgets in their prompt modules. It
// is a ceiling, not a reservation.
export const THINKING_ALLOWANCE = 6000;

/**
 * The features, keyed by the same string each handler reports to the Gateway's
 * Custom Reporting (reporting.js) — one name per feature, so the model table
 * and the usage dashboard can't drift apart.
 *
 * - `env`   — the AI_MODEL_<env> / AI_MODEL_<env>_FALLBACKS suffix
 * - `kind`  — which kind-wide default it inherits ('text' or 'vision')
 * - `thinkingInBudget` — the feature's prompt module already adds
 *   THINKING_ALLOWANCE to its max_tokens
 */
export const FEATURES = Object.freeze({
  'alt-text': { env: 'ALT_TEXT', kind: 'vision', thinkingInBudget: true },
  'posting-adviser': {
    env: 'POSTING_ADVISER',
    kind: 'text',
    thinkingInBudget: true,
  },
});

export const FEATURE_KEYS = Object.freeze(Object.keys(FEATURES));

// Gateway model ids are `provider/model`, optionally with a version suffix.
// Anything else is a typo, and a typo means every request for that feature 502s
// until someone reads the logs — so it is surfaced at cold start instead.
const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/i;

/** A set, non-blank env var, trimmed; undefined otherwise. */
function envValue(env, name) {
  const raw = env[name];
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * A comma-separated env var as a list.
 *
 * Returns undefined when the variable is unset (inherit), and [] when it is set
 * but empty or 'none' (an explicit "no fallbacks for this feature"). Those two
 * cases have to stay distinguishable: collapsing them would make it impossible
 * to turn a feature's fallback off without also editing the defaults.
 */
function envList(env, name) {
  const raw = env[name];
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === 'none') return [];
  return trimmed
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

/** The model a feature of this kind runs on when it names none of its own. */
export function defaultModelFor(kind, env = process.env) {
  return kind === 'vision'
    ? envValue(env, 'AI_MODEL_VISION_DEFAULT') || BASE.vision.model
    : envValue(env, 'AI_MODEL_DEFAULT') || BASE.text.model;
}

/** The fallback chain a feature of this kind inherits when it names none. */
export function defaultFallbacksFor(kind, env = process.env) {
  const configured = envList(
    env,
    kind === 'vision'
      ? 'AI_MODEL_VISION_DEFAULT_FALLBACKS'
      : 'AI_MODEL_DEFAULT_FALLBACKS',
  );
  if (configured !== undefined) return configured;
  return kind === 'vision'
    ? [...BASE.vision.fallbacks]
    : [...BASE.text.fallbacks];
}

/**
 * @throws {Error} on an unknown feature — that is a coding mistake in a
 *         handler, not something a request can trigger, and it should surface
 *         in tests rather than silently run on the wrong model.
 */
function entryFor(feature) {
  const entry = Object.prototype.hasOwnProperty.call(FEATURES, feature)
    ? FEATURES[feature]
    : undefined;
  if (!entry) {
    throw new Error(
      `Unknown AI feature "${feature}" — add it to FEATURES in server/ai/models.js`,
    );
  }
  return entry;
}

/**
 * Resolve one feature to the concrete models its request should carry.
 *
 * @param {string} feature - a key of FEATURES (the handler's own FEATURE const)
 * @returns {{ model: string, fallbackModels: string[] }}
 * @throws {Error} on an unknown feature (entryFor)
 */
export function modelsFor(feature, env = process.env) {
  const entry = entryFor(feature);

  const model =
    envValue(env, `AI_MODEL_${entry.env}`) || defaultModelFor(entry.kind, env);

  let fallbacks = envList(env, `AI_MODEL_${entry.env}_FALLBACKS`);
  if (fallbacks === undefined) fallbacks = defaultFallbacksFor(entry.kind, env);

  // A fallback equal to the primary buys a second charge for the same outcome:
  // the Gateway would retry the model that just failed. Drop those and any
  // repeats, preserving the configured order.
  const seen = new Set([model]);
  const fallbackModels = fallbacks.filter((candidate) => {
    if (!candidate || seen.has(candidate)) return false;
    seen.add(candidate);
    return true;
  });

  return { model, fallbackModels };
}

/**
 * The whole resolved table, for the cold-start log. `warnings` names any model
 * id that doesn't look like a Gateway id.
 * @returns {{ features: Array<{ feature: string, kind: string, model: string, fallbackModels: string[] }>, warnings: string[] }}
 */
export function describeResolvedModels(env = process.env) {
  const warnings = [];
  const features = FEATURE_KEYS.map((feature) => {
    const { model, fallbackModels } = modelsFor(feature, env);
    for (const id of [model, ...fallbackModels]) {
      if (!MODEL_ID_PATTERN.test(id)) {
        warnings.push(`${feature}: "${id}" is not a provider/model id`);
      }
    }
    return { feature, kind: FEATURES[feature].kind, model, fallbackModels };
  });
  return { features, warnings };
}

let logged = false;

/**
 * Log the resolved table once per instance, so a model typo shows up in the
 * deployment's logs on the first AI request rather than as a stream of 502s.
 */
export function logResolvedModelsOnce(env = process.env) {
  if (logged) return;
  logged = true;
  try {
    const { features, warnings } = describeResolvedModels(env);
    const table = features
      .map(
        (f) =>
          `${f.feature} → ${f.model}${f.fallbackModels.length ? ` (then ${f.fallbackModels.join(', ')})` : ''}`,
      )
      .join('; ');
    console.info(`[ai] models: ${table}`);
    for (const warning of warnings)
      console.warn(`[ai] model config: ${warning}`);
  } catch (error) {
    console.warn('[ai] could not resolve the model table:', error?.message);
  }
}

/** Tests only: let the next logResolvedModelsOnce() log again. */
export function resetModelsLogForTests() {
  logged = false;
}
