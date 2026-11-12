/*
 * Mention detection: where an @handle starts and ends (findMentions, which
 * facet detection shares) and the composer typeahead. Apostrophes, quotes and
 * every non-ASCII character are written as \u escapes so an editor can't
 * flatten or mangle them.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  detectCompletedMentions,
  detectPartialMention,
  findMentions,
  createMentionResolver,
  isValidHandle,
} from './mentions.js';

const completed = (start, handle) => ({
  start,
  end: start + handle.length + 1,
  handle,
  fullText: `@${handle}`,
});

describe('detectCompletedMentions', () => {
  it.each([
    ['straight', "'"],
    ['curly', '\u2019'],
  ])(
    'waits on a %s apostrophe until the possessive s arrives',
    (_kind, apostrophe) => {
      const typing = `hi @dame.art${apostrophe}`;
      expect(detectCompletedMentions(typing, typing.length)).toEqual([]);

      const done = `hi @dame.art${apostrophe}s note`;
      expect(detectCompletedMentions(done, done.length)).toEqual([
        completed(3, 'dame.art'),
      ]);
    },
  );

  it.each([
    ['straight', '"', '"'],
    ['curly', '\u201C', '\u201D'],
  ])('reads a handle whole up to a %s closing quote', (_kind, open, close) => {
    const text = `${open}hi @dame.art${close} ok`;
    expect(detectCompletedMentions(text, text.length)).toEqual([
      completed(4, 'dame.art'),
    ]);
  });

  it('leaves the mention under the cursor alone', () => {
    const text = 'hi @dame.art';
    expect(detectCompletedMentions(text, text.length)).toEqual([]);
    expect(detectCompletedMentions(`${text} `, text.length + 1)).toEqual([
      completed(3, 'dame.art'),
    ]);
  });
});

describe('isValidHandle', () => {
  // 63 characters per segment, 253 in all: the limits themselves.
  const longest = `${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(61)}`;

  it('accepts handle syntax up to its limits', () => {
    for (const handle of [
      'dame.art',
      'a.b',
      'alice.bsky.social',
      'x-y.test',
      'note9.co',
      'ab.c2',
      `${'a'.repeat(63)}.test`,
      longest,
    ]) {
      expect(isValidHandle(handle), handle).toBe(true);
    }
    expect(longest).toHaveLength(253);
  });

  it('refuses everything outside it', () => {
    for (const handle of [
      'dame', // one segment
      'dame.',
      '.dame.art',
      'dame..art', // empty segments
      '-dame.art',
      'dame-.art',
      'dame.art-', // hyphen at a segment end
      'dame.2art', // TLD starting with a digit
      'dame_x.art',
      'd\u00E9me.art',
      'dame.art\u{1F98B}', // not handle characters
      `${'a'.repeat(64)}.test`,
      `${longest}d`,
      '',
      null,
      undefined,
      42,
    ]) {
      expect(isValidHandle(handle), String(handle)).toBe(false);
    }
  });
});

describe('findMentions', () => {
  const at = (text, handle, email = false) => {
    const start = text.indexOf(`@${handle}`);
    return { start, end: start + handle.length + 1, handle, email };
  };

  it.each([
    ['an emoji', 'hi @dame.art\u{1F98B}'],
    ['the low half of an emoji before the @', '\u{1F98B}@dame.art'],
    ['an ellipsis character', 'hi @dame.art\u2026'],
    ['three full stops', 'hi @dame.art...'],
    ['a full stop', 'thanks @dame.art.'],
    ['a comma', 'hi @dame.art, ok'],
    ['parens', 'notes (@dame.art) ok'],
    ['CJK on both sides', '\u65E5@dame.art\u672C'],
    ['curly quotes', '\u201C@dame.art\u201D'],
    ['a straight possessive', "@dame.art's note"],
    ['an underscore', '@dame.art_x'],
  ])('ends the handle at %s', (_kind, text) => {
    expect(findMentions(text)).toEqual([at(text, 'dame.art')]);
  });

  it('flags an @ straight after a letter or digit as an email address', () => {
    expect(findMentions('a@b.com')).toEqual([at('a@b.com', 'b.com', true)]);
    expect(findMentions('mail note9@dame.art.')).toEqual([
      at('mail note9@dame.art.', 'dame.art', true),
    ]);
    // Its domain is not checked: it is never looked up.
    expect(findMentions('me@localhost')).toEqual([
      at('me@localhost', 'localhost', true),
    ]);
  });

  it('skips an @ that opens a URL path segment or no handle at all', () => {
    expect(findMentions('https://example.com/@dame.art/notes')).toEqual([]);
    for (const text of [
      '@ dame.art',
      '@',
      '@.',
      '@dame',
      '@dame.2art',
      '@-dame.art',
      '@\u{1F98B}',
    ]) {
      expect(findMentions(text), text).toEqual([]);
    }
  });

  it('finds each mention in a run of them', () => {
    const text = '@a.test,@b.test @@c.test';
    expect(findMentions(text)).toEqual([
      at(text, 'a.test'),
      at(text, 'b.test'),
      at(text, 'c.test'),
    ]);
  });
});

describe('detectPartialMention', () => {
  it("stops the typeahead query at the first character a handle can't contain", () => {
    const text = 'hi @da\u{1F98B} more';
    expect(detectPartialMention(text, 6)).toEqual({
      start: 3,
      end: 6,
      query: 'da',
      fullText: '@da',
    });

    // A pick replaces [start, end): the comma after the cursor survives it.
    expect(detectPartialMention('hi @dame.art, ok', 8)).toEqual({
      start: 3,
      end: 12,
      query: 'dame.art',
      fullText: '@dame.art',
    });

    // A trailing dot may be the next segment on its way, so it stays in the query.
    expect(detectPartialMention('hi @dame.', 9)).toMatchObject({
      query: 'dame.',
    });
  });

  it('offers nothing once the cursor is past a character that ends the handle', () => {
    expect(detectPartialMention('hi @da\u{1F98B}x', 9)).toBeNull();
    expect(detectPartialMention('hi @dame.art\u2019s', 14)).toBeNull();
  });

  it('offers nothing for an email address or an @ in a URL path', () => {
    expect(detectPartialMention('mail me@da', 10)).toBeNull();
    expect(detectPartialMention('see /@da', 8)).toBeNull();
    // Control: after a space or a CJK character, the same @ is a mention.
    expect(detectPartialMention('mail @da', 8)).toMatchObject({ query: 'da' });
    expect(detectPartialMention('\u65E5@da', 4)).toMatchObject({ query: 'da' });
  });
});

describe('detectCompletedMentions: where a handle ends', () => {
  it('completes a handle at an emoji, a CJK character or an ellipsis', () => {
    for (const tail of ['\u{1F98B}', '\u65E5', '\u2026']) {
      const text = `hi @dame.art${tail} more`;
      expect(detectCompletedMentions(text, text.length), tail).toEqual([
        completed(3, 'dame.art'),
      ]);
    }
  });

  it('leaves the dot out of the handle, but waits while a dot may start the next segment', () => {
    const typing = 'hi @alice.bsky.';
    expect(detectCompletedMentions(typing, typing.length)).toEqual([]);

    const done = 'hi @dame.art. More';
    expect(detectCompletedMentions(done, done.length)).toEqual([
      completed(3, 'dame.art'),
    ]);
  });

  it("never validates an email address's domain", () => {
    const text = 'write to me@dame.art today';
    expect(detectCompletedMentions(text, text.length)).toEqual([]);
  });
});

describe('createMentionResolver', () => {
  const answer = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });

  it('asks the AppView for the bare, lowercased handle and returns the DID', async () => {
    const fetch = vi.fn(async () => answer(200, { did: 'did:plc:abc' }));
    const resolve = createMentionResolver({
      fetch,
      appview: 'https://appview.test',
    });
    await expect(resolve('@Alice.Test')).resolves.toBe('did:plc:abc');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe(
      'https://appview.test/xrpc/com.atproto.identity.resolveHandle?handle=alice.test',
    );
  });

  it('remembers answers for the TTL, and shares one request between concurrent asks', async () => {
    let t = 0;
    const fetch = vi.fn(async () => answer(200, { did: 'did:plc:abc' }));
    const resolve = createMentionResolver({ fetch, now: () => t, ttlMs: 1000 });
    await Promise.all([resolve('a.test'), resolve('a.test')]);
    expect(fetch).toHaveBeenCalledTimes(1);
    t = 999;
    await resolve('a.test');
    expect(fetch).toHaveBeenCalledTimes(1);
    t = 1000;
    await resolve('a.test');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('remembers a definite no, but not a network failure', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(answer(400, { error: 'InvalidRequest' }))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(answer(200, { did: 'did:plc:b' }));
    const resolve = createMentionResolver({ fetch });
    await expect(resolve('gone.test')).resolves.toBeNull();
    await expect(resolve('gone.test')).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);

    await expect(resolve('flaky.test')).resolves.toBeNull();
    await expect(resolve('flaky.test')).resolves.toBe('did:plc:b');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('refuses things that are not handles without asking', async () => {
    const fetch = vi.fn();
    const resolve = createMentionResolver({ fetch });
    await expect(resolve('nodot')).resolves.toBeNull();
    await expect(resolve('')).resolves.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('ignores a body without a DID', async () => {
    const resolve = createMentionResolver({
      fetch: async () => answer(200, { did: 'nope' }),
    });
    await expect(resolve('a.test')).resolves.toBeNull();
  });
});
