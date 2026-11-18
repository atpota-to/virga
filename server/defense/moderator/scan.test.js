// A scan by DM: the owner's own session for the vouches, the owner's public
// graph for the canary, a deadline that points a big post at the web.

import { describe, expect, it, vi } from 'vitest';
import { DmScanError, publicCandidates, scanForOwner } from './scan.js';

const OWNER = 'did:plc:owner';

function fakeAgent() {
  const asked = [];
  class Agent {
    constructor(session) {
      this.session = session;
    }
    withProxy(type, did) {
      asked.push(`${did}#${type}`);
      return {
        app: {
          bsky: {
            actor: {
              getProfiles: async ({ actors }) => ({ data: { profiles: actors.map((did) => ({ did, viewer: { knownFollowers: { count: 0, followers: [] } } })) } }),
            },
          },
        },
      };
    }
  }
  return { Agent, asked };
}

describe('a scan by DM', () => {
  it('reads vouches with the owner’s own session, and only the engagement asked for', async () => {
    const { Agent, asked } = fakeAgent();
    const restore = vi.fn(async (did) => ({ did }));
    const harvest = vi.fn(async () => ({ participants: [] }));
    const scan = vi.fn(async (opts) => {
      await opts.harvest('at://x/app.bsky.feed.post/1', {});
      await opts.getProfiles(['did:plc:a']);
      return { totals: { participants: 0 } };
    });
    await scanForOwner({ ownerDid: OWNER, input: 'at://x/app.bsky.feed.post/1', only: ['reply'], deps: { restore, Agent, harvest, scan, candidates: async () => ['did:plc:c'] } });
    expect(restore).toHaveBeenCalledWith(OWNER);
    expect(asked).toEqual(['did:web:api.bsky.app#bsky_appview']);
    expect(harvest).toHaveBeenCalledWith('at://x/app.bsky.feed.post/1', { only: ['reply'] });
    expect(scan.mock.calls[0][0]).toMatchObject({ ownerDid: OWNER, candidates: ['did:plc:c'] });
  });

  it('says so when there’s no long session to read vouches with', async () => {
    await expect(scanForOwner({ ownerDid: OWNER, input: 'x', deps: { restore: async () => null } })).rejects.toMatchObject({ code: 'SIGNED_OUT' });
  });

  it('gives up at its deadline, for the web to finish', async () => {
    const { Agent } = fakeAgent();
    const scan = ({ signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
    const out = scanForOwner({ ownerDid: OWNER, input: 'x', deadlineMs: 20, deps: { restore: async (did) => ({ did }), Agent, scan, candidates: async () => [] } });
    await expect(out).rejects.toBeInstanceOf(DmScanError);
    await expect(out).rejects.toMatchObject({ code: 'TOO_BIG' });
  });

  it('takes the canary’s candidates from the owner’s public graph, follows who follow back first', async () => {
    const fetchImpl = vi.fn(async (url) => {
      const u = new URL(url);
      const json = (b) => new Response(JSON.stringify(b), { status: 200 });
      if (u.pathname.endsWith('getFollows')) return json({ follows: [{ did: 'did:plc:one' }, { did: 'did:plc:mutual' }] });
      return json({ followers: [{ did: 'did:plc:mutual' }, { did: 'did:plc:fan' }] });
    });
    expect(await publicCandidates(OWNER, { fetchImpl })).toEqual(['did:plc:mutual', 'did:plc:one']);
  });
});
