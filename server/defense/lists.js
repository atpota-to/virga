// Making a Defense list: a moderation list record in the holder's repo, then
// its row. In phase 3 the holder is the owner's own account ('own'); a helper
// account of theirs ('helper') comes next (docs/DEFENSE.md).
//
// The record is written with the owner's long session, which Virga's server
// opens here and nowhere else in this module, for this one write.

import { Agent } from '@atproto/api';
import { nextTid } from '../../src/posting/lib/tid.js';
import { getOAuthClient } from '../oauth/client.js';
import { restoreWithRetry } from '../oauth/restore.js';
import { storeFor } from './store.js';

export const NAME_MAX = 64;
export const DESCRIPTION_MAX = 300;
const MODLIST = 'app.bsky.graph.defs#modlist';

export class ListError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'ListError';
    this.code = code;
  }
}

/** The description a list is made with: what it is for, and who keeps it. */
export function defaultDescription(purpose) {
  return purpose === 'mute'
    ? 'Kept with Virga: accounts from pile-ons, approved by hand, to mute.'
    : 'Kept with Virga: accounts from pile-ons, approved by hand, to block.';
}

/**
 * Make a list in the owner's own repo and keep it. Returns its row. Throws a
 * ListError with code SIGNED_OUT when the owner's session can't be opened,
 * NO_SCOPE when it doesn't let Virga write lists.
 */
export async function createOwnList({ ownerDid, name, purpose, description = null, deps = {} }) {
  const d = {
    restore: (did) => restoreWithRetry(getOAuthClient(), did, { tag: 'defense/list' }),
    Agent,
    store: storeFor(ownerDid, deps.storeOptions),
    newKey: () => nextTid(),
    ...deps,
  };
  const session = await d.restore(ownerDid);
  if (!session) throw new ListError('Your session on Virga’s server has ended. Sign in again to make a list.', 'SIGNED_OUT');
  const agent = new d.Agent(session);
  const rkey = d.newKey();
  try {
    await agent.com.atproto.repo.createRecord({
      repo: ownerDid,
      collection: 'app.bsky.graph.list',
      rkey,
      record: {
        $type: 'app.bsky.graph.list',
        purpose: MODLIST,
        name,
        description: description || defaultDescription(purpose),
        createdAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    if (/scope/i.test(`${err?.error || ''} ${err?.message || ''}`)) {
      throw new ListError('This sign-in doesn’t let Virga make lists. Sign in again from Defense to let it.', 'NO_SCOPE');
    }
    throw err;
  }
  return d.store.addList({ holderDid: ownerDid, mode: 'own', uri: `at://${ownerDid}/app.bsky.graph.list/${rkey}`, name, purpose });
}
