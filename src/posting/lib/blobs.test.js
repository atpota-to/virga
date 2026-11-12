import { describe, it, expect, vi } from 'vitest';
import { jsonToLex } from '@atproto/api';
import { blobCid, isBlob, uploadBlob } from './blobs.js';

const CID = 'bafkreihlfz7eeyynraq3zqhozs4q3l3wabewbjevjb5jgophbtcjj7eijm';
const json = {
  $type: 'blob',
  ref: { $link: CID },
  mimeType: 'image/jpeg',
  size: 3,
};

const targetWith = (uploadBlobFn) => ({
  did: 'did:plc:me',
  agent: { com: { atproto: { repo: { uploadBlob: uploadBlobFn } } } },
});

describe('blobCid and isBlob', () => {
  it('read the JSON form, a BlobRef and the legacy form', () => {
    expect(blobCid(json)).toBe(CID);
    expect(blobCid(jsonToLex(json))).toBe(CID);
    expect(blobCid({ cid: CID, mimeType: 'image/png' })).toBe(CID);
    expect(isBlob(json)).toBe(true);
    expect(isBlob({ ref: {} })).toBe(false);
    expect(blobCid(null)).toBeNull();
  });
});

describe('uploadBlob', () => {
  it('sends bytes with the media type and returns the JSON blob', async () => {
    const upload = vi.fn(async () => ({ data: { blob: jsonToLex(json) } }));
    const blob = await uploadBlob(
      targetWith(upload),
      new Uint8Array([1, 2, 3]),
      {
        encoding: 'image/jpeg',
      },
    );
    expect(blob).toEqual(json);
    expect(upload.mock.calls[0][0]).toBeInstanceOf(Uint8Array);
    expect(upload.mock.calls[0][1]).toEqual({ encoding: 'image/jpeg' });
  });

  it('reads a Blob’s bytes and type', async () => {
    const upload = vi.fn(async () => ({ data: { blob: json } }));
    await uploadBlob(
      targetWith(upload),
      new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
    );
    expect(upload.mock.calls[0][1].encoding).toBe('image/png');
    expect([...upload.mock.calls[0][0]]).toEqual([1, 2, 3]);
  });

  it('refuses to send without a real media type', async () => {
    const upload = vi.fn();
    await expect(
      uploadBlob(targetWith(upload), new Uint8Array([1]), {}),
    ).rejects.toThrow(/media type/);
    await expect(
      uploadBlob(targetWith(upload), new Uint8Array([1]), {
        encoding: 'application/octet-stream',
      }),
    ).rejects.toThrow(/media type/);
    expect(upload).not.toHaveBeenCalled();
  });

  it('stops on cancel, and on a blob the PDS didn’t return', async () => {
    const controller = new AbortController();
    const pending = uploadBlob(
      targetWith(() => new Promise(() => {})),
      new Uint8Array([1]),
      {
        encoding: 'image/jpeg',
        signal: controller.signal,
      },
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });

    await expect(
      uploadBlob(
        targetWith(async () => ({ data: {} })),
        new Uint8Array([1]),
        { encoding: 'image/jpeg' },
      ),
    ).rejects.toThrow(/did not return/);
  });

  it('times out', async () => {
    vi.useFakeTimers();
    try {
      const pending = uploadBlob(
        targetWith(() => new Promise(() => {})),
        new Uint8Array([1]),
        {
          encoding: 'image/jpeg',
          timeoutMs: 1000,
        },
      );
      const check = expect(pending).rejects.toMatchObject({ timedOut: true });
      await vi.advanceTimersByTimeAsync(1000);
      await check;
    } finally {
      vi.useRealTimers();
    }
  });
});
