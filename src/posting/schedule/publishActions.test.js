import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PUBLISH_ACTION,
  EMPTY_QUEUE_HINT,
  NEEDS_BACKEND_HINT,
  PUBLISH_ACTIONS,
  PUBLISH_ACTION_OPTIONS,
  REPLY_HINT,
  VIDEO_HINT,
  getPublishActionLabel,
  normalizePublishAction,
  publishActionBlockReason,
  resolvePrimaryPublishAction,
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

  it('says why a post can’t be scheduled: no long session, a reply, a video', () => {
    expect(scheduleBlockReason({})).toBeNull();
    expect(scheduleBlockReason({ canSchedule: false, reply: true })).toBe(
      NEEDS_BACKEND_HINT,
    );
    expect(scheduleBlockReason({ reply: true, video: true })).toBe(REPLY_HINT);
    expect(scheduleBlockReason({ video: true })).toBe(VIDEO_HINT);
  });

  it('puts that reason on Schedule and Add to queue, ahead of the empty week', () => {
    const scheduleBlock = scheduleBlockReason({ reply: true });
    expect(
      publishActionBlockReason(PUBLISH_ACTIONS.QUEUE, {
        queueEmpty: true,
        scheduleBlock,
      }),
    ).toBe(REPLY_HINT);
    expect(
      publishActionBlockReason(PUBLISH_ACTIONS.SCHEDULE, { scheduleBlock }),
    ).toBe(REPLY_HINT);
    expect(
      publishActionBlockReason(PUBLISH_ACTIONS.POST, { scheduleBlock }),
    ).toBeNull();
  });
});
