import { describe, it, expect } from 'vitest';
import {
  buildExternalEmbed,
  buildImageRecord,
  buildImagesEmbed,
  buildPostEmbed,
  buildRecordEmbed,
  buildVideoEmbed,
  combineRecordWithMedia,
  normalizeImageEmbed,
} from './embeds.js';

const blob = (cid) => ({
  $type: 'blob',
  ref: { $link: cid },
  mimeType: 'image/jpeg',
  size: 1,
});
const QUOTE = {
  kind: 'post',
  uri: 'at://did:plc:q/app.bsky.feed.post/3q',
  cid: 'bafyq',
};

describe('buildRecordEmbed and combineRecordWithMedia', () => {
  it('builds the record embed with uri before cid', () => {
    const embed = buildRecordEmbed({ uri: 'at://x', cid: 'c', extra: 1 });
    expect(embed).toEqual({
      $type: 'app.bsky.embed.record',
      record: { uri: 'at://x', cid: 'c' },
    });
    expect(Object.keys(embed.record)).toEqual(['uri', 'cid']);
  });

  it('wraps media with the record first, or returns the bare record', () => {
    const rec = buildRecordEmbed({ uri: 'at://x', cid: 'c' });
    const media = { $type: 'app.bsky.embed.images', images: [] };
    const combined = combineRecordWithMedia(rec, media);
    expect(Object.keys(combined)).toEqual(['$type', 'record', 'media']);
    expect(combined.$type).toBe('app.bsky.embed.recordWithMedia');
    expect(combineRecordWithMedia(rec, null)).toBe(rec);
  });
});

describe('buildVideoEmbed and buildImageRecord', () => {
  it('include alt (empty when missing) and a known aspect ratio, last', () => {
    expect(
      buildVideoEmbed({
        blob: 'b',
        alt: 'a',
        aspectRatio: { width: 16, height: 9 },
      }),
    ).toEqual({
      $type: 'app.bsky.embed.video',
      video: 'b',
      alt: 'a',
      aspectRatio: { width: 16, height: 9 },
    });
    expect(buildVideoEmbed({ blob: 'b' })).toEqual({
      $type: 'app.bsky.embed.video',
      video: 'b',
      alt: '',
    });
    const rec = buildImageRecord({
      alt: 'x',
      blob: 'b',
      aspectRatio: { width: 4, height: 3 },
    });
    expect(Object.keys(rec)).toEqual(['alt', 'image', 'aspectRatio']);
  });

  it('leave a missing or zero aspect ratio out rather than guessing one', () => {
    expect(
      buildImageRecord({ blob: 'b', aspectRatio: { width: 0, height: 3 } }),
    ).toEqual({ alt: '', image: 'b' });
    expect(buildImageRecord({ blob: 'b' })).toEqual({ alt: '', image: 'b' });
    expect(
      buildVideoEmbed({ blob: 'b', aspectRatio: { width: 5 } }),
    ).not.toHaveProperty('aspectRatio');
  });
});

describe('buildExternalEmbed', () => {
  it('builds a card with an optional thumbnail and the page’s refs', () => {
    expect(
      buildExternalEmbed(
        {
          url: 'https://e.com',
          title: 'T',
          description: 'D',
          associatedRefs: [
            { uri: 'at://a/site.standard.document/1', cid: 'c' },
          ],
        },
        blob('thumb'),
      ),
    ).toEqual({
      $type: 'app.bsky.embed.external',
      external: {
        uri: 'https://e.com',
        title: 'T',
        description: 'D',
        thumb: blob('thumb'),
        associatedRefs: [
          {
            $type: 'com.atproto.repo.strongRef',
            uri: 'at://a/site.standard.document/1',
            cid: 'c',
          },
        ],
      },
    });
    expect(buildExternalEmbed({ url: 'https://e.com' })).toEqual({
      $type: 'app.bsky.embed.external',
      external: { uri: 'https://e.com', title: '', description: '' },
    });
  });
});

describe('buildPostEmbed', () => {
  const images = [
    { id: 'a', alt: 'one', aspectRatio: { width: 2, height: 1 } },
    { id: 'b', alt: '' },
  ];
  const card = {
    url: 'https://e.com',
    title: 'T',
    description: '',
    thumb: null,
  };

  it('is undefined for a post with nothing attached', () => {
    expect(
      buildPostEmbed({
        text: 'hi',
        images: [],
        video: null,
        record: null,
        card: null,
      }),
    ).toBeUndefined();
  });

  it('builds images in order from their blobs', () => {
    const embed = buildPostEmbed(
      { images },
      { images: [blob('1'), blob('2')] },
    );
    expect(embed).toEqual(
      buildImagesEmbed([
        { alt: 'one', image: blob('1'), aspectRatio: { width: 2, height: 1 } },
        { alt: '', image: blob('2') },
      ]),
    );
  });

  it('prefers video, then images, then a card', () => {
    const post = { images, video: { alt: 'v' }, card };
    expect(
      buildPostEmbed(post, { video: blob('v'), images: [blob('1'), blob('2')] })
        .$type,
    ).toBe('app.bsky.embed.video');
    expect(buildPostEmbed(post, { images: [blob('1'), blob('2')] }).$type).toBe(
      'app.bsky.embed.images',
    );
    expect(buildPostEmbed({ card }, {}).$type).toBe('app.bsky.embed.external');
  });

  it('pairs a record with media through recordWithMedia', () => {
    const embed = buildPostEmbed(
      { record: QUOTE, card },
      { cardThumb: blob('t') },
    );
    expect(embed).toEqual({
      $type: 'app.bsky.embed.recordWithMedia',
      record: {
        $type: 'app.bsky.embed.record',
        record: { uri: QUOTE.uri, cid: QUOTE.cid },
      },
      media: {
        $type: 'app.bsky.embed.external',
        external: {
          uri: 'https://e.com',
          title: 'T',
          description: '',
          thumb: blob('t'),
        },
      },
    });
    expect(buildPostEmbed({ record: QUOTE }, {})).toEqual(
      buildRecordEmbed(QUOTE),
    );
  });

  it('embeds feeds, lists and starter packs the same way', () => {
    for (const kind of ['feed', 'list', 'starterpack']) {
      const record = { kind, uri: `at://did:plc:x/${kind}/1`, cid: 'bafyk' };
      expect(buildPostEmbed({ record }, {})).toEqual(buildRecordEmbed(record));
    }
  });

  it('leaves out a record with no CID rather than writing a broken ref', () => {
    expect(
      buildPostEmbed({ record: { kind: 'post', uri: 'at://x' } }, {}),
    ).toBeUndefined();
  });
});

describe('normalizeImageEmbed', () => {
  it('folds a gallery into the images shape, raw and viewed, inside recordWithMedia too', () => {
    const raw = {
      $type: 'app.bsky.embed.gallery',
      items: [{ image: 'b', alt: 'a', aspectRatio: { width: 1, height: 1 } }],
    };
    expect(normalizeImageEmbed(raw)).toMatchObject({
      $type: 'app.bsky.embed.images',
      images: [{ image: 'b', alt: 'a', aspectRatio: { width: 1, height: 1 } }],
    });
    const view = {
      $type: 'app.bsky.embed.gallery#view',
      items: [{ thumbnail: 't', fullsize: 'f' }],
    };
    expect(normalizeImageEmbed(view)).toMatchObject({
      $type: 'app.bsky.embed.images#view',
      images: [{ thumb: 't', fullsize: 'f', alt: '' }],
    });
    const rwm = {
      $type: 'app.bsky.embed.recordWithMedia#view',
      record: {},
      media: view,
    };
    expect(normalizeImageEmbed(rwm).media.$type).toBe(
      'app.bsky.embed.images#view',
    );
  });

  it('passes everything else through', () => {
    const external = { $type: 'app.bsky.embed.external', external: {} };
    expect(normalizeImageEmbed(external)).toBe(external);
    expect(normalizeImageEmbed(null)).toBeNull();
  });
});
