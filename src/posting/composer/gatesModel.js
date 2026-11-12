// The reply rules GatesEditor edits, as plain list operations. `reply` is
// ComposerState.gates.reply: null (anyone), [] (nobody) or rules.

import { MAX_REPLY_RULES } from '../lib/gates.js';

export const RULE_OPTIONS = Object.freeze([
  { type: 'mention', label: 'People you mention' },
  { type: 'following', label: 'People you follow' },
  { type: 'follower', label: 'Your followers' },
]);

const sameRule = (a, b) =>
  a?.type === b?.type && (a.type !== 'list' || a.list === b.list);

/** 'everyone', 'nobody' or 'some'. */
export function replyMode(reply) {
  if (!Array.isArray(reply)) return 'everyone';
  return reply.length === 0 ? 'nobody' : 'some';
}

export function hasRule(reply, rule) {
  return Array.isArray(reply) && reply.some((r) => sameRule(r, rule));
}

/**
 * `reply` with `rule` added or taken out. Never takes out the last rule (an
 * empty list would mean nobody), and never adds past the five a threadgate
 * holds.
 */
export function toggleRule(reply, rule) {
  const list = Array.isArray(reply) ? reply : [];
  if (hasRule(list, rule)) {
    return list.length > 1 ? list.filter((r) => !sameRule(r, rule)) : list;
  }
  if (list.length >= MAX_REPLY_RULES) return list;
  return [
    ...list,
    rule.type === 'list'
      ? { type: 'list', list: rule.list }
      : { type: rule.type },
  ];
}

/** A hint under the rules, or ''. */
export function rulesNote(reply) {
  if (!Array.isArray(reply) || reply.length === 0) return '';
  if (reply.length >= MAX_REPLY_RULES)
    return `That’s the most a post can have: ${MAX_REPLY_RULES} groups.`;
  if (reply.length === 1) return 'Choose at least one group, or choose Nobody.';
  return '';
}

// The account a list belongs to: the repo in its at:// URI.
const listOwner = (uri) => (typeof uri === 'string' ? uri.match(/^at:\/\/([^/]+)\//)?.[1] || '' : '');

/** Whether a list rule names a list `did` doesn't own. */
export function isForeignListRule(rule, did) {
  return rule?.type === 'list' && listOwner(rule.list) !== did;
}

/**
 * Gates as they can go out from `did`: a threadgate may only name the
 * writer's own lists (and one naming another account's list would tie the
 * two accounts together in public), so list rules from another account come
 * out. `{ gates, dropped }`, where `dropped` counts them; when they were all
 * the rules there were, the gates go back to `did`'s default (custom false)
 * rather than read as "nobody".
 */
export function gatesForAccount(gates, did) {
  const reply = gates?.reply;
  if (!Array.isArray(reply)) return { gates, dropped: 0 };
  const kept = reply.filter((r) => !isForeignListRule(r, did));
  const dropped = reply.length - kept.length;
  if (!dropped) return { gates, dropped: 0 };
  if (!kept.length) return { gates: { ...gates, custom: false, reply: null }, dropped, reset: true };
  return { gates: { ...gates, reply: kept }, dropped, reset: false };
}

/**
 * The list rules in `reply` that none of `listUris` (the account's own lists)
 * accounts for: another account's list, or one since deleted. The editor
 * still shows these, so they can be taken out.
 */
export function unlistedRules(reply, listUris = []) {
  if (!Array.isArray(reply)) return [];
  const known = new Set(listUris);
  return reply.filter((r) => r?.type === 'list' && !known.has(r.list));
}
