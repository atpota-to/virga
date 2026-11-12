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
