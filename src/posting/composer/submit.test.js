import { describe, expect, it, vi } from 'vitest';
import {
  createPublishWatch,
  progressLine,
  publishErrorView,
  postedToast,
  scheduledMessage,
  queueSlotRows,
  finishSource,
  SCHEDULED_COPY_REMAINS,
  DRAFT_NOT_DELETED,
} from './submit.js';
import { PublishError } from '../lib/publish.js';
import { makeReauthRequiredError } from '../../session/accounts.js';

function fakeClock() {
  const timers = [];
  return {
    setTimer: (fn, ms) => {
      timers.push({ fn, ms, live: true });
      return timers.length - 1;
    },
    clearTimer: (id) => {
      if (timers[id]) timers[id].live = false;
    },
    run(ms) {
      for (const t of timers)
        if (t.live && t.ms <= ms) {
          t.live = false;
          t.fn();
        }
    },
  };
}

describe('createPublishWatch', () => {
  it('says it’s slow at 60 s and gives up at 180 s', () => {
    const clock = fakeClock();
    const onSlow = vi.fn();
    const onHard = vi.fn();
    const watch = createPublishWatch({ onSlow, onHard, ...clock });
    clock.run(60_000);
    expect(onSlow).toHaveBeenCalledOnce();
    expect(onHard).not.toHaveBeenCalled();
    clock.run(180_000);
    expect(onHard).toHaveBeenCalledOnce();
    expect(watch.stop()).toBe(true);
  });
  it('stops quietly when the publish ends first', () => {
    const clock = fakeClock();
    const onHard = vi.fn();
    const watch = createPublishWatch({ onHard, ...clock });
    expect(watch.stop()).toBe(false);
    clock.run(999_999);
    expect(onHard).not.toHaveBeenCalled();
  });
});

describe('progressLine', () => {
  it('describes each phase', () => {
    expect(
      progressLine({ phase: 'uploading', kind: 'images', done: 1, total: 3 }),
    ).toBe('Uploading images, 1 of 3');
    expect(
      progressLine({ phase: 'uploading', kind: 'images', done: 1, total: 1 }),
    ).toBe('Uploaded the image');
    expect(
      progressLine({ phase: 'video', step: 'processing', progress: 40 }),
    ).toBe('Processing the video, 40%');
    expect(progressLine({ phase: 'writing', count: 3 })).toBe(
      'Publishing 3 posts to your repo',
    );
    expect(progressLine({ phase: 'uploaded', kind: 'image' })).toBeNull();
  });
});

describe('publishErrorView', () => {
  it('is silent for a cancel', () => {
    expect(
      publishErrorView(new PublishError('ABORTED', 'Cancelled.')).silent,
    ).toBe(true);
  });
  it('asks for the posting permission', () => {
    expect(
      publishErrorView(new PublishError('MISSING_SCOPE', 'x')).permission,
    ).toBe(true);
    expect(
      publishErrorView({
        message: 'Missing required scope "repo:app.bsky.feed.post"',
      }).permission,
    ).toBe(true);
  });
  it('asks for a sign-in', () => {
    expect(publishErrorView(makeReauthRequiredError('did:plc:x')).reauth).toBe(
      true,
    );
  });
  it('shows the publish error’s own sentence', () => {
    expect(
      publishErrorView(new PublishError('DUPLICATE', 'This was just posted.'))
        .message,
    ).toBe('This was just posted.');
    expect(publishErrorView({}).message).toBe(
      'The post didn’t go out. Try again.',
    );
  });
});

describe('copy', () => {
  it('names the account and links the post', () => {
    const t = postedToast({
      account: { handle: 'mira.example.com' },
      did: 'did:plc:m',
      root: { uri: 'at://did:plc:m/app.bsky.feed.post/3abc' },
    });
    expect(t.text).toBe('Posted as @mira.example.com.');
    expect(t.href).toBe('https://bsky.app/profile/mira.example.com/post/3abc');
  });
  it('says when a scheduled post goes out', () => {
    const now = new Date('2026-11-12T08:00:00Z');
    expect(
      scheduledMessage({
        at: '2026-11-13T09:00:00Z',
        account: { handle: 'm.example' },
        now,
        timeZone: 'UTC',
      }),
    ).toBe('Scheduled for tomorrow at 9:00 AM as @m.example.');
    expect(
      scheduledMessage({
        at: '2026-11-12T17:30:00Z',
        queued: true,
        account: { handle: 'm.example' },
        now,
        timeZone: 'UTC',
      }),
    ).toBe('Added to the queue, going out today at 5:30 PM as @m.example.');
  });
});

describe('queueSlotRows', () => {
  it('keeps queued rows that hold a slot, leaving out the one being edited', () => {
    const rows = [
      { id: 'a', queued: true, status: 'pending' },
      { id: 'b', queued: false, status: 'pending' },
      { id: 'c', queued: true, status: 'cancelled' },
      { id: 'd', queued: true, status: 'pending' },
    ];
    expect(queueSlotRows(rows, { excludeId: 'd' }).map((r) => r.id)).toEqual([
      'a',
    ]);
  });
});

describe('finishSource', () => {
  const wait = () => Promise.resolve();
  it('does nothing without a source', async () => {
    expect(await finishSource(null, {})).toMatchObject({ status: 'none' });
  });
  it('deletes a draft as its owner', async () => {
    const agentFor = vi.fn(async (did) => ({ did }));
    const deleteDraft = vi.fn(async () => {});
    const r = await finishSource(
      { kind: 'draft', id: 'd1', ownerDid: 'did:plc:lab' },
      { asDid: 'did:plc:mira', agentFor, deleteDraft },
    );
    expect(r.status).toBe('done');
    expect(agentFor).toHaveBeenCalledWith('did:plc:lab');
    expect(deleteDraft).toHaveBeenCalledWith({ did: 'did:plc:lab' }, 'd1');
  });
  it('warns when the draft can’t be deleted', async () => {
    const r = await finishSource(
      { kind: 'draft', id: 'd1' },
      {
        agentFor: async () => ({}),
        deleteDraft: async () => Promise.reject(new Error('x')),
      },
    );
    expect(r).toMatchObject({
      status: 'failed',
      warning: DRAFT_NOT_DELETED,
      keepSource: false,
    });
  });
  it('cancels a scheduled row, trying twice, and keeps the source when it can’t', async () => {
    const cancelScheduled = vi
      .fn()
      .mockRejectedValueOnce(new Error('net'))
      .mockResolvedValueOnce({});
    const ok = await finishSource(
      { kind: 'scheduled', id: 's1' },
      { asDid: 'm', backendFor: () => ({}), cancelScheduled, wait },
    );
    expect(ok.status).toBe('done');
    expect(cancelScheduled).toHaveBeenCalledTimes(2);
    const bad = await finishSource(
      { kind: 'scheduled', id: 's1' },
      {
        asDid: 'm',
        backendFor: () => ({}),
        cancelScheduled: async () => Promise.reject(new Error('x')),
        wait,
      },
    );
    expect(bad).toEqual({
      status: 'failed',
      warning: SCHEDULED_COPY_REMAINS,
      keepSource: true,
    });
  });
  it('counts a row that is already gone as done', async () => {
    const gone = Object.assign(new Error('gone'), { status: 404 });
    const r = await finishSource(
      { kind: 'scheduled', id: 's1' },
      {
        backendFor: () => ({}),
        cancelScheduled: async () => Promise.reject(gone),
        wait,
      },
    );
    expect(r.status).toBe('done');
  });
});
