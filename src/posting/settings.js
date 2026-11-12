// Each account's posting settings, kept in this browser under
// `virga:posting:<did>` (never on the PDS): the languages and reply and quote
// settings a new post starts with, its default lifespan, the weekly queue,
// what the main button does, and the adviser's setup.
//
// Defaults are never written back. A reader that finds nothing, or a value it
// can't use, gets that key's default; so a setting added later reaches every
// account without a migration.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  POSTING_SETTINGS_EVENT,
  emitPostingEvent,
  onPostingEvent,
} from './events.js';
import { normalizeTimer } from './timers/selfDestruct.js';
import {
  DEFAULT_ADVISER_SETTINGS,
  normalizeAdviserSettings,
} from './adviser/setup.js';
import { DEFAULT_POSTING_QUEUE } from './schedule/postingQueue.js';
import { readDefaultGates as readBlueskyDefaultGates } from './lib/gates.js';

export const POSTING_SETTINGS_PREFIX = 'virga:posting:';

export function postingSettingsKey(did) {
  return `${POSTING_SETTINGS_PREFIX}${did}`;
}

export const DEFAULT_ACTIONS = Object.freeze([
  'post',
  'schedule',
  'queue',
  'draft',
]);

export const WEEKDAY_KEYS = Object.freeze([
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
  'sun',
]);

/** Most posting-language tags a post can carry (app.bsky.feed.post `langs`). */
export const MAX_LANGS = 3;

// More than anyone posts in a day, and few enough that the queue editor
// stays a list rather than a grid.
export const MAX_SLOTS_PER_DAY = 48;

const DEFAULT_LIFESPAN_SECONDS = 86_400;

const SLOT_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
// A BCP-47 tag in the shape posts carry ("en", "pt-BR", "zh-Hant").
const LANG_TAG = /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{1,8})*$/;
const AT_LIST_URI = /^at:\/\/[^/]+\/app\.bsky\.graph\.list\/[^/]+$/;

const isPlainObject = (v) =>
  !!v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.getPrototypeOf(v) === Object.prototype;

function localStore() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** The base of a browser language ("en-GB" → "en"), or null. */
export function baseLanguage(language) {
  const base = String(language || '')
    .trim()
    .split(/[-_]/)[0]
    .toLowerCase();
  return /^[a-z]{2,3}$/.test(base) ? base : null;
}

function browserLanguage() {
  try {
    return typeof navigator === 'undefined' ? null : navigator.language || null;
  } catch {
    return null;
  }
}

function defaultLifespan() {
  return {
    ...normalizeTimer({
      enabled: false,
      lifespanSeconds: DEFAULT_LIFESPAN_SECONDS,
    }),
    deleteAt: null,
  };
}

// A fresh copy of the queue's shipped week, so a caller that edits the
// defaults it was handed never edits them for everyone.
function defaultQueue() {
  const slots = {};
  for (const day of WEEKDAY_KEYS)
    slots[day] = [...(DEFAULT_POSTING_QUEUE.slots[day] || [])];
  return { timezone: DEFAULT_POSTING_QUEUE.timezone, slots };
}

/**
 * The settings an account has before it changes any. `language` is the
 * browser's (navigator.language when left out).
 */
export function defaultPostingSettings({ language = browserLanguage() } = {}) {
  return {
    langs: [baseLanguage(language) || 'en'],
    gates: null,
    lifespan: defaultLifespan(),
    queue: defaultQueue(),
    defaultAction: 'post',
    requireAltText: false,
    showThreadSuggestion: true,
    adviser: normalizeAdviserSettings(DEFAULT_ADVISER_SETTINGS),
    suggestBestTimes: true,
  };
}

/* ---- per-key validation ---------------------------------------------- */

// Each checker returns the value to store, or throws with the reason. The
// reader runs the same checkers and falls back to the default on a throw.

function invalid(field, message) {
  const error = new Error(message);
  error.field = field;
  return error;
}

function checkLangs(value) {
  if (!Array.isArray(value)) throw invalid('langs', 'Languages are a list.');
  const out = [];
  for (const raw of value) {
    const tag = String(raw || '').trim();
    if (!LANG_TAG.test(tag))
      throw invalid('langs', `“${tag}” isn’t a language tag.`);
    if (!out.some((t) => t.toLowerCase() === tag.toLowerCase())) out.push(tag);
  }
  if (out.length > MAX_LANGS)
    throw invalid('langs', `A post can have at most ${MAX_LANGS} languages.`);
  return out;
}

function checkReplyRule(rule) {
  if (!rule || typeof rule !== 'object') return null;
  if (
    rule.type === 'mention' ||
    rule.type === 'follower' ||
    rule.type === 'following'
  ) {
    return { type: rule.type };
  }
  if (
    rule.type === 'list' &&
    typeof rule.list === 'string' &&
    AT_LIST_URI.test(rule.list)
  ) {
    return { type: 'list', list: rule.list };
  }
  return null;
}

function checkGates(value) {
  if (value === null) return null;
  if (!value || typeof value !== 'object')
    throw invalid('gates', 'Reply settings are an object or null.');
  let reply = null;
  if (value.reply !== null && value.reply !== undefined) {
    if (!Array.isArray(value.reply))
      throw invalid(
        'gates',
        'Who can reply is a list of rules, or null for everyone.',
      );
    reply = [];
    for (const raw of value.reply) {
      const rule = checkReplyRule(raw);
      if (!rule)
        throw invalid(
          'gates',
          'One of the reply rules isn’t one Bluesky knows.',
        );
      const same = reply.some(
        (r) => r.type === rule.type && r.list === rule.list,
      );
      if (!same) reply.push(rule);
    }
    // threadgate `allow` holds at most five rules.
    if (reply.length > 5)
      throw invalid('gates', 'Who can reply takes at most five rules.');
  }
  return { reply, quotes: value.quotes !== false };
}

function checkPlainObject(field) {
  return (value) => {
    if (!isPlainObject(value)) throw invalid(field, `${field} is an object.`);
    return value;
  };
}

function isTimeZone(zone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function checkQueue(value) {
  if (!isPlainObject(value))
    throw invalid('queue', 'The weekly schedule is an object.');
  const timezone =
    typeof value.timezone === 'string' ? value.timezone.trim() : '';
  if (timezone && !isTimeZone(timezone))
    throw invalid('queue', `“${timezone}” isn’t a time zone.`);
  const slots = {};
  for (const day of WEEKDAY_KEYS) {
    const raw = value.slots?.[day] ?? [];
    if (!Array.isArray(raw))
      throw invalid('queue', 'Each day is a list of times.');
    const times = [];
    for (const t of raw) {
      if (typeof t !== 'string' || !SLOT_TIME.test(t))
        throw invalid('queue', `“${t}” isn’t a time like 09:30.`);
      if (!times.includes(t)) times.push(t);
    }
    if (times.length > MAX_SLOTS_PER_DAY)
      throw invalid('queue', `A day takes at most ${MAX_SLOTS_PER_DAY} times.`);
    slots[day] = times.sort();
  }
  return { timezone, slots };
}

function checkAction(value) {
  if (!DEFAULT_ACTIONS.includes(value))
    throw invalid('defaultAction', `“${value}” isn’t an action.`);
  return value;
}

function checkBoolean(field) {
  return (value) => {
    if (typeof value !== 'boolean')
      throw invalid(field, `${field} is true or false.`);
    return value;
  };
}

const CHECKERS = {
  langs: checkLangs,
  gates: checkGates,
  lifespan: checkPlainObject('lifespan'),
  queue: checkQueue,
  defaultAction: checkAction,
  requireAltText: checkBoolean('requireAltText'),
  showThreadSuggestion: checkBoolean('showThreadSuggestion'),
  adviser: checkPlainObject('adviser'),
  suggestBestTimes: checkBoolean('suggestBestTimes'),
};

export const POSTING_SETTING_KEYS = Object.freeze(Object.keys(CHECKERS));

/* ---- read and write --------------------------------------------------- */

function readStored(did, store) {
  if (!did || !store) return {};
  try {
    const parsed = JSON.parse(store.getItem(postingSettingsKey(did)) || 'null');
    return isPlainObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// The two objects stored as given are shaped by the modules that own them.
function normalizeLifespan(raw) {
  return { ...normalizeTimer(raw), deleteAt: null };
}

/**
 * `did`'s posting settings: every key present, each one stored value that
 * passes its check, the default otherwise. `lifespan` comes back through
 * normalizeTimer (never pinned to a time) and `adviser` through
 * normalizeAdviserSettings.
 */
export function readPostingSettings(
  did,
  store = localStore(),
  { language } = {},
) {
  const defaults = defaultPostingSettings(
    language === undefined ? {} : { language },
  );
  const stored = readStored(did, store);
  const out = { ...defaults };
  for (const [key, check] of Object.entries(CHECKERS)) {
    if (!Object.hasOwn(stored, key)) continue;
    try {
      out[key] = check(stored[key]);
    } catch {
      // An unreadable value reads as the default and is left for the next write.
    }
  }
  out.lifespan = normalizeLifespan(out.lifespan);
  out.adviser = normalizeAdviserSettings(
    isPlainObject(out.adviser) ? out.adviser : DEFAULT_ADVISER_SETTINGS,
  );
  return out;
}

/**
 * Merge `patch` into `did`'s stored settings and return them as
 * readPostingSettings would. Unknown keys are ignored; a known key with a
 * value it can't take throws (with `error.field`) before anything is written.
 * Only the keys that were stored or patched are written, so defaults keep
 * following the app. Dispatches `virga:posting-settings`.
 */
export function writePostingSettings(
  did,
  patch,
  store = localStore(),
  { target } = {},
) {
  if (!did) throw new Error('Posting settings belong to an account.');
  const checked = {};
  for (const [key, value] of Object.entries(
    isPlainObject(patch) ? patch : {},
  )) {
    if (!CHECKERS[key]) continue;
    checked[key] = CHECKERS[key](value);
  }
  const stored = readStored(did, store);
  const next = { ...stored, ...checked };
  try {
    store?.setItem(postingSettingsKey(did), JSON.stringify(next));
  } catch {
    // Kept for this visit only: the event still tells the open pages.
  }
  const settings = readPostingSettings(did, store);
  // A live view of a settings page can't wait on storage that refused the write.
  for (const key of Object.keys(checked)) {
    if (key === 'lifespan')
      settings.lifespan = normalizeLifespan(checked.lifespan);
    else if (key === 'adviser')
      settings.adviser = normalizeAdviserSettings(checked.adviser);
    else settings[key] = checked[key];
  }
  emitPostingEvent(POSTING_SETTINGS_EVENT, { did, settings }, target);
  return settings;
}

/**
 * The reply and quote settings a new post starts with, when the writer
 * hasn't chosen any for it (`gates.custom` false):
 *
 *   1. the account's posting settings (`settings.gates`), when set;
 *   2. else its Bluesky setting, read with that account's `agent`
 *      (lib/gates.js readDefaultGates, which gives up after 7 s);
 *   3. else everyone may reply and quote, with a notice saying why.
 *
 * Returns `{ gates: { custom: false, reply, quotes }, source, notice }`.
 */
export async function resolveDefaultGates(
  settings,
  { agent, readDefaultGates = readBlueskyDefaultGates } = {},
) {
  if (settings?.gates) {
    return {
      gates: { custom: false, ...checkGates(settings.gates) },
      source: 'settings',
      notice: null,
    };
  }
  if (agent && typeof readDefaultGates === 'function') {
    try {
      const found = await readDefaultGates(agent);
      if (found && typeof found === 'object') {
        return {
          gates: {
            custom: false,
            ...checkGates({ reply: found.reply ?? null, quotes: found.quotes }),
          },
          source: 'bluesky',
          notice: null,
        };
      }
    } catch {
      // Falls through to everyone, said out loud.
    }
  }
  return {
    gates: { custom: false, reply: null, quotes: true },
    source: 'everyone',
    notice:
      'Couldn’t read your reply settings from Bluesky, so anyone can reply and quote this post.',
  };
}

/* ---- the hook --------------------------------------------------------- */

/**
 * `did`'s posting settings, kept current across the app and other tabs:
 * `{ settings, update(patch), reset(keys?) }`. `update` throws as
 * writePostingSettings does.
 */
export function usePostingSettings(did) {
  const [state, setState] = useState(() => ({
    did,
    settings: readPostingSettings(did),
  }));
  const settings =
    state.did === did ? state.settings : readPostingSettings(did);

  useEffect(() => {
    setState((s) =>
      s.did === did ? s : { did, settings: readPostingSettings(did) },
    );
    if (!did) return undefined;
    const off = onPostingEvent(
      POSTING_SETTINGS_EVENT,
      (detail) => setState({ did, settings: detail.settings }),
      { did },
    );
    const onStorage = (event) => {
      if (event.key === postingSettingsKey(did))
        setState({ did, settings: readPostingSettings(did) });
    };
    if (typeof window !== 'undefined')
      window.addEventListener('storage', onStorage);
    return () => {
      off();
      if (typeof window !== 'undefined')
        window.removeEventListener('storage', onStorage);
    };
  }, [did]);

  const update = useCallback(
    (patch) => {
      const next = writePostingSettings(did, patch);
      setState({ did, settings: next });
      return next;
    },
    [did],
  );

  const reset = useCallback(
    (keys) => {
      const store = localStore();
      if (!did || !store) return readPostingSettings(did);
      const stored = readStored(did, store);
      const drop = Array.isArray(keys) ? keys : Object.keys(stored);
      for (const key of drop) delete stored[key];
      try {
        store.setItem(postingSettingsKey(did), JSON.stringify(stored));
      } catch {
        // Nothing to undo: the defaults below are what the page shows.
      }
      const next = readPostingSettings(did, store);
      emitPostingEvent(POSTING_SETTINGS_EVENT, { did, settings: next });
      setState({ did, settings: next });
      return next;
    },
    [did],
  );

  return useMemo(
    () => ({ settings, update, reset }),
    [settings, update, reset],
  );
}
