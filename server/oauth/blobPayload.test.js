// The upload's two transports: raw bytes with `encoding` (what the app
// sends), and the base64 JSON envelope. A malformed request is an { error },
// never a throw.

import { describe, expect, it } from 'vitest';
import { extractBlobPayload } from './blobPayload.js';

const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

describe('raw bytes', () => {
  it('decodes a Buffer with the encoding', () => {
    const result = extractBlobPayload(bytes, 'image/jpeg');
    expect(result.error).toBeUndefined();
    expect(result.encoding).toBe('image/jpeg');
    expect(Buffer.from(result.uint8Array)).toEqual(bytes);
  });

  it('refuses an empty body, and a body without an encoding', () => {
    expect(extractBlobPayload(Buffer.alloc(0), 'image/jpeg').error).toBe(
      'Missing blob data',
    );
    expect(extractBlobPayload(bytes, '').error).toBe(
      'Missing encoding/content-type',
    );
    expect(extractBlobPayload(bytes).error).toBe(
      'Missing encoding/content-type',
    );
  });
});

describe('the JSON envelope', () => {
  it('decodes { blob, encoding }', () => {
    const result = extractBlobPayload({
      blob: bytes.toString('base64'),
      encoding: 'image/png',
    });
    expect(result.encoding).toBe('image/png');
    expect(Buffer.from(result.uint8Array)).toEqual(bytes);
  });

  it('refuses a malformed envelope with the same messages', () => {
    expect(extractBlobPayload({}).error).toBe('Missing blob data');
    expect(extractBlobPayload(null).error).toBe('Missing blob data');
    expect(extractBlobPayload({ blob: '' }).error).toBe('Missing blob data');
    // Node's base64 decoder skips what it can't read, so this decodes to nothing.
    expect(
      extractBlobPayload({ blob: '!!!', encoding: 'image/png' }).error,
    ).toBe('Missing blob data');
    expect(extractBlobPayload({ blob: bytes.toString('base64') }).error).toBe(
      'Missing encoding/content-type',
    );
  });
});
