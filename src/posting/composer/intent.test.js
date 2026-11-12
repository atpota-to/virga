import { describe, expect, it } from 'vitest';
import {
  normalizeIntent,
  readTargetRef,
  intentLoads,
  seedFromIntent,
} from './intent.js';
import { emptyComposerState, emptyPost } from '../lib/composerModel.js';
import { REPLY_HINT } from '../schedule/publishActions.js';

const MIRA = 'did:plc:mira';
const LAB = 'did:plc:lab';

describe('readTargetRef', () => {
  it('reads an at:// URI with its kind', () => {
    expect(
      readTargetRef({ uri: `at://${MIRA}/app.bsky.feed.post/3abc` }),
    ).toMatchObject({
      kind: 'post',
      uri: `at://${MIRA}/app.bsky.feed.post/3abc`,
      did: MIRA,
      rkey: '3abc',
    });
  });

  it('reads a bsky.app link with a handle, leaving the handle to resolve', () => {
    const ref = readTargetRef({
      url: 'https://bsky.app/profile/wren.example.com/post/3xyz',
    });
    expect(ref).toMatchObject({
      kind: 'post',
      handle: 'wren.example.com',
      rkey: '3xyz',
    });
    expect(ref.uri).toBeUndefined();
  });

  it('gives a URI straight away when the link has a DID', () => {
    const ref = readTargetRef(`https://bsky.app/profile/${MIRA}/post/3xyz`);
    expect(ref.uri).toBe(`at://${MIRA}/app.bsky.feed.post/3xyz`);
  });

  it('reads feeds and lists', () => {
    expect(
      readTargetRef('https://bsky.app/profile/a.example/feed/cats').kind,
    ).toBe('feed');
    expect(
      readTargetRef('https://bsky.app/profile/a.example/lists/3l').kind,
    ).toBe('list');
  });

  it('is null for anything else', () => {
    expect(readTargetRef('https://example.com/post/1')).toBeNull();
    expect(readTargetRef({})).toBeNull();
    expect(readTargetRef(null)).toBeNull();
  });
});

describe('normalizeIntent', () => {
  it('posts as the active account by default, with nothing to load', () => {
    const plan = normalizeIntent({}, { activeDid: MIRA });
    expect(plan).toMatchObject({
      asDid: MIRA,
      texts: [],
      mode: 'post',
      hasContent: false,
    });
    expect(intentLoads(plan)).toEqual([]);
  });

  it('takes the intent’s account, text and tags', () => {
    const plan = normalizeIntent(
      { asDid: LAB, text: 'hello', tags: ['#One', 'one', 'two'] },
      { activeDid: MIRA },
    );
    expect(plan.asDid).toBe(LAB);
    expect(plan.texts).toEqual(['hello']);
    expect(plan.tags).toEqual(['One', 'two']);
    expect(plan.hasContent).toBe(true);
  });

  it('reads a thread from posts', () => {
    const plan = normalizeIntent(
      { posts: [{ text: 'a' }, { text: 'b' }] },
      { activeDid: MIRA },
    );
    expect(plan.texts).toEqual(['a', 'b']);
  });

  it('opens a draft as its owner', () => {
    const plan = normalizeIntent(
      { draftId: 'd1', draftOwnerDid: LAB },
      { activeDid: MIRA },
    );
    expect(plan.asDid).toBe(LAB);
    expect(plan.draftOwnerDid).toBe(LAB);
    expect(intentLoads(plan)).toEqual(['draft']);
  });

  it('a draft without an owner is the active account’s', () => {
    expect(
      normalizeIntent({ draftId: 'd1' }, { activeDid: MIRA }).draftOwnerDid,
    ).toBe(MIRA);
  });

  it('a reply asked to be scheduled opens in post mode and says why (D19)', () => {
    const plan = normalizeIntent(
      {
        reply: { uri: `at://${MIRA}/app.bsky.feed.post/3a` },
        mode: 'schedule',
      },
      { activeDid: MIRA },
    );
    expect(plan.mode).toBe('post');
    expect(plan.notes).toContain(REPLY_HINT);
  });

  it('a reply must name a post', () => {
    expect(
      normalizeIntent({
        reply: { url: 'https://bsky.app/profile/a.example/feed/x' },
      }).reply,
    ).toBeNull();
  });

  it('lists what it loads: a scheduled post alone, else reply, quote, template, attach', () => {
    expect(
      intentLoads(
        normalizeIntent({
          scheduledId: 's1',
          reply: { uri: `at://${MIRA}/app.bsky.feed.post/3a` },
        }),
      ),
    ).toEqual(['scheduled']);
    expect(
      intentLoads(
        normalizeIntent({
          reply: { uri: `at://${MIRA}/app.bsky.feed.post/3a` },
          quote: { url: 'https://bsky.app/profile/a.example/post/3b' },
          templateId: 't',
          attach: { insertText: 'x' },
        }),
      ),
    ).toEqual(['reply', 'quote', 'template', 'attach']);
  });

  it('keeps the link notice for /intent/compose', () => {
    const plan = normalizeIntent({
      text: 'x https://a.example',
      fromLink: true,
      url: 'https://a.example',
    });
    expect(plan.fromLink).toBe(true);
    expect(plan.url).toBe('https://a.example');
  });

  it('caps languages at three', () => {
    expect(normalizeIntent({ langs: ['en', 'fr', 'de', 'es'] }).langs).toEqual([
      'en',
      'fr',
      'de',
    ]);
  });
});

describe('seedFromIntent', () => {
  it('puts each text in its post and keeps the defaults otherwise', () => {
    const base = emptyComposerState({
      asDid: MIRA,
      defaults: { langs: ['en'] },
    });
    const seeded = seedFromIntent(
      base,
      normalizeIntent({
        posts: [{ text: 'one' }, { text: 'two' }],
        mode: 'queue',
      }),
      { emptyPost },
    );
    expect(seeded.posts.map((p) => p.text)).toEqual(['one', 'two']);
    expect(seeded.posts[0].id).toBe(base.posts[0].id);
    expect(seeded.langs).toEqual(['en']);
    expect(seeded.schedule).toEqual({ mode: 'queue' });
  });

  it('uses the intent’s languages and tags', () => {
    const base = emptyComposerState({
      asDid: MIRA,
      defaults: { langs: ['en'] },
    });
    const seeded = seedFromIntent(
      base,
      normalizeIntent({ langs: ['fr'], tags: ['a'] }),
      { emptyPost },
    );
    expect(seeded.langs).toEqual(['fr']);
    expect(seeded.tags).toEqual(['a']);
  });
});
