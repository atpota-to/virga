// The alt-text dialog's decisions (ui/AltTextDialog.jsx), kept pure: the
// length limit, what a description or a revision asks cocoon for, what the
// dialog holds after an answer, and the allowance line.

import { countGraphemes } from '../lib/graphemes.js';
import {
  composeFollowUp,
  describeRequest,
  normalizeImageKind,
  quickNoteIds,
} from './altTextFollowUp.js';
import { adviserUsageLine } from './usage.js';

/** Bluesky's limit on an image's description. */
export const ALT_TEXT_MAX_GRAPHEMES = 2000;

/** cocoon clips a description to this, so a longer one never comes back. */
export const GENERATED_ALT_MAX = 1000;

/** The post's text sent along as context, at most. */
export const ALT_CONTEXT_MAX = 500;

/** The count under the field: "120 of 2000", and whether it's over. */
export function altTextCount(text) {
  const count = countGraphemes(String(text || ''));
  return {
    count,
    over: count > ALT_TEXT_MAX_GRAPHEMES,
    label: `${count.toLocaleString('en-US')} of ${ALT_TEXT_MAX_GRAPHEMES.toLocaleString('en-US')}`,
  };
}

/**
 * What generateAltTextForFile is asked for. 'describe' writes a first
 * description; 'revise' sends the writer's notes against the text in the
 * field. Null when a revision has nothing to say.
 *
 * @param {object} input
 * @param {'describe'|'revise'} input.mode
 * @param {string} input.alt - the text in the field now
 * @param {string[]} [input.selected] - quick-note ids
 * @param {string} [input.note] - the writer's own words
 * @param {string|null} [input.kind] - what the writer says the image is
 * @param {string} [input.context] - the post's text
 */
export function altGenerationRequest({
  mode,
  alt = '',
  selected = [],
  note = '',
  kind = null,
  context = '',
} = {}) {
  const opts = {};
  const k = normalizeImageKind(kind);
  if (k) opts.kind = k;
  const ctx = String(context || '').trim();
  if (ctx) opts.context = ctx.slice(0, ALT_CONTEXT_MAX);
  if (mode !== 'revise') return opts;
  const followUp = composeFollowUp(selected, note);
  if (!followUp) return null;
  const previous = String(alt || '').trim();
  return {
    ...opts,
    followUp,
    ...(previous ? { previousAltText: previous } : {}),
    presets: quickNoteIds(selected),
  };
}

/**
 * What the dialog holds once a description comes back: the new text, the
 * text it replaced (for Undo; null when that was empty), the description the
 * quick notes are ranked against, and what the last revision asked for.
 * Null for an empty answer, which leaves everything as it was.
 */
export function afterGeneration({
  before = '',
  generated = '',
  mode,
  selected = [],
}) {
  const text = String(generated || '')
    .trim()
    .slice(0, GENERATED_ALT_MAX);
  if (!text) return null;
  return {
    alt: text,
    undo: String(before || '').trim() ? before : null,
    rankedAgainst: text,
    lastAsked: mode === 'revise' ? quickNoteIds(selected) : [],
    revised: mode === 'revise',
  };
}

/** "Revising: shorter, plus your note", for the busy line. */
export function revisingLine(selected, note) {
  const what = describeRequest(selected, note);
  return what ? `Revising: ${what}` : 'Revising';
}

/** The month's descriptions in a sentence, or ''. */
export function altTextUsageLine(usage, { now } = {}) {
  const line = adviserUsageLine(usage, {
    feature: 'altText',
    ...(now ? { now } : {}),
  });
  if (!line) return '';
  const left = Math.max(0, (usage?.limit || 0) - (usage?.used || 0));
  return left > 0 ? `${line} Each revision uses one.` : line;
}
