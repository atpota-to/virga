import { describe, it, expect, vi } from 'vitest';
import {
  CARD_THUMB_BUDGET,
  ImageProcessingError,
  prepareImage,
  uploadImage,
} from './images.js';

const MB = 1024 * 1024;
const imageFile = (size, name = 'photo.png', type = 'image/png') =>
  new File([new Uint8Array(size)], name, { type });

describe('prepareImage', () => {
  it('only re-encodes a small image, keeping its size and quality', async () => {
    const compress = vi.fn(
      async () => new Blob([new Uint8Array(500)], { type: 'image/jpeg' }),
    );
    const decode = vi.fn(async () => ({ width: 1200, height: 800 }));
    const out = await prepareImage(imageFile(1000), { compress, decode });

    const options = compress.mock.calls[0][1];
    expect(options).toMatchObject({
      fileType: 'image/jpeg',
      preserveExif: false,
      initialQuality: 1,
      alwaysKeepResolution: true,
      maxWidthOrHeight: 4000,
    });
    expect(out.file.name).toBe('photo.jpg');
    expect(out.file.type).toBe('image/jpeg');
    expect(out).toMatchObject({
      mime: 'image/jpeg',
      size: 500,
      aspectRatio: { width: 1200, height: 800 },
    });
  });

  it('shrinks a large image to the budget', async () => {
    const compress = vi.fn(async () => new Blob([new Uint8Array(100)]));
    await prepareImage(imageFile(3 * MB), {
      compress,
      decode: async () => null,
    });
    expect(compress.mock.calls[0][1]).toMatchObject({
      maxSizeMB: 1.9,
      initialQuality: 0.8,
      alwaysKeepResolution: false,
    });
  });

  it('uses the card budget when asked', async () => {
    const compress = vi.fn(async () => new Blob([new Uint8Array(100)]));
    await prepareImage(imageFile(2 * MB), {
      compress,
      decode: async () => null,
      budget: CARD_THUMB_BUDGET,
    });
    expect(compress.mock.calls[0][1]).toMatchObject({
      maxSizeMB: 0.95,
      maxWidthOrHeight: 1920,
    });
  });

  it('leaves the aspect ratio out when the image can’t be decoded', async () => {
    const out = await prepareImage(imageFile(10), {
      compress: async () => new Blob([new Uint8Array(5)]),
      decode: async () => null,
    });
    expect(out).not.toHaveProperty('aspectRatio');
  });

  it('refuses rather than passing the original through when re-encoding fails', async () => {
    const original = imageFile(10);
    await expect(
      prepareImage(original, {
        compress: async () => {
          throw new Error('decoder blew up');
        },
      }),
    ).rejects.toBeInstanceOf(ImageProcessingError);
  });

  it('refuses when re-encoding hangs', async () => {
    vi.useFakeTimers();
    try {
      const pending = prepareImage(imageFile(10), {
        compress: () => new Promise(() => {}),
        timeoutMs: 100,
      });
      const check = expect(pending).rejects.toMatchObject({
        code: 'IMAGE_PROCESSING_FAILED',
      });
      await vi.advanceTimersByTimeAsync(100);
      await check;
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses an image still over budget, and files that aren’t images', async () => {
    await expect(
      prepareImage(imageFile(10), {
        compress: async () => new Blob([new Uint8Array(2 * MB)]),
      }),
    ).rejects.toMatchObject({ code: 'IMAGE_TOO_LARGE' });
    await expect(
      prepareImage(imageFile(10, 'a.txt', 'text/plain')),
    ).rejects.toMatchObject({
      code: 'NOT_AN_IMAGE',
    });
  });
});

describe('uploadImage', () => {
  it('uploads as the target with the image’s type', async () => {
    const uploadBlob = vi.fn(async () => ({
      data: {
        blob: {
          $type: 'blob',
          ref: { $link: 'bafkreia' },
          mimeType: 'image/jpeg',
          size: 4,
        },
      },
    }));
    const target = {
      did: 'did:plc:me',
      agent: { com: { atproto: { repo: { uploadBlob } } } },
    };
    const blob = await uploadImage(target, {
      file: new Blob([new Uint8Array(4)]),
      mime: 'image/jpeg',
    });
    expect(blob.ref.$link).toBe('bafkreia');
    expect(uploadBlob.mock.calls[0][1].encoding).toBe('image/jpeg');
  });
});
