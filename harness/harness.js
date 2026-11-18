// The harness put together: the accounts' worlds, Virga's server, the agents
// and the network, read from the page's address. harness/fakeSession.jsx
// builds one of these when it loads; tests build their own.
//
// Address flags (all optional):
//   ?accounts=1      only Mira (the default is Mira and Field Lab)
//   ?mode=browser    accounts are browser sessions (the default is long
//                    sessions through Virga's server, so every page works)
//   ?signedout       start on the front page, both accounts remembered
//   ?expired=lab     that account (by handle) starts signed out; the other is open
//   ?scope=read      the sessions were granted reading only, as before
//                    posting: writes are refused for a missing scope
//   ?defense=on      the sessions were granted Defense's permission too, as
//                    after Turn on Defense (by default they weren't, so the
//                    Defense page offers to ask for it); ?defense=lists the
//                    list writes as well, as after making a first list
//   ?defensewrites=off
//                    Virga's server doesn't write Defense's lists (its
//                    DEFENSE_WRITES isn't on): scans work, lists don't
//   ?appview=failopen|flaky
//                    the signed-in getProfiles leaves known followers off
//                    every answer (failopen: a scan can't count anyone) or
//                    the first answer for each batch (flaky: the canary
//                    catches it and the batch is asked again)
//   ?limits=3,1,1    per-account limits on scheduled posts, plain timers and
//                    conditional timers (the server's SCHEDULED_POSTS_LIMIT,
//                    POST_TIMERS_LIMIT, CONDITIONAL_TIMERS_LIMIT); a blank or
//                    0 leaves that one unlimited. The default is unlimited, as
//                    the server's is, with only its flat caps
//   ?ailimits=30,15,3 the monthly AI allowances: adviser reads, descriptions,
//                    style readings ('unlimited' for none; the default is 30,15,3)
//   ?ai=slow|down    the adviser and alt text take longer than the composer
//                    waits, or are unavailable
//   ?terms=ask|down  nobody has agreed to the Terms of Service and Privacy
//                    Policy yet, so the agreement screen stands in front of
//                    the app; with 'down' the server can't record it either.
//                    By default every account has agreed
//   ?cron=20         how often (seconds) the server's workers run; 0 stops them
//   ?latency=60      simulated delay per request, in ms
//   ?now=<ms>        the moment the made-up world is dated back from. Every
//                    post's address comes from its date, so without this a
//                    reload is a new set of posts; with it, the same ones

import { DEFENSE_TOKENS, LIST_TOKENS, OAUTH_SCOPE } from '../src/config.js';
import { DEFAULT_AI_LIMITS, createServer } from './fakeServer.js';
import { createFakeAgent } from './fakeXrpc.js';
import { installFakeNetwork } from './fakeNetwork.js';
import { LAB, ME, PDS, buildWorld } from './world.js';

/** What a session granted before Virga could post: reading, and follow/unfollow. */
export const READ_ONLY_SCOPE = OAUTH_SCOPE.split(' ')
  .filter(
    (t) =>
      t === 'atproto' ||
      t.includes('getFollowers') ||
      t.includes('listNotifications') ||
      t.startsWith('repo:app.bsky.graph.follow'),
  )
  .join(' ');

/**
 * A granted scope with Defense's permissions set to a level: false (none),
 * true or 'scan' (the read), or 'lists' (the read and the list writes).
 */
export function withDefense(scope, level) {
  const tokens = String(scope || '')
    .split(' ')
    .filter((t) => t && !DEFENSE_TOKENS.includes(t) && !LIST_TOKENS.includes(t));
  const add = level === 'lists' ? [...DEFENSE_TOKENS, ...LIST_TOKENS] : level ? DEFENSE_TOKENS : [];
  return [...tokens, ...add].join(' ');
}

/** `?limits=` as the server's per-feature limits; a blank or 0 is unlimited. */
function readLimits(value) {
  const [scheduledPosts, postTimers, conditionalTimers] = String(value || '')
    .split(',')
    .map((part) => (/^\d+$/.test(part.trim()) && Number(part) > 0 ? Number(part) : undefined));
  return { scheduledPosts, postTimers, conditionalTimers };
}

/** `?ailimits=` as the monthly AI allowances: adviser, altText, style. */
function readAiLimits(value) {
  if (value == null) return { ...DEFAULT_AI_LIMITS };
  if (/^(unlimited|none)$/i.test(value.trim())) return { adviser: null, altText: null, style: null };
  const [adviser, altText, style] = value.split(',').map((part) => (/^\d+$/.test(part.trim()) ? Number(part) : undefined));
  return {
    adviser: adviser ?? DEFAULT_AI_LIMITS.adviser,
    altText: altText ?? DEFAULT_AI_LIMITS.altText,
    style: style ?? DEFAULT_AI_LIMITS.style,
  };
}

/** The flags above, from a query string. */
export function readFlags(search) {
  const params = new URLSearchParams(search);
  const num = (key, fallback) =>
    params.has(key) && Number.isFinite(Number(params.get(key)))
      ? Number(params.get(key))
      : fallback;
  return {
    accounts: params.get('accounts') === '1' ? [ME] : [ME, LAB],
    mode: params.get('mode') === 'browser' ? 'browser' : 'backend',
    signedOut: params.has('signedout'),
    expired: params.get('expired') || null,
    scope: withDefense(
      params.get('scope') === 'read' ? READ_ONLY_SCOPE : OAUTH_SCOPE,
      params.get('defense') === 'lists' ? 'lists' : params.get('defense') === 'on' ? 'scan' : false,
    ),
    appview: ['failopen', 'flaky'].includes(params.get('appview')) ? params.get('appview') : 'ok',
    defenseWrites: params.get('defensewrites') !== 'off',
    limits: readLimits(params.get('limits')),
    aiLimits: readAiLimits(params.get('ailimits')),
    ai: ['slow', 'down'].includes(params.get('ai')) ? params.get('ai') : 'ok',
    terms: ['ask', 'down'].includes(params.get('terms')) ? params.get('terms') : 'agreed',
    cronSeconds: num('cron', 20),
    latency: num('latency', 60),
    now: num('now', 0) > 0 ? num('now', 0) : null,
  };
}

/**
 * @param {ReturnType<typeof readFlags>} flags
 * @param {{ now?: number }} [options]
 */
export function createHarness(flags, { now = flags.now ?? Date.now() } = {}) {
  const worlds = flags.accounts.map((account) => {
    const world = buildWorld({ now, account });
    // What Virga's server reports about the session (/api/oauth/session).
    world.scope = flags.scope;
    world.pdsUrl = PDS;
    return world;
  });
  const server = createServer({
    worlds,
    limits: flags.limits,
    aiLimits: flags.aiLimits,
    ai: flags.ai,
    terms: flags.terms,
    defenseWrites: flags.defenseWrites,
  });
  const agents = new Map();
  const worldOf = (did) => worlds.find((w) => w.me.did === did) || null;

  return {
    flags,
    worlds,
    server,
    worldOf,
    /** What the account's session was granted now. */
    grantOf: (did) => worldOf(did)?.scope ?? flags.scope,
    /**
     * Sign the account in again with or without Defense's permission, as
     * Turn on Defense (and Turn off) does: its agent and Virga's server
     * see the new grant at once. Returns the scope.
     */
    regrant(did, { defense }) {
      const world = worldOf(did);
      if (!world) throw new Error(`harness: no account ${did}`);
      world.scope = withDefense(world.scope, defense);
      return world.scope;
    },
    /** The account's agent: the same one for the life of the page. */
    agentFor(did) {
      if (!agents.has(did)) {
        const world = worlds.find((w) => w.me.did === did);
        if (!world) throw new Error(`harness: no account ${did}`);
        agents.set(
          did,
          createFakeAgent(world, {
            latency: flags.latency,
            worlds,
            // Read at each call: a sign-in that turns Defense on changes it.
            scope: () => world.scope,
            appview: flags.appview,
          }),
        );
      }
      return agents.get(did);
    },
    /**
     * Replace `window.fetch` and start the server's workers. Also puts
     * `window.__harness` on the page: `cron()` runs the workers now,
     * `expire(handle)` ends an account's long session on the server,
     * `refuse(handle)` has its grant refused while the row stays,
     * `agentFor(did)` is the agent the page uses, and `server.inspect()`
     * shows what the server holds.
     */
    install() {
      const agentFor = this.agentFor;
      installFakeNetwork(worlds, { latency: flags.latency, server });
      let timer = null;
      const cron = async () => {
        const { published, settled, listed } = await server.runCron();
        if (listed) console.info(`[harness] the server wrote ${listed} list item(s)`);
        if (published.length || settled.length) {
          console.info(
            `[harness] the server published ${published.length} scheduled post(s) and settled ${settled.length} timer(s)`,
          );
        }
        return { published, settled };
      };
      if (flags.cronSeconds > 0)
        timer = setInterval(cron, flags.cronSeconds * 1000);
      window.__harness = {
        flags,
        worlds,
        server,
        cron,
        agentFor,
        expire(handle) {
          const world = worlds.find((w) => w.me.handle.startsWith(handle));
          if (world) server.expireAccount(world.me.did);
          return Boolean(world);
        },
        refuse(handle) {
          const world = worlds.find((w) => w.me.handle.startsWith(handle));
          if (world) server.refuseGrant(world.me.did);
          return Boolean(world);
        },
        stopCron: () => clearInterval(timer),
      };
    },
  };
}
