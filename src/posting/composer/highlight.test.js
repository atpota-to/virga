import { describe, expect, it } from 'vitest';
import { facetRanges, highlightSegments } from './highlight.js';
import { detectFacets } from '../lib/facets.js';
import { applyInlineLinks, findInlineLinks } from '../lib/inlineLinks.js';

async function live(text) {
  const links = findInlineLinks(text).filter((l) => !l.misleading);
  const result = await detectFacets(text, { skipMentionResolution: true });
  return { facets: applyInlineLinks(text, links, result).facets, links };
}

describe('highlightSegments', () => {
  it('covers the text exactly, end to end', async () => {
    const text = 'hi @wren.example.com see https://example.org #moths ok';
    const { facets, links } = await live(text);
    const segs = highlightSegments(text, facets, links);
    expect(segs.map((s) => s.text).join('')).toBe(text);
    expect(
      segs.filter((s) => s.kind !== 'plain').map((s) => [s.kind, s.text]),
    ).toEqual([
      ['mention', '@wren.example.com'],
      ['link', 'https://example.org'],
      ['tag', '#moths'],
    ]);
  });

  it('marks an inline link’s brackets and address as syntax and its label as a link', async () => {
    const text = 'read [the guide](https://example.org/g) now';
    const { facets, links } = await live(text);
    const segs = highlightSegments(text, facets, links);
    expect(segs.map((s) => s.text).join('')).toBe(text);
    expect(
      segs.filter((s) => s.kind !== 'plain').map((s) => [s.kind, s.text]),
    ).toEqual([
      ['syntax', '['],
      ['link', 'the guide'],
      ['syntax', '](https://example.org/g)'],
    ]);
  });

  it('counts offsets in characters past emoji and accents', async () => {
    const text = '🌧️ café #rain';
    const { facets } = await live(text);
    const segs = highlightSegments(text, facets, []);
    expect(segs.find((s) => s.kind === 'tag').text).toBe('#rain');
    expect(segs.map((s) => s.text).join('')).toBe(text);
  });

  it('is one plain run for plain text, and nothing for nothing', () => {
    expect(highlightSegments('just words', [])).toEqual([
      { text: 'just words', kind: 'plain' },
    ]);
    expect(highlightSegments('', [])).toEqual([]);
  });

  it('skips facets that fall outside the text', () => {
    const facets = [
      {
        index: { byteStart: 50, byteEnd: 60 },
        features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'x' }],
      },
    ];
    expect(facetRanges('short', facets)).toEqual([]);
  });
});
