import { describe, expect, it } from 'vitest';
import {
  replaceRange,
  insertMention,
  pasteAsInlineLink,
  misleadingLinkNotes,
  removeLinkFromText,
  splitForThread,
  limitAnnouncement,
} from './editing.js';
import { countComposerGraphemes } from '../lib/inlineLinks.js';

describe('replaceRange', () => {
  it('replaces and puts the caret after', () => {
    expect(replaceRange('hello world', 6, 11, 'there')).toEqual({
      text: 'hello there',
      caret: 11,
    });
  });
  it('clamps out-of-range offsets', () => {
    expect(replaceRange('abc', -3, 99, 'x')).toEqual({ text: 'x', caret: 1 });
  });
});

describe('insertMention', () => {
  it('replaces the partial mention with the handle and a space', () => {
    const r = insertMention('hi @wr', { start: 3, end: 6 }, 'wren.example.com');
    expect(r).toEqual({ text: 'hi @wren.example.com ', caret: 21 });
  });
  it('does not double a space that is already there', () => {
    const r = insertMention(
      'hi @wr there',
      { start: 3, end: 6 },
      '@wren.example.com',
    );
    expect(r.text).toBe('hi @wren.example.com there');
    expect(r.caret).toBe(21);
  });
});

describe('pasteAsInlineLink', () => {
  it('links the selected words', () => {
    const r = pasteAsInlineLink(
      'read this guide now',
      10,
      15,
      'https://example.org/guide',
    );
    expect(r).toEqual({
      text: 'read this [guide](https://example.org/guide) now',
      caret: 44,
    });
  });
  it('leaves an ordinary paste alone', () => {
    expect(pasteAsInlineLink('abc', 1, 1, 'https://example.org')).toBeNull();
    expect(pasteAsInlineLink('abc def', 0, 3, 'not a link')).toBeNull();
    expect(pasteAsInlineLink('a\nb', 0, 3, 'https://example.org')).toBeNull();
  });
  it('replaces rather than links a selected address', () => {
    expect(
      pasteAsInlineLink('see example.com', 4, 15, 'https://example.org'),
    ).toBeNull();
  });
  it('refuses words that name another site', () => {
    const r = pasteAsInlineLink(
      'go to paypal.com today',
      6,
      16,
      'https://evil.example/login',
    );
    expect(r).toBeNull(); // a selected address is replaced, not linked
    const r2 = pasteAsInlineLink(
      'log in at paypal.com now please',
      10,
      24,
      'https://evil.example/login',
    );
    expect(r2.refused).toMatch(/names a different site/);
    expect(r2.refused).toMatch(/evil\.example/);
  });
});

describe('misleadingLinkNotes', () => {
  it('names each misleading inline link', () => {
    const notes = misleadingLinkNotes(
      '[bank.com](https://evil.example) and [fine](https://ok.example)',
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/“bank\.com” names a different site/);
  });
});

describe('removeLinkFromText', () => {
  const link = 'https://bsky.app/profile/a.example/post/3a';
  it('takes a trailing link out with its space', () => {
    const text = `look at this ${link}`;
    expect(
      removeLinkFromText(text, {
        charStart: 13,
        charEnd: text.length,
        expect: link,
      }),
    ).toBe('look at this');
  });
  it('takes a link out of the middle', () => {
    const text = `a ${link} b`;
    expect(
      removeLinkFromText(text, {
        charStart: 2,
        charEnd: 2 + link.length,
        expect: link,
      }),
    ).toBe('a b');
  });
  it('takes a leading link out', () => {
    const text = `${link} nice`;
    expect(
      removeLinkFromText(text, {
        charStart: 0,
        charEnd: link.length,
        expect: link,
      }),
    ).toBe('nice');
  });
  it('leaves text the writer changed since', () => {
    const text = `a ${link}`;
    expect(
      removeLinkFromText(text, {
        charStart: 2,
        charEnd: 2 + link.length,
        expect: 'other',
      }),
    ).toBe(text);
  });
});

describe('splitForThread', () => {
  it('leaves a post that fits alone', () => {
    expect(splitForThread('short')).toEqual(['short']);
  });
  it('splits at sentence breaks, each part within the limit', () => {
    const sentence = 'This is a sentence that goes on for a while. ';
    const text = sentence.repeat(12).trim();
    const parts = splitForThread(text, 300);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      expect(countComposerGraphemes(p)).toBeLessThanOrEqual(300);
      expect(p.endsWith('.')).toBe(true);
    }
    expect(parts.join(' ')).toBe(text);
  });
  it('prefers a paragraph break', () => {
    const a = 'x'.repeat(200);
    const b = 'y '.repeat(80).trim();
    const parts = splitForThread(`${a}\n\n${b}`, 300);
    expect(parts[0]).toBe(a);
  });
  it('cuts a word that is longer than a post', () => {
    const parts = splitForThread('z'.repeat(650), 300);
    expect(parts.map((p) => p.length)).toEqual([300, 300, 50]);
  });
  it('counts links as they will be written', () => {
    const url = `https://example.org/${'a'.repeat(200)}`;
    expect(splitForThread(`${url} ${'w '.repeat(100).trim()}`)).toHaveLength(1);
  });
});

describe('splitForThread with no room for every part', () => {
  it('keeps what doesn’t fit in the last post instead of dropping it', () => {
    const sentence = 'The river ran high after the storm and the herons came back to the shallows. ';
    const text = sentence.repeat(12).trim();
    const all = splitForThread(text, 300);
    expect(all.length).toBeGreaterThan(2);
    const two = splitForThread(text, 300, { maxParts: 2 });
    expect(two).toHaveLength(2);
    expect(two[0]).toBe(all[0]);
    expect(countComposerGraphemes(two[1])).toBeGreaterThan(300);
    // Every word is still there.
    expect(two.join(' ').split(/\s+/)).toEqual(text.split(/\s+/));
    // A full thread has no room at all: nothing is split off.
    expect(splitForThread(text, 300, { maxParts: 1 })).toEqual([text]);
  });
});

describe('limitAnnouncement', () => {
  it('says something only near or past the limit', () => {
    expect(limitAnnouncement(12)).toBe('');
    expect(limitAnnouncement(279)).toBe('');
    expect(limitAnnouncement(280)).toBe('Close to the 300-character limit.');
    expect(limitAnnouncement(300)).toBe('Close to the 300-character limit.');
    expect(limitAnnouncement(301)).toBe('Over the 300-character limit.');
  });
});
