// What a sign-out would stop: the scheduled posts and post timers a long
// session has waiting on Virga's server, counted as the sign-out dialogs
// count them.

import { describe, expect, it, vi } from 'vitest';
import { pendingWorkWarning } from './accountCopy.js';
import { hasPendingWork, readPendingWork } from './pendingWork.js';

const DID = 'did:plc:virgaharnessmira2zq4x';

function requester(byPath) {
  return {
    did: DID,
    request: vi.fn(async (path) => {
      const answer = byPath[path];
      if (answer instanceof Error) throw answer;
      return answer ?? { success: true, data: [] };
    }),
  };
}

describe('readPendingWork', () => {
  it('counts Virga’s waiting posts and live timers, and nothing else', async () => {
    const req = requester({
      '/api/schedule/list': {
        success: true,
        data: [
          { id: 1, status: 'pending', clientKey: 'virga' },
          { id: 2, status: 'publishing', clientKey: 'virga' },
          { id: 3, status: 'failed', clientKey: 'virga' },
          { id: 4, status: 'published', clientKey: 'virga' },
          // Another app's row runs on its own grant.
          { id: 5, status: 'pending', clientKey: 'anisota' },
        ],
      },
      '/api/self-destruct/list': {
        success: true,
        data: [
          { id: 1, status: 'armed' },
          { id: 2, status: 'checking' },
          { id: 3, status: 'deleted' },
          { id: 4, status: 'failed' },
        ],
      },
    });
    expect(await readPendingWork(req)).toEqual({ posts: 2, timers: 2 });
  });

  it('fails when a list can’t be read, so the dialog says it couldn’t check', async () => {
    const req = requester({ '/api/self-destruct/list': Object.assign(new Error('Couldn’t reach Virga’s server.'), { status: 0, code: 'NETWORK_ERROR' }) });
    await expect(readPendingWork(req)).rejects.toThrow();
  });
});

describe('hasPendingWork', () => {
  it('asks first when something is waiting, or when nobody could tell', () => {
    expect(hasPendingWork({ posts: 0, timers: 0 })).toBe(false);
    expect(hasPendingWork({ posts: 1, timers: 0 })).toBe(true);
    expect(hasPendingWork({ posts: 0, timers: 2 })).toBe(true);
    expect(hasPendingWork(null)).toBe(true);
  });
});

describe('pendingWorkWarning', () => {
  it('names what stops, and that it stops only if this was the last browser', () => {
    expect(pendingWorkWarning('Mira', { posts: 3, timers: 1 })).toBe(
      'Mira has 3 scheduled posts and 1 post timer waiting on Virga’s server. If no other browser or device is signed in to Virga as Mira, the posts won’t go out and the timer won’t delete anything until Mira signs back in with a long session.',
    );
    expect(pendingWorkWarning('Mira', { posts: 1, timers: 0 })).toMatch(/^Mira has 1 scheduled post waiting .* the post won’t go out until/);
    expect(pendingWorkWarning('Mira', { posts: 0, timers: 2 })).toMatch(/^Mira has 2 post timers waiting .* the timers won’t delete anything until/);
    expect(pendingWorkWarning('Mira', { posts: 0, timers: 0 })).toBeNull();
  });

  it('says so when it couldn’t check', () => {
    expect(pendingWorkWarning('Mira', null)).toMatch(/^Virga couldn’t check whether Mira has scheduled posts or post timers waiting\./);
  });
});
