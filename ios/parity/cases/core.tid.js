// TIDs: record keys and the time they carry. Swift: VirgaCore/TID.swift.
// Minting uses a random clock id, so it is held to the web app by round trip
// (encode in Swift, read back here) rather than by a fixed key.

import { isTid, tidTimestamp } from '../../../src/posting/lib/tid.js';
import { each } from './_helpers.js';

export const sources = ['src/posting/lib/tid.js'];

const KEYS = [
  '3jzfcijpj2z2a',
  '3kghuxuyvtk2y',
  '3lbuq7mkfuc2c',
  '2222222222222',
  'jzzzzzzzzzzzz',
  'kzzzzzzzzzzzz',
  '3jzfcijpj2z2',
  '3jzfcijpj2z2aa',
  '3JZFCIJPJ2Z2A',
  '3jzfcijpj2z21',
  'self',
  '',
];

export default async function cases() {
  return [
    ...(await each(
      'isTid',
      KEYS.map((rkey) => ({ rkey })),
      ({ rkey }) => isTid(rkey),
    )),
    ...(await each(
      'tidTimestamp',
      KEYS.map((rkey) => ({ rkey })),
      ({ rkey }) => tidTimestamp(rkey),
    )),
  ];
}
