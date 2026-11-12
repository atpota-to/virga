import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { detectAndCreateFacetsOptimized, detectFacets } from './facets.js';

// The composer runs detection twice: on a debounce while typing
// (skipMentionResolution: true, for highlighting), and on submit (false) to
// build the facets written to the post record. Facets are byte ranges other
// clients render from the bytes alone, so offsets are asserted exactly.
//
// The validation cache is a module-level Map (five-minute TTL, no reset), so
// every test uses handles that appear nowhere else in the file; it must hold
// under --sequence.shuffle.

const resolveHandleToDid = vi.fn();

const MENTION = 'app.bsky.richtext.facet#mention';
const LINK = 'app.bsky.richtext.facet#link';
const TAG = 'app.bsky.richtext.facet#tag';

// A facet flattened to its feature and index. The envelope it hides is pinned
// once, in 'facet ordering and byte offsets'.
const shape = (facets) =>
  facets.map((f) => ({
    ...f.features[0],
    ...f.index,
  }));

const mention = (did, byteStart, byteEnd) => ({
  $type: MENTION,
  did,
  byteStart,
  byteEnd,
});
const link = (uri, byteStart, byteEnd) => ({
  $type: LINK,
  uri,
  byteStart,
  byteEnd,
});
const tag = (t, byteStart, byteEnd) => ({
  $type: TAG,
  tag: t,
  byteStart,
  byteEnd,
});

const preview = (text, validated = new Set(), invalidated = new Set()) =>
  detectAndCreateFacetsOptimized(text, true, validated, invalidated);

// Real UTF-8, deliberately not createByteMap, so offsets are checked against
// an independent encoding.
const encoder = new TextEncoder();
const decoder = new TextDecoder();
/** The substring a facet's byte offsets actually name. */
const bytesAt = (text, byteStart, byteEnd) =>
  decoder.decode(encoder.encode(text).slice(byteStart, byteEnd));

const submit = (text) =>
  detectAndCreateFacetsOptimized(text, false, undefined, undefined, {
    resolveMention: resolveHandleToDid,
  });

let fetchSpy;

beforeEach(() => {
  resolveHandleToDid.mockReset();
  // resolveHandleToDid is stubbed; any other network call fails the test.
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((...args) => {
    throw new Error(`unexpected network call: ${String(args[0])}`);
  });
});

afterEach(() => {
  // Restored here so a mid-test failure can't leave a frozen clock behind.
  vi.useRealTimers();
  fetchSpy.mockRestore();
});

describe('the early-exit guard', () => {
  it('keeps a hashtag facet whatever letters the rest of the post uses', async () => {
    // A hashtag-only post must reach the full pass, or it publishes without the
    // tag facet and never reaches that hashtag's feed.
    expect(shape((await preview('#owl')).facets)).toEqual([tag('owl', 0, 4)]);
    expect(shape((await preview('#owls')).facets)).toEqual([tag('owls', 0, 5)]);

    // 'wow ' is 4 bytes, so each tag sits at 4..9.
    expect(shape((await preview('wow #cool')).facets)).toEqual([
      tag('cool', 4, 9),
    ]);
    expect(shape((await preview('wow #cats')).facets)).toEqual([
      tag('cats', 4, 9),
    ]);

    // '#cool' 0..5, then ' and ' (5 bytes) puts '#cats' at 10..15.
    expect(shape((await preview('#cool and #cats')).facets)).toEqual([
      tag('cool', 0, 5),
      tag('cats', 10, 15),
    ]);

    // The guard's second half, `\b\w+\.\w{2,}\b`, passes a bare domain.
    // 'a.co ' is 5 bytes → '#owl' at 5..9.
    expect(shape((await preview('a.co #owl')).facets)).toEqual([
      link('https://a.co', 0, 4),
      tag('owl', 5, 9),
    ]);

    expect(shape((await preview('@zizyphia.test')).facets)).toEqual([
      mention('placeholder:zizyphia.test', 0, 14),
    ]);
  });

  it('skips the full pass for prose that merely contains the letters of "https"', async () => {
    // The full pass measures UTF-8 bytes; the early exit never encodes.
    const encode = vi.spyOn(TextEncoder.prototype, 'encode');
    try {
      expect(
        shape((await preview('this path is just thoughts')).facets),
      ).toEqual([]);
      expect(encode).not.toHaveBeenCalled();

      // The spy does see the full pass.
      await preview('#note');
      expect(encode).toHaveBeenCalled();
    } finally {
      encode.mockRestore();
    }
  });

  it('returns an empty, non-throwing result for prose with nothing to detect', async () => {
    for (const text of ['a calm walk', '', '   ', 'no news']) {
      const result = await preview(text);
      expect(result, JSON.stringify(text)).toEqual({
        facets: [],
        postEmbeds: [],
        externalLinks: [],
        displayText: text,
        markdownLinks: [],
      });
    }

    // displayText is echoed verbatim (the composer assigns it straight to
    // state); non-strings reach the early return since .test() stringifies.
    expect(await preview(null)).toMatchObject({
      facets: [],
      displayText: null,
    });
    expect(await preview(undefined)).toMatchObject({
      facets: [],
      displayText: undefined,
    });

    // This path runs on every debounced keystroke: no network.
    expect(resolveHandleToDid).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('@mentions while typing (skipMentionResolution: true)', () => {
  it('marks an unvetted handle with a placeholder DID instead of resolving it', async () => {
    // 'hi ' is 3 bytes; '@zenaida.test' is 13 → 3..16. The placeholder prefix
    // keeps this facet out of a published record.
    const result = await preview('hi @zenaida.test ok');
    expect(shape(result.facets)).toEqual([
      mention('placeholder:zenaida.test', 3, 16),
    ]);
    expect(resolveHandleToDid).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('stamps a caller-validated handle with a "validated:" pseudo-DID', async () => {
    // The editor passes handles it has confirmed; what comes back is the literal
    // 'validated:<handle>', not a DID (see extractTextAndFacetsFromDOM below).
    const result = await preview(
      'hi @dryocampa.test ok',
      new Set(['dryocampa.test']),
    );
    // '@dryocampa.test' is 15 bytes at offset 3 → 3..18.
    expect(shape(result.facets)).toEqual([
      mention('validated:dryocampa.test', 3, 18),
    ]);
    expect(resolveHandleToDid).not.toHaveBeenCalled();
  });

  it('emits no facet at all once a handle is known bad, whatever else it is also in', async () => {
    expect(
      shape(
        (
          await preview(
            '@citheronia.test',
            new Set(),
            new Set(['citheronia.test']),
          )
        ).facets,
      ),
    ).toEqual([]);

    // In both sets (a handle renamed away mid-session): invalidated wins.
    expect(
      shape(
        (
          await preview(
            '@eacles.test',
            new Set(['eacles.test']),
            new Set(['eacles.test']),
          )
        ).facets,
      ),
    ).toEqual([]);

    expect(
      (await preview('@eacles.test', new Set(), new Set(['eacles.test'])))
        .displayText,
    ).toBe('@eacles.test');
  });

  it("does not lay a second link facet over the handle's own domain", async () => {
    // Every handle is a domain; coveredRanges stops the URL regex from adding
    // an overlapping link facet over it.
    const result = await preview('@automeris.bsky.social hi');
    expect(shape(result.facets)).toEqual([
      mention('placeholder:automeris.bsky.social', 0, 22),
    ]);
    expect(result.externalLinks).toEqual([]);

    // A possessive stops at the apostrophe: '@hemileuca.test' is 15 bytes.
    expect(shape((await preview("@hemileuca.test's note")).facets)).toEqual([
      mention('placeholder:hemileuca.test', 0, 15),
    ]);

    // The curly U+2019 (what iOS and macOS type) is listed separately from
    // U+0027. '@paratrea.test' is 14.
    expect(shape((await preview('@paratrea.test’s note')).facets)).toEqual([
      mention('placeholder:paratrea.test', 0, 14),
    ]);
  });

  it('creates nothing at all for a mention that is exactly quoted', async () => {
    // A quoted handle is named, not tagged: isExactlyQuoted suppresses the
    // mention, and the range still goes into coveredRanges so the URL regex
    // doesn't claim it as a link.
    const quoted = await preview('see "@darapsa.test" ok');
    expect(shape(quoted.facets)).toEqual([]);
    expect(quoted.externalLinks).toEqual([]);

    // Quotes around more than the handle don't count: 'see "' is 5 bytes,
    // '@amphion.test' 13 → 5..18.
    expect(shape((await preview('see "@amphion.test hi" ok')).facets)).toEqual([
      mention('placeholder:amphion.test', 5, 18),
    ]);
  });
});

describe('@mentions on submit (skipMentionResolution: false)', () => {
  it('writes the real DID into the facet and calls resolveHandle with the bare handle', async () => {
    resolveHandleToDid.mockResolvedValue('did:plc:hyalophora');
    const result = await submit('@hyalophora.test and @callosamia.test');

    // '@hyalophora.test' is 16 bytes at 0 → 0..16; ' and ' is 5 → the second
    // starts at 21 and is also 16 bytes → 21..37.
    expect(shape(result.facets)).toEqual([
      mention('did:plc:hyalophora', 0, 16),
      mention('did:plc:hyalophora', 21, 37),
    ]);
    // The bare handle, not the '@' form — resolveHandle would 400 on the '@'.
    expect(resolveHandleToDid.mock.calls).toEqual([
      ['hyalophora.test'],
      ['callosamia.test'],
    ]);
  });

  it('resolves each distinct handle once per submit, and again on the next submit', async () => {
    resolveHandleToDid.mockResolvedValue('did:plc:paonias');

    const twice = await submit('@paonias.test and @paonias.test again');
    // '@paonias.test' is 13 bytes at 0 → 0..13; ' and ' is 5 → 18..31.
    expect(shape(twice.facets)).toEqual([
      mention('did:plc:paonias', 0, 13),
      mention('did:plc:paonias', 18, 31),
    ]);
    expect(resolveHandleToDid.mock.calls).toEqual([['paonias.test']]);

    // A submit always asks: what is written must be current, and the
    // resolver keeps its own short cache.
    resolveHandleToDid.mockClear();
    await submit('@paonias.test');
    expect(resolveHandleToDid.mock.calls).toEqual([['paonias.test']]);
  });

  it('resolves different handles in parallel, not one after another', async () => {
    const pending = [];
    resolveHandleToDid.mockImplementation(
      (handle) =>
        new Promise((resolve) =>
          pending.push(() => resolve(`did:plc:${handle.split('.')[0]}`)),
        ),
    );
    const result = submit('@arctiaone.test @arctiatwo.test');
    await new Promise((r) => setTimeout(r, 0));
    expect(pending).toHaveLength(2);
    pending.forEach((go) => go());
    expect(shape((await result).facets).map((f) => f.did)).toEqual([
      'did:plc:arctiaone',
      'did:plc:arctiatwo',
    ]);
  });

  it('drops the mention rather than the post when resolution fails', async () => {
    // A handle that does not resolve.
    resolveHandleToDid.mockResolvedValue(null);
    expect(shape((await submit('hi @antheraea.test')).facets)).toEqual([]);

    // A lookup that throws must not reject: the caller awaits this inside the
    // publish flow.
    resolveHandleToDid.mockRejectedValue(new Error('XRPCError: 502'));
    const thrown = await submit('hi @actias.test and #luna');
    // 'hi @actias.test and ' is 20 bytes → '#luna' still at 20..25.
    expect(shape(thrown.facets)).toEqual([tag('luna', 20, 25)]);
  });

  it('reuses a resolution in preview, but still previews a handle it knows is fake', async () => {
    // A successful submit caches the DID, so the next preview shows it, ahead
    // of the caller's 'validated:<handle>'.
    resolveHandleToDid.mockResolvedValue('did:plc:samia');
    await submit('@samia.test');
    expect(
      shape((await preview('@samia.test', new Set(['samia.test']))).facets),
    ).toEqual([mention('did:plc:samia', 0, 11)]);

    // A handle the last submit found doesn't resolve isn't underlined.
    resolveHandleToDid.mockResolvedValue(null);
    await submit('@rothschildia.test');
    expect(shape((await preview('@rothschildia.test')).facets)).toEqual([]);

    // The caller's own invalidated Set suppresses it too.
    expect(
      shape(
        (
          await preview(
            '@rothschildia.test',
            new Set(),
            new Set(['rothschildia.test']),
          )
        ).facets,
      ),
    ).toEqual([]);
  });
});

describe('where a handle ends', () => {
  // A handle runs to the first character a handle can't contain (ASCII
  // letters, digits, '-' and '.'), less trailing dots. The placeholder DID
  // names the handle the submit path would look up.
  it.each([
    ['an emoji', 'hi @sphingicampa.test\u{1F98B}'],
    ['a ZWJ emoji sequence', 'hi @sphingicampa.test\u{1F469}\u200D\u{1F52C}'],
    ['an ellipsis character', 'hi @sphingicampa.test\u2026'],
    ['three full stops', 'hi @sphingicampa.test...'],
    ['a full stop', 'thanks @sphingicampa.test.'],
    ['a comma', 'hi @sphingicampa.test, ok'],
    ['a closing paren', 'notes (@sphingicampa.test) ok'],
    ['a CJK character', 'hi @sphingicampa.test\u65E5\u672C'],
    ['a curly closing quote', '\u201Chi @sphingicampa.test\u201D'],
    ['an emoji on both sides', '\u{1F98B}@sphingicampa.test\u{1F98B}'],
    ['a CJK character on both sides', '\u65E5@sphingicampa.test\u672C'],
  ])('ends the handle at %s', async (_kind, text) => {
    const byteStart = encoder.encode(text.slice(0, text.indexOf('@'))).length;
    const result = await preview(text);
    // '@sphingicampa.test' is 18 ASCII bytes.
    expect(shape(result.facets)).toEqual([
      mention('placeholder:sphingicampa.test', byteStart, byteStart + 18),
    ]);
    expect(bytesAt(text, byteStart, byteStart + 18)).toBe('@sphingicampa.test');
  });

  it('publishes the whole handle at UTF-8 offsets with an emoji pressed on either side', async () => {
    resolveHandleToDid.mockResolvedValue('did:plc:adelocephala');
    const text = '\u{1F98B}@adelocephala.test\u{1F98B}';
    const result = await submit(text);

    expect(resolveHandleToDid.mock.calls).toEqual([['adelocephala.test']]);
    // The butterfly is 4 bytes; '@adelocephala.test' is 18 → 4..22.
    expect(shape(result.facets)).toEqual([
      mention('did:plc:adelocephala', 4, 22),
    ]);
    expect(bytesAt(text, 4, 22)).toBe('@adelocephala.test');
  });

  it('reads an @ straight after a letter or digit as an email address, not a mention', async () => {
    resolveHandleToDid.mockResolvedValue('did:plc:citioica');
    for (const text of ['a@b.com', 'write to note9@citioica.test today']) {
      const published = await submit(text);
      expect(shape(published.facets), text).toEqual([]);
      // The domain half is not linked either.
      expect(published.externalLinks, text).toEqual([]);
      expect(shape((await preview(text)).facets), text).toEqual([]);
    }
    expect(resolveHandleToDid).not.toHaveBeenCalled();
  });

  it('links a URL with an @handle path segment rather than publishing a mention inside it', async () => {
    resolveHandleToDid.mockResolvedValue('did:plc:eupackardia');
    const url = 'https://example.com/@eupackardia.test/repo';
    const text = `see ${url} now`;
    const result = await submit(text);
    // 'see ' is 4 bytes; the URL is 42 ASCII characters.
    expect(shape(result.facets)).toEqual([link(url, 4, 4 + url.length)]);
    expect(bytesAt(text, 4, 4 + url.length)).toBe(url);
    expect(resolveHandleToDid).not.toHaveBeenCalled();
  });

  it('leaves an @ before anything that is not a whole handle as plain text', async () => {
    resolveHandleToDid.mockResolvedValue('did:plc:saturniid');
    // One segment, a TLD starting with a digit, an empty segment, a segment
    // ending in a hyphen.
    for (const text of [
      '@saturniid hi',
      'see @saturniid.2b',
      '@saturniid..test',
      '@saturniid.test- ok',
    ]) {
      expect(shape((await preview(text)).facets), text).toEqual([]);
      expect(shape((await submit(text)).facets), text).toEqual([]);
    }
    expect(resolveHandleToDid).not.toHaveBeenCalled();
  });
});

describe('the validation cache TTL', () => {
  it('serves a cached DID for the full five minutes and not one millisecond longer', async () => {
    // `Date.now() - cached.timestamp < VALIDATION_CACHE_TTL` (300000): fresh at
    // 299999 ms, stale at exactly 300000.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-01T00:00:00.000Z'));

    resolveHandleToDid.mockResolvedValue('did:plc:smerinthus');
    await submit('@smerinthus.test');

    // '@smerinthus.test' is 16 bytes at offset 0.
    expect(shape((await preview('@smerinthus.test')).facets)).toEqual([
      mention('did:plc:smerinthus', 0, 16),
    ]);

    // 299999 ms after the write: still the cached DID.
    vi.setSystemTime(new Date('2026-03-01T00:04:59.999Z'));
    expect(shape((await preview('@smerinthus.test')).facets)).toEqual([
      mention('did:plc:smerinthus', 0, 16),
    ]);

    // 300000 ms: ignored, so with no validated Set it falls back to a placeholder.
    vi.setSystemTime(new Date('2026-03-01T00:05:00.000Z'));
    expect(shape((await preview('@smerinthus.test')).facets)).toEqual([
      mention('placeholder:smerinthus.test', 0, 16),
    ]);

    // Expiry doesn't trigger a lookup; the preview path never resolves.
    expect(resolveHandleToDid.mock.calls).toEqual([['smerinthus.test']]);
  });

  it("lets a cached failure outrank the caller's validated set until the TTL lapses", async () => {
    // A fresh { did: null } outranks validatedHandles: the handle isn't
    // underlined until the entry expires.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T00:00:00.000Z'));

    resolveHandleToDid.mockResolvedValue(null);
    await submit('@sphinx.test');

    // '@sphinx.test' is 12 bytes at offset 0. Caller says validated; cache says
    // no such handle; the cache wins.
    expect(
      shape((await preview('@sphinx.test', new Set(['sphinx.test']))).facets),
    ).toEqual([]);

    vi.setSystemTime(new Date('2026-04-01T00:05:00.000Z'));
    expect(
      shape((await preview('@sphinx.test', new Set(['sphinx.test']))).facets),
    ).toEqual([mention('validated:sphinx.test', 0, 12)]);

    // invalidatedHandles still beats both, expired entry or not.
    expect(
      shape(
        (
          await preview(
            '@sphinx.test',
            new Set(['sphinx.test']),
            new Set(['sphinx.test']),
          )
        ).facets,
      ),
    ).toEqual([]);
  });
});

describe('links', () => {
  it('facets a URL immediately but only offers an embed card once it is finished', async () => {
    // The facet is drawn as soon as the URL parses; the embed card (a network
    // fetch) waits until the URL is followed by whitespace or end of text.
    const complete = await preview('see https://example.com/a ok');
    // 'see ' is 4 bytes, the URL is 21 → 4..25.
    expect(shape(complete.facets)).toEqual([
      link('https://example.com/a', 4, 25),
    ]);
    expect(complete.externalLinks).toEqual([
      {
        url: 'https://example.com/a',
        charStart: 4,
        charEnd: 25,
        byteStart: 4,
        byteEnd: 25,
      },
    ]);

    // End of text and a newline both count as finished.
    expect((await preview('see https://example.com/a')).externalLinks).toEqual([
      {
        url: 'https://example.com/a',
        charStart: 4,
        charEnd: 25,
        byteStart: 4,
        byteEnd: 25,
      },
    ]);
    expect(
      (await preview('see https://example.com/a\nok')).externalLinks,
    ).toEqual([
      {
        url: 'https://example.com/a',
        charStart: 4,
        charEnd: 25,
        byteStart: 4,
        byteEnd: 25,
      },
    ]);

    // A trailing comma doesn't: the embed is withheld but the facet is drawn.
    const typing = await preview('see https://example.com/a, ok');
    expect(shape(typing.facets)).toEqual([
      link('https://example.com/a', 4, 25),
    ]);
    expect(typing.externalLinks).toEqual([]);

    // A bare domain's range covers the visible text (3..14) while the uri
    // gains the protocol.
    const bare = await preview('go example.com now');
    expect(shape(bare.facets)).toEqual([link('https://example.com', 3, 14)]);
  });

  it('turns a post or feed link into an embed at once, and leaves other links as cards', async () => {
    // A pasted post link becomes a quote embed at once, bypassing isUrlComplete.
    const post = await preview('x https://bsky.app/profile/a.test/post/3k,y');
    // 39 bytes at offset 2 → 2..41; ',y' makes isUrlComplete false.
    expect(post.postEmbeds).toEqual([
      {
        type: 'bluesky',
        linkType: 'post',
        handle: 'a.test',
        postId: '3k',
        url: 'https://bsky.app/profile/a.test/post/3k',
        charStart: 2,
        charEnd: 41,
        byteStart: 2,
        byteEnd: 41,
      },
    ]);
    // A quote embed and a link facet, but no external link card (that would
    // render the post twice).
    expect(shape(post.facets)).toEqual([
      link('https://bsky.app/profile/a.test/post/3k', 2, 41),
    ]);
    expect(post.externalLinks).toEqual([]);

    // Feeds take the same path.
    const feed = await preview(
      'x https://bsky.app/profile/a.test/feed/whats-hot',
    );
    expect(feed.postEmbeds).toHaveLength(1);
    expect(feed.postEmbeds[0]).toMatchObject({
      linkType: 'feed',
      feedId: 'whats-hot',
    });
    expect(feed.externalLinks).toEqual([]);

    // A profile link is not a post: an ordinary link card, no embed. 31 bytes at
    // offset 2 → 2..33.
    const profile = await preview('x https://bsky.app/profile/a.test');
    expect(profile.postEmbeds).toEqual([]);
    expect(profile.externalLinks).toEqual([
      {
        url: 'https://bsky.app/profile/a.test',
        charStart: 2,
        charEnd: 33,
        byteStart: 2,
        byteEnd: 33,
      },
    ]);
    expect(shape(profile.facets)).toEqual([
      link('https://bsky.app/profile/a.test', 2, 33),
    ]);
  });

  it('embeds list and starter pack links too, rather than leaving them as cards', async () => {
    // 41 bytes at offset 2 → 2..43.
    const list = await preview('x https://bsky.app/profile/a.test/lists/xyz');
    expect(list.postEmbeds).toEqual([
      {
        type: 'bluesky',
        linkType: 'list',
        handle: 'a.test',
        listId: 'xyz',
        url: 'https://bsky.app/profile/a.test/lists/xyz',
        charStart: 2,
        charEnd: 43,
        byteStart: 2,
        byteEnd: 43,
      },
    ]);
    expect(list.externalLinks).toEqual([]);

    const pack = await preview('x https://bsky.app/starter-pack/a.test/3p,y');
    expect(pack.postEmbeds).toHaveLength(1);
    expect(pack.postEmbeds[0]).toMatchObject({
      linkType: 'starterpack',
      packId: '3p',
    });
    expect(pack.externalLinks).toEqual([]);
  });

  it('refuses the things that only look like domains', async () => {
    // Each matches the URL regex and is rejected afterwards.
    for (const text of [
      'v1.2.3 released', // version number
      'open notes.txt now', // file extension
      'ping 192.168.0.1 twice', // IP address
    ]) {
      const result = await preview(text);
      expect(shape(result.facets), text).toEqual([]);
      expect(result.externalLinks, text).toEqual([]);
    }

    // A quoted domain stays text.
    const quoted = await preview('go "example.com" now');
    expect(shape(quoted.facets)).toEqual([]);
    expect(quoted.externalLinks).toEqual([]);
  });

  it('draws the line for a domain label at 63 characters', async () => {
    // isValidDomain rejects labels over 63 (the DNS limit); the URL regex
    // matches any length, so this check alone rejects the long one.
    const at63 = 'a'.repeat(63);
    const at64 = 'a'.repeat(64);

    // 'go ' is 3 bytes and the domain is 63 + '.com' = 67 → 3..70.
    expect(shape((await preview(`go ${at63}.com now`)).facets)).toEqual([
      link(`https://${at63}.com`, 3, 70),
    ]);
    expect(shape((await preview(`go ${at64}.com now`)).facets)).toEqual([]);

    // Measured on the label before the TLD, not the whole host:
    // 'sub.example.co.uk' is 17 bytes at 3 → 3..20.
    expect(shape((await preview('go sub.example.co.uk now')).facets)).toEqual([
      link('https://sub.example.co.uk', 3, 20),
    ]);
  });
});

describe('straight and curly quotes', () => {
  // U+201C/U+201D are the smart quotes an Apple keyboard produces.
  it.each([
    ['straight', '"', '"', 'agapema.test'],
    ['curly', '\u201C', '\u201D', 'syssphinx.test'],
  ])(
    'reads %s quotes around handles and links the same way',
    async (_kind, open, close, handle) => {
      // A quoted mention, domain or URL stays text.
      expect(
        shape((await preview(`${open}@${handle}${close}`)).facets),
      ).toEqual([]);
      expect(
        shape((await preview(`go ${open}example.com${close} now`)).facets),
      ).toEqual([]);
      expect(
        shape(
          (await preview(`go ${open}https://example.com/x${close} now`)).facets,
        ),
      ).toEqual([]);

      // Inside a longer quotation the closing quote ends the handle and the link,
      // so neither is cut short nor runs on into the quote.
      const text = `${open}hi @${handle} see https://example.com/x${close}`;
      const facets = shape((await preview(text)).facets);
      expect(facets.map((f) => bytesAt(text, f.byteStart, f.byteEnd))).toEqual([
        `@${handle}`,
        'https://example.com/x',
      ]);
      expect(facets[0].did).toBe(`placeholder:${handle}`);
      expect(facets[1].uri).toBe('https://example.com/x');
    },
  );
});

describe('facet ordering and byte offsets', () => {
  it('sorts by byte start and measures in UTF-8 bytes, not UTF-16 units', async () => {
    // Three separate passes, sorted at the end; out-of-order ranges corrupt
    // the render in other clients.
    const mixed = await preview('#one @two.test https://three.com');
    // '#one' 0..4, then a space → '@two.test' (9 bytes) 5..14, then a space →
    // the 17-byte URL 15..32. Detection order is mention, link, tag; this is not.
    expect(shape(mixed.facets)).toEqual([
      tag('one', 0, 4),
      mention('placeholder:two.test', 5, 14),
      link('https://three.com', 15, 32),
    ]);

    // The envelope shape() flattens away, pinned once here.
    expect(mixed.facets[0]).toEqual({
      $type: 'app.bsky.richtext.facet',
      features: [{ $type: TAG, tag: 'one' }],
      index: { byteStart: 0, byteEnd: 4 },
    });

    // 'café' is 4 UTF-16 units but 5 UTF-8 bytes, so '#note' is at bytes 6..11.
    expect(shape((await preview('café #note')).facets)).toEqual([
      tag('note', 6, 11),
    ]);
    // Same sentence, a mention: '@quill.test' is 11 bytes → 6..17.
    expect(shape((await preview('café @quill.test')).facets)).toEqual([
      mention('placeholder:quill.test', 6, 17),
    ]);

    // A surrogate pair is one code point, two UTF-16 units, four UTF-8 bytes.
    // '#note' begins at char index 3 and byte 5.
    expect(shape((await preview('\u{1F98B} #note')).facets)).toEqual([
      tag('note', 5, 10),
    ]);
    expect(shape((await preview('\u{1F98B} @pyxi.test')).facets)).toEqual([
      mention('placeholder:pyxi.test', 5, 15),
    ]);
  });

  it('lands every offset on a character boundary after a ZWJ or modifier sequence', async () => {
    // Graphemes built from several surrogate pairs (one with a U+200D joiner).
    // The submit path uses the same offsets.
    const graphemes = {
      butterfly: '\u{1F98B}', // one code point, 4 bytes
      'ZWJ sequence': '\u{1F469}\u200D\u{1F52C}', // 4 + 3 + 4 = 11 bytes
      'skin-tone modifier': '\u{1F44D}\u{1F3FD}', // 4 + 4 = 8 bytes
      'flag tag sequence':
        '\u{1F3F4}\u{E0067}\u{E0062}\u{E0073}\u{E0063}\u{E0074}\u{E007F}', // 7 pairs, 28 bytes
    };

    for (const [name, grapheme] of Object.entries(graphemes)) {
      const width = encoder.encode(grapheme).length;
      const text = `${grapheme} #note @automeris.test https://example.com`;
      const { facets } = await preview(text);

      // Offsets counted from TextEncoder, not from the module under test.
      expect(shape(facets), name).toEqual([
        tag('note', width + 1, width + 6),
        mention('placeholder:automeris.test', width + 7, width + 22),
        link('https://example.com', width + 23, width + 42),
      ]);

      // Each range slices the real bytes back to exactly what was typed.
      expect(
        facets.map((f) => bytesAt(text, f.index.byteStart, f.index.byteEnd)),
        name,
      ).toEqual(['#note', '@automeris.test', 'https://example.com']);
    }

    expect(resolveHandleToDid).not.toHaveBeenCalled();
  });

  it('does not mistake a URL fragment or a mid-word hash for a hashtag', async () => {
    // The hashtag regex requires start-of-text or whitespace before '#'.
    const frag = await preview('read https://example.com/page#section now');
    expect(shape(frag.facets)).toEqual([
      link('https://example.com/page#section', 5, 37),
    ]);

    // Same rule mid-word: 'a#tag' is one word, not a tag.
    expect(shape((await preview('a#tag')).facets)).toEqual([]);

    // A newline counts, and the range starts at '#', not at the matched
    // newline: 'post\n' is 5 bytes → '#owls' at 5..10.
    expect(shape((await preview('post\n#owls')).facets)).toEqual([
      tag('owls', 5, 10),
    ]);
  });
});

describe("hashtags by Bluesky's rule", () => {
  it('tags Unicode words whole, and leaves numbers alone', async () => {
    // 'café' is 5 bytes, so '#café' is 0..6.
    expect(shape((await preview('#café #123 #1st')).facets)).toEqual([
      tag('café', 0, 6),
      tag('1st', 12, 16),
    ]);
  });

  it('never lays a tag over a link', async () => {
    expect(shape((await preview('#example.com')).facets)).toEqual([
      link('https://example.com', 1, 12),
    ]);
  });
});

describe('detectFacets', () => {
  it('takes the same choices as an options object', async () => {
    const resolveMention = vi.fn(async () => 'did:plc:opts');
    const result = await detectFacets('@optionsone.test #x', {
      resolveMention,
    });
    expect(shape(result.facets)).toEqual([
      mention('did:plc:opts', 0, 16),
      tag('x', 17, 19),
    ]);
    expect(resolveMention).toHaveBeenCalledWith('optionsone.test');
  });

  it('drops a mention whose resolver throws', async () => {
    const resolveMention = vi.fn(async () => {
      throw new Error('offline');
    });
    const result = await detectFacets('hi @optionstwo.test', {
      resolveMention,
    });
    expect(result.facets).toEqual([]);
  });
});
