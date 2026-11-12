// The composer's defaults for a post that hasn't been given its own: the
// account's default timer (DESIGN.md §6.6, armed only when Virga's server
// says there's a free timer), and the words for where the reply settings
// came from.

import {
  defaultRuleFromSettings,
  normalizeTimer,
  timerRoomProblem,
} from '../timers/selfDestruct.js';

export const TIMER_NEEDS_SERVER =
  'Timers need a long session through Virga’s server, so this post has none.';
export const TIMER_LIMITS_UNKNOWN =
  'Couldn’t check whether a timer is free, so the default timer is off for this post.';
export const NO_FREE_TIMER = 'No free timer: post without it, or keep editing.';

/**
 * The timer a fresh post starts with: `{ rule, note, pending }`.
 *
 *   rule     the account's default (settings.lifespan), armed only when
 *            `limits` shows room for it; otherwise the same rule, off
 *   note     why a default that is on was left off, or ''
 *   pending  limits are still being read, so the rule is off for now
 *
 * @param {object} settings - readPostingSettings(did)
 * @param {object} options
 * @param {boolean} options.canSchedule - the account has a long session
 * @param {'idle'|'loading'|'ready'|'error'} options.limitsStatus
 * @param {object|null} options.limits - getLimits' answer
 * @param {{ available: boolean }} [options.fit]
 */
export function defaultTimerFor(
  settings,
  { canSchedule, limitsStatus, limits, fit } = {},
) {
  const rule = normalizeTimer(defaultRuleFromSettings(settings?.lifespan));
  const off = (note = '', pending = false) => ({
    rule: { ...rule, enabled: false },
    note,
    pending,
  });
  if (!rule.enabled) return { rule, note: '', pending: false };
  if (!canSchedule || fit?.available === false) return off(TIMER_NEEDS_SERVER);
  if (limitsStatus === 'loading' || limitsStatus === 'idle')
    return off('', true);
  if (limitsStatus !== 'ready') return off(TIMER_LIMITS_UNKNOWN);
  const problem = timerRoomProblem(rule, limits);
  if (problem) return off(problem);
  return { rule, note: '', pending: false };
}

/** A line about where this post's reply settings came from. */
export function gatesSourceLine(info, { reply = false } = {}) {
  if (reply) return 'A reply follows the settings of the thread it joins.';
  if (!info) return '';
  if (info.custom) return 'Set for this post.';
  if (info.status === 'loading') return 'Reading your reply settings…';
  if (info.source === 'settings') return 'From your posting settings in Virga.';
  if (info.source === 'bluesky') return 'From your Bluesky settings.';
  return info.notice || '';
}

/** A short summary of who may reply and quote, for the composer's options row. */
export function gatesSummary(gates) {
  const reply = gates?.reply;
  let who;
  if (reply == null) who = 'Anyone can reply';
  else if (reply.length === 0) who = 'Nobody can reply';
  else {
    const names = reply
      .map((r) =>
        r?.type === 'mention'
          ? 'people you mention'
          : r?.type === 'follower'
            ? 'your followers'
            : r?.type === 'following'
              ? 'people you follow'
              : r?.type === 'list'
                ? 'a list'
                : null,
      )
      .filter(Boolean);
    const lists = names.filter((n) => n === 'a list').length;
    const plain = [...new Set(names.filter((n) => n !== 'a list'))];
    if (lists) plain.push(lists === 1 ? 'one list' : `${lists} lists`);
    who = `Replies: ${plain.join(', ') || 'some people'}`;
  }
  return gates?.quotes === false ? `${who} · No quotes` : who;
}
