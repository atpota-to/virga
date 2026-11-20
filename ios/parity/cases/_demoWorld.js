// Shared by the demo-world generators: the worlds they build, and a world
// as a fixture holds it (ios/parity/cases/_canonical.js says how). Swift:
// ios/VirgaKit/Tests/VirgaDemoTests/DemoWorldSupport.swift.

import { vi } from 'vitest';
import {
  LAB,
  ME,
  buildWorld,
  postRecord,
  repoRecords,
} from '../../../harness/world.js';
import { part } from './_canonical.js';

/** The `now` the README's example uses, and the others the fixtures build at. */
export const NOW = 1794700000000;

/** Someone who is neither account: buildWorld gives them a quiet world. */
export const SOMEONE = {
  did: 'did:plc:someoneelseentirely',
  handle: 'someone.example.net',
  displayName: 'Someone Else',
};

export function accountOf(name) {
  if (name === 'me') return ME;
  if (name === 'lab') return LAB;
  if (name === 'someone') return SOMEONE;
  throw new Error(`no account ${name}`);
}

/** `{ now, seed?, account }` as a case input names a world. */
export function worldFor({ now, seed, account }) {
  return buildWorld({ now, seed, account: accountOf(account) });
}

export const WORLD_PARTS = [
  'cast',
  'followedOnly',
  'posts',
  'followers',
  'follows',
  'notifications',
  'likes',
  'reposts',
  'blockers',
  'lists',
  'others',
  'feeds',
  'ownLists',
  'preferences',
  'drafts',
  'bookmarks',
];

/** A world as a fixture holds it: the small things whole, each list as a part. */
export function worldDigest(world) {
  const parts = {};
  for (const name of WORLD_PARTS) parts[name] = part(world[name]);
  parts.written = part([...world.written]);
  parts.removed = part([...world.removed]);
  parts.blobs = part([...world.blobs]);
  return {
    me: world.me,
    now: world.now,
    start: world.start,
    profile: world.profile,
    revision: world.revision,
    parts,
    postRecords: part(world.posts.map((p) => postRecord(p))),
    repoRecords: part(repoRecords(world)),
  };
}

/**
 * Runs `fn` with the clock stopped at `ms`, for harness code that reads it
 * (`new Date()`, `Date.now()`): the Swift port takes the same moment as
 * `now`.
 */
export async function atTime(ms, fn) {
  vi.useFakeTimers({ now: ms, toFake: ['Date'] });
  try {
    return await fn();
  } finally {
    vi.useRealTimers();
  }
}

/** A thrown error as a fixture holds it: message, and name, status and error when it has them. */
export function thrown(error) {
  return {
    $throws: String(error?.message || error),
    name: error?.name,
    status: error?.status,
    error: error?.error,
  };
}
