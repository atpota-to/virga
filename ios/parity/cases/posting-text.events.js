// src/posting/events.js: the posting section's event names, and emitting
// and listening, played as scripts on an EventTarget. Swift:
// VirgaPosting/Events.swift (PostingEventBus stands in for the window).
//
// A script is a list of steps: `on` (a listener, with an optional DID
// filter), `off` (stop one), `emit` (a name and a detail), `emitPosts`
// (emitPostsChanged), on a target or on none (`noTarget`). Each step
// records what it returned or threw; at the end, what each listener heard.
// Inputs from src/posting/events.test.js, plus every name, details without
// a usable DID, and posts-changed rows of every shape.

import {
  DRAFTS_CHANGED_EVENT,
  emitPostingEvent,
  emitPostsChanged,
  onPostingEvent,
  POSTING_EVENTS,
  POSTING_SETTINGS_EVENT,
  POSTS_CHANGED_EVENT,
  SCHEDULED_CHANGED_EVENT,
  TEMPLATES_CHANGED_EVENT,
  TIMERS_CHANGED_EVENT,
} from '../../../src/posting/events.js';
import { each, value } from './_helpers.js';

export const sources = ['src/posting/events.js'];

const ALICE = 'did:plc:alice';
const BOB = 'did:plc:bob';

async function play(steps) {
  const target = new EventTarget();
  const offs = {};
  const heard = {};
  const results = [];
  for (const step of steps) {
    const where = step.noTarget ? null : target;
    try {
      if (step.op === 'on') {
        heard[step.id] = [];
        offs[step.id] = onPostingEvent(
          step.name,
          (detail) => heard[step.id].push(detail),
          { did: step.did, target: where },
        );
        results.push(typeof offs[step.id]);
      } else if (step.op === 'off') {
        results.push(offs[step.id]() ?? null);
      } else if (step.op === 'emit') {
        results.push(emitPostingEvent(step.name, step.detail, where));
      } else if (step.op === 'emitPosts') {
        results.push(
          emitPostsChanged(
            step.did,
            { added: step.added, removed: step.removed },
            where,
          ),
        );
      }
    } catch (error) {
      results.push({ $throws: error.message, type: error.constructor.name });
    }
  }
  return { results, heard };
}

const SCRIPTS = [
  {
    $id: 'a listener hears, then stops',
    steps: [
      { op: 'on', id: 'a', name: POSTING_EVENTS.drafts },
      {
        op: 'emit',
        name: POSTING_EVENTS.drafts,
        detail: { did: ALICE, id: 'd1', action: 'created' },
      },
      { op: 'off', id: 'a' },
      { op: 'emit', name: POSTING_EVENTS.drafts, detail: { did: ALICE } },
    ],
  },
  {
    $id: 'one account only',
    steps: [
      { op: 'on', id: 'alice', name: POSTING_EVENTS.templates, did: ALICE },
      { op: 'on', id: 'all', name: POSTING_EVENTS.templates },
      { op: 'on', id: 'empty', name: POSTING_EVENTS.templates, did: '' },
      {
        op: 'emit',
        name: POSTING_EVENTS.templates,
        detail: { did: BOB, templates: [] },
      },
      {
        op: 'emit',
        name: POSTING_EVENTS.templates,
        detail: { did: ALICE, templates: [{ id: 't' }] },
      },
    ],
  },
  {
    $id: 'names are checked',
    steps: [
      { op: 'emit', name: 'virga:nope', detail: { did: ALICE } },
      { op: 'on', id: 'x', name: 'virga:nope' },
      { op: 'emit', name: 'virga:nope', detail: {} },
    ],
  },
  {
    $id: 'a detail needs a DID',
    steps: [
      { op: 'on', id: 'a', name: POSTING_EVENTS.drafts },
      { op: 'emit', name: POSTING_EVENTS.drafts, detail: {} },
      { op: 'emit', name: POSTING_EVENTS.drafts, detail: null },
      { op: 'emit', name: POSTING_EVENTS.drafts, detail: { did: '' } },
      { op: 'emit', name: POSTING_EVENTS.drafts, detail: { did: 42 } },
      { op: 'emit', name: POSTING_EVENTS.drafts, detail: 'did:plc:x' },
    ],
  },
  {
    $id: 'no window to dispatch on',
    steps: [
      {
        op: 'emit',
        name: POSTING_EVENTS.drafts,
        detail: { did: ALICE },
        noTarget: true,
      },
      { op: 'on', id: 'a', name: POSTING_EVENTS.drafts, noTarget: true },
      { op: 'off', id: 'a' },
      { op: 'emit', name: POSTING_EVENTS.drafts, detail: {}, noTarget: true },
    ],
  },
  {
    $id: 'posts-changed rows',
    steps: [
      { op: 'on', id: 'a', name: POSTS_CHANGED_EVENT },
      {
        op: 'emitPosts',
        did: ALICE,
        added: [
          { uri: 'at://a/app.bsky.feed.post/1', cid: 'c1' },
          { cid: 'no-uri' },
          {
            uri: 'at://a/app.bsky.feed.post/2',
            cid: '',
            record: { text: 'x' },
          },
          { uri: '', cid: 'c' },
          { uri: 5 },
          null,
          { uri: 'at://a/app.bsky.feed.post/3', record: null, extra: true },
        ],
        removed: [
          'at://a/app.bsky.feed.post/9',
          '',
          null,
          7,
          'at://a/app.bsky.feed.post/8',
        ],
      },
      { op: 'emitPosts', did: ALICE },
      { op: 'emitPosts', did: ALICE, added: null, removed: null },
      { op: 'emitPosts', did: '' },
      { op: 'emitPosts', did: null },
    ],
  },
  {
    $id: 'every name reaches its own listeners',
    steps: [
      ...Object.values(POSTING_EVENTS).map((name) => ({
        op: 'on',
        id: name,
        name,
      })),
      ...Object.values(POSTING_EVENTS).map((name) => ({
        op: 'emit',
        name,
        detail: { did: ALICE, name },
      })),
    ],
  },
  {
    $id: 'two listeners, in order, one stopped',
    steps: [
      { op: 'on', id: 'first', name: POSTING_EVENTS.timers },
      { op: 'on', id: 'second', name: POSTING_EVENTS.timers, did: ALICE },
      { op: 'emit', name: POSTING_EVENTS.timers, detail: { did: ALICE, n: 1 } },
      { op: 'off', id: 'first' },
      { op: 'off', id: 'first' },
      { op: 'emit', name: POSTING_EVENTS.timers, detail: { did: ALICE, n: 2 } },
    ],
  },
];

export default async function cases() {
  const out = [
    value('POSTING_EVENTS', POSTING_EVENTS),
    value('names', {
      POSTING_SETTINGS_EVENT,
      TEMPLATES_CHANGED_EVENT,
      DRAFTS_CHANGED_EVENT,
      SCHEDULED_CHANGED_EVENT,
      TIMERS_CHANGED_EVENT,
      POSTS_CHANGED_EVENT,
    }),
  ];
  out.push(...(await each('script', SCRIPTS, ({ steps }) => play(steps))));
  return out;
}
