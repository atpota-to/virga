// The template editor's form logic, outside React: putting a blank in at the
// caret, naming a new blank from its question, telling whether the form has
// changes worth asking about, and which problems to show.

import {
  CONTEXT_LABELS,
  blankKeyFromLabel,
  isContextKey,
  placeholderKeys,
  validateTemplate,
} from '../templates/postTemplates.js';
import { syncDraftVariables, templateFromDraft } from '../templates/editorDrafts.js';

/** Where a template is offered, as the editor's choice. */
export const USE_OPTIONS = Object.freeze([
  { value: 'reply', label: 'Replying' },
  { value: 'post', label: 'A new post' },
  { value: 'any', label: 'Either' },
]);

/** The context blanks the editor offers to put in, with their buttons' words. */
export const CONTEXT_INSERTS = Object.freeze([
  { key: 'their.firstName', label: 'Their first name' },
  { key: 'their.handle', label: 'Their handle' },
  { key: 'my.handle', label: 'Your handle' },
  { key: 'today', label: 'Today’s date' },
]);

/**
 * `token` put in `text` over the selection `[start, end)` (the end of the
 * text without one), with a space either side where it would otherwise run
 * into a word. Returns `{ text, caret }`, the caret after the token.
 */
export function insertAtSelection(text, token, selection) {
  const source = String(text ?? '');
  const len = source.length;
  let start = Number.isFinite(selection?.start) ? Math.max(0, Math.min(selection.start, len)) : len;
  let end = Number.isFinite(selection?.end) ? Math.max(0, Math.min(selection.end, len)) : start;
  if (end < start) [start, end] = [end, start];
  const before = source.slice(0, start);
  const after = source.slice(end);
  const lead = before && !/\s$/.test(before) ? ' ' : '';
  const trail = after && !/^[\s.,;:!?)]/.test(after) ? ' ' : '';
  const next = before + lead + token + trail + after;
  return { text: next, caret: (before + lead + token).length };
}

/**
 * A new blank asked with `label` ("Which app?"), put in at the selection:
 * `{ draft, caret, key }`, or null when the label gives no usable key. A key
 * the template already uses gets a number, so two questions never share an
 * answer by accident.
 */
export function addBlank(draft, label, selection) {
  const base = blankKeyFromLabel(label);
  if (!base || isContextKey(base)) return null;
  const used = new Set([...placeholderKeys(draft?.text), ...(draft?.variables || []).map((v) => v?.key)]);
  let key = base;
  for (let n = 2; used.has(key); n++) key = `${base.slice(0, 30)}${n}`;
  const { text, caret } = insertAtSelection(draft?.text, `{{${key}}}`, selection);
  const synced = syncDraftVariables({ ...draft, text });
  const variables = synced.variables.map((v) => (v.key === key ? { ...v, label: String(label).trim() } : v));
  return { draft: { ...synced, variables }, caret, key };
}

/** The draft with `key`'s question changed by `patch`. */
export function patchVariable(draft, key, patch) {
  return {
    ...draft,
    variables: (draft?.variables || []).map((v) => (v.key === key ? { ...v, ...patch } : v)),
  };
}

/** The blanks the text asks, in order, split into asked questions and the ones that fill themselves. */
export function blanksIn(draft) {
  const keys = placeholderKeys(draft?.text);
  const byKey = new Map((draft?.variables || []).map((v) => [v.key, v]));
  return {
    asked: keys.filter((k) => !isContextKey(k)).map((k) => byKey.get(k) || { key: k }),
    context: keys.filter(isContextKey).map((k) => ({ key: k, label: CONTEXT_LABELS[k] || k })),
  };
}

// What saving would write, for comparing two states of the form.
function signature(draft) {
  const t = templateFromDraft(draft || {});
  return JSON.stringify([t.name, t.text, t.variables, t.embed, t.use, t.group, t.shortcut, t.keywords]);
}

/** Whether the form would save something other than what it started from. */
export function editorHasChanges(initial, draft) {
  return signature(initial) !== signature(draft);
}

/**
 * The problems to show beside the form, `{ field: message }`: the
 * template's own (validateTemplate, against the account's other templates),
 * plus one for a link pasted to attach that hasn't been read yet.
 */
export function editorProblems(draft, others = []) {
  const template = templateFromDraft(draft || {});
  const problems = validateTemplate(template, others);
  if (draft?.quoteMode === 'link' && String(draft.quoteUrl || '').trim() && !draft.embed) {
    problems.quote = 'Read the link first, or clear it.';
  }
  return problems;
}
