/**
 * Post templates: saved replies kept as net.anisota.feed.template records in
 * the account's own repo. The record format is Anisota's, so a template made
 * in either app shows up in the other.
 *
 * A template's text may hold `{{key}}` blanks. Keys under `their.` and `my.`,
 * and `today`, fill themselves from the post being replied to and the signed-in
 * account; every other key is asked for when the template is used. A context
 * key whose context is missing (no display name, or no post being replied to)
 * is asked too, so a template never posts a hole.
 *
 * Everything here is pure: no React, no network, no storage. The record shape
 * is the net.anisota.feed.template lexicon (fields in TEMPLATE_RECORD_FIELDS).
 */

import { countGraphemes } from '../lib/graphemes.js';

export const TEMPLATE_COLLECTION = 'net.anisota.feed.template';

export const TEMPLATE_LIMITS = Object.freeze({
  nameGraphemes: 64,
  textGraphemes: 300,
  groupGraphemes: 64,
  shortcutLength: 32,
  keyLength: 32,
  labelGraphemes: 64,
  hintGraphemes: 200,
  choiceGraphemes: 300,
  variables: 12,
  choices: 12,
  keywords: 20,
  keywordLength: 64,
  langs: 3,
});

export const TEMPLATE_USES = Object.freeze(['any', 'reply', 'post']);

/** The fields the lexicon declares, on a record and on one of its blanks. */
export const TEMPLATE_RECORD_FIELDS = Object.freeze([
  'name',
  'text',
  'variables',
  'embed',
  'use',
  'group',
  'shortcut',
  'keywords',
  'langs',
  'createdAt',
  'updatedAt',
]);
export const TEMPLATE_VARIABLE_FIELDS = Object.freeze([
  'key',
  'label',
  'hint',
  'kind',
  'choices',
  'default',
  'optional',
]);

/** The keys that fill themselves, in the order an editor offers them. */
export const CONTEXT_KEYS = Object.freeze([
  'their.firstName',
  'their.name',
  'their.handle',
  'my.handle',
  'today',
]);

/** Lower-case names for context keys, for blank chips and questions. */
export const CONTEXT_LABELS = Object.freeze({
  'their.firstName': 'their first name',
  'their.name': 'their name',
  'their.handle': 'their handle',
  'my.handle': 'your handle',
  today: "today's date",
});

// The capture is the key; whitespace inside the braces is tolerated.
const BLANK_PATTERN = /\{\{\s*([A-Za-z][\w.-]{0,31})\s*\}\}/g;
const SHORTCUT_PATTERN = /^[a-z0-9-]{1,32}$/;

/** True for keys the client fills from context rather than asking. */
export function isContextKey(key) {
  return (
    typeof key === 'string' &&
    (key.startsWith('their.') || key.startsWith('my.') || key === 'today')
  );
}

/** Unique blank keys in `text`, in first-appearance order. */
export function placeholderKeys(text) {
  const keys = [];
  for (const m of String(text || '').matchAll(BLANK_PATTERN)) {
    if (!keys.includes(m[1])) keys.push(m[1]);
  }
  return keys;
}

/**
 * `text` as alternating literal and blank segments, for rendering a preview
 * without re-parsing: `[{ type: 'text', value }, { type: 'blank', key }, …]`.
 */
export function splitTemplateText(text) {
  const source = String(text || '');
  const out = [];
  let last = 0;
  for (const m of source.matchAll(BLANK_PATTERN)) {
    if (m.index > last)
      out.push({ type: 'text', value: source.slice(last, m.index) });
    out.push({ type: 'blank', key: m[1] });
    last = m.index + m[0].length;
  }
  if (last < source.length)
    out.push({ type: 'text', value: source.slice(last) });
  return out;
}

// The first run of letters, so "🌿 Wren Okafor" gives "Wren".
const FIRST_WORD = /[\p{L}\p{M}][\p{L}\p{M}'’-]*/u;

/**
 * The values context keys can draw on.
 * @param {object} args
 * @param {object} [args.replyTo] the post being replied to (a postView)
 * @param {object} [args.self] the signed-in account: `{ handle }`
 * @param {Date} [args.now]
 * @param {string} [args.locale] for `today`; the runtime's when omitted
 */
export function buildTemplateContext({ replyTo, self, now, locale } = {}) {
  const author = replyTo?.author || null;
  const name =
    typeof author?.displayName === 'string' ? author.displayName.trim() : '';
  const first = name.match(FIRST_WORD)?.[0] || '';
  const date = now instanceof Date ? now : new Date();
  return {
    their: author
      ? {
          name: name || null,
          firstName: first || null,
          handle: author.handle || null,
        }
      : null,
    my: { handle: self?.handle || null },
    today: date.toLocaleDateString(locale, { month: 'long', day: 'numeric' }),
  };
}

/** The value a context key fills with, or null when the context lacks it. */
export function contextValue(key, context) {
  if (!context) return null;
  switch (key) {
    case 'their.firstName':
      return context.their?.firstName || null;
    case 'their.name':
      return context.their?.name || null;
    case 'their.handle':
      return context.their?.handle ? '@' + context.their.handle : null;
    case 'my.handle':
      return context.my?.handle ? '@' + context.my.handle : null;
    case 'today':
      return context.today || null;
    default:
      return null;
  }
}

const capitalise = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * The questions a template asks with this context, in text order. Each is
 * `{ key, label, hint, kind, choices, optional, defaultValue, note, isContext }`.
 */
export function templateQuestions(template, context) {
  const vars = new Map((template?.variables || []).map((v) => [v.key, v]));
  const questions = [];
  for (const key of placeholderKeys(template?.text)) {
    const ctx = isContextKey(key);
    if (ctx && contextValue(key, context) != null) continue;
    const v = vars.get(key) || {};
    const kind =
      v.kind === 'choice' && Array.isArray(v.choices) && v.choices.length
        ? 'choice'
        : 'text';
    let defaultValue = typeof v.default === 'string' ? v.default : '';
    let note = '';
    if (ctx) {
      const handle = context?.their?.handle;
      // their.handle is never missing while there is a post, so only the names land here.
      if (key.startsWith('their.') && handle) {
        if (!defaultValue) defaultValue = capitalise(handle.split('.')[0]);
        note = `@${handle} has no display name, so this is asked. It starts from their handle.`;
      } else if (key.startsWith('their.')) {
        note = "There's no post being replied to, so this is asked.";
      }
    }
    questions.push({
      key,
      label:
        v.label ||
        (ctx ? capitalise(CONTEXT_LABELS[key] || key) : `Fill in “${key}”`),
      hint: v.hint || '',
      kind,
      choices: kind === 'choice' ? v.choices.slice() : [],
      optional: !!v.optional,
      defaultValue,
      note,
      isContext: ctx,
    });
  }
  return questions;
}

/** `{ key: defaultValue }` for every question. */
export function initialAnswers(questions) {
  return Object.fromEntries(
    (questions || []).map((q) => [q.key, q.defaultValue || '']),
  );
}

// An answer, trimmed, or ''. Own properties only, so a blank named
// "constructor" or "valueOf" never fills with Object.prototype's function.
function answerFor(answers, key) {
  if (!answers || typeof answers !== 'object' || !Object.hasOwn(answers, key))
    return '';
  return String(answers[key] ?? '').trim();
}

/** The keys among `questions` that still need an answer. */
export function missingAnswers(questions, answers) {
  return (questions || [])
    .filter((q) => !q.optional && !answerFor(answers, q.key))
    .map((q) => q.key);
}

// Where a blank filled with nothing sits, among parts given to tidyTemplateParts.
const EMPTY_PART = 'empty';
const PUNCTUATION = /[.,;:!?]/;

/**
 * `parts` with the gaps left by blanks that filled with nothing closed, and
 * the ends trimmed. Each part is `{ text, kind, … }`; `{ kind: 'empty' }`
 * marks such a blank. Spaces are dropped only beside an empty blank, so the
 * template's own words keep their spacing (":)", "Bonjour !", indents). Beside
 * an empty blank: before a line end both sides' spaces go; before
 * punctuation the space before the blank goes; at a line start, or with a
 * space on both sides, the space after it goes. Parts keep their other fields;
 * empty blanks, and parts left with no text, are dropped.
 */
export function tidyTemplateParts(parts) {
  const list = (parts || []).filter(Boolean);
  // One entry per code unit, naming its part; `part: -1` is an empty blank.
  const chars = [];
  list.forEach((part, index) => {
    if (part.kind === EMPTY_PART) {
      chars.push({ ch: '', part: -1 });
      return;
    }
    const text = String(part.text ?? '');
    for (let i = 0; i < text.length; i++)
      chars.push({ ch: text[i], part: index });
  });
  const isEmpty = (c) => !!c && c.part < 0;
  const isSpace = (c) => !!c && c.part >= 0 && (c.ch === ' ' || c.ch === '\t');
  const isLineBreak = (c) => !c || c.ch === '\n' || c.ch === '\r';
  const drop = new Array(chars.length).fill(false);

  let i = 0;
  while (i < chars.length) {
    if (!isEmpty(chars[i])) {
      i++;
      continue;
    }
    // A run of empty blanks with only spaces between them closes as one.
    const first = i;
    let last = i;
    let end = i + 1;
    while (end < chars.length && (isEmpty(chars[end]) || isSpace(chars[end]))) {
      if (isEmpty(chars[end])) last = end;
      end++;
    }
    end = last + 1;
    while (end < chars.length && isSpace(chars[end])) end++;
    let start = first;
    while (start > 0 && isSpace(chars[start - 1])) start--;
    for (let k = first; k <= last; k++) drop[k] = true;

    const prev = start > 0 ? chars[start - 1] : null;
    const next = end < chars.length ? chars[end] : null;
    const spaceBefore = start < first;
    const spaceAfter = end > last + 1;
    let dropBefore = false;
    let dropAfter = false;
    if (isLineBreak(next)) {
      dropBefore = true;
      dropAfter = true;
    } else if (PUNCTUATION.test(next.ch)) {
      dropBefore = true;
    } else if (isLineBreak(prev) || (spaceBefore && spaceAfter)) {
      dropAfter = true;
    }
    if (dropBefore) for (let k = start; k < first; k++) drop[k] = true;
    if (dropAfter) for (let k = last + 1; k < end; k++) drop[k] = true;
    i = end;
  }

  const kept = (k) => !drop[k] && !isEmpty(chars[k]);
  let from = 0;
  while (from < chars.length && (!kept(from) || /\s/.test(chars[from].ch)))
    from++;
  let to = chars.length;
  while (to > from && (!kept(to - 1) || /\s/.test(chars[to - 1].ch))) to--;

  const texts = list.map(() => '');
  for (let k = from; k < to; k++)
    if (kept(k)) texts[chars[k].part] += chars[k].ch;
  const out = [];
  list.forEach((part, index) => {
    if (part.kind !== EMPTY_PART && texts[index])
      out.push({ ...part, text: texts[index] });
  });
  return out;
}

// What a blank fills with. A context key the context can fill always takes
// the context's value: it isn't asked (templateQuestions), so an answer left
// from when it was asked has no field to see or change it in.
function filledValue(key, answers, context) {
  if (isContextKey(key)) {
    const value = contextValue(key, context);
    if (value != null) return value;
  }
  return answerFor(answers, key);
}

/** The template's text with every blank filled from context, then answers. */
export function fillTemplate(template, answers, context) {
  const parts = splitTemplateText(template?.text).map((seg) => {
    if (seg.type === 'text') return { text: seg.value, kind: 'text' };
    const value = filledValue(seg.key, answers, context);
    return value
      ? { text: value, kind: 'value' }
      : { text: '', kind: EMPTY_PART };
  });
  return tidyTemplateParts(parts)
    .map((p) => p.text)
    .join('');
}

/**
 * The template's text as preview parts: `{ text, kind, key? }` where kind is
 * `text` (the template's own words), `context` (filled from context),
 * `answer` (filled from an answer) or `blank` (still needs one; `text` is the
 * label to show). An unanswered optional blank renders nothing, and the gap
 * it leaves is closed as fillTemplate closes it, so once every required blank
 * is answered the parts join to fillTemplate's text.
 */
export function templatePreviewParts(template, answers, context) {
  const questions = new Map(
    templateQuestions(template, context).map((q) => [q.key, q]),
  );
  const parts = [];
  for (const seg of splitTemplateText(template?.text)) {
    if (seg.type === 'text') {
      parts.push({ text: seg.value, kind: 'text' });
      continue;
    }
    const q = questions.get(seg.key);
    if (q) {
      const answered = answerFor(answers, seg.key);
      if (answered)
        parts.push({ text: answered, kind: 'answer', key: seg.key });
      else if (!q.optional)
        parts.push({
          text: isContextKey(seg.key)
            ? CONTEXT_LABELS[seg.key] || seg.key
            : seg.key,
          kind: 'blank',
          key: seg.key,
        });
      else parts.push({ text: '', kind: EMPTY_PART, key: seg.key });
      continue;
    }
    // Not asked, so the context fills it (templateQuestions asks the rest).
    parts.push({
      text: contextValue(seg.key, context) ?? '',
      kind: 'context',
      key: seg.key,
    });
  }
  return tidyTemplateParts(parts);
}

/**
 * What a template does, for a one-line description:
 * `{ questions, quotes, fillsContext }`.
 */
export function describeTemplate(template, context) {
  const keys = placeholderKeys(template?.text);
  return {
    questions: templateQuestions(template, context).length,
    quotes: !!template?.embed,
    fillsContext: keys.some(
      (k) => isContextKey(k) && contextValue(k, context) != null,
    ),
  };
}

/** Whether a template is offered when replying (`replying`) or on a new post. */
export function templateOffered(template, { replying }) {
  const use = TEMPLATE_USES.includes(template?.use) ? template.use : 'any';
  return use === 'any' || (replying ? use === 'reply' : use === 'post');
}

// Letters and numbers, with apostrophes only inside a word ("don't").
const WORDS = /[\p{L}\p{N}](?:[\p{L}\p{N}']*[\p{L}\p{N}])?/gu;

// Lower-cased words, with a curly apostrophe read as a straight one. Anything
// else ("#", "-", spaces) only separates words.
const wordsOf = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/’/g, "'")
    .match(WORDS) || [];

// A keyword of four or more characters also matches words it starts.
const wordMatches = (word, keyword) =>
  word === keyword || (keyword.length >= 4 && word.startsWith(keyword));

/**
 * The template's keywords that appear in `text`, case-insensitively. A keyword
 * of four or more characters also matches words it starts, so "reset" finds
 * "resetting". A keyword is split into words as the text is, so "#mothweek"
 * finds "#mothweek" and "mothweek", and "dark mode" or "e-mail" match those
 * words in a row (the last of them may start a longer word).
 */
export function keywordMatches(template, text) {
  const keywords = Array.isArray(template?.keywords) ? template.keywords : [];
  if (!keywords.length || !text) return [];
  const words = wordsOf(text);
  return keywords.filter((kw) => {
    const phrase = wordsOf(kw);
    if (!phrase.length) return false;
    const last = phrase.length - 1;
    for (let i = 0; i + last < words.length; i++) {
      let all = true;
      for (let j = 0; j <= last && all; j++) {
        all =
          j < last
            ? words[i + j] === phrase[j]
            : wordMatches(words[i + j], phrase[j]);
      }
      if (all) return true;
    }
    return false;
  });
}

/** A shortcut as stored: lower case, no leading slash, trimmed. */
export function normalizeShortcut(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^\/+/, '');
}

// Shorter queries match shortcuts only: "/s" and "/j" are tone tags as often
// as they are the start of a shortcut, and nearly every name contains an "s".
const NAME_QUERY_MIN = 3;

/**
 * Templates for a typed `/query`, best first: an exact shortcut, then shortcuts
 * it starts, then (for three characters or more) names containing it.
 * Templates not offered in this context sort after the rest; ties keep the
 * order of `templates`.
 */
export function matchShortcut(
  templates,
  query,
  { replying = false, limit = 5 } = {},
) {
  const q = normalizeShortcut(query);
  const scored = [];
  for (const t of templates || []) {
    const s = normalizeShortcut(t.shortcut);
    let score = -1;
    if (s && s === q) score = 3;
    else if (s && q && s.startsWith(q)) score = 2;
    else if (
      q.length >= NAME_QUERY_MIN &&
      String(t.name || '')
        .toLowerCase()
        .includes(q)
    )
      score = 1;
    else if (!q && s) score = 1;
    if (score < 0) continue;
    if (!templateOffered(t, { replying })) score -= 0.5;
    scored.push({ t, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.t);
}

/** A blank key from a human label: "device type" → "deviceType". */
export function blankKeyFromLabel(label) {
  const words = String(label || '')
    .trim()
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  // A key starts with a letter, so leading numbers are dropped before casing.
  while (words.length && !/^[A-Za-z]/.test(words[0])) words.shift();
  const key = words
    .map((w, i) =>
      i === 0
        ? w.charAt(0).toLowerCase() + w.slice(1)
        : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join('');
  return key.slice(0, TEMPLATE_LIMITS.keyLength);
}

const rkeyOf = (uri) =>
  String(uri || '')
    .split('/')
    .pop() || '';

const clean = (v) => (typeof v === 'string' ? v.trim() : '');

function normalizeVariable(v) {
  if (!v || typeof v.key !== 'string' || !v.key) return null;
  const out = { key: v.key };
  if (clean(v.label)) out.label = clean(v.label);
  if (clean(v.hint)) out.hint = clean(v.hint);
  if (v.kind === 'choice') {
    const choices = (Array.isArray(v.choices) ? v.choices : [])
      .map(clean)
      .filter(Boolean)
      .slice(0, TEMPLATE_LIMITS.choices);
    if (choices.length) {
      out.kind = 'choice';
      out.choices = choices;
    }
  }
  if (clean(v.default)) out.default = clean(v.default);
  if (v.optional === true) out.optional = true;
  return out;
}

/**
 * A listRecords entry as the template the app works with. Unknown `use`
 * values read as `any`, and missing arrays as empty, so a record written by a
 * newer build still loads.
 */
export function normalizeTemplateRecord({ uri, cid, value } = {}) {
  const v = value || {};
  return {
    uri: uri || null,
    cid: cid || null,
    rkey: rkeyOf(uri),
    name: typeof v.name === 'string' ? v.name : '',
    text: typeof v.text === 'string' ? v.text : '',
    variables: (Array.isArray(v.variables) ? v.variables : [])
      .map(normalizeVariable)
      .filter(Boolean),
    embed: v.embed && typeof v.embed === 'object' ? v.embed : null,
    use: TEMPLATE_USES.includes(v.use) ? v.use : 'any',
    group: typeof v.group === 'string' ? v.group : '',
    shortcut:
      typeof v.shortcut === 'string' ? normalizeShortcut(v.shortcut) : '',
    keywords: (Array.isArray(v.keywords) ? v.keywords : []).filter(
      (k) => typeof k === 'string' && k.trim(),
    ),
    langs: Array.isArray(v.langs)
      ? v.langs.filter((l) => typeof l === 'string')
      : [],
    createdAt: typeof v.createdAt === 'string' ? v.createdAt : null,
    updatedAt: typeof v.updatedAt === 'string' ? v.updatedAt : null,
  };
}

/**
 * The record to write for a template. Empty optional fields are left out, and
 * variables are kept only for blanks the text still has.
 * @param {object} template
 * @param {object} [opts]
 * @param {Date} [opts.now]
 * @param {boolean} [opts.isUpdate] stamps `updatedAt`
 */
export function templateToRecord(template, { now, isUpdate = false } = {}) {
  const stamp = (now instanceof Date ? now : new Date()).toISOString();
  const keys = new Set(placeholderKeys(template.text));
  const variables = (template.variables || [])
    .map(normalizeVariable)
    .filter((v) => v && keys.has(v.key) && Object.keys(v).length > 1)
    .slice(0, TEMPLATE_LIMITS.variables);
  const record = {
    $type: TEMPLATE_COLLECTION,
    name: clean(template.name),
    text: String(template.text || ''),
  };
  if (variables.length) record.variables = variables;
  if (template.embed) record.embed = template.embed;
  record.use = TEMPLATE_USES.includes(template.use) ? template.use : 'any';
  if (clean(template.group)) record.group = clean(template.group);
  const shortcut = normalizeShortcut(template.shortcut);
  if (shortcut) record.shortcut = shortcut;
  const keywords = [
    ...new Set(
      (template.keywords || [])
        .map((k) => clean(k).toLowerCase())
        .filter(Boolean),
    ),
  ].slice(0, TEMPLATE_LIMITS.keywords);
  if (keywords.length) record.keywords = keywords;
  const langs = (template.langs || [])
    .filter(Boolean)
    .slice(0, TEMPLATE_LIMITS.langs);
  if (langs.length) record.langs = langs;
  record.createdAt = template.createdAt || stamp;
  if (isUpdate) record.updatedAt = stamp;
  return record;
}

/**
 * Problems with a template about to be saved, as `{ field: message }`; empty
 * when it can be saved. `others` are the account's other templates, for the
 * shortcut clash check.
 */
export function validateTemplate(template, others = []) {
  const errors = {};
  const name = clean(template?.name);
  if (!name) errors.name = 'Give it a name so you can find it later.';
  else if (countGraphemes(name) > TEMPLATE_LIMITS.nameGraphemes)
    errors.name = `Keep the name under ${TEMPLATE_LIMITS.nameGraphemes} characters.`;

  const text = String(template?.text || '');
  if (!text.trim() && !template?.embed)
    errors.text = 'Write some text or choose something to quote.';
  else if (countGraphemes(text) > TEMPLATE_LIMITS.textGraphemes)
    errors.text = 'The text is longer than a post can be.';

  if (countGraphemes(clean(template?.group)) > TEMPLATE_LIMITS.groupGraphemes)
    errors.group = `Keep the group under ${TEMPLATE_LIMITS.groupGraphemes} characters.`;

  const shortcut = normalizeShortcut(template?.shortcut);
  if (shortcut && !SHORTCUT_PATTERN.test(shortcut))
    errors.shortcut = 'Use letters, numbers and dashes only.';
  else if (shortcut) {
    const clash = others.find(
      (t) =>
        t &&
        t.rkey !== template.rkey &&
        normalizeShortcut(t.shortcut) === shortcut,
    );
    if (clash) errors.shortcut = `/${shortcut} already opens “${clash.name}”.`;
  }

  const asked = placeholderKeys(text).filter((k) => !isContextKey(k));
  if (asked.length > TEMPLATE_LIMITS.variables)
    errors.variables = `A template can ask at most ${TEMPLATE_LIMITS.variables} questions.`;
  for (const v of template?.variables || []) {
    if (v?.kind === 'choice' && asked.includes(v.key)) {
      const choices = (v.choices || []).map(clean).filter(Boolean);
      if (!choices.length) {
        errors.variables = `Add at least one choice for “${v.label || v.key}”.`;
        break;
      }
    }
  }

  const keywords = (template?.keywords || []).map(clean).filter(Boolean);
  if (keywords.length > TEMPLATE_LIMITS.keywords)
    errors.keywords = `Use at most ${TEMPLATE_LIMITS.keywords} words.`;
  else if (keywords.some((k) => k.length > TEMPLATE_LIMITS.keywordLength))
    errors.keywords = 'One of the words is too long.';
  // keywordMatches reads only letters and numbers, so this one could never match.
  else if (keywords.some((k) => !wordsOf(k).length))
    errors.keywords = 'Each word needs a letter or a number in it.';
  return errors;
}
