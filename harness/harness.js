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
//   ?limits=3,1,1    per-account limits on scheduled posts, plain timers and
//                    conditional timers (the server's SCHEDULED_POSTS_LIMIT,
//                    POST_TIMERS_LIMIT, CONDITIONAL_TIMERS_LIMIT); a blank or
//                    0 leaves that one unlimited. The default is unlimited, as
//                    the server's is, with only its flat caps
//   ?ailimits=30,15,3 the monthly AI allowances: adviser reads, descriptions,
//                    style readings ('unlimited' for none; the default is 30,15,3)
//   ?ai=slow|down    the adviser and alt text take longer than the composer
//                    waits, or are unavailable
//   ?cron=20         how often (seconds) the server's workers run; 0 stops them
//   ?latency=60      simulated delay per request, in ms

import { OAUTH_SCOPE } from '../src/config.js';
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
    scope: params.get('scope') === 'read' ? READ_ONLY_SCOPE : OAUTH_SCOPE,
    limits: readLimits(params.get('limits')),
    aiLimits: readAiLimits(params.get('ailimits')),
    ai: ['slow', 'down'].includes(params.get('ai')) ? params.get('ai') : 'ok',
    cronSeconds: num('cron', 20),
    latency: num('latency', 60),
  };
}

/**
 * @param {ReturnType<typeof readFlags>} flags
 * @param {{ now?: number }} [options]
 */
export function createHarness(flags, { now = Date.now() } = {}) {
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
  });
  const agents = new Map();

  return {
    flags,
    worlds,
    server,
    worldOf: (did) => worlds.find((w) => w.me.did === did) || null,
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
            scope: flags.scope,
          }),
        );
      }
      return agents.get(did);
    },
    /**
     * Replace `window.fetch` and start the server's workers. Also puts
     * `window.__harness` on the page: `cron()` runs the workers now,
     * `expire(handle)` ends an account's long session on the server,
     * `agentFor(did)` is the agent the page uses, and `server.inspect()`
     * shows what the server holds.
     */
    install() {
      const agentFor = this.agentFor;
      installFakeNetwork(worlds, { latency: flags.latency, server });
      let timer = null;
      const cron = async () => {
        const { published, settled } = await server.runCron();
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
        stopCron: () => clearInterval(timer),
      };
    },
  };
}
