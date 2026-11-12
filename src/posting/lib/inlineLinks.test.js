/*
 * Inline links: `[label](url)` in the composer is written as the label with a
 * link facet over it. What the record carries, what the counter measures and
 * what a reopened post puts back in the composer must all agree.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const resolveHandleToDid = vi.fn();
const resolveMention = (handle) => resolveHandleToDid(handle);
import {
  applyInlineLinks,
  collapseInlineLinks,
  composerCountText,
  composerTextFromRecord,
  countComposerGraphemes,
  detectComposerFacets,
  findInlineLinks,
  isSingleAddress,
  labelMisleads,
  linkDestination,
} from './inlineLinks.js';
import { shortenLinkFacets } from './linkShortening.js';
import { detectAndCreateFacetsOptimized } from './facets.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** The text each facet covers, with what it points at. */
const covered = (text, facets) => {
  const bytes = encoder.encode(text);
  return facets.map((f) => {
    const feature = f.features[0];
    return [
      decoder.decode(bytes.subarray(f.index.byteStart, f.index.byteEnd)),
      feature.uri || feature.did || feature.tag,
    ];
  });
};

beforeEach(() => {
  resolveHandleToDid.mockReset();
});

describe('linkDestination', () => {
  it('takes http(s) addresses and bare domains', () => {
    expect(linkDestination('https://example.org/about')).toBe(
      'https://example.org/about',
    );
    expect(linkDestination('http://example.com')).toBe('http://example.com');
    expect(linkDestination('example.org/faq')).toBe('https://example.org/faq');
    expect(linkDestination('example.com:8080/x')).toBe(
      'https://example.com:8080/x',
    );
  });

  it('refuses anything that is not a web address on a real domain', () => {
    for (const destination of [
      '',
      'b',
      'notes.txt',
      'v1.2.3',
      '/relative',
      '//example.com',
      'mailto:a@b.com',
      'javascript:alert(1)',
      'at://did:plc:x/app.bsky.feed.post/1',
      'ftp://example.com',
      'https://localhost:3000',
      '192.168.0.1',
    ]) {
      expect(linkDestination(destination), destination).toBeNull();
    }
  });
});

describe('labelMisleads', () => {
  it('lets plain words through', () => {
    expect(labelMisleads('my essay', 'https://example.com/essay')).toBe(false);
    expect(labelMisleads('e.g. this', 'https://example.com')).toBe(false);
  });

  it('lets an address through when it names the same site', () => {
    expect(labelMisleads('example.org', 'https://example.org/about')).toBe(
      false,
    );
    expect(labelMisleads('www.example.org', 'https://example.org')).toBe(false);
    expect(
      labelMisleads('https://example.org/faq', 'https://example.org/about'),
    ).toBe(false);
    expect(labelMisleads('Example.org, the site', 'https://example.org')).toBe(
      false,
    );
  });

  it('refuses an address, or a handle, that names another site', () => {
    expect(labelMisleads('bsky.app', 'https://elsewhere.example')).toBe(true);
    expect(
      labelMisleads('https://bsky.app/profile/x', 'https://elsewhere.example'),
    ).toBe(true);
    expect(
      labelMisleads('bsky.app is great', 'https://elsewhere.example'),
    ).toBe(true);
    expect(labelMisleads('@dame.is', 'https://elsewhere.example')).toBe(true);
    expect(labelMisleads('example.com', 'https://blog.example.com')).toBe(true);
  });

  it('looks at every word, and past possessives, brackets and odd endings', () => {
    expect(
      labelMisleads('read it on bsky.app', 'https://elsewhere.example'),
    ).toBe(true);
    expect(labelMisleads("bsky.app's feed", 'https://elsewhere.example')).toBe(
      true,
    );
    expect(labelMisleads('(bsky.app)', 'https://elsewhere.example')).toBe(true);
    expect(
      labelMisleads('https://bsky.app...', 'https://elsewhere.example'),
    ).toBe(true);
    expect(labelMisleads('bsky.app or example.org', 'https://bsky.app')).toBe(
      true,
    );
    expect(
      labelMisleads("bsky.app's own feed", 'https://bsky.app/profile/x'),
    ).toBe(false);
  });

  it('compares internationalized domains in one form', () => {
    expect(labelMisleads('bücher.de', 'https://xn--bcher-kva.de')).toBe(false);
    expect(labelMisleads('bücher.de', 'https://bucher.de')).toBe(true);
  });
});

describe('isSingleAddress', () => {
  it('is true only for one word that reads as an address', () => {
    expect(isSingleAddress('https://old.example/x')).toBe(true);
    expect(isSingleAddress(' example.org ')).toBe(true);
    expect(isSingleAddress('my essay')).toBe(false);
    expect(isSingleAddress('on example.org')).toBe(false);
  });
});

describe('findInlineLinks', () => {
  it('finds each link with its label and address', () => {
    const text =
      'read [my essay](https://example.com/essay) and [the faq](example.org/faq).';
    expect(
      findInlineLinks(text).map(({ label, uri, misleading }) => ({
        label,
        uri,
        misleading,
      })),
    ).toEqual([
      {
        label: 'my essay',
        uri: 'https://example.com/essay',
        misleading: false,
      },
      { label: 'the faq', uri: 'https://example.org/faq', misleading: false },
    ]);
  });

  it('keeps balanced parentheses in the address', () => {
    const [link] = findInlineLinks(
      '[notes](https://en.wikipedia.org/wiki/Bee_(disambiguation)) here',
    );
    expect(link.uri).toBe('https://en.wikipedia.org/wiki/Bee_(disambiguation)');
  });

  it('leaves prose that only looks like the syntax alone', () => {
    for (const text of [
      '[a](b)',
      '[](https://example.com)',
      '[ ](https://example.com)',
      '[a] (https://example.com)',
      '[a](https://example.com',
      '[a\nb](https://example.com)',
      '[a](https://exa mple.com)',
      'arr[0](x)',
    ]) {
      expect(findInlineLinks(text), text).toEqual([]);
    }
  });

  it('starts again inside a stray bracket', () => {
    const [link] = findInlineLinks('[[label](https://example.com)');
    expect(link.label).toBe('label');
    expect(link.start).toBe(1);
  });

  it('marks a misleading label instead of dropping it', () => {
    const [link] = findInlineLinks('[bsky.app](https://elsewhere.example)');
    expect(link.misleading).toBe(true);
  });
});

describe('collapseInlineLinks', () => {
  it('replaces each link with its label and says where the labels landed', () => {
    const { text, links } = collapseInlineLinks(
      'a [b](https://b.com) c [dd](https://d.com) e',
    );
    expect(text).toBe('a b c dd e');
    expect(links.map((l) => text.slice(l.charStart, l.charEnd))).toEqual([
      'b',
      'dd',
    ]);
  });

  it('leaves a misleading link as typed', () => {
    const raw = 'see [bsky.app](https://elsewhere.example)';
    expect(collapseInlineLinks(raw)).toEqual({ text: raw, links: [] });
  });
});

describe('detectComposerFacets (what is written)', () => {
  it('writes the label with a link facet over it', async () => {
    const result = await detectComposerFacets(
      'read [my essay](https://example.com/essay) tonight',
      { resolveMention },
    );
    expect(result.text).toBe('read my essay tonight');
    expect(covered(result.text, result.facets)).toEqual([
      ['my essay', 'https://example.com/essay'],
    ]);
  });

  it('indexes facets in UTF-8 bytes', async () => {
    const result = await detectComposerFacets(
      '🦋 [ünïcödé](https://example.com) #notes',
      { resolveMention },
    );
    expect(result.text).toBe('🦋 ünïcödé #notes');
    expect(covered(result.text, result.facets)).toEqual([
      ['ünïcödé', 'https://example.com'],
      ['#notes', 'notes'],
    ]);
  });

  it('keeps ordinary links, mentions and tags around inline links', async () => {
    resolveHandleToDid.mockResolvedValue('did:plc:luna');
    const result = await detectComposerFacets(
      '@luna.test see [this](https://a.com/x) and https://b.com/y #tag',
      { resolveMention },
    );
    expect(covered(result.text, result.facets)).toEqual([
      ['@luna.test', 'did:plc:luna'],
      ['this', 'https://a.com/x'],
      ['https://b.com/y', 'https://b.com/y'],
      ['#tag', 'tag'],
    ]);
  });

  it('lets the link win over anything detected inside its label', async () => {
    const result = await detectComposerFacets(
      'see [example.org by @example.org #notes](https://example.org) now',
      { resolveMention },
    );
    expect(covered(result.text, result.facets)).toEqual([
      ['example.org by @example.org #notes', 'https://example.org'],
    ]);
    expect(resolveHandleToDid).toHaveBeenCalled();
  });

  it('never offers a link card or a quote from an inline link', async () => {
    const card = await detectComposerFacets(
      '[example.org](https://example.org/about) ',
      { skipMentionResolution: true },
    );
    expect(card.externalLinks).toEqual([]);
    const quote = await detectComposerFacets(
      '[this post](https://bsky.app/profile/a.test/post/3abc) ',
      { skipMentionResolution: true },
    );
    expect(quote.postEmbeds).toEqual([]);
    expect(quote.text).toBe('this post ');
  });

  it('posts a misleading link literally, with its real address linked', async () => {
    const result = await detectComposerFacets(
      '[bsky.app](https://elsewhere.example) ok',
      { resolveMention },
    );
    expect(result.text).toBe('[bsky.app](https://elsewhere.example) ok');
    expect(
      covered(result.text, result.facets).some(([text]) => text === 'bsky.app'),
    ).toBe(false);
  });

  it('matches plain detection when there are no inline links', async () => {
    const text =
      'hello example.org and https://example.com/long/path/to/a/page #notes';
    const plain = await detectAndCreateFacetsOptimized(text, true);
    const composer = await detectComposerFacets(text, {
      skipMentionResolution: true,
    });
    expect(composer.text).toBe(text);
    expect(composer.facets).toEqual(plain.facets);
    expect(composer.externalLinks).toEqual(plain.externalLinks);
  });
});

describe('applyInlineLinks (the live composer)', () => {
  it('clears the whole markdown span in the raw text and links the label', async () => {
    const raw = 'go [here](https://bsky.app/profile/a.test/post/3abc) ';
    const detected = await detectAndCreateFacetsOptimized(raw, true);
    expect(detected.postEmbeds.length).toBeGreaterThan(0);
    const live = applyInlineLinks(raw, findInlineLinks(raw), detected);
    expect(live.postEmbeds).toEqual([]);
    expect(covered(raw, live.facets)).toEqual([
      ['here', 'https://bsky.app/profile/a.test/post/3abc'],
    ]);
  });
});

describe('counting', () => {
  it('counts the label, not the address', () => {
    const raw =
      'read [my essay](https://example.com/a/very/long/path/that/costs/nothing/now)';
    expect(composerCountText(raw)).toBe('read my essay');
    expect(countComposerGraphemes(raw)).toBe(13);
  });

  it('matches what is written, links shortened', async () => {
    const raw =
      'a [https://example.org/profile/x/y/z/w](https://example.org/profile/x/y/z/w) b ' +
      '[see https://example.com/long/path/here inside](https://example.com) c https://example.com/another/long/path d';
    const result = await detectComposerFacets(raw, { resolveMention });
    const written = shortenLinkFacets(result.text, result.facets);
    expect(composerCountText(raw)).toBe(written.text);
  });

  it('counts a misleading link as the literal text it posts as', async () => {
    const raw = '[bsky.app](https://elsewhere.example/a/long/path/here) ok';
    const result = await detectComposerFacets(raw, { resolveMention });
    expect(composerCountText(raw)).toBe(
      shortenLinkFacets(result.text, result.facets).text,
    );
  });
});

describe('composerTextFromRecord (reopening a post)', () => {
  const facet = (text, substring, uri) => {
    const at = text.indexOf(substring);
    return {
      $type: 'app.bsky.richtext.facet',
      features: [{ $type: 'app.bsky.richtext.facet#link', uri }],
      index: {
        byteStart: encoder.encode(text.slice(0, at)).length,
        byteEnd: encoder.encode(text.slice(0, at + substring.length)).length,
      },
    };
  };

  it('puts the markdown back around a custom label', () => {
    const text = 'read my essay tonight';
    expect(
      composerTextFromRecord(text, [
        facet(text, 'my essay', 'https://example.com/essay'),
      ]),
    ).toBe('read [my essay](https://example.com/essay) tonight');
  });

  it('leaves links written as their own address alone, expanding shortened ones', () => {
    const text = 'see example.org and example.com/long/path/he...';
    const facets = [
      facet(text, 'example.org', 'https://example.org'),
      facet(
        text,
        'example.com/long/path/he...',
        'https://example.com/long/path/here/and/more',
      ),
    ];
    expect(composerTextFromRecord(text, facets)).toBe(
      'see https://example.org and https://example.com/long/path/here/and/more',
    );
  });

  it('round-trips through what is written', async () => {
    const raw =
      '🦋 [my essay](https://example.com/essay), [notes](https://en.wikipedia.org/wiki/Bee_(disambiguation)) and https://example.com/a/long/path/to/somewhere';
    const result = await detectComposerFacets(raw, { resolveMention });
    const written = shortenLinkFacets(result.text, result.facets);
    expect(composerTextFromRecord(written.text, written.facets)).toBe(raw);
  });

  it('escapes unbalanced parentheses so the address reads back whole', () => {
    const text = 'odd link';
    const reopened = composerTextFromRecord(text, [
      facet(text, 'odd', 'https://example.com/a)b'),
    ]);
    expect(reopened).toBe('[odd](https://example.com/a%29b) link');
    expect(findInlineLinks(reopened)[0].uri).toBe('https://example.com/a%29b');
  });

  it('leaves a label it cannot write as markdown as plain text', () => {
    const text = 'a [b] c';
    expect(
      composerTextFromRecord(text, [facet(text, '[b]', 'https://example.com')]),
    ).toBe(text);
  });

  it('keeps mentions and tags as text for detection to find again', () => {
    const text = '@luna.test #notes';
    const facets = [
      {
        features: [
          { $type: 'app.bsky.richtext.facet#mention', did: 'did:plc:luna' },
        ],
        index: { byteStart: 0, byteEnd: 10 },
      },
      {
        features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'notes' }],
        index: { byteStart: 11, byteEnd: 17 },
      },
    ];
    expect(composerTextFromRecord(text, facets)).toBe(text);
  });
});
