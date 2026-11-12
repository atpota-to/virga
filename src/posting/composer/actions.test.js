import { describe, expect, it } from 'vitest';
import {
  composerActions,
  actionLabel,
  OVER_LIMIT_HINT,
  EMPTY_HINT,
  VIDEO_PENDING_HINT,
  SIGNED_OUT_HINT,
} from './actions.js';
import { emptyComposerState } from '../lib/composerModel.js';
import {
  EMPTY_QUEUE_HINT,
  NEEDS_BACKEND_HINT,
  REPLY_HINT,
  VIDEO_HINT,
} from '../schedule/publishActions.js';
import { POSTING_REGRANT_MESSAGE } from '../../accounts/accountCopy.js';

const QUEUE = {
  timezone: 'UTC',
  slots: {
    mon: ['09:00'],
    tue: [],
    wed: [],
    thu: [],
    fri: [],
    sat: [],
    sun: [],
  },
};
const EMPTY_QUEUE = {
  timezone: 'UTC',
  slots: { mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
};
const CAPS = { canPost: true, canSchedule: true };

function stateWith(text, patch = {}) {
  const s = emptyComposerState({ asDid: 'did:plc:mira' });
  s.posts[0].text = text;
  return { ...s, ...patch };
}

describe('composerActions', () => {
  it('posts by default and can do everything with a long session', () => {
    const r = composerActions(stateWith('hi'), {
      defaultAction: 'post',
      queue: QUEUE,
      caps: CAPS,
    });
    expect(r.primary).toBe('post');
    expect(Object.values(r.actions).every((a) => !a.disabled)).toBe(true);
  });

  it('follows the account’s default action', () => {
    expect(
      composerActions(stateWith('hi'), {
        defaultAction: 'queue',
        queue: QUEUE,
        caps: CAPS,
      }).primary,
    ).toBe('queue');
    expect(
      composerActions(stateWith('hi'), {
        defaultAction: 'draft',
        queue: QUEUE,
        caps: CAPS,
      }).primary,
    ).toBe('draft');
  });

  it('falls back to posting when scheduling can’t happen, and says why', () => {
    const r = composerActions(stateWith('hi'), {
      defaultAction: 'schedule',
      queue: QUEUE,
      caps: { canPost: true, canSchedule: false },
    });
    expect(r.primary).toBe('post');
    expect(r.actions.schedule).toEqual({
      disabled: true,
      reason: NEEDS_BACKEND_HINT,
    });
  });

  it('keeps an empty queue primary but disabled', () => {
    const r = composerActions(stateWith('hi'), {
      defaultAction: 'queue',
      queue: EMPTY_QUEUE,
      caps: CAPS,
    });
    expect(r.primary).toBe('queue');
    expect(r.actions.queue.reason).toBe(EMPTY_QUEUE_HINT);
    expect(r.actions.schedule.disabled).toBe(false);
  });

  it('refuses to schedule a reply or a video (D19)', () => {
    const reply = composerActions(
      stateWith('hi', {
        reply: { uri: 'at://x/app.bsky.feed.post/1', cid: 'c' },
      }),
      { defaultAction: 'post', queue: QUEUE, caps: CAPS },
    );
    expect(reply.actions.schedule.reason).toBe(REPLY_HINT);
    expect(reply.actions.queue.reason).toBe(REPLY_HINT);
    const s = stateWith('hi');
    s.posts[0].video = { file: {}, status: 'ready', alt: '' };
    expect(
      composerActions(s, { defaultAction: 'post', queue: QUEUE, caps: CAPS })
        .actions.schedule.reason,
    ).toBe(VIDEO_HINT);
  });

  it('turns the primary into Save draft when a post is over the limit', () => {
    const r = composerActions(stateWith('x'.repeat(320)), {
      defaultAction: 'post',
      queue: QUEUE,
      caps: CAPS,
    });
    expect(r.primary).toBe('draft');
    expect(r.draftFallback).toBe(true);
    expect(r.actions.post.reason).toBe(OVER_LIMIT_HINT);
    expect(r.actions.draft.disabled).toBe(false);
  });

  it('can’t save a draft over a thousand characters either', () => {
    const r = composerActions(stateWith('x'.repeat(1001)), {
      defaultAction: 'post',
      queue: QUEUE,
      caps: CAPS,
    });
    expect(r.actions.draft.disabled).toBe(true);
    expect(r.draftFallback).toBe(false);
  });

  it('needs something to send', () => {
    const r = composerActions(stateWith(''), {
      defaultAction: 'post',
      queue: QUEUE,
      caps: CAPS,
    });
    expect(r.actions.post.reason).toBe(EMPTY_HINT);
    expect(r.actions.draft.reason).toBe(EMPTY_HINT);
  });

  it('waits for a video upload', () => {
    const s = stateWith('hi');
    s.posts[0].video = { file: {}, status: 'uploading', alt: '' };
    expect(
      composerActions(s, { defaultAction: 'post', queue: QUEUE, caps: CAPS })
        .actions.post.reason,
    ).toBe(VIDEO_PENDING_HINT);
  });

  it('says when the account can’t post or is signed out', () => {
    expect(
      composerActions(stateWith('hi'), {
        defaultAction: 'post',
        queue: QUEUE,
        caps: { canPost: false },
      }).actions.post.reason,
    ).toBe(POSTING_REGRANT_MESSAGE);
    expect(
      composerActions(stateWith('hi'), {
        defaultAction: 'post',
        queue: QUEUE,
        caps: CAPS,
        signedOut: true,
      }).actions.post.reason,
    ).toBe(SIGNED_OUT_HINT);
  });

  it('a schedule chosen in the composer becomes the primary', () => {
    expect(
      composerActions(stateWith('hi', { schedule: { mode: 'queue' } }), {
        defaultAction: 'post',
        queue: QUEUE,
        caps: CAPS,
      }).primary,
    ).toBe('queue');
    expect(
      composerActions(
        stateWith('hi', {
          schedule: { mode: 'at', at: '2030-01-01T00:00:00Z' },
        }),
        { defaultAction: 'post', queue: QUEUE, caps: CAPS },
      ).primary,
    ).toBe('schedule');
  });
});

describe('actionLabel', () => {
  it('names the action for what is in the composer', () => {
    expect(actionLabel('post', stateWith('hi'))).toBe('Post');
    const thread = stateWith('a');
    thread.posts.push({ ...thread.posts[0], id: 'p2' });
    expect(actionLabel('post', thread)).toBe('Post 2 posts');
    expect(
      actionLabel('post', stateWith('hi', { reply: { uri: 'u', cid: 'c' } })),
    ).toBe('Reply');
    expect(
      actionLabel(
        'schedule',
        stateWith('hi', {
          source: { kind: 'scheduled', id: 's' },
          schedule: { mode: 'at', at: 'x' },
        }),
      ),
    ).toBe('Save changes');
    expect(
      actionLabel(
        'draft',
        stateWith('hi', { source: { kind: 'draft', id: 'd' } }),
      ),
    ).toBe('Save draft');
    expect(actionLabel('draft', stateWith('hi'))).toBe('Save as draft');
  });
});
