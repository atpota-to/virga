import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyComposerState, emptyPost } from '../lib/composerModel.js';
import {
  ADVISER_DECISIONS,
  adviserGateEnabled,
  adviserUsageLineFor,
  createAdviserGateController,
} from './gateController.js';
import { ADVISER_CHOICES } from './gate.js';
import { adviserSheetModel } from './sheet.js';
import { DEFAULT_ADVISER_SETTINGS, nextPostingAdviserState } from './setup.js';

const ME = 'did:plc:me';
const OTHER = 'did:plc:other';
const postUri = (did, rkey = 'r1') => `at://${did}/app.bsky.feed.post/${rkey}`;
const requester = { did: ME, request: vi.fn() };

// Everything on, as the first switch-on leaves it.
const seeded = nextPostingAdviserState(DEFAULT_ADVISER_SETTINGS);
const withSetup = (patch) => ({ ...seeded, ...patch });

function state(posts = ['a draft'], patch = {}) {
  return {
    ...emptyComposerState({ asDid: ME }),
    posts: posts.map((text) => ({ ...emptyPost(), text })),
    ...patch,
  };
}

const OK = {
  sentiment: { label: 'neutral', score: 0 },
  checks: [
    { id: 'reduceNegativity', label: 'Reduce negativity', status: 'ok' },
  ],
  overallStatus: 'ok',
  writing: { issues: [] },
};

const CONFLICT = {
  ...OK,
  checks: [
    {
      id: 'limitTopic',
      label: 'Limit topics',
      status: 'conflict',
      excerpt: null,
    },
  ],
  overallStatus: 'conflict',
};

const typo = (found, replacement) => ({
  ...OK,
  writing: { issues: [{ type: 'typo', found, replacement, note: 'twice' }] },
});

/**
 * A controller with everything stood in: `answer` is what cocoon says (an
 * object, an Error to throw, or a function of the payload), the hold is
 * immediate unless `sleep` says otherwise.
 */
function setup({
  settings = seeded,
  answer = OK,
  atLimit = false,
  canUseAi = true,
  req = requester,
  sleep = () => Promise.resolve(),
  now = () => 0,
  gather = vi.fn(async (_s, kind) => ({
    kind,
    thread: [{ author: 'Sam', text: 'the post' }],
    target: { author: 'Sam', text: 'the post' },
  })),
  usage = null,
  ...rest
} = {}) {
  const views = [];
  const onApplyFixes = vi.fn();
  const analyzePost = vi.fn(async (_req, payload, { signal } = {}) => {
    if (typeof answer === 'function') return answer(payload, signal);
    if (answer instanceof Error) throw answer;
    return answer;
  });
  const ctl = createAdviserGateController({
    analyzePost,
    gatherReplyContext: gather,
    atLimit: () => atLimit,
    readUsage: () => usage,
    sleep,
    now,
    onChange: (view) => views.push(view),
    ...rest,
  });
  ctl.configure({ did: ME, settings, requester: req, canUseAi, onApplyFixes });
  return { ctl, analyzePost, gather, onApplyFixes, views };
}

// Let the controller's chain of awaits run.
const flush = async (n = 3) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

afterEach(() => {
  vi.useRealTimers();
});

describe('adviserGateEnabled', () => {
  it('needs the switch, a requester and AI access (D16)', () => {
    expect(
      adviserGateEnabled({ settings: seeded, requester, canUseAi: true }),
    ).toBe(true);
    expect(
      adviserGateEnabled({
        settings: DEFAULT_ADVISER_SETTINGS,
        requester,
        canUseAi: true,
      }),
    ).toBe(false);
    expect(
      adviserGateEnabled({ settings: seeded, requester: null, canUseAi: true }),
    ).toBe(false);
    expect(
      adviserGateEnabled({ settings: seeded, requester, canUseAi: false }),
    ).toBe(false);
    expect(adviserGateEnabled({})).toBe(false);
  });
});

describe('the pre-publish check (gate)', () => {
  it('lets the post through at once when the adviser is off', async () => {
    const { ctl, analyzePost } = setup({ settings: DEFAULT_ADVISER_SETTINGS });
    await expect(ctl.check(state(), { mode: 'gate' })).resolves.toBe('publish');
    expect(analyzePost).not.toHaveBeenCalled();
  });

  it('lets the post through for a browser account', async () => {
    const { ctl, analyzePost } = setup({ req: null, canUseAi: false });
    await expect(ctl.check(state())).resolves.toBe('publish');
    expect(analyzePost).not.toHaveBeenCalled();
  });

  it('doesn’t read when "check before posting" is off', async () => {
    const { ctl, analyzePost } = setup({
      settings: withSetup({ checkBeforePublish: false }),
    });
    await expect(ctl.check(state())).resolves.toBe('publish');
    expect(analyzePost).not.toHaveBeenCalled();
  });

  it('doesn’t read when the scope leaves the post out', async () => {
    const { ctl, analyzePost } = setup({
      settings: withSetup({ checkScope: 'replies' }),
    });
    await expect(ctl.check(state())).resolves.toBe('publish');
    expect(analyzePost).not.toHaveBeenCalled();
  });

  it('doesn’t read once this month’s checks are known to be used up', async () => {
    const { ctl, analyzePost } = setup({ atLimit: true });
    await expect(ctl.check(state())).resolves.toBe('publish');
    expect(analyzePost).not.toHaveBeenCalled();
  });

  it('doesn’t read an empty post', async () => {
    const { ctl, analyzePost } = setup();
    await expect(ctl.check(state(['  ']))).resolves.toBe('publish');
    expect(analyzePost).not.toHaveBeenCalled();
  });

  it('reads quietly and publishes when nothing is significant', async () => {
    const { ctl, analyzePost, views } = setup();
    await expect(ctl.check(state(['hello there']))).resolves.toBe('publish');
    expect(analyzePost).toHaveBeenCalledTimes(1);
    const [req, payload] = analyzePost.mock.calls[0];
    expect(req).toBe(requester);
    expect(payload.text).toBe('hello there');
    expect(payload.scenario).toBe('post');
    expect(payload.writingChecks).toMatchObject({ typos: true });
    // The busy state showed, with both ways out, and went again.
    const busy = views.find((v) => v.busy)?.busy;
    expect(busy.mode).toBe('gate');
    expect(busy.choices).toEqual([
      ADVISER_CHOICES.PUBLISH,
      ADVISER_CHOICES.EDIT,
    ]);
    expect(busy.goals.map((g) => g.key)).toContain('reduceNegativity');
    expect(ctl.getView().busy).toBeNull();
    expect(ctl.getView().sheet).toBeNull();
  });

  it('lets a caution through in "significant" mode', async () => {
    const { ctl } = setup({
      answer: {
        ...OK,
        overallStatus: 'caution',
        checks: [{ id: 'x', label: 'X', status: 'caution' }],
      },
    });
    await expect(ctl.check(state())).resolves.toBe('publish');
  });

  it('stops on a conflict and shows the sheet; Publish anyway goes ahead', async () => {
    const { ctl } = setup({ answer: CONFLICT });
    const done = ctl.check(state(['about politics']));
    await flush();
    const sheet = ctl.getView().sheet;
    expect(sheet).toMatchObject({
      mode: 'gate',
      status: 'ready',
      canPublish: true,
    });
    expect(sheet.result).toBe(CONFLICT);
    expect(sheet.posts).toEqual(['about politics']);
    expect(ctl.getView().busy).toBeNull();
    ctl.decide('publish');
    await expect(done).resolves.toBe('publish');
    expect(ctl.getView().sheet).toBeNull();
  });

  it('stops on any writing issue; Save as draft answers draft', async () => {
    const { ctl } = setup({ answer: typo('the the', 'the') });
    const done = ctl.check(state(['see the the thing']));
    await flush();
    expect(ctl.getView().sheet?.status).toBe('ready');
    ctl.decide(ADVISER_DECISIONS.DRAFT);
    await expect(done).resolves.toBe('draft');
  });

  it('shows every read in "always" mode, and Keep editing answers edit', async () => {
    const { ctl } = setup({ settings: withSetup({ reviewMode: 'always' }) });
    const done = ctl.check(state());
    await flush();
    expect(ctl.getView().sheet?.status).toBe('ready');
    ctl.decide('edit');
    await expect(done).resolves.toBe('edit');
  });

  it('closing the sheet is keep editing', async () => {
    const { ctl } = setup({ answer: CONFLICT });
    const done = ctl.check(state());
    await flush();
    ctl.decide('anything else');
    await expect(done).resolves.toBe('edit');
  });

  it('fails open on an error', async () => {
    const { ctl } = setup({
      answer: Object.assign(new Error('down'), { status: 503 }),
    });
    await expect(ctl.check(state())).resolves.toBe('publish');
    expect(ctl.getView().sheet).toBeNull();
  });

  it('fails open on the 10 s deadline', async () => {
    vi.useFakeTimers();
    const { ctl } = setup({ answer: () => new Promise(() => {}) });
    const done = ctl.check(state());
    await vi.advanceTimersByTimeAsync(9_999);
    expect(ctl.getView().busy).not.toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await expect(done).resolves.toBe('publish');
    expect(ctl.getView().busy).toBeNull();
  });

  it('Publish anyway while reading goes ahead and stops the read', async () => {
    let seen;
    const { ctl } = setup({
      answer: (_p, signal) => {
        seen = signal;
        return new Promise(() => {});
      },
    });
    const done = ctl.check(state());
    await flush();
    ctl.choose(ADVISER_CHOICES.PUBLISH);
    await expect(done).resolves.toBe('publish');
    expect(seen.aborted).toBe(true);
  });

  it('Keep editing while reading goes back to the composer', async () => {
    const { ctl } = setup({ answer: () => new Promise(() => {}) });
    const done = ctl.check(state());
    await flush();
    ctl.choose(ADVISER_CHOICES.EDIT);
    await expect(done).resolves.toBe('edit');
    expect(ctl.getView().busy).toBeNull();
  });

  it('holds a fast answer before the sheet, and a choice in the hold still counts', async () => {
    let release;
    const sleep = vi.fn(
      () =>
        new Promise((r) => {
          release = r;
        }),
    );
    let t = 0;
    const { ctl } = setup({
      answer: CONFLICT,
      sleep,
      now: () => t,
      readMinMs: 1200,
    });
    const done = ctl.check(state());
    t = 300;
    await flush();
    expect(sleep).toHaveBeenCalledWith(900);
    expect(ctl.getView().busy).not.toBeNull();
    expect(ctl.getView().sheet).toBeNull();
    ctl.choose(ADVISER_CHOICES.EDIT);
    await expect(done).resolves.toBe('edit');
    release();
  });

  it('opens the sheet when the hold runs out', async () => {
    let t = 0;
    let release;
    const { ctl } = setup({
      answer: CONFLICT,
      now: () => t,
      sleep: () =>
        new Promise((r) => {
          release = r;
        }),
    });
    ctl.check(state());
    t = 1000;
    await flush();
    expect(ctl.getView().sheet).toBeNull();
    release();
    await flush();
    expect(ctl.getView().sheet?.status).toBe('ready');
  });

  it('doesn’t hold an answer that took long enough already', async () => {
    let t = 0;
    const sleep = vi.fn(() => Promise.resolve());
    const { ctl } = setup({
      answer: () => {
        t = 5000;
        return CONFLICT;
      },
      now: () => t,
      sleep,
    });
    ctl.check(state());
    await flush();
    expect(sleep).not.toHaveBeenCalled();
    expect(ctl.getView().sheet?.status).toBe('ready');
  });
});

describe('the "Check this post" button (manual)', () => {
  it('does nothing when the adviser can’t be asked', async () => {
    const { ctl } = setup({ req: null });
    await expect(ctl.check(state(), { mode: 'manual' })).resolves.toBe('edit');
  });

  it('asks for some text first', async () => {
    const { ctl, analyzePost } = setup();
    const done = ctl.check(state(['']), { mode: 'manual' });
    await flush();
    expect(ctl.getView().sheet?.status).toBe('needsText');
    expect(analyzePost).not.toHaveBeenCalled();
    ctl.decide('edit');
    await expect(done).resolves.toBe('edit');
  });

  it('says when nothing is set up to check', async () => {
    const { ctl, analyzePost } = setup({
      settings: { ...DEFAULT_ADVISER_SETTINGS, enabled: true },
    });
    ctl.check(state(), { mode: 'manual' });
    await flush();
    expect(ctl.getView().sheet?.status).toBe('empty');
    expect(analyzePost).not.toHaveBeenCalled();
  });

  it('shows the limit without asking when the month’s checks are used up', async () => {
    const { ctl, analyzePost } = setup({ atLimit: true });
    ctl.check(state(), { mode: 'manual' });
    await flush();
    expect(ctl.getView().sheet?.status).toBe('limit');
    expect(analyzePost).not.toHaveBeenCalled();
  });

  it('ignores the scope and "check before posting", and always shows the read', async () => {
    const { ctl, analyzePost, views } = setup({
      settings: withSetup({ checkBeforePublish: false, checkScope: 'replies' }),
    });
    const done = ctl.check(state(['fine']), { mode: 'manual' });
    await flush();
    expect(analyzePost).toHaveBeenCalledTimes(1);
    expect(views.find((v) => v.busy)?.busy.choices).toEqual([
      ADVISER_CHOICES.EDIT,
    ]);
    expect(ctl.getView().sheet).toMatchObject({
      mode: 'manual',
      status: 'ready',
    });
    ctl.decide('publish');
    await expect(done).resolves.toBe('publish');
  });

  it('turns a monthly_limit refusal into the limit sheet', async () => {
    const { ctl } = setup({
      answer: Object.assign(new Error('used up'), {
        code: 'monthly_limit',
        status: 429,
      }),
    });
    ctl.check(state(), { mode: 'manual' });
    await flush();
    expect(ctl.getView().sheet?.status).toBe('limit');
  });

  it('shows any other failure in words', async () => {
    const { ctl } = setup({
      answer: Object.assign(new Error('AI help isn’t available right now.'), {
        status: 503,
      }),
    });
    ctl.check(state(), { mode: 'manual' });
    await flush();
    expect(ctl.getView().sheet).toMatchObject({
      status: 'error',
      error: 'AI help isn’t available right now.',
    });
  });

  it('doesn’t offer to publish a post that is set to go out later', async () => {
    const { ctl } = setup();
    ctl.check(state(['x'], { schedule: { mode: 'queue' } }), {
      mode: 'manual',
    });
    await flush();
    expect(ctl.getView().sheet?.canPublish).toBe(false);
  });
});

describe('fixes from the sheet', () => {
  it('applies one fix, then the rest, giving back every post’s text', async () => {
    const answer = {
      ...OK,
      writing: {
        issues: [
          { type: 'typo', found: 'the the', replacement: 'the', note: '' },
          { type: 'grammar', found: ' i ', replacement: ' I ', note: '' },
        ],
      },
    };
    const { ctl, onApplyFixes } = setup({
      answer,
      settings: withSetup({ reviewMode: 'always' }),
    });
    const posts = ['first post', 'see the the thing', 'and i think so'];
    const done = ctl.check(state(posts));
    await flush();
    const sheet = ctl.getView().sheet;
    const model = adviserSheetModel(sheet.result, sheet.posts);
    expect(model.fixes).toHaveLength(2);

    expect(ctl.applyFix(model.fixes[0])).toBe(1);
    expect(onApplyFixes).toHaveBeenLastCalledWith([
      'first post',
      'see the thing',
      'and i think so',
    ]);
    expect(ctl.getView().sheet.taken).toEqual(['fix:0']);
    expect(ctl.getView().sheet.fixesTaken).toBe(true);

    // Taking it again does nothing; "apply all" takes what's left.
    expect(ctl.applyFix(model.fixes[0])).toBe(0);
    expect(ctl.applyFix(model.fixes)).toBe(1);
    expect(onApplyFixes).toHaveBeenLastCalledWith([
      'first post',
      'see the thing',
      'and I think so',
    ]);
    expect(onApplyFixes).toHaveBeenCalledTimes(2);
    expect(ctl.getView().sheet.taken).toEqual(['fix:0', 'fix:1']);
    // The marks stay where the read put them.
    expect(ctl.getView().sheet.posts).toEqual(posts);

    ctl.decide('publish');
    await expect(done).resolves.toBe('publish');
  });

  it('does nothing without an open read', () => {
    const { ctl, onApplyFixes } = setup();
    expect(
      ctl.applyFix({ key: 'fix:0', issue: { found: 'a', replacement: 'b' } }),
    ).toBe(0);
    expect(onApplyFixes).not.toHaveBeenCalled();
  });
});

describe('reading the room', () => {
  it('reads a reply to someone else with its conversation', async () => {
    const { ctl, analyzePost, gather } = setup({
      settings: withSetup({ reviewMode: 'always' }),
    });
    const s = state(['i disagree'], {
      reply: {
        uri: postUri(OTHER),
        cid: 'c',
        root: { uri: postUri(OTHER), cid: 'c' },
        author: { did: OTHER, handle: 'sam.test' },
        text: 'the post',
      },
    });
    ctl.check(s);
    await flush();
    expect(gather).toHaveBeenCalledWith(
      s,
      'reply',
      expect.objectContaining({ signal: expect.any(Object) }),
    );
    const payload = analyzePost.mock.calls[0][1];
    expect(payload.scenario).toBe('reply');
    expect(payload.context.kind).toBe('reply');
    const sheet = ctl.getView().sheet;
    expect(sheet.context.thread).toHaveLength(1);
    expect(sheet.contextKind).toBe('reply');
    expect(sheet.scenario).toBe('reply');
  });

  it('doesn’t read the conversation when reading the room is off', async () => {
    const { ctl, analyzePost, gather } = setup({
      settings: withSetup({ checkReplyContext: false }),
    });
    await ctl.check(
      state(['ok'], {
        reply: {
          uri: postUri(OTHER),
          cid: 'c',
          root: { uri: postUri(OTHER), cid: 'c' },
        },
      }),
    );
    expect(gather).not.toHaveBeenCalled();
    expect(analyzePost.mock.calls[0][1].context).toBeUndefined();
  });
});

describe('one check at a time', () => {
  it('a new check ends the one before with edit', async () => {
    const { ctl } = setup({ answer: () => new Promise(() => {}) });
    const first = ctl.check(state());
    await flush();
    const second = ctl.check(state(), { mode: 'manual' });
    await expect(first).resolves.toBe('edit');
    await flush();
    expect(ctl.getView().busy?.mode).toBe('manual');
    ctl.choose(ADVISER_CHOICES.EDIT);
    await expect(second).resolves.toBe('edit');
  });

  it('cancel() ends an open sheet with edit', async () => {
    const { ctl } = setup({ answer: CONFLICT });
    const done = ctl.check(state());
    await flush();
    expect(ctl.getView().sheet).not.toBeNull();
    ctl.cancel();
    await expect(done).resolves.toBe('edit');
    expect(ctl.getView().sheet).toBeNull();
  });

  it('counts the request: the usage version moves after a read', async () => {
    const { ctl } = setup();
    const before = ctl.getView().usageVersion;
    await ctl.check(state());
    expect(ctl.getView().usageVersion).toBe(before + 2);
  });
});

describe('adviserUsageLineFor', () => {
  it('says how many checks are left, or nothing', () => {
    const now = new Date('2026-11-12T12:00:00Z');
    expect(
      adviserUsageLineFor(ME, {
        readUsage: () => ({ month: '2026-11', used: 12, limit: 30 }),
        now,
      }),
    ).toBe('18 of 30 free checks left this month. Shared with Anisota.');
    expect(adviserUsageLineFor(ME, { readUsage: () => null })).toBe('');
    expect(adviserUsageLineFor(null)).toBe('');
  });

  it('is what the controller reports for its account', () => {
    const { ctl } = setup({ usage: { month: '2026-11', used: 30, limit: 30 } });
    expect(ctl.usageLine()).toMatch(/^No free checks left this month/);
  });
});
