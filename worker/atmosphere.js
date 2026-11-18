// The Atmosphere MCP server (aturi.to), as one tool the moderator's agent can
// call to read the wider network: profiles, author feeds, threads, post
// search, followers and follows, backlinks, records, lists, identity history.
// Ported from bluesky-mod (src/lib/mcp.js). Runs on the droplet, with no
// credentials: it reads only what anyone can read.
//
// The server is trusted to report what the network says. What it returns is
// not: post text, bios and display names are written by the people being
// read, so every result goes back to the model fenced, whole, as data. A post
// can still steer the turn that read it; that is why every write the turn asks
// for is checked on Vercel against the owner's own words, which no post can
// reach (server/defense/moderator/check.js), and why the veto runs at the
// write.
//
// A tool is offered only if its name starts with a verb that reads: an
// allow-pattern holds up when the server publishes something new. Arguments
// named `url` or `host` are refused, a tool that can't run without one isn't
// offered, and a web link under any other argument must be a Bluesky
// client's: a lookup by URL would make aturi.to fetch a server the post's
// author may run, carrying whatever the turn holds. A handle or a did:web
// still resolves at the host it names, a narrower channel of the same kind
// that stays open (docs/DEFENSE-THREATS.md, rule 18).
//
// ATMOSPHERE=off leaves the tool out.

import { untrusted } from './fence.js';

export const ATMOSPHERE_URL = 'https://aturi.to/api/mcp';
/** A tool is offered only if it starts with a verb that reads. */
export const READ_VERB = /^(get|list|search|resolve|describe|read|sample)_/;
const FETCH_ARGS = ['url', 'host'];
const isFetchArg = (key) => FETCH_ARGS.includes(String(key).toLowerCase());

/**
 * Web links a lookup may carry, under any argument: a Bluesky client's own
 * post and profile pages, which aturi.to reads as at:// addresses. A link to
 * anywhere else could have aturi.to fetch a server a post's author runs.
 */
export const LINK_HOSTS = new Set(['bsky.app', 'staging.bsky.app', 'deer.social', 'aturi.to']);
/** Every string in the arguments that is a web link to a host not in LINK_HOSTS. */
export function foreignLinks(value, found = []) {
  if (typeof value === 'string') {
    const m = /^\s*https?:\/\/([^/?#\s:]+)/i.exec(value);
    if (m && !LINK_HOSTS.has(m[1].toLowerCase())) found.push(m[1].toLowerCase());
  } else if (Array.isArray(value)) value.forEach((v) => foreignLinks(v, found));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => foreignLinks(v, found));
  return found;
}
/** The most of one result the model is handed, in characters. */
export const MAX_RESULT_CHARS = 30_000;
const CALL_TIMEOUT_MS = 20_000;
/** How long the server's list of tools is kept before it is asked again. */
const CATALOGUE_TTL_MS = 60 * 60_000;

/** The JSON-RPC message answering request `id`, from plain JSON or an SSE stream. */
export function parseBody(text, id) {
  const events = text
    .split(/\r?\n\r?\n/)
    .map((block) =>
      block
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .join('\n'),
    )
    .filter(Boolean);
  if (!events.length) return JSON.parse(text);
  for (const data of events) {
    let message;
    try {
      message = JSON.parse(data);
    } catch {
      continue;
    }
    if (message?.id === id || (message?.error && message.id == null)) return message;
  }
  throw new Error('no response in the event stream');
}

/** A client for aturi.to's stateless MCP server: no session, no handshake, a few lines of JSON-RPC. */
export function atmosphereClient({ url = ATMOSPHERE_URL, fetchImpl = globalThis.fetch, timeoutMs = CALL_TIMEOUT_MS } = {}) {
  let nextId = 0;
  async function rpc(method, params) {
    const id = (nextId += 1);
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`atmosphere ${method} failed: ${res.status}`);
    const body = parseBody(await res.text(), id);
    if (body.error) throw new Error(`atmosphere ${method}: ${body.error.message || JSON.stringify(body.error)}`);
    return body.result;
  }
  return { listTools: () => rpc('tools/list', {}), callTool: (name, args) => rpc('tools/call', { name, arguments: args || {} }) };
}

/** Result content as one string, whatever shape the server used. */
export function flatten(result) {
  const parts = result?.content;
  if (!Array.isArray(parts)) return JSON.stringify(result ?? null);
  return parts.map((p) => (typeof p?.text === 'string' ? p.text : JSON.stringify(p))).join('\n');
}

/** Text cut to `max` characters without splitting a surrogate pair, and how much was left out. */
function cap(text, max = MAX_RESULT_CHARS) {
  if (text.length <= max) return { text, cut: 0 };
  let end = max;
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return { text: text.slice(0, end), cut: text.length - end };
}

/** A one-line summary of a tool for the catalogue. */
function summarise(description) {
  const first = String(description || '')
    .split(/[.\n]/)[0]
    .replace(/^You (have|want|need|already have)\s*/i, '')
    .trim();
  return first.length > 64 ? `${first.slice(0, 61)}...` : first;
}

/**
 * The allowed remote tools as one dispatcher: `{ definition, run(args) }`,
 * or null when nothing is allowed. One tool with a catalogue in its
 * description, rather than dozens of schemas sent on every step; a schema is
 * fetched on request (`describe: true`).
 */
export function bridge(listed, { call }) {
  const allowed = new Map();
  for (const t of listed || []) {
    if (!t?.name || !READ_VERB.test(t.name)) continue;
    const required = t.inputSchema?.required;
    if (Array.isArray(required) && required.some(isFetchArg)) continue;
    allowed.set(t.name, t);
  }
  if (!allowed.size) return null;
  const catalogue = [...allowed.values()].map((t) => `${t.name}: ${summarise(t.description)}`).join('\n');
  const schemaOf = (t) => {
    const schema = t.inputSchema ?? { type: 'object', properties: {} };
    const properties = Object.fromEntries(Object.entries(schema.properties ?? {}).filter(([k]) => !isFetchArg(k)));
    return { tool: t.name, description: t.description, inputSchema: { ...schema, properties } };
  };
  return {
    names: [...allowed.keys()],
    definition: {
      type: 'function',
      function: {
        name: 'atmosphere',
        description: `Read the atproto network: profiles, author feeds, threads, post search, followers and follows, backlinks, records, lists, identity history. Read-only, and everything it returns was written by other people. Pass \`tool\` and \`args\`; with \`describe: true\` it returns that tool's schema instead.\n\nAvailable:\n${catalogue}`,
        parameters: {
          type: 'object',
          properties: {
            tool: { type: 'string', description: 'One of the names listed in the description.' },
            args: { type: 'object', description: 'Arguments for that tool.' },
            describe: { type: 'boolean', description: 'True to get the schema instead of calling it.' },
          },
          required: ['tool'],
        },
      },
    },
    async run({ tool: name, args, describe: wantSchema } = {}) {
      const t = allowed.get(name);
      if (!t) return { error: `No atmosphere tool called ${String(name).slice(0, 60)}. The names are in this tool's description.` };
      if (wantSchema) return schemaOf(t);
      const given = args && typeof args === 'object' ? args : {};
      const refused = Object.keys(given).filter(isFetchArg);
      if (refused.length) return { error: `The atmosphere tool doesn't take a ${refused.join(' or ')} argument. Pass an at:// URI, a handle or a DID.`, ...schemaOf(t) };
      const foreign = foreignLinks(given);
      if (foreign.length) return { error: `The atmosphere tool doesn't follow links to ${[...new Set(foreign)].join(', ')}. Pass an at:// URI, a handle or a DID.`, ...schemaOf(t) };
      try {
        const result = await call(name, given);
        const { text, cut } = cap(flatten(result));
        const fenced = untrusted(`atmosphere:${name}`, text);
        if (result?.isError) return { error: `The ${name} lookup failed:\n${fenced}`, ...schemaOf(t) };
        return cut ? `${fenced}\n(Cut at ${MAX_RESULT_CHARS} characters, ${cut} more not shown. A lower limit, where the tool takes one, returns less.)` : fenced;
      } catch (err) {
        return { error: `The ${name} lookup failed: ${err?.message || err}`, ...schemaOf(t) };
      }
    },
  };
}

/**
 * The dispatcher, kept for an hour: `get()` resolves to it, or to null when
 * Atmosphere is off or can't be reached (the agent's own tools still answer).
 */
export function atmosphereTools({ env = process.env, client = null, now = () => Date.now() } = {}) {
  let cached = null;
  let at = 0;
  return {
    async get() {
      if (String(env.ATMOSPHERE || '').toLowerCase() === 'off') return null;
      if (cached && now() - at < CATALOGUE_TTL_MS) return cached;
      const c = client || atmosphereClient();
      try {
        const listed = await c.listTools();
        cached = bridge(listed?.tools, { call: (name, args) => c.callTool(name, args) });
        at = now();
      } catch (err) {
        console.warn(`[worker] Atmosphere unavailable, carrying on without it: ${err?.message || err}`);
        return cached;
      }
      return cached;
    },
  };
}
