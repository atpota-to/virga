// A DM to the moderator, read the same way on both sides: the worker on the
// droplet, which reads the moderator's DMs, and Vercel, which reads each one
// back with its own key before acting on it (docs/DEFENSE-THREATS.md, rule
// 16). Isomorphic and pure.

import { facetLinks, facetMentions } from './command.js';

const DIRECT = 'chat.bsky.convo.defs#directConvo';

/** The record a message shares (a post, or anything else), as an at:// URI, or null. */
export function sharedUri(message) {
  const uri = message?.embed?.record?.uri ?? message?.embed?.record?.record?.uri;
  return typeof uri === 'string' && uri.startsWith('at://') ? uri : null;
}

/** Whether a conversation is one to one, by its kind or, failing that, its members. */
export function isDirect(convo) {
  const kind = convo?.kind?.$type;
  if (kind) return kind === DIRECT;
  return Array.isArray(convo?.members) && convo.members.length === 2;
}

/**
 * What a model is given of the owner's message: what they typed, plus the
 * record they shared, the full links and the mentioned DIDs. Those lines are
 * built by code from the owner's own message.
 */
export function composeMessage(message) {
  const text = String(message?.text || '');
  const extra = [];
  const shared = sharedUri(message);
  if (shared) extra.push(`The post the owner shared: ${shared}`);
  const links = facetLinks(message).filter((l) => !text.includes(l));
  if (links.length) extra.push(`Full links in that message: ${links.join(' ')}`);
  const mentions = facetMentions(message);
  if (mentions.length) extra.push(`Accounts mentioned: ${mentions.join(' ')}`);
  return extra.length ? `${text}\n\n[${extra.join('. ')}]` : text;
}

/** A yes, a no, or neither (null), to a question the moderator asked. */
export function answerTo(text) {
  const t = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[.!\s]+$/, '');
  if (/^(yes|y|yep|yeah|yup|ok|okay|sure|do it|go ahead|go on|please do|confirm|👍(?:[\u{1F3FB}-\u{1F3FF}])?)$/u.test(t)) return 'yes';
  if (/^(no|n|nope|don'?t|do not|cancel|stop|never ?mind|👎(?:[\u{1F3FB}-\u{1F3FF}])?)$/u.test(t)) return 'no';
  return null;
}
