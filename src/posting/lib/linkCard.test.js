import { describe, it, expect, vi } from 'vitest';
import {
  fetchCardThumbnail,
  fetchLinkCard,
  normalizeAssociatedRefs,
  uploadCardThumb,
  MAX_ASSOCIATED_REFS,
} from './linkCard.js';

const json = (body, status = 200) => ({
  ok: status < 300,
  status,
  json: async () => body,
});
const imageResponse = (size = 10, type = 'image/png') => ({
  ok: true,
  status: 200,
  blob: async () => new Blob([new Uint8Array(size)], { type }),
});
const compress = vi.fn(
  async (file) => new Blob([new Uint8Array(Math.min(file.size, 50))]),
);
const decode = async () => ({ width: 1200, height: 630 });
const blobOut = {
  $type: 'blob',
  ref: { $link: 'bafkreithumb' },
  mimeType: 'image/jpeg',
  size: 10,
};
const target = (
  uploadBlob = vi.fn(async () => ({ data: { blob: blobOut } })),
) => ({
  did: 'did:plc:me',
  agent: { com: { atproto: { repo: { uploadBlob } } } },
});

describe('fetchLinkCard', () => {
  it('reads the card from cardyb, keeping the writer’s URL', async () => {
    const fetch = vi.fn(async () =>
      json({
        title: 'A page',
        description: 'About it',
        image: 'https://cardyb.bsky.app/v1/image?url=x',
        url: 'https://example.com/final',
        associated_refs: [
          { uri: 'at://did:plc:a/site.standard.document/1', cid: 'bafy1' },
        ],
      }),
    );
    const card = await fetchLinkCard('https://example.com/a', { fetch });
    expect(fetch.mock.calls[0][0]).toBe(
      'https://cardyb.bsky.app/v1/extract?url=https%3A%2F%2Fexample.com%2Fa',
    );
    expect(card).toEqual({
      url: 'https://example.com/a',
      title: 'A page',
      description: 'About it',
      thumb: 'https://cardyb.bsky.app/v1/image?url=x',
      associatedRefs: [
        {
          $type: 'com.atproto.repo.strongRef',
          uri: 'at://did:plc:a/site.standard.document/1',
          cid: 'bafy1',
        },
      ],
    });
  });

  it('clamps title and description to what the editor allows', async () => {
    const card = await fetchLinkCard('https://example.com', {
      fetch: async () =>
        json({ title: 't'.repeat(300), description: 'd'.repeat(900) }),
    });
    expect(card.title).toHaveLength(200);
    expect(card.description).toHaveLength(500);
    expect(card.thumb).toBeNull();
  });

  it('is null for an error, a failed request or a non-web address', async () => {
    expect(
      await fetchLinkCard('https://e.com', {
        fetch: async () => json({ error: 'nope' }),
      }),
    ).toBeNull();
    expect(
      await fetchLinkCard('https://e.com', {
        fetch: async () => json({}, 500),
      }),
    ).toBeNull();
    expect(
      await fetchLinkCard('https://e.com', {
        fetch: async () => {
          throw new TypeError('Failed to fetch');
        },
      }),
    ).toBeNull();
    const fetch = vi.fn();
    expect(await fetchLinkCard('javascript:alert(1)', { fetch })).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('drops an image address that isn’t http(s)', async () => {
    const card = await fetchLinkCard('https://e.com', {
      fetch: async () => json({ title: 'x', image: 'javascript:alert(1)' }),
    });
    expect(card.thumb).toBeNull();
  });
});

describe('normalizeAssociatedRefs', () => {
  it('keeps at:// refs with a CID, deduped and capped', () => {
    const raw = [
      { uri: 'at://a/c/1', cid: 'x' },
      { uri: 'at://a/c/1', cid: 'y' },
      { uri: 'https://nope', cid: 'z' },
      { uri: 'at://a/c/2' },
      ...Array.from({ length: 6 }, (_, i) => ({
        uri: `at://b/c/${i}`,
        cid: 'c',
      })),
    ];
    const refs = normalizeAssociatedRefs(raw);
    expect(refs).toHaveLength(MAX_ASSOCIATED_REFS);
    expect(refs[0]).toEqual({
      $type: 'com.atproto.repo.strongRef',
      uri: 'at://a/c/1',
      cid: 'x',
    });
    expect(normalizeAssociatedRefs([])).toBeNull();
    expect(normalizeAssociatedRefs('x')).toBeNull();
  });
});

describe('fetchCardThumbnail', () => {
  it('fetches the image and shrinks it under the thumbnail limit', async () => {
    const localCompress = vi.fn(async () => new Blob([new Uint8Array(5)]));
    const file = await fetchCardThumbnail('https://img.example/x.png', {
      fetch: async () => imageResponse(),
      compress: localCompress,
      decode,
    });
    expect(localCompress.mock.calls[0][1]).toMatchObject({
      maxWidthOrHeight: 1920,
      preserveExif: false,
    });
    expect(file.type).toBe('image/jpeg');
  });
});

describe('uploadCardThumb', () => {
  it('reuses a thumbnail already uploaded as this account', async () => {
    const t = target();
    const card = {
      thumb: 'https://x',
      thumbBlob: blobOut,
      thumbBlobDid: 'did:plc:me',
    };
    expect(await uploadCardThumb(t, card)).toBe(blobOut);
    expect(t.agent.com.atproto.repo.uploadBlob).not.toHaveBeenCalled();
  });

  it('uploads again when the blob belongs to another account', async () => {
    const t = target();
    const fetch = vi.fn(async () => imageResponse());
    const card = {
      thumb: 'https://img.example/x',
      thumbBlob: blobOut,
      thumbBlobDid: 'did:plc:other',
    };
    expect(await uploadCardThumb(t, card, { fetch, compress, decode })).toEqual(
      blobOut,
    );
    expect(fetch).toHaveBeenCalledWith(
      'https://img.example/x',
      expect.anything(),
    );
  });

  it('shrinks the writer’s own image instead of uploading it raw', async () => {
    const t = target();
    const localCompress = vi.fn(async () => new Blob([new Uint8Array(5)]));
    const thumbFile = new File([new Uint8Array(3 * 1024 * 1024)], 'mine.png', {
      type: 'image/png',
    });
    await uploadCardThumb(
      t,
      { thumb: null, thumbFile },
      { compress: localCompress, decode },
    );
    expect(localCompress.mock.calls[0][1]).toMatchObject({ maxSizeMB: 0.95 });
    expect(t.agent.com.atproto.repo.uploadBlob.mock.calls[0][1].encoding).toBe(
      'image/jpeg',
    );
  });

  it('is null with no image, or when fetching or uploading fails', async () => {
    expect(await uploadCardThumb(target(), { thumb: null })).toBeNull();
    expect(await uploadCardThumb(target(), null)).toBeNull();
    expect(
      await uploadCardThumb(
        target(),
        { thumb: 'https://x' },
        { fetch: async () => ({ ok: false, status: 404 }) },
      ),
    ).toBeNull();
    const failing = target(
      vi.fn(async () => {
        throw new Error('upload failed');
      }),
    );
    expect(
      await uploadCardThumb(
        failing,
        { thumb: 'https://x' },
        { fetch: async () => imageResponse(), compress, decode },
      ),
    ).toBeNull();
  });
});
