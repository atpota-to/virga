import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PUBLISH_ACTION,
  EMPTY_QUEUE_HINT,
  NEEDS_BACKEND_HINT,
  NO_BACKEND_HINT,
  PUBLISH_ACTIONS,
  PUBLISH_ACTION_OPTIONS,
  QUEUE_REPLY_HINT,
  queueBlockReason,
  VIDEO_HINT,
  getPublishActionLabel,
  normalizePublishAction,
  publishActionBlockReason,
  resolvePrimaryPublishAction,
  needsBackendHint,
  scheduleBlockReason,
} from './publishActions.js';
import { DEFAULT_ACTIONS } from '../settings.js';

// The composer's split button runs the account's default action:
//   • an unknown or absent stored value never breaks the button;
//   • an action this post can't do falls back to posting now;
//   • an empty weekly schedule does NOT fall back: it must never post now
//     what the writer meant to queue.

describe('normalizePublishAction', () => {
  it('passes through every real action', () => {
    for (const { value } of PUBLISH_ACTION_OPTIONS) {
      expect(normalizePublishAction(value)).toBe(value);
    }
  });

  it('falls back to posting now for unknown, empty, or absent values', () => {
    for (const bad of [undefined, null, '', 'hold', 'immediate', 42, {}]) {
      expect(normalizePublishAction(bad)).toBe(DEFAULT_PUBLISH_ACTION);
    }
    expect(DEFAULT_PUBLISH_ACTION).toBe(PUBLISH_ACTIONS.POST);
  });

  it('reads Anisota’s word for posting now', () => {
    expect(normalizePublishAction('publish')).toBe(PUBLISH_ACTIONS.POST);
  });

  it('offers exactly the actions posting settings store, in the same order', () => {
    expect(PUBLISH_ACTION_OPTIONS.map((o) => o.value)).toEqual([
      ...DEFAULT_ACTIONS,
    ]);
  });
});

describe('getPublishActionLabel', () => {
  it('labels each action, and unknown values as the default', () => {
    expect(getPublishActionLabel(PUBLISH_ACTIONS.POST)).toBe('Post now');
    expect(getPublishActionLabel(PUBLISH_ACTIONS.SCHEDULE)).toBe('Schedule');
    expect(getPublishActionLabel(PUBLISH_ACTIONS.QUEUE)).toBe('Add to queue');
    expect(getPublishActionLabel(PUBLISH_ACTIONS.DRAFT)).toBe('Save draft');
    expect(getPublishActionLabel('nonsense')).toBe('Post now');
  });
});

describe('resolvePrimaryPublishAction', () => {
  const anyPost = { canSchedule: true, canSaveDraft: true };

  it('honours the preference when the post supports it', () => {
    for (const { value } of PUBLISH_ACTION_OPTIONS) {
      expect(
        resolvePrimaryPublishAction({ preferred: value, ...anyPost }),
      ).toBe(value);
    }
  });

  it('falls back to posting now when the post cannot be scheduled', () => {
    const unschedulable = { canSchedule: false, canSaveDraft: true };
    expect(
      resolvePrimaryPublishAction({
        preferred: PUBLISH_ACTIONS.SCHEDULE,
        ...unschedulable,
      }),
    ).toBe(PUBLISH_ACTIONS.POST);
    expect(
      resolvePrimaryPublishAction({
        preferred: PUBLISH_ACTIONS.QUEUE,
        ...unschedulable,
      }),
    ).toBe(PUBLISH_ACTIONS.POST);
    expect(
      resolvePrimaryPublishAction({
        preferred: PUBLISH_ACTIONS.DRAFT,
        ...unschedulable,
      }),
    ).toBe(PUBLISH_ACTIONS.DRAFT);
  });

  it('falls back to posting now when the post cannot be saved as a draft', () => {
    const undraftable = { canSchedule: true, canSaveDraft: false };
    expect(
      resolvePrimaryPublishAction({
        preferred: PUBLISH_ACTIONS.DRAFT,
        ...undraftable,
      }),
    ).toBe(PUBLISH_ACTIONS.POST);
    expect(
      resolvePrimaryPublishAction({
        preferred: PUBLISH_ACTIONS.SCHEDULE,
        ...undraftable,
      }),
    ).toBe(PUBLISH_ACTIONS.SCHEDULE);
  });

  it('resolves a missing preference and missing capabilities to posting now', () => {
    expect(resolvePrimaryPublishAction()).toBe(PUBLISH_ACTIONS.POST);
    expect(resolvePrimaryPublishAction({})).toBe(PUBLISH_ACTIONS.POST);
    expect(resolvePrimaryPublishAction({ preferred: 'hold', ...anyPost })).toBe(
      PUBLISH_ACTIONS.POST,
    );
  });
});

describe('why an action is off', () => {
  it('explains an empty weekly schedule, and only for the queue', () => {
    expect(
      publishActionBlockReason(PUBLISH_ACTIONS.QUEUE, { queueEmpty: true }),
    ).toBe(EMPTY_QUEUE_HINT);
    expect(
      publishActionBlockReason(PUBLISH_ACTIONS.QUEUE, { queueEmpty: false }),
    ).toBeNull();
    expect(publishActionBlockReason(PUBLISH_ACTIONS.QUEUE)).toBeNull();
    for (const action of [
      PUBLISH_ACTIONS.POST,
      PUBLISH_ACTIONS.SCHEDULE,
      PUBLISH_ACTIONS.DRAFT,
    ]) {
      expect(publishActionBlockReason(action, { queueEmpty: true })).toBeNull();
    }
  });

  it('says why a post can’t be scheduled: no long session, a video', () => {
    expect(scheduleBlockReason({})).toBeNull();
    expect(scheduleBlockReason({ canSchedule: false, video: true })).toBe(
      NEEDS_BACKEND_HINT,
    );
    expect(scheduleBlockReason({ video: true })).toBe(VIDEO_HINT);
  });

  it('keeps a reply out of the queue, and only out of the queue', () => {
    expect(queueBlockReason({ reply: true })).toBe(QUEUE_REPLY_HINT);
    expect(queueBlockReason({})).toBeNull();
    const queueBlock = queueBlockReason({ reply: true });
    expect(
      publishActionBlockReason(PUBLISH_ACTIONS.QUEUE, { queueBlock }),
    ).toBe(QUEUE_REPLY_HINT);
    expect(
      publishActionBlockReason(PUBLISH_ACTIONS.SCHEDULE, { queueBlock }),
    ).toBeNull();
    expect(
      publishActionBlockReason(PUBLISH_ACTIONS.POST, { queueBlock }),
    ).toBeNull();
    // Ahead of the empty week: adding times wouldn't help a reply.
    expect(
      publishActionBlockReason(PUBLISH_ACTIONS.QUEUE, {
        queueBlock,
        queueEmpty: true,
      }),
    ).toBe(QUEUE_REPLY_HINT);
  });

  it('only says to reconnect where this copy of Virga offers its server', () => {
    expect(
      scheduleBlockReason({ canSchedule: false, authMode: 'backend' }),
    ).toBe(NEEDS_BACKEND_HINT);
    expect(
      scheduleBlockReason({ canSchedule: false, authMode: 'browser' }),
    ).toBe(NO_BACKEND_HINT);
    expect(NO_BACKEND_HINT).not.toMatch(/Reconnect/);
    expect(needsBackendHint('browser')).toBe(NO_BACKEND_HINT);
    expect(needsBackendHint('backend')).toBe(NEEDS_BACKEND_HINT);
  });

  it('puts that reason on Schedule and Add to queue, ahead of the empty week', () => {
    const scheduleBlock = scheduleBlockReason({ video: true });
    expect(
      publishActionBlockReason(PUBLISH_ACTIONS.QUEUE, {
        queueEmpty: true,
        scheduleBlock,
      }),
    ).toBe(VIDEO_HINT);
    expect(
      publishActionBlockReason(PUBLISH_ACTIONS.SCHEDULE, { scheduleBlock }),
    ).toBe(VIDEO_HINT);
    expect(
      publishActionBlockReason(PUBLISH_ACTIONS.POST, { scheduleBlock }),
    ).toBeNull();
  });
});
