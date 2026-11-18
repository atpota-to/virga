// What an owner types to Virga's moderator in a DM, parsed rather than
// interpreted (docs/DEFENSE.md, phase 4). No model is involved anywhere here.
//
// A DM is untrusted text: it comes from whoever is on the other end of the
// conversation, and the moderator answers only accounts that linked it, but
// what they paste can carry anything. So the rule bluesky-mod is built on
// stands: a message either matches a verb here, with its target named in the
// owner's own words (a handle, a DID, a link they pasted, the post they
// shared), or it is not a command. "block them" names nobody, and is asked
// back, never guessed. Nothing a post says can choose a target, because no
// target is ever resolved against anything read.
//
// Ported from bluesky-mod (src/lib/command.js and src/lib/target.js), MIT, for
// the verbs Virga has: scans and plans, approving bands, review, cancel,
// undo, history, one account on or off a list, keeping someone by hand,
// lists, linking and help. The tone labels, reading an account, digests and
// watches come with phases 5 and 7.
//
// Isomorphic: the worker on the droplet parses with it, the tests run it, and
// nothing here touches the network.

/** The bands, for approvals; PROTECTED is never carried by one. */
const BANDS = ['PROTECTED', 'CONNECTED', 'PERIPHERAL', 'NOTABLE', 'UNKNOWN'];

/**
 * Engagement kinds, as harvest.js names them. `everyone` is null: no filter,
 * so engagement from a lexicon harvest discovered is included too.
 */
export const KINDS = Object.freeze({
  likers: ['like'],
  reposters: ['repost'],
  repliers: ['reply', 'threadReply'],
  quoters: ['quote'],
  everyone: null,
});

const HANDLE = /^@?([a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+)$/i;
const DID = /^did:[a-z]+:[a-zA-Z0-9._%-]+$/;
const DID_SYNTAX = /^did:[a-z]+:[a-zA-Z0-9._:%-]*[a-zA-Z0-9._-]$/;
const PROFILE = /\/profile\/([^/?#\s]+)/;
/** A plan's short code: the first eight hex digits of its id. */
const CODE = /^[0-9a-f]{8}$/;
/** A linking code, as Settings shows it: eight letters and digits, a dash in the middle optional. */
const LINK_CODE = /^([A-HJ-NP-Z2-9]{4})-?([A-HJ-NP-Z2-9]{4})$/i;

/** `/profile/<actor>/post/<rkey>`, on any client's host. */
const WEB_POST = /\/profile\/([^/?#]+)\/post\/([^/?#]+)/;
/** A bare at:// URI, the collection left open so non-post targets parse. */
const AT_URI = /^at:\/\/(did:[^/]+)\/([^/]+)\/([^/?#]+)/;
const AT_POST = /^at:\/\/[^/]+\/app\.bsky\.feed\.post\//;

/** A token without the punctuation a sentence leaves on it. */
const bare = (token) => String(token ?? '').replace(/[),.?!:;]+$/, '');

/**
 * A link a client shortened for display ("bsky.app/profile/jo.e..."). What is
 * left of the handle can look like one, so a shortened link is never read; the
 * whole URL is in the message's facets.
 */
const SHORTENED = /\/profile\/\S*(?:\.\.\.|…)/;
const TRUNCATED = /(\.\.\.|…)|bsky\.app|\/profile\//;

const LINK_FEATURE = 'app.bsky.richtext.facet#link';
const MENTION_FEATURE = 'app.bsky.richtext.facet#mention';

/** The short code a plan is named by in a DM: the first eight hex digits of its id. */
export const shortCode = (uuid) => String(uuid || '').replace(/-/g, '').slice(0, 8).toLowerCase();

/** The DID in `at://did:plc:xxx/collection/rkey`, or null. */
export function authorOf(uri) {
  const m = /^at:\/\/(did:[^/]+)\//.exec(String(uri ?? ''));
  return m && DID_SYNTAX.test(m[1]) ? m[1] : null;
}

/** Whether a string looks like a post link or an at:// URI. Cheap; resolves nothing. */
export function looksLikeTarget(input) {
  const raw = String(input ?? '').trim();
  return AT_URI.test(raw) || WEB_POST.test(raw);
}

/** Every candidate target in a message, in order, deduplicated, its brackets and punctuation dropped. */
export function extractTargets(text) {
  const found = [];
  const seen = new Set();
  for (const token of String(text ?? '').split(/\s+/)) {
    const cleaned = token.replace(/^[(<["'“‘]+/, '').replace(/[)>\]"'”’,.!?;]+$/, '');
    if (!looksLikeTarget(cleaned) || seen.has(cleaned)) continue;
    seen.add(cleaned);
    found.push(cleaned);
  }
  return found;
}

/** The full URLs behind a message's links (a client truncates them in the text). */
export function facetLinks(message) {
  const out = [];
  for (const facet of message?.facets || []) for (const f of facet?.features || []) if (f?.$type === LINK_FEATURE && f.uri) out.push(f.uri);
  return out;
}

/** The DIDs behind a message's @mentions, which survive truncation whole. */
export function facetMentions(message) {
  const out = [];
  for (const facet of message?.facets || []) for (const f of facet?.features || []) if (f?.$type === MENTION_FEATURE && f.did) out.push(f.did);
  return out;
}

/** A handle, DID or profile link, as written by the owner, not as inferred. */
export function parseActor(token) {
  // "@did:..." is how the moderator prints an account it has no handle for.
  const raw = String(token ?? '').trim().replace(/^@(?=did:)/, '');
  if (!raw) return null;
  if (DID.test(raw)) return raw;
  const url = raw.match(PROFILE);
  if (url) {
    let actor;
    try {
      actor = decodeURIComponent(url[1]);
    } catch {
      return null; // a stray % in a pasted link; this runs on every word
    }
    if (DID.test(actor)) return actor;
    const m = actor.match(HANDLE);
    return m ? m[1].toLowerCase() : null;
  }
  const m = raw.match(HANDLE);
  return m ? m[1].toLowerCase() : null;
}

const typedActor = (token) => (SHORTENED.test(String(token ?? '')) ? null : parseActor(bare(token)));

/** The one account a message's facets name, or null; two is ambiguous, and refused. */
function oneFromFacets(links, mentions) {
  const named = [...new Set([...mentions, ...links.map(parseActor).filter(Boolean)])];
  return named.length === 1 ? named[0] : null;
}

/** The verbs, most specific first. Each is a capability, and the list should read like one chosen. */
const VERBS = [
  // Bulk first: "list add likers" is not adding an account called "likers".
  { match: /^(?:list\s+)?add\s+(?:the\s+)?(likers|reposters|repliers|quoters|everyone)\b/i, action: 'plan' },
  { match: /^scan\b/i, action: 'scan' },
  { match: /^approve\b/i, action: 'approve' },
  { match: /^review\b/i, action: 'review' },
  { match: /^undo\b/i, action: 'undo' },
  { match: /^history\b/i, action: 'history' },
  // Touches nothing. Anchored to the whole message, so a real question that
  // starts with "help" isn't answered with a menu.
  { match: /^(?:help|commands|what can you do)[\s?!.]*$/i, action: 'help' },
  { match: /^(?:status|progress)[\s?!.]*$/i, action: 'status' },
  { match: /^(?:lists|my lists|show (?:me )?(?:my )?lists)[\s?!.]*$/i, action: 'lists' },
  { match: /^(?:new|make|create)\s+(?:a\s+)?list\b/i, action: 'new_list' },
  { match: /^link\b/i, action: 'link' },
  { match: /^cancel\b/i, action: 'cancel' },
  { match: /^unkeep\b/i, action: 'unkeep' },
  { match: /^keep\b/i, action: 'keep' },
  { match: /^list\s+add\b/i, action: 'list_add' },
  { match: /^list\s+remove\b/i, action: 'list_remove' },
  { match: /^block\b/i, action: 'list_add' },
  { match: /^unblock\b/i, action: 'list_remove' },
];

/** Ways of saying "the one you just did" that need no code. */
const UNDO_LAST = new Set(['last', 'it', 'that', 'this', 'them', 'those']);

/** Words an approval can carry that change nothing about who it adds. */
const APPROVE_FILLER = new Set(['and', 'the', 'only', 'ones', 'accounts', 'please', '&', '+']);

/** The verbs that write. */
const WRITES = new Set(['plan', 'scan', 'approve', 'undo', 'list_add', 'list_remove', 'keep', 'unkeep', 'new_list']);

/** Whether a parsed command would change anything. */
export const isWrite = (cmd) => Boolean(cmd && WRITES.has(cmd.action));

/**
 * Is this message a command, and if so what and against whom?
 *
 * @param {string} text  the message as sent
 * @param {{ embedUri?: string|null, links?: string[], mentions?: string[] }} [opts]
 *   the post the message shared, and its facets' links and mentions
 * @returns {null | object}  null when it isn't a command. A command whose
 *   target can't be read has `needsTarget` set (and, where there is one, a
 *   `refusal` to say back); a caller that only checks `needsTarget` acts on
 *   nobody.
 */
export function parseCommand(text, { embedUri = null, links = [], mentions = [] } = {}) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  const verb = VERBS.find((v) => v.match.test(raw));
  if (!verb) return null;
  const matched = raw.match(verb.match);
  const rest = raw.replace(verb.match, '').trim();

  // A plan names a POST, from the owner's own message: a link they pasted or
  // the post they shared. Never from anything read.
  if (verb.action === 'plan' || verb.action === 'scan') {
    const kind = verb.action === 'plan' ? matched[1].toLowerCase() : 'everyone';
    const target = postTargetIn(raw, { embedUri, links });
    return { action: 'plan', kind, target, needsTarget: !target, raw };
  }

  if (verb.action === 'help' || verb.action === 'lists' || verb.action === 'status') return { action: verb.action, needsTarget: false, raw };

  if (verb.action === 'new_list') {
    const name = rest.replace(/^\s*(?:called|named|for)\s+/i, '').trim().slice(0, 64);
    return { action: 'new_list', name, needsTarget: !name, raw };
  }

  if (verb.action === 'link') {
    const m = bare(rest.split(/\s+/).filter(Boolean)[0] || '').match(LINK_CODE);
    const code = m ? `${m[1]}${m[2]}`.toUpperCase() : null;
    return { action: 'link', code, needsTarget: !code, raw };
  }

  // History names an account or nothing. A name it can't read is asked back:
  // the whole record under that name would read as theirs.
  if (verb.action === 'history') {
    const tokens = rest.split(/\s+/).filter((t) => bare(t));
    if (!tokens.length) return { action: 'history', actor: null, needsTarget: false, raw };
    const actor = (tokens.length === 1 ? typedActor(tokens[0]) : null) ?? oneFromFacets(links, mentions);
    const refusal = actor ? null : `I couldn’t read “${rest.slice(0, 40)}” as an account. Send “history” with a full handle, a DID or a profile link, or “history” alone for everything.`;
    return { action: 'history', actor, refusal, needsTarget: !actor, raw };
  }

  // A bare undo means the newest approval or add. It is the one verb that may
  // default, because it only ever takes people off. A token meant as a code
  // is never defaulted: a typo would undo a batch nobody named.
  if (verb.action === 'undo') {
    const token = bare(rest.split(/\s+/).filter(Boolean)[0]).toLowerCase();
    const code = CODE.test(token) ? token : null;
    const last = !code && (!token || UNDO_LAST.has(token));
    return { action: 'undo', code, last, needsTarget: !last && !code, raw };
  }

  if (verb.action === 'approve' || verb.action === 'cancel' || verb.action === 'review') {
    const words = rest
      .split(/[\s,]+/)
      .map((typed) => ({ typed, token: bare(typed) }))
      .filter((w) => w.token);
    const code = (words.shift()?.token || '').toLowerCase();
    const valid = CODE.test(code);
    const tokens = words.map((w) => w.token);
    const bands = [...new Set(tokens.map((t) => t.toUpperCase()).filter((t) => BANDS.includes(t)))];
    const actors = words.map((w) => typedActor(w.typed)).filter(Boolean);
    const kinds = [...new Set(tokens.map((t) => t.toLowerCase()).filter((t) => t !== 'everyone' && Object.hasOwn(KINDS, t)))];
    const refusal = verb.action === 'approve' && valid ? approvalRefusal(code, { words, bands, actors, kinds }) : null;
    return {
      action: verb.action,
      code: valid ? code : null,
      // PROTECTED is never carried, whatever is typed.
      bands: bands.filter((b) => b !== 'PROTECTED'),
      kinds,
      actors,
      refusal,
      needsTarget: !valid || Boolean(refusal),
      raw,
    };
  }

  // keep @x [why]: the account, then the owner's words for why.
  if (verb.action === 'keep' || verb.action === 'unkeep') {
    const tokens = rest.split(/\s+/).filter(Boolean);
    const typed = tokens.length ? typedActor(tokens[0]) : null;
    const actor = typed ?? oneFromFacets(links, mentions);
    // The first word names the account (typed, or a link a client shortened);
    // whatever follows is why.
    const named = typed || (tokens.length && (TRUNCATED.test(tokens[0]) || tokens[0].startsWith('@')));
    const why = tokens.slice(named ? 1 : 0).join(' ').replace(/^(?:because|as|—|-)\s+/i, '').trim();
    const reason = verb.action === 'keep' && why ? why.slice(0, 200) : null;
    return { action: verb.action, actor, reason, needsTarget: !actor, raw };
  }

  // Exactly one account after the verb. Two is ambiguous, and the safe
  // reading of an ambiguous block is to refuse it.
  const tokens = rest.split(/\s+/).filter(Boolean);
  let actor = tokens.length === 1 ? typedActor(tokens[0]) : null;
  if (!actor) actor = oneFromFacets(links, mentions);
  // A shared post names its author, in the owner's own message. "block" or
  // "block this guy" acts on them; any other words come back asking.
  let fromPost = false;
  let confirm = false;
  if (!actor && embedUri) {
    const did = authorOf(embedUri);
    if (did) {
      actor = did;
      fromPost = true;
      confirm = rest
        .split(/\s+/)
        .filter(Boolean)
        .map((t) => t.toLowerCase().replace(/[^a-z]/g, ''))
        .some((w) => w && !POINTER.has(w));
    }
  }
  return { action: verb.action, actor, fromPost, confirm, needsTarget: !actor, raw };
}

/**
 * Why an approval can't be read one way, said back, or null. An approval
 * names accounts or a group (bands and engagement kinds); a word with no place
 * may be an exception ("UNKNOWN except @friend"), and dropping it would add
 * the opposite of what was asked, so it is refused whole.
 */
function approvalRefusal(code, { words, bands, actors, kinds }) {
  if (bands.length && bands.every((b) => b === 'PROTECTED')) {
    return `Protected accounts are never added, so I haven’t added anyone. Name another band, like “approve ${code} UNKNOWN”, or name the accounts.`;
  }
  const unplaced = words.find(({ typed, token }) => {
    const lower = token.toLowerCase();
    return !(BANDS.includes(token.toUpperCase()) || Object.hasOwn(KINDS, lower) || typedActor(typed) || APPROVE_FILLER.has(lower));
  });
  if (unplaced) {
    return `I couldn’t place “${unplaced.token.slice(0, 40)}” in that approval, so I haven’t added anyone. An approval names bands (“approve ${code} UNKNOWN NOTABLE”), engagement (“approve ${code} UNKNOWN repliers”) or accounts (“approve ${code} @a.example.com”).`;
  }
  if (actors.length && (bands.length || kinds.length)) {
    return `That names accounts and a group at once, so I haven’t added anyone. Approve the accounts (“approve ${code} @a.example.com”) or the group (“approve ${code} UNKNOWN”), one at a time.`;
  }
  if (!actors.length && !bands.length && !kinds.length) {
    return `Which of them? Name a band, like “approve ${code} UNKNOWN”. Protected accounts are never added.`;
  }
  return null;
}

/** Words that point at "the one in the shared post" without naming anyone else. */
const POINTER = new Set([
  'them', 'em', 'they', 'him', 'her', 'it', 'this', 'that', 'these', 'those', 'the', 'a', 'an', 'one', 'guy', 'gal', 'dude',
  'person', 'poster', 'author', 'op', 'account', 'user', 'profile', 'troll', 'please', 'now',
]);

/** Words that can sit beside a pasted post without making the message a question. */
const SCAN_FILLER = new Set(['post', 'this', 'that', 'here', 'scan', 'one', 'is', 'the', 'a', 'an', 'look', 'at', 'check', 'please']);

/** A post's at:// URI, or a /post/ link (always a post). */
const isPostTarget = (t) => !/^at:\/\//.test(t) || AT_POST.test(t);

/** The post a message names: the first in its text, a facet link, or the shared post. Never a list or a feed. */
function postTargetIn(raw, { embedUri = null, links = [] } = {}) {
  return extractTargets(raw).find(isPostTarget) || links.find((l) => extractTargets(l).some(isPostTarget)) || (embedUri && isPostTarget(embedUri) ? embedUri : null);
}

/**
 * A message that is only a post (pasted, shared, or with a word or two such
 * as "this one"), read as "scan it": the post, or null. Anything carrying its
 * own words is a question, and not a scan.
 */
export function parsePostScan(text, { embedUri = null, links = [] } = {}) {
  const raw = String(text ?? '').trim();
  const target = postTargetIn(raw, { embedUri, links });
  if (!target) return null;
  const leftovers = raw
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !extractTargets(t).length && !TRUNCATED.test(t))
    .map((t) => t.toLowerCase().replace(/[^a-z]/g, ''))
    .filter((w) => w && !SCAN_FILLER.has(w));
  return leftovers.length ? null : target;
}

/** The commands the moderator answers, as its help says them. */
export const HELP = [
  'Send a post (or “scan” and its link) to see who engaged with it, sorted by how close each is to you.',
  '“approve <code> UNKNOWN” adds the strangers from that scan to your list. Add NOTABLE, PERIPHERAL or CONNECTED to take more; protected accounts are never added.',
  '“add repliers <post>” scans only who replied (or likers, reposters, quoters, everyone).',
  '“review <code>” names the people near you in a scan. “cancel <code>” drops it.',
  '“block @handle” and “unblock @handle” add or remove one account. “keep @handle” keeps someone off every list.',
  '“undo” takes back the last thing added; “undo <code>” a whole approval. “history @handle” says why someone is on a list.',
  '“lists” names your lists; “status” says what is being written.',
].join('\n');
