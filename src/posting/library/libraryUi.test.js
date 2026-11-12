import { describe, expect, it } from 'vitest';
import { SHELF_EMPTY, SHELF_HINT, initialShelf, looksLikeLink, moveActive, sectionsFor, templateContextFrom } from './libraryUi.js';
import { LIBRARY_SHELVES } from './model.js';

describe('shelf copy', () => {
  it('covers every shelf', () => {
    for (const { id } of LIBRARY_SHELVES) {
      expect(SHELF_EMPTY[id]).toBeTruthy();
      expect(SHELF_HINT[id]).toBeTruthy();
    }
  });
});

describe('looksLikeLink', () => {
  it('takes web addresses and at:// URIs', () => {
    expect(looksLikeLink('https://bsky.app/profile/a.example/post/3abc')).toBe(true);
    expect(looksLikeLink(' http://example.com ')).toBe(true);
    expect(looksLikeLink('at://did:plc:abc/app.bsky.feed.post/3abc')).toBe(true);
  });
  it('leaves words alone', () => {
    expect(looksLikeLink('river walk')).toBe(false);
    expect(looksLikeLink('example.com')).toBe(false);
    expect(looksLikeLink('https://localhost')).toBe(false);
    expect(looksLikeLink('mailto:a@b.c')).toBe(false);
    expect(looksLikeLink('')).toBe(false);
  });
});

describe('moveActive', () => {
  const ids = ['a', 'b', 'c'];
  it('steps and wraps', () => {
    expect(moveActive(ids, 'a', 1)).toBe('b');
    expect(moveActive(ids, 'c', 1)).toBe('a');
    expect(moveActive(ids, 'a', -1)).toBe('c');
  });
  it('starts at an end when nothing is active', () => {
    expect(moveActive(ids, null, 1)).toBe('a');
    expect(moveActive(ids, 'gone', -1)).toBe('c');
    expect(moveActive(ids, 'b', 'first')).toBe('a');
    expect(moveActive(ids, 'b', 'last')).toBe('c');
    expect(moveActive([], 'a', 1)).toBeNull();
  });
});

describe('templateContextFrom', () => {
  it('passes a template context through', () => {
    const ctx = { today: 'November 12', my: { handle: '@a' } };
    expect(templateContextFrom(ctx)).toBe(ctx);
  });
  it('makes one from the composer’s reply', () => {
    const ctx = templateContextFrom(
      { state: { reply: { uri: 'at://x/app.bsky.feed.post/1', author: { handle: 'wren.example', displayName: '🌿 Wren Okafor' }, text: 'hi' } } },
      { selfHandle: 'mira.example.com' },
    );
    expect(ctx.their.firstName).toBe('Wren');
    expect(ctx.my.handle).toBe('mira.example.com');
    expect(typeof ctx.today).toBe('string');
  });
  it('makes one with no reply', () => {
    const ctx = templateContextFrom(undefined, { selfHandle: 'a.example' });
    expect(ctx.their).toBeFalsy();
  });
});

describe('initialShelf', () => {
  it('opens where asked, else the default', () => {
    expect(initialShelf({ shelf: 'saved' }, { replying: false })).toBe('saved');
    expect(initialShelf({ shelf: 'suggested' }, { replying: false })).toBe('templates');
    expect(initialShelf({}, { replying: true })).toBe('suggested');
    expect(initialShelf(null, { replying: false })).toBe('templates');
  });
});

describe('sectionsFor', () => {
  it('takes the template shelf’s groups', () => {
    const sections = [{ id: 'g', heading: 'G', items: [] }];
    expect(sectionsFor('templates', [], { templateSections: sections })).toBe(sections);
  });
  it('splits feeds into yours and saved', () => {
    const s = sectionsFor('feeds', [
      { id: 'feed:1', group: 'yours' },
      { id: 'feed:2', group: 'saved' },
    ]);
    expect(s.map((x) => x.heading)).toEqual(['Yours', 'Saved']);
    expect(sectionsFor('feeds', [{ id: 'feed:1', group: 'yours' }])[0].heading).toBeNull();
  });
  it('gives one section for the rest, none when empty', () => {
    expect(sectionsFor('links', [{ id: 'link:1' }])).toHaveLength(1);
    expect(sectionsFor('links', [])).toEqual([]);
  });
});
