/*
 * "Add to queue" on a post whose own slot has run out. An edited queued post
 * keeps its slot only while it is beyond MIN_LEAD_MS (nextOpenSlot refuses
 * anything closer), so a slow edit moves it to the back of the queue.
 * queueSlotMoveNote explains that case and is empty for every other, so an
 * ordinary re-save still reads "added to your queue".
 */

import { describe, it, expect } from 'vitest';
import { MIN_LEAD_MS, queueSlotMoveNote } from './postingQueue.js';

const now = new Date('2026-08-20T12:00:00.000Z');
const at = (msFromNow) => new Date(now.getTime() + msFromNow);
const row = (scheduledFor, queued = true) => ({ queued, scheduledFor });

describe('queueSlotMoveNote', () => {
  it('names the new time when the edited slot has come inside the lead time', () => {
    const note = queueSlotMoveNote(
      row(at(30 * 1000).toISOString()),
      at(3 * 3600 * 1000),
      now,
    );
    expect(note).toContain('too close to keep');
    expect(note).toContain('in 3 hr');
  });

  it('says the same for a slot that has already passed', () => {
    const note = queueSlotMoveNote(
      row(at(-60 * 60 * 1000).toISOString()),
      at(2 * 60 * 1000),
      now,
    );
    expect(note).toContain('too close to keep');
    expect(note).toContain('in 2 min');
  });

  it('stays quiet when the post keeps the slot it was editing', () => {
    const slot = at(6 * 3600 * 1000);
    expect(queueSlotMoveNote(row(slot.toISOString()), slot, now)).toBe('');
  });

  it('stays quiet when the slot is still far enough out, wherever it lands', () => {
    // Beyond the lead time the slot was holdable, so any move has another
    // cause.
    const own = at(MIN_LEAD_MS + 60 * 1000);
    expect(
      queueSlotMoveNote(row(own.toISOString()), at(4 * 3600 * 1000), now),
    ).toBe('');
  });

  it('stays quiet for a post that owns no queue slot', () => {
    expect(queueSlotMoveNote(null, at(3600 * 1000), now)).toBe('');
    // A one-off scheduled post being edited is not riding the queue.
    expect(
      queueSlotMoveNote(
        row(at(-1000).toISOString(), false),
        at(3600 * 1000),
        now,
      ),
    ).toBe('');
    // A queued row whose time we could not read is not evidence of a move.
    expect(queueSlotMoveNote(row(null), at(3600 * 1000), now)).toBe('');
    expect(queueSlotMoveNote(row('not a date'), at(3600 * 1000), now)).toBe('');
  });

  it('still says something when the new time is too odd to describe', () => {
    const note = queueSlotMoveNote(
      row(at(-1000).toISOString()),
      new Date(NaN),
      now,
    );
    expect(note).toContain('too close to keep');
  });
});
