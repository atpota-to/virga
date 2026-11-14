/*
 * Post length as the 300-grapheme cap sees it: Bluesky stores a link as its
 * shortened display form with the full URL in the facet, and counts that. The
 * text the counter measures must be the text the record carries, and every
 * facet must still cover what it covered before.
 */

import { describe, it, expect } from 'vitest';
import {
  toShortUrl,
  shortenPostText,
  countPostGraphemes,
  shortenLinkFacets,
  expandLinkFacets,
} from './linkShortening.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// 84 characters that cost 27.
const LONG_URL =
  'https://example.org/profile/testing.dame.is/net.example.graph.wordlist/3mtw6wbql5z2p';

/** Byte range of `substring` within `text`, as a facet indexes it. */
const rangeOf = (text, substring) => {
  const at = text.indexOf(substring);
  return {
    byteStart: encoder.encode(text.slice(0, at)).length,
    byteEnd: encoder.encode(text.slice(0, at + substring.length)).length,
  };
};

const linkFacet = (text, substring, uri = substring) => ({
  $type: 'app.bsky.richtext.facet',
  features: [{ $type: 'app.bsky.richtext.facet#link', uri }],
  index: rangeOf(text, substring),
});

const mentionFacet = (text, substring) => ({
  $type: 'app.bsky.richtext.facet',
  features: [{ $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:abc' }],
  index: rangeOf(text, substring),
});

/** What a facet covers after a splice — the only thing that must never drift. */
const covered = (text, facet) =>
  decoder.decode(
    encoder.encode(text).subarray(facet.index.byteStart, facet.index.byteEnd),
  );

describe('toShortUrl', () => {
  it('drops the scheme and clips a long path to 13 characters plus an ellipsis', () => {
    expect(toShortUrl(LONG_URL)).toBe('example.org/profile/test...');
    expect(toShortUrl(LONG_URL)).toHaveLength(27);
  });

  it('keeps a short path whole, still without the scheme', () => {
    expect(toShortUrl('https://example.org/branding')).toBe(
      'example.org/branding',
    );
    expect(toShortUrl('https://example.org/')).toBe('example.org');
    expect(toShortUrl('https://example.org')).toBe('example.org');
  });

  it('counts the query and fragment as part of the path', () => {
    expect(toShortUrl('https://example.com/a?ref=sample&utm=x')).toBe(
      'example.com/a?ref=sample...',
    );
    // A bare `/` pathname drops out entirely, so the fragment follows the host.
    expect(toShortUrl('https://example.com/#a-very-long-fragment')).toBe(
      'example.com#a-very-long-...',
    );
  });

  it('leaves alone what it cannot parse or should not touch', () => {
    // No scheme: `new URL` throws, and Bluesky leaves the text as written.
    expect(
      toShortUrl('example.org/profile/testing.dame.is/very/long/path'),
    ).toBe('example.org/profile/testing.dame.is/very/long/path');
    expect(
      toShortUrl('at://did:plc:abc/app.bsky.feed.post/3mtw6wbql5z2p'),
    ).toBe('at://did:plc:abc/app.bsky.feed.post/3mtw6wbql5z2p');
    expect(toShortUrl('')).toBe('');
  });
});

describe('countPostGraphemes', () => {
  it('charges a long link its shortened form, not its full address', () => {
    const text =
      'Bluesky lets you create and share lists of accounts that can then be used to ' +
      'mute/unmute people more easily and at scale... what if you could do the same ' +
      'with muted words?\n\nIntroducing ~Muted Word Lists~\n\n' +
      LONG_URL;

    expect(LONG_URL).toHaveLength(84);
    expect(toShortUrl(LONG_URL)).toHaveLength(27);
    expect(text.length - countPostGraphemes(text)).toBe(84 - 27);
  });

  it('lets a draft publish that a raw count would have refused', () => {
    // Over the cap by raw length, inside it once the link is shortened.
    const text = `${'a'.repeat(228)}\n\n${LONG_URL}`;

    expect(text.length).toBeGreaterThan(300);
    expect(countPostGraphemes(text)).toBe(257);
  });

  it('counts grapheme clusters, not UTF-16 units', () => {
    // One grapheme to a reader and to the lexicon, two to `.length`.
    expect('🦋'.length).toBe(2);
    expect(countPostGraphemes('🦋')).toBe(1);
    expect(countPostGraphemes('👨‍👩‍👧‍👦')).toBe(1);
  });

  it('charges a bare domain in full, as Bluesky does', () => {
    const bare =
      'example.org/profile/testing.dame.is/net.example.graph.wordlist/3mtw6wbql5z2p';
    expect(countPostGraphemes(bare)).toBe(bare.length);
  });

  it('leaves a quoted domain at full length — it gets no facet, so it is not a link', () => {
    const text =
      'the domain "https://example.org/profile/testing/and/more" is taken';
    expect(countPostGraphemes(text)).toBe(text.length);
  });

  it('is unchanged for text with no links at all', () => {
    expect(countPostGraphemes('a note at a lamp on a porch at night')).toBe(36);
    expect(countPostGraphemes('')).toBe(0);
  });

  it('shortens every link in the post, not just the first', () => {
    const text = `see ${LONG_URL} and https://example.com/another/quite/long/path too`;
    expect(shortenPostText(text)).toBe(
      'see example.org/profile/test... and example.com/another/quit... too',
    );
  });
});

describe('shortenLinkFacets', () => {
  it('rewrites the link text and keeps the full address in the facet', () => {
    const text = `Introducing ~Muted Word Lists~\n\n${LONG_URL}`;
    const result = shortenLinkFacets(text, [linkFacet(text, LONG_URL)]);

    expect(result.text).toBe(
      'Introducing ~Muted Word Lists~\n\nexample.org/profile/test...',
    );
    expect(result.facets[0].features[0].uri).toBe(LONG_URL);
    expect(covered(result.text, result.facets[0])).toBe(
      'example.org/profile/test...',
    );
  });

  it('measures the same as the counter did', () => {
    const text = `see ${LONG_URL} now`;
    const result = shortenLinkFacets(text, [linkFacet(text, LONG_URL)]);
    expect(result.text).toHaveLength(countPostGraphemes(text));
  });

  it('moves the facets that follow a shortened link, across multibyte text', () => {
    const text = `🦋 hey @dame.is see ${LONG_URL} and https://example.com/another/quite/long/path #birding`;
    const facets = [
      mentionFacet(text, '@dame.is'),
      linkFacet(text, LONG_URL),
      linkFacet(text, 'https://example.com/another/quite/long/path'),
      {
        $type: 'app.bsky.richtext.facet',
        features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'birding' }],
        index: rangeOf(text, '#birding'),
      },
    ];

    const result = shortenLinkFacets(text, facets);

    expect(result.facets.map((f) => covered(result.text, f))).toEqual([
      '@dame.is',
      'example.org/profile/test...',
      'example.com/another/quit...',
      '#birding',
    ]);
  });

  it('does not mutate the facets it was handed', () => {
    const text = `see ${LONG_URL}`;
    const facets = [linkFacet(text, LONG_URL)];
    const before = JSON.parse(JSON.stringify(facets));

    shortenLinkFacets(text, facets);

    expect(facets).toEqual(before);
  });

  it('passes through what it has no business rewriting', () => {
    const plain = 'a note at a lamp';
    expect(shortenLinkFacets(plain, [])).toEqual({ text: plain, facets: [] });
    expect(shortenLinkFacets(plain, null)).toEqual({ text: plain, facets: [] });
    expect(shortenLinkFacets('', [])).toEqual({ text: '', facets: [] });

    // A bare-domain link facet: shortening it would undercount against Bluesky.
    const bare = 'go to example.org/profile/testing.dame.is/and/more';
    const bareFacets = [
      linkFacet(bare, 'example.org/profile/testing.dame.is/and/more'),
    ];
    expect(shortenLinkFacets(bare, bareFacets).text).toBe(bare);
  });

  it('returns the post untouched rather than splicing overlapping facets', () => {
    // Corrupting a post is worse than counting it long.
    const text = `see ${LONG_URL}`;
    const range = rangeOf(text, LONG_URL);
    const overlapping = [
      linkFacet(text, LONG_URL),
      {
        $type: 'app.bsky.richtext.facet',
        features: [{ $type: 'app.bsky.richtext.facet#link', uri: LONG_URL }],
        index: { byteStart: range.byteStart + 4, byteEnd: range.byteEnd },
      },
    ];

    expect(shortenLinkFacets(text, overlapping)).toEqual({
      text,
      facets: overlapping,
    });
  });

  it('returns the post untouched when a facet index is out of range or malformed', () => {
    const text = `see ${LONG_URL}`;
    const past = [
      { ...linkFacet(text, LONG_URL), index: { byteStart: 4, byteEnd: 9999 } },
    ];
    expect(shortenLinkFacets(text, past).text).toBe(text);

    const missing = [{ ...linkFacet(text, LONG_URL), index: { byteStart: 4 } }];
    expect(shortenLinkFacets(text, missing).text).toBe(text);
  });
});

describe('expandLinkFacets', () => {
  it('puts the real address back so an edit does not save the stub as the link', () => {
    const written = `Introducing ~Muted Word Lists~\n\n${LONG_URL}`;
    const stored = shortenLinkFacets(written, [linkFacet(written, LONG_URL)]);

    const reopened = expandLinkFacets(stored.text, stored.facets);

    expect(reopened.text).toBe(written);
    expect(covered(reopened.text, reopened.facets[0])).toBe(LONG_URL);
  });

  it('round-trips a post with several links and multibyte text', () => {
    const other = 'https://example.com/another/quite/long/path';
    const written = `🦋 see ${LONG_URL} and ${other} #birding`;
    const facets = [
      linkFacet(written, LONG_URL),
      linkFacet(written, other),
      {
        $type: 'app.bsky.richtext.facet',
        features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'birding' }],
        index: rangeOf(written, '#birding'),
      },
    ];

    const stored = shortenLinkFacets(written, facets);
    const reopened = expandLinkFacets(stored.text, stored.facets);

    expect(reopened.text).toBe(written);
    expect(reopened.facets.map((f) => covered(reopened.text, f))).toEqual([
      LONG_URL,
      other,
      '#birding',
    ]);
  });

  it('leaves link text a writer chose alone', () => {
    // Not what shortening this uri would produce, so it was written by hand.
    const text = 'read the field notes';
    const facets = [
      linkFacet(
        text,
        'field notes',
        'https://example.org/notes/very/long/path',
      ),
    ];

    expect(expandLinkFacets(text, facets)).toEqual({ text, facets });
  });

  it('is a no-op on text that was never shortened', () => {
    const text = `see ${LONG_URL}`;
    const facets = [linkFacet(text, LONG_URL)];

    expect(expandLinkFacets(text, facets).text).toBe(text);
    expect(expandLinkFacets('a note at a lamp', []).text).toBe(
      'a note at a lamp',
    );
    expect(expandLinkFacets('', null)).toEqual({ text: '', facets: [] });
  });
});
