// Linking an owner to the moderator (docs/DEFENSE.md, "The moderator's
// conversations, kept apart"). Settings shows a short code; the owner sends it
// to the moderator from the same account. The chat service vouches for who
// sent a DM, so the code doesn't prove who the sender is: it proves the
// account signed in to Virga chose to be answered, and it is bound to that
// account, so the same code sent by anyone else links nothing.

import { createHash, randomInt } from 'node:crypto';

/** Letters and digits that can't be misread as each other: no 0, 1, I or O. */
export const LINK_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const LINK_CODE_LENGTH = 8;
export const LINK_TTL_MS = 15 * 60_000;

/** A new code, eight characters from LINK_ALPHABET. */
export function newLinkCode(pick = randomInt) {
  let code = '';
  for (let i = 0; i < LINK_CODE_LENGTH; i += 1) code += LINK_ALPHABET[pick(LINK_ALPHABET.length)];
  return code;
}

/** "ABCDEFGH" as Settings shows it: "ABCD-EFGH". */
export const displayLinkCode = (code) => `${code.slice(0, 4)}-${code.slice(4)}`;

/**
 * What is stored for a code: a hash of the owner's DID and the code, so a
 * stolen table links nobody and a code means nothing for another account.
 */
export function hashLinkCode(ownerDid, code) {
  const clean = String(code || '').replace(/-/g, '').toUpperCase();
  return createHash('sha256').update(`virga-defense-link\n${ownerDid}\n${clean}`).digest('hex');
}

/** A sender's DID as defense_dm_stranger keeps it: hashed, so no list of who wrote is kept. */
export function hashSender(did) {
  return createHash('sha256').update(`virga-defense-stranger\n${did}`).digest('hex');
}
