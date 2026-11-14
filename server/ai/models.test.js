// server/ai/models.js decides which model every AI feature runs on, and
// therefore what each request costs. Three things make it worth locking down:
//
//  1. A feature that silently inherits the wrong default is a bill, not a bug
//     report — nothing fails, the requests just run on a pricier model.
//  2. A fallback chain that quietly empties is a resilience regression nobody
//     notices until the primary provider has an outage; one that quietly grows
//     is a second paid attempt per request.
//  3. Nothing here may read the request body: a caller-supplied model id would
//     let any signed-in account point the Gateway key at the most expensive
//     model on the platform.
//
// The module reads the environment at call time, so the seam is process.env.
//
// Every expected value below is a hand-written literal. Nothing is recomputed
// from FEATURES or from the module's own expressions — a test that asks the
// implementation what it should have produced cannot fail when the
// implementation is wrong.

import {
  describe,
  it,
  expect,
  beforeEach,
  afterAll,
  afterEach,
  vi,
} from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  FEATURES,
  FEATURE_KEYS,
  THINKING_ALLOWANCE,
  modelsFor,
  describeResolvedModels,
  logResolvedModelsOnce,
  resetModelsLogForTests,
} from './models.js';

// Every env var the module reads. Cleared before each test so a value leaking
// in from the developer's shell or a previous case can't make one pass.
const ENV_KEYS = [
  'AI_MODEL_DEFAULT',
  'AI_MODEL_DEFAULT_FALLBACKS',
  'AI_MODEL_VISION_DEFAULT',
  'AI_MODEL_VISION_DEFAULT_FALLBACKS',
  'AI_MODEL_ALT_TEXT',
  'AI_MODEL_ALT_TEXT_FALLBACKS',
  'AI_MODEL_POSTING_ADVISER',
  'AI_MODEL_POSTING_ADVISER_FALLBACKS',
];

const ORIGINAL_ENV = {};
for (const key of ENV_KEYS) ORIGINAL_ENV[key] = process.env[key];

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (ORIGINAL_ENV[key] === undefined) delete process.env[key];
    else process.env[key] = ORIGINAL_ENV[key];
  }
});

describe('ai models: built-in defaults', () => {
  it('runs the adviser on the text default with a cross-provider fallback', () => {
    expect(modelsFor('posting-adviser')).toEqual({
      model: 'google/gemini-3-flash',
      fallbackModels: ['anthropic/claude-sonnet-5'],
    });
  });

  it('resolves alt text to a vision model, not the text default', () => {
    expect(modelsFor('alt-text')).toEqual({
      model: 'anthropic/claude-haiku-4.5',
      fallbackModels: ['anthropic/claude-sonnet-5'],
    });
  });

  it('keeps the thinking allowance both prompt budgets add', () => {
    expect(THINKING_ALLOWANCE).toBe(6000);
  });

  it('takes an env object in place of process.env', () => {
    expect(
      modelsFor('posting-adviser', {
        AI_MODEL_POSTING_ADVISER: 'openai/gpt-5-mini',
      }).model,
    ).toBe('openai/gpt-5-mini');
    expect(modelsFor('posting-adviser').model).toBe('google/gemini-3-flash');
  });
});

describe('ai models: per-feature overrides', () => {
  it('points one feature at another model without touching its neighbour', () => {
    process.env.AI_MODEL_POSTING_ADVISER = 'openai/gpt-5-mini';

    expect(modelsFor('posting-adviser')).toEqual({
      model: 'openai/gpt-5-mini',
      fallbackModels: ['anthropic/claude-sonnet-5'],
    });
    expect(modelsFor('alt-text')).toEqual({
      model: 'anthropic/claude-haiku-4.5',
      fallbackModels: ['anthropic/claude-sonnet-5'],
    });
  });

  it("overrides one feature's fallback chain and accepts several models in order", () => {
    process.env.AI_MODEL_ALT_TEXT_FALLBACKS =
      'google/gemini-2.5-flash,openai/gpt-5-mini';

    expect(modelsFor('alt-text')).toEqual({
      model: 'anthropic/claude-haiku-4.5',
      fallbackModels: ['google/gemini-2.5-flash', 'openai/gpt-5-mini'],
    });
  });

  it('tolerates spaces and blank entries around the commas', () => {
    process.env.AI_MODEL_POSTING_ADVISER_FALLBACKS =
      '  openai/gpt-5-mini ,, anthropic/claude-sonnet-5  ';

    expect(modelsFor('posting-adviser').fallbackModels).toEqual([
      'openai/gpt-5-mini',
      'anthropic/claude-sonnet-5',
    ]);
  });

  it("treats 'none' and an empty value as an explicit no-fallback", () => {
    // Distinct from unset, which inherits. Without this, a feature's fallback
    // could not be turned off without also editing the kind-wide default.
    for (const value of ['none', 'NONE', '', '   ']) {
      process.env.AI_MODEL_POSTING_ADVISER_FALLBACKS = value;
      expect(modelsFor('posting-adviser')).toEqual({
        model: 'google/gemini-3-flash',
        fallbackModels: [],
      });
    }
  });

  it('lets a blank feature override fall through to the default rather than blanking the model', () => {
    process.env.AI_MODEL_POSTING_ADVISER = '   ';
    expect(modelsFor('posting-adviser').model).toBe('google/gemini-3-flash');
  });
});

describe('ai models: kind-wide defaults', () => {
  it('moves the text feature, leaving vision alone', () => {
    process.env.AI_MODEL_DEFAULT = 'openai/gpt-5-mini';

    expect(modelsFor('posting-adviser').model).toBe('openai/gpt-5-mini');
    expect(modelsFor('alt-text').model).toBe('anthropic/claude-haiku-4.5');
  });

  it('moves the vision default without disturbing the text feature', () => {
    process.env.AI_MODEL_VISION_DEFAULT = 'google/gemini-2.5-flash';

    expect(modelsFor('alt-text').model).toBe('google/gemini-2.5-flash');
    expect(modelsFor('posting-adviser').model).toBe('google/gemini-3-flash');
  });

  it('moves each kind’s fallback chain on its own', () => {
    process.env.AI_MODEL_DEFAULT_FALLBACKS = 'mistral/mistral-small';
    process.env.AI_MODEL_VISION_DEFAULT_FALLBACKS = 'none';

    expect(modelsFor('posting-adviser').fallbackModels).toEqual([
      'mistral/mistral-small',
    ]);
    expect(modelsFor('alt-text').fallbackModels).toEqual([]);
  });

  it('keeps a per-feature override winning over the kind default', () => {
    process.env.AI_MODEL_VISION_DEFAULT = 'google/gemini-2.5-flash';
    process.env.AI_MODEL_ALT_TEXT = 'anthropic/claude-sonnet-5';
    process.env.AI_MODEL_DEFAULT_FALLBACKS = 'mistral/mistral-small';
    process.env.AI_MODEL_POSTING_ADVISER_FALLBACKS = 'openai/gpt-5-mini';

    expect(modelsFor('alt-text').model).toBe('anthropic/claude-sonnet-5');
    expect(modelsFor('posting-adviser').fallbackModels).toEqual([
      'openai/gpt-5-mini',
    ]);
  });
});

describe('ai models: fallback hygiene', () => {
  it('drops a fallback identical to the primary', () => {
    // The Gateway would otherwise retry the model that just failed — a second
    // charge for the same outcome.
    process.env.AI_MODEL_POSTING_ADVISER = 'openai/gpt-5-mini';
    process.env.AI_MODEL_POSTING_ADVISER_FALLBACKS =
      'openai/gpt-5-mini,anthropic/claude-sonnet-5';

    expect(modelsFor('posting-adviser').fallbackModels).toEqual([
      'anthropic/claude-sonnet-5',
    ]);
  });

  it('drops repeats but keeps the configured order', () => {
    process.env.AI_MODEL_POSTING_ADVISER_FALLBACKS =
      'openai/gpt-5-mini,anthropic/claude-sonnet-5,openai/gpt-5-mini';

    expect(modelsFor('posting-adviser').fallbackModels).toEqual([
      'openai/gpt-5-mini',
      'anthropic/claude-sonnet-5',
    ]);
  });

  it('empties the chain when the only fallback is the primary', () => {
    process.env.AI_MODEL_ALT_TEXT = 'anthropic/claude-sonnet-5';

    expect(modelsFor('alt-text')).toEqual({
      model: 'anthropic/claude-sonnet-5',
      fallbackModels: [],
    });
  });
});

describe('ai models: the feature table itself', () => {
  it('covers exactly the two AI features', () => {
    expect(FEATURE_KEYS.slice().sort()).toEqual([
      'alt-text',
      'posting-adviser',
    ]);
  });

  it('declares a kind for every feature', () => {
    expect(FEATURES['alt-text'].kind).toBe('vision');
    expect(FEATURES['posting-adviser'].kind).toBe('text');
  });

  it('throws on an unknown feature instead of guessing a model', () => {
    // A typo in a handler's FEATURE constant must fail loudly here rather
    // than run that handler on some other feature's model.
    expect(() => modelsFor('advise')).toThrow(/Unknown AI feature/);
    expect(() => modelsFor(undefined)).toThrow(/Unknown AI feature/);
    expect(() => modelsFor('toString')).toThrow(/Unknown AI feature/);
  });

  it('matches the FEATURE constant every handler actually passes', () => {
    // The handlers name their feature as a literal string; this is the only
    // thing that catches one drifting from the table (or from the usage
    // dashboard, which is keyed by the same constant). Two handlers share a
    // feature — analyze-post and synthesize-style are both the adviser (same
    // model, same dashboard bucket) — so the mapping is handlers-onto-features.
    const dir = fileURLToPath(new URL('./handlers/', import.meta.url));
    const declared = readdirSync(dir)
      .filter((name) => name.endsWith('.js') && !name.endsWith('.test.js'))
      .map((name) => {
        const source = readFileSync(join(dir, name), 'utf8');
        const match = source.match(/^const FEATURE = '([^']+)';$/m);
        return { name, feature: match && match[1] };
      });

    expect(declared.length).toBe(3);
    for (const { name, feature } of declared) {
      expect(feature, `${name} declares no FEATURE constant`).toBeTruthy();
      expect(
        FEATURE_KEYS,
        `${name} names a feature the table doesn't have`,
      ).toContain(feature);
    }
    // Every table entry is reachable from a handler — no dead rows.
    expect([...new Set(declared.map((d) => d.feature))].sort()).toEqual([
      'alt-text',
      'posting-adviser',
    ]);
  });
});

describe('ai models: describeResolvedModels', () => {
  it('reports the whole table with no warnings when everything is well-formed', () => {
    const { features, warnings } = describeResolvedModels();

    expect(warnings).toEqual([]);
    expect(features).toEqual([
      {
        feature: 'alt-text',
        kind: 'vision',
        model: 'anthropic/claude-haiku-4.5',
        fallbackModels: ['anthropic/claude-sonnet-5'],
      },
      {
        feature: 'posting-adviser',
        kind: 'text',
        model: 'google/gemini-3-flash',
        fallbackModels: ['anthropic/claude-sonnet-5'],
      },
    ]);
  });

  it('names the feature and the value when a model id is malformed', () => {
    // A Gateway id is provider/model. A typo otherwise only shows up as a 502
    // at request time, long after the deploy that caused it.
    process.env.AI_MODEL_POSTING_ADVISER = 'claude-sonnet-5';

    const { warnings } = describeResolvedModels();
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('posting-adviser');
    expect(warnings[0]).toContain('claude-sonnet-5');
  });

  it('flags a malformed fallback too, not just the primary', () => {
    process.env.AI_MODEL_ALT_TEXT_FALLBACKS = 'not a model';

    const { warnings } = describeResolvedModels();
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('alt-text');
  });
});

describe('ai models: the cold-start log', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    resetModelsLogForTests();
  });

  it('logs the table once per instance, and a malformed id as a warning', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    resetModelsLogForTests();
    logResolvedModelsOnce({ AI_MODEL_ALT_TEXT: 'typo' });
    logResolvedModelsOnce({ AI_MODEL_ALT_TEXT: 'typo' });
    expect(info).toHaveBeenCalledTimes(1);
    expect(info.mock.calls[0][0]).toContain(
      'posting-adviser → google/gemini-3-flash',
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('alt-text: "typo"');
  });
});
