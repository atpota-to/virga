// src/posting/lib/blobs.js: an upload's deadline, reading a blob's CID, and
// an upload as the app makes it on a long session: through @atproto/api's
// Agent and createBackendFetchHandler to Virga's server (recorded
// exchanges, _fetch.js). Swift: VirgaNetwork/Posting/Lib/Blobs.swift.

import { Agent, jsonToLex } from '@atproto/api';
import {
  BLOB_UPLOAD_BASE_MS,
  BLOB_UPLOAD_MIN_BYTES_PER_SECOND,
  blobCid,
  blobUploadTimeoutMs,
  isBlob,
  uploadBlob,
} from '../../../src/posting/lib/blobs.js';
import { createBackendFetchHandler } from '../../../src/session/backendClient.js';
import { each, value } from './_helpers.js';
import { inTurn, json, recordFetch } from './_fetch.js';

export const sources = ['src/posting/lib/blobs.js'];

const SERVER = 'https://server.example';
const DID = 'did:plc:virgaharnessmira2zq4x';
const TOKEN = `vg_${'0f'.repeat(32)}`;
const CID = 'bafkreihlfz7eeyynraq3zqhozs4q3l3wabewbjevjb5jgophbtcjj7eijm';
const BLOB = {
  $type: 'blob',
  ref: { $link: CID },
  mimeType: 'image/jpeg',
  size: 3,
};

export default async function cases() {
  const target = () => ({
    did: DID,
    agent: new Agent({
      did: DID,
      fetchHandler: createBackendFetchHandler({
        backendUrl: SERVER,
        token: TOKEN,
        did: DID,
      }),
    }),
  });
  return [
    value('constants', {
      BLOB_UPLOAD_BASE_MS,
      BLOB_UPLOAD_MIN_BYTES_PER_SECOND,
    }),

    ...(await each(
      'blobUploadTimeoutMs',
      [
        { bytes: 0 },
        { bytes: 1 },
        { bytes: 16384 },
        { bytes: 16385 },
        { bytes: Math.round(1.9 * 1024 * 1024) },
        { bytes: 2_000_000 },
        { bytes: 200_000 },
        { bytes: -5 },
        { bytes: 0.5 },
        { bytes: null },
        { bytes: '5000' },
        {},
      ],
      ({ bytes }) => blobUploadTimeoutMs(bytes),
    )),

    ...(await each(
      'blobCid',
      [
        { blob: BLOB },
        { blob: { cid: CID, mimeType: 'image/png' } },
        { blob: { cid: '', mimeType: 'image/png' } },
        { blob: { cid: 5 } },
        { blob: { ref: {} } },
        { blob: { ref: { $link: '' }, cid: 'legacy' } },
        { blob: { ref: { $link: 5 } } },
        { blob: { ref: { $link: { nested: true } } } },
        { blob: { ref: 'x' } },
        { blob: [1, 2] },
        { blob: 'bafy' },
        { blob: 5 },
        { blob: null },
        {},
      ],
      ({ blob }) => blobCid(blob),
    )),

    ...(await each('blobCidOfBlobRef', [{ blob: BLOB }], ({ blob }) =>
      blobCid(jsonToLex(blob)),
    )),

    ...(await each(
      'isBlob',
      [
        { blob: BLOB },
        { blob: { cid: CID, mimeType: 'image/png' } },
        { blob: { cid: CID } },
        { blob: { ref: { $link: CID }, mimeType: 5 } },
        { blob: { ref: { $link: CID }, mimeType: '' } },
        { blob: { ref: {} } },
        { blob: { cid: '', mimeType: 'image/png' } },
        { blob: null },
        { blob: 'bafy' },
      ],
      ({ blob }) => isBlob(blob),
    )),

    ...(await each(
      'uploadBlob',
      [
        {
          $id: 'jpeg',
          bytes: [1, 2, 3],
          encoding: 'image/jpeg',
          answers: [json({ success: true, data: { blob: BLOB } })],
        },
        {
          $id: 'size-from-bytes',
          bytes: [1, 2, 3, 4, 5],
          encoding: 'image/png',
          answers: [
            json({
              success: true,
              data: {
                blob: {
                  $type: 'blob',
                  ref: { $link: CID },
                  mimeType: 'image/png',
                  size: 5,
                },
              },
            }),
          ],
        },
        { $id: 'no-encoding', bytes: [1], answers: [] },
        {
          $id: 'octet-stream',
          bytes: [1],
          encoding: 'application/octet-stream',
          answers: [],
        },
        {
          $id: 'server-error',
          bytes: [1],
          encoding: 'video/mp4',
          answers: [
            json(
              {
                success: false,
                error:
                  'The PDS took too long to accept the upload. Please try again.',
                code: 'PDS_UPLOAD_TIMEOUT',
              },
              504,
            ),
          ],
        },
        {
          $id: 'session-gone',
          bytes: [1],
          encoding: 'image/png',
          answers: [
            json(
              {
                success: false,
                error:
                  'OAuth session not found or expired. Please re-authenticate.',
                code: 'OAUTH_SESSION_MISSING',
              },
              401,
            ),
          ],
        },
        {
          $id: 'offline',
          bytes: [1],
          encoding: 'image/png',
          answers: ['offline'],
        },
      ],
      ({ bytes, encoding, answers }) =>
        recordFetch(inTurn(...answers), () =>
          uploadBlob(
            target(),
            new Uint8Array(bytes),
            encoding === undefined ? {} : { encoding },
          ),
        ),
    )),
  ];
}
