import { describe, expect, it, vi } from 'vitest';
import {
  POSTING_EVENTS,
  POSTS_CHANGED_EVENT,
  emitPostingEvent,
  emitPostsChanged,
  onPostingEvent,
} from './events.js';

const ALICE = 'did:plc:alice';
const BOB = 'did:plc:bob';

describe('posting events', () => {
  it('are the names the design names', () => {
    expect(POSTING_EVENTS).toEqual({
      settings: 'virga:posting-settings',
      templates: 'virga:templates-changed',
      drafts: 'virga:drafts-changed',
      scheduled: 'virga:scheduled-changed',
      timers: 'virga:timers-changed',
      posts: 'virga:posts-changed',
    });
  });

  it('reach a listener with their detail, and stop when it unsubscribes', () => {
    const target = new EventTarget();
    const heard = vi.fn();
    const off = onPostingEvent(POSTING_EVENTS.drafts, heard, { target });
    expect(
      emitPostingEvent(POSTING_EVENTS.drafts, { did: ALICE, id: 'd1' }, target),
    ).toBe(true);
    expect(heard).toHaveBeenCalledWith({ did: ALICE, id: 'd1' });
    off();
    emitPostingEvent(POSTING_EVENTS.drafts, { did: ALICE }, target);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('can be heard for one account only', () => {
    const target = new EventTarget();
    const heard = vi.fn();
    onPostingEvent(POSTING_EVENTS.templates, heard, { did: ALICE, target });
    emitPostingEvent(POSTING_EVENTS.templates, { did: BOB }, target);
    emitPostingEvent(POSTING_EVENTS.templates, { did: ALICE }, target);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(heard.mock.calls[0][0].did).toBe(ALICE);
  });

  it('refuse an unknown name or a detail with no account', () => {
    const target = new EventTarget();
    expect(() =>
      emitPostingEvent('virga:nope', { did: ALICE }, target),
    ).toThrow(TypeError);
    expect(() => emitPostingEvent(POSTING_EVENTS.drafts, {}, target)).toThrow(
      /detail\.did/,
    );
    expect(() => onPostingEvent('virga:nope', () => {}, { target })).toThrow(
      TypeError,
    );
  });

  it('say so when there is no window to dispatch on', () => {
    expect(emitPostingEvent(POSTING_EVENTS.drafts, { did: ALICE }, null)).toBe(
      false,
    );
    expect(
      onPostingEvent(POSTING_EVENTS.drafts, () => {}, { target: null })(),
    ).toBeUndefined();
  });

  it('give posts-changed arrays a listener never has to guard', () => {
    const target = new EventTarget();
    const heard = vi.fn();
    onPostingEvent(POSTS_CHANGED_EVENT, heard, { target });
    emitPostsChanged(
      ALICE,
      {
        added: [
          { uri: 'at://a/app.bsky.feed.post/1', cid: 'c1' },
          { cid: 'no-uri' },
        ],
      },
      target,
    );
    expect(heard).toHaveBeenCalledWith({
      did: ALICE,
      added: [{ uri: 'at://a/app.bsky.feed.post/1', cid: 'c1', record: null }],
      removed: [],
    });
  });
});
