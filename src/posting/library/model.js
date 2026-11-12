/**
 * The embed library's model: the items on each shelf, suggestions for a
 * reply, local search, what using an item would do to the post (preview) and
 * what the composer should then do (plan), "/shortcut" detection, and
 * inserting text at the caret.
 *
 * Pure: no React, no network, no storage. The reads behind the shelves are
 * sources.js; the template rules are templates/postTemplates.js, and the
 * template editor's drafts templates/editorDrafts.js (re-exported here).
 *
 * A LibraryItem:
 *
 *   key, id     `${kind}:${uri || url}`, or `template:${rkey}`, so a
 *               selection survives a refresh of its shelf (one value, both names)
 *   kind        what using it attaches or adds: 'template' | 'post' | 'link'
 *               | 'feed' | 'list'
 *   shelf       where it's listed: 'suggested' | 'templates' | 'posts' |
 *               'replies' | 'saved' | 'links' | 'feeds' | 'lists' | 'search'
 *   title, subtitle (the meta line, also `label`), excerpt (a second line)
 *   uri, cid, url, view   what it points at; `cid` is null for a post read
 *               from the archive, which sources.hydratePick fills in
 *   template    the template, for a template
 *   at, score   when it was written, and a post's likes, reposts, replies
 *               and quotes together, for sorting
 *   shortcut, reason, source, embedView, media   as the shelves show them
 *
 * A LibraryPlan, what the composer does with a pick:
 *
 *   { insertText?, attach?: { kind, uri?, cid?, url?, view? }, template?,
 *     answers?, title, templateRkey }
 *
 * Insert `insertText` at the caret (insertText() below), then attach.
 */

import {
  describeTemplate,
  fillTemplate,
  keywordMatches,
  matchShortcut,
  normalizeShortcut,
  templateOffered,
  templatePreviewParts,
  templateQuestions,
  buildTemplateContext,
} from '../templates/postTemplates.js';
import { templateEmbedKind } from '../templates/editorDrafts.js';
import { countComposerGraphemes } from '../lib/inlineLinks.js';
import { truncateGraphemes } from '../lib/graphemes.js';

export {
  BLANK_TEMPLATE,
  draftFromReply,
  draftFromTemplate,
  syncDraftVariables,
  templateEmbedKind,
  templateFromDraft,
} from '../templates/editorDrafts.js';

/** The library's name in the UI, kept in one place because the word may change. */
export const LIBRARY_NAME = 'Library';

const shelf = (id, label) => Object.freeze({ id, label });

export const LIBRARY_SHELVES = Object.freeze([
  shelf('suggested', 'For this reply'),
  shelf('templates', 'Templates'),
  shelf('posts', 'Your posts'),
  shelf('replies', 'Your replies'),
  shelf('saved', 'Saved'),
  shelf('links', 'Links'),
  shelf('feeds', 'Feeds'),
  shelf('lists', 'Lists'),
  shelf('search', 'Search'),
]);

/** The shelves to show: "For this reply" only while replying. */
export function shelvesFor({ replying } = {}) {
  return replying
    ? LIBRARY_SHELVES.slice()
    : LIBRARY_SHELVES.filter((s) => s.id !== 'suggested');
}

/** The shelf the library opens on. */
export function openingShelf({ replying } = {}) {
  return replying ? 'suggested' : 'templates';
}

const FEED_COLLECTION = 'app.bsky.feed.generator';
const LIST_COLLECTION = 'app.bsky.graph.list';
const RECORD_EMBED = 'app.bsky.embed.record';
const EXTERNAL_EMBED = 'app.bsky.embed.external';
const IMAGES_EMBED = 'app.bsky.embed.images';
const VIDEO_EMBED = 'app.bsky.embed.video';
const RECORD_WITH_MEDIA = 'app.bsky.embed.recordWithMedia';
const CURATE_LIST = 'app.bsky.graph.defs#curatelist';
const MOD_LIST = 'app.bsky.graph.defs#modlist';

const MISSING = 'missing';

const str = (v) => (typeof v === 'string' ? v : '');
const oneLine = (v) => str(v).replace(/\s+/g, ' ').trim();
const quoted = (word) => `“${word}”`;
const capitalise = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function collectionOf(uri) {
  const m = /^at:\/\/[^/]+\/([^/]+)\/[^/?#]+$/.exec(str(uri));
  return m ? m[1] : null;
}

const didOf = (uri) => /^at:\/\/([^/]+)\//.exec(str(uri))?.[1] || null;

/** "and"-joined: “a”, “b” and “c”. */
function joinAnd(words) {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** "host/path" without the scheme, the query or a trailing slash. */
function hostAndPath(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, '');
    return u.hostname.replace(/^www\./, '') + path;
  } catch {
    return str(url);
  }
}

function shortDate(iso, now = new Date()) {
  const d = new Date(iso || '');
  if (Number.isNaN(d.getTime())) return '';
  const opts = { month: 'short', day: 'numeric' };
  // An older post needs its year, or "Sep 2" reads as this September.
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString(undefined, opts);
}

/** The first non-empty line, and the rest as one line. */
function splitFirstLine(text) {
  const lines = str(text)
    .split('\n')
    .map((l) => l.trim());
  const first = lines.findIndex(Boolean);
  if (first < 0) return { first: '', rest: '' };
  return {
    first: lines[first],
    rest: oneLine(lines.slice(first + 1).join(' ')),
  };
}

// What a post with no text shows instead, by what it carries.
function embedLabel(post) {
  const embed = post?.record?.embed || null;
  const type =
    str(embed?.$type) || str(post?.embed?.$type).replace(/#view$/, '');
  if (type === IMAGES_EMBED) return 'Image';
  if (type === VIDEO_EMBED) return 'Video';
  if (type === EXTERNAL_EMBED) return 'Link';
  if (type === RECORD_WITH_MEDIA) {
    const media =
      str(embed?.media?.$type) ||
      str(post?.embed?.media?.$type).replace(/#view$/, '');
    if (media === VIDEO_EMBED) return 'Video';
    if (media === IMAGES_EMBED) return 'Image';
    return 'Quote';
  }
  if (type === RECORD_EMBED) {
    const collection = collectionOf(
      embed?.record?.uri || post?.embed?.record?.uri,
    );
    if (collection === FEED_COLLECTION) return 'Feed';
    if (collection === LIST_COLLECTION) return 'List';
    return 'Quote';
  }
  if (post?.hasMedia) return 'Image';
  return 'Post';
}

// Alt texts in image order, the empty ones left out.
const altsOf = (images) =>
  images
    .map((img) => oneLine(img?.alt))
    .filter(Boolean)
    .join(' · ');

/**
 * The pictures a post carries: the first one's thumbnail and every alt text.
 * The thumbnail comes from the hydrated view only; a post read as a bare
 * record still has its alt text. Null when it carries none.
 * @returns {{ thumb: string | null, alt: string } | null}
 */
export function postMedia(post) {
  let view = post?.embed || null;
  if (view?.$type === `${RECORD_WITH_MEDIA}#view`) view = view.media || null;
  let record = post?.record?.embed || null;
  if (record?.$type === RECORD_WITH_MEDIA) record = record.media || null;
  if (view?.$type === `${IMAGES_EMBED}#view` && view.images?.length) {
    return {
      thumb: str(view.images[0]?.thumb) || null,
      alt: altsOf(view.images),
    };
  }
  if (view?.$type === `${VIDEO_EMBED}#view`) {
    return { thumb: str(view.thumbnail) || null, alt: oneLine(view.alt) };
  }
  if (record?.$type === IMAGES_EMBED && record.images?.length) {
    return { thumb: null, alt: altsOf(record.images) };
  }
  if (record?.$type === VIDEO_EMBED)
    return { thumb: null, alt: oneLine(record.alt) };
  return null;
}

/** A post's title: its first line, or what it carries when it has no text. */
function postTitle(post) {
  return splitFirstLine(post?.record?.text).first || embedLabel(post);
}

const isRecordKind = (k) => k === 'post' || k === 'feed' || k === 'list';

const viewOf = (embedView) =>
  embedView && typeof embedView === 'object' ? embedView : null;

function isOwnHandle(handle, context) {
  const mine = context?.my?.handle;
  return !!handle && !!mine && handle === mine;
}

const finite = (n) => (Number.isFinite(n) ? n : 0);

/** A post's likes, reposts, replies and quotes, from a view or an archive row. */
export function engagementScore(post) {
  if (!post) return 0;
  const counts = [
    post.likeCount ?? post.likes,
    post.repostCount ?? post.reposts,
    post.replyCount ?? post.replies,
    post.quoteCount ?? post.quotes,
  ];
  return counts.reduce((sum, n) => sum + finite(n), 0);
}

/**
 * Whether a post belongs to its author's own thread: a standalone post, a
 * thread start, or a self-reply. A reply counts only when both the root and
 * the parent are the author's; answering someone else's comment inside your
 * own thread is a reply to them.
 */
export function isOwnThreadPost(post) {
  const reply = post?.record?.reply;
  if (!reply?.root?.uri) return true;
  const did = post?.author?.did || didOf(post?.uri);
  if (!did) return false;
  const parentUri = reply.parent?.uri || reply.root.uri;
  return (
    reply.root.uri.startsWith(`at://${did}/`) &&
    parentUri.startsWith(`at://${did}/`)
  );
}

/* ---- items ------------------------------------------------------------ */

function baseItem(fields) {
  const item = {
    id: '',
    kind: '',
    shelf: '',
    title: '',
    excerpt: '',
    label: '',
    shortcut: '',
    reason: '',
    source: null,
    embedView: undefined,
    media: null,
    uri: null,
    cid: null,
    url: null,
    view: null,
    template: null,
    at: null,
    score: null,
    ...fields,
  };
  item.key = item.id;
  item.subtitle = item.label;
  return item;
}

function templateLabel(template, context, embedView) {
  const asks = templateQuestions(template, context).length;
  if (asks === 1) return 'Template · asks a question';
  if (asks > 1) return `Template · asks ${asks} questions`;
  if (embedView === MISSING) return 'Template';
  switch (templateEmbedKind(template?.embed)) {
    case 'post':
      return 'Template · quotes a post';
    case 'feed':
      return 'Template · attaches a feed';
    case 'list':
      return 'Template · attaches a list';
    case 'link':
      return 'Template · attaches a link';
    default:
      return 'Template';
  }
}

/**
 * @param {object} template a normalized template (postTemplates.js)
 * @param {object} context buildTemplateContext's result
 * @param {object} [opts]
 * @param {object|'missing'} [opts.embedView] the hydrated view of what it quotes
 */
export function itemFromTemplate(template, context, { embedView } = {}) {
  const parts = templatePreviewParts(template, {}, context);
  const excerpt = oneLine(
    parts.map((p) => (p.kind === 'blank' ? '…' : p.text)).join(''),
  );
  const shortcut = normalizeShortcut(template?.shortcut);
  return baseItem({
    id: `template:${template?.rkey || ''}`,
    kind: 'template',
    shelf: 'templates',
    title:
      oneLine(template?.name) ||
      splitFirstLine(template?.text).first ||
      'Untitled template',
    excerpt,
    label: templateLabel(template, context, embedView),
    shortcut: shortcut ? `/${shortcut}` : '',
    source: template,
    embedView,
    template,
    at: template?.updatedAt || template?.createdAt || null,
  });
}

// Short enough that the closing quote survives a one-line row.
const PARENT_LINE_GRAPHEMES = 60;

/** `line` cut to `max` graphemes at a word break, with an ellipsis when cut. */
function clipAtWord(line, max) {
  const short = truncateGraphemes(line, max);
  if (short === line) return line;
  const space = short.lastIndexOf(' ');
  const cut = space > short.length / 2 ? short.slice(0, space) : short;
  return `${cut.replace(/[\s,.;:!?]+$/, '')}…`;
}

function isReplyPost(view, shelfId) {
  if (shelfId === 'replies') return true;
  if (shelfId === 'posts') return false;
  return !!view?.record?.reply && !isOwnThreadPost(view);
}

/**
 * @param {object} view a post view (or a bare `{ uri, cid, record, author }`)
 * @param {object} [opts]
 * @param {string} [opts.shelf] 'posts' | 'replies' | 'saved' | 'suggested' | 'search'
 * @param {string} [opts.selfDid] the account the library is for
 * @param {object} [opts.parentView] the post a reply answers
 */
export function itemFromPost(
  view,
  { shelf: shelfId = 'posts', selfDid, parentView } = {},
) {
  const { first, rest } = splitFirstLine(view?.record?.text);
  const at = view?.record?.createdAt || view?.indexedAt || null;
  const date = shortDate(at);
  const mine = !!selfDid && (view?.author?.did || didOf(view?.uri)) === selfDid;
  let head;
  if (mine) head = isReplyPost(view, shelfId) ? 'Your reply' : 'Your post';
  else head = view?.author?.handle ? `Post by @${view.author.handle}` : 'Post';
  let excerpt = rest;
  if (parentView?.author?.handle) {
    const line = splitFirstLine(parentView.record?.text).first;
    const shown = clipAtWord(line, PARENT_LINE_GRAPHEMES);
    excerpt = shown
      ? `Replying to @${parentView.author.handle}: ${quoted(shown)}`
      : `Replying to @${parentView.author.handle}`;
  }
  const hydrated = !!view?.cid;
  return baseItem({
    id: `post:${view?.uri || ''}`,
    kind: 'post',
    shelf: shelfId,
    title: first || embedLabel(view),
    excerpt,
    label: date ? `${head} · ${date}` : head,
    source: view,
    media: postMedia(view),
    uri: view?.uri || null,
    cid: view?.cid || null,
    view: hydrated ? view : null,
    at,
    score: engagementScore(view),
  });
}

/**
 * A post from the archive (src/lib/analyticsStore.js's compact row:
 * `{ uri, at, text, replyTo, hasMedia, likes, reposts, replies, quotes }`).
 * The row keeps the start of the text and no cid; sources.hydratePick reads
 * the post itself before it is attached.
 */
export function itemFromArchiveRow(row, { shelf: shelfId, selfDid } = {}) {
  const ownThread = !row?.replyTo || row.replyTo === selfDid;
  const source = {
    uri: row?.uri || null,
    cid: null,
    author: { did: didOf(row?.uri) },
    record: { text: str(row?.text), createdAt: row?.at || null },
    hasMedia: !!row?.hasMedia,
    likeCount: row?.likes,
    repostCount: row?.reposts,
    replyCount: row?.replies,
    quoteCount: row?.quotes,
  };
  const item = itemFromPost(source, {
    shelf: shelfId || (ownThread ? 'posts' : 'replies'),
    selfDid,
  });
  return { ...item, media: row?.hasMedia ? { thumb: null, alt: '' } : null };
}

/** Whether an archive row belongs on Your posts (else Your replies). */
export function isOwnThreadRow(row, selfDid) {
  return !row?.replyTo || row.replyTo === selfDid;
}

/** @param {object} link `{ url, title, description, image, postUri, createdAt }` */
export function itemFromLink(link) {
  const host = hostOf(link?.url);
  return baseItem({
    id: `link:${link?.url || ''}`,
    kind: 'link',
    shelf: 'links',
    title: oneLine(link?.title) || str(link?.url),
    excerpt: hostAndPath(link?.url),
    label: host ? `Link · ${host}` : 'Link',
    source: link,
    url: link?.url || null,
    at: link?.createdAt || null,
  });
}

/**
 * @param {object} view a feed generator view
 * @param {object} [opts]
 * @param {'yours'|'saved'|'search'} [opts.group]
 */
export function itemFromFeed(view, { group = 'yours' } = {}) {
  let label;
  if (group === 'yours') label = 'Feed · yours';
  else if (group === 'saved') label = 'Feed · saved';
  else
    label = view?.creator?.handle ? `Feed by @${view.creator.handle}` : 'Feed';
  return baseItem({
    id: `feed:${view?.uri || ''}`,
    kind: 'feed',
    shelf: 'feeds',
    title: oneLine(view?.displayName) || 'Untitled feed',
    excerpt: oneLine(view?.description),
    label,
    source: view,
    group,
    uri: view?.uri || null,
    cid: view?.cid || null,
    view: view || null,
    at: view?.indexedAt || null,
  });
}

/** @param {object} view a list view */
export function itemFromList(view) {
  let label = 'List';
  if (view?.purpose === CURATE_LIST) label = 'List · curation';
  else if (view?.purpose === MOD_LIST) label = 'List · moderation';
  return baseItem({
    id: `list:${view?.uri || ''}`,
    kind: 'list',
    shelf: 'lists',
    title: oneLine(view?.name) || 'Untitled list',
    excerpt: oneLine(view?.description),
    label,
    source: view,
    uri: view?.uri || null,
    cid: view?.cid || null,
    view: view || null,
    at: view?.indexedAt || null,
  });
}

/**
 * Items newest first (`'date'`) or most engaged first (`'engagement'`,
 * newest first among equals). Returns a new array.
 */
export function sortItems(items, by = 'date') {
  const time = (i) => {
    const t = Date.parse(i?.at || '');
    return Number.isNaN(t) ? -Infinity : t;
  };
  return [...(items || [])].sort((a, b) =>
    by === 'engagement'
      ? finite(b.score) - finite(a.score) || time(b) - time(a)
      : time(b) - time(a),
  );
}

/* ---- suggestions ------------------------------------------------------ */

const STOPWORDS = new Set([
  'about', 'above', 'after', 'again', 'against', 'almost', 'along', 'already', 'also', 'although', 'always',
  'among', 'another', 'anyone', 'anything', 'anyway', 'around', 'away', 'back', 'because', 'been', 'before',
  'behind', 'being', 'below', 'between', 'both', 'came', 'cannot', 'come', 'could', 'does',
  'doing', 'done', 'down', 'during', 'each', 'either', 'else', 'enough', 'even', 'ever', 'every', 'everyone',
  'everything', 'from', 'further', 'gets', 'getting', 'give', 'goes', 'going', 'gonna', 'good', 'great', 'have',
  'having', 'hello', 'here', 'hers', 'herself', 'himself', 'into', 'itself', 'just', 'keep', 'know', 'last',
  'less', 'like', 'little', 'look', 'made', 'make', 'many', 'maybe', 'might', 'more', 'most', 'much', 'must',
  'myself', 'need', 'never', 'next', 'nothing', 'okay', 'once', 'only', 'onto', 'other', 'others', 'ought',
  'ours', 'ourselves', 'over', 'people', 'please', 'post', 'pretty', 'quite', 'rather', 'really', 'reply',
  'right', 'said', 'same', 'says', 'seem', 'seems', 'shall', 'should', 'since', 'some', 'someone', 'something',
  'still', 'such', 'sure', 'take', 'than', 'thank', 'thanks', 'that', 'their', 'theirs', 'them', 'themselves',
  'then', 'there', 'these', 'they', 'thing', 'things', 'think', 'this', 'those', 'though', 'thought', 'through',
  'time', 'today', 'together', 'told', 'too', 'took', 'under', 'until', 'upon', 'used', 'using', 'very', 'want',
  'wants', 'well', 'went', 'were', 'what', 'whatever', 'when', 'where', 'whether', 'which', 'while', 'whom',
  'whose', 'will', 'with', 'within', 'without', 'wonder', 'would', 'yeah', 'your', 'yours', 'yourself',
  'yourselves', 'http', 'https',
  // Contractions typed without their apostrophe, and laughter.
  'aint', 'arent', 'cant', 'couldnt', 'didnt', 'doesnt', 'dont', 'gotta', 'hadnt', 'hasnt', 'havent', 'isnt',
  'kinda', 'lets', 'shouldnt', 'sorta', 'theyll', 'theyre', 'theyve', 'wanna', 'wasnt', 'werent', 'wont',
  'wouldnt', 'yall', 'youll', 'youre', 'youve',
  'haha', 'lmao',
  // Where the conversation happens, which nearly every post could mention.
  'bluesky', 'bsky', 'skeet', 'atproto',
]); // prettier-ignore

// Letters and numbers, with apostrophes only inside a word (so "moths'" reads
// as "moths").
const WORDS = /[\p{L}\p{N}](?:[\p{L}\p{N}'’]*[\p{L}\p{N}])?/gu;

// Lower case, without a possessive or a plain plural, so "moths" and "moth's"
// meet "moth". Any other apostrophe makes a contraction ("don't", "you're"),
// never a topic. Words under four letters and stopwords give null.
function stem(word) {
  const whole = word.toLowerCase().replace(/’/g, "'").replace(/'s$/, '');
  if (whole.includes("'")) return null;
  if (STOPWORDS.has(whole)) return null;
  const w =
    whole.length > 4 && whole.endsWith('s') && !whole.endsWith('ss')
      ? whole.slice(0, -1)
      : whole;
  if ((w.match(/\p{L}/gu) || []).length < 4) return null;
  if (STOPWORDS.has(w)) return null;
  return w;
}

/** The meaningful words of `text`, in first-appearance order. */
function meaningfulWords(text) {
  // Links and handles share hosts and TLDs, which aren't topics.
  const cleaned = str(text)
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/@[\w.-]+/g, ' ');
  const out = [];
  for (const raw of cleaned.match(WORDS) || []) {
    const w = stem(raw);
    if (w && !out.includes(w)) out.push(w);
  }
  return out;
}

const OVERLAP_NEEDED = { post: 2, feed: 1, list: 1 };
// A post also qualifies on one shared word this long ("stamina").
const LONG_WORD_LETTERS = 6;
// Among at least COMMON_MIN_CANDIDATES posts, feeds and lists, a word more
// than COMMON_SHARE of them have says little about any one of them, so it
// doesn't count as shared.
const COMMON_SHARE = 0.2;
const COMMON_MIN_CANDIDATES = 5;

const letterCount = (word) => (word.match(/\p{L}/gu) || []).length;

function sharesEnough(kind, shared) {
  if (shared.length >= OVERLAP_NEEDED[kind]) return true;
  return (
    kind === 'post' && shared.some((w) => letterCount(w) >= LONG_WORD_LETTERS)
  );
}

/**
 * Best matches for the post being replied to, at most `limit`: templates
 * whose keywords its text mentions (most hits first), then posts, feeds and
 * lists that share distinctive words with it (most shared first). A word is
 * distinctive unless more than a fifth of the posts, feeds and lists have it
 * (when there are five or more); feeds and lists need one, posts two, or one
 * of six letters or more. Templates not offered on replies are skipped. Each
 * comes back with its `reason` and on the 'suggested' shelf.
 *
 * Each list takes items; bare templates, post views, feed views and list
 * views are made into items first (with `context` and `selfDid`).
 *
 * @param {object} args
 * @param {object[]} [args.templates] template items
 * @param {object[]} [args.posts] post items
 * @param {object[]} [args.feeds] feed items
 * @param {object[]} [args.lists] list items
 * @param {string} args.parentText the text of the post being replied to
 * @param {string} [args.parentUri] left out of the suggestions
 * @param {number} [args.limit]
 * @param {object} [args.context] for bare templates
 * @param {string} [args.selfDid] for bare post views
 */
export function suggestItems({
  templates = [],
  posts = [],
  feeds = [],
  lists = [],
  parentText,
  parentUri,
  limit = 5,
  context,
  selfDid,
} = {}) {
  const text = str(parentText);
  if (!text.trim() || limit <= 0) return [];
  const asItems = (list, make) =>
    (list || []).filter(Boolean).map((x) => (x.kind ? x : make(x)));
  const templateItems = asItems(templates, (t) => itemFromTemplate(t, context));
  const others = [
    ...asItems(posts, (v) => itemFromPost(v, { shelf: 'posts', selfDid })),
    ...asItems(feeds, (v) => itemFromFeed(v, { group: 'yours' })),
    ...asItems(lists, (v) => itemFromList(v)),
  ];

  const byHits = [];
  for (const item of templateItems) {
    const template = item?.source;
    if (!template || !templateOffered(template, { replying: true })) continue;
    const hits = keywordMatches(template, text);
    if (!hits.length) continue;
    byHits.push({
      item,
      score: hits.length,
      reason: `Their post mentions ${hits.slice(0, 3).map(quoted).join(', ')}`,
    });
  }
  byHits.sort((a, b) => b.score - a.score);

  const candidates = [];
  const candidateIds = new Set();
  for (const item of others) {
    if (!OVERLAP_NEEDED[item?.kind] || candidateIds.has(item.id)) continue;
    if (parentUri && item.source?.uri === parentUri) continue;
    candidateIds.add(item.id);
    // A reply's excerpt quotes its parent, whose words aren't the reply's own.
    const own =
      item.kind === 'post' && typeof item.source?.record?.text === 'string'
        ? item.source.record.text
        : `${item.title} ${item.excerpt}`;
    candidates.push({ item, words: meaningfulWords(own) });
  }

  const common = new Set();
  if (candidates.length >= COMMON_MIN_CANDIDATES) {
    const counts = new Map();
    for (const { words } of candidates)
      for (const w of words) counts.set(w, (counts.get(w) || 0) + 1);
    for (const [w, n] of counts)
      if (n / candidates.length > COMMON_SHARE) common.add(w);
  }

  const parentWords = new Set(meaningfulWords(text));
  const byOverlap = [];
  for (const { item, words } of candidates) {
    const shared = words.filter((w) => parentWords.has(w) && !common.has(w));
    if (!sharesEnough(item.kind, shared)) continue;
    byOverlap.push({
      item,
      score: shared.length,
      reason: `Shares ${joinAnd(shared.slice(0, 3).map(quoted))} with their post`,
    });
  }
  byOverlap.sort((a, b) => b.score - a.score);

  const seen = new Set();
  const out = [];
  for (const { item, reason } of [...byHits, ...byOverlap]) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push({ ...item, reason });
    if (out.length >= limit) break;
  }
  return out;
}

/* ---- search ----------------------------------------------------------- */

/**
 * Items matching `query`. A query starting with "/" looks at template
 * shortcuts only, best first (matchShortcut); anything else is a
 * case-insensitive substring of an item's title, excerpt, label, shortcut or
 * alt text, in the items' order. A blank query matches nothing. Duplicates
 * by id are dropped.
 */
export function searchItems(items, query, { replying = false } = {}) {
  const q = str(query).trim();
  if (!q) return [];
  const list = dedupeById(items || []);
  if (q.startsWith('/')) {
    const templates = list.filter((i) => i.kind === 'template' && i.source);
    const byRkey = new Map(templates.map((i) => [i.source.rkey, i]));
    return matchShortcut(
      templates.map((i) => i.source),
      q.slice(1),
      { replying, limit: templates.length },
    )
      .map((t) => byRkey.get(t.rkey))
      .filter(Boolean);
  }
  const needle = q.toLowerCase();
  return list.filter((i) =>
    [i.title, i.excerpt, i.label, i.shortcut, i.media?.alt].some((field) =>
      str(field).toLowerCase().includes(needle),
    ),
  );
}

/**
 * `items` without those whose id is in `seenIds` (a Set or an array of ids),
 * and without repeats among themselves.
 */
export function dedupeById(items, seenIds) {
  const seen = new Set(seenIds instanceof Set ? seenIds : seenIds || []);
  const out = [];
  for (const item of items || []) {
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

/* ---- verbs and effects ------------------------------------------------ */

/** The use button's label. */
export function verbFor(item, { replying = false } = {}) {
  switch (item?.kind) {
    case 'template':
      return replying ? 'Put in reply' : 'Put in post';
    case 'post':
      return 'Quote';
    case 'link':
      return 'Attach link';
    case 'feed':
      return 'Attach feed';
    case 'list':
      return 'Attach list';
    default:
      return null;
  }
}

// What a template's embed would attach, as a lower-case phrase; '' when it
// attaches nothing (gone, or a kind the composer can't attach).
function templateAttachPhrase(item, context) {
  if (item?.embedView === MISSING) return '';
  const view = viewOf(item?.embedView);
  switch (templateEmbedKind(item?.source?.embed)) {
    case 'post':
      return isOwnHandle(view?.author?.handle, context)
        ? 'quotes your post'
        : 'quotes a post';
    case 'feed':
      return 'attaches a feed';
    case 'list':
      return 'attaches a list';
    case 'link':
      return 'attaches a link card';
    default:
      return '';
  }
}

/** One plain line saying what using the item does. */
export function effectFor(item, context) {
  switch (item?.kind) {
    case 'template': {
      const template = item.source || {};
      const { questions } = describeTemplate(template, context);
      const hasText = !!str(template.text).trim();
      const attach = templateAttachPhrase(item, context);
      if (questions > 0) {
        const asks =
          questions === 1 ? 'one question' : `${questions} questions`;
        return `Asks ${asks}, then adds text${attach ? ` and ${attach}` : ''}`;
      }
      if (hasText && attach) return `Adds text and ${attach}`;
      if (hasText)
        return context?.their
          ? 'Adds text to your reply'
          : 'Adds text to your post';
      if (attach) return capitalise(attach);
      return 'Has nothing to add here';
    }
    case 'post':
      return 'Attaches this post as a quote';
    case 'link':
      return 'Attaches a link card';
    case 'feed':
      return 'Attaches the feed as a card people can open';
    case 'list':
      return 'Attaches the list as a card';
    default:
      return '';
  }
}

/* ---- context and attachments from the composer ------------------------ */

/**
 * The template context for a library opened from the composer: the post
 * being replied to (ComposerState.reply carries its `author` and `text`) and
 * the handle the post goes out as.
 */
export function libraryContext({
  state,
  reply = state?.reply,
  selfHandle,
  now,
  locale,
} = {}) {
  const replyTo = reply?.author
    ? { author: reply.author, record: { text: str(reply.text) } }
    : null;
  return buildTemplateContext({
    replyTo,
    self: { handle: selfHandle || null },
    now,
    locale,
  });
}

// A template context passes through; anything else ({ state, reply }) is
// made into one, so callers can hand the dialog's context straight on.
function asTemplateContext(context, state) {
  if (
    context &&
    typeof context === 'object' &&
    typeof context.today === 'string'
  )
    return context;
  return libraryContext({
    state: context?.state || state,
    reply: context?.reply,
    selfHandle: context?.selfHandle,
  });
}

/**
 * What a post in the composer already carries, as previewFor wants it:
 * `{ record: { by, title } | null, link: { url, title } | null, media: 'images' | 'video' | null }`.
 */
export function attachmentsFromState(state, postIndex = 0) {
  const post = state?.posts?.[postIndex] || null;
  if (!post) return { record: null, link: null, media: null };
  let record = null;
  if (post.record?.uri) {
    const view = post.record.view;
    const kind = post.record.kind || 'post';
    const handle = view?.author?.handle || view?.creator?.handle;
    const noun =
      { post: 'Post', feed: 'Feed', list: 'List', starterpack: 'Starter pack' }[
        kind
      ] || 'Post';
    record = {
      by: handle ? `${noun} by @${handle}` : noun,
      title:
        kind === 'post'
          ? postTitle(view || {})
          : oneLine(view?.displayName || view?.name || view?.record?.name),
    };
  }
  const link = post.card?.url
    ? { url: post.card.url, title: str(post.card.title) || post.card.url }
    : null;
  const media = post.video ? 'video' : post.images?.length ? 'images' : null;
  return { record, link, media };
}

/* ---- preview ---------------------------------------------------------- */

function clampIndex(value, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(Math.trunc(value), max));
}

// A range holding just a "/shortcut", as detectSlashCommand reports one.
const SLASH_RANGE = /^\/[A-Za-z0-9-]{0,32}$/;

// The pieces insertText joins, so the preview can tell existing text from added.
function insertPieces(text, addition, range) {
  const source = text == null ? '' : String(text);
  const add = addition == null ? '' : String(addition);
  let start = clampIndex(range?.start, source.length, source.length);
  let end = clampIndex(range?.end, source.length, start);
  if (end < start) [start, end] = [end, start];
  // With nothing to put in its place (a quote or a card alone), a selection
  // of the writer's own words stays; only a "/shortcut" is taken out.
  if (!add && end > start && !SLASH_RANGE.test(source.slice(start, end)))
    start = end;
  const before = source.slice(0, start);
  let after = source.slice(end);
  if (!add) {
    // Taking "/word" out of "a /word b" would otherwise leave two spaces.
    if (end > start && /[ \t]$/.test(before) && /^[ \t]/.test(after))
      after = after.slice(1);
    return { before, lead: '', addition: '', trail: '', after };
  }
  const lead = before && !/\s$/.test(before) && !/^\s/.test(add) ? ' ' : '';
  const trail = after && !/^\s/.test(after) && !/\s$/.test(add) ? ' ' : '';
  return { before, lead, addition: add, trail, after };
}

/**
 * `addition` put over `[start, end)` of `text`. One space joins it to the
 * text on either side, except at the edges of the text or next to whitespace
 * already there. A missing range means the end of the text. A null addition
 * takes a "/shortcut" range out and leaves any other range's text as it is,
 * with the caret at its end.
 * @param {string} text
 * @param {string | null} insertion the text to add
 * @param {{ start: number, end: number }} [range]
 * @returns {{ text: string, caret: number }} the caret sits after the addition
 */
export function insertText(text, insertion, range) {
  const p = insertPieces(text, insertion, range);
  return {
    text: p.before + p.lead + p.addition + p.trail + p.after,
    caret: p.before.length + p.lead.length + p.addition.length,
  };
}

/**
 * The reply's text without the "/shortcut" that opened the library, for
 * "Save this reply as a template"; anything else in the range is kept.
 */
export function replyTextWithoutSlash(text, insertion) {
  const source = typeof text === 'string' ? text : '';
  if (!insertion || !(insertion.end > insertion.start)) return source;
  if (!source.slice(insertion.start, insertion.end).startsWith('/'))
    return source;
  return insertText(source, null, insertion).text;
}

function pushPart(parts, text, kind) {
  if (!text) return;
  const last = parts[parts.length - 1];
  if (last && last.kind === kind) last.text += text;
  else parts.push({ text, kind });
}

// A template's addition as kinded parts. templatePreviewParts closes the gaps
// of empty blanks as fillTemplate does, so a filled addition joins to its text.
function templateAdditionParts(template, answers, context) {
  const parts = [];
  for (const part of templatePreviewParts(template, answers, context)) {
    pushPart(parts, part.text, part.kind === 'text' ? 'added' : part.kind);
  }
  return parts;
}

/** What the item attaches, for the preview's mini card: `{ by, title }` or null. */
function attachmentFor(item, context) {
  const source = item?.source;
  switch (item?.kind) {
    case 'post':
      return {
        by: isOwnHandle(source?.author?.handle, context)
          ? 'Your post'
          : source?.author?.handle
            ? `Post by @${source.author.handle}`
            : 'Post',
        title: postTitle(source),
      };
    case 'feed':
      return {
        by: source?.creator?.handle
          ? `Feed by @${source.creator.handle}`
          : 'Feed',
        title: item.title,
      };
    case 'list':
      return {
        by: source?.creator?.handle
          ? `List by @${source.creator.handle}`
          : 'List',
        title: item.title,
      };
    case 'link':
      return { by: hostOf(source?.url) || 'Link', title: item.title };
    case 'template': {
      if (item.embedView === MISSING) return null;
      const embed = source?.embed;
      const view = viewOf(item.embedView);
      switch (templateEmbedKind(embed)) {
        case 'post':
          if (!view) return { by: 'Quoted post', title: '' };
          return attachmentFor({ kind: 'post', source: view }, context);
        case 'feed':
          return view
            ? attachmentFor(
                {
                  kind: 'feed',
                  source: view,
                  title: oneLine(view.displayName),
                },
                context,
              )
            : { by: 'Feed', title: '' };
        case 'list':
          return view
            ? attachmentFor(
                { kind: 'list', source: view, title: oneLine(view.name) },
                context,
              )
            : { by: 'List', title: '' };
        case 'link':
          return {
            by: hostOf(embed.external.uri) || 'Link',
            title: oneLine(embed.external.title) || embed.external.uri,
          };
        default:
          return null;
      }
    }
    default:
      return null;
  }
}

// 'record' | 'link' | null: which attachment slot the item would fill.
function slotFor(item) {
  if (item?.kind === 'post' || item?.kind === 'feed' || item?.kind === 'list')
    return 'record';
  if (item?.kind === 'link') return 'link';
  if (item?.kind === 'template' && item.embedView !== MISSING) {
    const kind = templateEmbedKind(item.source?.embed);
    if (isRecordKind(kind)) return 'record';
    if (kind === 'link') return 'link';
  }
  return null;
}

const NOTE_REPLACES =
  'A post holds one attachment, so this replaces the one already there.';
const NOTE_IMAGES =
  "Your images take the attachment space, so a link card won't show.";
const NOTE_VIDEO =
  "Your video takes the attachment space, so a link card won't show.";
const NOTE_GONE = {
  post: 'The post this template quotes is gone, so only its text will be added.',
  feed: 'The feed this template attaches is gone, so only its text will be added.',
  list: 'The list this template attaches is gone, so only its text will be added.',
};
const NOTE_UNSUPPORTED =
  "What this template attaches can't be added here, so only its text will be added.";
const BLOCKED_LOCKED =
  'This post already quotes something, so only the text can be added.';
const BLOCKED_LOCKED_EMPTY =
  "This post already quotes something, so this can't be added.";
const BLOCKED_GONE_EMPTY = {
  post: "The post this template quotes is gone, so there's nothing to add.",
  feed: "The feed this template attaches is gone, so there's nothing to add.",
  list: "The list this template attaches is gone, so there's nothing to add.",
};
const BLOCKED_UNSUPPORTED_EMPTY =
  "What this template attaches can't be added here, and it has no text.";

/**
 * What the post would look like with the item used.
 *
 * `parts` are the existing text before the insertion, the addition, and the
 * existing text after it, joined as insertText joins them (`[start, end)` is
 * left out, unless nothing is added and it isn't a "/shortcut"), so for a
 * filled addition
 * `parts.map((p) => p.text).join('') === insertText(currentText, added, insertion).text`.
 * A blank still to be answered shows as a 'blank' part holding its label.
 *
 * With `state` (and `postIndex`), the post's text and what it already
 * carries come from the composer, unless `currentText` or `attachments` are
 * given too.
 *
 * @param {object} item
 * @param {object} opts
 * @param {object} [opts.state] the ComposerState
 * @param {number} [opts.postIndex] the post in it being written
 * @param {string} [opts.currentText]
 * @param {{ start: number, end: number }} [opts.insertion] defaults to the end of the text
 * @param {object} [opts.answers] the template's answers so far
 * @param {object} [opts.context] buildTemplateContext's result
 * @param {object} [opts.attachments] `{ record: { by, title } | null, link: { url, title } | null, media: 'images' | 'video' | null }`
 * @param {boolean} [opts.quoteSlotLocked] the post already quotes something it must keep
 * @param {number} [opts.maxLength]
 * @returns {{ parts: object[], count: number, overLimit: boolean, attachment: object | null,
 *   replacesAttachment: boolean, notes: string[], blocked: string | null, usable: boolean }}
 *   `usable` is false when using the item would change nothing.
 */
export function previewFor(
  item,
  {
    state,
    postIndex = 0,
    currentText,
    insertion,
    answers = {},
    context,
    attachments,
    quoteSlotLocked = false,
    maxLength = 300,
  } = {},
) {
  const text = currentText ?? str(state?.posts?.[postIndex]?.text);
  const carried =
    attachments ?? (state ? attachmentsFromState(state, postIndex) : undefined);
  const ctx =
    context === undefined && state ? asTemplateContext(null, state) : context;
  const isTemplate = item?.kind === 'template';
  const template = isTemplate ? item.source || {} : null;
  const addedParts = isTemplate
    ? templateAdditionParts(template, answers, ctx)
    : [];
  const filled = isTemplate ? fillTemplate(template, answers, ctx) : '';
  const hasText = isTemplate && !!str(template.text).trim();

  // The tidied addition never starts or ends with whitespace, so any one
  // character stands in for it when choosing the joining spaces.
  const pieces = insertPieces(text, addedParts.length ? 'x' : '', insertion);
  const parts = [];
  pushPart(parts, pieces.before, 'existing');
  if (addedParts.length) {
    pushPart(parts, pieces.lead, 'added');
    for (const p of addedParts) pushPart(parts, p.text, p.kind);
    pushPart(parts, pieces.trail, 'added');
  }
  pushPart(parts, pieces.after, 'existing');

  const full = insertText(text, filled, insertion).text;
  const count = countComposerGraphemes(full);

  const slot = slotFor(item);
  const embedKind = isTemplate ? templateEmbedKind(template.embed) : null;
  const notes = [];
  let blocked = null;
  let attachment = attachmentFor(item, ctx);
  let replacesAttachment = false;

  if (slot === 'record' && quoteSlotLocked) {
    blocked = isTemplate && hasText ? BLOCKED_LOCKED : BLOCKED_LOCKED_EMPTY;
    attachment = null;
  } else if (slot === 'record' && carried?.record) {
    replacesAttachment = true;
  } else if (slot === 'link' && carried?.link) {
    replacesAttachment = true;
  }
  if (replacesAttachment) notes.push(NOTE_REPLACES);
  if (slot === 'link' && carried?.media)
    notes.push(carried.media === 'video' ? NOTE_VIDEO : NOTE_IMAGES);

  if (isTemplate && isRecordKind(embedKind) && item.embedView === MISSING) {
    if (hasText) notes.push(NOTE_GONE[embedKind]);
    else blocked = blocked || BLOCKED_GONE_EMPTY[embedKind];
  } else if (isTemplate && embedKind === 'unsupported') {
    if (hasText) notes.push(NOTE_UNSUPPORTED);
    else blocked = blocked || BLOCKED_UNSUPPORTED_EMPTY;
  }

  const attaches = !!slot && !(slot === 'record' && quoteSlotLocked);
  const usable = !!item?.kind && (hasText || attaches);

  return {
    parts,
    count,
    overLimit: count > maxLength,
    attachment,
    replacesAttachment,
    notes,
    blocked,
    usable,
  };
}

/* ---- plans ------------------------------------------------------------ */

// A template's stored embed as an attachment, with the hydrated view when
// there is one (its cid is the post as it now is).
function templateAttachment(embed, embedView) {
  const view = viewOf(embedView);
  const kind = templateEmbedKind(embed);
  if (kind === 'link') {
    const external = embed.external || {};
    return {
      kind: 'link',
      url: external.uri,
      title: str(external.title),
      description: str(external.description),
    };
  }
  if (!isRecordKind(kind)) return null;
  const out = {
    kind,
    uri: embed.record.uri,
    cid: view?.cid || embed.record.cid || null,
  };
  if (view) out.view = view;
  return out;
}

/**
 * What the composer should do when the item is used: a LibraryPlan,
 * `{ insertText?, attach?, template?, answers?, title, templateRkey }`.
 *
 * `insertText` is the filled template text, absent when there is none (pass
 * `plan.insertText ?? null` to insertText, which still takes a "/shortcut"
 * insertion range out and leaves a selection be). `attach` is
 * `{ kind: 'post' | 'feed' | 'list', uri, cid, view? }` or
 * `{ kind: 'link', url, title?, description? }`; a post from the archive
 * has no cid until sources.hydratePick has read it. A record is dropped
 * while the quote slot is locked, and a template's embed when what it quotes
 * is gone or can't be attached.
 *
 * `context` is a template context (libraryContext), or the dialog's
 * `{ state, reply }` to make one from.
 */
export function applyPlanFor(
  item,
  { state, context, answers = {}, quoteSlotLocked = false } = {},
) {
  const ctx = asTemplateContext(context, state);
  const plan = { title: item?.title || '', templateRkey: null };
  const source = item?.source;
  switch (item?.kind) {
    case 'template': {
      const text = fillTemplate(source, answers, ctx);
      if (text) plan.insertText = text;
      plan.template = source || null;
      plan.answers = { ...answers };
      plan.templateRkey = source?.rkey || null;
      const kind = templateEmbedKind(source?.embed);
      const attachable =
        kind === 'link' || (isRecordKind(kind) && !quoteSlotLocked);
      if (attachable && item.embedView !== MISSING) {
        const attach = templateAttachment(source.embed, item.embedView);
        if (attach) plan.attach = attach;
      }
      break;
    }
    case 'post':
    case 'feed':
    case 'list':
      if (!quoteSlotLocked && item.uri) {
        plan.attach = { kind: item.kind, uri: item.uri, cid: item.cid || null };
        if (item.view) plan.attach.view = item.view;
      }
      break;
    case 'link':
      if (item.url) plan.attach = { kind: 'link', url: item.url };
      break;
    default:
      break;
  }
  return plan;
}

/* ---- slash shortcuts -------------------------------------------------- */

const SLASH_BEFORE_CARET = /(?:^|\s)\/([A-Za-z0-9-]{0,32})$/;

/**
 * The "/shortcut" being typed at the caret: a slash at the start of the text
 * or after whitespace, then up to 32 letters, digits or dashes running to the
 * caret. `{ start, end, query }` with `start` at the slash, `end` at the
 * caret and `query` lower-cased, or null. "a/b", URLs and "w/" are not
 * shortcuts, and neither is a caret inside a word ("/sta|mina").
 */
export function detectSlashCommand(text, caret) {
  const source = typeof text === 'string' ? text : '';
  const at = Number.isFinite(caret)
    ? Math.max(0, Math.min(Math.trunc(caret), source.length))
    : source.length;
  const m = SLASH_BEFORE_CARET.exec(source.slice(0, at));
  if (!m) return null;
  if (/^[A-Za-z0-9-]/.test(source.slice(at, at + 1))) return null;
  return { start: at - m[1].length - 1, end: at, query: m[1].toLowerCase() };
}

/**
 * Templates in the order the slash menu offers them: those offered here
 * first, then by keyword hits in the post being replied to, then by use, then
 * by name. matchShortcut keeps this order among equal matches, so a bare "/"
 * and ties follow it too. Returns a new array.
 * @param {object[]} templates normalized templates
 * @param {object} [opts]
 * @param {string} [opts.parentText] the text of the post being replied to
 * @param {object} [opts.usage] readTemplateUsage's `{ [rkey]: { count } }`
 * @param {boolean} [opts.replying]
 */
export function rankTemplatesForSlash(
  templates,
  { parentText = '', usage, replying = false } = {},
) {
  const counts = usage && typeof usage === 'object' ? usage : {};
  const useCount = (rkey) =>
    rkey && Object.hasOwn(counts, rkey) ? Number(counts[rkey]?.count) || 0 : 0;
  return (templates || [])
    .filter(Boolean)
    .map((t) => ({
      t,
      offered: templateOffered(t, { replying }) ? 1 : 0,
      hits: parentText ? keywordMatches(t, parentText).length : 0,
      uses: useCount(t.rkey),
      name: str(t.name),
    }))
    .sort(
      (a, b) =>
        b.offered - a.offered ||
        b.hits - a.hits ||
        b.uses - a.uses ||
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
        str(a.t.rkey).localeCompare(str(b.t.rkey)),
    )
    .map((r) => r.t);
}
