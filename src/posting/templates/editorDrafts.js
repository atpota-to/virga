/**
 * The template editor's drafts: a template as the form holds it (keywords
 * and choices as text, the quote as a mode), and back; and a draft made from
 * the reply being written ("Save this reply as a template").
 *
 * Pure: no React, no network, no storage.
 */

import {
  isContextKey,
  normalizeShortcut,
  placeholderKeys,
} from './postTemplates.js';

const POST_COLLECTION = 'app.bsky.feed.post';
const FEED_COLLECTION = 'app.bsky.feed.generator';
const LIST_COLLECTION = 'app.bsky.graph.list';
const RECORD_EMBED = 'app.bsky.embed.record';
const EXTERNAL_EMBED = 'app.bsky.embed.external';

const str = (v) => (typeof v === 'string' ? v : '');

function collectionOf(uri) {
  const m = /^at:\/\/[^/]+\/([^/]+)\/[^/?#]+$/.exec(str(uri));
  return m ? m[1] : null;
}

/**
 * The kind of thing a template's embed attaches, as the composer sees it:
 * 'post' | 'feed' | 'list' | 'link', 'unsupported' for an embed the composer
 * can't attach from a record (images, a quote with media), or null for none.
 */
export function templateEmbedKind(embed) {
  if (!embed || typeof embed !== 'object') return null;
  if (embed.$type === RECORD_EMBED) {
    const collection = collectionOf(embed.record?.uri);
    if (collection === POST_COLLECTION) return 'post';
    if (collection === FEED_COLLECTION) return 'feed';
    if (collection === LIST_COLLECTION) return 'list';
    return 'unsupported';
  }
  if (embed.$type === EXTERNAL_EMBED && str(embed.external?.uri)) return 'link';
  // Images and recordWithMedia round-trip in the record, but the composer has
  // no way to attach a stored blob, so they are not offered.
  return 'unsupported';
}

/** A template with nothing in it, the editor's starting point. */
export const BLANK_TEMPLATE = Object.freeze({
  uri: null,
  cid: null,
  rkey: '',
  name: '',
  text: '',
  variables: [],
  embed: null,
  use: 'any',
  group: '',
  shortcut: '',
  keywords: [],
  langs: [],
  createdAt: null,
  updatedAt: null,
});

function draftVariable(v) {
  const choices = Array.isArray(v?.choices)
    ? v.choices.filter((c) => typeof c === 'string')
    : [];
  return {
    label: '',
    hint: '',
    kind: 'text',
    default: '',
    optional: false,
    ...v,
    choices,
    choicesText:
      typeof v?.choicesText === 'string' ? v.choicesText : choices.join('\n'),
  };
}

/**
 * The draft's variables brought in line with its text, in text order: an
 * entry for every asked blank (kept, or made empty), a context key's entry
 * where it has one, then any other entries the draft already had, so a blank
 * deleted and retyped keeps its question until the draft is saved.
 */
export function syncDraftVariables(draft) {
  const existing = new Map(
    (draft?.variables || []).filter((v) => v?.key).map((v) => [v.key, v]),
  );
  const variables = [];
  const placed = new Set();
  for (const key of placeholderKeys(draft?.text)) {
    const v = existing.get(key) || (isContextKey(key) ? null : { key });
    if (!v) continue;
    variables.push(draftVariable(v));
    placed.add(key);
  }
  for (const [key, v] of existing)
    if (!placed.has(key)) variables.push(draftVariable(v));
  return { ...draft, variables };
}

function quoteFields(embed) {
  const kind = templateEmbedKind(embed);
  if (!kind) return { quoteMode: 'none', quoteUrl: '' };
  if (kind === 'post') return { quoteMode: 'post', quoteUrl: '' };
  if (kind === 'link')
    return { quoteMode: 'link', quoteUrl: str(embed.external?.uri) };
  // A feed or list is attached by pasting its link.
  if (kind === 'feed' || kind === 'list')
    return { quoteMode: 'link', quoteUrl: '' };
  // Images and the like, which the editor can't show but saving must keep.
  return { quoteMode: 'other', quoteUrl: '' };
}

/**
 * A template as the editor's draft: the template plus `keywordsText`
 * (comma-separated), `choicesText` on each variable (one choice per line),
 * `quoteMode` ('none' | 'post' | 'link', or 'other' for an embed the editor
 * can't show), `quoteUrl` and `quoteView`. With no template, a blank draft.
 */
export function draftFromTemplate(template) {
  const base = { ...BLANK_TEMPLATE, ...(template || {}) };
  return syncDraftVariables({
    ...base,
    variables: (base.variables || []).map(draftVariable),
    keywords: (base.keywords || []).slice(),
    langs: (base.langs || []).slice(),
    keywordsText: (base.keywords || []).join(', '),
    ...quoteFields(base.embed),
    quoteView: null,
  });
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Text a first name inside must stay as written: links, email addresses,
// handles and hashtags.
const NAME_PROTECTED =
  /https?:\/\/\S+|[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+|@[\p{L}\p{N}._-]+|#[\p{L}\p{N}_]+/giu;

/**
 * A draft from the reply being written, for "Save this reply as a template".
 * The replied-to author's first name, wherever it stands as a whole word,
 * becomes `{{their.firstName}}`, so the template greets whoever it answers
 * next; not inside a link, an email address, a handle, a hashtag or a bare
 * domain ("wren.blog"). The attached record (or, failing that, the link card)
 * becomes its quote.
 *
 * Takes the composer's own shapes (`reply`, a post's `record` and `card`)
 * as well as bare ones (`replyTo`, `recordEmbed`, `linkUrl`). Take a
 * "/shortcut" that opened the library out of `text` first
 * (replyTextWithoutSlash in library/model.js).
 *
 * @param {object} args
 * @param {string} args.text the composer's text
 * @param {object} [args.reply] ComposerState.reply, or `replyTo`, a post view
 * @param {{ uri: string, cid: string }} [args.record] the post's record, or `recordEmbed`
 * @param {{ url: string }} [args.card] the post's link card, or `linkUrl`
 * @returns {{ draft: object, note: string | null }}
 */
export function draftFromReply({
  text,
  reply,
  replyTo = reply,
  record,
  recordEmbed = record,
  card,
  linkUrl = card?.url,
} = {}) {
  let body = str(text).replace(/\s+$/, '');
  let note = null;
  const name = str(replyTo?.author?.displayName).trim();
  const first = name.match(/[\p{L}\p{M}][\p{L}\p{M}'’-]*/u)?.[0] || '';
  if (first) {
    // Not part of a longer word, a path, a handle or a domain; a sentence's
    // full stop after the name is fine.
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{M}\\p{N}_@#/-])(?<![\\p{L}\\p{N}]\\.)${escapeRegExp(first)}(?![\\p{L}\\p{M}\\p{N}_@/-])(?!\\.[\\p{L}\\p{N}])`,
      'gu',
    );
    const spans = [...body.matchAll(NAME_PROTECTED)].map((m) => [
      m.index,
      m.index + m[0].length,
    ]);
    const protectedAt = (at) =>
      spans.some(([from, to]) => at < to && at + first.length > from);
    const replaced = body.replace(pattern, (match, offset) =>
      protectedAt(offset) ? match : '{{their.firstName}}',
    );
    if (replaced !== body) {
      body = replaced;
      note = `“${first}” became a blank that fills in with the first name of whoever you reply to.`;
    }
  }

  let embed = null;
  if (recordEmbed?.uri && recordEmbed?.cid) {
    embed = {
      $type: RECORD_EMBED,
      record: { uri: recordEmbed.uri, cid: recordEmbed.cid },
    };
  } else if (str(linkUrl)) {
    embed = {
      $type: EXTERNAL_EMBED,
      external: { uri: linkUrl, title: '', description: '' },
    };
  }

  const draft = draftFromTemplate({
    ...BLANK_TEMPLATE,
    text: body,
    embed,
    use: 'reply',
  });
  return { draft, note };
}

const splitList = (value, separator) =>
  str(value)
    .split(separator)
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * The template a draft describes: keywords and choices split from their
 * text fields, the shortcut without its slash, and variables kept only for
 * blanks the text still asks. A choice question with no choices stays a
 * choice question, so validateTemplate can say so.
 */
export function templateFromDraft(draft) {
  const d = draft || {};
  // A context key's entry is kept too: it labels the question asked when the
  // context is missing.
  const keys = new Set(placeholderKeys(d.text));

  const variables = [];
  for (const v of d.variables || []) {
    if (!v?.key || !keys.has(v.key)) continue;
    const out = { key: v.key };
    if (str(v.label).trim()) out.label = v.label.trim();
    if (str(v.hint).trim()) out.hint = v.hint.trim();
    if (v.kind === 'choice') {
      out.kind = 'choice';
      out.choices =
        typeof v.choicesText === 'string'
          ? splitList(v.choicesText, '\n')
          : (v.choices || [])
              .map(str)
              .map((c) => c.trim())
              .filter(Boolean);
    }
    if (str(v.default).trim()) out.default = v.default.trim();
    if (v.optional === true) out.optional = true;
    if (Object.keys(out).length > 1) variables.push(out);
  }

  const seenKeywords = new Set();
  const keywords = [];
  const keywordSource =
    typeof d.keywordsText === 'string'
      ? splitList(d.keywordsText, /[,\n]/)
      : d.keywords || [];
  for (const k of keywordSource) {
    const lower = k.toLowerCase();
    if (seenKeywords.has(lower)) continue;
    seenKeywords.add(lower);
    keywords.push(k);
  }

  let embed = d.embed || null;
  if (d.quoteMode === 'none') embed = null;

  return {
    uri: d.uri || null,
    cid: d.cid || null,
    rkey: d.rkey || '',
    name: str(d.name),
    text: str(d.text),
    variables,
    embed,
    use: d.use || 'any',
    group: str(d.group),
    shortcut: normalizeShortcut(d.shortcut),
    keywords,
    langs: Array.isArray(d.langs) ? d.langs.slice() : [],
    createdAt: d.createdAt || null,
    updatedAt: d.updatedAt || null,
  };
}
