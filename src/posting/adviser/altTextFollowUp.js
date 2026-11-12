/**
 * Quick notes for revising a generated alt-text description, and the optional
 * "what kind of image is it?" choice made before the first one
 * (ui/AltTextDialog.jsx).
 *
 * A quick note travels two ways. Its sentence goes into the follow-up note, so
 * the request is in words; its id goes alongside, so cocoon can drop the rule
 * the sentence would otherwise argue with (a "describe" note against the rule
 * that transcribes text-heavy screenshots verbatim). The ids must match
 * ALT_TEXT_PRESETS and ALT_TEXT_KINDS in cocoon's lib/alt-text-prompt.js, which
 * ignores any it doesn't know.
 */

// In the order they wrap on a phone: the long one first, so three rows hold
// all five and "It's a…".
export const ALT_TEXT_QUICK_NOTES = [
  {
    id: 'describe',
    label: "Describe, don't transcribe",
    hint: 'screenshots',
    sentence:
      'Describe what is shown and what is happening instead of transcribing the text.',
  },
  { id: 'shorter', label: 'Shorter', sentence: 'Make it shorter.' },
  {
    id: 'transcribe',
    label: 'Transcribe the text',
    hint: 'posters, notes',
    sentence: 'Transcribe the text word for word.',
  },
  {
    id: 'detail',
    label: 'More detail',
    sentence: 'Add more detail about what is visible.',
  },
  {
    id: 'plain',
    label: 'Plainer words',
    sentence: 'Use plain, everyday words.',
  },
];

// Pairs that can't both be asked for. Choosing one lets go of the other.
const OPPOSITES = {
  describe: 'transcribe',
  transcribe: 'describe',
  shorter: 'detail',
  detail: 'shorter',
};

// The "It's a…" chip starts a correction in the author's own words.
export const ITS_A = "It's a ";

// cocoon caps the whole note at 500 characters. The longest set of quick
// notes that can be on together comes to under 150, so the author's own words
// get 300 and nothing they type is cut off on the way.
export const ALT_TEXT_NOTE_MAX = 300;
export const ALT_TEXT_FOLLOW_UP_MAX = 500;

// `short` is the phone's one-row picker; `label` has room on a desktop.
export const ALT_TEXT_IMAGE_KINDS = [
  { id: 'photo', label: 'Photo', short: 'Photo' },
  {
    id: 'interface',
    label: 'App or website',
    short: 'App or site',
    hint: 'Apps and websites are described, not read out word for word.',
  },
  {
    id: 'chart',
    label: 'Chart or graph',
    short: 'Chart',
    hint: 'Charts are read for their trend and key values.',
  },
  {
    id: 'text',
    label: 'Mostly text',
    short: 'Text',
    hint: 'The text is transcribed word for word.',
  },
];

const KNOWN_NOTES = new Set(ALT_TEXT_QUICK_NOTES.map((n) => n.id));
const KNOWN_KINDS = new Set(ALT_TEXT_IMAGE_KINDS.map((k) => k.id));

/** The selection after tapping `id`: on if it was off (letting go of its opposite), else off. */
export function toggleQuickNote(selected, id) {
  if (!KNOWN_NOTES.has(id)) return selected;
  if (selected.includes(id)) return selected.filter((s) => s !== id);
  const opposite = OPPOSITES[id];
  return ALT_TEXT_QUICK_NOTES.map((n) => n.id).filter(
    (n) => n === id || (selected.includes(n) && n !== opposite),
  );
}

/** Known quick-note ids, in list order. */
export function quickNoteIds(selected) {
  return ALT_TEXT_QUICK_NOTES.map((n) => n.id).filter((id) =>
    selected.includes(id),
  );
}

/**
 * The follow-up note sent to cocoon: each chosen quick note's sentence, in list
 * order, then the author's own words. Empty when there's nothing to send.
 */
export function composeFollowUp(selected, note) {
  const sentences = ALT_TEXT_QUICK_NOTES.filter((n) =>
    selected.includes(n.id),
  ).map((n) => n.sentence);
  const own = (note || '').trim().slice(0, ALT_TEXT_NOTE_MAX);
  return [...sentences, own]
    .filter(Boolean)
    .join(' ')
    .slice(0, ALT_TEXT_FOLLOW_UP_MAX);
}

/** Whether anything is waiting to be sent: a quick note or some words. */
export function hasFollowUpDraft(selected, note) {
  return selected.length > 0 || !!(note || '').trim();
}

/** The note after tapping "It's a…": started, or added to what's there. */
export function appendItsA(note) {
  const current = note || '';
  if (!current.trim()) return ITS_A;
  return `${current.replace(/\s+$/, '')} ${ITS_A}`.slice(0, ALT_TEXT_NOTE_MAX);
}

/** For the "Revising: …" line: the chosen quick notes in lower case, and the note. */
export function describeRequest(selected, note) {
  const parts = ALT_TEXT_QUICK_NOTES.filter((n) => selected.includes(n.id)).map(
    (n) => n.label.toLowerCase(),
  );
  const hasOwn = !!(note || '').trim();
  if (parts.length === 0) return hasOwn ? 'your note' : '';
  return hasOwn ? `${parts.join(', ')}, plus your note` : parts.join(', ');
}

/** A known image kind, else null. */
export function normalizeImageKind(kind) {
  return KNOWN_KINDS.has(kind) ? kind : null;
}

/**
 * Whether a description reads as a transcript of the image's text rather than
 * a description of it: mostly short fragments ("Settings. Account. Display
 * name: Sam.") or a run of "label: value" pairs. A heuristic, so it only ever
 * decides which quick notes are offered, never what's sent.
 */
export function looksTranscribed(text) {
  const fragments = (text || '')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((f) => f.trim())
    .filter(Boolean);
  if (fragments.length < 4) return false;
  const short = fragments.filter((f) => f.split(/\s+/).length <= 4).length;
  const pairs = ((text || '').match(/\w:\s/g) || []).length;
  return short / fragments.length >= 0.5 || pairs >= 3;
}

/**
 * The quick notes worth offering for a description, most useful first, with
 * those that make no sense for it left out: "Describe, don't transcribe" only
 * for something that reads as a transcript, "Transcribe the text" never for a
 * transcript, a photo or a chart, "Shorter" not for a short description and
 * "More detail" not for a very long one. Context is the description as it was
 * generated (edits don't reshuffle the chips under the author's thumb), the
 * kind of image the author chose, and the quick notes the last revision used.
 *
 * @param {{ text?: string, kind?: string|null, lastAsked?: string[] }} context
 * @returns {{ id: string, score: number }[]} best first; a score of 1 or more
 *   is worth a place on the card, the rest only in the sheet
 */
export function rankQuickNotes({
  text = '',
  kind = null,
  lastAsked = [],
} = {}) {
  const length = (text || '').trim().length;
  const transcript =
    lastAsked.includes('transcribe') ||
    (!lastAsked.includes('describe') &&
      (kind === 'text' || looksTranscribed(text)));
  const scores = {
    describe: transcript ? 3 : null,
    transcribe:
      transcript || kind === 'photo' || kind === 'chart'
        ? null
        : kind === 'text'
          ? 2
          : kind === 'interface'
            ? 1.1
            : 0.5,
    shorter:
      length < 100 ? null : length > 350 ? 2.5 : length > 160 ? 1.5 : 0.5,
    detail: length > 700 ? null : length < 140 ? 2.5 : length < 400 ? 1.2 : 0.4,
    plain: 1,
  };
  return ALT_TEXT_QUICK_NOTES.map((n, index) => ({
    id: n.id,
    score: scores[n.id],
    index,
  }))
    .filter((n) => n.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ id, score }) => ({ id, score }));
}

// How many quick notes the card shows under the description.
export const CARD_QUICK_NOTES = 3;

/** The few quick notes for the card: the best of the ranking, if they're good enough. */
export function cardQuickNotes(ranked) {
  return ranked
    .filter((n) => n.score >= 1)
    .slice(0, CARD_QUICK_NOTES)
    .map((n) => n.id);
}
