/**
 * Each account's post templates, one net.anisota.feed.template/{tid} record
 * each in its own repo. The shapes and rules are postTemplates.js; this
 * module only reads, writes and remembers them.
 *
 * Every call names the account (`{ did, agent }`), and memory holds each
 * account's templates apart, because the composer can write as any signed-in
 * account and its library follows the one it writes as. `agent` may be the
 * agent itself or a function that resolves to it (the session's `agentFor`),
 * so nothing is signed in for an account until it is read or written.
 *
 * The cache (`virga:templates:<did>`) is filed under the DID the data came
 * from. A failed write is thrown for the editor to show beside the form; the
 * service never reports it anywhere else.
 */

import { TEMPLATES_CHANGED_EVENT, emitPostingEvent } from '../events.js';
import { countGraphemes, truncateGraphemes } from '../lib/graphemes.js';
import {
  TEMPLATE_COLLECTION,
  TEMPLATE_LIMITS,
  normalizeTemplateRecord,
  templateToRecord,
  validateTemplate,
} from './postTemplates.js';

export const TEMPLATES_CACHE_PREFIX = 'virga:templates:';

export function templatesCacheKey(did) {
  return `${TEMPLATES_CACHE_PREFIX}${did}`;
}

export const TEMPLATE_PERMISSION_MESSAGE =
  'Virga needs permission to save templates in your repo. Sign in again to grant it.';

const PAGE_LIMIT = 100;

// ATProto record-key charset. An rkey goes into request bodies and at-uris,
// where a slash would address another record.
const RKEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~:-]{0,511}$/;

const rkeyOf = (uri) =>
  String(uri || '')
    .split('/')
    .pop() || '';
const templateUri = (did, rkey) => `at://${did}/${TEMPLATE_COLLECTION}/${rkey}`;

/* ---- errors ----------------------------------------------------------- */

/**
 * Whether a record read or delete failed because the record isn't there,
 * rather than for any other reason (offline, a 5xx, a refused permission).
 */
export function isRecordNotFound(error) {
  if (!error) return false;
  if (error.error === 'RecordNotFound' || error.code === 'RecordNotFound')
    return true;
  if (typeof error.message === 'string') {
    if (error.message.includes('RecordNotFound')) return true;
    if (/could not (?:locate|find) record/i.test(error.message)) return true;
    if (/record\s+not\s+found/i.test(error.message)) return true;
  }
  return false;
}

/** Whether a write was refused for a permission the sign-in didn't grant. */
export function isPermissionError(error) {
  const text =
    `${error?.error || ''} ${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  return (
    text.includes('scope') ||
    text.includes('permission') ||
    text.includes('not authorized') ||
    text.includes('unauthorized') ||
    text.includes('forbidden')
  );
}

function asWriteError(error) {
  if (!isPermissionError(error)) return error;
  let out = error;
  if (!(out instanceof Error) || !Object.isExtensible(out)) {
    out = new Error(TEMPLATE_PERMISSION_MESSAGE, { cause: error });
  }
  try {
    out.message = TEMPLATE_PERMISSION_MESSAGE;
  } catch {
    out = new Error(TEMPLATE_PERMISSION_MESSAGE, { cause: error });
  }
  out.permission = true;
  return out;
}

/* ---- limits ----------------------------------------------------------- */

// The lexicon caps most strings twice: in graphemes, and in UTF-8 bytes
// (`maxLength`). A PDS stores a record of a collection it has no lexicon for
// as given, so these are held here, against the record as it will be written.
const RECORD_BYTES = Object.freeze({
  name: 640,
  text: 3000,
  group: 640,
  label: 640,
  hint: 2000,
  choice: 3000,
  default: 3000,
});

// A blank's pre-filled answer has the choices' limit.
const DEFAULT_GRAPHEMES = TEMPLATE_LIMITS.choiceGraphemes;

const encoder = new TextEncoder();
const utf8Length = (text) => encoder.encode(String(text || '')).length;
const fits = (text, graphemes, bytes) =>
  countGraphemes(text || '') <= graphemes && utf8Length(text) <= bytes;

function clampText(text, graphemes, bytes) {
  let out = truncateGraphemes(text, graphemes);
  while (out && utf8Length(out) > bytes)
    out = truncateGraphemes(out, countGraphemes(out) - 1);
  return out;
}

/**
 * Cuts each blank's pre-filled answer to the lexicon's limit, in place. The
 * editor has no field for it (one only arrives on a record written
 * elsewhere), so refusing the save would leave nothing to fix.
 */
function clampDefaults(record) {
  for (const v of record?.variables || []) {
    if (!v.default || fits(v.default, DEFAULT_GRAPHEMES, RECORD_BYTES.default))
      continue;
    const cut = clampText(
      v.default,
      DEFAULT_GRAPHEMES,
      RECORD_BYTES.default,
    ).trim();
    if (cut) v.default = cut;
    else delete v.default;
  }
  return record;
}

/**
 * The record's breaches of the lexicon that validateTemplate doesn't look
 * for, as `{ field: message }`: a blank's question, hint and choices, byte
 * lengths, and keywords as written (lower-cased).
 */
function recordLimitErrors(record) {
  const errors = {};
  if (!record) return errors;
  if (utf8Length(record.name) > RECORD_BYTES.name)
    errors.name = 'The name is too long to save.';
  if (utf8Length(record.text) > RECORD_BYTES.text)
    errors.text = 'The text is longer than a post can be.';
  if (record.group && utf8Length(record.group) > RECORD_BYTES.group)
    errors.group = 'The group name is too long to save.';

  for (const v of record.variables || []) {
    const blank = `“${v.key}”`;
    let problem = null;
    if (
      v.label &&
      !fits(v.label, TEMPLATE_LIMITS.labelGraphemes, RECORD_BYTES.label)
    ) {
      problem = `Keep the question for ${blank} under ${TEMPLATE_LIMITS.labelGraphemes} characters.`;
    } else if (
      v.hint &&
      !fits(v.hint, TEMPLATE_LIMITS.hintGraphemes, RECORD_BYTES.hint)
    ) {
      problem = `Keep the hint for ${blank} under ${TEMPLATE_LIMITS.hintGraphemes} characters.`;
    } else if (
      (v.choices || []).some(
        (c) => !fits(c, TEMPLATE_LIMITS.choiceGraphemes, RECORD_BYTES.choice),
      )
    ) {
      problem = `Keep each choice for ${blank} under ${TEMPLATE_LIMITS.choiceGraphemes} characters.`;
    }
    if (problem) {
      errors.variables = problem;
      break;
    }
  }

  // Keywords are capped in UTF-8 bytes only, which is fewer characters for a
  // word with accents, so the message names no number.
  if (
    (record.keywords || []).some(
      (k) => utf8Length(k) > TEMPLATE_LIMITS.keywordLength,
    )
  ) {
    errors.keywords = 'One of the words is too long.';
  }
  return errors;
}

function validationError(fieldErrors) {
  const first = Object.values(fieldErrors)[0];
  const error = new Error(first || 'This template can’t be saved yet.');
  error.fieldErrors = fieldErrors;
  return error;
}

function requireRkey(rkey) {
  if (typeof rkey !== 'string' || !RKEY_PATTERN.test(rkey))
    throw new Error('Template not found');
  return rkey;
}

/* ---- order ------------------------------------------------------------ */

const groupKey = (template) => String(template.group || '').trim();

function compareTemplates(a, b) {
  const ga = groupKey(a);
  const gb = groupKey(b);
  if (ga !== gb) {
    // Ungrouped templates sit after every group.
    if (!ga) return 1;
    if (!gb) return -1;
    return (
      ga.localeCompare(gb, undefined, { sensitivity: 'base' }) ||
      (ga < gb ? -1 : 1)
    );
  }
  return (
    String(a.name || '').localeCompare(String(b.name || ''), undefined, {
      sensitivity: 'base',
    }) || String(a.rkey).localeCompare(String(b.rkey))
  );
}

/* ---- the service ------------------------------------------------------ */

function localStore() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * A template service over `store` (localStorage by default). `target` is
 * where `virga:templates-changed` is dispatched (the window by default; null
 * dispatches nothing). The app uses the one `templateService` below; tests
 * make their own.
 */
export function createTemplateService({ store = localStore(), target } = {}) {
  // did → { byRkey: { rkey: { uri, cid, value } }, confirmed }.
  // `confirmed` is true once a load has read what memory holds; memory filled
  // from the cache is not, so it is read again.
  const accounts = new Map();
  // did → { run, writes }: the load in flight, shared by every caller that
  // asks meanwhile, and the writes adopted while it was out (rkey → entry,
  // or null for a delete), laid over its pages rather than lost under them.
  const inflight = new Map();
  const listeners = new Set();
  // Bumped by reset() (for everyone) and reset(did) (for one account); a load
  // or write that started before lands nowhere.
  let generation = 0;
  const accountGenerations = new Map();
  const generationOf = (did) =>
    `${generation}:${accountGenerations.get(did) || 0}`;

  function readCache(did) {
    if (!did || !store) return {};
    try {
      const raw = store.getItem(templatesCacheKey(did));
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        return {};
      const out = {};
      for (const [rkey, entry] of Object.entries(parsed)) {
        if (
          !entry ||
          typeof entry !== 'object' ||
          !entry.value ||
          typeof entry.value !== 'object'
        )
          continue;
        if (typeof entry.uri !== 'string' || rkeyOf(entry.uri) !== rkey)
          continue;
        out[rkey] = {
          uri: entry.uri,
          cid: typeof entry.cid === 'string' ? entry.cid : null,
          value: entry.value,
        };
      }
      return out;
    } catch {
      return {};
    }
  }

  function writeCache(did) {
    if (!did || !store) return;
    try {
      store.setItem(
        templatesCacheKey(did),
        JSON.stringify(accounts.get(did)?.byRkey || {}),
      );
    } catch {
      // The cache only primes the next visit; templates load regardless.
    }
  }

  function accountFor(did) {
    let account = accounts.get(did);
    if (!account) {
      account = { byRkey: readCache(did), confirmed: false };
      accounts.set(did, account);
    }
    return account;
  }

  function list(did) {
    const account = did ? accounts.get(did) : null;
    if (!account) return [];
    return Object.values(account.byRkey)
      .map((entry) => normalizeTemplateRecord(entry))
      .sort(compareTemplates);
  }

  function emitChanged(did) {
    const templates = list(did);
    for (const listener of listeners) {
      try {
        listener(did, templates);
      } catch {
        // One reader's failure must not keep the rest from hearing.
      }
    }
    if (did)
      emitPostingEvent(TEMPLATES_CHANGED_EVENT, { did, templates }, target);
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  async function agentOf(account) {
    const did = account?.did;
    if (!did) throw new Error('Not signed in');
    const agent =
      typeof account.agent === 'function'
        ? await account.agent(did)
        : account.agent;
    if (!agent?.com?.atproto?.repo) throw new Error('Not signed in');
    // Never write one account's templates with another's session.
    if (agent.did && agent.did !== did)
      throw new Error('That account isn’t the one signed in here.');
    return agent;
  }

  async function fetchAll(agent, did) {
    const fresh = {};
    const seenCursors = new Set();
    let cursor;
    do {
      const response = await agent.com.atproto.repo.listRecords({
        repo: did,
        collection: TEMPLATE_COLLECTION,
        limit: PAGE_LIMIT,
        cursor,
      });
      for (const item of response?.data?.records || []) {
        if (!item?.uri || !item.value || typeof item.value !== 'object')
          continue;
        const rkey = rkeyOf(item.uri);
        if (!rkey) continue;
        fresh[rkey] = {
          uri: item.uri,
          cid: item.cid || null,
          value: item.value,
        };
      }
      cursor = response?.data?.cursor;
      // A PDS that hands back the same cursor would otherwise page forever.
      if (cursor && seenCursors.has(cursor)) break;
      if (cursor) seenCursors.add(cursor);
    } while (cursor);
    return fresh;
  }

  /**
   * Every template in `account.did`'s repo. Replaces memory and the cache,
   * keeping any write made while the pages came in, tells the listeners and
   * resolves to list(did). On failure the cached copy stays and the error is
   * thrown, so a failed read is never mistaken for "no templates".
   */
  function load(account) {
    const did = account?.did;
    if (!did || !account.agent) return Promise.resolve(list(did));
    const shared = inflight.get(did);
    if (shared) return shared.run;

    const startedIn = generationOf(did);
    const writes = new Map();
    const run = (async () => {
      try {
        const agent = await agentOf(account);
        const fresh = await fetchAll(agent, did);
        if (startedIn !== generationOf(did)) return list(did);
        for (const [rkey, written] of writes) {
          if (written) fresh[rkey] = written;
          else delete fresh[rkey];
        }
        accounts.set(did, { byRkey: fresh, confirmed: true });
        writeCache(did);
        emitChanged(did);
        return list(did);
      } catch (error) {
        if (startedIn === generationOf(did)) {
          accountFor(did);
          emitChanged(did);
        }
        throw error;
      } finally {
        if (inflight.get(did)?.run === run) inflight.delete(did);
      }
    })();
    inflight.set(did, { run, writes });
    return run;
  }

  /** Whether memory holds `did`'s templates as a load confirmed them. */
  function isLoaded(did) {
    return !!did && !!accounts.get(did)?.confirmed;
  }

  /** Fills memory from the cache when it holds nothing for `did`; returns list(did). */
  function primeFromCache(did) {
    if (!did) return [];
    const account = accounts.get(did);
    if (!account) accountFor(did);
    else if (!account.confirmed && Object.keys(account.byRkey).length === 0)
      account.byRkey = readCache(did);
    return list(did);
  }

  /**
   * Files a written record locally, unless a reset happened while the write
   * was out. A load in flight for the account hears of it too, so its older
   * pages can't bring back a deleted template or drop a new one.
   */
  function adopt(did, startedIn, rkey, entry) {
    if (startedIn !== generationOf(did)) return;
    const account = accountFor(did);
    inflight.get(did)?.writes.set(rkey, entry || null);
    const byRkey = { ...account.byRkey };
    if (entry) byRkey[rkey] = entry;
    else delete byRkey[rkey];
    account.byRkey = byRkey;
    writeCache(did);
    emitChanged(did);
  }

  function problemsWith(did, template, record) {
    const errors = validateTemplate(template, list(did));
    for (const [field, message] of Object.entries(recordLimitErrors(record))) {
      if (!errors[field]) errors[field] = message;
    }
    return errors;
  }

  /**
   * Save a new template. The PDS mints the TID; the result carries the uri
   * and cid it answered with. A template that doesn't validate is refused
   * before any request, with the problems on `error.fieldErrors`.
   */
  async function create(template, account) {
    const did = account?.did;
    if (!did) throw new Error('Not signed in');
    accountFor(did);
    const isTemplate = !!template && typeof template === 'object';
    const record = isTemplate
      ? clampDefaults(templateToRecord(template, { now: new Date() }))
      : null;
    const fieldErrors = problemsWith(did, template, record);
    if (Object.keys(fieldErrors).length) throw validationError(fieldErrors);

    const startedIn = generationOf(did);
    const agent = await agentOf(account);
    let res;
    try {
      res = await agent.com.atproto.repo.createRecord({
        repo: did,
        collection: TEMPLATE_COLLECTION,
        record,
      });
    } catch (error) {
      throw asWriteError(error);
    }
    // The answer is the response body, under `data`.
    const uri = res?.data?.uri;
    const rkey = rkeyOf(uri);
    if (!rkey)
      throw new Error(
        'The template was sent, but the reply didn’t say where it was saved.',
      );
    const entry = { uri, cid: res?.data?.cid || null, value: record };
    adopt(did, startedIn, rkey, entry);
    return normalizeTemplateRecord(entry);
  }

  /** Save an edit in place, on the same rkey, keeping the record's createdAt. */
  async function update(rkey, template, account) {
    const did = account?.did;
    if (!did) throw new Error('Not signed in');
    requireRkey(rkey);
    const existing = accountFor(did).byRkey[rkey];
    const edited = { ...template, rkey };
    const createdAt =
      existing?.value?.createdAt || template?.createdAt || undefined;
    const record = clampDefaults(
      templateToRecord(
        { ...edited, createdAt },
        { now: new Date(), isUpdate: true },
      ),
    );
    const fieldErrors = problemsWith(did, edited, record);
    if (Object.keys(fieldErrors).length) throw validationError(fieldErrors);

    const startedIn = generationOf(did);
    const agent = await agentOf(account);
    let res;
    try {
      res = await agent.com.atproto.repo.putRecord({
        repo: did,
        collection: TEMPLATE_COLLECTION,
        rkey,
        record,
      });
    } catch (error) {
      throw asWriteError(error);
    }
    const entry = {
      uri: res?.data?.uri || existing?.uri || templateUri(did, rkey),
      cid: res?.data?.cid || null,
      value: record,
    };
    adopt(did, startedIn, rkey, entry);
    return normalizeTemplateRecord(entry);
  }

  /** Delete a template. One already gone counts as deleted. */
  async function remove(rkey, account) {
    const did = account?.did;
    if (!did) throw new Error('Not signed in');
    requireRkey(rkey);
    const startedIn = generationOf(did);
    const agent = await agentOf(account);
    try {
      await agent.com.atproto.repo.deleteRecord({
        repo: did,
        collection: TEMPLATE_COLLECTION,
        rkey,
      });
    } catch (error) {
      // Anything but "already gone" must surface, or the template would leave
      // the library while staying public in the repo.
      if (!isRecordNotFound(error)) throw asWriteError(error);
    }
    adopt(did, startedIn, rkey, null);
  }

  /**
   * Forget what memory holds: for `did`, or for every account. Reads and
   * writes in flight then land nowhere. The cache stays (it is the account's
   * own data); removing the account from the browser clears it.
   */
  function reset(did) {
    const dids = did ? [did] : [...accounts.keys()];
    if (did) {
      accountGenerations.set(did, (accountGenerations.get(did) || 0) + 1);
      accounts.delete(did);
      inflight.delete(did);
    } else {
      generation += 1;
      accounts.clear();
      inflight.clear();
    }
    for (const d of dids) emitChanged(d);
  }

  return {
    collection: TEMPLATE_COLLECTION,
    load,
    list,
    isLoaded,
    primeFromCache,
    create,
    update,
    remove,
    subscribe,
    reset,
  };
}

/** The app's template service. */
export const templateService = createTemplateService();
