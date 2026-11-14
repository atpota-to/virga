import { describe, it, expect, vi } from 'vitest';
import {
  defaultGatesFromPreferences,
  EVERYONE_GATES,
  gatesEqual,
  gatesFromRules,
  gatesToRules,
  readDefaultGates,
  updatePostGates,
} from './gates.js';

const TG = 'app.bsky.feed.threadgate';
const PG = 'app.bsky.feed.postgate';
const LIST = 'at://did:plc:me/app.bsky.graph.list/3l';
const URI = 'at://did:plc:me/app.bsky.feed.post/3p';

describe('gatesToRules', () => {
  it('keeps everyone, nobody and somebody apart', () => {
    expect(gatesToRules({ reply: null, quotes: true })).toEqual({
      threadgateAllow: null,
      postgateEmbeddingRules: null,
    });
    // [] is a real "nobody can reply" gate, never the same as null.
    expect(gatesToRules({ reply: [], quotes: true }).threadgateAllow).toEqual(
      [],
    );
    expect(
      gatesToRules({
        reply: [
          { type: 'mention' },
          { type: 'following' },
          { type: 'follower' },
          { type: 'list', list: LIST },
        ],
        quotes: false,
      }),
    ).toEqual({
      threadgateAllow: [
        { $type: `${TG}#mentionRule` },
        { $type: `${TG}#followingRule` },
        { $type: `${TG}#followerRule` },
        { $type: `${TG}#listRule`, list: LIST },
      ],
      postgateEmbeddingRules: [{ $type: `${PG}#disableRule` }],
    });
  });

  it('drops unknown and repeated rules, and lists without an at:// URI', () => {
    expect(
      gatesToRules({
        reply: [
          { type: 'mention' },
          { type: 'mention' },
          { type: 'nope' },
          { type: 'list', list: 'x' },
        ],
      }).threadgateAllow,
    ).toEqual([{ $type: `${TG}#mentionRule` }]);
  });

  it('reads missing gates as everyone', () => {
    expect(gatesToRules(null)).toEqual({
      threadgateAllow: null,
      postgateEmbeddingRules: null,
    });
  });
});

describe('gatesFromRules', () => {
  it('round-trips gatesToRules', () => {
    for (const gates of [
      { reply: null, quotes: true },
      { reply: [], quotes: false },
      {
        reply: [{ type: 'follower' }, { type: 'list', list: LIST }],
        quotes: true,
      },
    ]) {
      expect(gatesFromRules(gatesToRules(gates))).toEqual(gates);
    }
  });

  it('reads every naming the lexicons use', () => {
    expect(
      gatesFromRules({
        threadgateAllowRules: [],
        embeddingRules: [{ $type: `${PG}#disableRule` }],
      }),
    ).toEqual({
      reply: [],
      quotes: false,
    });
    expect(gatesFromRules({ allow: [{ $type: `${TG}#mentionRule` }] })).toEqual(
      {
        reply: [{ type: 'mention' }],
        quotes: true,
      },
    );
  });

  it('reads a list of only unknown rules as nobody, not everyone', () => {
    expect(
      gatesFromRules({ threadgateAllow: [{ $type: `${TG}#futureRule` }] })
        .reply,
    ).toEqual([]);
  });
});

describe('gatesEqual', () => {
  it('ignores rule order', () => {
    expect(
      gatesEqual(
        { reply: [{ type: 'mention' }, { type: 'follower' }], quotes: true },
        { reply: [{ type: 'follower' }, { type: 'mention' }], quotes: true },
      ),
    ).toBe(true);
    expect(
      gatesEqual({ reply: null, quotes: true }, { reply: [], quotes: true }),
    ).toBe(false);
    expect(
      gatesEqual({ reply: null, quotes: true }, { reply: null, quotes: false }),
    ).toBe(false);
  });
});

describe('defaultGatesFromPreferences', () => {
  const pref = (fields) => [
    { $type: 'app.bsky.actor.defs#savedFeedsPrefV2' },
    { $type: 'app.bsky.actor.defs#postInteractionSettingsPref', ...fields },
  ];

  it('is everyone when the account set nothing', () => {
    expect(defaultGatesFromPreferences([])).toEqual(EVERYONE_GATES);
    expect(defaultGatesFromPreferences(pref({}))).toEqual(EVERYONE_GATES);
  });

  it('tells an absent key (default) from an empty one (nobody)', () => {
    expect(
      defaultGatesFromPreferences(pref({ threadgateAllowRules: [] })),
    ).toEqual({
      reply: [],
      quotes: true,
    });
    expect(
      defaultGatesFromPreferences(
        pref({
          threadgateAllowRules: [{ $type: `${TG}#followingRule` }],
          postgateEmbeddingRules: [{ $type: `${PG}#disableRule` }],
        }),
      ),
    ).toEqual({ reply: [{ type: 'following' }], quotes: false });
  });
});

describe('readDefaultGates', () => {
  const agentWith = (getPreferences) => ({
    app: { bsky: { actor: { getPreferences } } },
  });

  it('reads the write account’s preferences', async () => {
    const getPreferences = vi.fn(async () => ({
      data: {
        preferences: [
          {
            $type: 'app.bsky.actor.defs#postInteractionSettingsPref',
            threadgateAllowRules: [],
          },
        ],
      },
    }));
    await expect(readDefaultGates(agentWith(getPreferences))).resolves.toEqual({
      reply: [],
      quotes: true,
    });
    expect(getPreferences).toHaveBeenCalledWith({});
  });

  it('is null, never a throw, when the read fails or is slow', async () => {
    await expect(
      readDefaultGates(
        agentWith(async () => {
          throw new Error('x');
        }),
      ),
    ).resolves.toBeNull();
    vi.useFakeTimers();
    try {
      const pending = readDefaultGates(
        agentWith(() => new Promise(() => {})),
        { timeoutMs: 7000 },
      );
      vi.advanceTimersByTime(7000);
      await expect(pending).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('updatePostGates', () => {
  const notFound = () =>
    Object.assign(new Error('Could not locate record'), {
      error: 'RecordNotFound',
    });

  function fakeAgent(existing = {}) {
    const store = { ...existing };
    const repo = {
      getRecord: vi.fn(async ({ collection }) => {
        if (!store[collection]) throw notFound();
        return { data: { value: store[collection] } };
      }),
      putRecord: vi.fn(async ({ collection, record }) => {
        store[collection] = record;
        return { data: {} };
      }),
      deleteRecord: vi.fn(async ({ collection }) => {
        if (!store[collection]) throw notFound();
        delete store[collection];
        return { data: {} };
      }),
    };
    return { store, repo, agent: { com: { atproto: { repo } } } };
  }

  it('writes both gates at the post’s own key', async () => {
    const { agent, repo, store } = fakeAgent();
    const now = new Date('2026-11-12T00:00:00Z');
    const result = await updatePostGates(agent, {
      uri: URI,
      reply: [],
      quotes: false,
      now,
    });
    expect(result).toEqual({ reply: [], quotes: false });
    expect(repo.putRecord).toHaveBeenCalledTimes(2);
    for (const call of repo.putRecord.mock.calls) {
      expect(call[0]).toMatchObject({ repo: 'did:plc:me', rkey: '3p' });
    }
    expect(store[TG]).toEqual({
      $type: TG,
      post: URI,
      createdAt: '2026-11-12T00:00:00.000Z',
      allow: [],
      hiddenReplies: [],
    });
    expect(store[PG].embeddingRules).toEqual([{ $type: `${PG}#disableRule` }]);
  });

  it('keeps hidden replies and detached quotes through a change', async () => {
    const { agent, store } = fakeAgent({
      [TG]: {
        $type: TG,
        post: URI,
        createdAt: '2025-01-01T00:00:00.000Z',
        allow: [],
        hiddenReplies: ['at://h'],
      },
      [PG]: {
        $type: PG,
        post: URI,
        createdAt: '2025-01-01T00:00:00.000Z',
        embeddingRules: [],
        detachedEmbeddingUris: ['at://d'],
      },
    });
    await updatePostGates(agent, {
      uri: URI,
      reply: [{ type: 'follower' }],
      quotes: false,
    });
    expect(store[TG]).toMatchObject({
      createdAt: '2025-01-01T00:00:00.000Z',
      allow: [{ $type: `${TG}#followerRule` }],
      hiddenReplies: ['at://h'],
    });
    expect(store[PG].detachedEmbeddingUris).toEqual(['at://d']);
  });

  it('opens a post by deleting its gates, unless they still hold something', async () => {
    const plain = fakeAgent({
      [TG]: { $type: TG, post: URI, allow: [], hiddenReplies: [] },
      [PG]: {
        $type: PG,
        post: URI,
        embeddingRules: [{ $type: `${PG}#disableRule` }],
        detachedEmbeddingUris: [],
      },
    });
    await updatePostGates(plain.agent, { uri: URI, reply: null, quotes: true });
    expect(plain.store).toEqual({});

    const holding = fakeAgent({
      [TG]: { $type: TG, post: URI, allow: [], hiddenReplies: ['at://h'] },
      [PG]: {
        $type: PG,
        post: URI,
        embeddingRules: [{ $type: `${PG}#disableRule` }],
        detachedEmbeddingUris: ['at://d'],
      },
    });
    await updatePostGates(holding.agent, {
      uri: URI,
      reply: null,
      quotes: true,
    });
    expect(holding.store[TG]).not.toHaveProperty('allow');
    expect(holding.store[TG].hiddenReplies).toEqual(['at://h']);
    expect(holding.store[PG].embeddingRules).toEqual([]);
    expect(holding.store[PG].detachedEmbeddingUris).toEqual(['at://d']);
  });

  it('does nothing to a post with no gates that stays open', async () => {
    const { agent, repo } = fakeAgent();
    await updatePostGates(agent, { uri: URI, reply: null, quotes: true });
    expect(repo.putRecord).not.toHaveBeenCalled();
    expect(repo.deleteRecord).not.toHaveBeenCalled();
  });

  it('writes nothing when a gate could not be read', async () => {
    const { agent, repo } = fakeAgent();
    repo.getRecord.mockRejectedValueOnce(
      Object.assign(new Error('boom'), { status: 500 }),
    );
    await expect(
      updatePostGates(agent, { uri: URI, reply: [], quotes: true }),
    ).rejects.toThrow('boom');
    expect(repo.putRecord).not.toHaveBeenCalled();
  });

  it('refuses a URI that is not a post', async () => {
    const { agent } = fakeAgent();
    await expect(
      updatePostGates(agent, {
        uri: 'at://did:plc:me/app.bsky.feed.like/3x',
        reply: null,
        quotes: true,
      }),
    ).rejects.toThrow(/Not a post URI/);
  });
});
