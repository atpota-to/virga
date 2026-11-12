import { describe, expect, it, vi } from 'vitest';
import { emptyComposerState, emptyPost } from '../lib/composerModel.js';
import {
  adviserDraftFacts,
  adviserGoalCount,
  adviserGoalItems,
  adviserReadPlan,
  adviserShouldInterrupt,
  adviserSource,
  analyzePayload,
  gatherReplyContext,
  readExpectation,
} from './context.js';
import { DEFAULT_ADVISER_SETTINGS, nextPostingAdviserState } from './setup.js';

const ME = 'did:plc:me';
const ALT = 'did:plc:alt';
const OTHER = 'did:plc:other';
const postUri = (did, rkey = 'r1') => `at://${did}/app.bsky.feed.post/${rkey}`;

function state(patch = {}, posts = [{ text: 'a draft' }]) {
  return {
    ...emptyComposerState({ asDid: ME }),
    posts: posts.map((p) => ({ ...emptyPost(), ...p })),
    ...patch,
  };
}

const replyTo = (did, extra = {}) => ({
  uri: postUri(did),
  cid: 'c',
  root: { uri: postUri(did), cid: 'c' },
  ...extra,
});

const seeded = nextPostingAdviserState(DEFAULT_ADVISER_SETTINGS);

describe('adviserGoalItems', () => {
  it('lists every goal and the writing check', () => {
    const items = adviserGoalItems({
      goals: {
        presets: {
          reduceNegativity: true,
          lessConfrontational: true,
          limitTopic: { enabled: true, topic: ' politics ' },
        },
        customText: 'be kind',
      },
      writingChecks: { typos: true, clarity: true },
    });
    expect(items).toEqual([
      { key: 'reduceNegativity', label: 'Reduce negativity', detail: null },
      {
        key: 'lessConfrontational',
        label: 'Less confrontational',
        detail: null,
      },
      { key: 'limitTopic', label: 'Limit topics', detail: 'politics' },
      { key: 'customText', label: 'Your own goals', detail: null },
      { key: 'writing', label: 'Writing check', detail: 'typos, clarity' },
    ]);
    expect(adviserGoalCount({ goals: { customText: 'x' } })).toBe(1);
  });

  it('leaves out a topic limit with no topic', () => {
    expect(
      adviserGoalItems({
        goals: { presets: { limitTopic: { enabled: true, topic: ' ' } } },
      }),
    ).toEqual([]);
    expect(adviserGoalItems(undefined)).toEqual([]);
  });
});

describe('readExpectation', () => {
  it('says when a read is slower than usual', () => {
    expect(readExpectation(1000)).toBe('Usually a few seconds');
    expect(readExpectation(8000)).toBe('Taking a little longer than usual');
  });
});

describe('adviserDraftFacts', () => {
  it('judges a reply against the posting account, not the one on screen', () => {
    const s = state({ asDid: ALT, reply: replyTo(ME) });
    expect(adviserDraftFacts(s)).toMatchObject({
      repliesToOther: true,
      repliesToSelf: false,
    });
    expect(adviserDraftFacts(s, { asDid: ME })).toMatchObject({
      repliesToOther: false,
      repliesToSelf: true,
    });
  });

  it('takes the reply’s author from the record when the composer has no profile', () => {
    expect(
      adviserDraftFacts(state({ reply: replyTo(OTHER) })).repliesToOther,
    ).toBe(true);
    expect(
      adviserDraftFacts(
        state({ reply: replyTo(ME, { author: { did: OTHER } }) }),
      ).repliesToOther,
    ).toBe(true);
  });

  it('sees a quote of someone else’s post, and not a feed', () => {
    const quoting = state({}, [
      { text: 'x', record: { kind: 'post', uri: postUri(OTHER), cid: 'c' } },
    ]);
    expect(adviserDraftFacts(quoting).quotesOther).toBe(true);
    const feed = state({}, [
      {
        text: 'x',
        record: {
          kind: 'feed',
          uri: `at://${OTHER}/app.bsky.feed.generator/f`,
          cid: 'c',
        },
      },
    ]);
    expect(adviserDraftFacts(feed).quotesOther).toBe(false);
  });

  it('knows a thread', () => {
    expect(
      adviserDraftFacts(state({}, [{ text: 'a' }, { text: 'b' }])).isThread,
    ).toBe(true);
  });
});

describe('adviserSource', () => {
  it('reads a thread as one text with blank lines between posts', () => {
    expect(
      adviserSource(state({}, [{ text: ' one ' }, { text: 'two ' }])),
    ).toEqual({
      posts: [' one ', 'two '],
      text: 'one \n\ntwo',
    });
  });
});

describe('adviserReadPlan', () => {
  it('is unavailable while the adviser is off, or the account has no server session', () => {
    expect(
      adviserReadPlan(DEFAULT_ADVISER_SETTINGS, state(), { canUseAi: true })
        .available,
    ).toBe(false);
    expect(adviserReadPlan(seeded, state(), { canUseAi: false })).toMatchObject(
      {
        available: false,
        gate: false,
      },
    );
  });

  it('runs the pre-publish check on a seeded setup', () => {
    const plan = adviserReadPlan(seeded, state(), { canUseAi: true });
    expect(plan).toMatchObject({
      available: true,
      gate: true,
      reviewMode: 'significant',
      scenario: 'post',
      context: null,
      writingChecks: { typos: true, grammar: true, clarity: true },
      expectedChecks: 3,
    });
  });

  it('skips the check once the month’s reads are known to be used up', () => {
    expect(
      adviserReadPlan(seeded, state(), { canUseAi: true, atLimit: true }).gate,
    ).toBe(false);
  });

  it('skips the check on an empty draft, or with nothing to check', () => {
    expect(
      adviserReadPlan(seeded, state({}, [{ text: '  ' }]), { canUseAi: true })
        .gate,
    ).toBe(false);
    const nothing = {
      ...DEFAULT_ADVISER_SETTINGS,
      enabled: true,
      checkBeforePublish: true,
    };
    const plan = adviserReadPlan(nothing, state(), { canUseAi: true });
    expect(plan.hasSomething).toBe(false);
    expect(plan.gate).toBe(false);
  });

  it('honours the scope: replies to others only, or everything but them', () => {
    const replies = { ...seeded, checkScope: 'replies' };
    const topLevel = { ...seeded, checkScope: 'topLevel' };
    const reply = state({ reply: replyTo(OTHER) });
    const selfReply = state({ reply: replyTo(ME) });
    expect(adviserReadPlan(replies, reply, { canUseAi: true }).gate).toBe(true);
    expect(adviserReadPlan(replies, state(), { canUseAi: true }).gate).toBe(
      false,
    );
    expect(adviserReadPlan(topLevel, reply, { canUseAi: true }).gate).toBe(
      false,
    );
    // A reply to your own post isn't a reply here.
    expect(adviserReadPlan(topLevel, selfReply, { canUseAi: true }).gate).toBe(
      true,
    );
  });

  it('reads the room only when asked, and only one conversation', () => {
    const quoteAndReply = state({ reply: replyTo(OTHER) }, [
      {
        text: 'x',
        record: { kind: 'post', uri: postUri('did:plc:third'), cid: 'c' },
      },
    ]);
    expect(
      adviserReadPlan(seeded, quoteAndReply, { canUseAi: true }),
    ).toMatchObject({
      context: 'reply',
      scenario: 'reply',
      expectedChecks: 4,
    });
    const off = { ...seeded, checkReplyContext: false };
    expect(
      adviserReadPlan(off, quoteAndReply, { canUseAi: true }).context,
    ).toBeNull();
    expect(
      adviserReadPlan(seeded, state({ reply: replyTo(ME) }), {
        canUseAi: true,
      }),
    ).toMatchObject({
      context: 'selfReply',
      scenario: 'selfReply',
      expectedChecks: 3,
    });
  });

  it('builds the analyze-post body', () => {
    const plan = adviserReadPlan(seeded, state({}, [{ text: ' hello ' }]), {
      canUseAi: true,
    });
    const ctx = { kind: 'reply', thread: [], target: null };
    expect(analyzePayload(plan, ctx)).toEqual({
      text: 'hello',
      goals: plan.goals,
      scenario: 'post',
      context: ctx,
      writingChecks: { typos: true, grammar: true, clarity: true },
    });
    const noWriting = adviserReadPlan(
      { ...seeded, writingChecks: { typos: false } },
      state(),
      { canUseAi: true },
    );
    expect(analyzePayload(noWriting)).not.toHaveProperty('writingChecks');
    expect(analyzePayload(noWriting)).not.toHaveProperty('context');
  });
});

function threadAppView(thread) {
  return vi.fn(async (url) => {
    if (thread instanceof Error) throw thread;
    return { ok: true, status: 200, json: async () => ({ thread }), url };
  });
}

const node = (author, text, parent) => ({
  post: { author, record: { text } },
  ...(parent ? { parent } : {}),
});

describe('gatherReplyContext', () => {
  it('reads the conversation above a reply from the public AppView, oldest first', async () => {
    const fetch = threadAppView(
      node(
        { did: OTHER, handle: 'other.example.com' },
        'the reply target',
        node({ did: 'x', displayName: ' Sam ' }, 'the root'),
      ),
    );
    const s = state({
      reply: replyTo(OTHER, {
        author: { did: OTHER, handle: 'other.example.com' },
        text: 'the reply target',
      }),
    });
    const ctx = await gatherReplyContext(s, 'reply', { fetch });
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.pathname).toBe('/xrpc/app.bsky.feed.getPostThread');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      uri: postUri(OTHER),
      depth: '0',
      parentHeight: '6',
    });
    expect(ctx).toEqual({
      kind: 'reply',
      thread: [
        { author: 'Sam', text: 'the root' },
        { author: '@other.example.com', text: 'the reply target' },
      ],
      target: { author: '@other.example.com', text: 'the reply target' },
    });
  });

  it('falls back to the post alone when the thread can’t be read', async () => {
    const s = state({
      reply: replyTo(OTHER, { author: { displayName: 'Ana' }, text: 'hello' }),
    });
    const ctx = await gatherReplyContext(s, 'reply', {
      fetch: threadAppView(new Error('offline')),
    });
    expect(ctx.thread).toEqual([{ author: 'Ana', text: 'hello' }]);
  });

  it('gives up on a thread read that takes too long', async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn(() => new Promise(() => {}));
      const s = state({ reply: replyTo(OTHER, { text: 'hello' }) });
      const pending = gatherReplyContext(s, 'reply', {
        fetch,
        timeoutMs: 4000,
      });
      await vi.advanceTimersByTimeAsync(4000);
      expect((await pending).thread).toEqual([
        { author: 'someone', text: 'hello' },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads a quote’s target from the attached post', async () => {
    const quoted = {
      kind: 'post',
      uri: postUri(OTHER),
      cid: 'c',
      view: {
        author: { handle: 'q.example.com' },
        record: { text: 'quoted words' },
      },
    };
    const ctx = await gatherReplyContext(
      state({}, [{ text: 'x', record: quoted }]),
      'quote',
      {
        fetch: threadAppView(new Error('nope')),
      },
    );
    expect(ctx).toEqual({
      kind: 'quote',
      thread: [{ author: '@q.example.com', text: 'quoted words' }],
      target: { author: '@q.example.com', text: 'quoted words' },
    });
  });

  it('takes the target from the thread when the composer has no text for it', async () => {
    const fetch = threadAppView(
      node({ handle: 'p.example.com' }, 'parent text'),
    );
    const ctx = await gatherReplyContext(
      state({ reply: replyTo(OTHER) }),
      'reply',
      { fetch },
    );
    expect(ctx.target).toEqual({
      author: '@p.example.com',
      text: 'parent text',
    });
  });

  it('reads nothing without a kind', async () => {
    const fetch = vi.fn();
    expect(await gatherReplyContext(state(), null, { fetch })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('adviserShouldInterrupt', () => {
  it('stops for a conflict or any writing issue in significant mode, not a caution', () => {
    expect(adviserShouldInterrupt({ overallStatus: 'conflict' })).toBe(true);
    expect(adviserShouldInterrupt({ overallStatus: 'caution' })).toBe(false);
    expect(
      adviserShouldInterrupt({
        overallStatus: 'ok',
        writing: { issues: [{ found: 'x' }] },
      }),
    ).toBe(true);
    expect(adviserShouldInterrupt(null)).toBe(false);
  });

  it('always stops in always mode', () => {
    expect(adviserShouldInterrupt({ overallStatus: 'ok' }, 'always')).toBe(
      true,
    );
  });
});
