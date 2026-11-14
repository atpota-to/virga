// The pure parts of the adviser's dialogs: the sheet's words and buttons,
// the alt-text dialog's requests, and one sitting of the style dialog.

import { describe, expect, it, vi } from 'vitest';
import {
  ALT_TEXT_MAX_GRAPHEMES,
  afterGeneration,
  altGenerationRequest,
  altTextCount,
  altTextUsageLine,
  revisingLine,
} from './altTextModel.js';
import {
  INITIAL_STYLE_VIEW,
  WRITE_STAGE_FLIP_MS,
  createStyleSession,
  styleErrorMessage,
  styleProfileLine,
} from './styleSession.js';
import {
  fixAllLabel,
  postIndexLabel,
  readFoundSomething,
  sheetActions,
  sheetContextLine,
  sheetTitle,
} from './sheetView.js';
import { adviserSheetModel } from './sheet.js';

const OK = {
  checks: [
    { id: 'reduceNegativity', label: 'Reduce negativity', status: 'ok' },
  ],
  overallStatus: 'ok',
  writing: { issues: [] },
};
const CONFLICT = {
  checks: [{ id: 'limitTopic', label: 'Limit topics', status: 'conflict' }],
  overallStatus: 'conflict',
};
const TYPO = {
  ...OK,
  writing: { issues: [{ type: 'typo', found: 'the the', replacement: 'the' }] },
};
const ready = (result, extra = {}) => ({
  status: 'ready',
  mode: 'gate',
  result,
  posts: ['see the the thing'],
  taken: [],
  ...extra,
});

describe('sheetView', () => {
  it('titles the sheet by how it was opened', () => {
    expect(sheetTitle({ mode: 'gate' })).toBe('Before this goes out');
    expect(sheetTitle({ mode: 'manual' })).toBe('Post adviser');
  });

  it('offers a single Close when nothing was read', () => {
    for (const status of ['needsText', 'empty', 'limit']) {
      expect(sheetActions({ status })).toEqual({
        closeOnly: true,
        publish: null,
        draft: false,
        primary: 'edit',
      });
    }
  });

  it('leans to Keep editing on a conflict, else to publishing', () => {
    expect(sheetActions(ready(CONFLICT))).toMatchObject({
      primary: 'edit',
      publish: { label: 'Publish anyway' },
      draft: true,
    });
    expect(sheetActions(ready(OK))).toMatchObject({
      primary: 'publish',
      publish: { label: 'Publish' },
    });
  });

  it('calls it "Publish" once every slip is fixed', () => {
    const read = ready(TYPO);
    expect(sheetActions(read).publish.label).toBe('Publish anyway');
    expect(sheetActions({ ...read, taken: ['fix:0'] }).publish.label).toBe(
      'Publish',
    );
  });

  it('leaves out Publish and the draft when the sheet doesn’t offer them', () => {
    expect(
      sheetActions(ready(OK), { canPublish: false, canSaveDraft: false }),
    ).toMatchObject({
      publish: null,
      draft: false,
      primary: 'edit',
    });
  });

  it('offers publishing past an error', () => {
    expect(sheetActions({ status: 'error' })).toMatchObject({
      publish: { label: 'Publish anyway' },
    });
  });

  it('knows when a read found something', () => {
    const model = adviserSheetModel(TYPO, ['see the the thing']);
    expect(readFoundSomething(model)).toBe(true);
    expect(readFoundSomething(model, ['fix:0'])).toBe(false);
    expect(readFoundSomething(adviserSheetModel(OK, ['x']))).toBe(false);
    expect(readFoundSomething(null)).toBe(false);
  });

  it('says what the post was read with', () => {
    const thread = (n) =>
      Array.from({ length: n }, () => ({ author: 'a', text: 'b' }));
    expect(
      sheetContextLine(
        ready(OK, { contextKind: 'reply', context: { thread: thread(3) } }),
      ),
    ).toBe(
      'Read with the conversation: 3 posts, up to the one you’re replying to.',
    );
    expect(
      sheetContextLine(
        ready(OK, { contextKind: 'reply', context: { thread: thread(1) } }),
      ),
    ).toBe('Read with the post you’re replying to.');
    expect(
      sheetContextLine(
        ready(OK, { contextKind: 'quote', context: { thread: thread(1) } }),
      ),
    ).toBe('Read with the post you’re quoting.');
    expect(
      sheetContextLine(
        ready(OK, { contextKind: 'selfReply', context: { thread: thread(2) } }),
      ),
    ).toBe('Read with the 2 posts of yours above it.');
  });

  it('points at the setting when a reply was read alone', () => {
    expect(
      sheetContextLine(ready(OK, { scenario: 'reply', readTheRoom: false })),
    ).toMatch(/Turn on/);
    expect(
      sheetContextLine(ready(OK, { scenario: 'reply', readTheRoom: true })),
    ).toBe('');
    expect(
      sheetContextLine(ready(OK, { scenario: 'post', readTheRoom: false })),
    ).toBe('');
    expect(sheetContextLine({ status: 'error' })).toBe('');
  });

  it('labels thread posts and the fix button', () => {
    expect(postIndexLabel(0, 1)).toBe('');
    expect(postIndexLabel(1, 3)).toBe('2/3');
    expect(fixAllLabel(1)).toBe('Fix it');
    expect(fixAllLabel(3)).toBe('Fix all 3');
  });
});

describe('altTextModel', () => {
  it('counts graphemes against Bluesky’s limit', () => {
    expect(altTextCount('a 👩‍👩‍👧 b')).toMatchObject({
      count: 5,
      over: false,
      label: '5 of 2,000',
    });
    expect(altTextCount('x'.repeat(ALT_TEXT_MAX_GRAPHEMES + 1)).over).toBe(
      true,
    );
    expect(altTextCount(null).count).toBe(0);
  });

  it('asks for a first description with the kind and the post’s text', () => {
    expect(
      altGenerationRequest({
        mode: 'describe',
        kind: 'chart',
        context: ' my post ',
      }),
    ).toEqual({
      kind: 'chart',
      context: 'my post',
    });
    expect(
      altGenerationRequest({ mode: 'describe', kind: 'nonsense' }),
    ).toEqual({});
    expect(
      altGenerationRequest({ mode: 'describe', context: 'x'.repeat(900) })
        .context,
    ).toHaveLength(500);
  });

  it('asks for a revision from the notes against the text in the field', () => {
    expect(
      altGenerationRequest({
        mode: 'revise',
        alt: 'A cat on a mat.',
        selected: ['shorter'],
        note: "It's a kitten",
      }),
    ).toEqual({
      followUp: "Make it shorter. It's a kitten",
      previousAltText: 'A cat on a mat.',
      presets: ['shorter'],
    });
  });

  it('has nothing to revise without a note', () => {
    expect(
      altGenerationRequest({
        mode: 'revise',
        alt: 'x',
        selected: [],
        note: ' ',
      }),
    ).toBeNull();
  });

  it('keeps what a description replaced, for Undo', () => {
    expect(
      afterGeneration({
        before: 'old',
        generated: ' new ',
        mode: 'revise',
        selected: ['detail'],
      }),
    ).toEqual({
      alt: 'new',
      undo: 'old',
      rankedAgainst: 'new',
      lastAsked: ['detail'],
      revised: true,
    });
    expect(
      afterGeneration({ before: '  ', generated: 'new', mode: 'describe' }),
    ).toMatchObject({
      undo: null,
      lastAsked: [],
      revised: false,
    });
    expect(afterGeneration({ before: 'old', generated: '   ' })).toBeNull();
    expect(afterGeneration({ generated: 'x'.repeat(1500) }).alt).toHaveLength(
      1000,
    );
  });

  it('says what a revision is doing', () => {
    expect(revisingLine(['shorter'], 'more about the dog')).toBe(
      'Revising: shorter, plus your note',
    );
    expect(revisingLine([], '')).toBe('Revising');
  });

  it('says how many descriptions are left', () => {
    const now = new Date('2026-11-12T00:00:00Z');
    expect(altTextUsageLine({ used: 5, limit: 15 }, { now })).toBe(
      '10 of 15 free descriptions left this month. Each revision uses one.',
    );
    expect(altTextUsageLine({ used: 15, limit: 15 }, { now })).toBe(
      'No free descriptions left this month. They start again on December 1.',
    );
    expect(altTextUsageLine(null)).toBe('');
  });
});

describe('styleSession', () => {
  const requester = { did: 'did:plc:me', request: vi.fn() };
  const posts = ['one', 'two', 'three', 'four', 'five', 'six'];

  function session(overrides = {}) {
    const views = [];
    const timers = [];
    const fetchTexts = vi.fn(async (_did, { onPage }) => {
      onPage?.({ posts: 3 });
      onPage?.({ posts: 6 });
      return posts;
    });
    const synthesize = vi.fn(async (_req, { previousSummary }) => ({
      summary: previousSummary
        ? `${previousSummary} Refined.`
        : 'Writes in lowercase.',
      analyzedCount: 6,
      updatedAt: '2026-11-12T10:00:00.000Z',
      usage: { used: 1, limit: 3 },
    }));
    const s = createStyleSession({
      did: 'did:plc:me',
      requester,
      fetchTexts,
      synthesize,
      onChange: (v) => views.push(v),
      setTimer: (fn, ms) => {
        timers.push({ fn, ms });
        return timers.length;
      },
      clearTimer: () => {},
      ...overrides,
    });
    return { s, views, timers, fetchTexts, synthesize };
  }

  it('starts on the saved description when there is one', () => {
    const { s } = session({
      profile: {
        summary: 'Saved.',
        analyzedCount: 40,
        updatedAt: '2026-10-01T00:00:00Z',
      },
    });
    expect(s.getView()).toMatchObject({
      phase: 'result',
      summary: 'Saved.',
      analyzedCount: 40,
      fresh: false,
    });
    expect(createStyleSession({}).getView()).toEqual(INITIAL_STYLE_VIEW);
  });

  it('gathers, reads and writes, counting posts as they come', async () => {
    const { s, views, timers, fetchTexts, synthesize } = session();
    await s.start({ sampleSize: 250, guidance: 'i skip capitals' });
    expect(fetchTexts).toHaveBeenCalledWith(
      'did:plc:me',
      expect.objectContaining({ sampleSize: 250 }),
    );
    expect(views.map((v) => v.postCount)).toContain(3);
    expect(views.some((v) => v.stage === 'read')).toBe(true);
    expect(timers[0].ms).toBe(WRITE_STAGE_FLIP_MS);
    expect(synthesize).toHaveBeenCalledWith(
      requester,
      expect.objectContaining({ texts: posts, guidance: 'i skip capitals' }),
    );
    expect(s.getView()).toMatchObject({
      phase: 'result',
      summary: 'Writes in lowercase.',
      analyzedCount: 6,
      usage: { used: 1, limit: 3 },
      fresh: true,
    });
  });

  it('refines against the same posts without gathering again', async () => {
    const { s, fetchTexts, synthesize } = session();
    await s.start({});
    await s.start({
      guidance: 'shorter',
      previousSummary: s.getView().summary,
    });
    expect(fetchTexts).toHaveBeenCalledTimes(1);
    expect(synthesize).toHaveBeenCalledTimes(2);
    expect(s.getView().summary).toBe('Writes in lowercase. Refined.');
    await s.start({ again: true });
    expect(fetchTexts).toHaveBeenCalledTimes(2);
  });

  it('shows an error for a first reading, and keeps the description on a failed refine', async () => {
    const fail = Object.assign(new Error('nope'), { code: 'not_enough_posts' });
    const { s } = session({
      fetchTexts: vi.fn(async () => Promise.reject(fail)),
    });
    await s.start({});
    expect(s.getView().phase).toBe('error');
    expect(s.getView().error.message).toMatch(/at least 5/);

    const limit = Object.assign(new Error('used'), {
      code: 'monthly_limit',
      payload: { limit: 3, used: 3 },
    });
    const second = session({
      profile: { summary: 'Saved.' },
      synthesize: vi.fn(async () => Promise.reject(limit)),
    });
    await second.s.start({ previousSummary: 'Saved.' });
    expect(second.s.getView()).toMatchObject({
      phase: 'result',
      summary: 'Saved.',
      usage: { used: 3, limit: 3 },
      error: { code: 'monthly_limit' },
    });
  });

  it('drops an answer that comes after the dialog closed', async () => {
    let resolve;
    const { s } = session({
      synthesize: vi.fn(
        () =>
          new Promise((r) => {
            resolve = r;
          }),
      ),
    });
    const running = s.start({});
    await new Promise((r) => setImmediate(r));
    s.dispose();
    resolve({ summary: 'late', analyzedCount: 1, updatedAt: '' });
    await running;
    expect(s.getView().summary).toBe('');
    expect(s.hasPosts()).toBe(false);
  });

  it('takes hand edits', () => {
    const { s } = session({ profile: { summary: 'Saved.' } });
    s.edit('Mine now.');
    expect(s.getView()).toMatchObject({ summary: 'Mine now.', fresh: true });
  });

  it('words its errors and the profile line', () => {
    expect(styleErrorMessage({ code: 'monthly_limit' })).toMatch(/used up/);
    expect(styleErrorMessage({ status: 502 })).toBe(
      'The style reading didn’t finish. Try again.',
    );
    expect(
      styleErrorMessage({
        code: 'STYLE_FETCH_FAILED',
        message: 'Couldn’t load.',
      }),
    ).toBe('Couldn’t load.');
    expect(
      styleProfileLine(
        { analyzedCount: 212, updatedAt: '2026-11-12T10:00:00Z' },
        { locale: 'en-GB' },
      ),
    ).toBe('Written from 212 of your posts · 12 Nov 2026');
    expect(styleProfileLine({ analyzedCount: 1 })).toBe(
      'Written from 1 of your posts',
    );
    expect(styleProfileLine({})).toBe('');
  });
});
