// The adviser's setup for one account (posting settings `adviser`): its
// defaults, a normalizer every reader runs, and turning it on from the
// settings page or the posting hub, which must leave it in the same state.
// The shape is the one the server's /api/ai/analyze-post reads from, so the
// request body needs no translation.

import { normalizeAdviserScope } from './analysis.js';

export const REVIEW_MODES = Object.freeze(['significant', 'always']);

/** How many recent posts a style profile may be learned from. */
export const STYLE_SAMPLE_SIZES = Object.freeze([100, 250, 500]);
export const DEFAULT_STYLE_SAMPLE_SIZE = 100;

// The input limits the settings controls set; the server clips some of these and
// not others, so they are held here.
export const ADVISER_TEXT_LIMITS = Object.freeze({
  topic: 200,
  goalsText: 500,
  writingNotes: 500,
  styleSummary: 1500,
  styleGuidance: 500,
});

function frozenDeep(value) {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) frozenDeep(v);
    Object.freeze(value);
  }
  return value;
}

/**
 * Off, with nothing chosen. `reviewMode: 'significant'` stops a publish only
 * on a real conflict or a writing slip; `checkScope` decides which drafts the
 * pre-publish check covers (the button in the composer ignores it).
 */
export const DEFAULT_ADVISER_SETTINGS = frozenDeep({
  enabled: false,
  checkBeforePublish: false,
  reviewMode: 'significant',
  checkScope: 'all',
  checkReplyContext: false,
  goals: {
    presets: {
      reduceNegativity: false,
      lessConfrontational: false,
      limitTopic: { enabled: false, topic: '' },
    },
    customText: '',
  },
  writingChecks: {
    typos: false,
    grammar: false,
    clarity: false,
    customText: '',
    styleSampleSize: DEFAULT_STYLE_SAMPLE_SIZE,
    styleProfile: {
      summary: '',
      analyzedCount: 0,
      updatedAt: '',
      guidance: '',
    },
  },
});

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const bool = (v) => v === true;
const text = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

/** A sample size from the allowed few, else the default. */
export function normalizeStyleSampleSize(value) {
  const n = Number(value);
  return STYLE_SAMPLE_SIZES.includes(n) ? n : DEFAULT_STYLE_SAMPLE_SIZE;
}

function normalizeStyleProfile(raw) {
  const src = isObject(raw) ? raw : {};
  const count = Math.floor(Number(src.analyzedCount));
  return {
    summary: text(src.summary, ADVISER_TEXT_LIMITS.styleSummary),
    analyzedCount: Number.isFinite(count) && count > 0 ? count : 0,
    updatedAt: typeof src.updatedAt === 'string' ? src.updatedAt : '',
    guidance: text(src.guidance, ADVISER_TEXT_LIMITS.styleGuidance),
  };
}

/**
 * The adviser setup with every field present and of the right kind: anything
 * missing or unreadable reads as its default, so a setup stored by an older
 * or newer build never trips the composer. Text is clipped to the settings'
 * input limits.
 */
export function normalizeAdviserSettings(raw) {
  const src = isObject(raw) ? raw : {};
  const goals = isObject(src.goals) ? src.goals : {};
  const presets = isObject(goals.presets) ? goals.presets : {};
  const topic = isObject(presets.limitTopic) ? presets.limitTopic : {};
  const writing = isObject(src.writingChecks) ? src.writingChecks : {};
  return {
    enabled: bool(src.enabled),
    checkBeforePublish: bool(src.checkBeforePublish),
    reviewMode: REVIEW_MODES.includes(src.reviewMode)
      ? src.reviewMode
      : 'significant',
    checkScope: normalizeAdviserScope(src.checkScope),
    checkReplyContext: bool(src.checkReplyContext),
    goals: {
      presets: {
        reduceNegativity: bool(presets.reduceNegativity),
        lessConfrontational: bool(presets.lessConfrontational),
        limitTopic: {
          enabled: bool(topic.enabled),
          topic: text(topic.topic, ADVISER_TEXT_LIMITS.topic),
        },
      },
      customText: text(goals.customText, ADVISER_TEXT_LIMITS.goalsText),
    },
    writingChecks: {
      typos: bool(writing.typos),
      grammar: bool(writing.grammar),
      clarity: bool(writing.clarity),
      customText: text(writing.customText, ADVISER_TEXT_LIMITS.writingNotes),
      styleSampleSize: normalizeStyleSampleSize(writing.styleSampleSize),
      styleProfile: normalizeStyleProfile(writing.styleProfile),
    },
  };
}

/**
 * True when the adviser has never been configured (no checks, goals or
 * writing checks), so seeding it won't overwrite a choice.
 *
 * @param {object} adviser the stored setup (may be undefined)
 * @returns {boolean}
 */
export function isPostingAdviserPristine(adviser) {
  const a = adviser || {};
  const goals = a.goals || {};
  const presets = goals.presets || {};
  const writing = a.writingChecks || {};
  return (
    !a.checkBeforePublish &&
    !a.checkReplyContext &&
    !presets.reduceNegativity &&
    !presets.lessConfrontational &&
    !(presets.limitTopic && presets.limitTopic.enabled) &&
    !(goals.customText || '').trim() &&
    !writing.typos &&
    !writing.grammar &&
    !writing.clarity &&
    !(writing.customText || '').trim() &&
    !(writing.styleProfile?.summary || '').trim() &&
    !(writing.styleProfile?.guidance || '').trim()
  );
}

/**
 * The full seeded setup: every switch on (the pre-publish check on all posts,
 * reading the conversation, both general goals, all three writing checks,
 * review mode "significant"). Anything that needs the writer's own words
 * stays untouched: the topic limit, custom goals, notes for the proofread and
 * the style profile (learning it costs a request).
 */
function seededPostingAdviserState(current) {
  const goals = current.goals || {};
  const presets = goals.presets || {};
  return {
    ...current,
    enabled: true,
    checkBeforePublish: true,
    checkReplyContext: true,
    reviewMode: 'significant',
    checkScope: 'all',
    goals: {
      ...goals,
      presets: {
        ...presets,
        reduceNegativity: true,
        lessConfrontational: true,
      },
    },
    writingChecks: {
      ...(current.writingChecks || {}),
      typos: true,
      grammar: true,
      clarity: true,
    },
  };
}

/**
 * The next setup for a press of the on/off switch. The first time it is
 * turned on, a setup nobody has touched gets the full recommended one (on
 * alone would only add a button nobody remembers to press); after that it
 * just toggles, so turning it off and on never undoes choices.
 *
 * @param {object} adviser the current setup
 * @returns {object} the whole setup to save
 */
export function nextPostingAdviserState(adviser) {
  const current = adviser || {};
  if (current.enabled || !isPostingAdviserPristine(current)) {
    return { ...current, enabled: !current.enabled };
  }
  return seededPostingAdviserState(current);
}
