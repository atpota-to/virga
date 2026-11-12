// What a call to useComposer().open(intent) asks for, read into one plain
// shape the composer acts on (DESIGN.md §6.3). Nothing here touches the
// network: the composer loads what the plan names (a reply, a quote, a
// draft, a scheduled post, a template) itself.

import { parseRecordLink, parseRecordUri } from '../lib/postLink.js';
import { normalizeTags } from '../lib/tags.js';
import { MAX_POSTS, MAX_LANGS } from '../lib/composerModel.js';
import { REPLY_HINT } from '../schedule/publishActions.js';

const str = (v) => (typeof v === 'string' ? v : '');
const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * A reply or quote target as the intent gave it (`{ uri }`, `{ url }`, or a
 * bare string), read into `{ uri }` for an at:// URI with a DID, or
 * `{ kind, handle | did, collection, rkey, url }` for a link that still has
 * a handle to resolve. Null when it names no post, feed, list or starter pack.
 */
export function readTargetRef(input) {
  const raw = isObject(input) ? str(input.uri) || str(input.url) : str(input);
  const text = raw.trim();
  if (!text) return null;
  const parsedUri = parseRecordUri(text);
  if (parsedUri)
    return {
      kind: parsedUri.kind,
      uri: text,
      did: parsedUri.did,
      collection: parsedUri.collection,
      rkey: parsedUri.rkey,
    };
  const link = parseRecordLink(text);
  if (!link) return null;
  const out = {
    kind: link.kind,
    collection: link.collection,
    rkey: link.rkey,
    url: link.url || text,
  };
  if (link.did) {
    out.did = link.did;
    out.uri = `at://${link.did}/${link.collection}/${link.rkey}`;
  } else {
    out.handle = link.handle;
  }
  return out;
}

/**
 * The intent as the composer acts on it:
 *
 *   asDid        who the post goes out as (the intent's, a draft's owner, or
 *                the active account)
 *   texts        each post's starting text ([] when the intent has none)
 *   reply, quote readTargetRef results, or null (a reply must name a post)
 *   attach       a LibraryPlan to apply once the composer is up, or null
 *   tags, langs  normalized; langs null when the intent didn't say
 *   draftId, draftOwnerDid, scheduledId, templateId
 *   mode         'post' | 'schedule' | 'queue' (a reply can't be scheduled:
 *                D19, so it opens in post mode and `notes` says why)
 *   fromLink, url   the "From a link" notice for /intent/compose
 *   hasContent   whether it brings anything, so a saved post isn't restored
 *                over it
 */
export function normalizeIntent(intent, { activeDid = '' } = {}) {
  const i = isObject(intent) ? intent : {};
  const draftId = str(i.draftId) || null;
  const draftOwnerDid = draftId
    ? str(i.draftOwnerDid) || str(i.asDid) || activeDid || ''
    : null;
  const asDid = (draftId && draftOwnerDid) || str(i.asDid) || activeDid || '';

  const texts =
    Array.isArray(i.posts) && i.posts.length
      ? i.posts
          .slice(0, MAX_POSTS)
          .map((p) => (typeof p === 'string' ? p : str(p?.text)))
      : typeof i.text === 'string'
        ? [i.text]
        : [];

  let reply = readTargetRef(i.reply);
  if (reply && reply.kind !== 'post') reply = null;
  const quote = readTargetRef(i.quote);

  const notes = [];
  let mode = ['post', 'schedule', 'queue'].includes(i.mode) ? i.mode : 'post';
  if (reply && mode !== 'post') {
    mode = 'post';
    notes.push(REPLY_HINT);
  }

  const tags = normalizeTags(i.tags);
  const langs = Array.isArray(i.langs)
    ? [...new Set(i.langs.filter((l) => typeof l === 'string' && l))].slice(
        0,
        MAX_LANGS,
      )
    : null;

  const plan = {
    asDid,
    texts,
    reply,
    quote,
    attach: isObject(i.attach) ? i.attach : null,
    tags,
    langs,
    draftId,
    draftOwnerDid,
    scheduledId: str(i.scheduledId) || null,
    templateId: str(i.templateId) || null,
    mode,
    fromLink: !!i.fromLink,
    url: str(i.url) || null,
    notes,
  };
  plan.hasContent = !!(
    plan.texts.some((t) => t.trim()) ||
    plan.reply ||
    plan.quote ||
    plan.attach ||
    plan.draftId ||
    plan.scheduledId ||
    plan.templateId ||
    plan.tags.length
  );
  return plan;
}

/** What has to be read before the composer can show the intent, in order. */
export function intentLoads(plan) {
  if (!plan) return [];
  if (plan.scheduledId) return ['scheduled'];
  if (plan.draftId) return ['draft'];
  const out = [];
  if (plan.reply) out.push('reply');
  if (plan.quote) out.push('quote');
  if (plan.templateId) out.push('template');
  if (plan.attach) out.push('attach');
  return out;
}

/**
 * `base` (a fresh ComposerState) with the intent's own words in it: each
 * text in its post, tags, and languages when the intent named them.
 */
export function seedFromIntent(base, plan, { emptyPost }) {
  if (!plan) return base;
  let posts = base.posts;
  if (plan.texts.length) {
    posts = plan.texts.map((text, index) => ({
      ...(index === 0 ? base.posts[0] : emptyPost()),
      text,
    }));
  }
  return {
    ...base,
    posts,
    tags: plan.tags.length ? plan.tags : base.tags,
    langs: plan.langs && plan.langs.length ? plan.langs : base.langs,
    schedule: plan.mode === 'queue' ? { mode: 'queue' } : base.schedule,
  };
}
