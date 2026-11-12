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
//   ?tier=member     the accounts are members (no free limits on Virga's server)
//   ?limits=flat     Virga's server applies only its flat caps (VIRGA_FEATURE_LIMITS=flat)
//   ?ai=slow|down    the adviser and alt text take longer than the composer
//                    waits, or are unavailable
//   ?cron=20         how often (seconds) the server's workers run; 0 stops them
//   ?latency=60      simulated delay per request, in ms

import { OAUTH_SCOPE } from '../src/config.js';
import { createCocoon } from './fakeCocoon.js';
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
    tier: params.get('tier') === 'member' ? 'member' : null,
    policy: params.get('limits') === 'flat' ? 'flat' : 'membership',
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
    // What Virga's server reports about the session (/oauth/session).
    world.scope = flags.scope;
    world.pdsUrl = PDS;
    return world;
  });
  const tiers = Object.fromEntries(worlds.map((w) => [w.me.did, flags.tier]));
  const cocoon = createCocoon({
    worlds,
    policy: flags.policy,
    tiers,
    ai: flags.ai,
  });
  const agents = new Map();

  return {
    flags,
    worlds,
    cocoon,
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
     * `agentFor(did)` is the agent the page uses, and `cocoon.inspect()`
     * shows what the server holds.
     */
    install() {
      const agentFor = this.agentFor;
      installFakeNetwork(worlds, { latency: flags.latency, cocoon });
      let timer = null;
      const cron = async () => {
        const { published, settled } = await cocoon.runCron();
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
        cocoon,
        cron,
        agentFor,
        expire(handle) {
          const world = worlds.find((w) => w.me.handle.startsWith(handle));
          if (world) cocoon.expireAccount(world.me.did);
          return Boolean(world);
        },
        stopCron: () => clearInterval(timer),
      };
    },
  };
}
