// The bytes and content type of an upload-blob request.
//
// The client sends the raw bytes (Content-Type: application/octet-stream,
// which Vercel hands over as a Buffer) with the blob's real type in the
// `encoding` query parameter. A `{ blob: <base64>, encoding }` JSON body is
// accepted too; it is cheap to keep.

/**
 * @param {Buffer|object|null|undefined} body - the request body as received
 * @param {string|null|undefined} encoding - the `encoding` query parameter
 * @returns {{ uint8Array: Uint8Array, encoding: string } | { error: string }} never throws
 */
export function extractBlobPayload(body, encoding) {
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
    if (body.length === 0) return { error: 'Missing blob data' };
    const type = typeof encoding === 'string' && encoding ? encoding : null;
    if (!type) return { error: 'Missing encoding/content-type' };
    return { uint8Array: new Uint8Array(body), encoding: type };
  }

  const { blob, encoding: envelopeEncoding } =
    body && typeof body === 'object' ? body : {};
  if (!blob || typeof blob !== 'string') return { error: 'Missing blob data' };
  if (!envelopeEncoding) return { error: 'Missing encoding/content-type' };
  const buffer = Buffer.from(blob, 'base64');
  if (buffer.length === 0) return { error: 'Missing blob data' };
  return { uint8Array: new Uint8Array(buffer), encoding: envelopeEncoding };
}
