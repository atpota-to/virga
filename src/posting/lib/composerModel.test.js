import { describe, it, expect, vi } from 'vitest';
import {
  composerReducer,
  emptyComposerState,
  emptyPost,
  isEmptyComposer,
  labelsToSelfLabels,
  normalizeComposerState,
  resolvePostTexts,
  selfLabelsToLabels,
  validateComposer,
  MAX_POSTS,
} from './composerModel.js';
import { countComposerGraphemes } from './inlineLinks.js';

const ME = 'did:plc:me';
const OTHER = 'did:plc:other';
const blob = (cid) => ({
  $type: 'blob',
  ref: { $link: cid },
  mimeType: 'image/jpeg',
  size: 1,
});
const file = (name = 'a.jpg') =>
  new File([new Uint8Array(1)], name, { type: 'image/jpeg' });

const fresh = (overrides = {}) => ({
  ...emptyComposerState({ asDid: ME }),
  ...overrides,
});
const run = (state, ...actions) => actions.reduce(composerReducer, state);
const codes = (problems) => problems.map((p) => p.code);

describe('emptyComposerState', () => {
  it('is one empty post, gates not custom, no timer', () => {
    const state = emptyComposerState({ asDid: ME });
    expect(state.posts).toHaveLength(1);
    expect(state.posts[0]).toMatchObject({
      text: '',
      images: [],
      video: null,
      record: null,
      card: null,
    });
    expect(state).toMatchObject({
      reply: null,
      tags: [],
      langs: [],
      labels: [],
      gates: { custom: false, reply: null, quotes: true },
      asDid: ME,
      schedule: null,
      lifespan: { enabled: false },
      source: null,
    });
    expect(isEmptyComposer(state)).toBe(true);
  });

  it('takes the account’s defaults', () => {
    const lifespan = { enabled: true, lifespanSeconds: 3600 };
    const state = emptyComposerState({
      asDid: ME,
      defaults: {
        langs: ['de', 'en', 'fr', 'es'],
        gates: { reply: [], quotes: false },
        lifespan,
      },
    });
    expect(state.langs).toEqual(['de', 'en', 'fr']);
    expect(state.gates).toEqual({ custom: false, reply: [], quotes: false });
    expect(state.lifespan).toBe(lifespan);
  });

  it('gives every post its own id', () => {
    expect(emptyPost().id).not.toBe(emptyPost().id);
  });
});

describe('composerReducer: posts', () => {
  it('sets text on one post', () => {
    const s = run(fresh(), { type: 'setText', index: 0, text: 'hello' });
    expect(s.posts[0].text).toBe('hello');
    expect(isEmptyComposer(s)).toBe(false);
  });

  it('adds, moves and removes posts, keeping at least one', () => {
    let s = run(
      fresh(),
      { type: 'setText', index: 0, text: 'a' },
      { type: 'addPost', after: 0 },
    );
    s = run(
      s,
      { type: 'setText', index: 1, text: 'b' },
      { type: 'addPost', after: 0 },
    );
    expect(s.posts.map((p) => p.text)).toEqual(['a', '', 'b']);
    s = run(s, { type: 'movePost', from: 2, to: 0 });
    expect(s.posts.map((p) => p.text)).toEqual(['b', 'a', '']);
    s = run(
      s,
      { type: 'removePost', index: 2 },
      { type: 'removePost', index: 0 },
    );
    expect(s.posts.map((p) => p.text)).toEqual(['a']);
    s = run(s, { type: 'removePost', index: 0 });
    expect(s.posts).toHaveLength(1);
    expect(s.posts[0].text).toBe('');
  });

  it('stops at 25 posts and ignores out-of-range indices', () => {
    let s = fresh();
    for (let i = 0; i < 30; i++) s = composerReducer(s, { type: 'addPost' });
    expect(s.posts).toHaveLength(MAX_POSTS);
    expect(composerReducer(s, { type: 'setText', index: 99, text: 'x' })).toBe(
      s,
    );
    expect(composerReducer(s, { type: 'movePost', from: 0, to: 99 })).toBe(s);
    expect(composerReducer(s, { type: 'nope' })).toBe(s);
  });
});

describe('composerReducer: media', () => {
  it('adds up to four images, which replace a video and a card', () => {
    let s = run(
      fresh(),
      { type: 'setCard', index: 0, card: { url: 'https://e.com', title: 'T' } },
      {
        type: 'addImages',
        index: 0,
        images: [1, 2, 3].map((n) => ({ id: `i${n}`, file: file() })),
      },
    );
    expect(s.posts[0].card).toBeNull();
    s = run(s, {
      type: 'addImages',
      index: 0,
      images: [{ id: 'i4' }, { id: 'i5' }],
    });
    expect(s.posts[0].images.map((i) => i.id)).toEqual([
      'i1',
      'i2',
      'i3',
      'i4',
    ]);
    expect(s.posts[0].images[0].alt).toBe('');
  });

  it('updates, reorders and removes an image by id', () => {
    let s = run(fresh(), {
      type: 'addImages',
      index: 0,
      images: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    });
    s = run(s, {
      type: 'updateImage',
      index: 0,
      id: 'b',
      patch: { alt: 'bee', id: 'zzz' },
    });
    expect(s.posts[0].images[1]).toMatchObject({ id: 'b', alt: 'bee' });
    s = run(s, { type: 'moveImage', index: 0, from: 2, to: 0 });
    expect(s.posts[0].images.map((i) => i.id)).toEqual(['c', 'a', 'b']);
    s = run(s, { type: 'removeImage', index: 0, id: 'a' });
    expect(s.posts[0].images.map((i) => i.id)).toEqual(['c', 'b']);
  });

  it('lets a video replace images and the card', () => {
    const s = run(
      fresh(),
      { type: 'addImages', index: 0, images: [{ id: 'a' }] },
      {
        type: 'setVideo',
        index: 0,
        video: { file: file('v.mp4'), mime: 'video/mp4', size: 1 },
      },
    );
    expect(s.posts[0].images).toEqual([]);
    expect(s.posts[0].video).toMatchObject({ status: 'idle', alt: '' });
    expect(
      run(s, { type: 'setVideo', index: 0, video: null }).posts[0].video,
    ).toBeNull();
  });

  it('won’t add a card beside media, but a record sits beside anything', () => {
    let s = run(fresh(), {
      type: 'addImages',
      index: 0,
      images: [{ id: 'a' }],
    });
    s = run(s, { type: 'setCard', index: 0, card: { url: 'https://e.com' } });
    expect(s.posts[0].card).toBeNull();
    s = run(s, {
      type: 'setRecord',
      index: 0,
      record: { kind: 'post', uri: 'at://q', cid: 'c' },
    });
    expect(s.posts[0].record).toMatchObject({ kind: 'post', uri: 'at://q' });
    expect(s.posts[0].images).toHaveLength(1);
  });
});

describe('composerReducer: composer-wide', () => {
  it('normalizes tags, langs and labels', () => {
    const s = run(
      fresh(),
      { type: 'setTags', tags: '#a, A, b' },
      { type: 'setLangs', langs: ['en', 'en', 'de', 'fr', 'ja'] },
      {
        type: 'setLabels',
        labels: ['nudity', 'graphic-media', 'porn', 'bogus'],
      },
    );
    expect(s.tags).toEqual(['a', 'b']);
    expect(s.langs).toEqual(['en', 'de', 'fr']);
    // One adult label: the last chosen.
    expect(s.labels).toEqual(['graphic-media', 'porn']);
  });

  it('marks gates set by the writer custom, and lets defaults fill only the rest', () => {
    let s = run(fresh(), {
      type: 'setDefaultGates',
      gates: { reply: [], quotes: true },
    });
    expect(s.gates).toEqual({ custom: false, reply: [], quotes: true });
    s = run(s, { type: 'setGates', gates: { reply: null, quotes: false } });
    expect(s.gates).toEqual({ custom: true, reply: null, quotes: false });
    expect(
      run(s, { type: 'setDefaultGates', gates: { reply: [], quotes: true } }),
    ).toBe(s);
  });

  it('sets reply, schedule, lifespan and source', () => {
    const reply = {
      uri: 'at://p',
      cid: 'c',
      root: { uri: 'at://r', cid: 'rc' },
    };
    const s = run(
      fresh(),
      { type: 'setReply', reply },
      {
        type: 'setSchedule',
        schedule: { mode: 'at', at: '2026-12-01T00:00:00.000Z' },
      },
      { type: 'setLifespan', lifespan: { enabled: true } },
      { type: 'setSource', source: { kind: 'draft', id: 'd1', ownerDid: ME } },
    );
    expect(s).toMatchObject({
      reply,
      schedule: { mode: 'at', at: '2026-12-01T00:00:00.000Z' },
      lifespan: { enabled: true },
      source: { kind: 'draft', id: 'd1' },
    });
    expect(
      run(s, { type: 'setSchedule', schedule: { mode: 'queue', at: 'x' } })
        .schedule,
    ).toEqual({ mode: 'queue' });
    expect(run(s, { type: 'setLifespan', lifespan: null }).lifespan).toEqual({
      enabled: false,
    });
  });

  it('drops blobs that belong to another account when the write account changes, keeping the files', () => {
    const f = file();
    let s = run(
      fresh(),
      {
        type: 'addImages',
        index: 0,
        images: [
          { id: 'mine', file: f, blob: blob('1'), blobDid: OTHER },
          { id: 'theirs', file: f, blob: blob('2'), blobDid: ME },
        ],
      },
      { type: 'addPost' },
      {
        type: 'setVideo',
        index: 1,
        video: {
          file: f,
          blob: blob('v'),
          blobDid: ME,
          jobId: 'j',
          status: 'ready',
        },
      },
      { type: 'addPost' },
      {
        type: 'setCard',
        index: 2,
        card: {
          url: 'https://e.com',
          thumb: 'https://t',
          thumbBlob: blob('t'),
          thumbBlobDid: ME,
        },
      },
    );
    s = run(s, { type: 'setAsDid', did: OTHER });
    expect(s.asDid).toBe(OTHER);
    expect(s.posts[0].images[0]).toMatchObject({
      id: 'mine',
      blob: blob('1'),
      blobDid: OTHER,
    });
    expect(s.posts[0].images[1]).not.toHaveProperty('blob');
    expect(s.posts[0].images[1].file).toBe(f);
    expect(s.posts[1].video).toEqual({ file: f, alt: '', status: 'idle' });
    expect(s.posts[2].card).not.toHaveProperty('thumbBlob');
    expect(s.posts[2].card.thumb).toBe('https://t');
    expect(run(s, { type: 'setAsDid', did: OTHER })).toBe(s);
  });

  it('loads and resets through the normalizer', () => {
    const loaded = run(fresh(), {
      type: 'load',
      state: { asDid: ME, posts: [{ text: 'x' }], gates: {} },
    });
    expect(loaded.posts[0]).toMatchObject({
      text: 'x',
      images: [],
      video: null,
    });
    expect(loaded.posts[0].id).toBeTruthy();
    expect(loaded.gates).toEqual({ custom: false, reply: null, quotes: true });
    const reset = run(loaded, {
      type: 'reset',
      state: emptyComposerState({ asDid: OTHER }),
    });
    expect(reset.asDid).toBe(OTHER);
    expect(isEmptyComposer(reset)).toBe(true);
  });
});

describe('normalizeComposerState', () => {
  it('fills every hole and caps posts and langs', () => {
    const s = normalizeComposerState({
      posts: Array.from({ length: 30 }, () => ({})),
      langs: ['a', 'b', 'c', 'd'],
    });
    expect(s.posts).toHaveLength(25);
    expect(s.langs).toEqual(['a', 'b', 'c']);
    expect(normalizeComposerState(null).posts).toHaveLength(1);
  });
});

describe('labels', () => {
  it('round-trips self-labels', () => {
    const self = labelsToSelfLabels(['porn', 'graphic-media', 'porn', 'bogus']);
    expect(self).toEqual({
      $type: 'com.atproto.label.defs#selfLabels',
      values: [{ val: 'porn' }, { val: 'graphic-media' }],
    });
    expect(selfLabelsToLabels(self)).toEqual(['porn', 'graphic-media']);
    expect(labelsToSelfLabels([])).toBeNull();
    expect(selfLabelsToLabels(undefined)).toEqual([]);
  });
});

describe('validateComposer', () => {
  const now = Date.UTC(2026, 10, 12, 12);
  const withText = (text) => run(fresh(), { type: 'setText', index: 0, text });

  it('passes an ordinary post', () => {
    expect(validateComposer(withText('hello'), { now })).toEqual([]);
  });

  it('refuses an empty composer and empty posts inside a thread', () => {
    expect(codes(validateComposer(fresh(), { now }))).toEqual(['EMPTY']);
    const s = run(withText('a'), { type: 'addPost' });
    expect(validateComposer(s, { now })).toEqual([
      { postIndex: 1, code: 'POST_EMPTY', message: expect.any(String) },
    ]);
  });

  it('counts graphemes as written: long links count short', () => {
    expect(codes(validateComposer(withText('a'.repeat(300)), { now }))).toEqual(
      [],
    );
    expect(codes(validateComposer(withText('a'.repeat(301)), { now }))).toEqual(
      ['TOO_LONG'],
    );
    const link = `https://example.com/${'x'.repeat(200)}`;
    expect(
      codes(validateComposer(withText(`${'a'.repeat(250)} ${link}`), { now })),
    ).toEqual([]);
  });

  it('checks UTF-8 bytes too', () => {
    // 300 graphemes, each an 11-byte ZWJ pair: under the grapheme cap, over 3000 bytes.
    const heavy = '\u{1F469}‍\u{1F52C}'.repeat(300);
    expect(codes(validateComposer(withText(heavy), { now }))).toEqual([
      'TOO_MANY_BYTES',
    ]);
  });

  it('checks media', () => {
    const s = normalizeComposerState({
      asDid: ME,
      posts: [
        {
          text: 'x',
          images: [{}, {}, {}, {}, {}].map(() => ({ file: file() })),
        },
        { text: 'y', images: [{ file: file() }], video: { file: file() } },
        { text: 'z', images: [{ alt: 'gone' }] },
        { text: 'w', video: { alt: 'v'.repeat(1001) } },
      ],
    });
    expect(
      validateComposer(s, { now }).map((p) => [p.postIndex, p.code]),
    ).toEqual([
      [0, 'TOO_MANY_IMAGES'],
      [1, 'MEDIA_CONFLICT'],
      [2, 'IMAGE_MISSING'],
      [3, 'VIDEO_MISSING'],
      [3, 'ALT_TOO_LONG'],
    ]);
  });

  it('asks for alt text only when the writer requires it', () => {
    const s = run(withText('x'), {
      type: 'addImages',
      index: 0,
      images: [{ file: file(), alt: ' ' }],
    });
    expect(codes(validateComposer(s, { now }))).toEqual([]);
    expect(codes(validateComposer(s, { now, requireAltText: true }))).toEqual([
      'ALT_MISSING',
    ]);
  });

  it('refuses a record that never resolved', () => {
    const s = run(withText('x'), {
      type: 'setRecord',
      index: 0,
      record: { kind: 'post', uri: 'at://q' },
    });
    expect(codes(validateComposer(s, { now }))).toEqual(['RECORD_UNRESOLVED']);
  });

  it('checks tags, langs, labels and reply groups', () => {
    const s = {
      ...withText('x'),
      tags: Array.from({ length: 9 }, (_, i) => `t${i}`),
      langs: ['a', 'b', 'c', 'd'],
      labels: ['porn', 'nudity', 'bogus'],
      gates: {
        custom: true,
        reply: Array.from({ length: 6 }, () => ({ type: 'mention' })),
        quotes: true,
      },
    };
    expect(codes(validateComposer(s, { now }))).toEqual([
      'TOO_MANY_TAGS',
      'TOO_MANY_LANGS',
      'LABEL_INVALID',
      'LABEL_CONFLICT',
      'GATES_TOO_MANY',
    ]);
    expect(
      codes(
        validateComposer({ ...withText('x'), tags: ['a'.repeat(65)] }, { now }),
      ),
    ).toEqual(['TAG_INVALID']);
  });

  it('refuses replies and video for scheduling only', () => {
    const reply = {
      uri: 'at://p',
      cid: 'c',
      root: { uri: 'at://p', cid: 'c' },
    };
    let s = run(withText('x'), { type: 'setReply', reply });
    expect(codes(validateComposer(s, { now }))).toEqual([]);
    expect(codes(validateComposer(s, { now, forSchedule: true }))).toEqual([
      'SCHEDULE_REPLY',
    ]);
    s = run(withText('x'), {
      type: 'setVideo',
      index: 0,
      video: { file: file() },
    });
    expect(codes(validateComposer(s, { now }))).toEqual([]);
    expect(codes(validateComposer(s, { now, forSchedule: true }))).toEqual([
      'SCHEDULE_VIDEO',
    ]);
  });

  it('wants a scheduled time at least a minute out and at most 90 days', () => {
    const at = (ms) =>
      run(withText('x'), {
        type: 'setSchedule',
        schedule: { mode: 'at', at: new Date(ms).toISOString() },
      });
    expect(
      codes(validateComposer(at(now + 120_000), { now, forSchedule: true })),
    ).toEqual([]);
    expect(
      codes(validateComposer(at(now + 30_000), { now, forSchedule: true })),
    ).toEqual(['SCHEDULE_PAST']);
    expect(
      codes(
        validateComposer(at(now + 91 * 86_400_000), { now, forSchedule: true }),
      ),
    ).toEqual(['SCHEDULE_TOO_FAR']);
    const bad = run(withText('x'), {
      type: 'setSchedule',
      schedule: { mode: 'at', at: 'soon' },
    });
    expect(codes(validateComposer(bad, { now, forSchedule: true }))).toEqual([
      'SCHEDULE_INVALID',
    ]);
    const queued = run(withText('x'), {
      type: 'setSchedule',
      schedule: { mode: 'queue' },
    });
    expect(codes(validateComposer(queued, { now, forSchedule: true }))).toEqual(
      [],
    );
  });

  it('asks the injected timer check about an armed timer only', () => {
    const lifespanProblem = vi.fn(() => 'That time has passed.');
    const off = withText('x');
    expect(validateComposer(off, { now, lifespanProblem })).toEqual([]);
    expect(lifespanProblem).not.toHaveBeenCalled();
    const on = run(off, { type: 'setLifespan', lifespan: { enabled: true } });
    expect(validateComposer(on, { now, lifespanProblem })).toEqual([
      { postIndex: null, code: 'LIFESPAN', message: 'That time has passed.' },
    ]);
  });

  it('needs an account', () => {
    expect(
      codes(validateComposer({ ...withText('x'), asDid: '' }, { now })),
    ).toEqual(['NO_ACCOUNT']);
  });
});

describe('resolvePostTexts', () => {
  it('collapses inline links, resolves mentions and shortens links, per post', async () => {
    const resolveMention = vi.fn(async (h) =>
      h === 'known.test' ? 'did:plc:known' : null,
    );
    const s = normalizeComposerState({
      asDid: ME,
      posts: [
        { text: '  hi @known.test and @nobody.test  ' },
        {
          text: 'read [this](https://example.com/a/very/long/path/indeed) or https://example.com/another/long/path',
        },
      ],
    });
    const [first, second] = await resolvePostTexts(s, { resolveMention });
    expect(first.text).toBe('hi @known.test and @nobody.test');
    expect(first.facets).toHaveLength(1);
    expect(first.facets[0].features[0]).toEqual({
      $type: 'app.bsky.richtext.facet#mention',
      did: 'did:plc:known',
    });

    expect(second.text).toBe('read this or example.com/another/long...');
    const uris = second.facets.map((f) => f.features[0].uri);
    expect(uris).toEqual([
      'https://example.com/a/very/long/path/indeed',
      'https://example.com/another/long/path',
    ]);
  });

  it('keeps the punctuation after a link in the post, and out of its address', async () => {
    const cases = [
      [
        'Did you see https://example.com/page?',
        'Did you see example.com/page?',
        'https://example.com/page',
      ],
      [
        'Look: https://example.com: neat',
        'Look: example.com: neat',
        'https://example.com',
      ],
      [
        'Read https://example.com/page. Thanks',
        'Read example.com/page. Thanks',
        'https://example.com/page',
      ],
      [
        'See (https://example.com/page) ok',
        'See (example.com/page) ok',
        'https://example.com/page',
      ],
      ['<https://example.com/x>', '<example.com/x>', 'https://example.com/x'],
    ];
    for (const [input, written, uri] of cases) {
      const [post] = await resolvePostTexts(
        normalizeComposerState({ asDid: ME, posts: [{ text: input }] }),
        { resolveMention: async () => null },
      );
      expect(post.text, input).toBe(written);
      expect(
        post.facets.map((f) => f.features[0].uri),
        input,
      ).toEqual([uri]);
      // The count measured what was written.
      expect(countComposerGraphemes(input), input).toBe(
        [...new Intl.Segmenter().segment(written)].length,
      );
    }
  });

  it('links a URL with an address in it whole, and counts it as written', async () => {
    const url =
      'https://example.com/newsletter/subscribe?ref=share&email=reader@example.org&utm_source=bsky&utm_medium=social';
    const text = `${'a'.repeat(270)} ${url}`;
    const s = normalizeComposerState({
      asDid: ME,
      langs: ['en'],
      posts: [{ text }],
    });
    const [post] = await resolvePostTexts(s, {
      resolveMention: async () => null,
    });
    expect(post.facets.map((f) => f.features[0].uri)).toEqual([url]);
    expect(post.text).toBe(`${'a'.repeat(270)} example.com/newsletter/s...`);
    const written = [...new Intl.Segmenter().segment(post.text)].length;
    expect(countComposerGraphemes(text)).toBe(written);
    expect(written).toBeLessThanOrEqual(300);
    expect(validateComposer(s)).toEqual([]);
  });

  it('stops when cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      resolvePostTexts(fresh(), { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
