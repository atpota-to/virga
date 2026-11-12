/*
 * First renders of the time picker, the timer editor, the week calendar and
 * the two settings cards through react-dom/server (the suite has no DOM, so
 * effects and clicks don't run here): each draws what it's given, with its
 * labels, and nothing throws.
 */
import React, { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../session/useAtprotoSession.jsx', () => ({
  useAtprotoSession: () => ({
    accounts: [{ did: 'did:plc:self', handle: 'me.example' }],
    authMode: 'backend',
    backendFor: () => null,
    capabilitiesFor: () => ({
      canPost: true,
      canSchedule: false,
      canUseAi: false,
      missing: [],
    }),
  }),
}));

// The suite runs without the React plugin, so JSX compiles to
// React.createElement and needs React in scope.
globalThis.React = React;

const { default: WhenPicker } = await import('./WhenPicker.jsx');
const { default: LifespanEditor } = await import('./LifespanEditor.jsx');
const { default: QueueSettings } = await import('./QueueSettings.jsx');
const { default: LifespanDefaults } = await import('./LifespanDefaults.jsx');
const { QueueCalendar } = await import('../pages/scheduleParts.jsx');
const { normalizeTimer } = await import('../timers/selfDestruct.js');
const { DEFAULT_POSTING_QUEUE } = await import('../schedule/postingQueue.js');

const html = (el) => renderToString(el);
const text = (el) =>
  html(el)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, ' ');

describe('WhenPicker', () => {
  it('draws a date and a time on the queue’s clock, with quick picks', () => {
    const at = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const out = html(
      createElement(WhenPicker, {
        did: 'did:plc:self',
        value: at,
        onChange: () => {},
      }),
    );
    expect(out).toContain('type="date"');
    expect(out).toContain('type="time"');
    expect(out).toContain('Quick picks');
    expect(
      text(createElement(WhenPicker, { did: 'did:plc:self', value: at })),
    ).toMatch(/Times are in/);
  });

  it('offers the queue when asked', () => {
    const out = text(
      createElement(WhenPicker, {
        did: 'did:plc:self',
        value: null,
        queue: true,
        onQueue: () => {},
      }),
    );
    expect(out).toMatch(/Next open time in your queue/);
    expect(out).toMatch(/Use this time/);
  });

  it('says what’s wrong with a time that has passed', () => {
    const out = text(
      createElement(WhenPicker, {
        did: 'did:plc:self',
        value: new Date(Date.now() - 3600_000).toISOString(),
      }),
    );
    expect(out).toMatch(/That time has passed/);
  });
});

describe('LifespanEditor', () => {
  const rule = normalizeTimer({
    enabled: true,
    lifespanSeconds: 3600,
    conditions: {
      clauses: [
        { metric: 'likes', op: 'gte', value: 5 },
        { metric: 'quotes', op: 'gt', value: 2 },
      ],
      sense: 'unless',
      onSpare: 'extend',
      maxExtensions: 2,
    },
    effects: [
      { action: 'limitReplies', allow: ['follower'] },
      { action: 'delete' },
    ],
  });

  it('draws the whole rule and says it in a sentence', () => {
    const out = text(
      createElement(LifespanEditor, {
        value: rule,
        onChange: () => {},
        fit: {},
      }),
    );
    expect(out).toMatch(/Put a timer on this post/);
    expect(out).toMatch(/Delete it after/);
    expect(out).toMatch(/What happens then/);
    expect(out).toMatch(/Who can still reply/);
    expect(out).toMatch(/Count quotes from/);
    expect(out).toMatch(/Any one of them/);
    expect(out).toMatch(/Give it another 1 hour/);
    expect(out).toMatch(
      /Limits replies to your followers and deletes itself 1 hour after it goes up, unless it has 5 likes or more than 2 quotes by then/,
    );
  });

  it('shows only the switch when off', () => {
    const out = text(
      createElement(LifespanEditor, {
        value: normalizeTimer({}),
        onChange: () => {},
      }),
    );
    expect(out).toMatch(/No timer: the post stays up/);
    expect(out).not.toMatch(/Delete it after/);
  });

  it('says what a reply can’t do', () => {
    const out = text(
      createElement(LifespanEditor, {
        value: rule,
        onChange: () => {},
        fit: { reply: true },
      }),
    );
    expect(out).toMatch(/Limiting replies doesn’t apply to a reply/);
  });
});

describe('QueueCalendar', () => {
  it('draws seven days of posting times', () => {
    const out = html(
      createElement(QueueCalendar, {
        schedule: DEFAULT_POSTING_QUEUE,
        rows: [],
        now: Date.now(),
      }),
    );
    expect(out).toContain('The next seven days');
    expect((out.match(/role="listitem"/g) || []).length).toBe(7);
  });
});

describe('Settings › Posting cards', () => {
  it('draws the weekly queue card', () => {
    const out = text(createElement(QueueSettings, { did: 'did:plc:self' }));
    expect(out).toMatch(/Weekly queue/);
    expect(out).toMatch(/10 posting times a week/);
    expect(out).toMatch(/Time zone/);
    expect(out).toMatch(/Suggest posting times/);
  });

  it('draws the default timer card', () => {
    const out = text(createElement(LifespanDefaults, { did: 'did:plc:self' }));
    expect(out).toMatch(/Default timer/);
    expect(out).toMatch(/Start new posts with a timer/);
    expect(out).toMatch(/Delete it after/);
    expect(out).not.toMatch(/A set time/);
  });
});
