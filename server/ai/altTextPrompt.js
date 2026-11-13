/**
 * Alt-text prompt
 *
 * The instruction behind /api/ai/alt-text, kept apart from the handler
 * (handlers/altText.js) so it can be tested on its own.
 *
 * Alt text is the odd one out among the AI features: it is the only vision
 * feature and the only one that returns prose rather than JSON, so a human has
 * to read its output to judge it.
 *
 * Pure module: no network, no Supabase, no config.
 */

import { THINKING_ALLOWANCE } from './models.js';

const ALT_TEXT_MAX = 1000;

// Room for the description itself: ALT_TEXT_MAX characters is about 330 tokens
// on a dense tokenizer. A thinking model thinks out of the same allowance
// before it writes anything (DeepSeek V4.1 Flash has spent 300 of 400 that
// way), so the ceiling sent adds THINKING_ALLOWANCE. It is a ceiling, not a
// reservation.
const ALT_TEXT_TOKENS = 400;

// ATProto images are compressed client-side to <~1MB; base64 inflates ~33%.
// Cap the payload to protect the function from oversized requests. Vercel
// refuses a request body over 4.5 MB with its own non-JSON 413 before the
// handler runs, so the cap sits under that: an image near it is answered here.
const MAX_BASE64_BYTES = 4 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const MAX_CONTEXT = 500;
const MAX_FOLLOW_UP = 500;

// The composer's quick notes, by id. The note already says what the author
// wants in words, which is all a backend without these ids reads; an id is what
// lets the rules below stop contradicting it. "describe" against the verbatim
// rule is the case that matters: a screenshot of an app reads as "primarily
// text", and the rule would keep transcribing it whatever the note asked.
const ALT_TEXT_PRESETS = [
  'describe',
  'transcribe',
  'shorter',
  'detail',
  'plain',
];

// What the author says the image is, chosen before the first description.
const ALT_TEXT_KINDS = ['photo', 'interface', 'chart', 'text'];

const KIND_LINES = {
  photo: 'The author says this is a photograph.',
  interface:
    'The author says this is a screenshot of an app or website: say what kind of screen it is and what it shows or what is happening on it.',
  chart: 'The author says this is a chart or graph.',
  text: 'The author says this image is mostly text.',
};

// How text in the image is treated. `auto` is the long-standing rule pair: a
// text-dominant image is transcribed verbatim, anything else gets its short
// labels transcribed.
const TEXT_RULES = {
  auto: [
    // Text-dominant images (screenshots of text, paragraphs, articles,
    // documents, chats, code) must be transcribed verbatim, not summarized —
    // a screen-reader user needs the actual words, not a description of them.
    'if the image is primarily text — a screenshot of text, a paragraph, an article, a document, a chat, or code — transcribe the text word for word (verbatim), preserving the exact wording; do NOT summarize, paraphrase, or describe it, and add only a brief note of essential visual context if needed;',
    'otherwise, transcribe any short, legible text that appears in the image (labels, signs, captions);',
  ],
  transcribe: [
    'transcribe all legible text in the image word for word (verbatim), in reading order, preserving the exact wording; do NOT summarize or paraphrase it, and add only a brief note of essential visual context if needed;',
  ],
  describe: [
    'describe what the image shows and what is happening in it rather than transcribing its text; do NOT read the text out word for word, and quote only the few words a reader needs to follow it (a title, a key label or value);',
  ],
  chart: [
    'say what kind of chart or graph it is, what it measures, and its main trend or takeaway with the key values; do NOT list every label or tick;',
  ],
};

// People are described by what can be seen. Gender, pronouns, race and
// ethnicity can't be read off a photo, and a wrong guess misgenders or
// mislabels a real person in front of everyone who reads the post. Skin color
// is listed because it is the ethnicity guess under another name. Only the
// author can say who someone is, so a word for a person comes from the post or
// the note. Animals are outside it (a male cardinal's plumage is visible), and
// so is text in the image, which a transcription keeps as written.
const PEOPLE_RULE =
  'when there are people, describe them only by what can be seen (hair, glasses, clothing, expression, pose, what they are doing), refer to them as "a person", "someone", "people" or "a child", and use "they" and "their"; do NOT state or guess anyone\'s gender, pronouns, race, ethnicity or skin color (never "man", "woman", "boy", "girl", "he", "she", "his" or "her"), since none of these can be known from how someone looks; use a name, a pronoun or a word like "mother" or "husband" for someone only when the post context or the author\'s note gives it; this is about describing people, not about text in the image, which is transcribed as written;';

// A revision of a description that already guesses (one written before
// PEOPLE_RULE, or typed by the author) would carry the guess forward under a
// note like "shorter" that never asks to change it. The author's own word
// survives when the post or the note says it.
const PEOPLE_REVISION_LINE =
  "Where the previous alt text says or guesses anyone's gender, pronouns, race, ethnicity or skin color and neither the post context nor the author's note gives it, replace those words.";

/** Known preset ids from a request body, in a stable order; anything else is dropped. */
function normalizePresets(presets) {
  if (!Array.isArray(presets)) return [];
  return ALT_TEXT_PRESETS.filter((id) => presets.includes(id));
}

/** A known image kind from a request body, else null. */
function normalizeKind(kind) {
  return typeof kind === 'string' && ALT_TEXT_KINDS.includes(kind)
    ? kind
    : null;
}

// A quick note outranks the kind: the kind was chosen before the author saw a
// description, the note after.
function textModeFor(presets, kind) {
  if (presets.includes('transcribe')) return 'transcribe';
  if (presets.includes('describe')) return 'describe';
  if (kind === 'text') return 'transcribe';
  if (kind === 'interface') return 'describe';
  if (kind === 'chart') return 'chart';
  return 'auto';
}

/**
 * Build the single instruction string that rides alongside the image.
 *
 * Two shapes come out of here: a fresh description, and a revision steered by
 * the author's note on what to change. The formatting rules are shared, so a
 * revision is held to the same length rules, the same way of describing people
 * (PEOPLE_RULE, whatever the kind or note), and the same treatment of text in
 * the image, which a quick note or the image's kind can change (TEXT_RULES).
 *
 * @param {Object} opts
 * @param {string} [opts.context] - the post's text, for disambiguation
 * @param {string} [opts.followUp] - the author's note; its presence selects the revision shape
 * @param {string} [opts.previousAltText] - the description being revised
 * @param {string[]} [opts.presets] - quick-note ids (ALT_TEXT_PRESETS); unknown ids are ignored
 * @param {string} [opts.kind] - what the author says the image is (ALT_TEXT_KINDS)
 * @returns {{ instruction: string, isRefine: boolean, textMode: string, maxTokens: number, temperature: number }}
 */
function buildAltTextInstruction({
  context,
  followUp,
  previousAltText,
  presets,
  kind,
} = {}) {
  const knownPresets = normalizePresets(presets);
  const knownKind = normalizeKind(kind);
  const textMode = textModeFor(knownPresets, knownKind);

  // Shared formatting rules for both a fresh description and a revision.
  const rules = [
    'Rules: describe what is actually visible; lead with the most important content;',
    'do NOT start with "image of" or "photo of";',
    PEOPLE_RULE,
    ...TEXT_RULES[textMode],
    textMode === 'auto' || textMode === 'transcribe'
      ? `keep it under ${ALT_TEXT_MAX} characters (if the text runs longer than this, transcribe verbatim from the beginning until you reach the limit);`
      : `keep it under ${ALT_TEXT_MAX} characters;`,
    'return only the alt text with no quotes or preamble.',
    context && typeof context === 'string'
      ? `Post context (optional): ${context.slice(0, MAX_CONTEXT)}`
      : '',
  ];

  // A follow-up: the author saw the first description and gave a note on what
  // to change. Steer a revision off that note (and the prior text) instead of
  // describing from scratch. Cap both free-text fields defensively.
  const note =
    typeof followUp === 'string' ? followUp.trim().slice(0, MAX_FOLLOW_UP) : '';
  const priorAlt =
    typeof previousAltText === 'string'
      ? previousAltText.trim().slice(0, ALT_TEXT_MAX)
      : '';
  const isRefine = note.length > 0;

  const instruction = (
    isRefine
      ? [
          "Revise the alt text for this image using the author's note so it more accurately describes what is shown.",
          priorAlt ? `Previous alt text: "${priorAlt}".` : '',
          `Author's note on what to change: ${note}`,
          priorAlt ? PEOPLE_REVISION_LINE : '',
          knownKind ? KIND_LINES[knownKind] : '',
          ...rules,
        ]
      : [
          'Write clear, accurate alt text for this image so a screen-reader user understands it.',
          knownKind ? KIND_LINES[knownKind] : '',
          ...rules,
        ]
  )
    .filter(Boolean)
    .join(' ');

  return {
    instruction,
    isRefine,
    textMode,
    maxTokens: ALT_TEXT_TOKENS + THINKING_ALLOWANCE,
    temperature: 0.2,
  };
}

/** Normalize a raw model response into clean, length-capped alt text. */
function toAltText(content) {
  let t = (content || '').trim().replace(/^["']|["']$/g, '');
  if (t.length > ALT_TEXT_MAX) t = t.slice(0, ALT_TEXT_MAX).trim();
  return t;
}

export {
  ALT_TEXT_MAX,
  ALT_TEXT_TOKENS,
  ALT_TEXT_PRESETS,
  ALT_TEXT_KINDS,
  MAX_BASE64_BYTES,
  ALLOWED_MIME,
  buildAltTextInstruction,
  toAltText,
};
